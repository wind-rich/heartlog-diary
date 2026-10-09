/**
 * 云端备份与恢复
 *
 * 设计前提：**本地 IndexedDB 始终是唯一真相源**，云端只做「备份」与「换设备恢复」。
 * 所以这里没有双向同步、没有冲突合并 —— 只有「整体推上去」和「整体拉回来」。
 *
 * 对象存储布局（相对用户目录）：
 *   heartlog/photos/<photoId>.<ext>          照片原图（按 id 去重，多份备份共用）
 *   heartlog/photos/thumb_<photoId>.<ext>    缩略图
 *   heartlog/backups/<backupKey>/backup.json 一次备份的完整载荷（manifest + data）
 *
 * 数据库 heartlog_backups 表只登记元信息，用于在界面上列出历史备份。
 */
import { CLOUD_ROOT } from './cloudConfig'
import { BACKUP_TABLE, cloud, CloudUnavailableError, type CloudBackupRow } from './cloud'
import {
  BACKUP_VERSION,
  applyBackupData,
  collectBackupData,
  extOf,
  validateManifest,
  type BackupData,
  type BackupManifest,
  type ImportMode,
  type ImportResult,
  type PhotoBinaryMap,
} from './backup'

export type { CloudBackupRow }

interface CloudPayload {
  manifest: BackupManifest
  data: BackupData
}

export interface CloudBackupProgress {
  stage: 'collect' | 'photos' | 'upload' | 'record' | 'download' | 'restore' | 'done'
  done: number
  total: number
}

type Progress = (p: CloudBackupProgress) => void

/* ------------------------------------------------------------------ */
/* 工具                                                                */
/* ------------------------------------------------------------------ */

export async function currentUserId(): Promise<string> {
  const { data, error } = await cloud.auth.getSession()
  if (error || !data?.user?.id) throw new CloudUnavailableError('需要先登录云服务账号')
  return data.user.id
}

/** 数据库错误的用户可读文案（PostgREST 错误不是 CloudError，单独处理） */
function dbErrorText(err: { message?: string; code?: string } | null): string {
  if (!err) return '云端操作失败'
  switch (err.code) {
    case '42P01':
      return '云端数据表尚未创建，请联系维护者'
    case '42501':
      return '没有权限访问该数据（登录状态可能已失效）'
    case '23505':
      return '该备份已存在'
    default:
      return err.message || '云端操作失败'
  }
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let cursor = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = cursor++
      if (i >= items.length) return
      out[i] = await fn(items[i], i)
    }
  })
  await Promise.all(workers)
  return out
}

function photosPrefix(uid: string): string {
  return cloud.storage.userPath(uid, `${CLOUD_ROOT}/photos`)
}
function photoPath(uid: string, photoId: string, mime: string, thumb = false): string {
  return cloud.storage.userPath(uid, `${CLOUD_ROOT}/photos/${thumb ? 'thumb_' : ''}${photoId}.${extOf(mime)}`)
}
function payloadPath(uid: string, backupKey: string): string {
  return cloud.storage.userPath(uid, `${CLOUD_ROOT}/backups/${backupKey}/backup.json`)
}

/** 描述当前设备，仅用于备份列表展示 */
export function deviceLabel(): string {
  const ua = navigator.userAgent
  if (/iPhone|iPad|iPod/.test(ua)) return 'iPhone / iPad'
  if (/Android/.test(ua)) return 'Android 手机'
  if (/Macintosh/.test(ua)) return 'Mac'
  if (/Windows/.test(ua)) return 'Windows'
  return '未知设备'
}

function makeBackupKey(): string {
  const d = new Date()
  const p = (n: number, w = 2) => String(n).padStart(w, '0')
  const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}T${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
  const rand = Math.random().toString(36).slice(2, 6)
  return `${stamp}-${rand}`
}

/* ------------------------------------------------------------------ */
/* 列出备份                                                            */
/* ------------------------------------------------------------------ */

export async function listCloudBackups(): Promise<CloudBackupRow[]> {
  await currentUserId()
  const { data, error } = await cloud.database
    .from(BACKUP_TABLE)
    .select('*')
    .order('created_at', { ascending: false })
    .limit(50)
  if (error) throw new Error(dbErrorText(error))
  return (data ?? []) as unknown as CloudBackupRow[]
}

/* ------------------------------------------------------------------ */
/* 备份到云端                                                          */
/* ------------------------------------------------------------------ */

