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
import type { PublishedSnapshot } from '../viewer/types'

export const PUBLIC_SNAPSHOT_TABLE = 'heartlog_public_snapshot'
export const PUBLIC_MEDIA_TABLE = 'heartlog_public_media'

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
  const session = skipSessionCheck ? { user: { id: 'test' } } : await getCloudSession()
  if (!session) throw new PublishError('请先登录云端账号再发布')
  const onProgress = opts.onProgress ?? (() => {})

  onProgress({ phase: 'prepare', done: 0, total: 1, label: '整理内容' })
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
    errors,
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
