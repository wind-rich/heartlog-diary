/**
 * T8 作者端界面验证：真实浏览器 + 真实本机库，走完整交互。
 *
 * 用法：node verify/verify-tasks-ui.mjs   （需 npm run dev 已启动）
 *
 * 覆盖：
 *  - 首页出现「为他记着」摘要（作者端有、访客端没有）
 *  - /tasks 六个分组 + 两类筛选可用
 *  - 新增 → 编辑 → 完成（留回忆）→ 撤销完成（回忆保留）→ 取消 → 恢复 → 删除
 *  - 稍后提醒真的写进库并在界面显示「已延后」
 *  - 到期提醒出现在铃铛未读里，标为已读后消失且任务未被自动完成
 *  - 状态条如实显示「关页推送：本版不含」
 *  - 访客端不加载 tasks chunk，也不出现「为他记着」
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const BASE = process.env.HL_BASE || 'http://127.0.0.1:5288'
const OUT = join(ROOT, 'verify/_artifacts/tasks-ui')
const PORT = 9425
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
      if (m.method === 'Runtime.exceptionThrown') {
        this.logs.push(m.params?.exceptionDetails?.exception?.description || 'exception')
      }
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
    const r = await this.send('Page.captureScreenshot', { format: 'png' })
    writeFileSync(join(OUT, file), Buffer.from(r.data, 'base64'))
  }
  async text() {
    return this.evaluate('document.body.innerText')
  }
  async waitFor(fn, ms = 15000, label = '') {
    const started = Date.now()
    while (Date.now() - started < ms) {
      if (await this.evaluate(fn)) return true
      await sleep(200)
    }
    if (label) problems.push(`等待超时：${label}`)
    return false
  }
  async clickByText(text, tag = 'button') {
    return this.evaluate(`(() => {
      const els = [...document.querySelectorAll('${tag}')]
      const el = els.find((e) => e.innerText.trim() === ${JSON.stringify(text)})
      if (!el) return false
      el.click(); return true
    })()`)
  }
  async clickContains(text, tag = 'button') {
    return this.evaluate(`(() => {
      const els = [...document.querySelectorAll('${tag}')]
      const el = els.find((e) => e.innerText.includes(${JSON.stringify(text)}))
      if (!el) return false
      el.click(); return true
    })()`)
  }
}

const profile = mkdtempSync(join(tmpdir(), 'hl-tasks-ui-'))
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
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true })

  /* ---------------- 0. 准备：清库 + 建最小档案 + 登录态绕过 ---------------- */
  await cdp.send('Page.navigate', { url: `${BASE}/` })
  await sleep(2500)

  const seeded = await cdp.evaluate(`(async () => {
    const openReq = indexedDB.open('heartlog')
    await new Promise((res, rej) => { openReq.onsuccess = res; openReq.onerror = rej })
    openReq.result.close()
    localStorage.clear()
    const dexie = (await import('/node_modules/.vite/deps/dexie.js?v=x')).default
    return 'skip'
  })().catch((e) => 'err:' + e.message)`)
  void seeded

  // 直接用页面里的 app 模块写档案，避免手搓 schema
  const prepared = await cdp.evaluate(`(async () => {
    const mod = await import('/src/db/db.ts')
    const db = mod.db
    await db.tasks.clear(); await db.taskReminders.clear(); await db.taskOccurrences.clear()
    const persons = await db.persons.toArray()
    if (!persons.length) {
      const t = new Date().toISOString()
      await db.persons.put({ id: 'p_ui_task', name: '界面自测', calendarType: 'solar', anniversaries: [], tags: [], isActive: true, createdAt: t, updatedAt: t })
      await db.meta.put({ key: 'started', value: true })
    }
    return { persons: await db.persons.count() }
  })().catch((e) => ({ error: String(e && e.message ? e.message : e) }))`)
  console.log('准备档案：', JSON.stringify(prepared))

  await cdp.send('Page.navigate', { url: `${BASE}/` })
  await sleep(3000)
  let body = await cdp.text()

  /* ---------------- 1. 首页摘要 ---------------- */
  const hasSummaryEmpty = body.includes('为他记着')
  if (!hasSummaryEmpty) problems.push('作者首页没有「为他记着」入口（空态也应显示轻入口）')
  notes.push(`首页含「为他记着」=${hasSummaryEmpty}`)
  await cdp.shot('01-home-empty.png')

  /* ---------------- 2. 进入清单页 ---------------- */
  await cdp.send('Page.navigate', { url: `${BASE}/#/tasks` })
  await sleep(2000)
  body = await cdp.text()
  if (!body.includes('为他记着')) problems.push('清单页标题缺失')
  for (const g of ['今天', '即将到期', '已逾期', '未安排', '已完成', '已取消']) {
    if (!body.includes(g)) problems.push(`清单页缺少分组「${g}」`)
  }
  if (!body.includes('关页推送：本版不含')) problems.push('状态条没有如实标注「关页推送：本版不含」')
  await cdp.shot('02-tasks-empty.png')
  notes.push('清单页分组与状态条已渲染')

  /* ---------------- 3. 新增事项（两类各一条） ---------------- */
  async function addTask({ title, kind, due, time, remindOffset }) {
    await cdp.clickContains('新增')
    await cdp.waitFor(`document.body.innerText.includes('新增事项')`, 8000, '打开新增弹窗')
    // 标题
    await cdp.evaluate(`(() => {
      const inp = document.querySelector('.fixed.inset-0 input.input')
      if (!inp) return false
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
      setter.call(inp, ${JSON.stringify(title)})
      inp.dispatchEvent(new Event('input', { bubbles: true }))
      return true
    })()`)
    // 类型
    await cdp.evaluate(`(() => {
      const btn = [...document.querySelectorAll('.fixed.inset-0 button')].find((b) => b.innerText.trim() === ${JSON.stringify(kind)})
      if (btn) btn.click(); return Boolean(btn)
    })()`)
    // 截止日期
    if (due) {
      await cdp.evaluate(`(() => {
        const inp = document.querySelector('.fixed.inset-0 input[type=date]')
        if (!inp) return false
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
        setter.call(inp, ${JSON.stringify(due)})
        inp.dispatchEvent(new Event('input', { bubbles: true }))
        inp.dispatchEvent(new Event('change', { bubbles: true }))
        return true
      })()`)
    }
    if (time) {
      await cdp.evaluate(`(() => {
        const inp = document.querySelector('.fixed.inset-0 input[type=time]')
        if (!inp) return false
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
        setter.call(inp, ${JSON.stringify(time)})
        inp.dispatchEvent(new Event('input', { bubbles: true }))
        inp.dispatchEvent(new Event('change', { bubbles: true }))
        return true
      })()`)
    }
    if (remindOffset !== undefined) {
      await cdp.evaluate(`(() => {
        const labels = ${JSON.stringify(['到点时', '提前 30 分钟', '提前 1 小时', '提前 1 天'])}
        const target = ${JSON.stringify(remindOffset)}
        const btn = [...document.querySelectorAll('.fixed.inset-0 button')].find((b) => b.innerText.trim() === (target === 0 ? '到点时' : target === 30 ? '提前 30 分钟' : target === 60 ? '提前 1 小时' : '提前 1 天'))
        if (btn) btn.click(); return Boolean(btn) && labels.length > 0
      })()`)
    }
    await cdp.clickByText('保存')
    await sleep(1200)
  }

  const today = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  const todayStr = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`
  const tomorrow = new Date(today.getTime() + 86400000)
  const tomorrowStr = `${tomorrow.getFullYear()}-${pad(tomorrow.getMonth() + 1)}-${pad(tomorrow.getDate())}`

  await addTask({ title: '提醒他取快递', kind: '他托我提醒', due: todayStr, time: '18:00', remindOffset: 60 })
  await cdp.shot('03-tasks-added.png')
  body = await cdp.text()
  if (!body.includes('提醒他取快递')) problems.push('新增的「他托我提醒」没有出现在清单里')

  await addTask({ title: '给他买生日蛋糕', kind: '我准备为他做', due: tomorrowStr })
  // 明天到期属于「即将到期」，当前筛选是「今天」，必须切过去才能断言
  await cdp.send('Page.navigate', { url: `${BASE}/#/tasks?f=upcoming` })
  await sleep(1500)
  body = await cdp.text()
  if (!body.includes('给他买生日蛋糕')) problems.push('新增的「我准备为他做」没有出现在「即将到期」里')
  await cdp.send('Page.navigate', { url: `${BASE}/#/tasks?f=today` })
  await sleep(1500)

  /* ---------------- 4. 分组与类型筛选 ---------------- */
  await cdp.send('Page.navigate', { url: `${BASE}/#/tasks?f=unscheduled` })
  await sleep(1500)
  const unscheduledText = await cdp.text()
  await cdp.send('Page.navigate', { url: `${BASE}/#/tasks?f=today` })
  await sleep(1500)
  const todayText = await cdp.text()
  if (!todayText.includes('提醒他取快递')) problems.push('「今天」分组里没有今天到期的事项')
  notes.push(`今天分组含今日事项=${todayText.includes('提醒他取快递')}；未安排分组切走成功=${!unscheduledText.includes('给他买生日蛋糕')}`)

  await cdp.send('Page.navigate', { url: `${BASE}/#/tasks?f=upcoming&k=prepare` })
  await sleep(1500)
  const kindFiltered = await cdp.text()
  if (kindFiltered.includes('提醒他取快递')) problems.push('类型筛选「我准备为他做」仍显示「他托我提醒」的事项')
  if (!kindFiltered.includes('给他买生日蛋糕')) problems.push('「即将到期」里找不到明天到期的事项')
  await cdp.send('Page.navigate', { url: `${BASE}/#/tasks?f=today` })
  await sleep(1500)

  /* ---------------- 5. 完成（留回忆）→ 撤销（回忆保留） ---------------- */
  const beforeComplete = await cdp.evaluate(`([...document.querySelectorAll('li')].map((e) => e.innerText.split('\\n')[0]))`)
  const completeClicked = await cdp.evaluate(`(() => {
    const li = [...document.querySelectorAll('li')].find((e) => e.innerText.includes('提醒他取快递'))
    if (!li) return 'no-li'
    const btn = li.querySelector('button[aria-label="标记完成"]')
    if (!btn) return 'no-btn:' + [...li.querySelectorAll('button')].map((b) => b.getAttribute('aria-label') || b.innerText.trim()).join('|')
    btn.click(); return 'ok'
  })()`)
  if (completeClicked !== 'ok') problems.push(`点完成失败：${completeClicked}（当前行：${beforeComplete.join(' / ')}）`)
  await cdp.waitFor(`document.body.innerText.includes('我已经提醒过他了')`, 8000, '完成弹窗')
  await cdp.evaluate(`(() => {
    const ta = document.querySelector('.fixed.inset-0 textarea.input')
    if (!ta) return false
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
    setter.call(ta, '他说下午就去拿')
    ta.dispatchEvent(new Event('input', { bubbles: true }))
    return true
  })()`)
  await cdp.clickByText('标记完成')
  await sleep(1200)
  await cdp.shot('04-tasks-done.png')

  const doneRow = await cdp.evaluate(`(async () => {
    const mod = await import('/src/db/db.ts')
    const rows = await mod.db.tasks.toArray()
    const t = rows.find((r) => r.title === '提醒他取快递')
    return t ? { status: t.status, note: t.completionNote, kind: t.kind } : null
  })()`)
  if (!doneRow) problems.push('完成后数据库里找不到该任务')
  else {
    if (doneRow.status !== 'done') problems.push(`完成后状态应为 done，实为 ${doneRow.status}`)
    if (doneRow.note !== '他说下午就去拿') problems.push(`完成回忆没保存：${doneRow.note}`)
    if (doneRow.kind !== 'remind') problems.push('完成「他托我提醒」后类型被改了')
    notes.push(`完成后 status=${doneRow.status} 回忆=${doneRow.note} 类型=${doneRow.kind}`)
  }

  // 切到已完成，撤销完成
  await cdp.send('Page.navigate', { url: `${BASE}/#/tasks?f=done` })
  await sleep(1500)
  await cdp.evaluate(`(() => {
    const li = [...document.querySelectorAll('li')].find((e) => e.innerText.includes('提醒他取快递'))
    if (!li) return false
    const b = [...li.querySelectorAll('button')].find((x) => x.innerText.includes('撤销完成'))
    if (!b) return false
    b.click(); return true
  })()`)
  await sleep(1000)
  const reopened = await cdp.evaluate(`(async () => {
    const mod = await import('/src/db/db.ts')
    const rows = await mod.db.tasks.toArray()
    const t = rows.find((r) => r.title === '提醒他取快递')
    return t ? { status: t.status, note: t.completionNote } : null
  })()`)
  if (reopened?.status !== 'open') problems.push(`撤销完成后状态应为 open，实为 ${reopened?.status}`)
  if (reopened?.note !== '他说下午就去拿') problems.push('撤销完成把回忆清掉了')
  notes.push(`撤销完成后 status=${reopened?.status} 回忆保留=${reopened?.note === '他说下午就去拿'}`)

  /* ---------------- 6. 稍后提醒 ---------------- */
  await cdp.send('Page.navigate', { url: `${BASE}/#/tasks?f=today` })
  await sleep(1500)
  const snoozeOpen = await cdp.evaluate(`(() => {
    const li = [...document.querySelectorAll('li')].find((e) => e.innerText.includes('提醒他取快递'))
    const b = li && [...li.querySelectorAll('button')].find((x) => x.innerText.includes('稍后提醒'))
    if (b) b.click(); return Boolean(b)
  })()`)
  if (!snoozeOpen) problems.push('找不到「稍后提醒」按钮')
  await sleep(500)
  await cdp.clickContains('30 分钟后')
  await sleep(1200)
  const snoozed = await cdp.evaluate(`(async () => {
    const mod = await import('/src/db/db.ts')
    const rows = await mod.db.taskReminders.toArray()
    return rows.filter((r) => r.snoozedUntil).length
  })()`)
  if (!snoozed) problems.push('稍后提醒没有写入 snoozedUntil')
  const snoozeText = await cdp.text()
  if (!snoozeText.includes('已延后')) problems.push('界面没有显示「已延后」')
  await cdp.shot('05-tasks-snoozed.png')
  notes.push(`稍后提醒：snoozedUntil 条数=${snoozed}`)

  /* ---------------- 7. 取消 → 恢复 ---------------- */
  await cdp.send('Page.navigate', { url: `${BASE}/#/tasks?f=upcoming` })
  await sleep(1500)
  const cancelClicked = await cdp.evaluate(`(() => {
    const li = [...document.querySelectorAll('li')].find((e) => e.innerText.includes('给他买生日蛋糕'))
    const b = li && [...li.querySelectorAll('button')].find((x) => x.innerText.trim() === '取消')
    if (b) b.click(); return Boolean(b)
  })()`)
  if (!cancelClicked) problems.push('找不到「取消」按钮')
  await sleep(900)
  await cdp.send('Page.navigate', { url: `${BASE}/#/tasks?f=cancelled` })
  await sleep(1500)
  const cancelledText = await cdp.text()
  if (!cancelledText.includes('给他买生日蛋糕')) problems.push('取消后的事项没有出现在「已取消」里（不可追溯）')
  await cdp.evaluate(`(() => {
    const li = [...document.querySelectorAll('li')].find((e) => e.innerText.includes('给他买生日蛋糕'))
    const b = li && [...li.querySelectorAll('button')].find((x) => x.innerText.includes('恢复为待办'))
    if (b) b.click(); return Boolean(b)
  })()`)
  await sleep(900)
  const restored = await cdp.evaluate(`(async () => {
    const mod = await import('/src/db/db.ts')
    const t = (await mod.db.tasks.toArray()).find((r) => r.title === '给他买生日蛋糕')
    return t ? t.status : null
  })()`)
  if (restored !== 'open') problems.push(`恢复后状态应为 open，实为 ${restored}`)
  notes.push(`取消可追溯 + 恢复=${restored}`)

  /* ---------------- 8. 站内提醒：造一条到期 → 铃铛未读 → 已读 ---------------- */
  await cdp.evaluate(`(async () => {
    const mod = await import('/src/db/db.ts')
    const store = await import('/src/tasks/store.ts')
    const model = await import('/src/tasks/model.ts')
    const db = mod.db
    const at = Date.now() - 5 * 60 * 1000
    const wall = model.msToWallClock(at, 'Asia/Shanghai')
    const t = await store.createTask({ personId: 'p_ui_task', title: '十分钟前就该提醒他', kind: 'remind' })
    await store.addReminder(t.id, { mode: 'absolute', date: wall.date, time: wall.time })
    const res = await store.sweepOccurrences('p_ui_task')
    return res.created.length
  })()`)
  await cdp.send('Page.navigate', { url: `${BASE}/#/` })
  await sleep(2500)
  const bell = await cdp.evaluate(`(async () => {
    const mod = await import('/src/db/db.ts')
    const all = await mod.db.taskOccurrences.toArray()
    return { total: all.length, unread: all.filter((o) => !o.readAt && !o.dismissedAt && o.firedAt).length }
  })()`)
  if (!bell.unread) problems.push('到期事项没有生成未读站内提醒')
  const bellBtn = await cdp.evaluate(`(() => {
    const b = document.querySelector('button[aria-label^="站内提醒"]')
    if (!b) return null
    b.click()
    return b.getAttribute('aria-label')
  })()`)
  if (!bellBtn) problems.push('作者端页头没有站内提醒铃')
  await sleep(900)
  const bellPanel = await cdp.text()
  if (!bellPanel.includes('站内提醒')) problems.push('铃铛面板没有打开')
  if (!bellPanel.includes('十分钟前就该提醒他')) problems.push('铃铛面板没有列出到期事项')
  await cdp.shot('06-bell.png')
  notes.push(`站内提醒：未读 ${bell.unread} / 共 ${bell.total}，铃铛 label=${bellBtn}`)

  await cdp.clickContains('全部已读')
  await sleep(1000)
  const afterRead = await cdp.evaluate(`(async () => {
    const mod = await import('/src/db/db.ts')
    const all = await mod.db.taskOccurrences.toArray()
    const t = (await mod.db.tasks.toArray()).find((x) => x.title === '十分钟前就该提醒他')
    return { unread: all.filter((o) => !o.readAt && !o.dismissedAt && o.firedAt).length, taskStatus: t?.status }
  })()`)
  if (afterRead.unread !== 0) problems.push(`全部已读后仍有 ${afterRead.unread} 条未读`)
  if (afterRead.taskStatus !== 'open') problems.push('标为已读把任务自动完成了（不该发生）')
  notes.push(`全部已读后未读=${afterRead.unread}，任务状态仍为 ${afterRead.taskStatus}`)

  /* ---------------- 9. 删除 ---------------- */
  await cdp.evaluate(`(() => { document.body.click(); return true })()`)
  // 这条事项没有截止日期 → 落在「未安排」分组，不是「今天」
  await cdp.send('Page.navigate', { url: `${BASE}/#/tasks?f=unscheduled` })
  await sleep(1800)
  const delClicked = await cdp.evaluate(`(() => {
    const li = [...document.querySelectorAll('li')].find((e) => e.innerText.includes('十分钟前就该提醒他'))
    const b = li && [...li.querySelectorAll('button')].find((x) => x.innerText.includes('删除'))
    if (b) b.click(); return Boolean(b)
  })()`)
  if (!delClicked) problems.push('清单里找不到删除按钮')
  await sleep(600)
  await cdp.clickByText('确定')
  await sleep(1200)
  const afterDel = await cdp.evaluate(`(async () => {
    const mod = await import('/src/db/db.ts')
    return (await mod.db.tasks.toArray()).filter((t) => t.title === '十分钟前就该提醒他').length
  })()`)
  if (afterDel !== 0) problems.push(`删除后任务仍在库里（残留 ${afterDel} 条）`)
  notes.push(`删除后残留=${afterDel}`)

  /* ---------------- 10. 访客端隔离 ---------------- */
  const visitorInfo = await cdp.evaluate(`(async () => {
    const res = await fetch('/viewer.html', { cache: 'no-store' })
    return { ok: res.ok }
  })()`)
  if (!visitorInfo.ok) problems.push('访客端页面不可达')

  await cdp.send('Page.navigate', { url: `${BASE}/viewer.html` })
  await sleep(3000)
  const visitorText = await cdp.text()
  if (visitorText.includes('为他记着')) problems.push('访客端出现了「为他记着」（应仅作者私有）')
  if (visitorText.includes('记着')) problems.push('访客端导航出现了私有入口')
  const visitorChunks = await cdp.evaluate(`(async () => {
    const scripts = [...document.querySelectorAll('script')].map((s) => s.src).filter(Boolean)
    const loaded = performance.getEntriesByType('resource').map((r) => r.name).filter((n) => n.includes('.tsx') || n.includes('tasks'))
    return { scripts, tasksLoaded: loaded.filter((n) => /tasks|Task/i.test(n)) }
  })()`)
  if (visitorChunks.tasksLoaded.length) problems.push(`访客端加载了 tasks 相关资源：${visitorChunks.tasksLoaded.join(',')}`)
  await cdp.shot('07-visitor.png')
  notes.push(`访客端 tasks 资源=${visitorChunks.tasksLoaded.length}`)

  /* ---------------- 11. 桌面宽度 ---------------- */
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
  await cdp.send('Page.navigate', { url: `${BASE}/#/tasks` })
  await sleep(2000)
  const overflow = await cdp.evaluate(`document.documentElement.scrollWidth > document.documentElement.clientWidth + 1`)
  if (overflow) problems.push('桌面 1440 宽度下清单页出现横向溢出')
  await cdp.shot('08-desktop.png')

  if (cdp.logs.length) problems.push(`页面报错：${cdp.logs.slice(0, 3).join(' | ')}`)

  console.log('\n—— 记录 ——')
  for (const n of notes) console.log(`  · ${n}`)
  console.log('\n—— 结果 ——')
  if (problems.length) {
    console.log(`✗ ${problems.length} 个问题：`)
    for (const p of problems) console.log(`  · ${p}`)
    process.exitCode = 1
  } else {
    console.log('✓ T8 作者端界面验证全部通过')
  }
  console.log(`截图：${OUT}`)
} finally {
  chrome.kill()
}