/**
 * 发布前校验：把 dist-viewer/ 当作纯静态站点跑起来，确认它在“线上那种形态”下能用。
 *
 * 与 viewer-shots.mjs 的区别：
 * - viewer-shots 打的是开发服务器（5288），会走 Vite 的模块与回退逻辑；
 * - 这里打的是构建产物 + 极简静态服务器（5290），和线上托管一致：
 *   相对路径、hash 路由、没有 dev 回退。发布前跑这个，能提前暴露“打包后才坏”的问题。
 *
 * 用法：
 *   node verify/verify-viewer-build.mjs                    校验本地 dist-viewer/
 *   HL_LIVE_URL=https://xxx node verify/verify-viewer-build.mjs   校验线上地址
 * 产物：verify/_artifacts/viewer/21-published-entry-mobile.png
 */
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, resolve, extname, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const SITE = process.env.HL_VIEWER_DIR ? resolve(ROOT, process.env.HL_VIEWER_DIR) : join(ROOT, 'dist-viewer')
const OUT = resolve(__dirname, '_artifacts/viewer')
const HTTP_PORT = Number(process.env.HL_STATIC_PORT || 5290)
const LIVE = process.env.HL_LIVE_URL || ''
const EXPECT = process.env.HL_EXPECT === 'real' ? 'real' : 'sample'
const CDP_PORT = 9413

if (!LIVE && !existsSync(join(SITE, 'v/index.html'))) {
  console.error(`✗ 找不到 ${process.env.HL_VIEWER_DIR || 'dist-viewer'}/v/index.html，请先准备候选产物`)
  process.exit(1)
}
mkdirSync(OUT, { recursive: true })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
}

// 极简静态服务器：只做文件映射，不给 SPA 回退（hash 路由本来也不需要）
const server = createServer((req, res) => {
  const url = decodeURIComponent((req.url || '/').split('?')[0])
  let rel = url === '/' ? 'index.html' : normalize(url).replace(/^([/\\])+/, '')
  if (rel === '' || rel.endsWith('/') || rel.endsWith('\\')) rel = `${rel}index.html`
  let file = join(SITE, rel)
  // /v、/v/ 这类目录入口解析到目录下的 index.html
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html')
  if (!file.startsWith(SITE) || !existsSync(file) || statSync(file).isDirectory()) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    res.end('404')
    return
  }
  res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' })
  res.end(readFileSync(file))
})

function detectChrome() {
  const candidates = [
    process.env.HL_CHROME,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe'),
    '/usr/bin/google-chrome',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ].filter(Boolean)
  return candidates.find((p) => existsSync(p)) || candidates[0]
}

class CDP {
  constructor(ws) {
    this.ws = ws
    this.id = 0
    this.pending = new Map()
    this.logs = []
    this.failed = []
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data)
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve: res, reject } = this.pending.get(msg.id)
        this.pending.delete(msg.id)
        msg.error ? reject(new Error(JSON.stringify(msg.error))) : res(msg.result)
      }
      if (msg.method === 'Runtime.exceptionThrown') {
        this.logs.push(`exception: ${msg.params?.exceptionDetails?.exception?.description || ''}`)
      }
      if (msg.method === 'Runtime.consoleAPICalled' && msg.params?.type === 'error') {
        this.logs.push(`console.error: ${(msg.params.args || []).map((a) => a.value ?? a.description ?? '').join(' ')}`)
      }
      if (msg.method === 'Network.responseReceived' && msg.params.response.status >= 400) {
        this.failed.push(`${msg.params.response.status} ${msg.params.response.url}`)
      }
      if (msg.method === 'Network.loadingFailed') {
        this.failed.push(`failed ${msg.params.errorText} ${msg.params.type || ''}`)
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
    const r = await this.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
    writeFileSync(join(OUT, file), Buffer.from(r.data, 'base64'))
  }
}

const problems = []
const chromeProfile = mkdtempSync(join(tmpdir(), 'hl-static-'))
let chrome
let ws

