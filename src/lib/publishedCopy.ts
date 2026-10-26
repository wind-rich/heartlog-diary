/**
 * 从「已发布快照」在新设备上建立本地副本（T2：空作者设备引导）。
 *
 * 两种来源：
 * - 目录：选择发布产物里的 snapshot 目录（含 public-snapshot.json 与 media/），完全离线；
 * - 地址：同源或服务端允许跨域时，直接按 URL 读取。
 *
 * 只复用公开快照的字段，导入的是**业务内容**，不包含作者 AI 配置、发布凭据或任何 meta。
 * 写入统一走 applyBackupData(…, 'merge')：新设备上等价于全量导入，已有内容不会被覆盖。
 */
import { applyBackupData, type BackupData, type ImportResult, type PhotoMeta } from './backup'
import type {
  Anniversary,
  DailyStatus,
  Entry,
  Gift,
  HealthRecord,
  Person,
  PortraitInsight,
  Preference,
  Summary,
  Wish,
} from '../db/types'
import { nowISO } from '../db/db'

export interface CopyProgress {
  phase: 'read' | 'media' | 'write'
  done: number
  total: number
}

export interface CopyResult {
  publishId: string
  imported: ImportResult
  media: { ok: number; missing: number }
}

const asArray = <T,>(v: T[] | undefined | null): T[] => (Array.isArray(v) ? v : [])
const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined)
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)

interface PublicSnapshotLike {
  manifest?: { formatVersion?: number; publishId?: string; counts?: Record<string, number> }
  config?: { centerPersonId?: string }
  person?: Record<string, unknown>
  anniversaries?: Record<string, unknown>[]
  entries?: Record<string, unknown>[]
  photos?: Record<string, unknown>[]
  preferences?: Record<string, unknown>[]
  wishes?: Record<string, unknown>[]
  gifts?: Record<string, unknown>[]
  health?: Record<string, unknown>[]
  insights?: Record<string, unknown>[]
  summaries?: Record<string, unknown>[]
  statuses?: Record<string, unknown>[]
}

function assertSnapshot(input: unknown): PublicSnapshotLike {
  const s = input as PublicSnapshotLike
  if (!s || typeof s !== 'object') throw new Error('快照不是有效的 JSON 对象')
  if (!s.manifest || s.manifest.formatVersion !== 1) throw new Error('不是支持的发布快照（格式版本应为 1）')
  if (!s.person || typeof s.person !== 'object') throw new Error('快照缺少人物信息')
  for (const key of ['entries', 'photos', 'preferences', 'wishes', 'gifts', 'health', 'insights', 'summaries', 'statuses'] as const) {
    if (!Array.isArray(s[key])) throw new Error(`快照缺少 ${key} 列表`)
  }
  return s
}

/**
 * 公开快照 → 本地 BackupData（不包含 meta）
 *
 * 时间戳的取法很关键：快照是字段白名单，不带每条记录的 updatedAt。
 * 早期实现把缺失的时间回退成「导入那一刻」（nowISO()），结果是导入出来的副本
 * 版本号比手机上真实做过的修改还新 —— 电脑点一次「上传本机到云端」，
 * 就会把手机端的修改整批覆盖掉。这类覆盖不可逆，因此这里一律回退到
 * `manifest.publishedAt`：它的语义是「这份内容的版本时间」，
 * 之后就发生的编辑才算更新，才允许赢。
 */