export interface CreateBackupResult {
  row?: CloudBackupRow
  uploadedPhotos: number
  reusedPhotos: number
}

export async function createCloudBackup(opts: { label?: string; onProgress?: Progress } = {}): Promise<CreateBackupResult> {
  const uid = await currentUserId()
  const report = opts.onProgress

  report?.({ stage: 'collect', done: 0, total: 1 })
  const { data, photoBlobs, manifest } = await collectBackupData()
  report?.({ stage: 'collect', done: 1, total: 1 })

  // 云端已有的照片文件（按 id 去重，避免重复上传历史照片）
  const existing = await listRemotePhotoFiles(uid)
  const fullPhotos = data.photos.filter((p) => photoBlobs.has(p.id))

  let uploaded = 0
  let reused = 0
  let photoBytes = 0
  const total = fullPhotos.length

  await mapLimit(fullPhotos, 4, async (meta, i) => {
    const bin = photoBlobs.get(meta.id)!
    const full = photoPath(uid, meta.id, meta.mime)
    const thumb = photoPath(uid, meta.id, meta.mime, true)
    const leafFull = `${meta.id}.${extOf(meta.mime)}`
    const leafThumb = `thumb_${meta.id}.${extOf(meta.mime)}`

    if (existing.has(leafFull) && existing.has(leafThumb)) {
      reused++
    } else {
      const up = await cloud.storage.upload(full, bin.blob, { contentType: meta.mime || 'image/jpeg', upsert: true })
      if (up.error) throw new Error(up.error.message || '照片上传失败')
      const upThumb = await cloud.storage.upload(thumb, bin.thumb, { contentType: meta.mime || 'image/jpeg', upsert: true })
      if (upThumb.error) throw new Error(upThumb.error.message || '缩略图上传失败')
      uploaded++
    }
    photoBytes += bin.blob.size + bin.thumb.size
    report?.({ stage: 'photos', done: i + 1, total })
  })

  const backupKey = makeBackupKey()
  const payload: CloudPayload = { manifest, data }
  const payloadText = JSON.stringify(payload)
  // 用真实字节数，不要用 String.length ——
  // 后者数的是 UTF-16 码元，中文内容会系统性地少报约 1/3
  const payloadBytes = new Blob([payloadText]).size
  report?.({ stage: 'upload', done: 0, total: 1 })
  const upPayload = await cloud.storage.upload(payloadPath(uid, backupKey), new Blob([payloadText], { type: 'application/json' }), {
    contentType: 'application/json',
    upsert: true,
  })
  if (upPayload.error) throw new Error(upPayload.error.message || '备份数据上传失败')
  report?.({ stage: 'upload', done: 1, total: 1 })

  const records =
    (manifest.counts.entries ?? 0) +
    (manifest.counts.preferences ?? 0) +
    (manifest.counts.dailyStatus ?? 0) +
    (manifest.counts.health ?? 0) +
    (manifest.counts.gifts ?? 0) +
    (manifest.counts.wishes ?? 0) +
    (manifest.counts.insights ?? 0)

  report?.({ stage: 'record', done: 0, total: 1 })
  const inserted = await cloud.database
    .from(BACKUP_TABLE)
    .insert({
      backup_key: backupKey,
      label: opts.label?.trim() || null,
      record_count: records,
      photo_count: data.photos.length,
      photo_ids: data.photos.map((p) => p.id),
      size_bytes: photoBytes + payloadBytes,
      app_version: BACKUP_VERSION,
      device: deviceLabel(),
    })
    .select()
  if (inserted.error) throw new Error(dbErrorText(inserted.error))
  report?.({ stage: 'record', done: 1, total: 1 })
  report?.({ stage: 'done', done: 1, total: 1 })

  const row = (inserted.data?.[0] ?? undefined) as unknown as CloudBackupRow | undefined
  return { row, uploadedPhotos: uploaded, reusedPhotos: reused }
}

async function listRemotePhotoFiles(uid: string): Promise<Set<string>> {
  const names = new Set<string>()
  const prefix = photosPrefix(uid)
  let cursor: string | undefined
  for (let page = 0; page < 20; page++) {
    const res = await cloud.storage.listPage({ prefix, limit: 100, cursor })
    if (res.error) return names // 列不出来就当作「一张都没有」，靠 upsert 兜底，不阻断备份
    for (const obj of res.data.objects ?? []) {
      const leaf = (obj.name || '').split('/').filter(Boolean).pop()
      if (leaf) names.add(leaf)
    }
    if (!res.data.hasNext || !res.data.nextCursor) break
    cursor = res.data.nextCursor
  }
  return names
}

