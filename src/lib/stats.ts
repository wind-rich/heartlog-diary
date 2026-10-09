import type {
  DailyStatus,
  Entry,
  Gift,
  HealthRecord,
  Mood,
  Person,
  Photo,
  PortraitInsight,
  Preference,
  Wish,
} from '../db/types'
import {
  addDays,
  daysBetween,
  eachDay,
  endOfDay,
  fmtDate,
  fmtDateShort,
  lunarInfoOf,
  nextOccurrence,
  parseAny,
  startOfDay,
  toDateStr,
} from './date'
import { EVIDENCE_TYPES, entryTypeMeta, moodMeta, HEALTH_STATUS, WISH_STATUS, prefCategoryMeta } from './constants'
import type { Mood as MoodType } from '../db/types'

/** 心情显示文案（自定义心情取用户填写的内容） */
export function moodLabelOf(mood?: MoodType, custom?: string): string {
  if (!mood) return '未记录'
  if (mood === 'custom') return custom || '自定义'
  const meta = moodMeta(mood)
  return meta ? `${meta.emoji} ${meta.label}` : String(mood)
}

export interface RangeBundle {
  entries: Entry[]
  statuses: DailyStatus[]
  preferences: Preference[]
  wishes: Wish[]
  gifts: Gift[]
  health: HealthRecord[]
  photos: Photo[]
  insights: PortraitInsight[]
}

export function inRange(iso: string, start: Date, end: Date): boolean {
  const t = parseAny(iso).getTime()
  return t >= startOfDay(start).getTime() && t <= endOfDay(end).getTime()
}

export function collectBundle(
  all: {
    entries: Entry[]
    statuses: DailyStatus[]
    preferences: Preference[]
    wishes: Wish[]
    gifts: Gift[]
    health: HealthRecord[]
    photos: Photo[]
    insights: PortraitInsight[]
  },
  start: Date,
  end: Date,
): RangeBundle {
  return {
    entries: all.entries.filter((e) => inRange(e.occurredAt, start, end)),
    statuses: all.statuses.filter((s) => {
      const t = parseAny(s.date).getTime()
      return t >= startOfDay(start).getTime() && t <= endOfDay(end).getTime()
    }),
    preferences: all.preferences.filter(
      (p) => inRange(p.updatedAt, start, end) || (p.evidenceEntryIds ?? []).some((id) => all.entries.some((e) => e.id === id && inRange(e.occurredAt, start, end))),
    ),
    wishes: all.wishes.filter((w) => inRange(w.raisedAt ?? w.createdAt, start, end)),
    gifts: all.gifts.filter((g) => inRange(g.givenAt, start, end)),
    health: all.health.filter((h) => inRange(h.occurredAt, start, end) || h.status !== 'recovered'),
    photos: all.photos.filter((p) => inRange(p.takenAt ?? p.createdAt, start, end)),
    insights: all.insights,
  }
}

/* ------------------------------------------------------------------ */
/* 心情统计                                                             */
/* ------------------------------------------------------------------ */

export interface MoodPoint {
  date: string
  /** 有记录才有值，未记录保持为空 */
  mood?: Mood
  moodCustom?: string
  /** 1~5 平均心情程度 */
  level?: number
  /** 当日是否有记录 */
  recorded: boolean
  /** 该日来源：每日状态 / 由事件推导 */
  source?: 'status' | 'entry'
}

export interface MoodStats {
  points: MoodPoint[]
  /** 有记录的天数 */
  recordedDays: number
  /** 区间总天数 */
  totalDays: number
  /** 平均心情程度（仅统计有程度的天数） */
  avgLevel?: number
  /** 各心情出现次数 */
  distribution: { mood: Mood; label: string; emoji: string; count: number }[]
  /** 心情最好的日子 / 最低的日子 */
  bestDay?: MoodPoint
  worstDay?: MoodPoint
}

