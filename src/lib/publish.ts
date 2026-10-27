/**
 * 发布到云端（D-012）：作者端一点，公网页就变。
 *
 * 为什么是「云端发布」而不是继续静态发布：
 * 公网页原来读的是构建时打进去的快照文件，作者改完必须重新构建+部署才可见。
 * 现在把快照与照片写进两张云端表，公网页按匿名只读策略直接读取——
 * 作者改完点「发布」即可上线，不需要重新构建。
 *
 * 分工：
 * - `heartlog_public_snapshot`：一人一行，payload 就是访客端那套 PublishedSnapshot（媒体 URL 留空）。
 * - `heartlog_public_media`：一行一格（缩略图 / 网页图），base64 存二进制。
 * 两张表都有 `is_live`，匿名只能读 `is_live = true` 的行（见数据库策略）。
 *
 * 安全边界：写操作走作者登录会话（RLS owner_id = auth.uid()）；
 * 访客只拿到「已发布」的只读内容，拿不到本机数据库、密钥或未发布草稿。
 */
import { db } from '../db/db'
import { cloud, getCloudSession } from './cloud'
import { resizeImage } from './photo'
import { buildLocalSnapshot } from '../viewer/data/local'
import { assertGameContentPublishable } from './gameContent'
import type { PublishedSnapshot } from '../viewer/types'

export const PUBLIC_SNAPSHOT_TABLE = 'heartlog_public_snapshot'
export const PUBLIC_MEDIA_TABLE = 'heartlog_public_media'
/** 版本历史：每次发布/回退留一份完整 payload，用于差异预览、回退与审计 */
export const PUBLISH_HISTORY_TABLE = 'heartlog_publish_history'
/** 访问控制指针：访客先读它，`retracted` 时不再回退到构建时打进去的静态旧内容 */
export const PUBLISH_STATE_TABLE = 'heartlog_publish_state'

/** 网页图最大边与质量：够手机大图看，又不至于把库撑爆 */
const WEB_MAX_EDGE = 1600
const WEB_QUALITY = 0.75

export interface PublishProgress {
  phase: 'prepare' | 'photos' | 'snapshot'
  done: number
  total: number
  label?: string
}

export interface PublishResult {
  publishId: string
  publishedAt: string
  entries: number
  photos: number
  photosUploaded: number
  photosSkipped: number
  bytesUploaded: number
  errors: string[]
}

export class PublishError extends Error {}

/* 测试接缝：只给 verify/selftest.html 的离线自测用，生产不调用 */
type PublishDb = typeof cloud.database
let activeDb: PublishDb = cloud.database

/** 仅测试用：替换云数据库客户端 */
export function __setPublishDbForTest(next: PublishDb | null): void {
  activeDb = next ?? cloud.database
}

/** 仅测试用：跳过登录检查（自测里没有真实会话） */
let skipSessionCheck = false
export function __skipPublishSessionForTest(skip: boolean): void {
  skipSessionCheck = skip
}

/**
 * 取会话；未登录直接抛错。
 * 自测里没有真实登录，用同一个开关模拟「已登录」，
 * 否则预览/回退/撤回这些新路径在离线自测里根本跑不到。
 */
async function requireSession(): Promise<{ user: { id: string } }> {
  if (skipSessionCheck) return { user: { id: 'test' } }
  const session = await getCloudSession()
  if (!session) throw new PublishError('请先登录云端账号再发布')
  return session
}

async function hasSession(): Promise<boolean> {
  if (skipSessionCheck) return true
  return (await getCloudSession()) !== null
}

interface MediaRow {
  photo_id: string
  kind: 'thumb' | 'web'
  mime: string
  bytes: number
  data_b64: string
  fingerprint: string
}

function b64(bytes: Uint8Array): string {
  let s = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    s += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)))
  }
  return btoa(s)
}

