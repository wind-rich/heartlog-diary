/**
 * T5：结构化 Markdown 包。
 *
 * 为什么不是「一个大 .md」：
 * 记录会一直增长，单文件到最后既打不开也没法定位。这里导出一个**目录结构**，
 * 入口文档 + 按年记录 + 档案 + 回忆录 + 相对媒体目录，任何一个 Markdown 阅读器
 * 都能顺着链接走。
 *
 * 三条硬约束（对应验收）：
 * 1. **稳定 ID**：锚点直接用数据行 id（`<a id="e_xxx"></a>`），不按序号生成。
 *    换一版格式、换一次导出，同一个记录还是同一个锚点，旧链接不会失效。
 * 2. **相对链接必须有效**：所有链接都由 `rel()` 从「所在文件」算到「目标文件」，
 *    不用手写 `../`；导出后由自测把 ZIP 解开逐条核对目标存在。
 * 3. **如实标注来源**：README 写明数据来自本机库（已同步副本）、上次同步时间、
 *    有多少行比上次同步更新。离线导出的东西不能假装是云端最新。
 *
 * 不做的事：不读、不写任何 Markdown 文件，所以不存在「文件与数据库双向同步」
 * 这回事；导出是一次性快照。
 */
import JSZip from 'jszip'
import { db, getMetaValue } from '../db/db'
import type { DailyStatus, Entry, Gift, HealthRecord, Person, Photo, PortraitInsight, Preference, Summary, Wish } from '../db/types'
import type { Memoir } from '../memoir/types'
import { extOf } from './backup'
import { downloadBlob } from './exporter'
import { entryTypeMeta, HEALTH_STATUS, prefCategoryMeta, WISH_STATUS } from './constants'
import { moodLabelOf } from './stats'
import { fmtDate, fmtDateTime, fmtTime, parseAny } from './date'

/** 包格式版本：结构变化时 +1，ID 不随之变化 */
export const BUNDLE_FORMAT_VERSION = 1

/** 与本机同步时间一致的 meta 键（`lib/sync.ts` 写入） */
const SYNC_TIME_KEY = 'cloudSyncLastAt'

export interface BundleOptions {
  includePhotos?: boolean
  includeArchives?: boolean
  includeSummaries?: boolean
  includeMemoirs?: boolean
  /** 只导出某个时间段（yyyy-MM-dd，含两端）；不填表示全部 */
  range?: { start?: string; end?: string } | null
  /** 只导出指定的回忆录（其余不导出）；不填表示全部 */
  memoirIds?: string[]
}

export interface BundleSource {
  /** 数据来自本机库（已同步副本），不是直接读云端 */
  mode: 'local'
  lastSyncedAt: string
  /** 比上次同步更新的行数：>0 说明导出内容含未上行改动 */
  newerThanSync: number
  pendingDeletes: number
  note: string
}

export interface BundleManifest {
  app: 'heartlog'
  formatVersion: number
  exportedAt: string
  personId: string
  counts: Record<string, number>
  source: BundleSource
  files: string[]
}

export interface BundleResult {
  blob: Blob
  manifest: BundleManifest
  /** 便于自测直接检查目录内容（不重新解压） */
  zip: JSZip
}

/* ------------------------------------------------------------------ */
/* 小工具                                                              */
/* ------------------------------------------------------------------ */

/** 从「所在文件」算到「目标文件」的相对链接，避免手写 ../ 出错 */
export function rel(fromFile: string, toFile: string): string {
  const from = fromFile.split('/').slice(0, -1)
  const to = toFile.split('/')
  let i = 0
  while (i < from.length && i < to.length - 1 && from[i] === to[i]) i++
  const up = from.slice(i).map(() => '..')
  return [...up, ...to.slice(i)].join('/')
}

