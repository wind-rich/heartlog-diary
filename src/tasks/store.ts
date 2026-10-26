/**
 * T8 待办的本地仓库层（作者端专用，只写本机 Dexie）。
 *
 * 与其它实体的差别：
 * - 任务用 `rev` 而不是 `updatedAt` 做并发判据，因为提醒计划有自己的版本，
 *   两者要分别比较（大纲 T8-C 第 1 条）。本文件只维护本地 rev；
 *   与服务端已接受版本的比较在 lib/taskSync.ts。
 * - 删除任务时**连带删除**它的提醒与实例，但它们各自也留墓碑，
 *   否则另一台设备会把这些行当成「云端新增」再拉回来。
 */
import { db, nowISO, uid } from '../db/db'
import type { Task, TaskKind, TaskOccurrence, TaskReminder, TaskStatus } from './types'
import { DEFAULT_TIME_ZONE } from './types'
import { makeOccurrence, missedSlots, nextTrigger, occurrenceId, todayInZone, type PlanSlot } from './model'

/* ------------------------------------------------------------------ */
/* 任务                                                                */
/* ------------------------------------------------------------------ */

export interface TaskDraft {
  personId: string
  title: string
  kind: TaskKind
  note?: string
  dueDate?: string
  dueTime?: string
  timeZone?: string
  repeat?: Task['repeat']
  links?: Task['links']
}

export async function createTask(draft: TaskDraft): Promise<Task> {
  const at = nowISO()
  const task: Task = {
    id: uid('tk_'),
    personId: draft.personId,
    title: draft.title.trim(),
    kind: draft.kind,
    note: draft.note?.trim() || undefined,
    status: 'open',
    dueDate: draft.dueDate || undefined,
    dueTime: draft.dueDate ? draft.dueTime || undefined : undefined,
    timeZone: draft.timeZone || DEFAULT_TIME_ZONE,
    repeat: draft.repeat,
    links: draft.links ?? {},
    rev: 1,
    createdAt: at,
    updatedAt: at,
  }
  await db.tasks.put(task)
  return task
}

/** 更新业务字段：rev + 1，使旧的已同步版本失效 */
export async function updateTask(id: string, patch: Partial<Task>): Promise<Task | undefined> {
  const cur = await db.tasks.get(id)
  if (!cur) return undefined
  const next: Task = {
    ...cur,
    ...patch,
    id: cur.id,
    rev: cur.rev + 1,
    updatedAt: nowISO(),
  }
  // 清掉截止日期时，时刻与重复规则一起清，避免留下无主的 dueTime
  if (!next.dueDate) {
    next.dueDate = undefined
    next.dueTime = undefined
  }
  await db.tasks.put(next)
  return next
}

/**
 * 完成。
 * `note` 是完成时自愿留下的回忆：撤销完成时**不清空**它（大纲要求）。
 */
export async function completeTask(id: string, note?: string): Promise<Task | undefined> {
  const at = nowISO()
  return updateTask(id, {
    status: 'done',
    completedAt: at,
    completionNote: note?.trim() || undefined,
  })
}

/**
 * 撤销完成。
 * 明确保留 completionNote：用户已经写下的回忆不因状态回退而消失。
 */
export async function reopenTask(id: string): Promise<Task | undefined> {
  const cur = await db.tasks.get(id)
  if (!cur) return undefined
  return updateTask(id, {
    status: 'open',
    completedAt: undefined,
    completionNote: cur.completionNote,
  })
}

export async function cancelTask(id: string): Promise<Task | undefined> {
  return updateTask(id, { status: 'cancelled', cancelledAt: nowISO() })
}

export async function restoreTask(id: string): Promise<Task | undefined> {
  return updateTask(id, { status: 'open', cancelledAt: undefined })
}

/** 删除任务并连带清理提醒与实例（三者都留墓碑，供其它设备同步） */
export async function deleteTaskCascade(id: string): Promise<void> {
  await db.transaction('rw', [db.tasks, db.taskReminders, db.taskOccurrences], async () => {
    const reminders = await db.taskReminders.where('taskId').equals(id).toArray()
    for (const r of reminders) await db.taskReminders.delete(r.id)
    const occ = await db.taskOccurrences.where('taskId').equals(id).toArray()
    for (const o of occ) await db.taskOccurrences.delete(o.id)
    await db.tasks.delete(id)
  })
}

export async function listTasks(personId: string): Promise<Task[]> {
  return db.tasks.where('personId').equals(personId).toArray()
}

/* ------------------------------------------------------------------ */
/* 提醒计划                                                            */
/* ------------------------------------------------------------------ */

export interface ReminderDraft {
  mode: TaskReminder['mode']
  date?: string
  time?: string
  offsetMinutes?: number
  enabled?: boolean
}

export async function addReminder(taskId: string, draft: ReminderDraft): Promise<TaskReminder> {
  const at = nowISO()
  const row: TaskReminder = {
    id: uid('tr_'),
    taskId,
    mode: draft.mode,
    date: draft.date,
    time: draft.time,
    offsetMinutes: draft.offsetMinutes,
    enabled: draft.enabled ?? true,
    rev: 1,
    createdAt: at,
    updatedAt: at,
  }
  await db.taskReminders.put(row)
  return row
}

export async function updateReminder(id: string, patch: Partial<TaskReminder>): Promise<TaskReminder | undefined> {
  const cur = await db.taskReminders.get(id)
  if (!cur) return undefined
  const next: TaskReminder = { ...cur, ...patch, id: cur.id, rev: cur.rev + 1, updatedAt: nowISO() }
  await db.taskReminders.put(next)
  return next
}

export async function deleteReminder(id: string): Promise<void> {
  await db.taskReminders.delete(id)
}

