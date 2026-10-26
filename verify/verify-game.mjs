/**
 * T6 记忆配对离线验证。
 *
 * 用法：node verify/verify-game.mjs（需先 npm run dev）
 *
 * 两段：
 * A. 纯逻辑（`verify/game-selftest.html`）：选牌/洗牌/组牌/成绩；
 * B. 真浏览器（sample 场景，不碰任何真实数据）：入口可见性、翻牌、配对、失配回翻、
 *    重新开始、完整通关、成绩落 localStorage、**不建 IndexedDB、不发写请求**。
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const BASE = process.env.HL_BASE || 'http://127.0.0.1:5288'
const OUT = join(ROOT, 'verify/_artifacts/game')
const PORT = 9433
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
    this.writes = []
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
      if (m.method === 'Network.requestWillBeSent') {
        const req = m.params?.request
        if (req && req.method && req.method !== 'GET') this.writes.push(`${req.method} ${req.url}`)
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

/* ---------------- 静态边界：小游戏代码不得带进数据库 ---------------- */
const gameSrc = readFileSync(join(ROOT, 'src/viewer/pages/Game.tsx'), 'utf8')
const memSrc = readFileSync(join(ROOT, 'src/viewer/game/memory.ts'), 'utf8')
const shellSrc = readFileSync(join(ROOT, 'src/viewer/components/Shell.tsx'), 'utf8')
for (const [file, src] of [
  ['Game.tsx', gameSrc],
  ['memory.ts', memSrc],
]) {
  if (/from '\..*\/db\/db'|dexie|from '\..*\/tasks|from '\..*\/memoir|lib\/sync/.test(src)) {
    problems.push(`${file} 引入了数据库/私有模块，访客端会被迫下载 Dexie`)
  }
  if (/fetch\(|XMLHttpRequest|navigator\.sendBeacon/.test(src)) {
    problems.push(`${file} 里出现了网络写入调用，T6 不允许访客操作上报`)
  }
}
if (!/navWithGame/.test(shellSrc)) problems.push('Shell 没有使用 navWithGame 控制入口可见性')

const profile = mkdtempSync(join(tmpdir(), 'hl-game-'))
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
  let up = false
  for (let i = 0; i < 60; i++) {
    try {
      await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json()
      up = true
      break
    } catch {
      await sleep(300)
    }
  }
  if (!up) throw new Error('Chrome 未启动')

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

  /* ---------- A. 纯逻辑 ---------- */
  await cdp.send('Page.navigate', { url: `${BASE}/verify/game-selftest.html` })
  let unit = null
  for (let i = 0; i < 60; i++) {
    await sleep(300)
    unit = await cdp.evaluate('window.__gameselftest || null')
    if (unit?.done) break
  }
  if (!unit?.done) problems.push('逻辑自测未跑完')
  else if (unit.fatal) problems.push(`逻辑自测致命错误：${unit.fatal.split('\n')[0]}`)
  else {
    for (const c of unit.checks) if (!c.pass) problems.push(`逻辑：${c.name}（${c.detail}）`)
    notes.push(`逻辑自测：${unit.total - unit.failed}/${unit.total} 通过`)
  }

  /* ---------- B. 真浏览器（sample 场景） ---------- */
  await cdp.send('Page.navigate', { url: `${BASE}/viewer.html?source=sample&scene=demo` })
  await sleep(2600)
  const navHasGame = await cdp.evaluate(`[...document.querySelectorAll('a')].some(a => a.innerText.trim() === '互动')`)
  if (!navHasGame) problems.push('样例快照里没有「互动」入口（配置未生效）')
  notes.push(`入口：样例场景可见=${navHasGame}`)

  await cdp.evaluate(`(() => {
    const link = [...document.querySelectorAll('a')].find(a => a.innerText.trim() === '互动');
    link?.click();
    return !!link;
  })()`)
  await sleep(1200)

  const board = await cdp.evaluate(`(() => {
    const cards = [...document.querySelectorAll('[data-card-key]')];
    return {
      count: cards.length,
      pairs: [...new Set(cards.map(c => c.dataset.photoId))].length,
      allHidden: cards.every(c => c.dataset.state === 'hidden'),
      stats: document.body.innerText.includes('步数 0'),
      hash: location.hash,
    };
  })()`)
  if (board.count !== 12 || board.pairs !== 6) problems.push(`牌面数量异常：${board.count} 张 / ${board.pairs} 对`)
  if (!board.allHidden) problems.push('开局存在已翻开的牌')
  if (!board.stats) problems.push('步数没有从 0 开始')
  notes.push(`牌面：${board.count} 张 / ${board.pairs} 对，全部背面，hash=${board.hash}`)
  await cdp.shot('01-game-board.png')

  const clickPair = async (photoId) => {
    const r = await cdp.evaluate(`(() => {
      const cards = [...document.querySelectorAll('[data-card-key]')].filter(c => c.dataset.photoId === ${JSON.stringify(photoId)} && c.dataset.state === 'hidden');
      if (cards.length < 2) return { ok: false, hidden: cards.length };
      cards[0].click();
      return { ok: true };
    })()`)
    if (!r.ok) return false
    await sleep(160)
    // 第二下必须点**另一张**背面牌：按 photoId + hidden 找，别把刚翻开的那张再点一次
    await cdp.evaluate(`(() => {
      const cards = [...document.querySelectorAll('[data-card-key]')].filter(c => c.dataset.photoId === ${JSON.stringify(photoId)} && c.dataset.state === 'hidden');
      cards[0]?.click();
      return !!cards[0];
    })()`)
    return true
  }

  const firstPhoto = await cdp.evaluate(`document.querySelector('[data-card-key]').dataset.photoId`)
  const matchedOk = await cdp.evaluate(`(async () => {
    const cards = [...document.querySelectorAll('[data-card-key]')].filter(c => c.dataset.photoId === ${JSON.stringify(firstPhoto)});
    cards[0].click();
    await new Promise(r => setTimeout(r, 200));
    const mid = cards[1] ? cards[1].dataset.state : null;
    cards[1].click();
    await new Promise(r => setTimeout(r, 600));
    const matched = document.querySelectorAll('[data-state="matched"]').length;
    return { mid, matched, text: document.body.innerText.includes('步数 1') };
  })()`)
  if (matchedOk.matched !== 2) problems.push(`配对成功后应有 2 张牌处于 matched，实际 ${matchedOk.matched}`)
  if (!matchedOk.text) problems.push('配对一次后步数不是 1')

  /* 失配：两张不同照片应当自动翻回，且不增加已配对数量 */
  const mismatch = await cdp.evaluate(`(async () => {
    const cards = [...document.querySelectorAll('[data-card-key]')].filter(c => c.dataset.state === 'hidden');
    const a = cards[0], b = cards.find(c => c.dataset.photoId !== cards[0].dataset.photoId);
    if (!a || !b) return { error: '没有可失配的牌' };
    a.click();
    await new Promise(r => setTimeout(r, 200));
    b.click();
    await new Promise(r => setTimeout(r, 1200));
    const flipped = document.querySelectorAll('[data-state="flipped"]').length;
    const matched = document.querySelectorAll('[data-state="matched"]').length;
    return { flipped, matched };
  })()`)
  if (mismatch.error) problems.push(`失配测试失败：${mismatch.error}`)
  else {
    if (mismatch.flipped !== 0) problems.push(`失配后应全部翻回，仍有 ${mismatch.flipped} 张翻开`)
    if (mismatch.matched !== 2) problems.push(`失配不应改变已配对数量（现为 ${mismatch.matched}）`)
  }
  notes.push(`配对/失配：matched=${matchedOk.matched}，失配后翻回=${mismatch.flipped === 0}`)

  /* 重新开始 */
  const restart = await cdp.evaluate(`(async () => {
    const btn = [...document.querySelectorAll('button')].find(b => b.innerText.includes('重新开始'));
    btn?.click();
    await new Promise(r => setTimeout(r, 500));
    return {
      ok: !!btn,
      matched: document.querySelectorAll('[data-state="matched"]').length,
      flipped: document.querySelectorAll('[data-state="flipped"]').length,
      zero: document.body.innerText.includes('步数 0'),
      cards: document.querySelectorAll('[data-card-key]').length,
    };
  })()`)
  if (!restart.ok) problems.push('没有「重新开始」按钮')
  if (restart.matched || restart.flipped || !restart.zero) {
    problems.push(`重新开始没有完全复位：matched=${restart.matched} flipped=${restart.flipped} 步数归零=${restart.zero}`)
  }
  if (restart.cards !== 12) problems.push(`重新开始后牌数变成 ${restart.cards}`)
  notes.push(`重新开始：复位=${restart.matched === 0 && restart.flipped === 0 && restart.zero}，仍是 ${restart.cards} 张`)

  /* 完整通关：逐个配对，验证通关提示与本地成绩 */
  const photoIds = await cdp.evaluate(`[...new Set([...document.querySelectorAll('[data-card-key]')].map(c => c.dataset.photoId))]`)
  for (const id of photoIds) {
    await clickPair(id)
    await sleep(420)
  }
  await sleep(800)
  const finished = await cdp.evaluate(`(() => {
    const text = document.body.innerText;
    const keys = Object.keys(localStorage).filter(k => k.startsWith('heartlog.game.memory.v1.'));
    const raw = keys.length ? localStorage.getItem(keys[0]) : null;
    return {
      matched: document.querySelectorAll('[data-state="matched"]').length,
      done: text.includes('全部配对完成') || text.includes('新纪录'),
      keys,
      record: raw ? JSON.parse(raw) : null,
    };
  })()`)
  if (finished.matched !== 12) problems.push(`通关后应有 12 张已配对，实际 ${finished.matched}`)
  if (!finished.done) problems.push('通关后没有显示完成提示')
  if (!finished.keys.length) problems.push('通关后没有写入本地成绩')
  else if (!finished.record || typeof finished.record.bestMoves !== 'number' || finished.record.clears < 1) {
    problems.push(`本地成绩内容异常：${JSON.stringify(finished.record)}`)
  }
  notes.push(`通关：${finished.matched}/12，成绩=${JSON.stringify(finished.record)}`)
  await cdp.shot('02-game-cleared.png')

  /* 每次进入换一组：刷新后照片集合应当变化（样例 17 张里取 6 张，重复概率约 1/12376） */
  const beforeSet = await cdp.evaluate(
    `[...new Set([...document.querySelectorAll('[data-card-key]')].map(c => c.dataset.photoId))].sort().join(',')`,
  )
  await cdp.send('Page.reload', { ignoreCache: true })
  await sleep(2600)
  const afterReload = await cdp.evaluate(`(() => {
    const cards = [...document.querySelectorAll('[data-card-key]')];
    return {
      count: cards.length,
      set: [...new Set(cards.map(c => c.dataset.photoId))].sort().join(','),
      hash: location.hash,
    };
  })()`)
  if (afterReload.count !== 12) problems.push(`刷新后牌数 ${afterReload.count}，应为 12`)
  if (afterReload.hash !== '#/game') problems.push(`刷新后跑到了 ${afterReload.hash}，应当仍在互动页`)
  if (afterReload.set === beforeSet) problems.push('刷新后仍是同一组照片，没有做到「每次进入换一组」')
  notes.push(`每次进入换一组：刷新前 ${beforeSet.split(',').length} 张 / 刷新后 ${afterReload.set.split(',').length} 张，是否换组=${afterReload.set !== beforeSet}`)
  await cdp.shot('03-game-second-visit.png')

  /* ---------- C. 访客边界：不建库、不发写请求 ---------- */
  const dbs = await cdp.evaluate(`(async () => { try { return (await indexedDB.databases()).length } catch { return -1 } })()`)
  if (dbs !== 0) problems.push(`小游戏页面创建了 ${dbs} 个 IndexedDB（应完全不用数据库）`)
  const lsKeys = await cdp.evaluate(`Object.keys(localStorage)`)
  // 展示端自己会写 `hl-viewer-paused`（暂停动画偏好），不算小游戏越界；
  // 这里只要求「没有出现业务数据/同步相关的键」
  const unexpected = lsKeys.filter((k) => !k.startsWith('heartlog.game.memory.v1.') && !k.startsWith('hl-'))
  if (unexpected.length) problems.push(`localStorage 出现预期之外的键：${unexpected.join(', ')}`)
  if (cdp.writes.length) problems.push(`页面发出了非 GET 请求：${cdp.writes.slice(0, 2).join(' | ')}`)
  notes.push(`边界：IndexedDB ${dbs} 个，localStorage 仅 ${lsKeys.length} 个游戏键，写请求 ${cdp.writes.length} 个`)

  if (cdp.logs.length) problems.push(`页面报错：${cdp.logs.slice(0, 2).join(' | ')}`)

  console.log('\n—— 记录 ——')
  for (const n of notes) console.log(`  · ${n}`)
  console.log('\n—— 结果 ——')
  if (problems.length) {
    console.log(`✗ ${problems.length} 个问题：`)
    for (const p of problems) console.log(`  · ${p}`)
    process.exitCode = 1
  } else {
    console.log('✓ T6 记忆配对通过：入口可控、翻牌/配对/失配/重开/通关正常，成绩只在本机，不建库不发写请求。')
  }
  console.log(`截图：${OUT}`)
} finally {
  try {
    chrome.kill()
  } catch {}
}
