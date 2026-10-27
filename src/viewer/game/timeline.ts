/**
 * T6-F 把时光排好（时间线排序）。
 *
 * 硬边界（与同目录其他玩法一致）：
 * - **只读**：素材来自已发布的 `PublicEntry` / `PublicPhoto`，不写作者数据库、不碰发布版本；
 * - **可信日期只取 `PublicEntry.occurredAt`**：不用照片 takenAt、不用创建时间冒充；
 * - **同日跳过**：同一天只保留最早一条记录，避免「谁先谁后」无法判定；
 * - **进度只存 localStorage**，键里带 `publishId` 与难度，换一版不会串成绩；
 * - 没有上传、没有服务端、没有强制倒计时。
 */
import type { PublicEntry } from '../types'
import { shuffleWithSeed } from './memory'

export type TimelineDifficulty = 'easy' | 'standard'

export const TIMELINE_ITEM_COUNTS: Record<TimelineDifficulty, number> = {
  easy: 3,
  standard: 5,
}

export interface TimelineItem {
  entryId: string
  title: string
  /** 可信日期，仅来自 PublicEntry.occurredAt */
  occurredAt: string
  /** occurredAt 解析出的毫秒时间戳，排序用 */
  time: number
  /** 该记录关联的照片 id；是否可用（有缩略图）由界面层判断 */
  photoIds: string[]
}

export interface TimelinePuzzle {
  difficulty: TimelineDifficulty
  /** 打乱后的出题顺序 */
  items: TimelineItem[]
  /** 按时间升序的正确答案 */
  answer: TimelineItem[]
}

export interface TimelineRecord {
  /** 单局最多排对的位置数 */
  bestCorrect: number
  /** 全部排对时的最短用时；从未全对则为 0 */
  bestMs: number
  /** 全部排对的局数 */
  clears: number
  /** 提交过的总局数 */
  plays: number
}

/** 兼容纯日期与 ISO 字符串；解析不了返回 null（该条不参与出题） */
function parseTime(value: string): number | null {
  if (!value) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split('-').map(Number)
    const date = new Date(y, m - 1, d)
    return Number.isNaN(date.getTime()) ? null : date.getTime()
  }
  const time = new Date(value).getTime()
  return Number.isNaN(time) ? null : time
}

/** 按本地日历取「日」粒度，用于同日去重 */
function dayKey(time: number): string {
  const d = new Date(time)
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}

/**
 * 可出题的记录池：只保留 occurredAt 可解析的记录，按时间升序，
 * 同一天只留最早一条（同日跳过，避免并列先后无法判定）。
 */
export function buildTimelinePool(entries: PublicEntry[] | undefined): TimelineItem[] {
  const withTime = (entries ?? [])
    .map((entry) => ({ entry, time: parseTime(entry.occurredAt) }))
    .filter((item): item is { entry: PublicEntry; time: number } => item.time !== null)
    .sort((a, b) => a.time - b.time || (a.entry.id < b.entry.id ? -1 : 1))
  const seenDays = new Set<string>()
  const pool: TimelineItem[] = []
  for (const { entry, time } of withTime) {
    const key = dayKey(time)
    if (seenDays.has(key)) continue
    seenDays.add(key)
    pool.push({
      entryId: entry.id,
      title: entry.title,
      occurredAt: entry.occurredAt,
      time,
      photoIds: entry.photoIds ?? [],
    })
  }
  return pool
}

/**
 * 出题：从记录池里按 seed 确定性抽取并打乱。
 * 同一个 seed 一定复现同一组题与同一个打乱顺序；素材不足返回 null，不用重复记录凑数。
 */
export function buildTimelinePuzzle(
  entries: PublicEntry[] | undefined,
  publishId: string,
  seed: string,
  difficulty: TimelineDifficulty,
): TimelinePuzzle | null {
  const count = TIMELINE_ITEM_COUNTS[difficulty]
  const pool = buildTimelinePool(entries)
  if (pool.length < count) return null
  const picked = shuffleWithSeed(pool, `${publishId}|timeline-pick|${seed}`).slice(0, count)
  const answer = [...picked].sort((a, b) => a.time - b.time || (a.entryId < b.entryId ? -1 : 1))
  let items = shuffleWithSeed(answer, `${publishId}|timeline-order|${seed}`)
  if (items.every((item, index) => item.entryId === answer[index].entryId)) {
    // 少数情况下打乱结果恰好是正解，交换前两条避免「开局即答案」
    items = [items[1], items[0], ...items.slice(2)]
  }
  return { difficulty, items, answer }
}

/** 上移/下移一步；越界时原样返回（按钮本身也会禁用，这里是双保险） */
export function moveTimelineItem(order: string[], index: number, delta: -1 | 1): string[] {
  const target = index + delta
  if (index < 0 || index >= order.length || target < 0 || target >= order.length) return order
  const next = [...order]
  ;[next[index], next[target]] = [next[target], next[index]]
  return next
}

/** 逐位置判定：返回数组第 i 位表示「当前第 i 张卡片放对了吗」 */
export function gradeTimeline(answer: TimelineItem[], order: string[]): boolean[] {
  return order.map((id, index) => answer[index]?.entryId === id)
}

/* ------------------------------------------------------------------ */
/* 本地成绩：只写 localStorage，键按发布版本与难度隔离                     */
/* ------------------------------------------------------------------ */

const storageKey = (publishId: string, difficulty: TimelineDifficulty) =>
  `heartlog.game.timeline.v1.${publishId || 'unknown'}.${difficulty}`

export function loadTimelineRecord(publishId: string, difficulty: TimelineDifficulty): TimelineRecord | null {
  try {
    const raw = localStorage.getItem(storageKey(publishId, difficulty))
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<TimelineRecord>
    if (typeof parsed?.bestCorrect !== 'number' || typeof parsed?.plays !== 'number') return null
    return {
      bestCorrect: parsed.bestCorrect,
      bestMs: typeof parsed.bestMs === 'number' ? parsed.bestMs : 0,
      clears: typeof parsed.clears === 'number' ? parsed.clears : 0,
      plays: parsed.plays,
    }
  } catch {
    // 隐私模式 / 存储被禁用：没有成绩可看，但不该影响玩
    return null
  }
}

export function saveTimelineRecord(
  publishId: string,
  difficulty: TimelineDifficulty,
  result: { correct: number; total: number; ms: number },
): TimelineRecord {
  const prev = loadTimelineRecord(publishId, difficulty)
  const cleared = result.correct === result.total
  const record: TimelineRecord = {
    bestCorrect: Math.max(prev?.bestCorrect ?? 0, result.correct),
    bestMs: cleared ? (prev && prev.bestMs > 0 ? Math.min(prev.bestMs, result.ms) : result.ms) : prev?.bestMs ?? 0,
    clears: (prev?.clears ?? 0) + (cleared ? 1 : 0),
    plays: (prev?.plays ?? 0) + 1,
  }
  try {
    localStorage.setItem(storageKey(publishId, difficulty), JSON.stringify(record))
  } catch {
    // 写不进去就只在本次会话里显示，不弹错
  }
  return record
}