function esc(s: string | undefined | null): string {
  return String(s ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ')
}

function anchor(id: string): string {
  return `<a id="${id}"></a>`
}

function yearOf(iso?: string): string {
  if (!iso) return ''
  const d = parseAny(iso)
  return Number.isNaN(d.getTime()) ? '' : String(d.getFullYear())
}

function dayOf(iso?: string): string {
  if (!iso) return ''
  const d = parseAny(iso)
  return Number.isNaN(d.getTime()) ? '' : fmtDate(d)
}

function inRange(iso: string | undefined, start?: string, end?: string): boolean {
  if (!iso) return !start && !end
  const t = parseAny(iso).getTime()
  if (!Number.isFinite(t)) return !start && !end
  if (start && t < parseAny(`${start}T00:00:00`).getTime()) return false
  if (end && t > parseAny(`${end}T23:59:59`).getTime()) return false
  return true
}

function frontMatter(pairs: Record<string, string | number | undefined>): string {
  const lines = ['---']
  for (const [k, v] of Object.entries(pairs)) {
    if (v === undefined || v === '') continue
    lines.push(`${k}: ${typeof v === 'number' ? v : JSON.stringify(v)}`)
  }
  lines.push('---', '')
  return lines.join('\n')
}

/* ------------------------------------------------------------------ */
/* 收集数据                                                            */
/* ------------------------------------------------------------------ */

interface Dataset {
  person?: Person
  entries: Entry[]
  photos: Photo[]
  preferences: Preference[]
  wishes: Wish[]
  gifts: Gift[]
  health: HealthRecord[]
  statuses: DailyStatus[]
  insights: PortraitInsight[]
  summaries: Summary[]
  memoirs: Memoir[]
}

async function collect(opts: Required<Pick<BundleOptions, 'includePhotos' | 'includeArchives' | 'includeSummaries' | 'includeMemoirs'>> & BundleOptions): Promise<Dataset> {
  const person = await db.persons.toArray().then((rows) => rows.find((p) => p.isActive) ?? rows[0])
  const pid = person?.id
  const [entries, photos, preferences, wishes, gifts, health, statuses, insights, summaries, memoirs] = await Promise.all([
    pid ? db.entries.where('personId').equals(pid).toArray() : Promise.resolve([] as Entry[]),
    opts.includePhotos && pid ? db.photos.where('personId').equals(pid).toArray() : Promise.resolve([] as Photo[]),
    pid ? db.preferences.where('personId').equals(pid).toArray() : Promise.resolve([] as Preference[]),
    pid ? db.wishes.where('personId').equals(pid).toArray() : Promise.resolve([] as Wish[]),
    pid ? db.gifts.where('personId').equals(pid).toArray() : Promise.resolve([] as Gift[]),
    pid ? db.health.where('personId').equals(pid).toArray() : Promise.resolve([] as HealthRecord[]),
    pid ? db.dailyStatus.where('personId').equals(pid).toArray() : Promise.resolve([] as DailyStatus[]),
    pid ? db.insights.where('personId').equals(pid).toArray() : Promise.resolve([] as PortraitInsight[]),
    opts.includeSummaries && pid ? db.summaries.where('personId').equals(pid).toArray() : Promise.resolve([] as Summary[]),
    opts.includeMemoirs && pid ? db.memoirs.where('personId').equals(pid).toArray() : Promise.resolve([] as Memoir[]),
  ])

  const start = opts.range?.start
  const end = opts.range?.end
  const keep = <T,>(rows: T[], dateOf: (r: T) => string | undefined) =>
    start || end ? rows.filter((r) => inRange(dateOf(r), start, end)) : rows

  const pickedMemoirs = opts.memoirIds?.length
    ? memoirs.filter((m) => opts.memoirIds!.includes(m.id))
    : memoirs

  return {
    person,
    entries: keep(entries, (e) => e.occurredAt).sort((a, b) => (a.occurredAt < b.occurredAt ? -1 : 1)),
    photos: keep(photos, (p) => p.takenAt ?? p.createdAt).sort((a, b) => ((a.takenAt ?? a.createdAt) < (b.takenAt ?? b.createdAt) ? -1 : 1)),
    preferences,
    wishes: keep(wishes, (w) => w.raisedAt ?? w.createdAt),
    gifts: keep(gifts, (g) => g.givenAt),
    health: keep(health, (h) => h.occurredAt),
    statuses: keep(statuses, (s) => s.date).sort((a, b) => (a.date < b.date ? -1 : 1)),
    insights,
    summaries: keep(summaries, (s) => s.createdAt).sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1)),
    memoirs: pickedMemoirs.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1)),
  }
}

/* ------------------------------------------------------------------ */
/* 渲染                                                                */
/* ------------------------------------------------------------------ */

interface Links {
  entryFile: Map<string, string>
  photoFile: Map<string, string>
  prefAnchor: Map<string, string>
  wishAnchor: Map<string, string>
  giftAnchor: Map<string, string>
  healthAnchor: Map<string, string>
  statusAnchor: Map<string, string>
  insightAnchor: Map<string, string>
  summaryAnchor: Map<string, string>
  memoirFile: Map<string, string>
}

function buildLinks(d: Dataset, yearFiles: Map<string, string>, photoFiles: Map<string, string>): Links {
  return {
    entryFile: new Map(d.entries.map((e) => [e.id, yearFiles.get(yearOf(e.occurredAt) || 'undated') ?? 'records/undated.md'])),
    photoFile: photoFiles,
    prefAnchor: new Map(d.preferences.map((r) => [r.id, 'archive/preferences.md'])),
    wishAnchor: new Map(d.wishes.map((r) => [r.id, 'archive/wishes.md'])),
    giftAnchor: new Map(d.gifts.map((r) => [r.id, 'archive/gifts.md'])),
    healthAnchor: new Map(d.health.map((r) => [r.id, 'archive/health.md'])),
    statusAnchor: new Map(d.statuses.map((r) => [r.id, 'archive/status.md'])),
    insightAnchor: new Map(d.insights.map((r) => [r.id, 'archive/insights.md'])),
    summaryAnchor: new Map(d.summaries.map((r) => [r.id, 'archive/summaries.md'])),
    memoirFile: new Map(d.memoirs.map((m) => [m.id, `memoirs/${m.id}.md`])),
  }
}

