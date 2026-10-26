import JSZip from 'jszip'
import { db, nowISO, setMeta } from '../db/db'
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
import type { Task, TaskOccurrence, TaskReminder } from '../tasks/types'
import { downloadBlob } from './exporter'
import { withDeletionsSuppressed } from './tombstones'

/**
 * 备份格式版本。
 *
 * v1：业务实体 + meta（无待办）
 * v2：T8 新增 tasks / taskReminders / taskOccurrences。
 *     旧包读入时这三项缺失 → 视为空数组，不覆盖已有新任务（大纲 T8-A 要求）。
 *     新包被旧版本应用读取时只会忽略这三个字段，其它内容照常恢复。
 */
export const BACKUP_VERSION = 2
export const BACKUP_APP_ID = 'heartlog'

/** data.json 中的照片元信息（不含二进制） */
export type PhotoMeta = Omit<Photo, 'blob' | 'thumb'> & { file: string; thumbFile: string }

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
  /** v2 起：T8 待办（均为私有内容，不进公开快照） */
  tasks?: Task[]
  taskReminders?: TaskReminder[]
  taskOccurrences?: TaskOccurrence[]
}

export interface BackupManifest {
  app: string
  version: number
  exportedAt: string
  appName: string
  counts: Record<string, number>
  note?: string
}

export function extOf(mime: string): string {
  if (mime.includes('png')) return 'png'
  if (mime.includes('webp')) return 'webp'
  if (mime.includes('gif')) return 'gif'
  if (mime.includes('heic')) return 'heic'
  return 'jpg'
}

/* ------------------------------------------------------------------ */
/* 读取本地数据并组装成备份结构（ZIP 导出与云端备份共用）                */
/* ------------------------------------------------------------------ */

/** 照片二进制，按 photo id 索引 */
export type PhotoBinaryMap = Map<string, { blob: Blob; thumb: Blob }>

export interface CollectedBackup {
  data: BackupData
  /** 照片二进制单独返回，便于分别打包进 ZIP 或上传到对象存储 */
  photoBlobs: PhotoBinaryMap
  manifest: BackupManifest
}

export async function collectBackupData(): Promise<CollectedBackup> {
  const [
    persons,
    preferences,
    entries,
    dailyStatus,
    health,
    gifts,
    wishes,
    photos,
    insights,
    summaries,
    meta,
    tasks,
    taskReminders,
    taskOccurrences,
  ] = await Promise.all([
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
    db.tasks.toArray(),
    db.taskReminders.toArray(),
    db.taskOccurrences.toArray(),
  ])

  const photoMetas: PhotoMeta[] = []
  const photoBlobs: PhotoBinaryMap = new Map()

  for (const p of photos) {
    const file = `${p.id}.${extOf(p.mime)}`
    const thumbFile = `thumb_${p.id}.${extOf(p.mime)}`
    const { blob, thumb, ...rest } = p
    photoMetas.push({ ...rest, file, thumbFile })
    photoBlobs.set(p.id, { blob, thumb })
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
    tasks,
    taskReminders,
    taskOccurrences,
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
      tasks: tasks.length,
      taskReminders: taskReminders.length,
      taskOccurrences: taskOccurrences.length,
    },
    note: '这是「心意簿」的完整备份，包含全部文字记录与照片原图。请妥善保管。',
  }

  return { data, photoBlobs, manifest }
}

/* ------------------------------------------------------------------ */
/* 导出完整备份（ZIP）                                                  */
/* ------------------------------------------------------------------ */

export async function createBackupZip(): Promise<{ blob: Blob; manifest: BackupManifest }> {
  const { data, photoBlobs, manifest } = await collectBackupData()

  const zip = new JSZip()
  const photoFolder = zip.folder('photos')!
  for (const meta of data.photos) {
    const bin = photoBlobs.get(meta.id)
    if (!bin) continue
    photoFolder.file(meta.file, bin.blob)
    photoFolder.file(meta.thumbFile, bin.thumb)
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
      '照片默认只保存在你自己的设备上。只有在设置里主动开启「备份到云端」时，',
      '内容才会加密传输并保存到你自己的云空间；本应用不会上传任何其他数据。',
    ].join('\r\n'),
  )

  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } })
  return { blob, manifest }
}

/**
 * 本机完整导出的时间戳键。
 *
 * 存在的理由（R-026）：云端备份是**手工按钮**、没有任何定时任务，所以
 * 「上次导出是什么时候」这个事实只能由导出动作自己记下来。没有它，
 * 设置页无法判断「这份数据上次被保存到本机之外」是几天前，用户也就不会
 * 因为「已经很久没导出」而被提醒。
 */
export const LAST_EXPORT_KEY = 'lastFullExportAt'

export async function exportBackup(): Promise<void> {
  const { blob, manifest } = await createBackupZip()
  const stamp = manifest.exportedAt.slice(0, 19).replace(/[:T]/g, '-')
  downloadBlob(blob, `心意簿-完整备份-${stamp}.zip`)
  // 先下载再记录：浏览器阻断下载时不该留下「已备份」的假记录
  await setMeta(LAST_EXPORT_KEY, manifest.exportedAt)
}