function toBackupData(s: PublicSnapshotLike): BackupData {
  const p = s.person as Record<string, unknown>
  const personId = String(p.id || s.config?.centerPersonId || '')
  if (!personId) throw new Error('快照缺少人物 ID')
  const published = str((s.manifest as Record<string, unknown> | undefined)?.publishedAt)
  const publishedAt = published && Number.isFinite(Date.parse(published)) ? published : '2000-01-01T00:00:00.000Z'
  // 缺失时间时的统一回退：不用导入时刻，避免「导入的旧内容」看起来比真实编辑更新
  const base = publishedAt
  const stamp = (v: unknown) => str(v) || base

  const person: Person = {
    id: personId,
    name: String(p.displayName || ''),
    nickname: str(p.nickname),
    avatarPhotoId: str(p.avatarPhotoId),
    birthday: str(p.birthday),
    calendarType: (p.calendarType as Person['calendarType']) || 'solar',
    zodiac: str(p.zodiac),
    meetDate: str(p.meetDate),
    anniversaries: asArray(s.anniversaries).map(
      (a): Anniversary => ({
        id: String(a.id),
        name: String(a.name || ''),
        date: String(a.date || ''),
        calendarType: (a.calendarType as Anniversary['calendarType']) || 'solar',
        repeatYearly: Boolean(a.repeatYearly),
        note: str(a.note),
      }),
    ),
    intro: str(p.intro),
    tags: asArray(p.tags as string[]),
    isActive: true,
    createdAt: base,
    updatedAt: base,
  }

  const entries: Entry[] = asArray(s.entries).map((e) => ({
    id: String(e.id),
    personId,
    occurredAt: stamp(e.occurredAt),
    type: (e.kind as Entry['type']) || 'other',
    title: String(e.title || ''),
    content: str(e.content),
    taSaid: str(e.taSaid),
    myObservation: str(e.myObservation),
    mood: e.mood as Entry['mood'],
    moodCustom: str(e.moodCustom),
    moodLevel: num(e.moodLevel),
    tagList: asArray(e.tags as string[]),
    photoIds: asArray(e.photoIds as string[]),
    followUpDone: false,
    quick: Boolean(e.quick),
    createdAt: stamp(e.occurredAt),
    updatedAt: stamp(e.occurredAt),
  }))

  const photos: PhotoMeta[] = asArray(s.photos).map((ph) => {
    const media = (ph.media || {}) as { full?: { key?: string; url?: string }; thumb?: { key?: string; url?: string } }
    const fullKey = String(media.full?.key || media.full?.url || '')
    const thumbKey = String(media.thumb?.key || media.thumb?.url || '')
    return {
      id: String(ph.id),
      personId,
      mime: String(ph.mime || 'image/jpeg'),
      size: num(ph.size) ?? 0,
      takenAt: str(ph.takenAt),
      caption: str(ph.caption),
      entryId: str(ph.entryId),
      giftId: str(ph.giftId),
      tags: asArray(ph.tags as string[]),
      keepOriginal: false,
      createdAt: stamp(ph.takenAt),
      file: fullKey,
      thumbFile: thumbKey,
    }
  })

  const preferences: Preference[] = asArray(s.preferences).map((r) => ({
    id: String(r.id),
    personId,
    category: String(r.category || '其他'),
    name: String(r.name || ''),
    direction: (r.direction as Preference['direction']) || 'like',
    likeLevel: num(r.likeLevel),
    note: str(r.note),
    tags: asArray(r.tags as string[]),
    lastConfirmedAt: str(r.lastConfirmedAt),
    evidenceEntryIds: asArray(r.evidenceEntryIds as string[]),
    createdAt: stamp(r.lastConfirmedAt),
    updatedAt: stamp(r.lastConfirmedAt),
  }))

  const wishes: Wish[] = asArray(s.wishes).map((r) => ({
    id: String(r.id),
    personId,
    content: String(r.content || ''),
    raisedAt: str(r.raisedAt),
    status: (r.status as Wish['status']) || 'wish',
    priority: num(r.priority),
    occasion: str(r.occasion),
    note: str(r.note),
    giftId: str(r.giftId),
    entryIds: asArray(r.entryIds as string[]),
    createdAt: stamp(r.raisedAt),
    updatedAt: stamp(r.raisedAt),
  }))

  const gifts: Gift[] = asArray(s.gifts).map((r) => ({
    id: String(r.id),
    personId,
    name: String(r.name || ''),
    givenAt: stamp(r.givenAt),
    occasion: str(r.occasion),
    feedback: str(r.feedback),
    note: str(r.note),
    entryId: str(r.entryId),
    wishId: str(r.wishId),
    photoIds: asArray(r.photoIds as string[]),
    createdAt: stamp(r.givenAt),
    updatedAt: stamp(r.givenAt),
  }))

  const health: HealthRecord[] = asArray(s.health).map((r) => ({
    id: String(r.id),
    personId,
    occurredAt: stamp(r.occurredAt),
    symptom: String(r.symptom || ''),
    severity: num(r.severity),
    note: str(r.note),
    status: (r.status as HealthRecord['status']) || 'ongoing',
    recovery: str(r.recovery),
    resolvedAt: str(r.resolvedAt),
    entryIds: [],
    createdAt: stamp(r.occurredAt),
    updatedAt: stamp(r.occurredAt),
  }))

  const insights: PortraitInsight[] = asArray(s.insights).map((r) => ({
    id: String(r.id),
    personId,
    dimension: String(r.dimension || ''),
    description: String(r.description || ''),
    evidenceType: (r.evidenceType as PortraitInsight['evidenceType']) || 'hypothesis',
    evidenceEntryIds: asArray(r.evidenceEntryIds as string[]),
    confirmState: (r.confirmState as PortraitInsight['confirmState']) || 'pending',
    userEdited: false,
    createdAt: base,
    updatedAt: base,
  }))

  const summaries: Summary[] = asArray(s.summaries).map((r) => ({
    id: String(r.id),
    personId,
    kind: (r.kind as Summary['kind']) || 'custom',
    title: String(r.title || ''),
    rangeStart: String(r.rangeStart || ''),
    rangeEnd: String(r.rangeEnd || ''),
    content: String(r.content || ''),
    generator: (r.generator as Summary['generator']) || 'manual',
    evidenceEntryIds: asArray(r.evidenceEntryIds as string[]),
    createdAt: base,
    updatedAt: base,
  }))

  const dailyStatus: DailyStatus[] = asArray(s.statuses).map((r) => ({
    id: String(r.id),
    personId,
    date: String(r.date || ''),
    mood: r.mood as DailyStatus['mood'],
    moodLevel: num(r.moodLevel),
    energy: num(r.energy),
    sleepHours: num(r.sleepHours),
    goodThing: str(r.goodThing),
    worry: str(r.worry),
    note: str(r.note),
    createdAt: stamp(r.date),
    updatedAt: stamp(r.date),
  }))

  return {
    persons: [person],
    preferences,
    entries,
    dailyStatus,
    health,
    gifts,
    wishes,
    photos,
    insights,
    summaries,
    // meta 故意留空：公开快照不含作者配置，新设备沿用本地默认
    meta: [],
  }
}