/** 记录引用 → `[标题](相对链接)`；目标不在包内时退回纯文本，不产生死链 */
function entryRef(fromFile: string, links: Links, id: string, label: string): string {
  const target = links.entryFile.get(id)
  if (!target) return label
  return `[${label}](${rel(fromFile, target)}#${id})`
}

function photoLine(fromFile: string, links: Links, p: Photo | undefined, caption: string | undefined, includePhotos: boolean): string {
  const text = caption?.trim() || '照片'
  if (!includePhotos || !p) return `- 照片：${esc(text)}（未随包导出）`
  const file = links.photoFile.get(p.id)
  if (!file) return `- 照片：${esc(text)}（未随包导出）`
  return `![${esc(text)}](${rel(fromFile, file)})`
}

interface ReverseIdx {
  prefsByEntry: Map<string, Preference[]>
  insightsByEntry: Map<string, PortraitInsight[]>
  wishesByEntry: Map<string, Wish[]>
  giftsByEntry: Map<string, Gift[]>
  healthByEntry: Map<string, HealthRecord[]>
}

function buildReverse(d: Dataset): ReverseIdx {
  const add = <T,>(map: Map<string, T[]>, id: string, row: T) => {
    const list = map.get(id)
    if (list) list.push(row)
    else map.set(id, [row])
  }
  const prefsByEntry = new Map<string, Preference[]>()
  for (const p of d.preferences) for (const id of p.evidenceEntryIds ?? []) add(prefsByEntry, id, p)
  const insightsByEntry = new Map<string, PortraitInsight[]>()
  for (const i of d.insights) for (const id of i.evidenceEntryIds ?? []) add(insightsByEntry, id, i)
  const wishesByEntry = new Map<string, Wish[]>()
  for (const w of d.wishes) for (const id of w.entryIds ?? []) add(wishesByEntry, id, w)
  const giftsByEntry = new Map<string, Gift[]>()
  for (const g of d.gifts) if (g.entryId) add(giftsByEntry, g.entryId, g)
  const healthByEntry = new Map<string, HealthRecord[]>()
  for (const h of d.health) for (const id of h.entryIds ?? []) add(healthByEntry, id, h)
  return { prefsByEntry, insightsByEntry, wishesByEntry, giftsByEntry, healthByEntry }
}

/**
 * 一条记录。
 *
 * 关联是**反向**找出来的：偏好/观察/心愿/礼物/健康都带 entryIds，
 * 记录本身不存这些引用。这样导出时不会出现「关联字段为空 = 没有关联」的错觉。
 */
function renderEntry(
  fromFile: string,
  e: Entry,
  links: Links,
  rev: ReverseIdx,
  photosById: Map<string, Photo>,
  includePhotos: boolean,
): string {
  const meta = entryTypeMeta(e.type)
  const lines: string[] = []
  const timeText = (() => {
    const d = parseAny(e.occurredAt)
    return Number.isNaN(d.getTime()) ? '' : fmtTime(d)
  })()
  lines.push(anchor(e.id))
  lines.push(`### ${dayOf(e.occurredAt)}${timeText ? ` ${timeText}` : ''} · ${esc(e.title)}`)
  lines.push('')
  lines.push(
    `- 记录 ID：\`${e.id}\` · 类型：${meta?.label ?? e.type}${e.mood ? ` · 心情：${moodLabelOf(e.mood)}` : ''}${
      e.tagList?.length ? ` · 标签：${e.tagList.map((t) => `\`${t}\``).join(' ')}` : ''
    }`,
  )
  if (e.content?.trim()) {
    lines.push('')
    lines.push(e.content.trim())
  }
  if (e.taSaid?.trim()) {
    lines.push('')
    lines.push(`> TA 说：「${e.taSaid.trim()}」`)
  }
  if (e.myObservation?.trim()) {
    lines.push('')
    lines.push(`我的观察：${e.myObservation.trim()}`)
  }
  if (e.photoIds?.length) {
    lines.push('')
    for (const pid of e.photoIds) {
      lines.push(photoLine(fromFile, links, photosById.get(pid), photosById.get(pid)?.caption, includePhotos))
    }
  }
  const related: string[] = []
  for (const p of rev.prefsByEntry.get(e.id) ?? []) related.push(`[偏好 ${esc(p.name)}](../archive/preferences.md#${p.id})`)
  for (const w of rev.wishesByEntry.get(e.id) ?? []) related.push(`[心愿 ${esc(w.content)}](../archive/wishes.md#${w.id})`)
  for (const g of rev.giftsByEntry.get(e.id) ?? []) related.push(`[礼物 ${esc(g.name)}](../archive/gifts.md#${g.id})`)
  for (const h of rev.healthByEntry.get(e.id) ?? []) related.push(`[健康 ${esc(h.symptom)}](../archive/health.md#${h.id})`)
  for (const i of rev.insightsByEntry.get(e.id) ?? []) related.push(`[观察 ${esc(i.dimension)}](../archive/insights.md#${i.id})`)
  if (related.length) {
    lines.push('')
    lines.push(`关联：${related.join(' · ')}`)
  }
  if (e.followUp?.trim()) {
    lines.push('')
    lines.push(`待跟进：${e.followUp.trim()}${e.followUpDone ? '（已完成）' : ''}`)
  }
  lines.push('')
  return lines.join('\n')
}

