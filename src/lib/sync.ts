/**
 * 多端同步（D-009）：云端为权威源，本机 IndexedDB 作为工作副本。
 *
 * 设计取舍：
 * - 单表行存储 `heartlog_sync_rows`：(owner_id, entity, row_id) 主键，payload 存整行 JSON。
 *   这样新增字段不会因为云端表结构没跟上而丢数据，也不需要为每个实体建一张表。
 * - 照片的二进制不能进 JSON，走对象存储；行里只存元数据与云端路径。
 * - 删除靠本地墓碑（`tombstones` 表）上行成 `deleted: true` 的行，见 lib/tombstones.ts。
 * - 冲突按 `updated_at` 较新者胜；被本机较新版本挡住的条目计入 `keptLocal`。
 * - 单张照片失败不中断整次同步，错误收集到 `photoErrors` 让用户看得见。
 * - 身份由云端会话决定，请求里绝不手传 owner_id。
 */
import type { Table } from 'dexie'
import { db, getMetaValue, nowISO, setMeta } from '../db/db'
import { cloud, getCloudSession } from './cloud'
import { flush as flushTombstones, withDeletionsSuppressed } from './tombstones'
import type { ConflictCopy } from './conflicts'

export const SYNC_TABLE = 'heartlog_sync_rows'
export const SYNC_CURSOR_KEY = 'cloudSyncCursor'
export const SYNC_TIME_KEY = 'cloudSyncLastAt'

/** 参与同步的实体（photos 的二进制单独走对象存储） */
export const SYNC_ENTITIES = [
  'persons',
  'preferences',
  'entries',
  'dailyStatus',
  'health',
  'gifts',
  'wishes',
  'photos',
  'insights',
  'summaries',
] as const

export type SyncEntity = (typeof SYNC_ENTITIES)[number]

interface SyncRow {
  entity: string
  row_id: string
  person_id: string | null
  updated_at: string
  deleted: boolean
  payload: Record<string, unknown>
}

export interface SyncProgress {
  phase: 'pull' | 'push' | 'photos-down' | 'photos-up' | 'deletes'
  done: number
  total: number
}

export interface SyncResult {
  /** 推送到云端的业务行数（不含删除墓碑与照片） */
  pushed: number
  /** 从云端更新到本机的业务行数 */
  pulled: number
  /** 云端有更新，但本机版本更晚而没有覆盖的条数 */
  keptLocal: number
  /** 云端删除同步到本机（本机因此删掉的条数） */
  deleted: number
  /** 本机删除推送到云端的条数 */
  tombstoned: number
  photosUploaded: number
  photosDownloaded: number
  /** 单张照片失败的原因（不中断整次同步） */
  photoErrors: string[]
  /** 因「云端更新、本机较旧」而被挡下未上传的条数（防覆盖） */
  heldBack?: number
  /** 本次同步中，本机版本被云端版本覆盖前留存了副本的条数（真冲突） */
  conflicts?: number
  lastSyncedAt: string
}

export interface SyncOptions {
  onProgress?: (p: SyncProgress) => void
}

function tableOf(entity: string): Table<Record<string, unknown>, string> | null {
  const map: Record<string, unknown> = {
    persons: db.persons,
    preferences: db.preferences,
    entries: db.entries,
    dailyStatus: db.dailyStatus,
    health: db.health,
    gifts: db.gifts,
    wishes: db.wishes,
    photos: db.photos,
    insights: db.insights,
    summaries: db.summaries,
  }
  return (map[entity] as Table<Record<string, unknown>, string>) ?? null
}

function stripUndefined<T extends Record<string, unknown>>(row: T): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(row)) {
    if (v !== undefined) out[k] = v
  }
  return out
}

/** 取一行的时间戳；没有 updatedAt 时退回 createdAt */
function rowTime(row: Record<string, unknown> | undefined): number {
  if (!row) return 0
  const raw = (row.updatedAt ?? row.createdAt ?? '') as string
  const t = Date.parse(raw)
  return Number.isFinite(t) ? t : 0
}

export class SyncError extends Error {}