let serverStarted = false
try {
  // 访客端现在位于 /v/（根路径只是保留查询串的跳转页），入口基准指向它
  let BASE
  if (LIVE) {
    const u = new URL(LIVE)
    u.pathname = u.pathname.replace(/\/+$/, '') + '/v/'
    BASE = u.toString()
    console.log(`模式：校验线上地址 ${LIVE}（访客端 ${BASE}）`)
  } else {
    await new Promise((res) => server.listen(HTTP_PORT, '127.0.0.1', res))
    serverStarted = true
    BASE = `http://127.0.0.1:${HTTP_PORT}/v/`
    console.log(`模式：校验本地 ${process.env.HL_VIEWER_DIR || 'dist-viewer/'}（访客端 /v/）`)
  }

  // 统一 URL：ROOT 保留 ?sharecode= 之类的查询串，assetBase 只保留目录部分
  const parsed = new URL(BASE)
  const ROOT = BASE.replace(/\/+$/, '')
  // 合成构建默认仍会先尝试云端；校验示例产物时必须显式固定来源。
  const HOME = EXPECT === 'sample' && !LIVE ? `${ROOT}/?source=sample` : ROOT
  const assetBase = `${parsed.origin}${parsed.pathname}`

  // 1. 入口与静态资源可达性（先不依赖浏览器）
  const indexRes = await fetch(ROOT)
  const indexHtml = await indexRes.text()
  if (indexRes.status !== 200) problems.push(`GET / 返回 ${indexRes.status}`)
  // 线上地址带 sharecode 时，直连资源会因缺少会话被拒（403），这属正常；
  // 线上模式下改用浏览器内的网络监控与样式表状态判断，避免误报。
  if (!LIVE) {
    for (const m of indexHtml.matchAll(/(?:src|href)="\.\/([^"]+)"/g)) {
      const r = await fetch(`${assetBase}${m[1]}`)
      if (r.status !== 200) problems.push(`静态资源 ${m[1]} 返回 ${r.status}`)
    }
  } else {
    console.log('线上模式：资源可达性以浏览器实际加载结果为准（跳过直连探测）')
  }
  const jsName = (indexHtml.match(/assets\/(viewer-[^"]+\.js)/) || [])[1]
  if (!jsName) problems.push('index.html 未引用 viewer bundle')
  if (!indexHtml.includes('noindex')) problems.push('入口缺少 noindex')
  if (/assets\/main-/.test(indexHtml)) problems.push('入口引用了作者端 bundle')
  console.log(`入口：GET / ${indexRes.status}，入口脚本 ${jsName || '（缺失）'}`)

  // 2. 浏览器渲染与交互
  chrome = spawn(
    detectChrome(),
    [
      '--headless=new',
      '--disable-gpu',
      '--no-sandbox',
      '--no-first-run',
      '--disable-dev-shm-usage',
      `--remote-debugging-port=${CDP_PORT}`,
      `--user-data-dir=${chromeProfile}`,
      '--hide-scrollbars',
      'about:blank',
    ],
    { stdio: 'ignore' },
  )

  let version = null
  for (let i = 0; i < 60; i++) {
    try {
      version = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`)).json()
      break
    } catch {
      await sleep(300)
    }
  }
  if (!version) throw new Error('Chrome 未能启动')

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

  await cdp.send('Page.navigate', { url: HOME })
  await sleep(LIVE ? 3000 : 2200)

  const home = await cdp.evaluate(`(() => {
    const de = document.documentElement;
    return {
      title: document.title,
      text: document.body.innerText.slice(0, 300),
      nodes: [...document.querySelectorAll('[data-testid="universe"] button[aria-label]')]
        .filter((b) => /共 |暂无内容/.test(b.getAttribute('aria-label'))).length,
      footer: (document.body.innerText.match(/发布版本[^\\n]*/) || [''])[0],
      hasSceneSwitch: document.body.innerText.includes('演示场景'),
      hasPublishedBadge: document.body.innerText.includes('已发布'),
      overflow: de.scrollWidth - de.clientWidth,
      hasSample: document.body.innerText.includes('示例数据'),
      hasArchive: !!document.querySelector('a[href*="archive"]'),
      assetsLoaded: [...document.querySelectorAll('link[rel=stylesheet]')].map(l => l.href),
      styleSheets: document.styleSheets.length,
      bg: getComputedStyle(document.body).backgroundColor,
    };
  })()`)
  if (!home.title.includes('心意簿')) problems.push(`页面标题异常：${home.title}`)
  if ((home.text || '').length < 40) problems.push('首页几乎没有渲染内容（可能是资源路径错误）')
  if (home.nodes !== 5) problems.push(`首页宇宙节点数为 ${home.nodes}，预期 5`)
  if (home.overflow > 1) problems.push(`手机端横向溢出 ${home.overflow}px`)
  if (EXPECT === 'real') {
    if (!home.hasPublishedBadge) problems.push('真实内容站点缺少「已发布」标记')
    if (home.hasSample) problems.push('真实内容站点仍显示「示例数据」标记')
    if (home.hasSceneSwitch) problems.push('真实内容站点仍暴露示例场景切换')
    const expectManifest = JSON.parse(readFileSync(join(SITE, 'snapshot/public-snapshot.json'), 'utf8')).manifest
    const mE = home.footer.match(/记录\s*(\d+)/)
    const mP = home.footer.match(/照片\s*(\d+)/)
    const shownId = (home.footer.match(/pub_[a-z0-9]+/i) || [])[0] || ''
    const cloudNewer = shownId && shownId !== expectManifest.publishId
    if (cloudNewer) {
      // 线上读的是作者后来发布的云端版本，页脚数字本来就该与随包静态兜底不同
      console.log(`真实内容：云端版本 ${shownId}（随包兜底 ${expectManifest.publishId}），跳过计数比对`)
      if (!mE || !mP) problems.push(`页脚缺少版本或计数信息：${home.footer}`)
    } else {
      if (!mE || Number(mE[1]) !== expectManifest.counts.entries) problems.push(`页脚记录数与快照不一致：${home.footer}`)
      if (!mP || Number(mP[1]) !== expectManifest.counts.photos) problems.push(`页脚照片数与快照不一致：${home.footer}`)
      console.log(`真实内容：${expectManifest.publishId} · ${expectManifest.counts.entries} 条记录 / ${expectManifest.counts.photos} 张照片`)
    }
  } else if (!home.hasSample) {
    problems.push('缺少「示例数据」标记，可能被误认为真实数据')
  }
  if (!home.hasArchive) problems.push('中心人物未链接到专属档案')
  if (home.styleSheets < 1) problems.push('样式表未生效（CSS 未加载）')
  await cdp.shot('21-published-entry-mobile.png')

  // 3. hash 路由在静态托管下的可达性
  for (const [route, expect] of [
    ['#/stories', '我们的故事'],
    ['#/album', '照片'],
    ['#/archive?tab=portrait', '档案'],
  ]) {
    await cdp.send('Page.navigate', { url: `${HOME}${route}` })
    await sleep(1500)
    const t = await cdp.evaluate('document.body.innerText.slice(0, 200)')
    if (!t || !t.includes(expect)) problems.push(`路由 ${route} 未渲染「${expect}」`)
    if (route.includes('album')) {
      await cdp.evaluate('window.scrollTo(0, document.body.scrollHeight)')
      await sleep(1200)
      const imgs = await cdp.evaluate(`(() => {
        const all = [...document.images];
        return { total: all.length, loaded: all.filter(i => i.complete && i.naturalWidth > 0).length, broken: all.filter(i => i.complete && i.naturalWidth === 0).length };
      })()`)
      if (imgs.broken > 0) problems.push(`相册有 ${imgs.broken} 张图片加载失败`)
      if (imgs.loaded < 12) problems.push(`相册只成功加载 ${imgs.loaded} 张图片`)
      console.log(`相册：${imgs.loaded}/${imgs.total} 张已加载，失败 ${imgs.broken}`)
    }
  }

  // 4. 320 窄屏
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 320, height: 740, deviceScaleFactor: 2, mobile: true })
  await cdp.send('Page.navigate', { url: HOME })
  await sleep(1800)
  const narrow = await cdp.evaluate(`(() => {
    const de = document.documentElement;
    return { overflow: de.scrollWidth - de.clientWidth, nodes: [...document.querySelectorAll('[data-testid="universe"] button[aria-label]')].filter((b) => /共 |暂无内容/.test(b.getAttribute('aria-label'))).length };
  })()`)
  if (narrow.overflow > 1) problems.push(`320px 下横向溢出 ${narrow.overflow}px`)

  if (cdp.logs.length) problems.push(`控制台错误：${cdp.logs.slice(0, 3).join(' | ')}`)
  const realFailures = cdp.failed.filter((f) => !f.includes('favicon'))
  if (realFailures.length) problems.push(`资源加载失败：${realFailures.slice(0, 3).join(' | ')}`)

  console.log(`首页渲染：标题「${home.title}」，节点 ${home.nodes} 个，横向溢出 ${home.overflow}px，示例标记 ${home.hasSample}`)
  console.log(`样式表 ${home.styleSheets} 个，body 背景 ${home.bg}`)
  console.log(`窄屏 320px：节点 ${narrow.nodes} 个，横向溢出 ${narrow.overflow}px`)
} finally {
  try {
    ws?.close()
  } catch {}
  chrome?.kill()
  if (serverStarted) await new Promise((res) => server.close(res))
}

console.log('\n—— 结果 ——')
if (problems.length) {
  console.error('✗ 发布前校验失败：')
  for (const p of problems) console.error(`  - ${p}`)
  process.exit(1)
}
console.log(`✓ ${LIVE ? '线上地址' : 'dist-viewer'} 可用：资源齐全、hash 路由可达、无控制台错误、无横向溢出。`)
console.log(`截图：${join(OUT, '21-published-entry-mobile.png')}`)