function basename(key: string): string {
  const clean = key.split('?')[0].split('#')[0]
  return clean.slice(clean.lastIndexOf('/') + 1)
}

/** 统一入口：给定快照与媒体取二进制的方式，写入本地库 */
async function copyWith(
  raw: unknown,
  getBinary: (kind: 'full' | 'thumb', photo: Record<string, unknown>) => Promise<{ blob: Blob; thumb: Blob } | null>,
  onProgress?: (p: CopyProgress) => void,
): Promise<CopyResult> {
  const snapshot = assertSnapshot(raw)
  const data = toBackupData(snapshot)
  const total = data.photos?.length ?? 0
  let done = 0
  let missing = 0
  const binaries = new Map<string, { blob: Blob; thumb: Blob }>()

  for (const photo of snapshot.photos || []) {
    const bin = await getBinary('full', photo)
    if (bin) binaries.set(String(photo.id), bin)
    else missing++
    done++
    onProgress?.({ phase: 'media', done, total })
  }

  onProgress?.({ phase: 'write', done: total, total })
  // merge：新设备上等价全量导入；已有内容不会被覆盖
  const imported = await applyBackupData(data, binaries, 'merge')
  return { publishId: String(snapshot.manifest?.publishId || ''), imported, media: { ok: binaries.size, missing } }
}

