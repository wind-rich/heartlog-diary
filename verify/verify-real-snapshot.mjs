/**
 * T1 真实快照的端到端校验：展示端读取真实公开快照后能否正确渲染。
 *
 * 前提：`npm run dev` 已启动（默认 5288），且已执行 node scripts/build-public-snapshot.mjs。
 * 用法：node verify/verify-real-snapshot.mjs
 *
 * 产物写入 verify/_artifacts/migration/private/shots/（私有，已被 Git 忽略）。
 * 本脚本只读快照，不写回任何数据；不打印记录正文、称呼或照片内容。
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const BASE = process.env.HL_BASE || 'http://127.0.0.1:5288'
const SNAPSHOT_PATH = '/verify/_artifacts/migration/private/publish/public-snapshot.json'
const SNAPSHOT_FILE = join(ROOT, SNAPSHOT_PATH.replace(/^\//, ''))
const OUT = join(ROOT, 'verify/_artifacts/migration/private/shots')
const CDP_PORT = 9415

if (!existsSync(SNAPSHOT_FILE)) {
  console.error('✗ 找不到公开快照，请先执行 node scripts/build-public-snapshot.mjs')
  process.exit(1)
}
mkdirSync(OUT, { recursive: true })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const manifest = JSON.parse(readFileSync(SNAPSHOT_FILE, 'utf8')).manifest
const problems = []
const notes = []

/* ---------- 1. 快照本体的边界检查（不依赖浏览器） ---------- */
const raw = readFileSync(SNAPSHOT_FILE, 'utf8')
for (const banned of ['"apiKey"', 'apiKey', 'proxyUrl', 'publishToken', '"meta"']) {
  if (raw.includes(banned)) problems.push(`公开快照含私有痕迹：${banned}`)
}
if (manifest.formatVersion !== 1) problems.push(`manifest.formatVersion=${manifest.formatVersion}，预期 1`)
if (!/^[0-9a-f]{64}$/.test(manifest.contentHash || '')) problems.push('contentHash 不是 64 位十六进制')
if (!/^pub_[0-9a-f]{12}$/.test(manifest.publishId || '')) problems.push(`publishId 形态异常：${manifest.publishId}`)

/* ---------- 2. 浏览器渲染 ---------- */
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
        this.logs.push(msg.params?.exceptionDetails?.exception?.description || 'exception')
      }
      if (msg.method === 'Runtime.consoleAPICalled' && msg.params?.type === 'error') {
        this.logs.push((msg.params.args || []).map((a) => a.value ?? a.description ?? '').join(' '))
      }
      if (msg.method === 'Network.responseReceived' && msg.params.response.status >= 400) {
        this.failed.push(`${msg.params.response.status} ${msg.params.response.url}`)
      }
      if (msg.method === 'Network.loadingFailed') {
        this.failed.push(`failed ${msg.params.errorText}`)
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
    const r = await this.send('Page.captureScreenshot', { format: 'png' })
    writeFileSync(join(OUT, file), Buffer.from(r.data, 'base64'))
  }
}

