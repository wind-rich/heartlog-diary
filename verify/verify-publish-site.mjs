/**
 * 发布前门禁：把 dist-viewer/ 当一个静态站点跑起来，检查两个入口。
 *
 * 1. `/`（index.html）→ 访客端：已发布标记、计数与快照一致、图片可解码；
 * 2. `/author.html` → 作者端：能进入（空设备显示启动闸门），且**不加载访客端 bundle**；
 * 3. 访客端**不加载作者端 bundle**（访客首屏不得含数据库与云 SDK）。
 *
 * 用法：node verify/verify-publish-site.mjs
 * 前提：npm run build:site
 */
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, resolve, extname, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const SITE = join(ROOT, 'dist-viewer')
const OUT = join(ROOT, 'verify/_artifacts/publish')
const LIVE = process.env.HL_LIVE_URL || ''
const HTTP_PORT = 5293
const CDP_PORT = 9417

if (!LIVE && (!existsSync(join(SITE, 'index.html')) || !existsSync(join(SITE, 'author.html')))) {
  console.error('✗ 缺少 dist-viewer/index.html 或 author.html，请先 npm run build:site')
  process.exit(1)
}
mkdirSync(OUT, { recursive: true })

const manifest = JSON.parse(readFileSync(join(SITE, 'snapshot/public-snapshot.json'), 'utf8')).manifest
const VIEWER_URL = LIVE || ''
const AUTHOR_URL = LIVE ? LIVE.replace('/?', '/author.html?') : ''
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.jpg': 'image/jpeg', '.webmanifest': 'application/manifest+json' }

const server = createServer((req, res) => {
  const url = decodeURIComponent((req.url || '/').split('?')[0])
  const rel = url === '/' ? 'index.html' : normalize(url).replace(/^([/\\])+/, '')
  const file = join(SITE, rel)
  if (!file.startsWith(SITE) || !existsSync(file) || statSync(file).isDirectory()) {
    res.writeHead(404, { 'content-type': 'text/plain' })
    res.end('404')
    return
  }
  res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' })
  res.end(readFileSync(file))
})

function chromePath() {
  const c = [
    process.env.HL_CHROME,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe'),
    '/usr/bin/google-chrome',
  ].filter(Boolean)
  return c.find((p) => existsSync(p)) || c[0]
}

