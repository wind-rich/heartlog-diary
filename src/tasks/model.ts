/**
 * T8 待办与提醒的纯计算层（无 Dexie、无 DOM）。
 *
 * 为什么单独一层：日期/时区/重复规则最容易写错，也最需要被自动测试覆盖。
 * 这一层只做「输入 → 输出」的确定性计算，离线自测可以直接调用它。
 *
 * 三条硬规则：
 * 1. 截止时间（dueDate/dueTime）与提醒时间（TaskReminder）完全独立。没有截止日期也能设提醒。
 * 2. 重复按**日历**推进（每日/每周/每月），不用固定毫秒数；月末不存在时向该月最后一天收敛，
 *    并在界面说明，不让 1-31 的任务在 2 月直接消失。
 * 3. 时区显式参与计算。墙钟 → 绝对时刻的换算用 Intl 取真实偏移，
 *    不靠「本机时区恰好是东八区」的假设。
 */
import {
  DEFAULT_DUE_TIME,
  DEFAULT_TIME_ZONE,
  MAX_LOOKBACK_DAYS,
  type RepeatFreq,
  type Task,
  type TaskOccurrence,
  type TaskReminder,
} from './types'

/* ------------------------------------------------------------------ */
/* 时区与墙钟                                                          */
/* ------------------------------------------------------------------ */

/**
 * 某个绝对时刻在指定时区的偏移（毫秒，东八区为 +8h）。
 * 用 Intl 反解，不解析时区名字符串。
 */
export function zoneOffsetMs(timeZone: string, atMs: number): number {
  try {
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
    const parts = dtf.formatToParts(new Date(atMs))
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0)
    // hour 在 hour12:false 下可能给出 24，归一到 0
    const hour = get('hour') % 24
    const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), hour, get('minute'), get('second'))
    return asUtc - atMs
  } catch {
    // 不认识的时区名：退回本机偏移，至少不会算出 NaT
    return -new Date(atMs).getTimezoneOffset() * 60_000
  }
}

/** 墙钟（日期 + 时刻，指定时区）→ 绝对时刻 ms；无效输入返回 NaN */
export function wallClockToMs(date: string, time: string, timeZone: string): number {
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (!dm) return NaN
  const tm = /^(\d{1,2}):(\d{2})$/.exec(time || DEFAULT_DUE_TIME)
  if (!tm) return NaN
  const y = Number(dm[1])
  const mo = Number(dm[2])
  const d = Number(dm[3])
  const h = Number(tm[1])
  const mi = Number(tm[2])
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return NaN
  const naive = Date.UTC(y, mo - 1, d, h, mi, 0)
  // 两次校正：先按「把 naive 当作 UTC」时的偏移修正，再复核一次以处理夏令时边界
  let guess = naive - zoneOffsetMs(timeZone, naive)
  guess = naive - zoneOffsetMs(timeZone, guess)
  return guess
}

/** 绝对时刻 → 该时区的墙钟 { date: yyyy-MM-dd, time: HH:mm } */
export function msToWallClock(ms: number, timeZone: string): { date: string; time: string } {
  const off = zoneOffsetMs(timeZone, ms)
  const d = new Date(ms + off)
  const pad = (n: number) => String(n).padStart(2, '0')
  return {
    date: `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`,
    time: `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`,
  }
}

/** 该时区里「今天」的 yyyy-MM-dd */
export function todayInZone(timeZone: string, nowMs = Date.now()): string {
  return msToWallClock(nowMs, timeZone).date
}

/** 日期加减（纯日历，不经过时区） */
export function addDaysStr(date: string, days: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (!m) return date
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + days))
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
}

/** 两个日期之间相差的整天数（b - a） */
export function diffDays(a: string, b: string): number {
  const pa = Date.UTC(Number(a.slice(0, 4)), Number(a.slice(5, 7)) - 1, Number(a.slice(8, 10)))
  const pb = Date.UTC(Number(b.slice(0, 4)), Number(b.slice(5, 7)) - 1, Number(b.slice(8, 10)))
  return Math.round((pb - pa) / 86_400_000)
}

/** 某月天数 */
function daysInMonth(year: number, month1: number): number {
  return new Date(Date.UTC(year, month1, 0)).getUTCDate()
}

/**
 * 按月推进。
 * 月末处理：目标日在该月不存在时收敛到该月最后一天（31 号 → 2 月 28/29 号）。
 * 收敛后**不**记住 31，下个月仍按原始日号 31 计算，避免一次收敛导致永久漂移。
 */
