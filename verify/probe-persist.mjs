/**
 * 定位「刷新后数据丢失」：是应用 bug 还是测试环境（headless 临时 profile）问题
 *
 * 用法：先 npm run dev，再 node verify/probe-persist.mjs
 * 环境变量：HL_BASE / HL_CHROME 同 verify-e2e.mjs
 */
import { spawn } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

function detectChrome() {
  const candidates = [
    process.env.HL_CHROME,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe'),
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ].filter(Boolean)
  return candidates.find((p) => existsSync(p)) || candidates[1]
}

const BASE = process.env.HL_BASE || 'http://127.0.0.1:5288'
const CHROME = detectChrome()
const PORT = 9412
const PROFILE = resolve(__dirname, '_artifacts/chrome-profile')
rmSync(PROFILE, { recursive: true, force: true })
mkdirSync(PROFILE, { recursive: true })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const log = (...a) => console.log(...a)

let id = 0
const pending = new Map()
let ws

function send(method, params = {}) {
  const mid = ++id
  return new Promise((resolve, reject) => {
    pending.set(mid, { resolve, reject })
    ws.send(JSON.stringify({ id: mid, method, params }))
    setTimeout(() => pending.has(mid) && (pending.delete(mid), reject(new Error('timeout ' + method))), 30000)
  })
}

async function evaluate(expression) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: true })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description)
  return r.result?.value
}

/** 用原生 IndexedDB API 直接读，绕开 Dexie，判断数据是否真的落盘 */
const RAW_READ = `
(async () => {
  const list = await indexedDB.databases();
  const names = list.map(d => d.name + ':' + d.version);
  const open = (name) => new Promise((res, rej) => {
    const r = indexedDB.open(name);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  if (!names.some(n => n.startsWith('heartlog'))) return { names, persons: -1, entries: -1 };
  const db = await open('heartlog');
  const count = (store) => new Promise((res, rej) => {
    if (!db.objectStoreNames.contains(store)) return res(-1);
    const tx = db.transaction(store, 'readonly');
    const rq = tx.objectStore(store).count();
    rq.onsuccess = () => res(rq.result);
    rq.onerror = () => rej(rq.error);
  });
  const out = { names, persons: await count('persons'), entries: await count('entries'), photos: await count('photos') };
  db.close();
  return out;
})()
`

const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--no-first-run',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${PROFILE}`,
    '--window-size=430,900',
    'about:blank',
  ],
  { stdio: 'ignore' },
)

try {
  for (let i = 0; i < 60; i++) {
    try {
      await fetch(`http://127.0.0.1:${PORT}/json/version`)
      break
    } catch {
      await sleep(300)
    }
  }
  const t = await (await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(BASE + '/#/today')}`, { method: 'PUT' })).json()
  ws = new WebSocket(t.webSocketDebuggerUrl)
  await new Promise((res) => ws.addEventListener('open', res, { once: true }))
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data)
    if (m.id && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id)
      pending.delete(m.id)
      m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result)
    }
  })
  await send('Runtime.enable')
  await send('Page.enable')
  await send('Page.navigate', { url: BASE + '/#/today' })
  await sleep(4000)

  log('--- 初始 ---')
  log('页面文本片段:', (await evaluate('document.body.innerText')).slice(0, 40).replace(/\n/g, ' | '))
  log('原始 IDB:', JSON.stringify(await evaluate(RAW_READ)))

  // 通过 UI 创建一条记录
  await evaluate(`
    (() => {
      const el = document.querySelector('input[placeholder="一句话记下今天的事…"]');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,'持久化探针记录');
      el.dispatchEvent(new Event('input',{bubbles:true}));
      document.querySelector('button[aria-label="保存"]').click();
      return true;
    })()`)
  await sleep(2000)
  log('--- 保存后 ---')
  log('页面含探针:', (await evaluate('document.body.innerText')).includes('持久化探针记录'))
  log('原始 IDB:', JSON.stringify(await evaluate(RAW_READ)))

  // 方式 A：Page.navigate 重新导航
  await send('Page.navigate', { url: BASE + '/#/today' })
  await sleep(4000)
  log('--- Page.navigate 之后 ---')
  log('页面含探针:', (await evaluate('document.body.innerText')).includes('持久化探针记录'))
  log('原始 IDB:', JSON.stringify(await evaluate(RAW_READ)))

  // 方式 B：Page.reload
  await send('Page.reload', {})
  await sleep(4000)
  log('--- Page.reload 之后 ---')
  log('页面含探针:', (await evaluate('document.body.innerText')).includes('持久化探针记录'))
  log('原始 IDB:', JSON.stringify(await evaluate(RAW_READ)))

  writeFileSync(resolve(__dirname, '_artifacts/probe.txt'), 'done')
} catch (e) {
  console.error('probe 异常:', e.message)
} finally {
  try { ws?.close() } catch {}
  chrome.kill()
  await sleep(800)
  process.exit(0)
}