/* ------------------------------------------------------------------ */
/* 测试接缝：只给 verify/selftest.html 的离线自测用                      */
/* 生产代码永远不调用；不设置时一律走真实 cloud 与真实会话。             */
/* ------------------------------------------------------------------ */

type SyncCloudLike = {
  database: typeof cloud.database
  storage: typeof cloud.storage
}

let activeCloud: SyncCloudLike = cloud
let sessionOverride: { user: { id: string } } | null | undefined

/** 仅测试用：替换云客户端（database + storage） */
export function __setSyncCloudForTest(next: SyncCloudLike | null): void {
  activeCloud = next ?? cloud
}

/** 仅测试用：替换会话解析（null 表示未登录） */
export function __setSyncSessionForTest(next: { user: { id: string } } | null | undefined): void {
  sessionOverride = next
}

/** PostgREST 错误只有 message/details，和 CloudError 的 kind 体系不同，单独处理 */
function dbErrorText(err: { message?: string } | null, fallback: string): string {
  return err?.message ? `${fallback}：${err.message}` : fallback
}

/* ------------------------------------------------------------------ */
/* 照片：对象存储                                                       */
/* ------------------------------------------------------------------ */

/** 从 mime 推扩展名；仅影响对象键，不影响解码 */
export function extOfMime(mime: string | undefined): string {
  const m = (mime || '').toLowerCase()
  if (m.includes('png')) return 'png'
  if (m.includes('webp')) return 'webp'
  if (m.includes('gif')) return 'gif'
  if (m.includes('heic') || m.includes('heif')) return 'heic'
  if (m.includes('bmp')) return 'bmp'
  return 'jpg'
}

/** 照片在对象存储里的路径（userPath 已按 uid 前缀隔离，不接受外部传入的绝对路径） */
export function photoObjectPath(uid: string, photoId: string, kind: 'full' | 'thumb', mime?: string): string {
  const suffix = kind === 'thumb' ? '-thumb' : ''
  const ext = kind === 'thumb' ? 'jpg' : extOfMime(mime)
  return activeCloud.storage.userPath(uid, `photos/${photoId}${suffix}.${ext}`)
}

/**
 * 幂等写入对象存储。
 *
 * 为什么不直接 upload：云端对象已存在时 upload 会返回 `STORAGE_KEY_ALREADY_EXISTS`，
 * 而 SDK 的 `upsert: true` 在服务端并不一定生效（实测仍报该错）。照片此前上传过、
 * 但本机 photo 行丢了 cloudFull 时（重新导入公开快照、换设备、清过库）就会整批失败，
 * 界面表现为「上传 0 张 / N 张照片传输失败」，而记录本身已同步成功。
 *
 * 处理顺序：先问存在性 → 存在走 update，不存在走 upload → upload 撞车再降级 update。
 */
async function putObject(path: string, body: Blob, contentType: string): Promise<void> {
  const existed = await activeCloud.storage.exists(path)
  if (!existed.error && existed.data) {
    const res = await activeCloud.storage.update(path, body, { contentType, upsert: true })
    if (res.error) throw new Error(res.error.message)
    return
  }

  const res = await activeCloud.storage.upload(path, body, { contentType })
  if (!res.error) return

  const alreadyExists =
    /already\s*exists/i.test(res.error.message || '') || /ALREADY_EXISTS/i.test(String(res.error.code ?? ''))
  if (alreadyExists) {
    const retry = await activeCloud.storage.update(path, body, { contentType, upsert: true })
    if (!retry.error) return
    throw new Error(retry.error.message)
  }
  throw new Error(res.error.message)
}

/** 上传一张照片的两份二进制，返回更新后的行（失败抛错，由调用方收集） */
async function uploadOnePhoto(row: Record<string, unknown>, uid: string): Promise<Record<string, unknown>> {
  const next = { ...row }
  const id = String(row.id)
  const full = row.blob as Blob | undefined
  const thumb = row.thumb as Blob | undefined
  const mime = (row.mime as string) || full?.type || 'image/jpeg'

  if (!next.cloudFull && full) {
    const path = photoObjectPath(uid, id, 'full', mime)
    try {
      await putObject(path, full, mime)
    } catch (err) {
      throw new Error(`原图上传失败：${(err as Error).message}`)
    }
    next.cloudFull = path
  }
  if (!next.cloudThumb && thumb) {
    const path = photoObjectPath(uid, id, 'thumb', 'image/jpeg')
    try {
      await putObject(path, thumb, 'image/jpeg')
    } catch (err) {
      throw new Error(`缩略图上传失败：${(err as Error).message}`)
    }
    next.cloudThumb = path
  }
  return next
}

