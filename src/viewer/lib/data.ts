import { daysBetween, fmtDate, fmtDateShort, nextOccurrence, parseAny, startOfDay } from '../../lib/date'
import type {
  EntryKind,
  EvidenceType,
  HealthStatus,
  Mood,
  PublicAnniversary,
  PublicEntry,
  PublicPhoto,
  PreferenceDirection,
  PublishedSnapshot,
  WishStatus,
} from '../types'
import { placeholderAvatar } from '../data/media'

/* ------------------------------------------------------------------ */
/* 文案                                                                */
/* ------------------------------------------------------------------ */

export const MOOD_LABEL: Record<Mood, string> = {
  happy: '开心',
  calm: '平静',
  low: '低落',
  anxious: '不安',
  angry: '生气',
  custom: '自定义',
}

export const KIND_LABEL: Record<EntryKind, string> = {
  daily: '日常',
  date: '相处',
  gift: '礼物',
  interest: '兴趣',
  health: '健康',
  emotion: '心情',
  other: '其他',
}

export const DIRECTION_LABEL: Record<PreferenceDirection, string> = {
  like: '喜欢',
  dislike: '不喜欢',
  want: '想尝试',
}

export const WISH_LABEL: Record<WishStatus, string> = {
  wish: '想要',
  gifted: '已送出',
  fulfilled: '已实现',
  paused: '先放着',
}

export const HEALTH_LABEL: Record<HealthStatus, string> = {
  ongoing: '进行中',
  watching: '观察中',
  recovered: '已恢复',
}

export const EVIDENCE_LABEL: Record<EvidenceType, string> = {
  stated: 'TA 明确说过',
  repeated: '多次记录体现',
  hypothesis: '待进一步观察',
}

/* ------------------------------------------------------------------ */
/* 统计                                                                */
/* ------------------------------------------------------------------ */

export function snapshotCounts(s: PublishedSnapshot) {
  return {
    entries: s.entries.length,
    photos: s.photos.length,
    preferences: s.preferences.length,
    wishes: s.wishes.length,
    gifts: s.gifts.length,
    health: s.health.length,
    insights: s.insights.length,
    summaries: s.summaries.length,
    anniversaries: s.anniversaries.length,
    days: s.person.meetDate ? daysSinceDate(s.person.meetDate) : null,
  }
}

/** 从相识日到今天的天数；不伪造「恋爱日」语义 */
export function daysSinceDate(dateStr: string): number | null {
  if (!dateStr) return null
  const d = parseAny(dateStr)
  if (Number.isNaN(d.getTime())) return null
  return Math.max(0, daysBetween(d, new Date()) + 1)
}

/* ------------------------------------------------------------------ */
/* 纪念日                                                              */
/* ------------------------------------------------------------------ */

export interface UpcomingAnniversary {
  item: PublicAnniversary
  date: Date
  daysLeft: number
  /** 已过的年数；单次日期没有 */
  years?: number
}

export function upcomingAnniversaries(s: PublishedSnapshot): UpcomingAnniversary[] {
  const out: UpcomingAnniversary[] = []
  const today = startOfDay(new Date())

  for (const a of s.anniversaries) {
    if (!a.date) continue
    if (!a.repeatYearly) {
      const d = startOfDay(parseAny(a.date))
      const daysLeft = daysBetween(today, d)
      if (daysLeft >= 0) out.push({ item: a, date: d, daysLeft })
      continue
    }
    const next = nextOccurrence(a.date, a.calendarType, new Date())
    if (!next) continue
    const startYear = Number(a.date.split('-')[0])
    const years = startYear > 1900 ? next.date.getFullYear() - startYear : undefined
    out.push({ item: a, date: next.date, daysLeft: next.daysLeft, years })
  }

  out.sort((x, y) => x.daysLeft - y.daysLeft)
  return out
}