async function fingerprint(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer()
  if (!globalThis.crypto?.subtle) return `${blob.size}`
  const digest = await crypto.subtle.digest('SHA-256', buf)
  return Array.from(new Uint8Array(digest))
    .slice(0, 12)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

async function restError(err: { message?: string } | null, fallback: string): Promise<PublishError> {
  return new PublishError(err?.message ? `${fallback}：${err.message}` : fallback)
}

/** 现有媒体行的指纹，用来跳过没变化的照片（重复发布不必重传 60MB） */
async function loadExistingFingerprints(): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  const { data, error } = await activeDb
    .from(PUBLIC_MEDIA_TABLE)
    .select('photo_id,kind,fingerprint,bytes')
    .limit(2000)
  if (error) return map // 读不到就当没有：宁可重传，也不要卡住发布
  const rows = (data ?? []) as { photo_id: string; kind: string; fingerprint: string; bytes: number }[]
  for (const r of rows) map.set(`${r.photo_id}:${r.kind}`, r.fingerprint || `bytes:${r.bytes}`)
  return map
}

/** 把本地照片压成「缩略图 + 网页图」两格 */
async function renditions(row: { id: string; mime: string; blob: Blob; thumb: Blob }): Promise<{
  thumb: Blob
  web: Blob
}> {
  // 解码失败（少见格式、损坏文件）时退回原图，别让一张照片毁掉整次发布
  let web = row.blob
  try {
    web = await resizeImage(row.blob, WEB_MAX_EDGE, WEB_QUALITY)
  } catch {
    web = row.blob
  }
  let thumb = row.thumb
  if (!thumb) {
    try {
      thumb = await resizeImage(row.blob, 400, 0.7)
    } catch {
      thumb = row.blob
    }
  }
  return { thumb, web }
}

async function upsertMedia(rows: MediaRow[], publishId: string): Promise<void> {
  // 单条 100~300KB，一条一次请求最稳；批量容易撞网关体积限制
  for (const row of rows) {
    const { error } = await activeDb.from(PUBLIC_MEDIA_TABLE).upsert(
      {
        photo_id: row.photo_id,
        kind: row.kind,
        publish_id: publishId,
        mime: row.mime,
        bytes: row.bytes,
        data_b64: row.data_b64,
        fingerprint: row.fingerprint,
        is_live: true,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'owner_id,photo_id,kind' },
    )
    if (error) throw await restError(error, `照片 ${row.photo_id} 的 ${row.kind} 上传失败`)
  }
}

/** 生成不再带媒体地址的快照：图片由访客端按需从媒体表取 */
function portableSnapshot(snapshot: PublishedSnapshot, publishId: string): PublishedSnapshot {
  return {
    ...snapshot,
    manifest: {
      ...snapshot.manifest,
      publishId,
      publishedAt: new Date().toISOString(),
    },
    photos: snapshot.photos.map((p) => ({
      ...p,
      media: {
        thumb: { ...p.media.thumb, url: '' },
        full: { ...p.media.full, url: '' },
      },
    })),
  }
}

/**
 * 发布到云端。要求已登录（写入受 RLS 保护）。
 * 顺序：先传照片 → 再写快照 → 最后下线多余照片，保证访客读到的快照与媒体一致。
 */