export function addMonthsClamped(date: string, months: number): string {
  const y = Number(date.slice(0, 4))
  const mo = Number(date.slice(5, 7))
  const d = Number(date.slice(8, 10))
  const target = new Date(Date.UTC(y, mo - 1 + months, 1))
  const ty = target.getUTCFullYear()
  const tmo = target.getUTCMonth() + 1
  const td = Math.min(d, daysInMonth(ty, tmo))
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${ty}-${pad(tmo)}-${pad(td)}`
}

/* ------------------------------------------------------------------ */
/* 重复规则的日期序列                                                   */
/* ------------------------------------------------------------------ */

/**
 * 生成从 anchor 开始、按规则推进的日期序列，最多 limit 个。
 * 用「从 anchor 直接算第 n 次」而不是「上一次次次累加」：
 * 月末收敛后不会累积漂移（1-31 → 2-28 → 3-31，而不是 3-28）。
 */
export function repeatDates(anchor: string, freq: RepeatFreq, interval: number, limit: number): string[] {
  const step = Math.max(1, Math.floor(interval || 1))
  const out: string[] = []
  for (let n = 0; n < limit; n++) {
    if (freq === 'daily') out.push(addDaysStr(anchor, n * step))
    else if (freq === 'weekly') out.push(addDaysStr(anchor, n * 7 * step))
    else out.push(addMonthsClamped(anchor, n * step))
  }
  return out
}

/* ------------------------------------------------------------------ */
/* 提醒 → 触发时刻                                                      */
/* ------------------------------------------------------------------ */

export interface PlanSlot {
  /** 幂等键的一部分：该次触发的绝对时刻 */
  atMs: number
  /** 该次触发对应的「事项日期」（用于展示与完成判定） */
  date: string
  reminderId: string
}

/**
 * 一个提醒计划在 [fromMs, toMs] 窗口内应触发的时刻。
 *
 * - 非重复任务：只有一次。
 * - 重复任务：mode=absolute 用 `time` 配每次发生的日期；mode=before 用每次发生的截止时刻减偏移。
 * - mode=before 但没有截止日期 → 无触发（调用方把它标成「计划无效」，不静默当提醒）。
 * - snoozedUntil 优先：稍后提醒期间不再按原计划触发。
 */
export function slotsForReminder(task: Task, r: TaskReminder, fromMs: number, toMs: number): PlanSlot[] {
  if (!r.enabled) return []
  const tz = task.timeZone || DEFAULT_TIME_ZONE

  if (r.snoozedUntil) {
    const snoozeMs = Date.parse(r.snoozedUntil)
    if (Number.isFinite(snoozeMs)) {
      // 稍后提醒到点后，只触发这一次；之后回到正常计划
      if (snoozeMs >= fromMs && snoozeMs <= toMs) {
        const wall = msToWallClock(snoozeMs, tz)
        return [{ atMs: snoozeMs, date: wall.date, reminderId: r.id }]
      }
      return []
    }
  }

  const repeat = task.repeat
  const anchor = task.dueDate
  const dueTime = task.dueTime || DEFAULT_DUE_TIME

  // 非重复
  if (!repeat) {
    if (r.mode === 'absolute') {
      if (!r.date) return []
      const at = wallClockToMs(r.date, r.time || dueTime, tz)
      if (!Number.isFinite(at)) return []
      return at >= fromMs && at <= toMs ? [{ atMs: at, date: r.date, reminderId: r.id }] : []
    }
    if (!anchor) return []
    const dueMs = wallClockToMs(anchor, dueTime, tz)
    if (!Number.isFinite(dueMs)) return []
    const at = dueMs - Math.max(0, r.offsetMinutes ?? 0) * 60_000
    return at >= fromMs && at <= toMs ? [{ atMs: at, date: anchor, reminderId: r.id }] : []
  }

  // 重复：按日历生成发生日期，再逐个换算
  if (!anchor) return []
  const dates = repeatDates(anchor, repeat.freq, repeat.interval, 400)
  const out: PlanSlot[] = []
  for (const date of dates) {
    const base = wallClockToMs(date, dueTime, tz)
    if (!Number.isFinite(base)) continue
    const at = r.mode === 'absolute' ? wallClockToMs(date, r.time || dueTime, tz) : base - Math.max(0, r.offsetMinutes ?? 0) * 60_000
    if (!Number.isFinite(at)) continue
    if (at > toMs) break // 日期递增，后面的更晚
    if (at >= fromMs) out.push({ atMs: at, date, reminderId: r.id })
  }
  return out
}

/** 计划下一次（或当前窗口内最近一次）触发；没有则 undefined */
export function nextTrigger(task: Task, reminders: TaskReminder[], fromMs = Date.now()): PlanSlot | undefined {
  const to = fromMs + 400 * 86_400_000
  const all = reminders.flatMap((r) => slotsForReminder(task, r, fromMs, to))
  all.sort((a, b) => a.atMs - b.atMs)
  return all[0]
}

/**
 * 已错过但仍在补看窗口内的触发（用于打开页面/回前台时补发站内提醒）。
 *
 * 策略（大纲要求「漏过多次提醒时汇总，避免一口气推全部历史」）：
 * 每个提醒只补**最近一次**漏过的，更早的计入 suppressed，界面汇总成「还有 N 次已错过」。
 */
export function missedSlots(
  task: Task,
  reminders: TaskReminder[],
  nowMs = Date.now(),
  lookbackDays = MAX_LOOKBACK_DAYS,
): { latest: PlanSlot[]; suppressed: number } {
  const from = nowMs - lookbackDays * 86_400_000
  const perReminder = reminders.map((r) => slotsForReminder(task, r, from, nowMs))
  const latest: PlanSlot[] = []
  let suppressed = 0
  for (const slots of perReminder) {
    if (!slots.length) continue
    latest.push(slots[slots.length - 1])
    suppressed += slots.length - 1
  }
  return { latest, suppressed }
}

/* ------------------------------------------------------------------ */
/* 实例                                                                 */
/* ------------------------------------------------------------------ */

/** 实例幂等键：同任务同分钟只会有一行 */
export function occurrenceId(taskId: string, atMs: number): string {
  return `${taskId}@${atMs}`
}

export function makeOccurrence(task: Task, slot: PlanSlot, nowISO: string): TaskOccurrence {
  const tz = task.timeZone || DEFAULT_TIME_ZONE
  const wall = msToWallClock(slot.atMs, tz)
  return {
    id: occurrenceId(task.id, slot.atMs),
    taskId: task.id,
    slotAt: new Date(slot.atMs).toISOString(),
    slotLocal: `${wall.date} ${wall.time}`,
    planIds: [slot.reminderId],
    firedAt: nowISO,
    createdAt: nowISO,
    updatedAt: nowISO,
  }
}

/* ------------------------------------------------------------------ */
/* 清单分组                                                             */
/* ------------------------------------------------------------------ */

export type TaskBucket = 'overdue' | 'today' | 'upcoming' | 'unscheduled' | 'done' | 'cancelled'

/**
 * 把一个任务归入某个清单分组。
 * - 取消与已完成不混入活跃清单。
 * - 没有截止日期 → unscheduled（仍可能有提醒）。
 */
export function bucketOf(task: Task, todayStr: string): TaskBucket {
  if (task.status === 'cancelled') return 'cancelled'
  if (task.status === 'done') return 'done'
  if (!task.dueDate) return 'unscheduled'
  const d = diffDays(todayStr, task.dueDate)
  if (d < 0) return 'overdue'
  if (d === 0) return 'today'
  return 'upcoming'
}

/** 展示用：距截止还有几天 / 逾期几天 */
export function dueLabel(task: Task, todayStr: string): string {
  if (!task.dueDate) return '未安排'
  const d = diffDays(todayStr, task.dueDate)
  if (d === 0) return '今天'
  if (d === 1) return '明天'
  if (d === -1) return '逾期 1 天'
  if (d < 0) return `逾期 ${-d} 天`
  return `${d} 天后`
}

/** 提醒的可读描述 */
export function reminderLabel(r: TaskReminder): string {
  if (r.snoozedUntil) {
    const d = new Date(r.snoozedUntil)
    return `稍后提醒（${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}）`
  }
  if (r.mode === 'absolute') return `${r.date ?? '未设日期'} ${r.time || DEFAULT_DUE_TIME}`
  const m = Math.max(0, r.offsetMinutes ?? 0)
  if (m === 0) return '到点时提醒'
  if (m % 1440 === 0) return `提前 ${m / 1440} 天`
  if (m % 60 === 0) return `提前 ${m / 60} 小时`
  return `提前 ${m} 分钟`
}

/**
 * 这个任务的提醒计划是否真的会响。
 * 找不到任何一个可计算的触发点 → 返回原因，界面据此显示「计划无效」而不是假装已启用。
 */
export function planProblem(task: Task, reminders: TaskReminder[]): string | null {
  const enabled = reminders.filter((r) => r.enabled)
  if (!enabled.length) return '还没有设置提醒'
  if (task.status !== 'open') return '任务已结束，提醒不会触发'
  const hasDue = Boolean(task.dueDate)
  for (const r of enabled) {
    if (r.mode === 'before' && !hasDue) return '「提前提醒」需要先填截止日期'
    if (r.mode === 'absolute' && !task.repeat && !r.date) return '提醒缺少日期'
  }
  return null
}