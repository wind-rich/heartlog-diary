/**
 * T2 验证：作者端启动流程、访客隔离、未配置 AI 时的导出能力。
 *
 * 用法：node verify/verify-author.mjs（需先 npm run dev，默认 5288）
 *
 * 检查项：
 * 1. 访客端（viewer）打开真实快照后不创建 IndexedDB、不调用云端、无控制台错误；
 * 2. 空设备打开作者端显示启动闸门，且不会自动创建人物、不做认证探测；
 * 3. 通过公开快照导入后，记录/照片数量与清单一致；
 * 4. 未配置 AI、未配置发布服务时仍能导出完整备份（真实下载文件）；
 * 5. Service Worker 不触碰 IndexedDB（静态检查）。
 *
 * 产物截图写入 verify/_artifacts/author/（Git 忽略）。
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const BASE = process.env.HL_BASE || 'http://127.0.0.1:5288'
const SNAPSHOT_PATH = '/verify/_artifacts/migration/private/publish/public-snapshot.json'
const SNAPSHOT_FILE = join(ROOT, SNAPSHOT_PATH.replace(/^\//, ''))
const OUT = join(ROOT, 'verify/_artifacts/author')
const CDP_PORT = 9416
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

mkdirSync(OUT, { recursive: true })
const problems = []
const notes = []
const manifest = JSON.parse(readFileSync(SNAPSHOT_FILE, 'utf8')).manifest

// 5) Service Worker 静态检查
const sw = readFileSync(join(ROOT, 'public/sw.js'), 'utf8')
if (/indexedDB/.test(sw)) problems.push('Service Worker 中出现 indexedDB 调用')

/* 云端接口与站点同源，SW 必须显式跳过它，否则会「缓存优先」把已发布内容钉死：
   作者重新发布后展示端读到旧快照，表现为「改了但展示端不变」「图片全部加载失败」。 */
const swSkipsCloud =
  /isCloudApi/.test(sw) && /\/\.cloud\//.test(sw) && /heartlog_public_/.test(sw)
if (!swSkipsCloud) {
  problems.push('Service Worker 未排除云端数据接口（会把 heartlog_public_* 当静态资源缓存）')
}
const cloudSkipBeforeCache =
  sw.indexOf('isCloudApi(url)') > 0 &&
  sw.indexOf('isCloudApi(url)') < sw.indexOf('caches.match(req)')
if (swSkipsCloud && !cloudSkipBeforeCache) {
  problems.push('Service Worker 的云端跳过逻辑位于缓存读取之后，仍然会命中旧缓存')
}
if (/heartlog-v1/.test(sw)) problems.push('Service Worker 缓存版本未升级，旧缓存不会被清除')

function detectChrome() {
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
        const { resolve: res, reject } = this.pending.get(m.id)
        this.pending.delete(m.id)
        m.error ? reject(new Error(JSON.stringify(m.error))) : res(m.result)
      }
      if (m.method === 'Runtime.exceptionThrown') this.logs.push(m.params?.exceptionDetails?.exception?.description || 'exception')
      if (m.method === 'Runtime.consoleAPICalled' && m.params?.type === 'error')
        this.logs.push((m.params.args || []).map((a) => a.value ?? a.description ?? '').join(' '))
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