function renderYearDoc(
  year: string,
  entries: Entry[],
  links: Links,
  rev: ReverseIdx,
  photosById: Map<string, Photo>,
  includePhotos: boolean,
  exportStamp: string,
): string {
  const file = `records/${year}.md`
  const title = year === 'undated' ? '没有日期的记录' : `${year} 年`
  const out: string[] = []
  out.push(frontMatter({ type: 'records', year: year === 'undated' ? undefined : Number(year), count: entries.length, exported_at: exportStamp }))
  out.push(`# ${title}（${entries.length} 条）`, '')
  out.push(`> 本章由「心意簿」导出，共 ${entries.length} 条记录，按时间先后排列。每条记录上方有稳定锚点，可用 \`文件#记录ID\` 直接定位。`, '')
  for (const e of entries) out.push(renderEntry(file, e, links, rev, photosById, includePhotos))
  return out.join('\n')
}

function renderProfile(person: Person | undefined, anniversaries: Person['anniversaries'], exportStamp: string): string {
  const file = 'archive/profile.md'
  const out: string[] = []
  out.push(frontMatter({ type: 'profile', person_id: person?.id, exported_at: exportStamp }))
  out.push('# 人物档案', '')
  if (!person) {
    out.push('（本机还没有人物档案）', '')
    return out.join('\n')
  }
  out.push(anchor(person.id), '')
  out.push(`- 记录 ID：\`${person.id}\``)
  out.push(`- 称呼：${esc(person.nickname || person.name) || '（未填写）'}`)
  if (person.name) out.push(`- 姓名：${esc(person.name)}`)
  if (person.birthday) out.push(`- 生日：${person.birthday}（${person.calendarType === 'lunar' ? '农历' : '公历'}）`)
  if (person.meetDate) out.push(`- 相识日：${person.meetDate}`)
  if (person.zodiac) out.push(`- 星座：${esc(person.zodiac)}`)
  if (person.tags?.length) out.push(`- 标签：${person.tags.map((t) => `\`${t}\``).join(' ')}`)
  if (person.intro?.trim()) {
    out.push('', '## 简介', '', person.intro.trim())
  }
  if (anniversaries?.length) {
    out.push('', `## 纪念日（${anniversaries.length} 个）`, '')
    for (const a of anniversaries) {
      out.push(`- ${esc(a.name)}：${a.date}（${a.calendarType === 'lunar' ? '农历' : '公历'}${a.repeatYearly ? '，每年重复' : ''}）${a.note ? ` —— ${esc(a.note)}` : ''}`)
    }
  }
  out.push('')
  void file
  return out.join('\n')
}

function renderPreferences(rows: Preference[], links: Links, photosById: Map<string, Photo>, includePhotos: boolean, stamp: string): string {
  const file = 'archive/preferences.md'
  const out: string[] = [frontMatter({ type: 'preferences', count: rows.length, exported_at: stamp }), `# 偏好与习惯（${rows.length} 条）`, '']
  if (!rows.length) out.push('（暂无记录）', '')
  for (const r of rows) {
    out.push(anchor(r.id), `### ${esc(r.name)}`)
    out.push('')
    out.push(`- 记录 ID：\`${r.id}\` · ${prefCategoryMeta(r.category)?.label ?? r.category} · ${r.direction === 'like' ? '喜欢' : r.direction === 'dislike' ? '不喜欢' : '想尝试'}`)
    if (r.lastConfirmedAt) out.push(`- 最近确认：${dayOf(r.lastConfirmedAt)}`)
    if (r.note?.trim()) out.push('', r.note.trim())
    if (r.evidenceEntryIds?.length) {
      out.push('', `依据：${r.evidenceEntryIds.map((id) => entryRef(file, links, id, '记录')).join(' · ')}`)
    }
    out.push('')
  }
  void photosById
  void includePhotos
  return out.join('\n')
}

function wishLabel(status: Wish['status']): string {
  return WISH_STATUS.find((x) => x.value === status)?.label ?? status
}

function renderWishes(rows: Wish[], links: Links, stamp: string): string {
  const file = 'archive/wishes.md'
  const out: string[] = [frontMatter({ type: 'wishes', count: rows.length, exported_at: stamp }), `# 心愿与礼物线索（${rows.length} 条）`, '']
  if (!rows.length) out.push('（暂无记录）', '')
  for (const r of rows) {
    out.push(anchor(r.id), `### ${esc(r.content)}`)
    out.push('')
    out.push(`- 记录 ID：\`${r.id}\` · 状态：${wishLabel(r.status)}${r.raisedAt ? ` · 提出于 ${dayOf(r.raisedAt)}` : ''}${r.occasion ? ` · 场合：${esc(r.occasion)}` : ''}`)
    if (r.note?.trim()) out.push('', r.note.trim())
    if (r.entryIds?.length) out.push('', `关联：${r.entryIds.map((id) => entryRef(file, links, id, '记录')).join(' · ')}`)
    out.push('')
  }
  return out.join('\n')
}

