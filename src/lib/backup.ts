import JSZip from 'jszip'
import { db, nowISO } from '../db/db'
import type {
  DailyStatus,
  Entry,
  Gift,
  HealthRecord,
  Person,
  Photo,
  PortraitInsight,
  Preference,
  Summary,
  Wish,
} from '../db/types'
import { downloadBlob } from './exporter'

export const BACKUP_VERSION = 1
export const BACKUP_APP_ID = 'heartlog'

/** data.json 中的照片元信息（不含二进制） */
type PhotoMeta = Omit<Photo, 'blob' | 'thumb'> & { file: string; thumbFile: string }

export interface BackupData {
  persons: Person[]
  preferences: Preference[]
  entries: Entry[]
  dailyStatus: DailyStatus[]
  health: HealthRecord[]
  gifts: Gift[]
  wishes: Wish[]
  photos: PhotoMeta[]
  insights: PortraitInsight[]
  summaries: Summary[]
  meta: { key: string; value: unknown }[]
}

export interface BackupManifest {
  app: string
  version: number
  exportedAt: string
  appName: string
  counts: Record<string, number>
  note?: string
}

function extOf(mime: string): string {
  if (mime.includes('png')) return 'png'
  if (mime.includes('webp')) return 'webp'
  if (mime.includes('gif')) return 'gif'
  if (mime.includes('heic')) return 'heic'
  return 'jpg'
}

/* ------------------------------------------------------------------ */
/* 导出完整备份                                                        */
/* ------------------------------------------------------------------ */

export async function createBackupZip(): Promise<{ blob: Blob; manifest: BackupManifest }> {
  const [persons, preferences, entries, dailyStatus, health, gifts, wishes, photos, insights, summaries, meta] =
    await Promise.all([
      db.persons.toArray(),
      db.preferences.toArray(),
      db.entries.toArray(),
      db.dailyStatus.toArray(),
      db.health.toArray(),
      db.gifts.toArray(),
      db.wishes.toArray(),
      db.photos.toArray(),
      db.insights.toArray(),
      db.summaries.toArray(),
      db.meta.toArray(),
    ])

  const zip = new JSZip()
  const photoMetas: PhotoMeta[] = []
  const photoFolder = zip.folder('photos')!

  for (const p of photos) {
    const file = `${p.id}.${extOf(p.mime)}`
    const thumbFile = `thumb_${p.id}.${extOf(p.mime)}`
    photoFolder.file(file, p.blob)
    photoFolder.file(thumbFile, p.thumb)
    const { blob: _b, thumb: _t, ...rest } = p
    void _b
    void _t
    photoMetas.push({ ...rest, file, thumbFile })
  }

  const data: BackupData = {
    persons,
    preferences,
    entries,
    dailyStatus,
    health,
    gifts,
    wishes,
    photos: photoMetas,
    insights,
    summaries,
    meta,
  }

  const manifest: BackupManifest = {
    app: BACKUP_APP_ID,
    version: BACKUP_VERSION,
    exportedAt: nowISO(),
    appName: '心意簿',
    counts: {
      persons: persons.length,
      preferences: preferences.length,
      entries: entries.length,
      dailyStatus: dailyStatus.length,
      health: health.length,
      gifts: gifts.length,
      wishes: wishes.length,
      photos: photos.length,
      insights: insights.length,
      summaries: summaries.length,
    },
    note: '这是「心意簿」的完整备份，包含全部文字记录与照片原图。请妥善保管。',
  }

  zip.file('manifest.json', JSON.stringify(manifest, null, 2))
  zip.file('data.json', JSON.stringify(data, null, 2))
  zip.file(
    'README.txt',
    [
      '心意簿 · 完整备份',
      '',
      `导出时间：${manifest.exportedAt}`,
      `数据版本：v${BACKUP_VERSION}`,
      '',
      '内容说明：',
      '  manifest.json  备份元信息（版本号、导出时间、记录条数）',
      '  data.json      全部文字记录（照片以文件名引用，不含二进制）',
      '  photos/        照片原图与缩略图',
      '',
      '恢复方法：打开「心意簿」→ 设置 → 完整备份 / 恢复 → 选择这个 zip 文件即可。',
      '照片不会离开你的设备，本应用没有任何上传行为。',
    ].join('\r\n'),
  )

  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } })
  return { blob, manifest }
}

export async function exportBackup(): Promise<void> {
  const { blob, manifest } = await createBackupZip()
  const stamp = manifest.exportedAt.slice(0, 19).replace(/[:T]/g, '-')
  downloadBlob(blob, `心意簿-完整备份-${stamp}.zip`)
}

/* ------------------------------------------------------------------ */
/* 导入恢复                                                            */
/* ------------------------------------------------------------------ */

export interface ImportResult {
  manifest?: BackupManifest
  imported: Record<string, number>
  skipped: Record<string, number>
  errors: string[]
  warnings: string[]
}

export type ImportMode = 'merge' | 'replace'

function signatureOfEntry(e: Entry): string {
  return `${e.personId}|${e.occurredAt}|${e.title}|${e.type}`
}