/** 下载一张照片的两份二进制；路径来自云端行，缺失时按规则推导 */
async function downloadOnePhoto(
  rowId: string,
  payload: Record<string, unknown>,
  fallbackUid: string,
): Promise<{ blob: Blob; thumb: Blob }> {
  const mime = (payload.mime as string) || 'image/jpeg'
  const fullPath =
    (payload.cloudFull as string) || photoObjectPath(fallbackUid, rowId, 'full', mime)
  const thumbPath = (payload.cloudThumb as string) || photoObjectPath(fallbackUid, rowId, 'thumb')

  const fullRes = await activeCloud.storage.download(fullPath)
  if (fullRes.error || !fullRes.data) throw new Error(`原图下载失败：${fullRes.error?.message ?? '空内容'}`)
  const thumbRes = await activeCloud.storage.download(thumbPath)
  const thumb = thumbRes.error || !thumbRes.data ? fullRes.data : thumbRes.data
  return { blob: fullRes.data, thumb }
}

/* ------------------------------------------------------------------ */
/* 上行                                                                 */
/* ------------------------------------------------------------------ */

function toPayload(entity: string, row: Record<string, unknown>): Record<string, unknown> {
  if (entity !== 'photos') return stripUndefined(row)
  // 二进制不进 JSON，只留元数据 + 云端路径
  const { blob, thumb, ...rest } = row
  void blob
  void thumb
  return stripUndefined(rest)
}

function toSyncRow(entity: string, row: Record<string, unknown>, at: number): SyncRow {
  return {
    entity,
    row_id: String(row.id),
    person_id: typeof row.personId === 'string' ? row.personId : entity === 'persons' ? String(row.id) : null,
    updated_at: new Date(at || Date.now()).toISOString(),
    deleted: false,
    payload: toPayload(entity, row),
  }
}

async function upsertRows(rows: SyncRow[]): Promise<void> {
  const CHUNK = 60
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK)
    const { error } = await activeCloud.database
      .from(SYNC_TABLE)
      .upsert(chunk, { onConflict: 'owner_id,entity,row_id' })
    if (error) throw new SyncError(dbErrorText(error, '上传本机改动失败'))
  }
}

/**
 * 云端每一行的更新时间（`entity:rowId` → ms）。
 *
 * 上行本来是「全量 upsert」：只要下拉漏掉某一行（游标跳空、单次超过 1000 条、
 * 某张照片报错），本机的旧版本就会把云端的新版本静默覆盖掉 —— 这是不可逆的数据丢失，
 * 也是「手机改的档案没传上来」的真正原因。上行前用它挡掉「本机不比云端新」的行。
 *
 * 查询失败时返回空表（不拦），宁可多推也不要让同步直接不可用；真正的兜底是下拉。
 */
async function fetchRemoteTimes(): Promise<Map<string, number>> {
  const map = new Map<string, number>()
  const PAGE = 1000
  for (let offset = 0; offset < 20000; offset += PAGE) {
    const { data, error } = await activeCloud.database
      .from(SYNC_TABLE)
      .select('entity,row_id,updated_at')
      .order('updated_at', { ascending: true })
      .range(offset, offset + PAGE - 1)
    if (error) return map
    const rows = (data ?? []) as { entity: string; row_id: string; updated_at: string }[]
    for (const r of rows) map.set(`${r.entity}:${r.row_id}`, Date.parse(r.updated_at) || 0)
    if (rows.length < PAGE) break
  }
  return map
}

/**
 * 本机 → 云端：先把照片二进制补传到对象存储，再整体 upsert 业务行。
 * 数据量小，全量上推比增量更稳（也顺带修复云端缺行）。
 *
 * `force` 为 false 时不覆盖「云端更新」的行（见 fetchRemoteTimes 的说明）：
 * 这是「双向同步」的语义——同步是合并，不是用本机快照盖掉云端。
 */