/** 从目录选择导入（完全离线，最稳） */
export async function copyFromFiles(files: File[], onProgress?: (p: CopyProgress) => void): Promise<CopyResult> {
  onProgress?.({ phase: 'read', done: 0, total: 1 })
  const json = files.find((f) => f.name === 'public-snapshot.json') || files.find((f) => f.name.endsWith('.json'))
  if (!json) throw new Error('没有找到 public-snapshot.json，请选择包含快照与 media 的目录')

  const byName = new Map<string, File>()
  for (const f of files) {
    // webkitRelativePath 形如 snapshot/media/xxx.jpg
    const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name
    byName.set(basename(rel), f)
  }

  const raw = JSON.parse(await json.text())
  const snapshot = assertSnapshot(raw)

  return copyWith(
    snapshot,
    async (_kind, photo) => {
      const media = (photo.media || {}) as { full?: { key?: string }; thumb?: { key?: string } }
      const fullName = basename(String(media.full?.key || ''))
      const thumbName = basename(String(media.thumb?.key || ''))
      const fullFile = byName.get(fullName)
      const thumbFile = byName.get(thumbName)
      if (!fullFile || !thumbFile) return null
      const mime = String(photo.mime || fullFile.type || 'image/jpeg')
      return {
        blob: fullFile.slice(0, fullFile.size, mime),
        thumb: thumbFile.slice(0, thumbFile.size, thumbFile.type || mime),
      }
    },
    onProgress,
  )
}

/** 从地址导入（同源或服务端允许跨域时可用） */
export async function copyFromUrl(url: string, onProgress?: (p: CopyProgress) => void): Promise<CopyResult> {
  onProgress?.({ phase: 'read', done: 0, total: 1 })
  let res: Response
  try {
    res = await fetch(url, { cache: 'no-store' })
  } catch {
    throw new Error('无法读取该地址：可能是跨域限制或网络不可达。可以改用「选择发布目录」离线导入。')
  }
  if (!res.ok) throw new Error(`读取快照失败：HTTP ${res.status}`)

  const raw = await res.json()
  const snapshot = assertSnapshot(raw)
  const resolve = (key: string) => new URL(key, url).toString()

  return copyWith(
    snapshot,
    async (_kind, photo) => {
      const media = (photo.media || {}) as { full?: { key?: string }; thumb?: { key?: string } }
      const fullUrl = resolve(String(media.full?.key || ''))
      const thumbUrl = resolve(String(media.thumb?.key || ''))
      const [fullRes, thumbRes] = await Promise.all([fetch(fullUrl), fetch(thumbUrl)])
      if (!fullRes.ok || !thumbRes.ok) return null
      const mime = String(photo.mime || 'image/jpeg')
      const fullBuf = await fullRes.blob()
      const thumbBuf = await thumbRes.blob()
      return { blob: fullBuf.slice(0, fullBuf.size, mime), thumb: thumbBuf.slice(0, thumbBuf.size, thumbBuf.type || mime) }
    },
    onProgress,
  )
}

/** 供设置页复用的计数文案 */
export function describeImport(result: ImportResult): string {
  const entries = result.imported.entries ?? 0
  const photos = result.imported.photos ?? 0
  const skipped = Object.values(result.skipped).reduce((n, v) => n + v, 0)
  return `导入 ${entries} 条记录、${photos} 张照片${skipped ? `，跳过已存在 ${skipped} 条` : ''}`
}

/**
 * 仅测试用：把一份公开快照映射成本地数据结构，不写库。
 * 用于断言「导入产生的时间戳不得晚于发布时刻」—— 这条约束是同步不被旧副本覆盖的前提。
 */
export function __snapshotToBackupDataForTest(snapshot: unknown): BackupData {
  return toBackupData(assertSnapshot(snapshot))
}

