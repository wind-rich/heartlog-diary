import type { DailyStatus, Entry, EntryType, Gift, HealthRecord, Photo, PortraitInsight, Preference, Wish } from '../db/types'
import { parseAny, startOfDay, endOfDay, toDateStr } from './date'

export interface EntryFilter {
  types?: EntryType[]
  tags?: string[]
  keyword?: string
  from?: Date
  to?: Date
}

export function entryMatches(e: Entry, f: EntryFilter): boolean {
  if (f.types && f.types.length && !f.types.includes(e.type)) return false
  if (f.tags && f.tags.length) {
    const has = f.tags.some((t) => (e.tagList ?? []).includes(t))
    if (!has) return false
  }
  const at = parseAny(e.occurredAt)
  if (f.from && at.getTime() < startOfDay(f.from).getTime()) return false
  if (f.to && at.getTime() > endOfDay(f.to).getTime()) return false
  if (f.keyword && f.keyword.trim()) {
    const kw = f.keyword.trim().toLowerCase()
    const hay = [e.title, e.content, e.taSaid, e.myObservation, e.followUp, (e.tagList ?? []).join(' ')]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
    if (!hay.includes(kw)) return false
  }
  return true
}

export function filterEntries(entries: Entry[], f: EntryFilter): Entry[] {
  return entries.filter((e) => entryMatches(e, f))
}

export function collectTags(entries: Entry[]): { tag: string; count: number }[] {
  const map = new Map<string, number>()
  for (const e of entries) {
    for (const t of e.tagList ?? []) map.set(t, (map.get(t) ?? 0) + 1)
  }
  return Array.from(map.entries())
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
}

/** 按日期分组（yyyy-MM-dd -> entries），组内按时间倒序 */
export function groupByDay(entries: Entry[]): { date: string; items: Entry[] }[] {
  const map = new Map<string, Entry[]>()
  for (const e of entries) {
    const key = toDateStr(e.occurredAt)
    const list = map.get(key) ?? []
    list.push(e)
    map.set(key, list)
  }
  return Array.from(map.entries())
    .map(([date, items]) => ({
      date,
      items: items.sort((a, b) => parseAny(b.occurredAt).getTime() - parseAny(a.occurredAt).getTime()),
    }))
    .sort((a, b) => (a.date < b.date ? 1 : -1))
}

/* ------------------------------------------------------------------ */
/* 全局检索（用于「自然语言查询」的本地兜底）                          */
/* ------------------------------------------------------------------ */

export interface SearchHit {
  kind: 'entry' | 'preference' | 'wish' | 'gift' | 'health' | 'status' | 'insight' | 'photo'
  id: string
  title: string
  snippet: string
  at: string
  score: number
}

const STOP_WORDS = new Set([
  '的','了','是','我','你','他','她','ta','TA','有','在','和','与','吗','呢','什么','哪些','一下','之前','以前','提过','说过','想要','想','要','有没有','有没有什么','最近','请问','关于','这个','那个','帮我','看看','关于',
])

/** 极简中文分词：按 2 字滑窗 + 英文单词切分，够本地检索用 */
export function tokenize(text: string): string[] {
  const tokens: string[] = []
  const cleaned = text.replace(/[\s,，。？！、；：""''（）()【】\[\]]+/g, ' ')
  for (const part of cleaned.split(' ')) {
    if (!part) continue
    if (/^[a-zA-Z0-9]+$/.test(part)) {
      if (!STOP_WORDS.has(part)) tokens.push(part.toLowerCase())
      continue
    }
    for (let i = 0; i < part.length; i++) {
      const g2 = part.slice(i, i + 2)
      if (g2.length === 2 && !STOP_WORDS.has(g2)) tokens.push(g2)
      const g1 = part[i]
      if (part.length === 1 && !STOP_WORDS.has(g1)) tokens.push(g1)
    }
    if (part.length >= 3 && !STOP_WORDS.has(part)) tokens.push(part)
  }
  return Array.from(new Set(tokens)).slice(0, 12)
}

function scoreText(tokens: string[], text: string): number {
  if (!text) return 0
  const lower = text.toLowerCase()
  let score = 0
  for (const t of tokens) {
    let idx = lower.indexOf(t)
    let hit = 0
    while (idx >= 0 && hit < 5) {
      hit++
      idx = lower.indexOf(t, idx + t.length)
    }
    score += hit * (t.length >= 3 ? 3 : t.length === 2 ? 2 : 1)
  }
  return score
}

export interface SearchableData {
  entries: Entry[]
  preferences: Preference[]
  wishes: Wish[]
  gifts: Gift[]
  health: HealthRecord[]
  statuses: DailyStatus[]
  insights: PortraitInsight[]
  photos: Photo[]
}

export function searchLocal(data: SearchableData, query: string, limit = 40): SearchHit[] {
  const tokens = tokenize(query)
  if (!tokens.length) return []
  const hits: SearchHit[] = []
  const push = (h: Omit<SearchHit, 'score'>, text: string) => {
    const score = scoreText(tokens, text)
    if (score > 0) hits.push({ ...h, score })
  }

  for (const e of data.entries) {
    push(
      {
        kind: 'entry',
        id: e.id,
        title: e.title || '（无标题）',
        snippet: [e.content, e.taSaid, e.myObservation].filter(Boolean).join(' · ').slice(0, 120),
        at: e.occurredAt,
      },
      [e.title, e.content, e.taSaid, e.myObservation, e.followUp, (e.tagList ?? []).join(' ')].join(' '),
    )
  }
  for (const p of data.preferences) {
    push(
      { kind: 'preference', id: p.id, title: p.name, snippet: [p.category, p.note].filter(Boolean).join(' · '), at: p.updatedAt },
      [p.name, p.note, p.category, (p.tags ?? []).join(' ')].join(' '),
    )
  }
  for (const w of data.wishes) {
    push(
      { kind: 'wish', id: w.id, title: w.content, snippet: w.note ?? '', at: w.raisedAt ?? w.createdAt },
      [w.content, w.note, w.occasion].filter(Boolean).join(' '),
    )
  }
  for (const g of data.gifts) {
    push(
      { kind: 'gift', id: g.id, title: g.name, snippet: [g.occasion, g.feedback].filter(Boolean).join(' · '), at: g.givenAt },
      [g.name, g.occasion, g.feedback, g.note].filter(Boolean).join(' '),
    )
  }
  for (const h of data.health) {
    push(
      { kind: 'health', id: h.id, title: h.symptom, snippet: [h.medication, h.note].filter(Boolean).join(' · '), at: h.occurredAt },
      [h.symptom, h.medication, h.note, h.recovery].filter(Boolean).join(' '),
    )
  }
  for (const s of data.statuses) {
    push(
      { kind: 'status', id: s.id, title: `${s.date} 每日状态`, snippet: [s.goodThing, s.worry].filter(Boolean).join(' · '), at: s.date },
      [s.goodThing, s.worry, s.needAttention, s.note].filter(Boolean).join(' '),
    )
  }
  for (const i of data.insights) {
    push(
      { kind: 'insight', id: i.id, title: i.description, snippet: i.dimension, at: i.updatedAt },
      [i.description, i.dimension].join(' '),
    )
  }
  for (const p of data.photos) {
    push(
      { kind: 'photo', id: p.id, title: p.caption || '照片', snippet: (p.tags ?? []).join(' '), at: p.takenAt ?? p.createdAt },
      [p.caption, (p.tags ?? []).join(' ')].join(' '),
    )
  }

  return hits.sort((a, b) => b.score - a.score).slice(0, limit)
}
