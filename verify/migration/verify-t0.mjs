import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { existsSync, mkdtempSync, readFileSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { webcrypto, randomUUID } from 'node:crypto'
import { runAudit, DEFAULT_ZIP, EXPECTED_SHA256, ARTIFACTS, PRIVATE_OUT } from './audit-t0.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '../..')
const VITE_PORT = 5289
const CDP_PORT = 9539
const BASE = `http://127.0.0.1:${VITE_PORT}`
const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms))
let server
let chrome
let cdp
let userDataDir
let serverStopped = false
let browserStopped = false
let profileRemoved = false

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

async function assertPortFree(port) {
  await new Promise((resolveCheck, reject) => {
    const probe = createServer()
    probe.unref()
    probe.once('error', () => reject(new Error('PORT_IN_USE')))
    probe.listen(port, '127.0.0.1', () => probe.close(resolveCheck))
  })
}

async function waitHttp(url, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { cache: 'no-store' })
      if (response.ok) return response
    } catch {}
    await sleep(200)
  }
  throw new Error('HTTP_READY_TIMEOUT')
}

async function httpJson(path, method = 'GET') {
  const response = await fetch(`http://127.0.0.1:${CDP_PORT}${path}`, { method })
  if (!response.ok) throw new Error('CDP_HTTP_ERROR')
  return response.json()
}

class CDP {
  constructor(ws) {
    this.ws = ws
    this.id = 0
    this.pending = new Map()
    ws.addEventListener('message', (event) => {
      const message = JSON.parse(event.data)
      if (!message.id || !this.pending.has(message.id)) return
      const pending = this.pending.get(message.id)
      this.pending.delete(message.id)
      clearTimeout(pending.timer)
      if (message.error) pending.reject(new Error('CDP_METHOD_ERROR'))
      else pending.resolve(message.result)
    })
    ws.addEventListener('close', () => {
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timer)
        pending.reject(new Error('CDP_CLOSED'))
      }
      this.pending.clear()
    })
  }

  send(method, params = {}, timeoutMs = 60000) {
    const id = ++this.id
    return new Promise((resolveSend, reject) => {
      const timer = setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id)
          reject(new Error('CDP_TIMEOUT'))
        }
      }, timeoutMs)
      this.pending.set(id, { resolve: resolveSend, reject, timer })
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }

  async evaluate(expression, timeoutMs = 60000) {
    const result = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: true }, timeoutMs)
    if (result.exceptionDetails) throw new Error('BROWSER_EVALUATION_FAILED')
    return result.result?.value
  }
}

function detectChrome() {
  const candidates = [
    process.env.HL_CHROME,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe'),
  ].filter(Boolean)
  const executable = candidates.find((path) => existsSync(path))
  if (!executable) throw new Error('CHROME_NOT_FOUND')
  return executable
}

async function waitExit(child, timeoutMs = 10000) {
  if (!child || child.exitCode !== null || child.signalCode) return true
  return new Promise((resolveWait) => {
    const timer = setTimeout(() => {
      child.removeListener('exit', onExit)
      resolveWait(false)
    }, timeoutMs)
    const onExit = () => {
      clearTimeout(timer)
      resolveWait(true)
    }
    child.once('exit', onExit)
  })
}

async function cleanup() {
  if (cdp) {
    try { await cdp.send('Browser.close', {}, 10000) } catch {}
    try { cdp.ws.close() } catch {}
    cdp = undefined
  }
  if (chrome) {
    browserStopped = await waitExit(chrome, 10000)
    if (!browserStopped) {
      try { chrome.kill() } catch {}
      browserStopped = await waitExit(chrome, 5000)
    }
  } else browserStopped = true
  if (server) {
    try { server.kill() } catch {}
    serverStopped = await waitExit(server, 10000)
  } else serverStopped = true
  if (userDataDir) {
    try {
      rmSync(userDataDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 })
      profileRemoved = !existsSync(userDataDir)
    } catch {}
  }
}

