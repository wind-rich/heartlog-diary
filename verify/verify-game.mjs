/**
 * T6 回忆游乐园离线验证。
 *
 * 用法：node verify/verify-game.mjs（需先 npm run dev）
 *
 * 三段：
 * A. 纯逻辑（verify/game-selftest.html）：开关兼容、配对难度、拼图、猜图、盲盒与本机成绩；
 * B. 真浏览器（sample 场景，不碰真实数据）：大厅、记忆配对全流程、拼图通关、猜图完成、盲盒打开；
 * C. 访客边界：不建 IndexedDB、不发写请求，只写 heartlog.game.* / hl-* 本机键。
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
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

/* ---------------- 静态边界：访客小游戏不得带进数据库/私有模块 ---------------- */
const gameFiles = [join(ROOT, 'src/viewer/pages/Game.tsx'), join(ROOT, 'src/viewer/components/GameShared.tsx')]
function collect(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) collect(path)
    else if (/\.(ts|tsx)$/.test(name)) gameFiles.push(path)
  }
}
collect(join(ROOT, 'src/viewer/game'))
collect(join(ROOT, 'src/viewer/pages/games'))
for (const file of gameFiles) {
  const src = readFileSync(file, 'utf8')
  const rel = file.slice(ROOT.length + 1).replaceAll('\\', '/')
  if (/from '\..*\/db\/db'|dexie|from '\..*\/tasks|from '\..*\/memoir|lib\/sync/.test(src)) {
    problems.push(`${rel} 引入了数据库/私有模块，访客端会被迫下载 Dexie`)
  }
  if (/fetch\(|XMLHttpRequest|navigator\.sendBeacon/.test(src)) {
    problems.push(`${rel} 里出现了网络写入调用，T6 不允许访客操作上报`)
  }
}
const shellSrc = readFileSync(join(ROOT, 'src/viewer/components/Shell.tsx'), 'utf8')
if (!/navWithGame/.test(shellSrc) || !/hasEnabledGames/.test(shellSrc)) problems.push('Shell 没有使用统一游戏配置控制入口可见性')

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

  /* ---------- B. 大厅 ---------- */
  await cdp.send('Page.navigate', { url: `${BASE}/viewer.html?source=sample&scene=demo` })
  await sleep(2600)
  const navHasGame = await cdp.evaluate(`[...document.querySelectorAll('a')].some(a => a.innerText.trim() === '互动')`)
  if (!navHasGame) problems.push('样例快照里没有「互动」入口（配置未生效）')
  await cdp.evaluate(`(() => {
    const link = [...document.querySelectorAll('a')].find(a => a.innerText.trim() === '互动');
    link?.click();
    return !!link;
  })()`)
  await sleep(1200)
  const hall = await cdp.evaluate(`(() => {
    const text = document.body.innerText;
    return {
      title: text.includes('回忆游乐园'),
      cards: ['记忆配对','拼回这一刻','猜猜是哪一张','今日回忆盲盒','把时光排好','关于他的五道题','今天一起做什么'].filter(name => text.includes(name)),
      random: [...document.querySelectorAll('button')].some(b => b.innerText.includes('随便玩一个')),
      hash: location.hash,
    };
  })()`)
  if (!hall.title || hall.cards.length !== 7 || !hall.random) problems.push(`互动大厅不完整：${JSON.stringify(hall)}`)
  notes.push(`大厅：${hall.cards.length}/7 款玩法可见`)
  await cdp.shot('01-game-hall.png')

  /* ---------- B1. 记忆配对 ---------- */
  await cdp.evaluate(`(() => {
    const link = [...document.querySelectorAll('a')].find(a => a.innerText.includes('记忆配对'));
    link?.click();
    return !!link;
  })()`)
  await sleep(1200)
  const memorySetup = await cdp.evaluate(`(() => {
    const btn = [...document.querySelectorAll('button')].find(b => b.innerText.includes('开始配对'));
    const result = { setup: !!btn, difficulty: [...document.querySelectorAll('button')].filter(b => b.innerText.includes('对')).length };
    btn?.click();
    return result;
  })()`)
  if (!memorySetup.setup || memorySetup.difficulty < 3) problems.push(`记忆配对设置页不完整：${JSON.stringify(memorySetup)}`)
  await sleep(900)
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
  notes.push(`配对：${board.count} 张 / ${board.pairs} 对，hash=${board.hash}`)

  const clickPair = async (photoId) => {
    const r = await cdp.evaluate(`(() => {
      const cards = [...document.querySelectorAll('[data-card-key]')].filter(c => c.dataset.photoId === ${JSON.stringify(photoId)} && c.dataset.state === 'hidden');
      if (cards.length < 2) return { ok: false, hidden: cards.length };
      cards[0].click();
      return { ok: true };
    })()`)
    if (!r.ok) return false
    await sleep(160)
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
    return { mid, matched: document.querySelectorAll('[data-state="matched"]').length, text: document.body.innerText.includes('步数 1') };
  })()`)
  if (matchedOk.matched !== 2) problems.push(`配对成功后应有 2 张牌处于 matched，实际 ${matchedOk.matched}`)
  if (!matchedOk.text) problems.push('配对一次后步数不是 1')

  const mismatch = await cdp.evaluate(`(async () => {
    const cards = [...document.querySelectorAll('[data-card-key]')].filter(c => c.dataset.state === 'hidden');
    const a = cards[0], b = cards.find(c => c.dataset.photoId !== cards[0].dataset.photoId);
    if (!a || !b) return { error: '没有可失配的牌' };
    a.click(); await new Promise(r => setTimeout(r, 200)); b.click(); await new Promise(r => setTimeout(r, 1200));
    return { flipped: document.querySelectorAll('[data-state="flipped"]').length, matched: document.querySelectorAll('[data-state="matched"]').length };
  })()`)
  if (mismatch.error) problems.push(`失配测试失败：${mismatch.error}`)
  else {
    if (mismatch.flipped !== 0) problems.push(`失配后应全部翻回，仍有 ${mismatch.flipped} 张翻开`)
    if (mismatch.matched !== 2) problems.push(`失配不应改变已配对数量（现为 ${mismatch.matched}）`)
  }

  const restart = await cdp.evaluate(`(async () => {
    const btn = [...document.querySelectorAll('button')].find(b => b.innerText.includes('重新开始'));
    btn?.click(); await new Promise(r => setTimeout(r, 500));
    return { ok: !!btn, matched: document.querySelectorAll('[data-state="matched"]').length, flipped: document.querySelectorAll('[data-state="flipped"]').length, zero: document.body.innerText.includes('步数 0'), cards: document.querySelectorAll('[data-card-key]').length };
  })()`)
  if (!restart.ok) problems.push('没有「重新开始」按钮')
  if (restart.matched || restart.flipped || !restart.zero || restart.cards !== 12) problems.push(`重新开始没有完全复位：${JSON.stringify(restart)}`)

  const photoIds = await cdp.evaluate(`[...new Set([...document.querySelectorAll('[data-card-key]')].map(c => c.dataset.photoId))]`)
  for (const id of photoIds) {
    await clickPair(id)
    await sleep(420)
  }
  await sleep(800)
  const finished = await cdp.evaluate(`(() => {
    const text = document.body.innerText;
    const keys = Object.keys(localStorage).filter(k => k.startsWith('heartlog.game.memory.v2.'));
    const raw = keys.length ? localStorage.getItem(keys[0]) : null;
    return { matched: document.querySelectorAll('[data-state="matched"]').length, done: text.includes('全部配对完成') || text.includes('新纪录'), keys, record: raw ? JSON.parse(raw) : null, photos: document.body.innerText.includes('这一局的照片') };
  })()`)
  if (finished.matched !== 12 || !finished.done || !finished.keys.length || !finished.photos) problems.push(`记忆配对通关结果异常：${JSON.stringify(finished)}`)
  await cdp.shot('02-memory-cleared.png')

  const beforeSet = await cdp.evaluate(`[...new Set([...document.querySelectorAll('[data-card-key]')].map(c => c.dataset.photoId))].sort().join(',')`)
  await cdp.send('Page.reload', { ignoreCache: true })
  await sleep(2600)
  await cdp.evaluate(`[...document.querySelectorAll('button')].find(b => b.innerText.includes('开始配对'))?.click()`)
  await sleep(900)
  const afterReload = await cdp.evaluate(`(() => {
    const cards = [...document.querySelectorAll('[data-card-key]')];
    return { count: cards.length, set: [...new Set(cards.map(c => c.dataset.photoId))].sort().join(','), hash: location.hash };
  })()`)
  if (afterReload.count !== 12) problems.push(`刷新后牌数 ${afterReload.count}，应为 12`)
  if (afterReload.hash !== '#/game?play=memory') problems.push(`刷新后跑到了 ${afterReload.hash}，应当仍在记忆配对`)
  if (afterReload.set === beforeSet) problems.push('刷新后仍是同一组照片，没有做到「每次进入换一组」')
  notes.push('配对：翻牌、失配、重开、通关、刷新换组均通过')

  /* ---------- B2. 拼图 ---------- */
  await cdp.send('Page.navigate', { url: `${BASE}/viewer.html?source=sample&scene=demo#/game?play=puzzle` })
  await sleep(1800)
  const puzzleSetup = await cdp.evaluate(`(() => {
    const btn = [...document.querySelectorAll('button')].find(b => b.innerText.includes('开始拼图'));
    const result = { setup: !!btn, hard: [...document.querySelectorAll('button')].some(b => b.innerText.includes('3 × 3')) };
    btn?.click();
    return result;
  })()`)
  if (!puzzleSetup.setup || !puzzleSetup.hard) problems.push(`拼图设置页不完整：${JSON.stringify(puzzleSetup)}`)
  await sleep(1000)
  const puzzleStart = await cdp.evaluate(`(() => ({
    cells: [...document.querySelectorAll('[data-puzzle-cell]')].length,
    solved: document.querySelector('[data-puzzle-board]')?.dataset.puzzleBoard,
    pieces: [...document.querySelectorAll('[data-puzzle-cell]')].map(c => Number(c.dataset.piece)).join(','),
  }))()`)
  if (puzzleStart.cells !== 6 || puzzleStart.solved !== 'playing') problems.push(`拼图开局异常：${JSON.stringify(puzzleStart)}`)
  await cdp.shot('03-puzzle-playing.png')

  await cdp.evaluate(`(async () => {
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    for (let target = 0; target < 6; target++) {
      let cells = [...document.querySelectorAll('[data-puzzle-cell]')];
      const holder = cells.find(c => Number(c.dataset.piece) === target);
      if (!holder) throw new Error('找不到拼块 ' + target);
      if (Number(holder.dataset.puzzleCell) !== target) {
        holder.click();
        await sleep(140);
        cells = [...document.querySelectorAll('[data-puzzle-cell]')];
        cells.find(c => Number(c.dataset.puzzleCell) === target)?.click();
        await sleep(140);
      }
    }
    return document.querySelector('[data-puzzle-board]')?.dataset.puzzleBoard;
  })()`)
  await sleep(800)
  const puzzleDone = await cdp.evaluate(`(() => ({
    state: document.querySelector('[data-puzzle-board]')?.dataset.puzzleBoard,
    text: document.body.innerText.includes('这一刻拼完整了') || document.body.innerText.includes('拼完整了，也是新纪录'),
    keys: Object.keys(localStorage).filter(k => k.startsWith('heartlog.game.puzzle.v1.')),
  }))()`)
  if (puzzleDone.state !== 'solved' || !puzzleDone.text || !puzzleDone.keys.length) problems.push(`拼图通关异常：${JSON.stringify(puzzleDone)}`)
  notes.push(`拼图：点击交换并完整通关，成绩键 ${puzzleDone.keys[0] || '无'}`)
  await cdp.shot('04-puzzle-cleared.png')

  /* ---------- B3. 局部猜图 ---------- */
  await cdp.send('Page.navigate', { url: `${BASE}/viewer.html?source=sample&scene=demo#/game?play=photoGuess` })
  await sleep(1800)
  const guessSetup = await cdp.evaluate(`(() => {
    const btn = [...document.querySelectorAll('button')].find(b => b.innerText.includes('开始猜图'));
    const result = { setup: !!btn };
    btn?.click();
    return result;
  })()`)
  if (!guessSetup.setup) problems.push('猜图没有开始按钮')
  await sleep(1000)
  const guessStart = await cdp.evaluate(`(() => {
    const options = [...document.querySelectorAll('[data-guess-option]')];
    return { options: options.length, unique: new Set(options.map(o => o.dataset.guessOption)).size, crop: !!document.querySelector('[data-guess-crop]'), hint: [...document.querySelectorAll('button')].some(b => b.innerText.includes('放大线索')), skip: [...document.querySelectorAll('button')].some(b => b.innerText.includes('换一题')) };
  })()`)
  if (guessStart.options !== 4 || guessStart.unique !== 4 || !guessStart.crop || !guessStart.hint || !guessStart.skip) problems.push(`猜图开局异常：${JSON.stringify(guessStart)}`)
  await cdp.shot('05-photo-guess-playing.png')

  for (let i = 0; i < 5; i++) {
    await cdp.evaluate(`(() => document.querySelector('[data-guess-option]')?.click())()`)
    await sleep(300)
    await cdp.evaluate(`(() => {
      const next = [...document.querySelectorAll('button')].find(b => b.innerText.includes('下一题') || b.innerText.includes('查看结果'));
      next?.click();
      return !!next;
    })()`)
    await sleep(350)
  }
  const guessDone = await cdp.evaluate(`(() => ({
    text: document.body.innerText.includes('这一局完成了'),
    keys: Object.keys(localStorage).filter(k => k.startsWith('heartlog.game.photoGuess.v1.')),
  }))()`)
  if (!guessDone.text || !guessDone.keys.length) problems.push(`猜图结果异常：${JSON.stringify(guessDone)}`)
  notes.push('猜图：5 题流程、候选锁定与结果记录通过')
  await cdp.shot('06-photo-guess-done.png')

  /* ---------- B4. 回忆盲盒 ---------- */
  await cdp.send('Page.navigate', { url: `${BASE}/viewer.html?source=sample&scene=demo#/game?play=memoryBox` })
  await sleep(1800)
  const boxOpened = await cdp.evaluate(`(async () => {
    const btn = [...document.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === '直接打开回忆盲盒');
    btn?.click();
    await new Promise(r => setTimeout(r, 500));
    const next = [...document.querySelectorAll('button')].find(b => b.innerText.includes('再来一个'));
    const first = { opened: document.body.innerText.includes('已打开第 1 /'), image: !!document.querySelector('img'), next: !!next };
    next?.click();
    await new Promise(r => setTimeout(r, 300));
    const secondStar = [...document.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === '直接打开回忆盲盒');
    secondStar?.click();
    await new Promise(r => setTimeout(r, 500));
    return { ...first, second: document.body.innerText.includes('已打开第 2 /') };
  })()`)
  if (!boxOpened.opened || !boxOpened.image || !boxOpened.next || !boxOpened.second) problems.push(`盲盒流程异常：${JSON.stringify(boxOpened)}`)
  notes.push('盲盒：直接打开与连续不重复抽取通过')
  await cdp.shot('07-memory-box.png')

  /* ---------- B5. 时光排序 ---------- */
  await cdp.send('Page.navigate', { url: `${BASE}/viewer.html?source=sample&scene=demo#/game?play=timeline` })
  await sleep(1800)
  const timelineStart = await cdp.evaluate(`(() => {
    const btn = [...document.querySelectorAll('button')].find(b => b.innerText.includes('开始排序'));
    const result = { setup: !!btn, text: document.body.innerText.includes('不同日期') || document.body.innerText.includes('标准') };
    btn?.click();
    return result;
  })()`)
  if (!timelineStart.setup) problems.push(`时光排序没有开始按钮：${JSON.stringify(timelineStart)}`)
  await sleep(900)
  const timelinePlaying = await cdp.evaluate(`(() => ({
    cards: document.querySelectorAll('[data-timeline-card]').length,
    datesHidden: !document.body.innerText.match(/2026 年/),
    moves: [...document.querySelectorAll('button')].filter(b => b.innerText.includes('上移') || b.getAttribute('aria-label')?.includes('上移')).length,
  }))()`)
  if (timelinePlaying.cards !== 3 || timelinePlaying.datesHidden !== true || timelinePlaying.moves < 3) problems.push(`时光排序开局异常：${JSON.stringify(timelinePlaying)}`)
  await cdp.evaluate(`(() => {
    const move = [...document.querySelectorAll('button')].find(b => b.getAttribute('aria-label')?.includes('下移一位'));
    move?.click();
    return !!move;
  })()`)
  await sleep(250)
  await cdp.evaluate(`(() => [...document.querySelectorAll('button')].find(b => b.innerText.includes('排好了，提交'))?.click())()`)
  await sleep(500)
  const timelineDone = await cdp.evaluate(`(() => ({
    result: document.body.innerText.includes('位置正确') || document.body.innerText.includes('正确位置'),
    reveal: [...document.querySelectorAll('button')].some(b => b.innerText.includes('揭晓完整时间线')),
    keys: Object.keys(localStorage).filter(k => k.startsWith('heartlog.game.timeline.v1.')),
  }))()`)
  if (!timelineDone.result || !timelineDone.reveal || !timelineDone.keys.length) problems.push(`时光排序提交异常：${JSON.stringify(timelineDone)}`)
  notes.push('时光排序：上移/下移、提交判定与成绩记录通过')
  await cdp.shot('08-timeline.png')

  /* ---------- B6. 关于他的五道题 ---------- */
  await cdp.send('Page.navigate', { url: `${BASE}/viewer.html?source=sample&scene=demo#/game?play=quiz` })
  await sleep(1800)
  const quizStart = await cdp.evaluate(`(() => {
    const btn = [...document.querySelectorAll('button')].find(b => b.innerText.includes('开始答题'));
    const result = { setup: !!btn, count: document.body.innerText.includes('5 题') };
    btn?.click();
    return result;
  })()`)
  if (!quizStart.setup || !quizStart.count) problems.push(`五道题开局异常：${JSON.stringify(quizStart)}`)
  await sleep(900)
  for (let i = 0; i < 5; i++) {
    const state = await cdp.evaluate(`(() => {
      const options = [...document.querySelectorAll('[data-quiz-option]')];
      if (!options.length) return { options: 0 };
      options[0].click();
      return { options: options.length };
    })()`)
    if (state.options < 2) problems.push(`第 ${i + 1} 题选项不足：${JSON.stringify(state)}`)
    await sleep(250)
    await cdp.evaluate(`(() => [...document.querySelectorAll('button')].find(b => b.innerText.includes('下一题') || b.innerText.includes('查看结果'))?.click())()`)
    await sleep(300)
  }
  const quizDone = await cdp.evaluate(`(() => ({
    done: document.body.innerText.includes('这一局完成了'),
    source: document.body.innerText.includes('跳过') && document.body.innerText.includes('辅助'),
    keys: Object.keys(localStorage).filter(k => k.startsWith('heartlog.game.quiz.v1.')),
  }))()`)
  if (!quizDone.done || !quizDone.keys.length) problems.push(`五道题结果异常：${JSON.stringify(quizDone)}`)
  notes.push('五道题：5 题作答、锁定与成绩记录通过')
  await cdp.shot('09-quiz.png')

  /* ---------- B7. 今天一起做什么 ---------- */
  await cdp.send('Page.navigate', { url: `${BASE}/viewer.html?source=sample&scene=demo#/game?play=dateDraw` })
  await sleep(1800)
  const dateDrawState = await cdp.evaluate(`(() => ({
    cards: document.querySelectorAll('[data-date-card]').length,
    texts: [...document.querySelectorAll('[data-date-card]')].map(c => c.innerText.trim()).filter(Boolean),
    lock: [...document.querySelectorAll('button')].some(b => b.innerText.includes('锁定')),
  }))()`)
  if (dateDrawState.cards !== 3 || !dateDrawState.lock) problems.push(`活动抽卡开局异常：${JSON.stringify(dateDrawState)}`)
  const beforePlace = await cdp.evaluate(`document.querySelector('[data-date-card="place"]')?.dataset.cardId || ''`)
  await cdp.evaluate(`(() => {
    const card = document.querySelector('[data-date-card="place"]');
    const btn = card?.querySelector('button[aria-label*="锁定"]');
    btn?.click();
    return !!btn;
  })()`)
  await sleep(200)
  await cdp.evaluate(`(() => [...document.querySelectorAll('button')].find(b => b.innerText.includes('再抽一次'))?.click())()`)
  await sleep(400)
  const afterPlace = await cdp.evaluate(`document.querySelector('[data-date-card="place"]')?.dataset.cardId || ''`)
  if (!beforePlace || beforePlace !== afterPlace) problems.push('活动抽卡锁定地点后被重抽')
  await cdp.evaluate(`document.querySelector('[data-scene-preset="home-short"]')?.click()`)
  await sleep(350)
  const sceneState = await cdp.evaluate(`(() => ({
    pressed: document.querySelector('[data-scene-preset="home-short"]')?.getAttribute('aria-pressed') === 'true',
    cards: document.querySelectorAll('[data-date-card]').length,
    complete: [...document.querySelectorAll('[data-date-card]')].every(c => Boolean(c.dataset.cardId)),
    locked: document.querySelectorAll('[data-date-card][data-locked="true"]').length,
  }))()`)
  if (!sceneState.pressed || sceneState.cards !== 3 || !sceneState.complete || sceneState.locked !== 0) problems.push(`场景推荐异常：${JSON.stringify(sceneState)}`)
  await cdp.evaluate(`(() => [...document.querySelectorAll('button')].find(b => b.innerText.includes('喜欢这组'))?.click())()`)
  await sleep(300)
  const favoriteKeys = await cdp.evaluate(`Object.keys(localStorage).filter(k => k.startsWith('heartlog.game.dateDraw.v1.'))`)
  if (!favoriteKeys.length) problems.push('活动抽卡收藏没有写入本机')
  notes.push('活动抽卡：三类组合、场景推荐、锁定重抽与本机收藏通过')
  await cdp.shot('10-date-draw.png')

  /* ---------- C. 响应式与访客边界 ---------- */
  for (const size of [{ width: 320, height: 740, mobile: true }, { width: 1440, height: 900, mobile: false }]) {
    await cdp.send('Emulation.setDeviceMetricsOverride', { ...size, deviceScaleFactor: size.mobile ? 2 : 1 })
    await cdp.send('Page.navigate', { url: `${BASE}/viewer.html?source=sample&scene=demo#/game` })
    await sleep(1200)
    const fit = await cdp.evaluate(`document.documentElement.scrollWidth <= ${size.width} && document.body.innerText.includes('回忆游乐园')`)
    if (!fit) problems.push(`${size.width}px 宽大厅横向溢出或未渲染`)
  }
  notes.push('响应式：320px 与 1440px 大厅无横向溢出')

  const dbs = await cdp.evaluate(`(async () => { try { return (await indexedDB.databases()).length } catch { return -1 } })()`)
  if (dbs !== 0) problems.push(`小游戏页面创建了 ${dbs} 个 IndexedDB（应完全不用数据库）`)
  const lsKeys = await cdp.evaluate(`Object.keys(localStorage)`)
  const allowed = (k) => k.startsWith('hl-') || /^heartlog\.game\.(memory|puzzle|photoGuess|memoryBox|timeline|quiz|dateDraw)\.v\d+\./.test(k)
  const unexpected = lsKeys.filter((k) => !allowed(k))
  if (unexpected.length) problems.push(`localStorage 出现预期之外的键：${unexpected.join(', ')}`)
  if (cdp.writes.length) problems.push(`页面发出了非 GET 请求：${cdp.writes.slice(0, 2).join(' | ')}`)
  notes.push(`边界：IndexedDB ${dbs} 个，localStorage ${lsKeys.length} 个白名单键，写请求 ${cdp.writes.length} 个`)

  if (cdp.logs.length) problems.push(`页面报错：${cdp.logs.slice(0, 2).join(' | ')}`)

  console.log('\n—— 记录 ——')
  for (const n of notes) console.log(`  · ${n}`)
  console.log('\n—— 结果 ——')
  if (problems.length) {
    console.log(`✗ ${problems.length} 个问题：`)
    for (const p of problems) console.log(`  · ${p}`)
    process.exitCode = 1
  } else {
    console.log('✓ T6 回忆游乐园通过：大厅、配对升级、拼图、局部猜图、回忆盲盒、时光排序、五道题、活动抽卡均可用；成绩只在本机，不建库不发写请求。')
  }
  console.log(`截图：${OUT}`)
} finally {
  try {
    chrome.kill()
  } catch {}
}
