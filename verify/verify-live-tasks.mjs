/**
 * 线上真实核查：部署后作者端能否加载「为他记着」。
 *
 * 目的不是替代真机验收，而是确认**线上产物确实带上了新功能**：
 * 之前遇到过「本地构建有 chunk、线上 403 或没镜像过去」的情况，
 * 只看本地 dist 目录无法发现。
 *
 * 用法：node verify/verify-live-tasks.mjs
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const OUT = join(ROOT, 'verify/_artifacts/live-tasks')
const PORT = 9429
const LIVE = process.env.HL_LIVE_URL || 'https://heartlog-viewer.app.workbuddy.host/?sharecode=PXS5TIGLA6'
const AUTHOR = LIVE.replace('/?sharecode=', '/author.html?sharecode=').replace(/\?.*$/, '') + '?sharecode=' + (LIVE.match(/sharecode=([^&]+)/) || [])[1]
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
mkdirSync(OUT, { recursive: true })

const problems = []
const notes = []

function chromePath() {
  const c = [
    process.env.HL_CHROME,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  ].filter(Boolean)
  return c.find((p) => existsSync(p)) || c[0]
}

class CDP {
  constructor(ws) {
    this.ws = ws
    this.id = 0
    this.pending = new Map()
    this.logs = []
    this.failed = []
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data)
      if (m.id && this.pending.has(m.id)) {
        const { resolve: r, reject } = this.pending.get(m.id)
        this.pending.delete(m.id)
        m.error ? reject(new Error(JSON.stringify(m.error))) : r(m.result)
      }
      if (m.method === 'Runtime.exceptionThrown') this.logs.push(m.params?.exceptionDetails?.exception?.description || 'exception')
      if (m.method === 'Runtime.consoleAPICalled' && m.params?.type === 'error') {
        this.logs.push((m.params.args || []).map((a) => a.value ?? a.description ?? '').join(' '))
      }
      if (m.method === 'Network.responseReceived') {
        const r = m.params.response
        if (r.status >= 400) this.failed.push(`${r.status} ${r.url.split('/').pop()}`)
      }
    })
  }
  send(method, params = {}) {
    const id = ++this.id
    return new Promise((res, rej) => {
      this.pending.set(id, { resolve: res, reject: rej })
      this.ws.send(JSON.stringify({ id, method, params }))
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id)
          rej(new Error(`timeout ${method}`))
        }
      }, 30000)
    })
  }
  async evaluate(expression) {
    const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'evaluate failed')
    return r.result?.value
  }
  async shot(file) {
    const r = await this.send('Page.captureScreenshot', { format: 'png' })
    writeFileSync(join(OUT, file), Buffer.from(r.data, 'base64'))
  }
}

const profile = mkdtempSync(join(tmpdir(), 'hl-live-'))
const chrome = spawn(
  chromePath(),
  [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--no-first-run',
    '--disable-dev-shm-usage',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    '--hide-scrollbars',
    'about:blank',
  ],
  { stdio: 'ignore' },
)

try {
  let ok = false
  for (let i = 0; i < 60; i++) {
    try {
      await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json()
      ok = true
      break
    } catch {
      await sleep(300)
    }
  }
  if (!ok) throw new Error('Chrome 未启动')

  const t = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json()
  const ws = new WebSocket(t.webSocketDebuggerUrl)
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true })
    ws.addEventListener('error', rej, { once: true })
  })
  const cdp = new CDP(ws)
  await cdp.send('Runtime.enable')
  await cdp.send('Page.enable')
  await cdp.send('Network.enable')
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true })

  console.log(`访客端：${LIVE}`)
  console.log(`作者端：${AUTHOR}`)

  /* ---------- 1. 访客端：不得出现私有入口，不得加载 tasks ---------- */
  await cdp.send('Page.navigate', { url: LIVE })
  await sleep(5000)
  const visitorText = await cdp.evaluate('document.body.innerText')
  const visitorRes = await cdp.evaluate(`performance.getEntriesByType('resource').map((r) => r.name)`)
  const visitorTasksLoads = visitorRes.filter((u) => /Task(Bell|s|SummaryCard)/i.test(u))
  if (visitorTasksLoads.length) problems.push(`线上访客端加载了待办 chunk：${visitorTasksLoads.join(', ')}`)
  // 更严的边界：tasks/store 会带进 Dexie，访客端连它都不能加载
  const visitorStoreLoads = visitorRes.filter((u) => /(^|\/)store-[A-Za-z0-9_-]+\.js/.test(u))
  if (visitorStoreLoads.length) problems.push(`线上访客端加载了 store chunk（含 Dexie）：${visitorStoreLoads.join(', ')}`)
  const visitorDbLoads = visitorRes.filter((u) => /(^|\/)db-[A-Za-z0-9_-]+\.js/.test(u))
  if (visitorDbLoads.length) problems.push(`线上访客端加载了 db chunk：${visitorDbLoads.join(', ')}`)
  // 访客端真实跑起来后不得建库（与 verify-author 同口径，但这里是线上域名）
  const visitorDbCount = await cdp.evaluate(`(async () => {
    try { return (await indexedDB.databases()).length } catch { return -1 }
  })()`)
  if (visitorDbCount > 0) problems.push(`线上访客端创建了 ${visitorDbCount} 个 IndexedDB`)
  notes.push(`访客端：store/db chunk 加载 ${visitorStoreLoads.length}/${visitorDbLoads.length} 个，IndexedDB ${visitorDbCount} 个`)
  if (visitorText.includes('为他记着')) problems.push('线上访客端出现「为他记着」')
  if (visitorText.includes('关页推送')) problems.push('线上访客端出现只有作者端才该有的状态条')
  notes.push(`访客端：待办 chunk 加载 ${visitorTasksLoads.length} 个，页面含「为他记着」=${visitorText.includes('为他记着')}`)
  await cdp.shot('01-visitor.png')

  /* ---------- 2. 作者端：待办入口在，chunk 取得到 ---------- */
  await cdp.send('Page.navigate', { url: AUTHOR })
  await sleep(5000)
  const authorText = await cdp.evaluate('document.body.innerText')
  const authorRes = await cdp.evaluate(`performance.getEntriesByType('resource').map((r) => r.name)`)
  const gate = authorText.includes('这台设备上还没有记录') || authorText.includes('从云端同步')
  notes.push(`作者端：${gate ? '停在启动闸门（新设备正常）' : '已进入主界面'}`)

  // 直接探测 tasks chunk 是否可取（线上按 sharecode 放行，必须带参数）
  const chunkProbe = await cdp.evaluate(`(async () => {
    const scripts = [...document.querySelectorAll('script')].map((s) => s.src).filter(Boolean)
    const authorScript = scripts.find((s) => s.includes('author-'))
    if (!authorScript) return { error: '找不到 author 脚本' }
    const base = authorScript.replace(/[^/]+$/, '')
    // 名字里带 hash，只能从 author bundle 里抽
    const code = await (await fetch(authorScript)).text()
    const names = [...new Set((code.match(/Tasks-[A-Za-z0-9_-]+\\.js|TaskBell-[A-Za-z0-9_-]+\\.js|TaskSummaryCard-[A-Za-z0-9_-]+\\.js/g) || []))]
    const results = []
    for (const n of names) {
      const res = await fetch(base + n)
      results.push({ name: n, status: res.status })
    }
    return { names, results }
  })().catch((e) => ({ error: String(e && e.message ? e.message : e) }))`)

  if (chunkProbe?.error) problems.push(`探测 tasks chunk 失败：${chunkProbe.error}`)
  else {
    notes.push(`author bundle 引用的待办 chunk：${chunkProbe.names.join(', ') || '（未找到）'}`)
    if (!chunkProbe.names.length) problems.push('线上 author bundle 里没有引用任何待办 chunk，说明部署的不是新版本')
    for (const r of chunkProbe.results || []) {
      if (r.status !== 200) problems.push(`待办 chunk ${r.name} 线上取不到（HTTP ${r.status}）`)
    }
  }

  await cdp.shot('02-author.png')

  /* ---------- 3. 已知 4xx 噪声过滤 ---------- */
  const realFailures = cdp.failed.filter((f) => !/favicon|manifest/.test(f))
  if (realFailures.length) notes.push(`线上 4xx/5xx：${[...new Set(realFailures)].slice(0, 5).join(' | ')}`)
  if (cdp.logs.length) problems.push(`页面报错：${cdp.logs.slice(0, 3).join(' | ')}`)

  console.log('\n—— 记录 ——')
  for (const n of notes) console.log(`  · ${n}`)
  console.log('\n—— 结果 ——')
  if (problems.length) {
    console.log(`✗ ${problems.length} 个问题：`)
    for (const p of problems) console.log(`  · ${p}`)
    process.exitCode = 1
  } else {
    console.log('✓ 线上产物包含待办功能；访客端不含私有入口也不加载待办 chunk。')
  }
  console.log(`截图：${OUT}`)
} finally {
  chrome.kill()
}