export function computeMoodStats(statuses: DailyStatus[], entries: Entry[], start: Date, end: Date): MoodStats {
  const statusMap = new Map(statuses.map((s) => [s.date, s]))
  const entryMap = new Map<string, Entry[]>()
  for (const e of entries) {
    const k = toDateStr(e.occurredAt)
    entryMap.set(k, [...(entryMap.get(k) ?? []), e])
  }

  const days = eachDay(start, end)
  const points: MoodPoint[] = days.map((d) => {
    const key = toDateStr(d)
    const st = statusMap.get(key)
    if (st && (st.mood || st.moodLevel)) {
      return {
        date: key,
        mood: st.mood,
        moodCustom: st.moodCustom,
        level: st.moodLevel,
        recorded: true,
        source: 'status',
      }
    }
    const list = (entryMap.get(key) ?? []).filter((e) => e.mood || e.moodLevel)
    if (list.length) {
      const withLevel = list.filter((e) => typeof e.moodLevel === 'number')
      const avg = withLevel.length
        ? withLevel.reduce((sum, e) => sum + (e.moodLevel ?? 0), 0) / withLevel.length
        : undefined
      const counts = new Map<Mood, number>()
      for (const e of list) if (e.mood) counts.set(e.mood, (counts.get(e.mood) ?? 0) + 1)
      const top = Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0]
      return {
        date: key,
        mood: top?.[0],
        moodCustom: top?.[0] === 'custom' ? list.find((e) => e.mood === 'custom')?.moodCustom : undefined,
        level: avg,
        recorded: true,
        source: 'entry',
      }
    }
    return { date: key, recorded: false }
  })

  const recorded = points.filter((p) => p.recorded)
  const withLevel = recorded.filter((p) => typeof p.level === 'number')
  const avgLevel = withLevel.length ? withLevel.reduce((s, p) => s + (p.level ?? 0), 0) / withLevel.length : undefined

  const distMap = new Map<Mood, number>()
  for (const p of recorded) if (p.mood) distMap.set(p.mood, (distMap.get(p.mood) ?? 0) + 1)

  const sortedByLevel = [...withLevel].sort((a, b) => (b.level ?? 0) - (a.level ?? 0))

  return {
    points,
    recordedDays: recorded.length,
    totalDays: days.length,
    avgLevel,
    distribution: Array.from(distMap.entries())
      .map(([mood, count]) => {
        const meta = moodMeta(mood)
        return { mood, label: meta?.label ?? String(mood), emoji: meta?.emoji ?? '·', count }
      })
      .sort((a, b) => b.count - a.count),
    bestDay: sortedByLevel[0],
    worstDay: sortedByLevel[sortedByLevel.length - 1],
  }
}

/* ------------------------------------------------------------------ */
/* 待跟进                                                               */
/* ------------------------------------------------------------------ */

export interface FollowUpItem {
  id: string
  kind: 'entry' | 'health' | 'wish'
  title: string
  detail?: string
  at: string
}

export function collectFollowUps(entries: Entry[], health: HealthRecord[], wishes: Wish[]): FollowUpItem[] {
  const out: FollowUpItem[] = []
  for (const e of entries) {
    if (e.followUp && !e.followUpDone) {
      out.push({ id: e.id, kind: 'entry', title: e.followUp, detail: e.title, at: e.occurredAt })
    }
  }
  for (const h of health) {
    if (h.status !== 'recovered') {
      out.push({
        id: h.id,
        kind: 'health',
        title: h.symptom,
        detail: h.medication || h.note,
        at: h.occurredAt,
      })
    }
  }
  for (const w of wishes) {
    if (w.status === 'wish') {
      out.push({ id: w.id, kind: 'wish', title: w.content, detail: w.occasion || w.note, at: w.raisedAt ?? w.createdAt })
    }
  }
  return out.sort((a, b) => parseAny(b.at).getTime() - parseAny(a.at).getTime())
}

/* ------------------------------------------------------------------ */
/* 临近纪念日                                                           */
/* ------------------------------------------------------------------ */

export interface UpcomingFeast {
  key: string
  name: string
  kind: 'birthday' | 'anniversary' | 'meet'
  date: string
  lunarText?: string
  daysLeft: number
  yearsCount?: number
  festivals: string[]
}

export function collectUpcoming(person: Person | undefined, withinDays = 60): UpcomingFeast[] {
  if (!person) return []
  const out: UpcomingFeast[] = []
  const push = (
    key: string,
    name: string,
    kind: UpcomingFeast['kind'],
    stored: string,
    cal: 'solar' | 'lunar',
  ) => {
    const next = nextOccurrence(stored, cal)
    if (!next) return
    if (next.daysLeft > withinDays) return
    out.push({
      key,
      name,
      kind,
      date: toDateStr(next.date),
      lunarText: lunarInfoOf(next.date).lunarDateStr,
      daysLeft: next.daysLeft,
      yearsCount: stored.split('-')[0] ? new Date().getFullYear() - Number(stored.split('-')[0]) : undefined,
      festivals: [],
    })
  }

  if (person.birthday) push('birthday', `${person.nickname || person.name || 'TA'} 的生日`, 'birthday', person.birthday, person.calendarType)
  if (person.meetDate) push('meet', '相识纪念日', 'meet', person.meetDate, 'solar')
  for (const a of person.anniversaries ?? []) {
    if (!a.repeatYearly) continue
    push(`ann_${a.id}`, a.name || '纪念日', 'anniversary', a.date, a.calendarType)
  }
  return out.sort((a, b) => a.daysLeft - b.daysLeft)
}