/* ------------------------------------------------------------------ */
/* 从云端恢复                                                          */
/* ------------------------------------------------------------------ */

export async function restoreCloudBackup(
  row: CloudBackupRow,
  mode: ImportMode = 'merge',
  onProgress?: Progress,
): Promise<ImportResult> {
  const uid = await currentUserId()
  const report = onProgress

  report?.({ stage: 'download', done: 0, total: 1 })
  const payloadRes = await cloud.storage.download(payloadPath(uid, row.backup_key))
  if (payloadRes.error) throw new Error(payloadRes.error.message || '云端备份数据下载失败')
  const payload = JSON.parse(await payloadRes.data.text()) as CloudPayload
  report?.({ stage: 'download', done: 1, total: 1 })

  const data = payload.data
  if (!data) throw new Error('云端备份内容不完整，无法恢复')

  const invalid = validateManifest(payload.manifest)
  const warnings: string[] = []
  if (invalid) throw new Error(invalid)
  if ((payload.manifest.version ?? 1) > BACKUP_VERSION) {
    warnings.push(`云端备份版本 v${payload.manifest.version} 高于当前应用支持的 v${BACKUP_VERSION}，部分字段可能被忽略。`)
  }

  const metas = data.photos ?? []
  const photoBlobs: PhotoBinaryMap = new Map()
  let missing = 0

  await mapLimit(metas, 4, async (meta, i) => {
    const full = await cloud.storage.download(photoPath(uid, meta.id, meta.mime))
    const thumbRes = await cloud.storage.download(photoPath(uid, meta.id, meta.mime, true))
    if (full.error) {
      missing++
    } else {
      const blob = full.data
      const thumb = thumbRes.error ? blob : thumbRes.data
      photoBlobs.set(meta.id, { blob, thumb })
    }
    report?.({ stage: 'download', done: i + 1, total: metas.length })
  })

  if (missing > 0) warnings.push(`有 ${missing} 张照片在云端缺失，已跳过。`)

  report?.({ stage: 'restore', done: 0, total: 1 })
  const result = await applyBackupData(data, photoBlobs, mode)
  report?.({ stage: 'restore', done: 1, total: 1 })
  report?.({ stage: 'done', done: 1, total: 1 })

  return { ...result, manifest: payload.manifest, warnings: [...warnings, ...result.warnings] }
}

/* ------------------------------------------------------------------ */
/* 删除云端备份                                                        */
/* ------------------------------------------------------------------ */

export async function deleteCloudBackup(row: CloudBackupRow): Promise<{ removedPhotos: number }> {
  const uid = await currentUserId()

  const removed = await cloud.storage.remove([payloadPath(uid, row.backup_key)])
  if (removed.error) throw new Error(removed.error.message || '备份文件删除失败')

  const del = await cloud.database.from(BACKUP_TABLE).delete().eq('id', row.id).select()
  if (del.error) throw new Error(dbErrorText(del.error))
  if (Array.isArray(del.data) && del.data.length === 0) {
    throw new Error('没有删除任何记录（可能不是你的备份或已被删除）')
  }

  // 清理不再被任何备份引用的照片，避免对象存储无限增长
  let removedPhotos = 0
  try {
    const rest = await listCloudBackups()
    const stillUsed = new Set<string>()
    for (const r of rest) for (const id of r.photo_ids ?? []) stillUsed.add(id)
    const orphans = (row.photo_ids ?? []).filter((id) => !stillUsed.has(id))
    if (orphans.length > 0) {
      const metaById = new Map((row.photo_ids ?? []).map((id) => [id, id]))
      void metaById
      const keys = orphans.flatMap((id) => {
        const suffixes = ['jpg', 'png', 'webp', 'gif', 'heic']
        return suffixes.flatMap((ext) => [
          cloud.storage.userPath(uid, `${CLOUD_ROOT}/photos/${id}.${ext}`),
          cloud.storage.userPath(uid, `${CLOUD_ROOT}/photos/thumb_${id}.${ext}`),
        ])
      })
      const rm = await cloud.storage.remove(keys)
      if (!rm.error) removedPhotos = orphans.length
    }
  } catch {
    // 清理失败不影响删除结果，照片留待下次清理
  }

  return { removedPhotos }
}