async function pushAll(
  opts: SyncOptions,
  uid: string,
  skip?: Set<string>,
  force = false,
): Promise<{
  pushed: number
  photosUploaded: number
  photoErrors: string[]
  heldBack: number
}> {
  const photoErrors: string[] = []
  let photosUploaded = 0

  // 1) 照片二进制
  const photos = (await db.photos.toArray()) as unknown as Record<string, unknown>[]
  const needUpload = photos.filter(
    (p) => (!p.cloudFull || !p.cloudThumb) && !skip?.has(`photos:${String(p.id)}`),
  )
  if (needUpload.length) {
    opts.onProgress?.({ phase: 'photos-up', done: 0, total: needUpload.length })
    let done = 0
    for (const p of needUpload) {
      try {
        const next = await uploadOnePhoto(p, uid)
        await db.photos.put(next as never)
        photosUploaded++
        // 回写内存中的行，后面构造 payload 时带上路径
        Object.assign(p, next)
      } catch (err) {
        photoErrors.push(`照片 ${String(p.id)}：${(err as Error).message}`)
      }
      done++
      opts.onProgress?.({ phase: 'photos-up', done, total: needUpload.length })
    }
  }

  // 2) 业务行：只推「本机不比云端旧」的行（见 fetchRemoteTimes 的说明）
  let pushed = 0
  let heldBack = 0
  const remoteTimes = await fetchRemoteTimes()
  for (const entity of SYNC_ENTITIES) {
    const table = tableOf(entity)
    if (!table) continue
    const rows = (await table.toArray()) as Record<string, unknown>[]
    const candidates = rows
      .filter((r) => typeof r.id === 'string' && r.id)
      .filter((r) => !skip?.has(`${entity}:${String(r.id)}`))
    const payloadRows: SyncRow[] = []
    for (const r of candidates) {
      const remote = remoteTimes.get(`${entity}:${String(r.id)}`)
      if (!force && remote !== undefined && rowTime(r) < remote) {
        heldBack++
        continue
      }
      payloadRows.push(toSyncRow(entity, r, rowTime(r)))
    }
    if (!payloadRows.length) continue
    await upsertRows(payloadRows)
    pushed += payloadRows.length
  }
  return { pushed, photosUploaded, photoErrors, heldBack }
}

/**
 * 云端已有的删除标记（entity:rowId）。
 * 「只上传」时用它挡一下，避免本机残留的旧行把云端已删的内容复活。
 * 查询失败就不拦，宁可多推也不要让功能不可用。
 */
async function fetchDeletedIds(): Promise<Set<string>> {
  const { data, error } = await activeCloud.database
    .from(SYNC_TABLE)
    .select('entity,row_id')
    .eq('deleted', true)
    .limit(2000)
  if (error) return new Set()
  return new Set(((data ?? []) as SyncRow[]).map((r) => `${r.entity}:${r.row_id}`))
}

/** 本机 → 云端：把尚未推送的删除墓碑上行 */
async function pushDeletions(opts: SyncOptions): Promise<number> {
  await flushTombstones()
  const all = await db.tombstones.toArray()
  const todo = all.filter((t) => !t.pushedAt)
  if (!todo.length) return 0

  opts.onProgress?.({ phase: 'deletes', done: 0, total: todo.length })
  const rows: SyncRow[] = todo.map((t) => ({
    entity: t.entity,
    row_id: t.rowId,
    person_id: null,
    updated_at: t.deletedAt,
    deleted: true,
    payload: {},
  }))
  await upsertRows(rows)
  const at = nowISO()
  await db.tombstones.bulkPut(todo.map((t) => ({ ...t, pushedAt: at })))
  opts.onProgress?.({ phase: 'deletes', done: todo.length, total: todo.length })
  return todo.length
}

/* ------------------------------------------------------------------ */
/* 下行                                                                 */
/* ------------------------------------------------------------------ */

