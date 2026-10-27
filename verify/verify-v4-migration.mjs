/**
 * v3 → v6 升级验证：真实用户数据库是 v3，新版打开时 Dexie 会做增量迁移。
 *
 * 这个验证必须做，原因是升级失败的表现是**作者端直接打不开**（白屏或抛错），
 * 而离线自测里只覆盖了 v1 → 最新，跳过了「已经用到 v3 的真实库」这条路径。
 *
 * 用法：node verify/verify-v4-migration.mjs（需 npm run dev）
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const BASE = process.env.HL_BASE || 'http://127.0.0.1:5288'
const OUT = join(ROOT, 'verify/_artifacts/v4-migration')
const PORT = 9427
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
}

const profile = mkdtempSync(join(tmpdir(), 'hl-v4-'))
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

  // 打开一个空白页，先用独立 Dexie 造一个「真实用户当前所处的 v3 库」
  await cdp.send('Page.navigate', { url: `${BASE}/verify/selftest.html` })
  await sleep(2000)

  const seeded = await cdp.evaluate(`(async () => {
    const Dexie = (await import('/node_modules/dexie/dist/dexie.mjs')).default
    // 先删掉可能存在的库，保证从零造 v3
    await Dexie.delete('heartlog')
    const V1 = {
      persons: 'id, name, isActive, createdAt, updatedAt',
      preferences: 'id, personId, category, direction, updatedAt',
      entries: 'id, personId, occurredAt, type, createdAt, updatedAt',
      dailyStatus: 'id, personId, date, updatedAt',
      health: 'id, personId, occurredAt, status, updatedAt',
      gifts: 'id, personId, givenAt, updatedAt',
      wishes: 'id, personId, status, raisedAt, updatedAt',
      photos: 'id, personId, entryId, giftId, takenAt, createdAt, *tags',
      insights: 'id, personId, dimension, confirmState, updatedAt',
      summaries: 'id, personId, kind, rangeStart, rangeEnd, createdAt',
      meta: 'key',
    }
    const legacy = new Dexie('heartlog')
    legacy.version(1).stores(V1)
    legacy.version(2).stores({ tombstones: 'id, entity, deletedAt, pushedAt' })
    legacy.version(3).stores({ conflicts: 'id, entity, rowId, discardedUpdatedAt, detectedAt, dismissedAt' })
    await legacy.open()

    const t = '2026-10-20T10:00:00.000+08:00'
    // 造多类真实数据，确保升级后逐类都还在
    await legacy.table('persons').put({
      id: 'p_v3', name: '升级测试人物', calendarType: 'solar', anniversaries: [],
      tags: ['v3'], isActive: true, createdAt: t, updatedAt: t,
    })
    await legacy.table('entries').put({
      id: 'e_v3', personId: 'p_v3', occurredAt: t, type: 'daily', title: 'v3 时代的记录',
      content: '这一条必须活下来', tagList: ['保留'], photoIds: [], followUpDone: false, quick: false,
      createdAt: t, updatedAt: t,
    })
    await legacy.table('preferences').put({
      id: 'pr_v3', personId: 'p_v3', category: 'food', name: 'v3 时代的偏好', direction: 'like',
      tags: [], evidenceEntryIds: [], createdAt: t, updatedAt: t,
    })
    await legacy.table('tombstones').put({
      id: 'entries:e_dead', entity: 'entries', rowId: 'e_dead', deletedAt: t, pushedAt: t,
    })
    await legacy.table('conflicts').put({
      id: 'entries:e_v3:2026-10-19', entity: 'entries', rowId: 'e_v3',
      discardedUpdatedAt: '2026-10-19T00:00:00.000+08:00', keptUpdatedAt: t, detectedAt: t,
      payload: { title: '被丢弃的旧版本' },
    })
    await legacy.table('meta').put({ key: 'started', value: true })
    const ver = legacy.verno
    legacy.close()
    return { verno: ver, persons: 1, entries: 1 }
  })().catch((e) => ({ error: String(e && e.message ? e.message : e) }))`)

  console.log('已造出 v3 库：', JSON.stringify(seeded))
  if (seeded?.error) problems.push(`造 v3 库失败：${seeded.error}`)

  // 现在用应用自己的 db 模块打开它 → 触发 v3 → v6 升级
  await cdp.send('Page.navigate', { url: `${BASE}/` })
  await sleep(3000)

  const after = await cdp.evaluate(`(async () => {
    const mod = await import('/src/db/db.ts')
    const db = mod.db
    await db.open()
    const p = await db.persons.get('p_v3')
    const e = await db.entries.get('e_v3')
    const pr = await db.preferences.get('pr_v3')
    const tomb = await db.tombstones.get('entries:e_dead')
    const cf = await db.conflicts.get('entries:e_v3:2026-10-19')
    const meta = await db.meta.get('started')

    // 新表必须可用（不只是存在，要能读能写）
    const now = new Date().toISOString()
    await db.tasks.put({
      id: 'tk_v4_probe', personId: 'p_v3', title: '升级后新建的任务', kind: 'prepare',
      status: 'open', links: {}, timeZone: 'Asia/Shanghai', rev: 1, createdAt: now, updatedAt: now,
    })
    await db.taskReminders.put({
      id: 'tr_v4_probe', taskId: 'tk_v4_probe', mode: 'before', offsetMinutes: 60,
      enabled: true, rev: 1, createdAt: now, updatedAt: now,
    })
    await db.taskOccurrences.put({
      id: 'tk_v4_probe@1', taskId: 'tk_v4_probe', slotAt: now, slotLocal: '2026-10-26 09:00',
      planIds: ['tr_v4_probe'], createdAt: now, updatedAt: now,
    })
    // v5（T5 回忆录）同样必须能在老库上直接写
    await db.memoirs.put({
      id: 'mb_v5_probe', personId: 'p_v3', title: '升级后新建的回忆录', sections: [],
      status: 'draft', createdAt: now, updatedAt: now,
    })
    // v6（T6 互动内容）同样必须能在老库上直接写
    await db.gameContent.put({
      id: 'gc_v6_probe', personId: 'p_v3', kind: 'quiz', schemaVersion: 1, enabled: true,
      prompt: '升级后新建的题目', options: [{ id: 'a', text: '对' }, { id: 'b', text: '错' }],
      correctOptionId: 'a', sourceEntryIds: ['e_v3'], createdAt: now, updatedAt: now,
    })
    const tk = await db.tasks.get('tk_v4_probe')
    const tr = await db.taskReminders.get('tr_v4_probe')
    const to = await db.taskOccurrences.get('tk_v4_probe@1')
    const mb = await db.memoirs.get('mb_v5_probe')
    const gc = await db.gameContent.get('gc_v6_probe')

    return {
      verno: db.verno,
      tables: db.tables.map((x) => x.name).sort(),
      person: p ? p.name : null,
      personTags: p ? p.tags : null,
      entry: e ? e.title : null,
      entryContent: e ? e.content : null,
      preference: pr ? pr.name : null,
      tombstone: Boolean(tomb),
      conflict: cf ? cf.payload?.title ?? null : null,
      meta: meta ? meta.value : null,
      newTablesWritable: Boolean(tk && tr && to),
      memoirWritable: Boolean(mb),
      gameContentWritable: Boolean(gc),
    }
  })().catch((e) => ({ error: String(e && e.stack ? e.stack.split('\\n')[0] : e) }))`)

  console.log('升级后：', JSON.stringify(after, null, 1))

  if (after?.error) {
    problems.push(`v3→v6 升级失败：${after.error}`)
  } else {
    if (after.verno !== 6) problems.push(`升级后版本号应为 6（含 T6 互动内容表），实为 ${after.verno}`)
    if (after.person !== '升级测试人物') problems.push('人物档案在升级后丢失')
    if (!Array.isArray(after.personTags) || after.personTags[0] !== 'v3') problems.push('人物标签在升级后损坏')
    if (after.entry !== 'v3 时代的记录') problems.push('记录在升级后丢失')
    if (after.entryContent !== '这一条必须活下来') problems.push('记录正文在升级后损坏')
    if (after.preference !== 'v3 时代的偏好') problems.push('偏好在升级后丢失')
    if (!after.tombstone) problems.push('墓碑表在升级后丢失')
    if (after.conflict !== '被丢弃的旧版本') problems.push('冲突副本在升级后丢失')
    if (after.meta !== true) problems.push('meta 设置在升级后丢失')
    if (!after.newTablesWritable) problems.push('新增的三张待办表在升级后不可读写')
    if (!after.memoirWritable) problems.push('v5 新增的回忆录表在升级后不可读写')
    if (!after.gameContentWritable) problems.push('v6 新增的互动内容表在升级后不可读写')
    for (const t of ['tasks', 'taskReminders', 'taskOccurrences', 'memoirs', 'gameContent']) {
      if (!after.tables.includes(t)) problems.push(`升级后缺少表 ${t}`)
    }
    // 原有表一个都不能少
    for (const t of ['persons', 'preferences', 'entries', 'dailyStatus', 'health', 'gifts', 'wishes', 'photos', 'insights', 'summaries', 'meta', 'tombstones', 'conflicts']) {
      if (!after.tables.includes(t)) problems.push(`升级后丢失原表 ${t}`)
    }
    notes.push(`版本 ${after.verno}，表 ${after.tables.length} 张，旧数据 6 类全部保留，新表可读写`)
  }

  // 作者端能正常打开（不是白屏/报错页）
  await cdp.send('Page.navigate', { url: `${BASE}/#/tasks` })
  await sleep(2500)
  const body = await cdp.text()
  if (!body.includes('为他记着')) problems.push('升级后作者端清单页打不开，可能整页崩溃')

  // 回忆录页在升级后的老库上也能打开（T5）
  await cdp.send('Page.navigate', { url: `${BASE}/#/memoir` })
  await sleep(2500)
  const memoirBody = await cdp.text()
  if (!memoirBody.includes('回忆录')) problems.push('升级后回忆录页打不开或没有入口')

  // 互动内容页在升级后的老库上也能打开（T6 第三版）
  await cdp.send('Page.navigate', { url: `${BASE}/#/game-content` })
  await sleep(2500)
  const gameContentBody = await cdp.text()
  if (!gameContentBody.includes('互动内容')) problems.push('升级后互动内容页打不开或没有入口')
  if (body.includes('页面出错了') || body.includes('读取本机数据失败')) problems.push('升级后作者端出现错误页')
  await cdp.shot('01-after-v4.png')

  if (cdp.logs.length) problems.push(`页面报错：${cdp.logs.slice(0, 3).join(' | ')}`)

  console.log('\n—— 记录 ——')
  for (const n of notes) console.log(`  · ${n}`)
  console.log('\n—— 结果 ——')
  if (problems.length) {
    console.log(`✗ ${problems.length} 个问题：`)
    for (const p of problems) console.log(`  · ${p}`)
    process.exitCode = 1
  } else {
    console.log('✓ v3 → v6 增量升级安全：旧数据逐类保留，新表可读写，作者端正常打开。')
  }
  console.log(`截图：${OUT}`)
} finally {
  chrome.kill()
}