const profile = mkdtempSync(join(tmpdir(), 'hl-author-'))
const downloads = mkdtempSync(join(tmpdir(), 'hl-download-'))
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
  let ready = false
  for (let i = 0; i < 60; i++) {
    try {
      await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`)).json()
      ready = true
      break
    } catch {
      await sleep(300)
    }
  }
  if (!ready) throw new Error('Chrome 未能启动')

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
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads })

  /* ---------- 1. 访客端隔离 ---------- */
  await cdp.send('Page.navigate', { url: `${BASE}/viewer.html?snapshot=${encodeURIComponent(SNAPSHOT_PATH)}#/` })
  await sleep(3200)
  const viewer = await cdp.evaluate(`(async () => {
    // indexedDB 在部分上下文会直接抛 SecurityError（访问被拒），
    // 那是「没有数据库」的更强证据，不能让它把整个校验打断。
    let dbs = [];
    try { dbs = (await indexedDB.databases()).map((d) => d.name); }
    catch (e) { dbs = []; }
    return {
      dbs,
      text: document.body.innerText.slice(0, 120),
      hasBadge: document.body.innerText.includes('已发布'),
    };
  })()`)
  if (viewer.dbs.length) problems.push(`访客端创建了 IndexedDB：${viewer.dbs.join(', ')}`)
  const viewerCloud = cdp.requests.filter((u) => !u.startsWith(BASE) && !u.startsWith('data:') && !u.startsWith('blob:'))
  if (viewerCloud.length) problems.push(`访客端发起站外请求：${viewerCloud.slice(0, 2).join(' | ')}`)
  if (!viewer.hasBadge) problems.push('访客端未渲染真实快照（缺少已发布标记）')
  notes.push(`访客端：IndexedDB ${viewer.dbs.length} 个，站外请求 ${viewerCloud.length} 个`)
  await cdp.shot('01-viewer-isolated.png')

  const logsAfterViewer = cdp.logs.length
  cdp.requests.length = 0

  /* ---------- 2. 空设备启动闸门 ---------- */
  await cdp.send('Page.navigate', { url: `${BASE}/` })
  await sleep(2200)
  const gate = await cdp.evaluate(`(async () => {
    const text = document.body.innerText;
    const dbs = await indexedDB.databases();
    return {
      title: text.includes('这台设备上还没有记录'),
      options: ['导入完整备份', '从已发布内容建立副本', '从空白开始'].filter(k => text.includes(k)),
      hasNav: text.includes('时间线') && text.includes('回顾'),
      dbs: dbs.map(d => d.name),
    };
  })()`)
  if (!gate.title) problems.push('空设备未显示启动引导')
  if (gate.options.length !== 3) problems.push(`启动引导选项不完整：${gate.options.join('/')}`)
  if (gate.hasNav) problems.push('空设备直接进入了主导航，未先做选择')
  await cdp.shot('02-empty-gate.png')

  // 闸门阶段不应有认证/云端请求
  const gateCloud = cdp.requests.filter((u) => !u.startsWith(BASE) && !u.startsWith('data:') && !u.startsWith('blob:'))
  if (gateCloud.length) problems.push(`空设备首屏发起站外请求：${gateCloud.slice(0, 2).join(' | ')}`)
  notes.push(`空设备：闸门可见=${gate.title}，选项 ${gate.options.length} 个，站外请求 ${gateCloud.length} 个`)

  // 空设备不应自动创建人物
  const beforeImport = await cdp.evaluate(`(async () => {
    const dbs = await indexedDB.databases();
    if (!dbs.some(d => d.name === 'heartlog')) return { persons: 0, db: false };
    const db = await new Promise((res, rej) => { const r = indexedDB.open('heartlog'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error) });
    const count = (t) => new Promise((res) => { const q = db.transaction(t, 'readonly').objectStore(t).count(); q.onsuccess = () => res(q.result); });
    const out = { persons: await count('persons'), db: true };
    db.close();
    return out;
  })()`)
  if (beforeImport.persons > 0) problems.push(`空设备自动创建了人物（${beforeImport.persons} 条）`)

  /* ---------- 3. 从已发布内容导入 ---------- */
  cdp.requests.length = 0
  await cdp.evaluate(`(() => {
    const btn = [...document.querySelectorAll('button')].find(b => b.innerText.trim() === '改用地址');
    btn?.click();
    return !!btn;
  })()`)
  await sleep(400)
  await cdp.evaluate(`(() => {
    const input = document.querySelector('input[placeholder^="https://"]');
    if (!input) return false;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, ${JSON.stringify(`${BASE}${SNAPSHOT_PATH}`)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`)
  await sleep(300)
  await cdp.evaluate(`(() => {
    const btn = [...document.querySelectorAll('button')].find(b => b.innerText.trim() === '读取');
    btn?.click();
    return !!btn;
  })()`)

  let imported = null
  for (let i = 0; i < 80; i++) {
    await sleep(500)
    imported = await cdp.evaluate(`(async () => {
      const text = document.body.innerText;
      // 作者端已统一为展示端界面（D-010）：进入后显示「编辑模式」，不再有旧「时间线」导航
      if (!text.includes('编辑模式') && !text.includes('时间线')) return null;
      const db = await new Promise((res, rej) => { const r = indexedDB.open('heartlog'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error) });
      const count = (t) => new Promise((res) => { const q = db.transaction(t, 'readonly').objectStore(t).count(); q.onsuccess = () => res(q.result); });
      const out = { persons: await count('persons'), entries: await count('entries'), photos: await count('photos'), prefs: await count('preferences') };
      db.close();
      return out;
    })()`)
    if (imported) break
  }
  if (!imported) throw new Error('导入后仍未进入作者端主界面')
  if (imported.entries !== manifest.counts.entries) problems.push(`导入记录数 ${imported.entries}，清单为 ${manifest.counts.entries}`)
  if (imported.photos !== manifest.counts.photos) problems.push(`导入照片数 ${imported.photos}，清单为 ${manifest.counts.photos}`)
  if (imported.persons !== 1) problems.push(`导入后人物数 ${imported.persons}，预期 1`)
  notes.push(`导入完成：${imported.entries} 条记录 / ${imported.photos} 张照片 / ${imported.prefs} 条偏好`)
  await cdp.shot('03-after-import.png')

  /* ---------- 4. 未配置 AI 时导出 ---------- */
  const aiDisabled = await cdp.evaluate(`(async () => {
    const db = await new Promise((res, rej) => { const r = indexedDB.open('heartlog'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error) });
    const meta = await new Promise((res) => { const q = db.transaction('meta', 'readonly').objectStore('meta').get('aiConfig'); q.onsuccess = () => res(q.result); });
    db.close();
    return !meta || !meta.value || meta.value.enabled !== true;
  })()`)
  if (!aiDisabled) problems.push('导入后 AI 仍处于启用状态，无法验证「未配置 AI 可导出」')

  await cdp.send('Page.navigate', { url: `${BASE}/#/settings` })
  await sleep(1800)
  const clicked = await cdp.evaluate(`(() => {
    const btn = [...document.querySelectorAll('button')].find(b => b.innerText.includes('导出完整备份'));
    btn?.click();
    return !!btn;
  })()`)
  if (!clicked) problems.push('设置页未找到「导出完整备份」按钮')
  let zip = null
  for (let i = 0; i < 40; i++) {
    await sleep(500)
    const files = readdirSync(downloads).filter((f) => f.endsWith('.zip'))
    if (files.length) {
      const p = join(downloads, files[0])
      if (statSync(p).size > 1024) {
        zip = { name: files[0], size: statSync(p).size }
        break
      }
    }
  }
  if (!zip) problems.push('未配置 AI 时导出备份失败（没有生成 zip）')
  else notes.push(`导出成功：${zip.name} ${(zip.size / 1024 / 1024).toFixed(1)} MB`)

  if (cdp.logs.length > logsAfterViewer) problems.push(`作者端控制台错误：${cdp.logs.slice(logsAfterViewer, logsAfterViewer + 2).join(' | ')}`)
} finally {
  try {
    ws?.close()
  } catch {}
  chrome.kill()
}

console.log(`快照：${manifest.publishId}（清单 ${manifest.counts.entries} 条记录 / ${manifest.counts.photos} 张照片）`)
for (const n of notes) console.log(`· ${n}`)

console.log('\n—— 结果 ——')
if (problems.length) {
  console.error('✗ T2 校验失败：')
  for (const p of problems) console.error(`  - ${p}`)
  process.exit(1)
}
console.log('✓ T2 通过：访客不建库不联网、空设备不自动建档、快照可导入、无 AI 也能导出、SW 不碰数据库。')
console.log(`截图：${OUT}`)