/**
 * 两端内容是否真的不同。
 *
 * 只比业务字段，跳过 `updatedAt` / `createdAt` 这类每次写入都会变的时间戳，
 * 否则「本机只是时间旧、内容一样」也会被记成冲突，把冲突表塞满噪音。
 */
function payloadDiffers(local: Record<string, unknown>, remote: Record<string, unknown>): boolean {
  const skip = new Set(['updatedAt', 'createdAt', 'id'])
  const keys = new Set([...Object.keys(local), ...Object.keys(remote)])
  for (const k of keys) {
    if (skip.has(k)) continue
    const a = local[k]
    const b = remote[k]
    // 二进制字段不参与比较（照片冲突按行处理，二进制以云端为准）
    if (a instanceof Blob || b instanceof Blob) continue
    const sa = stableStringify(a)
    const sb = stableStringify(b)
    if (sa !== sb) return true
  }
  return false
}

/** 键序无关的稳定序列化，避免对象键顺序不同被误判为内容不同 */
function stableStringify(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (typeof v !== 'object') return JSON.stringify(v)
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`
  const obj = v as Record<string, unknown>
  const keys = Object.keys(obj).sort()
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`
}

/** 把即将被覆盖的本机版本存进冲突表；只留业务字段，二进制不入库 */
async function saveConflict(
  entity: string,
  rowId: string,
  local: Record<string, unknown>,
  keptAt: number,
): Promise<void> {
  try {
    const discardedAt = String(local.updatedAt ?? local.createdAt ?? '')
    if (!discardedAt) return
    const payload: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(local)) {
      if (k === 'blob' || k === 'thumb') continue
      payload[k] = v
    }
    const record: ConflictCopy = {
      id: `${entity}:${rowId}:${discardedAt}`,
      entity,
      rowId,
      discardedUpdatedAt: discardedAt,
      keptUpdatedAt: new Date(keptAt).toISOString(),
      detectedAt: nowISO(),
      payload,
    }
    await db.conflicts.put(record as never)
  } catch {
    // 冲突副本是"尽力而为"的附加保护，写失败不能影响同步主流程
  }
}

async function applyRemoteDeletion(entity: string, rowId: string, at: number): Promise<boolean> {
  const table = tableOf(entity)
  if (!table) return false
  const local = (await table.get(rowId)) as Record<string, unknown> | undefined
  if (!local) return false
  // 本机在这一端之后又改过 → 以本机为准（较新者胜），下次上行会把它再推回去
  if (rowTime(local) > at) return false
  // 这是「应用远端结果」，不能再记一条本机墓碑
  await withDeletionsSuppressed(() => table.delete(rowId))
  return true
}