async function main() {
  const startedAt = new Date().toISOString()
  const dbName = `heartlog_t0_verify_${Date.now().toString(36)}_${randomUUID().replaceAll('-', '').slice(0, 12)}`
  let result
  let errorName
  let auditPublic
  try {
    const audited = await runAudit(DEFAULT_ZIP)
    auditPublic = audited.publicReport
    if (!audited.audit.ok) {
      result = { ok: false, stage: 'read-only-audit', recoveryAuthorized: false, issueCount: audited.audit.issues.length, issues: audited.audit.publicIssues, private: { issues: audited.audit.issues } }
    } else {
      await assertPortFree(VITE_PORT)
      await assertPortFree(CDP_PORT)
      server = spawn(process.execPath, [resolve(ROOT, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', String(VITE_PORT), '--strictPort'], {
        cwd: ROOT,
        env: { ...process.env, BROWSER: 'none', NO_COLOR: '1' },
        stdio: 'ignore',
      })
      await waitHttp(`${BASE}/verify/migration/harness.html`)

      userDataDir = mkdtempSync(join(tmpdir(), 'heartlog-t0-'))
      chrome = spawn(detectChrome(), [
        '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run', '--disable-dev-shm-usage',
        '--disable-background-networking', '--disable-component-update', '--no-default-browser-check',
        `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${userDataDir}`, '--window-size=800,600', 'about:blank',
      ], { cwd: ROOT, stdio: 'ignore' })
      await waitHttp(`http://127.0.0.1:${CDP_PORT}/json/version`)
      const harnessUrl = `${BASE}/verify/migration/harness.html`
      const target = await httpJson(`/json/new?${encodeURIComponent(harnessUrl)}`, 'PUT')
      const ws = new WebSocket(target.webSocketDebuggerUrl)
      await new Promise((resolveOpen, reject) => {
        ws.addEventListener('open', resolveOpen, { once: true })
        ws.addEventListener('error', reject, { once: true })
      })
      cdp = new CDP(ws)
      await cdp.send('Runtime.enable')
      await cdp.send('Page.enable')
      const deadline = Date.now() + 30000
      while (Date.now() < deadline) {
        if (await cdp.evaluate(`document.readyState === 'complete' && typeof window.runT0 === 'function'`)) break
        await sleep(200)
      }
      const assertHarnessReady = await cdp.evaluate(`typeof window.runT0 === 'function'`)
      if (!assertHarnessReady) throw new Error('HARNESS_NOT_READY')
      const zipUrl = `/@fs/${DEFAULT_ZIP.replaceAll('\\', '/')}`
      result = await cdp.evaluate(`window.runT0(${JSON.stringify({ zipUrl, dbName, expectedSha256: EXPECTED_SHA256 })})`, 600000)
      if (!result) throw new Error('EMPTY_BROWSER_RESULT')
    }
  } catch (error) {
    errorName = error instanceof Error ? `${error.name}:${error.message}` : 'Error:UNKNOWN'
    result = { ok: false, stage: 'orchestrator', errorName: errorName.replace(/[^a-zA-Z0-9_:.-]/g, '_').slice(0, 120) }
  } finally {
    await cleanup()
  }

  let afterSourceSha256
  let sourceUnchanged = false
  try {
    afterSourceSha256 = await webcrypto.subtle.digest('SHA-256', readFileSync(DEFAULT_ZIP))
    afterSourceSha256 = Array.from(new Uint8Array(afterSourceSha256), (byte) => byte.toString(16).padStart(2, '0')).join('')
    sourceUnchanged = afterSourceSha256 === EXPECTED_SHA256
  } catch {}
  const generatedAt = new Date().toISOString()
  const ok = result?.ok === true && sourceUnchanged && serverStopped && browserStopped && profileRemoved
  const publicReport = {
    schema: 'heartlog-t0-verification-public-v1',
    startedAt,
    generatedAt,
    ok,
    auditOk: auditPublic?.ok === true,
    recoveryAuthorized: auditPublic?.ok === true,
    stage: result?.stage,
    errorName: result?.errorName,
    source: { sha256: afterSourceSha256, expectedSha256: EXPECTED_SHA256, unchanged: sourceUnchanged },
    isolation: { origin: BASE, vitePort: VITE_PORT, cdpPort: CDP_PORT, databaseName: dbName, temporaryProfile: true },
    databaseName: result?.databaseName || dbName,
    tables: result?.tables || [],
    tableCounts: result?.tableCounts || {},
    media: result?.media,
    restoredOrphanReferenceCount: result?.restoredOrphanReferenceCount,
    associationDifferenceCount: result?.associationDifferenceCount,
    issueCount: result?.issueCount,
    issues: result?.issues || [],
    cleanup: { serverStopped, browserStopped, temporaryProfileRemoved: profileRemoved },
    commands: [
      `node "${resolve(HERE, 'audit-t0.mjs').replaceAll('\\', '/')}"`,
      `node "${resolve(HERE, 'verify-t0.mjs').replaceAll('\\', '/')}"`,
    ],
    privateReport: 'private/t0/verification-private.json',
  }
  const privateReport = {
    schema: 'heartlog-t0-verification-private-v1',
    startedAt,
    generatedAt,
    ok,
    databaseName: dbName,
    details: result?.private || null,
    confidentiality: 'Private identifiers and hashes only. No record values, meta keys/values, or image bytes.',
  }
  writeJson(resolve(ARTIFACTS, 't0-verification.json'), publicReport)
  writeJson(resolve(PRIVATE_OUT, 'verification-private.json'), privateReport)
  console.log(`${ok ? 'T0 VERIFY PASS' : 'T0 VERIFY FAIL'} tables=${result?.tables?.length || 0} media=${result?.media?.restored || 0} differences=${result?.private?.differences?.length || result?.issueCount || 0}`)
  console.log(`Public report: verify/_artifacts/migration/t0-verification.json`)
  console.log(`Private report: verify/_artifacts/migration/private/t0/verification-private.json`)
  console.log(`Cleanup: server=${serverStopped ? 'stopped' : 'check'} browser=${browserStopped ? 'stopped' : 'check'} profile=${profileRemoved ? 'removed' : 'check'}`)
  if (!ok) process.exitCode = 1
}

await main()