function renderGifts(rows: Gift[], links: Links, stamp: string): string {
  const file = 'archive/gifts.md'
  const out: string[] = [frontMatter({ type: 'gifts', count: rows.length, exported_at: stamp }), `# 礼物记录（${rows.length} 条）`, '']
  if (!rows.length) out.push('（暂无记录）', '')
  for (const r of rows) {
    out.push(anchor(r.id), `### ${esc(r.name)}`)
    out.push('')
    out.push(`- 记录 ID：\`${r.id}\` · 送出：${dayOf(r.givenAt)}${r.occasion ? ` · 场合：${esc(r.occasion)}` : ''}${typeof r.amount === 'number' ? ` · 花费：${r.amount}` : ''}`)
    if (r.feedback?.trim()) out.push('', `TA 的反应：${r.feedback.trim()}`)
    if (r.note?.trim()) out.push('', r.note.trim())
    if (r.entryId) out.push('', `关联：${entryRef(file, links, r.entryId, '记录')}`)
    out.push('')
  }
  return out.join('\n')
}

function healthLabel(status: HealthRecord['status']): string {
  return HEALTH_STATUS.find((x) => x.value === status)?.label ?? status
}

function renderHealth(rows: HealthRecord[], links: Links, stamp: string): string {
  const file = 'archive/health.md'
  const out: string[] = [frontMatter({ type: 'health', count: rows.length, exported_at: stamp }), `# 健康记录（${rows.length} 条）`, '']
  if (!rows.length) out.push('（暂无记录）', '')
  for (const r of rows) {
    out.push(anchor(r.id), `### ${esc(r.symptom)} · ${dayOf(r.occurredAt)}`)
    out.push('')
    out.push(`- 记录 ID：\`${r.id}\` · 状态：${healthLabel(r.status)}${r.severity ? ` · 严重度：${r.severity}` : ''}`)
    if (r.note?.trim()) out.push('', r.note.trim())
    if (r.recovery?.trim()) out.push('', `恢复情况：${r.recovery.trim()}`)
    if (r.entryIds?.length) out.push('', `关联：${r.entryIds.map((id) => entryRef(file, links, id, '记录')).join(' · ')}`)
    out.push('')
  }
  return out.join('\n')
}

function renderStatuses(rows: DailyStatus[], links: Links, stamp: string): string {
  const file = 'archive/status.md'
  const out: string[] = [frontMatter({ type: 'statuses', count: rows.length, exported_at: stamp }), `# 每日状态（${rows.length} 天）`, '']
  if (!rows.length) out.push('（暂无记录）', '')
  for (const r of rows) {
    out.push(anchor(r.id), `### ${r.date}`)
    out.push('')
    const bits = [
      r.mood ? `心情：${moodLabelOf(r.mood)}` : '',
      typeof r.moodLevel === 'number' ? `强度：${r.moodLevel}/5` : '',
      typeof r.energy === 'number' ? `精力：${r.energy}/5` : '',
      typeof r.sleepHours === 'number' ? `睡眠：${r.sleepHours} 小时` : '',
    ].filter(Boolean)
    out.push(`- 记录 ID：\`${r.id}\`${bits.length ? ` · ${bits.join(' · ')}` : ''}`)
    if (r.goodThing?.trim()) out.push('', `好事：${r.goodThing.trim()}`)
    if (r.worry?.trim()) out.push('', `烦心：${r.worry.trim()}`)
    if (r.note?.trim()) out.push('', r.note.trim())
    out.push('')
  }
  void links
  return out.join('\n')
}

function renderInsights(rows: PortraitInsight[], links: Links, stamp: string): string {
  const file = 'archive/insights.md'
  const out: string[] = [frontMatter({ type: 'insights', count: rows.length, exported_at: stamp }), `# 我的观察（${rows.length} 条）`, '']
  out.push('> 这些是作者的观察与推测，不是 TA 的自述。确认状态已标出。', '')
  if (!rows.length) out.push('（暂无内容）', '')
  for (const r of rows) {
    out.push(anchor(r.id), `### ${esc(r.dimension)}`)
    out.push('')
    const confirm = r.confirmState === 'confirmed' ? '已确认' : r.confirmState === 'rejected' ? '已否定' : '待确认'
    out.push(`- 记录 ID：\`${r.id}\` · 依据强度：${r.evidenceType === 'stated' ? 'TA 明确表达' : r.evidenceType === 'repeated' ? '多次记录体现' : '待观察'} · ${confirm}`)
    out.push('', r.description.trim())
    if (r.evidenceEntryIds?.length) out.push('', `依据：${r.evidenceEntryIds.map((id) => entryRef(file, links, id, '记录')).join(' · ')}`)
    out.push('')
  }
  return out.join('\n')
}