async function pullSince(
  cursor: string,
  opts: SyncOptions,
  uid: string,
): Promise<{ pulled: number; keptLocal: number; deleted: number; photosDownloaded: number; photoErrors: string[]; latest: string; conflicts: number }> {
  let pulled = 0
  let keptLocal = 0
  let deleted = 0
  let conflicts = 0
  let photosDownloaded = 0
  const photoErrors: string[] = []
  let latest = cursor

  /**
   * 分页取全，不用「一个足够大的 limit」。
   *
   * limit 2000 / 5000 这类写法是隐性上限：数据一旦超出，多出来的行被静默截断，
   * 没有任何报错，表现就是「某些内容永远不同步」。用 range 按页取到不满一页为止。
   */
  async function fetchPaged(filterDeleted?: boolean): Promise<SyncRow[]> {
    const PAGE = 1000
    const MAX = 200_000 // 防御性上限；真到这个量级应改设计，而不是凭感觉调大数字
    const all: SyncRow[] = []
    for (let offset = 0; offset < MAX; offset += PAGE) {
      let q = activeCloud.database
        .from(SYNC_TABLE)
        .select('entity,row_id,updated_at,deleted,payload')
        .order('updated_at', { ascending: true })
      if (filterDeleted) q = q.eq('deleted', true) as typeof q
      const { data, error } = await q.range(offset, offset + PAGE - 1)
      if (error) throw new SyncError(dbErrorText(error, '读取云端记录失败'))
      const page = (data ?? []) as SyncRow[]
      all.push(...page)
      if (page.length < PAGE) break
    }
    return all
  }

  /**
   * 删除指针必须**不受游标限制**地全量拉取。
   *
   * 为什么：删除是「一次性凭证」，漏一次就永远漏 —— 漏掉之后本机那行还在，
   * 下次上行又会把它推回云端，表现为「电脑删了、手机同步后还看得见」。
   * 而游标一旦被推到墓碑之后（旧版本在空拉时把游标写成本机 now 就会这样），
   * 这条墓碑就再也读不到了。
   */
  const deletionRows = await fetchPaged(true)

  /**
   * 全量比对，不用游标。
   *
   * 曾经的实现用 `gt('updated_at', cursor)` 做增量，但游标是「时间戳」而不是
   * 「已确认读到的位置」：只要有一次拉取把游标推到了某行之后（旧版本空拉时写成
   * 本机 now，或者单次 1000 条截断后只推进到最后一页），那行就**永久不可见**，
   * 而且点多少次同步都补不回来 —— 用户看到的就是「另一台明明传上去了，这边一直没有」，
   * 而且这个洞一旦形成就无法自愈（healFutureCursor 只能识别未来时间，识别不了这种）。
   *
   * 合并规则本身是幂等的（较新者胜），重复拉取不会产生副作用。
   * cursor 入参保留但不参与过滤，仅为兼容调用方签名与进度显示。
   */
  void cursor

  const incremental = await fetchPaged()

  /**
   * 本机已删、云端还没收到删除的行。
   *
   * 这是「删除后点同步又回来了」的第二道防线。
   * 为什么必须有：`runSync` 的顺序是「拉 → 推业务行 → 推删除」，
   * 拉取时墓碑还没上行成云端删除，云端那一行依然存在且 `deleted=false`；
   * 本机已经没有这一行，于是走进 `!local` 分支被**原样写回本机**，
   * 紧接着上行又把它推回云端 —— 删除被自己复活，而且每点一次同步重复一遍。
   *
   * 只看本机墓碑就够，不依赖墓碑是否已推送：没推成功更要拦住，
   * 否则离线期间点一次同步就前功尽弃。
   */
  const localTombs = new Set<string>()
  for (const t of await db.tombstones.toArray()) {
    localTombs.add(`${t.entity}:${t.rowId}`)
  }

  // 删除标记单独全量取过（不受时间过滤），与全量结果合并去重
  const seen = new Set<string>()
  const rows: SyncRow[] = []
  for (const r of deletionRows) {
    const key = `${r.entity}:${r.row_id}`
    if (seen.has(key)) continue
    seen.add(key)
    rows.push(r)
  }
  for (const r of incremental) {
    const key = `${r.entity}:${r.row_id}`
    if (seen.has(key)) continue
    seen.add(key)
    rows.push(r)
  }

  opts.onProgress?.({ phase: 'pull', done: 0, total: rows.length })

  let done = 0
  for (const row of rows) {
    done++
    const remoteTime = Date.parse(row.updated_at)

    if (row.deleted) {
      if (await applyRemoteDeletion(row.entity, row.row_id, remoteTime)) deleted++
      // 删除行不计入游标：它每轮都全量取，用它的时间推进游标没有意义，
      // 反而会把「还没读到的更新」挤到游标之前。
      opts.onProgress?.({ phase: 'pull', done, total: rows.length })
      continue
    }

    /**
     * 本机删掉的、云端还没删的行：跳过，别拉回来。
     * 见上面 localTombs 的说明。计入 keptLocal 让界面能看出「挡住了什么」。
     */
    if (localTombs.has(`${row.entity}:${row.row_id}`)) {
      keptLocal++
      opts.onProgress?.({ phase: 'pull', done, total: rows.length })
      continue
    }

    const table = tableOf(row.entity)
    if (!table) continue
    const local = (await table.get(row.row_id)) as Record<string, unknown> | undefined
    const payload = (row.payload ?? {}) as Record<string, unknown>

    if (row.entity === 'photos') {
      const localHasBinary = Boolean(local?.blob && local?.thumb)
      const isNewer = !local || remoteTime > rowTime(local)
      if (!localHasBinary || isNewer) {
        try {
          const { blob, thumb } = await downloadOnePhoto(row.row_id, payload, uid)
          await db.photos.put({ ...payload, id: row.row_id, blob, thumb } as never)
          photosDownloaded++
          pulled++
        } catch (err) {
          photoErrors.push(`照片 ${row.row_id}：${(err as Error).message}`)
          // 二进制缺失时仍然同步元数据，至少不让记录里的照片引用悬空
          await db.photos.put({ ...payload, id: row.row_id } as never)
          pulled++
        }
      } else {
        keptLocal++
      }
      if (remoteTime > Date.parse(latest || '1970-01-01')) latest = row.updated_at
      opts.onProgress?.({ phase: 'pull', done, total: rows.length })
      continue
    }

    if (!local || remoteTime > rowTime(local)) {
      // 覆盖前先留一份本机版本：这是"较新者胜"唯一会丢东西的地方。
      // local 比云端旧但仍被改过，说明两端都动过，属于真冲突。
      if (local && payloadDiffers(local, payload)) {
        await saveConflict(row.entity, row.row_id, local, remoteTime)
        conflicts++
      }
      await table.put({ ...payload, id: row.row_id })
      pulled++
    } else {
      keptLocal++
    }
    if (remoteTime > Date.parse(latest || '1970-01-01')) latest = row.updated_at
    opts.onProgress?.({ phase: 'pull', done, total: rows.length })
  }

  return { pulled, keptLocal, deleted, photosDownloaded, photoErrors, latest, conflicts }
}

