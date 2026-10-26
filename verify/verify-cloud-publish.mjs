/**
 * 云端发布读链路验证：公网页能不能只用 publishable key 读到「已发布」快照与照片。
 *
 * 用法：node verify/verify-cloud-publish.mjs   （需 npm run dev）
 *       HL_BASE=https://heartlog-viewer.app.workbuddy.host/ node verify/verify-cloud-publish.mjs
 *
 * 依赖云端存在一行 is_live=true 的发布数据（作者真实发布）。
 * 判定「公网页读的是云端」的关键信号：图片地址是 data: 而不是 ./snapshot/media/*.jpg。
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const BASE = (process.env.HL_BASE || 'http://127.0.0.1:5288').replace(/\/$/, '')
/** 入口页：本地是 /viewer.html，线上是根路径（带 sharecode），用 HL_ENTRY 指定 */
const ENTRY = process.env.HL_ENTRY || `${BASE}/viewer.html`

/** 在入口地址上叠加查询参数与 hash，保留已有 query（如 sharecode） */
function entryUrl(params = {}, hash = '#/') {
  const u = new URL(ENTRY)
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v)
  u.hash = hash
  return u.toString()
}
const OUT = join(ROOT, 'verify/_artifacts/cloud')
const PORT = 9423
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
    const r = await this.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
    writeFileSync(join(OUT, file), Buffer.from(r.data, 'base64'))
  }
}

const profile = mkdtempSync(join(tmpdir(), 'hl-cloud-'))
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

  const requests = []
  cdp.ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data)
    if (m.method === 'Network.requestWillBeSent') requests.push(m.params.request.url)
  })

  /* 1. 云端模式：应当读到已发布快照，且照片来自云端媒体表 */
  await cdp.send('Page.navigate', { url: entryUrl({ source: 'cloud' }) })
  await sleep(4500)

  const home = await cdp.evaluate(`(() => {
    const t = document.body.innerText;
    const imgs = [...document.images];
    return {
      text: t.slice(0, 80),
      badge: t.includes('已发布'),
      sample: t.includes('示例数据'),
      imgs: imgs.filter(i => i.complete && i.naturalWidth > 0).length,
      broken: imgs.filter(i => i.complete && i.naturalWidth === 0).length,
      dataUrls: imgs.filter(i => i.src.startsWith('data:')).length,
      staticUrls: imgs.filter(i => i.src.indexOf('/snapshot/media/') !== -1).length,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  })()`)
  if (!home.badge) problems.push('云端模式缺少「已发布」标记')
  if (home.sample) problems.push('云端模式显示的是示例数据')
  if (home.imgs < 1) problems.push('云端模式的图片没有加载出来')
  if (home.broken > 0) problems.push(`云端模式有 ${home.broken} 张图片加载失败`)
  if (home.overflow > 1) problems.push(`云端模式横向溢出 ${home.overflow}px`)
  if (home.staticUrls > 0 && home.dataUrls === 0) {
    problems.push('图片全部来自静态目录 ./snapshot/media/，说明没有走云端媒体表')
  }
  notes.push(`首页：图片 ${home.imgs} 张（失败 ${home.broken}），data URL ${home.dataUrls}，静态目录 ${home.staticUrls}，溢出 ${home.overflow}px`)

  const cloudCalls = requests.filter((u) => u.includes('/.cloud/database/rest/heartlog_public_'))
  if (cloudCalls.length === 0) problems.push('没有向云端发布表发起请求')
  notes.push(`云端请求：${cloudCalls.length} 次`)

  await cdp.shot('01-cloud-home.png')

  /* 2. 相册：缩略图应来自媒体表（data: 协议） */
  await cdp.send('Page.navigate', { url: entryUrl({ source: 'cloud' }, '#/album') })
  await sleep(3000)
  const album = await cdp.evaluate(`(() => {
    const t = document.body.innerText;
    const shots = [...document.images];
    return {
      count: Number((t.match(/共 (\\d+) 张照片/) || [])[1] || 0),
      dataUrls: shots.filter(i => i.src.startsWith('data:')).length,
      loaded: shots.filter(i => i.complete && i.naturalWidth > 0).length,
    };
  })()`)
  if (album.count < 1) problems.push('云端模式相册没有照片')
  if (album.dataUrls < Math.min(album.count, album.loaded)) {
    problems.push(`相册缩略图未全部来自云端媒体表（data ${album.dataUrls} / 共 ${album.count}）`)
  }
  if (album.dataUrls < 1) problems.push('相册缩略图不是从云端媒体表取的 data URL')
  notes.push(`相册：${album.count} 张，data URL ${album.dataUrls}，已加载 ${album.loaded}`)
  await cdp.shot('02-cloud-album.png')

  /* 3. 大图：按需取 web 图 */
  await cdp.evaluate(`(() => { document.querySelector('button[aria-label^="查看照片"]')?.click(); return true })()`)
  await sleep(1800)
  const lightbox = await cdp.evaluate(`(() => {
    const d = document.querySelector('[role="dialog"][aria-label="照片大图"]');
    const img = d ? d.querySelector('img') : null;
    return { open: !!d, srcKind: img ? (img.src.startsWith('data:') ? 'data' : 'other') : 'none', ok: img ? img.complete && img.naturalWidth > 0 : false };
  })()`)
  if (!lightbox.open) problems.push('大图没有打开')
  if (!lightbox.ok) problems.push('大图没有成功加载')
  notes.push(`大图：${lightbox.srcKind}，加载=${lightbox.ok}`)
  await cdp.shot('03-cloud-lightbox.png')

  /* 4. 演示模式不受影响 */
  await cdp.send('Page.navigate', { url: entryUrl({ source: 'sample' }) })
  await sleep(2500)
  const sample = await cdp.evaluate(`(() => document.body.innerText.includes('示例数据'))()`)
  if (!sample) problems.push('?source=sample 没有回到合成演示')

  if (cdp.logs.length) problems.push(`控制台错误：${cdp.logs.slice(0, 2).join(' | ')}`)

  console.log('\n—— 结果 ——')
  for (const n of notes) console.log(`· ${n}`)
  if (problems.length) {
    console.log(`✗ ${problems.length} 个问题：`)
    for (const p of problems) console.log(`  · ${p}`)
    process.exitCode = 1
  } else {
    console.log('✓ 公网页在读云端：匿名只读快照 + 缩略图 + 按需大图，演示模式不受影响。')
  }
  console.log(`截图：${OUT}`)
} finally {
  chrome.kill()
}
