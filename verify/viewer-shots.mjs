/**
 * 展示端截图与冒烟检查（Chrome CDP，无第三方依赖）
 *
 * 用法：
 *   1) npm run dev
 *   2) node verify/viewer-shots.mjs
 *
 * 产物写入 verify/_artifacts/viewer/（已在 .gitignore 中忽略）。
 * 只读取合成数据场景，不接触任何真实记录。
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const BASE = process.env.HL_BASE || 'http://127.0.0.1:5288'
const PORT = 9412
const OUT = resolve(__dirname, '_artifacts/viewer')
mkdirSync(OUT, { recursive: true })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

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

async function httpJson(path, method = 'GET') {
  const res = await fetch(`http://127.0.0.1:${PORT}${path}`, { method })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

class CDP {
  constructor(ws) {
    this.ws = ws
    this.id = 0
    this.pending = new Map()
    this.logs = []
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
  async shot(file, beyond = true) {
    const r = await this.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: beyond })
    writeFileSync(join(OUT, file), Buffer.from(r.data, 'base64'))
  }
}

const SHOTS = [
  { file: '01-home-mobile.png', path: '/viewer.html#/', vp: [390, 844, 2] },
  { file: '02-home-mobile-fold.png', path: '/viewer.html#/', vp: [390, 844, 1], viewportOnly: true },
  { file: '03-stories-mobile.png', path: '/viewer.html#/stories', vp: [390, 844, 1], viewportOnly: true },
  { file: '04-detail-mobile.png', path: '/viewer.html#/stories/e_01', vp: [390, 844, 1], viewportOnly: true },
  { file: '05-album-mobile.png', path: '/viewer.html#/album', vp: [390, 844, 1], viewportOnly: true },
  { file: '06-archive-mobile.png', path: '/viewer.html#/archive?tab=portrait', vp: [390, 844, 1], viewportOnly: true },
  { file: '07-preview-mobile.png', path: '/viewer.html?mode=preview#/', vp: [390, 844, 1], viewportOnly: true },
  { file: '08-home-narrow.png', path: '/viewer.html#/', vp: [320, 740, 1], viewportOnly: true },
  { file: '09-home-empty.png', path: '/viewer.html?scene=empty#/', vp: [390, 844, 1], viewportOnly: true },
  { file: '10-home-desktop.png', path: '/viewer.html#/', vp: [1440, 900, 1], viewportOnly: true },
  { file: '11-album-desktop.png', path: '/viewer.html#/album', vp: [1440, 900, 1], viewportOnly: true },
  { file: '12-stories-desktop.png', path: '/viewer.html#/stories', vp: [1440, 900, 1], viewportOnly: true },
  { file: '16-home-full.png', path: '/viewer.html#/', vp: [390, 844, 2] },
  { file: '18-home-long-text.png', path: '/viewer.html?scene=long#/', vp: [320, 740, 1], viewportOnly: true },
  { file: '19-home-text-zoom.png', path: '/viewer.html#/', vp: [195, 422, 2], zoom200: true, viewportOnly: true },
  { file: '20-stories-text-zoom.png', path: '/viewer.html#/stories', vp: [195, 422, 2], zoom200: true, viewportOnly: true },
]

const userDataDir = mkdtempSync(join(tmpdir(), 'hl-viewer-'))
const chrome = spawn(
  detectChrome(),
  [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--no-first-run',
    '--disable-dev-shm-usage',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${userDataDir}`,
    '--hide-scrollbars',
    'about:blank',
  ],
  { stdio: 'ignore' },
)

const problems = []
let cdp
let ws

try {
  for (let i = 0; i < 60; i++) {
    try {
      await httpJson('/json/version')
      break
    } catch {
      await sleep(300)
    }
  }

  const target = await httpJson(`/json/new?${encodeURIComponent('about:blank')}`, 'PUT')
  ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true })
    ws.addEventListener('error', rej, { once: true })
  })
  cdp = new CDP(ws)
  await cdp.send('Runtime.enable')
  await cdp.send('Page.enable')

  for (const s of SHOTS) {
    const [w, h, dpr] = s.vp
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: w,
      height: h,
      deviceScaleFactor: dpr,
      mobile: w < 700,
    })
    await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 1 })
    await cdp.send('Page.navigate', { url: `${BASE}${s.path}` })
    await sleep(s.path.includes('stress') ? 3500 : 1800)

    const info = await cdp.evaluate(`(() => {
      const de = document.documentElement;
      const overflow = de.scrollWidth - de.clientWidth;
      return {
        text: document.body.innerText.slice(0, 400),
        overflow,
        height: de.scrollHeight,
        nodes: document.querySelectorAll('[data-testid="universe"] button').length,
        compact: (() => { const el = document.querySelector('.v-universe-compact'); return el ? getComputedStyle(el).display : 'missing'; })(),
      }
    })()`)
    if (info.overflow > 1) problems.push(`${s.file}: 横向溢出 ${info.overflow}px`)
    if (!info.text || info.text.length < 20) problems.push(`${s.file}: 页面几乎没有渲染内容`)
    if (s.zoom200 && s.path.includes('#/') && !s.path.includes('stories') && info.compact !== 'block') {
      problems.push(`${s.file}: 200% 缩放下未切换为静态宇宙分组入口`)
    }

    if (s.viewportOnly) {
      await cdp.shot(s.file, false)
    } else {
      // 先滚到底触发懒加载，再回到顶部截整页
      await cdp.evaluate('window.scrollTo(0, document.body.scrollHeight)')
      await sleep(600)
      await cdp.evaluate('window.scrollTo(0, 0)')
      await sleep(400)
      await cdp.shot(s.file)
    }
    console.log(`✓ ${s.file}  (${s.zoom200 ? `200% 页面缩放等效 ${w}×${h} CSS px / DPR ${dpr}` : `viewport ${w}×${h}`}${s.viewportOnly ? ' 首屏' : ' 整页'})`)
  }

  // 交互冒烟：键盘打开节点面板 → Esc 关闭 → 焦点回到节点
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
  await cdp.send('Page.navigate', { url: `${BASE}/viewer.html#/` })
  await sleep(1800)

  await cdp.evaluate(`(() => {
    const btn = [...document.querySelectorAll('[data-testid="universe"] button')].find(b => (b.getAttribute('aria-label')||'').startsWith('照片'));
    btn?.focus();
    return !!btn;
  })()`)
  for (const type of ['keyDown', 'keyUp']) {
    await cdp.send('Input.dispatchKeyEvent', {
      type,
      key: 'Enter',
      code: 'Enter',
      text: type === 'keyDown' ? '\r' : undefined,
      unmodifiedText: type === 'keyDown' ? '\r' : undefined,
      windowsVirtualKeyCode: 13,
      nativeVirtualKeyCode: 13,
    })
  }
  await sleep(600)
  const panelText = await cdp.evaluate(`(() => {
    const d = document.querySelector('[role="dialog"]');
    return d ? d.innerText.split(String.fromCharCode(10)).join(' / ').slice(0, 120) : 'no-dialog';
  })()`)
  if (!panelText.includes('照片')) problems.push('键盘无法打开宇宙节点预览面板')
  await cdp.shot('13-node-panel-mobile.png', false)

  for (const type of ['keyDown', 'keyUp']) {
    await cdp.send('Input.dispatchKeyEvent', { type, key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 })
  }
  await sleep(400)
  const afterEsc = await cdp.evaluate(`(() => ({
    closed: !document.querySelector('[role="dialog"]'),
    focus: (document.activeElement?.getAttribute('aria-label') || '').slice(0, 12),
  }))()`)
  if (!afterEsc.closed) problems.push('Esc 未关闭节点预览面板')
  if (!afterEsc.focus.startsWith('照片')) problems.push(`关闭后焦点未回到触发节点（当前：${afterEsc.focus}）`)

  // 减少动态效果：装饰动画应当停止
  await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
  await sleep(300)
  const motion = await cdp.evaluate(`(() => {
    const el = document.querySelector('.v-orbit-spin');
    return el ? getComputedStyle(el).animationName : 'missing';
  })()`)
  if (motion !== 'none') problems.push(`减少动态效果下轨道动画仍为 ${motion}`)
  await cdp.send('Emulation.setEmulatedMedia', { features: [] })

  // 手动暂停按钮
  const paused = await cdp.evaluate(`(() => {
    const btn = [...document.querySelectorAll('button')].find(b => b.getAttribute('aria-pressed') !== null);
    if (!btn) return 'no-toggle';
    btn.click();
    return 'clicked';
  })()`)
  await sleep(400)
  const pressed = await cdp.evaluate(`(() => {
    const btn = [...document.querySelectorAll('button')].find(b => b.getAttribute('aria-pressed') !== null);
    return btn ? btn.getAttribute('aria-pressed') : 'no-toggle';
  })()`)
  const pausedState = await cdp.evaluate(`(() => {
    const el = document.querySelector('.v-universe');
    const spin = document.querySelector('.v-orbit-spin');
    return JSON.stringify({ cls: el?.className.includes('v-motion-paused') ?? null, state: spin ? getComputedStyle(spin).animationPlayState : 'missing' });
  })()`)
  if (pressed !== 'true' || !pausedState.includes('"state":"paused"')) {
    problems.push(`暂停动效未生效：aria-pressed=${pressed} / ${pausedState}`)
  }

  console.log(`节点面板：${panelText.slice(0, 70)}`)
  console.log(`键盘可访问：Esc 关闭=${afterEsc.closed}，焦点回到「${afterEsc.focus}」`)
  console.log(`减少动态效果：animationName=${motion}；手动暂停：aria-pressed=${pressed}，${pausedState}`)

  // 空态：不得出现伪造记录，应有明确空状态
  await cdp.send('Page.navigate', { url: `${BASE}/viewer.html?scene=empty#/` })
  await sleep(1600)
  const emptyText = await cdp.evaluate('document.body.innerText')
  if (!emptyText.includes('还没有已发布的记录')) problems.push('空态首页缺少记录空状态')
  if (!emptyText.includes('还没有照片')) problems.push('空态首页缺少照片空状态')
  if (emptyText.includes('16 张') || emptyText.includes('18 条记录')) problems.push('空态下仍出现非空计数')
  await cdp.shot('14-home-empty-full.png')

  // 压力数据：分页与分批加载
  await cdp.send('Page.navigate', { url: `${BASE}/viewer.html?scene=stress#/stories` })
  await sleep(3500)
  const stress = await cdp.evaluate(`(() => {
    const before = document.querySelectorAll('a[href*="/stories/se_"]').length;
    const btn = [...document.querySelectorAll('button')].find(b => b.innerText.includes('加载更多'));
    btn?.click();
    return { before, hasMore: !!btn };
  })()`)
  await sleep(600)
  const stressAfter = await cdp.evaluate(`(() => ({
    after: document.querySelectorAll('a[href*="/stories/se_"]').length,
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  }))()`)
  if (!stress.hasMore) problems.push('压力数据下没有出现「加载更多」')
  if (stressAfter.after <= stress.before) problems.push('点击「加载更多」后列表未增加')
  if (stressAfter.overflow > 1) problems.push(`压力数据下横向溢出 ${stressAfter.overflow}px`)
  console.log(`压力数据：首批 ${stress.before} 条 → 加载更多后 ${stressAfter.after} 条`)

  // 图片失败：保留尺寸与说明，并提供重试
  await cdp.send('Page.navigate', { url: `${BASE}/viewer.html?scene=broken#/album` })
  await sleep(1800)
  const broken = await cdp.evaluate(`(() => {
    const failed = [...document.querySelectorAll('button')].filter(b => b.innerText.includes('加载失败'));
    const first = failed[0];
    if (first) first.click();
    return { count: failed.length, label: first ? first.getAttribute('aria-label') : '' };
  })()`)
  if (broken.count === 0) problems.push('图片失败时没有出现失败占位与重试入口')
  await sleep(400)
  await cdp.shot('15-album-broken-image.png', false)
  console.log(`图片失败：${broken.count} 张显示失败占位（${broken.label}）`)

  // 相册大图：打开、左右切换、Esc 关闭
  await cdp.send('Page.navigate', { url: `${BASE}/viewer.html#/album` })
  await sleep(1600)
  const box = await cdp.evaluate(`(() => {
    const tile = [...document.querySelectorAll('button[aria-label^="查看照片"]')][0];
    if (!tile) return 'no-tile';
    tile.click();
    return 'clicked';
  })()`)
  await sleep(500)
  const boxOpen = await cdp.evaluate(`(() => {
    const d = document.querySelector('[role="dialog"]');
    return d ? d.innerText.split(String.fromCharCode(10))[0] : 'no-dialog';
  })()`)
  for (const type of ['keyDown', 'keyUp']) {
    await cdp.send('Input.dispatchKeyEvent', {
      type,
      key: 'ArrowRight',
      code: 'ArrowRight',
      windowsVirtualKeyCode: 39,
      nativeVirtualKeyCode: 39,
    })
  }
  await sleep(300)
  const boxNext = await cdp.evaluate(`(() => {
    const d = document.querySelector('[role="dialog"]');
    return d ? d.innerText.split(String.fromCharCode(10))[0] : 'no-dialog';
  })()`)
  await cdp.shot('17-lightbox-mobile.png', false)
  for (const type of ['keyDown', 'keyUp']) {
    await cdp.send('Input.dispatchKeyEvent', { type, key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 })
  }
  await sleep(300)
  const boxClosed = await cdp.evaluate(`!document.querySelector('[role="dialog"]')`)
  if (box !== 'clicked' || !boxOpen.includes('/')) problems.push('相册大图未打开')
  if (boxNext === boxOpen) problems.push('大图左右切换无效')
  if (!boxClosed) problems.push('Esc 未关闭大图')
  console.log(`相册大图：${boxOpen.replace(/\s+/g, ' ')} → →  ${boxNext.replace(/\s+/g, ' ')} → Esc 关闭 ${boxClosed}`)

  if (cdp.logs.length) problems.push(`控制台错误 ${cdp.logs.length} 条: ${cdp.logs.slice(0, 3).join(' | ')}`)
} finally {
  if (cdp) {
    try {
      await cdp.send('Browser.close')
    } catch {
      /* ignore */
    }
  }
  ws?.close?.()
  chrome.kill()
}

console.log('\n—— 结果 ——')
if (problems.length) {
  console.log('发现问题：')
  for (const p of problems) console.log(`  ! ${p}`)
  process.exitCode = 1
} else {
  console.log('全部截图生成，无横向溢出、无控制台错误。')
}
console.log(`产物目录：${OUT}`)