export async function publishToCloud(
  opts: { onProgress?: (p: PublishProgress) => void } = {},
): Promise<PublishResult> {
  await requireSession()
  const onProgress = opts.onProgress ?? (() => {})

  onProgress({ phase: 'prepare', done: 0, total: 1, label: '整理内容' })
  await assertGameContentPublishable()
  const snapshot = await buildLocalSnapshot()
  if (!snapshot) throw new PublishError('本机还没有内容，先记点什么再发布')

  const publishId = `pub_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`
  const photos = await db.photos.toArray()
  const existing = await loadExistingFingerprints()

  const errors: string[] = []
  let uploaded = 0
  let skipped = 0
  let bytesUploaded = 0

  onProgress({ phase: 'photos', done: 0, total: photos.length, label: '处理照片' })
  let done = 0

  /** 单张照片：压图 → 比对指纹 → 逐格上传 */
  const publishOne = async (photo: (typeof photos)[number]) => {
    const { thumb, web } = await renditions(photo)
    const targets: { kind: 'thumb' | 'web'; blob: Blob; mime: string }[] = [
      { kind: 'thumb', blob: thumb, mime: 'image/jpeg' },
      { kind: 'web', blob: web, mime: 'image/jpeg' },
    ]
    const rows: MediaRow[] = []
    for (const t of targets) {
      const fp = await fingerprint(t.blob)
      const key = `${photo.id}:${t.kind}`
      if (existing.get(key) === fp) {
        skipped++
        continue
      }
      const buf = new Uint8Array(await t.blob.arrayBuffer())
      rows.push({
        photo_id: photo.id,
        kind: t.kind,
        mime: t.mime,
        bytes: t.blob.size,
        data_b64: b64(buf),
        fingerprint: fp,
      })
    }
    if (rows.length) {
      await upsertMedia(rows, publishId)
      uploaded += rows.length
      bytesUploaded += rows.reduce((n, r) => n + r.bytes, 0)
      for (const r of rows) existing.set(`${r.photo_id}:${r.kind}`, r.fingerprint)
    }
  }

  // 3 张一组并发：串行在手机上要等太久，太高又会撞网关体积限制
  const GROUP = 3
  for (let i = 0; i < photos.length; i += GROUP) {
    const group = photos.slice(i, i + GROUP)
    await Promise.all(
      group.map(async (photo) => {
        try {
          await publishOne(photo)
        } catch (err) {
          errors.push(`照片 ${photo.id}：${(err as Error).message}`)
        } finally {
          done++
        }
      }),
    )
    onProgress({ phase: 'photos', done, total: photos.length, label: '上传照片' })
  }

  /**
   * 任一照片失败就中止发布。
   *
   * 为什么不能「部分失败继续发」：快照里带着全部 104 个 photo_id，
   * 只要有几张媒体没写进去，公网页就会出现「记录是新的、图是缺的」这种
   * 不一致状态 —— 访客看到的是破图，而作者以为发成功了。
   * 媒体缺失比「停在上一版」严重得多：停在上一版只是旧，不一致是坏。
   *
   * 照片是原子单位：一张照片的 thumb 与 web 必须都成功，否则整张算失败
   * （publishOne 内部已是全有或全无，这里只判断照片级结果）。
   */
  if (errors.length > 0) {
    const head = errors.slice(0, 3).join('；')
    const more = errors.length > 3 ? `…等 ${errors.length} 张` : ''
    throw new PublishError(
      `${errors.length}/${photos.length} 张照片上传失败，已中止发布（公网页仍是上一版，未产生不一致快照）。失败：${head}${more}`,
    )
  }

  onProgress({ phase: 'snapshot', done: 0, total: 1, label: '写入快照' })
  const payload = portableSnapshot(snapshot, publishId)

  /**
   * 混版检查：快照里出现的每个 photo_id，在媒体表里必须 thumb + web 都齐。
   *
   * 一道廉价但对账有效的兜底：即使上传阶段因为跳过/指纹比对出现了漏格，
   * 也不能让「快照引用了没有媒体的照片」这种状态上线。
   */
  const need = new Set<string>()
  for (const p of payload.photos) need.add(String(p.id))
  const lack: string[] = []
  for (const id of need) {
    if (!existing.has(`${id}:thumb`) || !existing.has(`${id}:web`)) lack.push(id)
  }
  if (lack.length) {
    const head = lack.slice(0, 3).join(', ')
    const more = lack.length > 3 ? ` 等 ${lack.length} 张` : ''
    throw new PublishError(
      `快照引用了 ${lack.length} 张没有完整媒体的照片（${head}${more}），已中止发布，避免公网页出现破图。`,
    )
  }

  const { error: snapErr } = await activeDb.from(PUBLIC_SNAPSHOT_TABLE).upsert(
    {
      publish_id: publishId,
      payload: payload as unknown as Record<string, unknown>,
      counts: payload.manifest.counts as unknown as Record<string, number>,
      is_live: true,
      published_at: new Date().toISOString(),
    },
    { onConflict: 'owner_id' },
  )
  if (snapErr) throw await restError(snapErr, '写入发布快照失败')

  /**
   * 版本历史 + 访问指针。
   *
   * 顺序很关键：先写历史（新版本落盘，失败也不影响线上），
   * 再写指针（`state = live`）。指针是单行 upsert，访客读到的
   * 要么是旧版本、要么是新版本，不会停在半套内容上。
   *
   * 历史写失败不让整次发布失败：线上内容已经正确，历史只是「能不能回退」，
   * 为它回滚一次已经成功的发布代价更大。失败会在返回值里如实标出。
   */
  const historyErrors: string[] = []
  const { error: histErr } = await activeDb.from(PUBLISH_HISTORY_TABLE).upsert(
    {
      publish_id: publishId,
      payload: payload as unknown as Record<string, unknown>,
      counts: payload.manifest.counts as unknown as Record<string, number>,
      published_at: payload.manifest.publishedAt,
      kind: 'publish',
      last_activated_at: payload.manifest.publishedAt,
    },
    { onConflict: 'owner_id,publish_id' },
  )
  if (histErr) historyErrors.push(`版本历史未写入：${histErr.message}`)

  const { error: stateErr } = await activeDb.from(PUBLISH_STATE_TABLE).upsert(
    { state: 'live', note: null, updated_at: new Date().toISOString() },
    { onConflict: 'owner_id' },
  )
  if (stateErr) historyErrors.push(`访问指针未更新：${stateErr.message}`)

  // 删除过的照片不回删媒体行：访客只按快照里出现的 photo_id 取图，
  // 孤儿行仅占存储、不会被读出来。批量 delete/update 一旦被网关忽略过滤条件会误删全部媒体，
  // 这个风险不值得用「省一点存储」去换。
  onProgress({ phase: 'snapshot', done: 1, total: 1, label: '完成' })

  return {
    publishId,
    publishedAt: payload.manifest.publishedAt,
    entries: payload.entries.length,
    photos: payload.photos.length,
    photosUploaded: uploaded,
    photosSkipped: skipped,
    bytesUploaded,
    errors: [...errors, ...historyErrors],
  }
}