export async function importBackupZip(file: File, mode: ImportMode = 'merge'): Promise<ImportResult> {
  const result: ImportResult = { imported: {}, skipped: {}, errors: [], warnings: [] }
  let zip: JSZip
  try {
    zip = await JSZip.loadAsync(file)
  } catch (err) {
    result.errors.push(`无法读取 zip 文件：${(err as Error).message}`)
    return result
  }

  const manifestFile = zip.file('manifest.json')
  if (!manifestFile) {
    result.errors.push('这不是「心意簿」的备份文件（缺少 manifest.json）')
    return result
  }
  const manifest = JSON.parse(await manifestFile.async('string')) as BackupManifest
  if (manifest.app !== BACKUP_APP_ID) {
    result.errors.push('备份文件来源不匹配，已中止导入以保护现有数据。')
    return result
  }
  result.manifest = manifest
  if ((manifest.version ?? 1) > BACKUP_VERSION) {
    result.warnings.push(
      `备份版本 v${manifest.version} 高于当前应用支持的 v${BACKUP_VERSION}，可能有部分字段被忽略。`,
    )
  }

  const dataFile = zip.file('data.json')
  if (!dataFile) {
    result.errors.push('备份文件缺少 data.json，无法恢复记录。')
    return result
  }
  const data = JSON.parse(await dataFile.async('string')) as BackupData

  // 还原照片二进制
  const photoRows: Photo[] = []
  for (const meta of data.photos ?? []) {
    const fileEntry = zip.file(`photos/${meta.file}`)
    if (!fileEntry) {
      result.warnings.push(`照片文件缺失：${meta.file}`)
      continue
    }
    const blob = await fileEntry.async('blob')
    const typed = blob.slice(0, blob.size, meta.mime || 'image/jpeg')
    const thumbEntry = zip.file(`photos/${meta.thumbFile}`)
    const thumb = thumbEntry ? (await thumbEntry.async('blob')).slice(0, undefined, meta.mime || 'image/jpeg') : typed
    const { file: _f, thumbFile: _tf, ...rest } = meta
    void _f
    void _tf
    photoRows.push({ ...rest, blob: typed, thumb })
  }

  const tables = [
    ['persons', db.persons, data.persons ?? []],
    ['preferences', db.preferences, data.preferences ?? []],
    ['entries', db.entries, data.entries ?? []],
    ['dailyStatus', db.dailyStatus, data.dailyStatus ?? []],
    ['health', db.health, data.health ?? []],
    ['gifts', db.gifts, data.gifts ?? []],
    ['wishes', db.wishes, data.wishes ?? []],
    ['insights', db.insights, data.insights ?? []],
    ['summaries', db.summaries, data.summaries ?? []],
    ['photos', db.photos, photoRows],
    ['meta', db.meta, data.meta ?? []],
  ] as const

  await db.transaction(
    'rw',
    [db.persons, db.preferences, db.entries, db.dailyStatus, db.health, db.gifts, db.wishes, db.photos, db.insights, db.summaries, db.meta],
    async () => {
      if (mode === 'replace') {
        for (const [name, table] of tables) {
          void name
          await (table as { clear: () => Promise<void> }).clear()
        }
      }

      for (const [name, table] of tables) {
        const rows = data[name as keyof BackupData] as unknown as Record<string, unknown>[] | undefined
        const list = name === 'photos' ? photoRows : (rows ?? [])
        let imported = 0
        let skipped = 0
        for (const row of list as Record<string, unknown>[]) {
          const id = String(row.id ?? row.key ?? '')
          if (!id) {
            skipped++
            continue
          }
          if (mode === 'merge') {
            const existing = await (table as { get: (k: string) => Promise<unknown> }).get(id)
            if (existing) {
              // 同 id 记录已存在，跳过，避免覆盖本地修改
              skipped++
              continue
            }
            // 事件额外做一次「同时间同标题」的重复判定
            if (name === 'entries') {
              const e = row as unknown as Entry
              const sig = signatureOfEntry(e)
              const all = await db.entries.where('personId').equals(e.personId).toArray()
              if (all.some((x) => signatureOfEntry(x) === sig)) {
                skipped++
                continue
              }
            }
          }
          try {
            await (table as { put: (v: unknown) => Promise<unknown> }).put(row)
            imported++
          } catch (err) {
            result.warnings.push(`${name} 中有一条记录导入失败：${(err as Error).message}`)
          }
        }
        result.imported[name] = imported
        result.skipped[name] = skipped
      }
    },
  )

  return result
}

/* ------------------------------------------------------------------ */
/* 清空数据                                                            */
/* ------------------------------------------------------------------ */

export async function wipeAllData(): Promise<void> {
  await db.transaction(
    'rw',
    [db.persons, db.preferences, db.entries, db.dailyStatus, db.health, db.gifts, db.wishes, db.photos, db.insights, db.summaries, db.meta],
    async () => {
      await Promise.all([
        db.persons.clear(),
        db.preferences.clear(),
        db.entries.clear(),
        db.dailyStatus.clear(),
        db.health.clear(),
        db.gifts.clear(),
        db.wishes.clear(),
        db.photos.clear(),
        db.insights.clear(),
        db.summaries.clear(),
        db.meta.clear(),
      ])
    },
  )
}

/** 存储占用估算 */
export async function storageEstimate(): Promise<{ usage: number; quota: number } | undefined> {
  if (navigator.storage?.estimate) {
    const est = await navigator.storage.estimate()
    return { usage: est.usage ?? 0, quota: est.quota ?? 0 }
  }
  return undefined
}