const profile = mkdtempSync(join(tmpdir(), 'hl-real-'))
const chrome = spawn(
  detectChrome(),
  [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--no-first-run',
    '--disable-dev-shm-usage',
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${profile}`,
    '--hide-scrollbars',
    'about:blank',
  ],
  { stdio: 'ignore' },
)

let ws
try {
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

  const URL_HOME = `${BASE}/viewer.html?snapshot=${encodeURIComponent(SNAPSHOT_PATH)}#/`
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true })
  await cdp.send('Page.navigate', { url: URL_HOME })
  await sleep(3200)

  const home = await cdp.evaluate(`(() => {
    const text = document.body.innerText;
    const imgs = [...document.images];
    return {
      badgePublished: text.includes('已发布'),
      badgeSample: text.includes('示例数据'),
      mismatch: text.includes('清单与内容数量不一致'),
      footer: (text.match(/发布版本[^\\n]*/) || [''])[0],
      imgTotal: imgs.length,
      imgLoaded: imgs.filter(i => i.complete && i.naturalWidth > 0).length,
      imgBroken: imgs.filter(i => i.complete && i.naturalWidth === 0).length,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      nodes: [...document.querySelectorAll('[data-testid="universe"] button[aria-label]')]
        .filter(b => /共 |暂无内容/.test(b.getAttribute('aria-label'))).length,
      hasSceneSwitch: text.includes('演示场景'),
      title: document.title,
    };
  })()`)

  if (!home.badgePublished) problems.push('未识别为已发布快照（缺少「已发布」标记）')
  if (home.badgeSample) problems.push('真实快照页面仍显示「示例数据」标记')
  if (home.mismatch) problems.push('页面提示清单与内容数量不一致')
  if (home.imgBroken > 0) problems.push(`${home.imgBroken} 张图片加载失败`)
  if (home.imgTotal > 0 && home.imgLoaded === 0) problems.push('所有图片都未加载')
  if (home.overflow > 1) problems.push(`手机端横向溢出 ${home.overflow}px`)
  if (home.hasSceneSwitch) problems.push('真实快照页面仍暴露示例场景切换')
  if (home.nodes !== 5) problems.push(`宇宙节点 ${home.nodes} 个，预期 5`)

  // 页脚记录数与清单核对
  const expectEntries = manifest.counts.entries
  const expectPhotos = manifest.counts.photos
  if (!home.footer.includes(`记录 ${expectEntries}`) && !home.footer.includes(`记录 ${expectEntries} `)) {
    // footer 文案形如「记录 34 · 照片 104」
    const m = home.footer.match(/记录\s*(\d+)/)
    if (!m || Number(m[1]) !== expectEntries) problems.push(`页脚记录数与清单不一致：${home.footer}`)
  }
  const mp = home.footer.match(/照片\s*(\d+)/)
  if (!mp || Number(mp[1]) !== expectPhotos) problems.push(`页脚照片数与清单不一致：${home.footer}`)

  notes.push(`首页：图片 ${home.imgLoaded}/${home.imgTotal} 已加载，节点 ${home.nodes} 个，溢出 ${home.overflow}px`)
  notes.push(`页脚：${home.footer.trim()}`)
  await cdp.shot('30-real-home-mobile.png')

  // 相册：缩略图与真实大图
  await cdp.send('Page.navigate', { url: `${BASE}/viewer.html?snapshot=${encodeURIComponent(SNAPSHOT_PATH)}#/album` })
  await sleep(2600)
  const album = await cdp.evaluate(`(() => {
    const imgs = [...document.images];
    const tile = document.querySelector('button[aria-label^="查看照片"]');
    if (tile) tile.click();
    return {
      tiles: document.querySelectorAll('button[aria-label^="查看照片"]').length,
      imgTotal: imgs.length,
      imgLoaded: imgs.filter(i => i.complete && i.naturalWidth > 0).length,
      imgBroken: imgs.filter(i => i.complete && i.naturalWidth === 0).length,
    };
  })()`)
  await sleep(900)
  const box = await cdp.evaluate(`(() => {
    const d = document.querySelector('[role="dialog"]');
    if (!d) return { open: false };
    const img = d.querySelector('img');
    return { open: true, loaded: !!img && img.complete && img.naturalWidth > 0 };
  })()`)
  if (album.tiles < 10) problems.push(`相册只渲染 ${album.tiles} 张缩略图，预期至少 10 张`)
  if (album.imgBroken > 0) problems.push(`相册有 ${album.imgBroken} 张缩略图加载失败`)
  if (!box.open) problems.push('相册大图未打开')
  if (box.open && !box.loaded) problems.push('相册大图未成功解码')
  notes.push(`相册：${album.tiles} 个缩略图，${album.imgLoaded}/${album.imgTotal} 已加载；大图 ${box.open ? '已打开' : '未打开'}${box.open && box.loaded ? '且解码成功' : ''}`)
  await cdp.shot('31-real-album-mobile.png')

  // 故事与详情
  await cdp.send('Page.navigate', { url: `${BASE}/viewer.html?snapshot=${encodeURIComponent(SNAPSHOT_PATH)}#/stories` })
  await sleep(2400)
  const stories = await cdp.evaluate(`(() => ({
    cards: document.querySelectorAll('a[href*="/stories/"]').length,
    months: document.querySelectorAll('h2, h3').length,
    text: document.body.innerText.length,
  }))()`)
  if (stories.cards < 10) problems.push(`故事列表只有 ${stories.cards} 条，预期至少 10 条`)
  notes.push(`故事：${stories.cards} 条卡片，正文长度 ${stories.text}`)
  await cdp.shot('32-real-stories-mobile.png')

  const firstHref = await cdp.evaluate(`(() => {
    const a = document.querySelector('a[href*="/stories/"]');
    return a ? a.getAttribute('href') : '';
  })()`)
  if (firstHref) {
    await cdp.send('Page.navigate', { url: `${BASE}/viewer.html?snapshot=${encodeURIComponent(SNAPSHOT_PATH)}${firstHref.replace(/^.*#/, '#')}` })
    await sleep(2200)
    const detail = await cdp.evaluate(`(() => {
      const imgs = [...document.images];
      return {
        hasBack: !!document.querySelector('a[href*="/stories"]'),
        imgTotal: imgs.length,
        imgBroken: imgs.filter(i => i.complete && i.naturalWidth === 0).length,
        hasNav: document.body.innerText.includes('上一条') || document.body.innerText.includes('下一条'),
      };
    })()`)
    if (detail.imgBroken > 0) problems.push(`记录详情有 ${detail.imgBroken} 张图片加载失败`)
    notes.push(`记录详情：图片 ${detail.imgTotal} 张，失败 ${detail.imgBroken}，上下条 ${detail.hasNav}`)
    await cdp.shot('33-real-detail-mobile.png')
  } else {
    problems.push('故事列表没有可进入的详情链接')
  }

  // 桌面宽屏
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
  await cdp.send('Page.navigate', { url: URL_HOME })
  await sleep(2800)
  const desktop = await cdp.evaluate(`(() => {
    const imgs = [...document.images];
    return {
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      imgBroken: imgs.filter(i => i.complete && i.naturalWidth === 0).length,
      nodes: [...document.querySelectorAll('[data-testid="universe"] button[aria-label]')]
        .filter(b => /共 |暂无内容/.test(b.getAttribute('aria-label'))).length,
    };
  })()`)
  if (desktop.overflow > 1) problems.push(`桌面端横向溢出 ${desktop.overflow}px`)
  if (desktop.imgBroken > 0) problems.push(`桌面端有 ${desktop.imgBroken} 张图片加载失败`)
  await cdp.shot('34-real-home-desktop.png')
  notes.push(`桌面：节点 ${desktop.nodes} 个，溢出 ${desktop.overflow}px`)

  if (cdp.logs.length) problems.push(`控制台错误：${cdp.logs.slice(0, 3).join(' | ')}`)
  const realFailed = cdp.failed.filter((f) => !f.includes('favicon'))
  if (realFailed.length) problems.push(`资源加载失败：${realFailed.slice(0, 3).join(' | ')}`)
} finally {
  try {
    ws?.close()
  } catch {}
  chrome.kill()
}

console.log(`快照：${manifest.publishId} · 清单 ${manifest.counts.entries} 条记录 / ${manifest.counts.photos} 张照片`)
for (const n of notes) console.log(`· ${n}`)

console.log('\n—— 结果 ——')
if (problems.length) {
  console.error('✗ 真实快照校验失败：')
  for (const p of problems) console.error(`  - ${p}`)
  process.exit(1)
}
console.log('✓ 真实公开快照可用：标记正确、图片全部解码、计数与清单一致、无控制台错误、两端无横向溢出。')
console.log(`截图：${OUT}`)