/** 取当前已发布的快照元信息（作者端显示「线上是哪一版」） */
export async function currentPublished(): Promise<{ publishId: string; publishedAt: string } | null> {
  const session = await getCloudSession()
  if (!session) return null
  const { data, error } = await activeDb
    .from(PUBLIC_SNAPSHOT_TABLE)
    .select('publish_id,published_at,is_live')
    .limit(1)
  if (error || !data?.length) return null
  const row = data[0] as { publish_id: string; published_at: string; is_live: boolean }
  if (!row.is_live) return null
  return { publishId: row.publish_id, publishedAt: row.published_at }
}

/* ------------------------------------------------------------------ */
/* 发布预览与差异（T4：真实预览、版本隔离、原子切换、历史回退、真正撤回） */
/* ------------------------------------------------------------------ */

export type PublishLiveState = 'live' | 'retracted'

export interface CountDiff {
  added: number
  removed: number
  changed: number
}

export interface PublishPreview {
  /** 线上当前这一版；没发布过为 null */
  live: { publishId: string; publishedAt: string; counts: Record<string, number> } | null
  /** 访问指针：live / retracted / none（还没有指针行） */
  state: PublishLiveState | 'none'
  nextCounts: Record<string, number>
  diff: Record<string, CountDiff>
  /** 人类可读的差异行，只列有变化的 */
  lines: string[]
  hasChanges: boolean
}