function renderSummaries(rows: Summary[], links: Links, stamp: string): string {
  const file = 'archive/summaries.md'
  const out: string[] = [frontMatter({ type: 'summaries', count: rows.length, exported_at: stamp }), `# 回顾（${rows.length} 份）`, '']
  if (!rows.length) out.push('（暂无回顾）', '')
  for (const r of rows) {
    out.push(anchor(r.id), `### ${esc(r.title)}`)
    out.push('')
    out.push(
      `- 记录 ID：\`${r.id}\` · ${r.kind} · ${dayOf(r.rangeStart)} ~ ${dayOf(r.rangeEnd)} · ${
        r.generator === 'ai' ? `AI 生成${r.aiMeta?.model ? `（${esc(r.aiMeta.model)}）` : ''}` : '手工整理'
      }`,
    )
    out.push('')
    out.push(r.content.trim())
    if (r.aiMeta?.citedEntryIds?.length) {
      out.push('', `引用记录：${r.aiMeta.citedEntryIds.map((id) => entryRef(file, links, id, '记录')).join(' · ')}`)
    }
    if (r.aiMeta?.gaps) out.push('', `记录缺口：${esc(r.aiMeta.gaps)}`)
    out.push('')
  }
  return out.join('\n')
}

function renderMemoir(m: Memoir, links: Links, stamp: string): string {
  const file = `memoirs/${m.id}.md`
  const out: string[] = []
  out.push(
    frontMatter({
      type: 'memoir',
      memoir_id: m.id,
      status: m.status === 'final' ? 'final' : 'draft',
      range_start: m.rangeStart,
      range_end: m.rangeEnd,
      sections: m.sections.length,
      updated_at: m.updatedAt,
      exported_at: stamp,
    }),
  )
  out.push(`# ${esc(m.title)}`, '')
  if (m.subtitle?.trim()) out.push(`> ${esc(m.subtitle)}`, '')
  out.push(`- 回忆录 ID：\`${m.id}\`${m.rangeStart || m.rangeEnd ? ` · 取材范围：${m.rangeStart ?? '最早'} ~ ${m.rangeEnd ?? '现在'}` : ''}`, '')
  for (const s of m.sections) {
    out.push(anchor(s.id), `## ${esc(s.heading) || '未命名章节'}`, '')
    // 正文里的 [E1] 换成可点击的相对链接；映射不到的编号原样保留（不静默删掉作者的痕迹）
    let body = s.body ?? ''
    for (const [no, entryId] of Object.entries(s.citeMap ?? {})) {
      const target = links.entryFile.get(entryId)
      if (!target) continue
      body = body.split(`[${no}]`).join(`[${no}](${rel(file, target)}#${entryId})`)
    }
    out.push(body.trim(), '')
    const origin = s.origin === 'ai' ? `AI 草稿${s.aiMeta?.model ? `（${esc(s.aiMeta.model)}）` : ''}` : '作者手写'
    const flags = [origin, s.editedAt ? '已人工修改' : ''].filter(Boolean).join(' · ')
    out.push(`<sub>章节来源：${flags}</sub>`, '')
  }
  return out.join('\n')
}

function renderIndex(d: Dataset, yearFiles: Map<string, string>, links: Links, opts: BundleOptions): string {
  const out: string[] = ['# 心意簿 · 目录', '']
  out.push('- [说明与字段约定](README.md)', '')

  out.push('## 记录', '')
  const years = Array.from(yearFiles.keys()).sort()
  for (const y of years) {
    const file = yearFiles.get(y)!
    const count = d.entries.filter((e) => (yearOf(e.occurredAt) || 'undated') === y).length
    out.push(`- [${y === 'undated' ? '没有日期的记录' : `${y} 年`}（${count} 条）](${file})`)
  }
  if (!years.length) out.push('- （暂无记录）')
  out.push('')

  if (opts.includeArchives !== false) {
    out.push('## 档案', '')
    out.push('- [人物档案](archive/profile.md)')
    out.push(`- [偏好与习惯（${d.preferences.length} 条）](archive/preferences.md)`)
    out.push(`- [心愿（${d.wishes.length} 条）](archive/wishes.md)`)
    out.push(`- [礼物记录（${d.gifts.length} 条）](archive/gifts.md)`)
    out.push(`- [健康记录（${d.health.length} 条）](archive/health.md)`)
    out.push(`- [每日状态（${d.statuses.length} 天）](archive/status.md)`)
    out.push(`- [我的观察（${d.insights.length} 条）](archive/insights.md)`)
    out.push(`- [回顾（${d.summaries.length} 份）](archive/summaries.md)`)
    out.push('')
  }

  if (d.memoirs.length) {
    out.push('## 回忆录', '')
    for (const m of d.memoirs) {
      out.push(`- [${esc(m.title)}](${links.memoirFile.get(m.id)})${m.status === 'final' ? ' · 已定稿' : ' · 草稿'}`)
    }
    out.push('')
  }

  out.push('## 机器可读', '')
  out.push('- [全部实体索引（JSON）](data/index.json)')
  out.push('')
  return out.join('\n')
}