export function anniversaryDateText(a: PublicAnniversary): string {
  const [y, m, d] = a.date.split('-').map(Number)
  if (!m || !d) return '未设置'
  const md = `${m} 月 ${d} 日`
  return a.calendarType === 'lunar' ? `农历 ${md}` : `${y} 年 ${md}`
}

export function daysLeftText(n: number): string {
  if (n === 0) return '就是今天'
  if (n === 1) return '明天'
  return `还有 ${n} 天`
}

/* ------------------------------------------------------------------ */
/* 记录                                                                */
/* ------------------------------------------------------------------ */

export function sortEntriesDesc(entries: PublicEntry[]): PublicEntry[] {
  return [...entries].sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : -1))
}

export function recentEntries(s: PublishedSnapshot, limit: number): PublicEntry[] {
  return sortEntriesDesc(s.entries).slice(0, limit)
}

export interface MonthGroup {
  key: string
  label: string
  entries: PublicEntry[]
}

export function groupByMonth(entries: PublicEntry[]): MonthGroup[] {
  const map = new Map<string, PublicEntry[]>()
  for (const e of sortEntriesDesc(entries)) {
    const d = parseAny(e.occurredAt)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    const list = map.get(key)
    if (list) list.push(e)
    else map.set(key, [e])
  }
  return [...map.entries()].map(([key, list]) => {
    const [y, m] = key.split('-')
    return { key, label: `${y} 年 ${Number(m)} 月`, entries: list }
  })
}

export function searchEntries(entries: PublicEntry[], query: string): PublicEntry[] {
  const q = query.trim().toLowerCase()
  if (!q) return entries
  return entries.filter((e) =>
    [e.title, e.content, e.taSaid, e.myObservation, e.tags.join(' ')]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
      .includes(q),
  )
}

export function entryById(s: PublishedSnapshot, id: string): PublicEntry | undefined {
  return s.entries.find((e) => e.id === id)
}

export function photosOfEntry(s: PublishedSnapshot, entryId: string): PublicPhoto[] {
  return s.photos.filter((p) => p.entryId === entryId)
}

/**
 * 头像地址：优先用人物设置的头像照片（缩略图），其次封面，最后才是占位图。
 * 合成数据没有真实头像照片，会自然落到占位；真实快照则显示作者选定的照片。
 */
export function avatarUrlFor(s: PublishedSnapshot): string {
  const id = s.person.avatarPhotoId || s.config.coverPhotoId
  if (id) {
    const photo = s.photos.find((p) => p.id === id)
    if (photo) return photo.media.thumb.url || photo.media.full.url
  }
  return placeholderAvatar(s.person.id || 'heartlog')
}

export function photoById(s: PublishedSnapshot, id?: string): PublicPhoto | undefined {
  if (!id) return undefined
  return s.photos.find((p) => p.id === id)
}

export function photosDesc(s: PublishedSnapshot): PublicPhoto[] {
  return [...s.photos].sort((a, b) => ((a.takenAt ?? '') < (b.takenAt ?? '') ? 1 : -1))
}

export function entryTitleById(s: PublishedSnapshot, id: string): string | undefined {
  const e = entryById(s, id)
  return e ? e.title : undefined
}

/* ------------------------------------------------------------------ */
/* 展示格式                                                            */
/* ------------------------------------------------------------------ */

export function entryDateText(iso: string): string {
  return fmtDate(parseAny(iso))
}

export function entryDateShort(iso: string): string {
  return fmtDateShort(parseAny(iso))
}

export function photoDateText(p: PublicPhoto): string {
  return p.takenAt ? fmtDateShort(parseAny(p.takenAt)) : '日期未知'
}

/** 列表摘要：优先正文，其次原话，最后观察 */
export function entryExcerpt(e: PublicEntry, max = 74): string {
  const raw = e.content || e.taSaid || e.myObservation || ''
  const text = raw.replace(/\s+/g, ' ').trim()
  if (!text) return ''
  return text.length > max ? `${text.slice(0, max)}…` : text
}