/** 快照里参与差异比对的实体字段（与 manifest.counts 的键对应） */
const DIFF_KEYS = [
  'entries',
  'photos',
  'preferences',
  'wishes',
  'gifts',
  'health',
  'insights',
  'summaries',
  'statuses',
  'anniversaries',
  'gameContent',
] as const

const DIFF_LABEL: Record<string, string> = {
  entries: '记录',
  photos: '照片',
  preferences: '偏好',
  wishes: '心愿',
  gifts: '礼物',
  health: '健康',
  insights: '画像',
  summaries: '回顾',
  statuses: '每日状态',
  anniversaries: '纪念日',
  gameContent: '玩法内容',
}

/**
 * 稳定序列化：键排序后比较。
 *
 * 直接用 JSON.stringify 会受对象属性顺序影响——同一份内容换个顺序生成，
 * 就会被判成「有修改」，差异预览立刻变成噪音。
 */
function stable(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  const obj = value as Record<string, unknown>
  const keys = Object.keys(obj).sort()
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stable(obj[k])}`).join(',')}}`
}

function indexById(list: unknown, strip: string[] = []): Map<string, string> {
  const map = new Map<string, string>()
  if (!Array.isArray(list)) return map
  for (const item of list) {
    if (!item || typeof item !== 'object') continue
    const id = String((item as { id?: unknown }).id ?? '')
    if (!id) continue
    let value = item as Record<string, unknown>
    if (strip.length) {
      value = { ...value }
      for (const k of strip) delete value[k]
    }
    map.set(id, stable(value))
  }
  return map
}

/**
 * 差异比对。
 *
 * `photoStrip`：线上 payload 里的媒体地址被刻意清空（图由访客按需取），
 * 而本机快照带着真实 URL。不把 `media` 排除掉，每次预览都会报「照片全改了」，
 * 差异就失去意义 —— 照片是否变化只看 id 与元数据。
 */
function diffEntity(prev: unknown, next: unknown, photoStrip = false): CountDiff {
  const strip = photoStrip ? ['media'] : []
  const a = indexById(prev, strip)
  const b = indexById(next, strip)
  let added = 0
  let removed = 0
  let changed = 0
  for (const [id, sig] of b) {
    const old = a.get(id)
    if (old === undefined) added++
    else if (old !== sig) changed++
  }
  for (const id of a.keys()) if (!b.has(id)) removed++
  return { added, removed, changed }
}

/** 当前访问指针（作者视角；读不到按 none 处理，不阻塞发布） */
export async function currentPublishState(): Promise<{ state: PublishLiveState | 'none'; note: string }> {
  if (!(await hasSession())) return { state: 'none', note: '' }
  const { data, error } = await activeDb
    .from(PUBLISH_STATE_TABLE)
    .select('state,note')
    .limit(1)
  if (error || !data?.length) return { state: 'none', note: '' }
  const row = data[0] as { state: string; note: string | null }
  return { state: row.state === 'retracted' ? 'retracted' : 'live', note: row.note ?? '' }
}

/**
 * 发布前预览：把「这次发布会改什么」先算出来。
 *
 * 只在有登录时可用（要读线上 payload 做比对）。读不到线上版本时退化为
 * 「首次发布」，diff 全部计为新增 —— 这比「假装没有变化」诚实。
 */