export async function listReminders(taskId: string): Promise<TaskReminder[]> {
  return db.taskReminders.where('taskId').equals(taskId).toArray()
}

/** 一次性替换某任务的全部提醒（编辑表单保存时用） */
export async function replaceReminders(taskId: string, drafts: ReminderDraft[]): Promise<void> {
  const old = await listReminders(taskId)
  const keep = new Set(drafts.map((d) => (d as { id?: string }).id).filter(Boolean) as string[])
  for (const r of old) if (!keep.has(r.id)) await deleteReminder(r.id)
  for (const d of drafts) {
    const id = (d as { id?: string }).id
    if (id) await updateReminder(id, { mode: d.mode, date: d.date, time: d.time, offsetMinutes: d.offsetMinutes, enabled: d.enabled ?? true })
    else await addReminder(taskId, d)
  }
}

/**
 * 稍后提醒：把 snoozedUntil 设为指定时刻。
 *
 * 只影响「下一次触发」，不改任务本身的截止时间 —— 迁就的是现实，
 * 不是把整件事往后挪。所有已启用的提醒共享这个延后时间。
 */
export async function snoozeTask(taskId: string, untilMs: number): Promise<void> {
  const reminders = await listReminders(taskId)
  const at = new Date(untilMs).toISOString()
  for (const r of reminders) {
    if (!r.enabled) continue
    await updateReminder(r.id, { snoozedUntil: at })
  }
}

/** 取消稍后提醒，回到原计划 */
export async function clearSnooze(taskId: string): Promise<void> {
  const reminders = await listReminders(taskId)
  for (const r of reminders) {
    if (r.snoozedUntil) await updateReminder(r.id, { snoozedUntil: undefined })
  }
}

/* ------------------------------------------------------------------ */
/* 发生实例与站内提醒                                                   */
/* ------------------------------------------------------------------ */

/**
 * 扫描所有任务，把应该提醒、但还没有实例的时刻落库。
 *
 * 返回本次新生成的实例数（用于界面提示与自测断言）。
 * 幂等：同一 slot 已存在就直接跳过，所以反复调用（进页面、回前台、定时轮询）
 * 不会重复弹同一条。
 */
export async function sweepOccurrences(personId: string, nowMs = Date.now()): Promise<{
  created: TaskOccurrence[]
  suppressed: number
}> {
  const tasks = (await db.tasks.where('personId').equals(personId).toArray()).filter((t) => t.status === 'open')
  const created: TaskOccurrence[] = []
  let suppressed = 0

  for (const task of tasks) {
    const reminders = await db.taskReminders.where('taskId').equals(task.id).toArray()
    if (!reminders.some((r) => r.enabled)) continue
    const { latest, suppressed: s } = missedSlots(task, reminders, nowMs)
    suppressed += s
    for (const slot of latest) {
      const id = occurrenceId(task.id, slot.atMs)
      const exists = await db.taskOccurrences.get(id)
      if (exists) continue
      const occ = makeOccurrence(task, slot, nowISO())
      await db.taskOccurrences.put(occ)
      created.push(occ)
    }
  }
  return { created, suppressed }
}

/** 未读的站内提醒（按触发时间倒序） */
export async function unreadOccurrences(): Promise<TaskOccurrence[]> {
  const all = await db.taskOccurrences.toArray()
  return all
    .filter((o) => o.firedAt && !o.readAt && !o.dismissedAt)
    .sort((a, b) => (a.slotAt < b.slotAt ? 1 : -1))
}

export async function markOccurrenceRead(id: string): Promise<void> {
  const cur = await db.taskOccurrences.get(id)
  if (!cur || cur.readAt) return
  await db.taskOccurrences.put({ ...cur, readAt: nowISO(), updatedAt: nowISO() })
}

export async function markAllRead(): Promise<number> {
  const list = await unreadOccurrences()
  const at = nowISO()
  for (const o of list) await db.taskOccurrences.put({ ...o, readAt: at, updatedAt: at })
  return list.length
}

export async function dismissOccurrence(id: string): Promise<void> {
  const cur = await db.taskOccurrences.get(id)
  if (!cur) return
  await db.taskOccurrences.put({ ...cur, dismissedAt: nowISO(), updatedAt: nowISO() })
}

/**
 * 某个任务下一次会响的时间（界面「下次提醒」用）。
 * 没有可用计划 → undefined，界面显示「计划无效」而不是空白。
 */
export async function nextTriggerOf(task: Task, nowMs = Date.now()): Promise<PlanSlot | undefined> {
  const reminders = await listReminders(task.id)
  return nextTrigger(task, reminders, nowMs)
}

/** 今日与逾期计数（首页摘要用） */
export async function taskSummary(personId: string, nowMs = Date.now()): Promise<{
  today: number
  overdue: number
  open: number
  unread: number
  todayStr: string
}> {
  const tz = DEFAULT_TIME_ZONE
  const todayStr = todayInZone(tz, nowMs)
  const tasks = await db.tasks.where('personId').equals(personId).toArray()
  const open = tasks.filter((t) => t.status === 'open')
  let today = 0
  let overdue = 0
  for (const t of open) {
    if (!t.dueDate) continue
    if (t.dueDate === todayStr) today++
    else if (t.dueDate < todayStr) overdue++
  }
  const unread = (await unreadOccurrences()).length
  return { today, overdue, open: open.length, unread, todayStr }
}

/** 自测与诊断用：清空本机任务相关三张表（不碰其它业务数据） */
export async function clearTaskTables(): Promise<void> {
  await db.transaction('rw', [db.tasks, db.taskReminders, db.taskOccurrences], async () => {
    await db.tasks.clear()
    await db.taskReminders.clear()
    await db.taskOccurrences.clear()
  })
}

export type { TaskStatus }