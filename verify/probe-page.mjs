/**
 * 快速诊断：加载页面，dump 正文文本与控制台异常
 * 用法：node verify/probe-page.mjs [url]
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const BASE = process.argv[2] || 'http://127.0.0.1:5288'
const PORT = 9421

function detectChrome() {
  const candidates = [
    process.env.HL_CHROME,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe'),
    '/usr/bin/google-chrome',
  ].filter(Boolean)
  return candidates.find((p) => existsSync(p)) || candidates[1]
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const userDataDir = mkdtempSync(join(tmpdir(), 'hl-probe-'))
const chrome = spawn(detectChrome(), [
  '--headless=new',
  '--disable-gpu',
  '--no-sandbox',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${userDataDir}`,
  'about:blank',
])

let ws
const logs = []
let id = 0
const pending = new Map()

function send(method, params = {}) {
  const mid = ++id
  return new Promise((resolve, reject) => {
    pending.set(mid, { resolve, reject })
    ws.send(JSON.stringify({ id: mid, method, params }))
    setTimeout(() => {
      if (pending.has(mid)) {
        pending.delete(mid)
        reject(new Error(`timeout ${method}`))
      }
    }, 20000)
  })
}

async function evaluate(expression) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (r.exceptionDetails) return `EXCEPTION: ${r.exceptionDetails.exception?.description || r.exceptionDetails.text}`
  return r.result?.value
}

try {
  let target
  for (let i = 0; i < 30; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
      target = list.find((t) => t.type === 'page')
      if (target) break
    } catch {
      /* retry */
    }
    await sleep(300)
  }
  if (!target) throw new Error('找不到 Chrome 页面目标')

  ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((res, rej) => {
    ws.addEventListener('open', res)
    ws.addEventListener('error', rej)
  })
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data)
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id)
      pending.delete(msg.id)
      if (msg.error) reject(new Error(JSON.stringify(msg.error)))
      else resolve(msg.result)
      return
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params?.exceptionDetails
      logs.push(`EXCEPTION: ${d?.exception?.description || d?.text}`)
    }
    if (msg.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(msg.params?.type)) {
      logs.push(`${msg.params.type}: ${(msg.params.args || []).map((a) => a.value ?? a.description ?? a.type).join(' ')}`)
    }
  })

  await send('Runtime.enable')
  await send('Page.enable')
  await send('Page.navigate', { url: `${BASE}/#/settings` })
  await sleep(6000)

  console.log('=== BODY TEXT ===')
  console.log(String(await evaluate('document.body.innerText')).slice(0, 2500))
  console.log('\n=== CONSOLE / EXCEPTIONS ===')
  console.log(logs.length ? logs.slice(0, 20).join('\n') : '(无)')
  console.log('\n=== 是否有 React 错误边界 ===')
  console.log(await evaluate('document.querySelector("#root")?.innerHTML?.length ?? -1'))
} catch (e) {
  console.error('诊断失败:', e.message)
} finally {
  try {
    ws?.close()
  } catch {
    /* ignore */
  }
  chrome.kill()
  await sleep(500)
  rmSync(userDataDir, { recursive: true, force: true })
  process.exit(0)
}