export async function previewPublish(): Promise<PublishPreview> {
  await requireSession()
  const snapshot = await buildLocalSnapshot()
  if (!snapshot) throw new PublishError('本机还没有内容，先记点什么再发布')

  const nextCounts = { ...(snapshot.manifest.counts as Record<string, number>) }

  const { data, error } = await activeDb
    .from(PUBLIC_SNAPSHOT_TABLE)
    .select('publish_id,published_at,payload,counts')
    .limit(1)
  const row = !error && data?.length
    ? (data[0] as { publish_id: string; published_at: string; payload: Record<string, unknown>; counts: Record<string, number> })
    : null

  const state = await currentPublishState()
  const diff: Record<string, CountDiff> = {}
  const lines: string[] = []

  for (const key of DIFF_KEYS) {
    const prev = row?.payload ? (row.payload as Record<string, unknown>)[key] : undefined
    const next = (snapshot as unknown as Record<string, unknown>)[key]
    const d = diffEntity(prev, next, key === 'photos')
    diff[key] = d
    if (d.added || d.removed || d.changed) {
      const parts: string[] = []
      if (d.added) parts.push(`+${d.added}`)
      if (d.removed) parts.push(`-${d.removed}`)
      if (d.changed) parts.push(`改 ${d.changed}`)
      lines.push(`${DIFF_LABEL[key] ?? key} ${parts.join(' / ')}`)
    }
  }

  return {
    live: row ? { publishId: row.publish_id, publishedAt: row.published_at, counts: row.counts ?? {} } : null,
    state: state.state,
    nextCounts,
    diff,
    lines,
    hasChanges: lines.length > 0,
  }
}

export interface PublishedVersion {
  publishId: string
  publishedAt: string
  counts: Record<string, number>
  kind: string
  lastActivatedAt: string
  isLive: boolean
}

/** 版本历史（最近的在前）；`isLive` 标记当前线上那一版 */
export async function listPublishedVersions(limit = 8): Promise<PublishedVersion[]> {
  if (!(await hasSession())) return []
  const { data, error } = await activeDb
    .from(PUBLISH_HISTORY_TABLE)
    .select('publish_id,published_at,counts,kind,last_activated_at')
    .order('published_at', { ascending: false })
    .limit(limit)
  if (error || !data?.length) return []
  const live = await currentPublished()
  return (data as unknown as { publish_id: string; published_at: string; counts: Record<string, number>; kind: string; last_activated_at: string }[]).map(
    (r) => ({
      publishId: r.publish_id,
      publishedAt: r.published_at,
      counts: r.counts ?? {},
      kind: r.kind,
      lastActivatedAt: r.last_activated_at,
      isLive: Boolean(live && live.publishId === r.publish_id),
    }),
  )
}

/**
 * 回退到历史某一版。
 *
 * 做法不是「复制旧内容再发布一次」，而是把旧版本 payload 重新写成线上快照、
 * 指针指回 `live`：
 * - 媒体从不按版本删除（发布只 upsert），所以旧版本的图一定还在；
 * - 快照是单行，写一次就是一次原子切换，访客不会看到两版混排。
 *
 * 回退前会核对「旧版本引用的照片是否都还有媒体」，缺图就中止 ——
 * 否则访客会看到记录回来了、图却全是破图。
 */
export async function rollbackToVersion(publishId: string): Promise<PublishResult> {
  await requireSession()

  const { data, error } = await activeDb
    .from(PUBLISH_HISTORY_TABLE)
    .select('publish_id,payload,counts,published_at')
    .eq('publish_id', publishId)
    .limit(1)
  if (error) throw await restError(error, '读取历史版本失败')
  if (!data?.length) throw new PublishError('找不到这一版的历史记录')

  const row = data[0] as unknown as {
    publish_id: string
    payload: PublishedSnapshot
    counts: Record<string, number>
    published_at: string
  }
  const payload = row.payload
  if (!payload?.manifest) throw new PublishError('这一版的内容已损坏，无法回退')

  const media = await loadExistingFingerprints()
  const lack = payload.photos.map((p) => String(p.id)).filter((id) => !media.has(`${id}:thumb`) || !media.has(`${id}:web`))
  if (lack.length) {
    const head = lack.slice(0, 3).join(', ')
    throw new PublishError(
      `这一版引用的 ${lack.length} 张照片在云端已没有媒体（${head}），回退会让公网页破图，已中止。`,
    )
  }

  const now = new Date().toISOString()
  const { error: snapErr } = await activeDb.from(PUBLIC_SNAPSHOT_TABLE).upsert(
    {
      publish_id: publishId,
      payload: payload as unknown as Record<string, unknown>,
      counts: (row.counts ?? payload.manifest.counts) as unknown as Record<string, number>,
      is_live: true,
      published_at: now,
    },
    { onConflict: 'owner_id' },
  )
  if (snapErr) throw await restError(snapErr, '回退失败：写入快照出错')

  await activeDb
    .from(PUBLISH_HISTORY_TABLE)
    .update({ last_activated_at: now })
    .eq('publish_id', publishId)

  const { error: stateErr } = await activeDb.from(PUBLISH_STATE_TABLE).upsert(
    { state: 'live', note: null, updated_at: now },
    { onConflict: 'owner_id' },
  )
  if (stateErr) throw await restError(stateErr, '回退失败：更新访问指针出错')

  return {
    publishId,
    publishedAt: now,
    entries: payload.entries?.length ?? 0,
    photos: payload.photos?.length ?? 0,
    photosUploaded: 0,
    photosSkipped: payload.photos?.length ?? 0,
    bytesUploaded: 0,
    errors: [],
  }
}