function renderReadme(d: Dataset, source: BundleSource, manifest: BundleManifest, opts: BundleOptions): string {
  const name = d.person?.nickname || d.person?.name || 'TA'
  const out: string[] = []
  out.push(`# 关于 ${name} 的文稿包`, '')
  out.push('这是「心意簿」导出的**结构化 Markdown 包**：每个文件都是普通 Markdown，图片用相对路径引用，解压后直接打开就能读。', '')

  out.push('## 怎么读', '')
  out.push('1. 先看 [目录](index.md)，按年份或档案进入。')
  out.push('2. 每条记录、每个条目上方都有稳定锚点，可以用 `文件.md#记录ID` 直接跳到它。')
  out.push('3. 回忆录在 `memoirs/` 下，正文里的 `[E1]` 已经转成指向具体记录的链接。')
  out.push('')

  out.push('## 这次导出了什么', '')
  out.push(`- 记录 ${manifest.counts.entries} 条，覆盖 ${manifest.counts.years} 个年份文件`)
  out.push(`- 照片 ${manifest.counts.photos} 张${opts.includePhotos === false ? '（本次未导出图片文件）' : ''}`)
  if (opts.includeArchives !== false) {
    out.push(
      `- 档案：偏好 ${manifest.counts.preferences} · 心愿 ${manifest.counts.wishes} · 礼物 ${manifest.counts.gifts} · 健康 ${manifest.counts.health} · 每日状态 ${manifest.counts.statuses} · 观察 ${manifest.counts.insights} · 回顾 ${manifest.counts.summaries}`,
    )
  }
  out.push(`- 回忆录 ${manifest.counts.memoirs} 本`)
  out.push('')

  out.push('## 数据来源与同步状态', '')
  out.push('| 项目 | 值 |')
  out.push('| --- | --- |')
  out.push(`| 数据来源 | 本机数据库（已同步副本） |`)
  out.push(`| 上次多端同步 | ${source.lastSyncedAt ? fmtDateTime(parseAny(source.lastSyncedAt)) : '从未同步过'} |`)
  out.push(`| 比上次同步更新的行 | ${source.newerThanSync} 行 |`)
  out.push(`| 待上行删除 | ${source.pendingDeletes} 条 |`)
  out.push(`| 导出时间 | ${fmtDateTime(parseAny(manifest.exportedAt))} |`)
  out.push(`| 包格式版本 | v${manifest.formatVersion} |`)
  out.push('')
  out.push(`> ${source.note}`)
  out.push('')

  out.push('## 字段与 ID', '')
  out.push('- 每条内容都带 `记录 ID`，就是数据库里的主键；导出结构升级时**这个 ID 不变**，旧链接仍能定位。')
  out.push('- 文件的 front-matter（`---` 之间的部分）给出类型、数量、导出时间，便于脚本处理。')
  out.push('- `data/index.json` 是同一批内容的机器可读索引：id → 文件 → 锚点。')
  out.push('')

  out.push('## 隐私提醒', '')
  out.push('这个包里是完整的私人内容（含健康与情绪记录）。发给别人或传到网盘前请先想清楚；只读展示端不包含这些内容。')
  out.push('')
  return out.join('\n')
}

function renderDataIndex(d: Dataset, links: Links, manifest: BundleManifest): string {
  const entries = d.entries.map((e) => ({
    id: e.id,
    file: links.entryFile.get(e.id),
    anchor: e.id,
    occurredAt: e.occurredAt,
    title: e.title,
    type: e.type,
  }))
  const photos = d.photos.map((p) => ({
    id: p.id,
    file: links.photoFile.get(p.id) ?? null,
    takenAt: p.takenAt ?? p.createdAt,
    caption: p.caption ?? null,
  }))
  const memoirs = d.memoirs.map((m) => ({
    id: m.id,
    file: links.memoirFile.get(m.id),
    title: m.title,
    status: m.status,
    sections: m.sections.map((s) => ({ id: s.id, heading: s.heading, origin: s.origin, entryIds: s.entryIds })),
  }))
  return JSON.stringify(
    {
      app: 'heartlog',
      formatVersion: manifest.formatVersion,
      exportedAt: manifest.exportedAt,
      personId: d.person?.id ?? null,
      counts: manifest.counts,
      entries,
      photos,
      memoirs,
    },
    null,
    2,
  )
}

/* ------------------------------------------------------------------ */
/* 组装                                                                */
/* ------------------------------------------------------------------ */

async function pendingStats(lastSyncedAt: string): Promise<{ newerThanSync: number; pendingDeletes: number }> {
  const since = lastSyncedAt ? parseAny(lastSyncedAt).getTime() : 0
  let newerThanSync = 0
  const tables: { toArray: () => Promise<unknown[]> }[] = [
    db.entries,
    db.preferences,
    db.wishes,
    db.gifts,
    db.health,
    db.dailyStatus,
    db.insights,
    db.summaries,
    db.memoirs,
  ]
  for (const t of tables) {
    const rows = (await t.toArray()) as Record<string, unknown>[]
    for (const r of rows) {
      const at = Date.parse(String(r.updatedAt ?? r.createdAt ?? ''))
      if (Number.isFinite(at) && at > since) newerThanSync++
    }
  }
  const tombs = await db.tombstones.toArray()
  const pendingDeletes = tombs.filter((t) => !t.pushedAt).length
  return { newerThanSync, pendingDeletes }
}