class CDP {
  constructor(ws) {
    this.ws = ws
    this.id = 0
    this.pending = new Map()
    this.logs = []
    this.requests = []
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data)
      if (m.id && this.pending.has(m.id)) {
        const { resolve: r, reject } = this.pending.get(m.id)
        this.pending.delete(m.id)
        m.error ? reject(new Error(JSON.stringify(m.error))) : r(m.result)
      }
      if (m.method === 'Runtime.exceptionThrown') this.logs.push(m.params?.exceptionDetails?.exception?.description || 'exception')
      if (m.method === 'Runtime.consoleAPICalled' && m.params?.type === 'error') this.logs.push((m.params.args || []).map((a) => a.value ?? a.description ?? '').join(' '))
      if (m.method === 'Network.requestWillBeSent') this.requests.push(m.params.request.url)
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
          rej(new Error(`CDP timeout: ${method}`))
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

const problems = []

/** 扫描 HTML 与所有 JS/CSS 中出现的 assets 文件名 */
function filesToCheck(site) {
  const found = new Set()
  const scan = (text) => {
    for (const m of text.matchAll(/assets\/([A-Za-z0-9_.-]+\.(?:js|css))/g)) found.add(m[1])
  }
  for (const name of readdirSync(site)) {
    if (name.endsWith('.html')) scan(readFileSync(join(site, name), 'utf8'))
  }
  const assetsDir = join(site, 'assets')
  if (existsSync(assetsDir)) {
    for (const name of readdirSync(assetsDir)) {
      if (name.endsWith('.js') || name.endsWith('.css')) scan(readFileSync(join(assetsDir, name), 'utf8'))
    }
  }
  return found
}
const notes = []
const profile = mkdtempSync(join(tmpdir(), 'hl-publish-'))
let chrome
let ws
let started = false

try {
  let BASE = ''
  if (LIVE) {
    BASE = new URL(LIVE).origin
  } else {
    await new Promise((r) => server.listen(HTTP_PORT, '127.0.0.1', r))
    started = true
    BASE = `http://127.0.0.1:${HTTP_PORT}`
  }
  const viewerEntry = LIVE ? VIEWER_URL : `${BASE}/`
  const authorEntry = LIVE ? AUTHOR_URL : `${BASE}/author.html`

  chrome = spawn(
    chromePath(),
    ['--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run', '--disable-dev-shm-usage', `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profile}`, '--hide-scrollbars', 'about:blank'],
    { stdio: 'ignore' },
  )

  let ok = false
  for (let i = 0; i < 60; i++) {
    try {
      await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`)).json()
      ok = true
      break
    } catch {
      await sleep(300)
    }
  }
  if (!ok) throw new Error('Chrome 未能启动')

  const target = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/new?about:blank`, { method: 'PUT' })).json()
  ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true })
    ws.addEventListener('error', rej, { once: true })
  })
  const cdp = new CDP(ws)
  await cdp.send('Runtime.enable')
  await cdp.send('Page.enable')
  await cdp.send('Network.enable')
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true })

  /* ---- 访客端 ---- */
  cdp.requests.length = 0
  await cdp.send('Page.navigate', { url: viewerEntry })
  await sleep(LIVE ? 12000 : 3200)
  const viewer = await cdp.evaluate(`(() => {
    const t = document.body.innerText;
    const imgs = [...document.images];
    return {
      published: t.includes('已发布'),
      sample: t.includes('示例数据'),
      footer: (t.match(/发布版本[^\\n]*/) || [''])[0],
      nodes: [...document.querySelectorAll('[data-testid="universe"] button[aria-label]')].filter(b => /共 |暂无内容/.test(b.getAttribute('aria-label'))).length,
      imgTotal: imgs.length,
      imgBroken: imgs.filter(i => i.complete && i.naturalWidth === 0).length,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  })()`)
  if (!viewer.published || viewer.sample) problems.push('访客端未显示为已发布真实内容')
  if (viewer.nodes !== 5) problems.push(`访客端节点 ${viewer.nodes} 个`)
  if (viewer.imgBroken > 0) problems.push(`访客端 ${viewer.imgBroken} 张图片加载失败`)
  if (viewer.overflow > 1) problems.push(`访客端横向溢出 ${viewer.overflow}px`)
  const mE = viewer.footer.match(/记录\s*(\d+)/)
  if (!mE || Number(mE[1]) !== manifest.counts.entries) problems.push(`访客端记录数与快照不一致：${viewer.footer}`)
  if (!LIVE) {
    // 静态检查：HTML/JS/CSS 里提到的 assets 文件必须真实存在（防懒加载 chunk 被误删）
    const missing = []
    for (const rel of filesToCheck(SITE)) {
      if (!existsSync(join(SITE, 'assets', rel))) missing.push(rel)
    }
    if (missing.length) problems.push(`产物缺少被引用的资源：${missing.slice(0, 3).join(', ')}`)
  }
  const viewerChunks = cdp.requests.filter((u) => /assets\/[a-z]+-[^/]+\.js/.test(u)).map((u) => u.replace(/.*assets\//, ''))
  if (viewerChunks.some((f) => f.startsWith('author-'))) problems.push(`访客端加载了作者端 bundle：${viewerChunks.join(', ')}`)
  if (!LIVE) {
    for (const f of viewerChunks) {
      const src = readFileSync(join(SITE, 'assets', f), 'utf8')
      if (/indexedDB|Dexie/.test(src)) problems.push(`访客端加载的 ${f} 里含数据库代码（indexedDB/Dexie）`)
    }
  }
  notes.push(`访客端：节点 ${viewer.nodes}，图片 ${viewer.imgTotal}（失败 ${viewer.imgBroken}），脚本 ${viewerChunks.join(', ')}`)
  await cdp.shot('01-viewer-entry.png')

  /* ---- 作者端 ---- */
  cdp.requests.length = 0
  await cdp.send('Page.navigate', { url: authorEntry })
  await sleep(LIVE ? 4000 : 2600)
  const author = await cdp.evaluate(`(() => {
    const t = document.body.innerText;
    return {
      gate: t.includes('这台设备上还没有记录'),
      nav: t.includes('时间线') && t.includes('回顾'),
      hasAuthorTitle: document.title.includes('作者端'),
      cloudCard: t.includes('从云端同步'),
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  })()`)
  if (!author.gate && !author.nav) problems.push('作者端既没有启动闸门也没有进入主界面')
  if (author.gate && author.nav) problems.push('作者端同时出现闸门与主导航，状态矛盾')
  const authorChunks = cdp.requests.filter((u) => /assets\/[a-z]+-[^/]+\.js/.test(u)).map((u) => u.replace(/.*assets\//, ''))
  if (!authorChunks.some((f) => f.startsWith('author-'))) problems.push(`作者端未加载自己的 bundle：${authorChunks.join(', ')}`)
  if (author.overflow > 1) problems.push(`作者端横向溢出 ${author.overflow}px`)
  if (!author.cloudCard) problems.push('作者端启动闸门缺少「从云端同步」入口')
  notes.push(`作者端：闸门 ${author.gate}，云端入口 ${author.cloudCard}，脚本 ${authorChunks.join(', ')}`)
  await cdp.shot('02-author-entry.png')

  if (cdp.logs.length) problems.push(`控制台错误：${cdp.logs.slice(0, 2).join(' | ')}`)
} finally {
  try {
    ws?.close()
  } catch {}
  chrome?.kill()
  if (started) await new Promise((r) => server.close(r))
}

console.log(`快照：${manifest.publishId}（${manifest.counts.entries} 条记录 / ${manifest.counts.photos} 张照片）`)
for (const n of notes) console.log(`· ${n}`)

console.log('\n—— 结果 ——')
if (problems.length) {
  console.error('✗ 发布前门禁未通过：')
  for (const p of problems) console.error(`  - ${p}`)
  process.exit(1)
}
console.log('✓ 两个入口互不串包：访客端不加载作者端脚本，作者端可进入，真实内容与快照一致。')
console.log(`截图：${OUT}`)