/* ------------------------------------------------------------------ */
/* 对外入口                                                             */
/* ------------------------------------------------------------------ */

async function requireUid(): Promise<string> {
  const session = sessionOverride !== undefined ? sessionOverride : await getCloudSession()
  if (!session) throw new SyncError('请先登录云端账号')
  const uid = session.user?.id
  if (!uid) throw new SyncError('登录信息不完整，请重新登录')
  return uid
}

async function readCursor(): Promise<string> {
  const raw = await getMetaValue<string>(SYNC_CURSOR_KEY, '')
  return typeof raw === 'string' ? raw : ''
}

async function writeCursor(next: string): Promise<void> {
  await setMeta(SYNC_CURSOR_KEY, next)
}

/**
 * 自愈：游标落在未来时清空它。
 *
 * 旧版本在「拉不到新行」时把游标写成本机 now，如果那台设备时钟偏快，
 * 游标就会停在一个未来的时间点，之后云端所有真实写入都小于它 ——
 * 表现为「另一台改了，这台永远 0 条」，而且怎么点同步都不会好。
 * 只要游标比本机当前时间还晚，就认为它失效，退回空游标重新全量比对。
 */
async function healFutureCursor(cursor: string): Promise<string> {
  if (!cursor) return cursor
  const t = Date.parse(cursor)
  if (!Number.isFinite(t)) return ''
  // 留 2 分钟余量，避免正常的时钟抖动被误判
  if (t > Date.now() + 120_000) {
    await writeCursor('')
    return ''
  }
  return cursor
}

/**
 * 执行一次完整同步：先拉（含删除与照片）→ 再推（含照片与删除）。
 * 顺序很重要：先拉后推，避免把本机旧版本覆盖掉云端的新版本。
 */