export async function createMarkdownBundle(opts: BundleOptions = {}): Promise<BundleResult> {
  const includePhotos = opts.includePhotos ?? true
  const includeArchives = opts.includeArchives ?? true
  const includeSummaries = opts.includeSummaries ?? true
  const includeMemoirs = opts.includeMemoirs ?? true

  const d = await collect({ ...opts, includePhotos, includeArchives, includeSummaries, includeMemoirs })
  if (!d.person) throw new Error('本机还没有人物档案，先记点什么再导出')

  const exportedAt = new Date().toISOString()
  const years = new Set<string>()
  for (const e of d.entries) years.add(yearOf(e.occurredAt) || 'undated')
  const yearFiles = new Map<string, string>()
  for (const y of years) yearFiles.set(y, `records/${y}.md`)

  const photoFiles = new Map<string, string>()
  for (const p of d.photos) photoFiles.set(p.id, `media/photos/${p.id}.${extOf(p.mime || 'image/jpeg')}`)

  const links = buildLinks(d, yearFiles, photoFiles)
  const rev = buildReverse(d)
  const photosById = new Map(d.photos.map((p) => [p.id, p]))
  const lastSyncedAt = await getMetaValue<string>(SYNC_TIME_KEY, '')
  const pending = await pendingStats(lastSyncedAt)

  const source: BundleSource = {
    mode: 'local',
    lastSyncedAt,
    newerThanSync: pending.newerThanSync,
    pendingDeletes: pending.pendingDeletes,
    note:
      pending.newerThanSync > 0
        ? `这份包里有 ${pending.newerThanSync} 行是本机改动、还没上行到云端；如果这是「导出给别人看的成稿」，建议先做一次「双向同步」再导出。`
        : '导出时本机内容与上次同步一致（或没有需要上行的改动）。',
  }

  const manifest: BundleManifest = {
    app: 'heartlog',
    formatVersion: BUNDLE_FORMAT_VERSION,
    exportedAt,
    personId: d.person.id,
    counts: {
      entries: d.entries.length,
      photos: d.photos.length,
      years: years.size,
      preferences: d.preferences.length,
      wishes: d.wishes.length,
      gifts: d.gifts.length,
      health: d.health.length,
      statuses: d.statuses.length,
      insights: d.insights.length,
      summaries: d.summaries.length,
      memoirs: d.memoirs.length,
    },
    source,
    files: [],
  }

  const zip = new JSZip()
  const files: string[] = []
  const put = (path: string, content: string | Blob) => {
    zip.file(path, content)
    files.push(path)
  }

  put('README.md', renderReadme(d, source, manifest, opts))
  put('index.md', renderIndex(d, yearFiles, links, opts))

  for (const [year, file] of yearFiles) {
    const rows = d.entries.filter((e) => (yearOf(e.occurredAt) || 'undated') === year)
    put(file, renderYearDoc(year, rows, links, rev, photosById, includePhotos, exportedAt))
  }

  if (includeArchives) {
    put('archive/profile.md', renderProfile(d.person, d.person.anniversaries, exportedAt))
    put('archive/preferences.md', renderPreferences(d.preferences, links, photosById, includePhotos, exportedAt))
    put('archive/wishes.md', renderWishes(d.wishes, links, exportedAt))
    put('archive/gifts.md', renderGifts(d.gifts, links, exportedAt))
    put('archive/health.md', renderHealth(d.health, links, exportedAt))
    put('archive/status.md', renderStatuses(d.statuses, links, exportedAt))
    put('archive/insights.md', renderInsights(d.insights, links, exportedAt))
    put('archive/summaries.md', renderSummaries(d.summaries, links, exportedAt))
  }

  for (const m of d.memoirs) {
    put(links.memoirFile.get(m.id)!, renderMemoir(m, links, exportedAt))
  }

  put('data/index.json', renderDataIndex(d, links, manifest))

  if (includePhotos) {
    const folder = zip.folder('media/photos')!
    for (const p of d.photos) {
      folder.file(`${p.id}.${extOf(p.mime || 'image/jpeg')}`, p.blob)
      files.push(`media/photos/${p.id}.${extOf(p.mime || 'image/jpeg')}`)
    }
  }

  manifest.files = files.sort()
  // README 里要写清「包格式版本」，所以先把 manifest 定稿再回填一次
  zip.file('README.md', renderReadme(d, source, manifest, opts))

  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } })
  return { blob, manifest, zip }
}

/** 导出并触发下载；文件名带本地时间，避免多次导出互相覆盖 */
export async function exportMarkdownBundle(opts: BundleOptions = {}): Promise<BundleManifest> {
  const { blob, manifest } = await createMarkdownBundle(opts)
  const stamp = manifest.exportedAt.slice(0, 16).replace(/[:T]/g, '-')
  downloadBlob(blob, `心意簿-文稿包-${stamp}.zip`)
  return manifest
}