/* ------------------------------------------------------------------ */
/* 基础总结（不依赖 AI）                                                */
/* ------------------------------------------------------------------ */

export interface BaseSummaryInput {
  person?: Person
  start: Date
  end: Date
  bundle: RangeBundle
  allEntries: Entry[]
}

export interface BaseSummaryResult {
  markdown: string
  stats: {
    entryCount: number
    photoCount: number
    giftCount: number
    wishCount: number
    healthCount: number
    preferenceCount: number
    recordedDays: number
    totalDays: number
    avgLevel?: number
  }
  mood: MoodStats
}

export function buildBaseSummary(input: BaseSummaryInput): BaseSummaryResult {
  const { bundle, start, end, person } = input
  const mood = computeMoodStats(bundle.statuses, bundle.entries, start, end)
  const name = person?.nickname || person?.name || 'TA'
  const lines: string[] = []

  const rangeText =
    toDateStr(start) === toDateStr(end) ? fmtDate(start) : `${fmtDate(start)} 至 ${fmtDate(end)}`

  lines.push(`# ${name} 的这段时间（${rangeText}）`)
  lines.push('')
  lines.push(
    `> 本报告由记录直接汇总生成，未使用 AI。区间共 ${mood.totalDays} 天，其中 ${mood.recordedDays} 天有记录。`,
  )
  lines.push('')

  // 重要事件
  lines.push(`## 一、发生的事（${bundle.entries.length} 条）`)
  lines.push('')
  if (!bundle.entries.length) {
    lines.push('这段时间没有记录事件。')
    lines.push('')
  } else {
    const byType = new Map<string, Entry[]>()
    for (const e of bundle.entries) byType.set(e.type, [...(byType.get(e.type) ?? []), e])
    for (const [type, list] of byType) {
      const meta = entryTypeMeta(type as Entry['type'])
      lines.push(`### ${meta.emoji} ${meta.label}（${list.length}）`)
      lines.push('')
      for (const e of list.sort((a, b) => parseAny(b.occurredAt).getTime() - parseAny(a.occurredAt).getTime())) {
        lines.push(`- **${fmtDateShort(e.occurredAt)}** ${e.title || '（无标题）'}`)
        if (e.content) lines.push(`  - 经过：${e.content}`)
        if (e.taSaid) lines.push(`  - TA 说：${e.taSaid}`)
        if (e.myObservation) lines.push(`  - 我的观察：${e.myObservation}`)
        if (e.mood) lines.push(`  - 心情：${moodLabelOf(e.mood, e.moodCustom)}${e.moodLevel ? `（${e.moodLevel}/5）` : ''}`)
        if (e.tagList?.length) lines.push(`  - 标签：${e.tagList.join('、')}`)
        if (e.followUp) lines.push(`  - 待跟进：${e.followUp}${e.followUpDone ? '（已完成）' : ''}`)
      }
      lines.push('')
    }
  }

  // 心情变化
  lines.push('## 二、心情变化')
  lines.push('')
  if (!mood.recordedDays) {
    lines.push(`区间内没有心情记录（共 ${mood.totalDays} 天，全部留空）。`)
    lines.push('')
  } else {
    lines.push(`- 有记录的天数：**${mood.recordedDays} / ${mood.totalDays} 天**`)
    if (mood.avgLevel !== undefined) lines.push(`- 平均心情程度：**${mood.avgLevel.toFixed(1)} / 5**`)
    if (mood.distribution.length) {
      lines.push(`- 心情分布：${mood.distribution.map((d) => `${d.emoji}${d.label} ${d.count} 天`).join('，')}`)
    }
    if (mood.bestDay) lines.push(`- 心情最好：${fmtDateShort(mood.bestDay.date)}（${mood.bestDay.level?.toFixed(1)}/5）`)
    if (mood.worstDay && mood.worstDay !== mood.bestDay) {
      lines.push(`- 心情最低：${fmtDateShort(mood.worstDay.date)}（${mood.worstDay.level?.toFixed(1)}/5）`)
    }
    lines.push('')
    lines.push('| 日期 | 心情 | 程度 |')
    lines.push('| --- | --- | --- |')
    for (const p of mood.points) {
      lines.push(`| ${fmtDateShort(p.date)} | ${p.recorded ? moodLabelOf(p.mood, p.moodCustom) : '未记录'} | ${p.level !== undefined ? p.level.toFixed(1) : '—'} |`)
    }
    lines.push('')
    lines.push('> 未记录的日期保持为空，不计入平均值。')
    lines.push('')
  }

  // 新增兴趣 / 愿望
  lines.push('## 三、新增的兴趣与愿望')
  lines.push('')
  if (!bundle.preferences.length && !bundle.wishes.length) {
    lines.push('这段时间没有新增偏好或愿望。')
    lines.push('')
  }
  if (bundle.preferences.length) {
    lines.push('### 偏好更新')
    lines.push('')
    for (const p of bundle.preferences) {
      const dir = p.direction === 'like' ? '喜欢' : p.direction === 'dislike' ? '不喜欢' : '想尝试'
      lines.push(
        `- ${prefCategoryMeta(p.category).emoji} **${p.name}**（${dir}${p.likeLevel ? `，程度 ${p.likeLevel}/5` : ''}）${p.note ? ` — ${p.note}` : ''}`,
      )
      if (p.lastConfirmedAt) lines.push(`  - 最近确认：${p.lastConfirmedAt}`)
      if (p.evidenceEntryIds?.length) lines.push(`  - 依据：${p.evidenceEntryIds.length} 条记录`)
    }
    lines.push('')
  }
  if (bundle.wishes.length) {
    lines.push('### 愿望')
    lines.push('')
    for (const w of bundle.wishes) {
      const st = WISH_STATUS.find((x) => x.value === w.status)?.label ?? w.status
      lines.push(`- **${w.content}**（${st}）${w.note ? ` — ${w.note}` : ''}`)
    }
    lines.push('')
  }

  // 礼物与纪念日
  lines.push('## 四、礼物与纪念日回顾')
  lines.push('')
  if (!bundle.gifts.length) {
    lines.push('这段时间没有礼物记录。')
    lines.push('')
  } else {
    for (const g of bundle.gifts) {
      lines.push(`- 🎁 **${g.name}** · ${fmtDateShort(g.givenAt)}${g.occasion ? ` · ${g.occasion}` : ''}`)
      if (g.feedback) lines.push(`  - TA 的反应：${g.feedback}`)
    }
    lines.push('')
  }
  const feasts = collectUpcoming(person, 60)
  if (feasts.length) {
    lines.push('### 接下来的纪念日')
    lines.push('')
    for (const f of feasts) {
      lines.push(`- ${f.name}：${fmtDate(f.date)}（${f.daysLeft === 0 ? '就是今天' : `${f.daysLeft} 天后`}）${f.lunarText ? ` · 农历${f.lunarText}` : ''}`)
    }
    lines.push('')
  }

  // 健康
  if (bundle.health.length) {
    lines.push('## 五、健康记录')
    lines.push('')
    for (const h of bundle.health) {
      const st = HEALTH_STATUS.find((x) => x.value === h.status)?.label ?? h.status
      lines.push(`- ${fmtDateShort(h.occurredAt)} **${h.symptom}**（${st}）${h.severity ? ` 程度 ${h.severity}/5` : ''}`)
      if (h.medication) lines.push(`  - 就医/用药：${h.medication}`)
      if (h.recovery) lines.push(`  - 恢复情况：${h.recovery}`)
    }
    lines.push('')
    lines.push('> 健康记录仅供本人回顾与跟进，不作为任何医学判断依据。')
    lines.push('')
  }

  // 待跟进
  const followUps = collectFollowUps(bundle.entries, bundle.health, bundle.wishes)
  lines.push('## 六、仍待跟进')
  lines.push('')
  if (!followUps.length) {
    lines.push('没有待跟进事项。')
  } else {
    for (const f of followUps) {
      lines.push(`- [ ] ${f.title}${f.detail ? `（${f.detail}）` : ''}`)
    }
  }
  lines.push('')

  // 照片
  lines.push('## 七、照片')
  lines.push('')
  lines.push(bundle.photos.length ? `这段时间新增 ${bundle.photos.length} 张照片。` : '这段时间没有新增照片。')
  lines.push('')

  const stats = {
    entryCount: bundle.entries.length,
    photoCount: bundle.photos.length,
    giftCount: bundle.gifts.length,
    wishCount: bundle.wishes.length,
    healthCount: bundle.health.length,
    preferenceCount: bundle.preferences.length,
    recordedDays: mood.recordedDays,
    totalDays: mood.totalDays,
    avgLevel: mood.avgLevel,
  }

  return { markdown: lines.join('\n'), stats, mood }
}

/* ------------------------------------------------------------------ */
/* 画像分组显示辅助                                                     */
/* ------------------------------------------------------------------ */

export function groupInsights(list: PortraitInsight[]): { dimension: string; items: PortraitInsight[] }[] {
  const map = new Map<string, PortraitInsight[]>()
  for (const i of list) map.set(i.dimension, [...(map.get(i.dimension) ?? []), i])
  return Array.from(map.entries()).map(([dimension, items]) => ({ dimension, items }))
}

export function evidenceLabel(kind: string): string {
  return EVIDENCE_TYPES.find((e) => e.value === kind)?.label ?? kind
}

export { addDays, daysBetween, toDateStr }