/* ------------------------------------------------------------------ */
/* 导入恢复（ZIP 导入与云端恢复共用）                                    */
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

/**
 * 恢复来的发生实例一律视为「已读历史」。
 *
 * 为什么：实例就是通知记录本身。如果原样恢复未读实例，
 * 换设备/恢复备份后通知铃会一次性冒出几十条早已过期的提醒 ——
 * 这就是大纲禁止的「批量重放过期通知」。
 * 保留实例本身（用于「那次提醒过」的追溯），只把未读状态收敛掉。
 */
function restoredOccurrences(list: TaskOccurrence[]): TaskOccurrence[] {
  return list.map((o) => (o.readAt || !o.firedAt ? o : { ...o, readAt: o.firedAt }))
}

/** 校验备份来源，来源不匹配一律中止，避免污染现有数据 */
export function validateManifest(manifest: BackupManifest | undefined): string | null {
  if (!manifest) return '备份缺少 manifest 信息'
  if (manifest.app !== BACKUP_APP_ID) return '备份来源不匹配，已中止导入以保护现有数据。'
  return null
}

/**
 * 把一份备份结构写入本地 IndexedDB。
 *
 * `merge`：同 id 跳过，事件再按「同发生时间 + 同标题 + 同类型」判一次重，绝不覆盖本地改动。
 * `replace`：先清空全部表再写入。
 */
export async function applyBackupData(
  data: BackupData,
  photoBlobs: PhotoBinaryMap,
  mode: ImportMode = 'merge',
): Promise<ImportResult> {
  const result: ImportResult = { imported: {}, skipped: {}, errors: [], warnings: [] }

  const photoRows: Photo[] = []
  for (const meta of data.photos ?? []) {
    const bin = photoBlobs.get(meta.id)
    if (!bin) {
      result.warnings.push(`照片文件缺失：${meta.file}`)
      continue
    }
    const { file: _f, thumbFile: _tf, ...rest } = meta
    void _f
    void _tf
    const mime = meta.mime || 'image/jpeg'
    photoRows.push({
      ...rest,
      blob: bin.blob.slice(0, bin.blob.size, mime),
      thumb: bin.thumb.slice(0, bin.thumb.size, mime),
    })
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
    // v2 起的三张待办表。旧备份里没有这三项时是空数组，等于「不导入」，
    // 因此不会覆盖本机已有任务（大纲：旧备份缺字段时兼容为空，不覆盖新任务）。
    ['tasks', db.tasks, data.tasks ?? []],
    ['taskReminders', db.taskReminders, data.taskReminders ?? []],
    ['taskOccurrences', db.taskOccurrences, restoredOccurrences(data.taskOccurrences ?? [])],
  ] as const

  const runImport = () =>
    db.transaction(
    'rw',
    [
      db.persons,
      db.preferences,
      db.entries,
      db.dailyStatus,
      db.health,
      db.gifts,
      db.wishes,
      db.photos,
      db.insights,
      db.summaries,
      db.meta,
      db.tasks,
      db.taskReminders,
      db.taskOccurrences,
    ],
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

  // 覆盖导入会整表清空：这段时间必须停掉墓碑采集，
  // 否则「恢复备份」会被记成一堆删除，同步时把云端数据一起删掉。
  if (mode === 'replace') await withDeletionsSuppressed(runImport)
  else await runImport()

  return result
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
  const invalid = validateManifest(manifest)
  if (invalid) {
    result.errors.push(invalid)
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

  // 从 zip 中还原照片二进制
  const photoBlobs: PhotoBinaryMap = new Map()
  for (const meta of data.photos ?? []) {
    const fileEntry = zip.file(`photos/${meta.file}`)
    if (!fileEntry) {
      result.warnings.push(`照片文件缺失：${meta.file}`)
      continue
    }
    const blob = await fileEntry.async('blob')
    const thumbEntry = zip.file(`photos/${meta.thumbFile}`)
    const thumb = thumbEntry ? await thumbEntry.async('blob') : blob
    photoBlobs.set(meta.id, { blob, thumb })
  }

  const applied = await applyBackupData(data, photoBlobs, mode)
  return { ...applied, manifest, warnings: [...result.warnings, ...applied.warnings] }
}

/* ------------------------------------------------------------------ */
/* 清空数据                                                            */
/* ------------------------------------------------------------------ */

export async function wipeAllData(): Promise<void> {
  await withDeletionsSuppressed(() =>
    db.transaction(
    'rw',
    [
      db.persons,
      db.preferences,
      db.entries,
      db.dailyStatus,
      db.health,
      db.gifts,
      db.wishes,
      db.photos,
      db.insights,
      db.summaries,
      db.meta,
      db.tasks,
      db.taskReminders,
      db.taskOccurrences,
    ],
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
        // T8：待办也是用户数据，清空全部数据时必须一起清，否则会留下孤儿任务
        db.tasks.clear(),
        db.taskReminders.clear(),
        db.taskOccurrences.clear(),
      ])
    },
    ),
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