/**
 * 真正撤回：把线上快照标记为非 live，并把访问指针置成 `retracted`。
 *
 * 只把 `is_live` 置 false 是不够的 —— 访客端在「云端没有 live 版本」时会
 * 回退到构建时打进去的静态快照，看起来就像「撤回没生效」。
 * 指针是访客端唯一会先读的东西，它才是「停」的开关。
 */
export async function retractPublish(note = ''): Promise<void> {
  await requireSession()

  const { data } = await activeDb
    .from(PUBLIC_SNAPSHOT_TABLE)
    .select('publish_id,payload,counts,published_at')
    .limit(1)
  const row = data?.length
    ? (data[0] as unknown as {
        publish_id: string
        payload: PublishedSnapshot
        counts: Record<string, number>
        published_at: string
      })
    : null

  if (row?.payload) {
    const { error } = await activeDb.from(PUBLIC_SNAPSHOT_TABLE).upsert(
      {
        publish_id: row.publish_id,
        payload: row.payload as unknown as Record<string, unknown>,
        counts: row.counts ?? {},
        is_live: false,
        published_at: row.published_at,
      },
      { onConflict: 'owner_id' },
    )
    if (error) throw await restError(error, '撤回失败：快照未能下线')
  }

  const { error: stateErr } = await activeDb.from(PUBLISH_STATE_TABLE).upsert(
    { state: 'retracted', note: note.trim() || null, updated_at: new Date().toISOString() },
    { onConflict: 'owner_id' },
  )
  if (stateErr) throw await restError(stateErr, '撤回失败：访问指针未更新')
}

/** 撤回后重新上线：把最后一个版本重新置为 live */
export async function resumePublish(): Promise<void> {
  await requireSession()

  const { data } = await activeDb
    .from(PUBLIC_SNAPSHOT_TABLE)
    .select('publish_id,payload,counts,published_at')
    .limit(1)
  const row = data?.length
    ? (data[0] as unknown as {
        publish_id: string
        payload: PublishedSnapshot
        counts: Record<string, number>
        published_at: string
      })
    : null

  if (row?.payload) {
    const { error } = await activeDb.from(PUBLIC_SNAPSHOT_TABLE).upsert(
      {
        publish_id: row.publish_id,
        payload: row.payload as unknown as Record<string, unknown>,
        counts: row.counts ?? {},
        is_live: true,
        published_at: new Date().toISOString(),
      },
      { onConflict: 'owner_id' },
    )
    if (error) throw await restError(error, '重新上线失败')
  }

  const { error: stateErr } = await activeDb.from(PUBLISH_STATE_TABLE).upsert(
    { state: 'live', note: null, updated_at: new Date().toISOString() },
    { onConflict: 'owner_id' },
  )
  if (stateErr) throw await restError(stateErr, '重新上线失败：访问指针未更新')
}