export async function runSync(opts: SyncOptions = {}): Promise<SyncResult> {
  const uid = await requireUid()
  await flushTombstones()

  const cursor = await healFutureCursor(await readCursor())
  /**
   * 顺序：先推删除 → 再拉取 → 再推业务行。
   *
   * 早先是「拉 → 推 → 推删除」，删除在最后才上行，于是拉取阶段云端那行还在、
   * 本机却没有，被当成「云端新增」写回本机，紧接着又被推回云端 ——
   * 用户看到的就是「删了，点同步又回来了」。
   * 现在删除先上行，拉取时云端已是 deleted 行，直接走 applyRemoteDeletion 分支；
   * `pullSince` 里另有本机墓碑兜底，防墓碑上传失败的那一次。
   */
  const tombstoned = await pushDeletions(opts)
  const pulled = await pullSince(cursor, opts, uid)
  // force=false：云端更新的行不覆盖。同步是「合并」，不是用本机快照盖掉云端。
  const pushed = await pushAll(opts, uid, undefined, false)

  const doneAt = nowISO()
  // 拉不到新行时保持原游标。用本机 now 兜底会让「时钟稍慢的设备」写入的行
  // 永远小于游标、以后再也拉不到，表现为「对方改过了，这边一直是从云端更新 0 条」。
  await writeCursor(pulled.latest || cursor)
  await setMeta(SYNC_TIME_KEY, doneAt)

  return {
    pushed: pushed.pushed,
    pulled: pulled.pulled,
    keptLocal: pulled.keptLocal,
    deleted: pulled.deleted,
    tombstoned,
    photosUploaded: pushed.photosUploaded,
    photosDownloaded: pulled.photosDownloaded,
    photoErrors: [...pulled.photoErrors, ...pushed.photoErrors],
    heldBack: pushed.heldBack,
    conflicts: pulled.conflicts,
    lastSyncedAt: doneAt,
  }
}

/**
 * 只上传本机内容（不拉取）。
 * 第一台有数据的设备用它把记录推到云端，其他设备才有东西可拉。
 *
 * 默认仍然「不覆盖云端更新的行」，与双向同步一致：这个按钮的用途是
 * 「把本机独有/较新的内容送上去」，不是「用本机覆盖云端」。
 * 真要强制覆盖，由调用方显式传 force（界面上是单独的确认项）。
 */
export async function pushLocalToCloud(
  opts: SyncOptions = {},
  force = false,
): Promise<{
  pushed: number
  tombstoned: number
  photosUploaded: number
  photoErrors: string[]
  heldBack: number
  lastSyncedAt: string
}> {
  const uid = await requireUid()
  await flushTombstones()
  const skip = await fetchDeletedIds()
  const pushed = await pushAll(opts, uid, skip, force)
  const tombstoned = await pushDeletions(opts)
  const doneAt = nowISO()
  await setMeta(SYNC_TIME_KEY, doneAt)
  return {
    pushed: pushed.pushed,
    tombstoned,
    photosUploaded: pushed.photosUploaded,
    photoErrors: pushed.photoErrors,
    heldBack: pushed.heldBack,
    lastSyncedAt: doneAt,
  }
}

/** 只从云端拉取（不推送） */
export async function pullFromCloud(opts: SyncOptions = {}): Promise<{
  pulled: number
  keptLocal: number
  deleted: number
  photosDownloaded: number
  photoErrors: string[]
  conflicts: number
  lastSyncedAt: string
}> {
  const uid = await requireUid()
  await flushTombstones()
  const cursor = await healFutureCursor(await readCursor())
  const res = await pullSince(cursor, opts, uid)
  const doneAt = nowISO()
  // 同 runSync：没有新行就别把游标推到本机当前时间
  await writeCursor(res.latest || cursor)
  await setMeta(SYNC_TIME_KEY, doneAt)
  return {
    pulled: res.pulled,
    keptLocal: res.keptLocal,
    deleted: res.deleted,
    photosDownloaded: res.photosDownloaded,
    photoErrors: res.photoErrors,
    conflicts: res.conflicts,
    lastSyncedAt: doneAt,
  }
}

/** 上次同步时间（界面展示用） */
export async function lastSyncedAt(): Promise<string> {
  const v = await getMetaValue<string>(SYNC_TIME_KEY, '')
  return typeof v === 'string' ? v : ''
}

/** 云端是否已登录 */
export async function syncReady(): Promise<boolean> {
  if (sessionOverride !== undefined) return sessionOverride !== null
  return (await getCloudSession()) !== null
}

/** 清空同步游标：换账号或需要重新全量拉取时用 */
export async function resetSyncCursor(): Promise<void> {
  await setMeta(SYNC_CURSOR_KEY, '')
}

/** 待推送的删除数（界面展示用） */
export async function pendingDeletionCount(): Promise<number> {
  await flushTombstones()
  const all = await db.tombstones.toArray()
  return all.filter((t) => !t.pushedAt).length
}
