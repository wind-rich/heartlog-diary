/**
 * T8-C 私有同步：待办 / 提醒计划 / 发生实例。
 *
 * 与主同步（lib/sync.ts）分开的原因（大纲 T8-C 第 1 条）：
 * - 主同步的合并规则是「updatedAt 较新者胜」，对任务是有损的：
 *   两台设备各改一个字段时，晚写的一方会整行盖掉另一方，而任务恰恰是
 *   最容易「手机改日期、电脑改备注」的实体。
 * - 这里改用 **rev 版本比较**：远端 payload 的 rev 更大才覆盖本机；
 *   本机 rev 更大才上行；相等则视为同版本，不动。
 *   旧版本覆盖新版本会被明确拒绝（返回 rejected），而不是静默覆盖。
 *
 * 隐私边界（D-008）：这三类实体只写私有的 `heartlog_sync_rows`（RLS 仅作者），
 * 不进入 `heartlog_public_snapshot` / `heartlog_public_media`，
 * 发布链路（lib/publish.ts）根本不认识它们。
 */
import { db, nowISO } from '../db/db'
import { cloud, getCloudSession } from '../lib/cloud'
import { flush as flushTombstones, withDeletionsSuppressed } from '../lib/tombstones'
import { SYNC_TABLE } from '../lib/sync'
import type { Task, TaskOccurrence, TaskReminder } from './types'

/** 参与私有同步的实体名（与主同步的 SYNC_ENTITIES 不重叠，避免两套合并规则互相踩） */
export const TASK_ENTITIES = ['tasks', 'taskReminders', 'taskOccurrences'] as const
export type TaskEntity = (typeof TASK_ENTITIES)[number]

export interface TaskSyncResult {
  pushed: number
  pulled: number
  /** 因版本更旧而被拒绝覆盖的条数（本机保留，等待用户处理） */
  rejected: number
  deleted: number
  lastSyncedAt: string
  error?: string
}

interface Row {
  entity: string
  row_id: string
  updated_at: string
  deleted: boolean
  payload: Record<string, unknown>
}

/**
 * 上行载荷。**不带 owner_id**：
 * 身份由云端会话决定（与 lib/sync.ts 一致），手传 owner_id 既会被 RLS 校验拦下，
 * 也会在类型上撞到 SDK 的「禁止外部写入 owner_id」约束。
 */
interface UpsertRow {
  entity: string
  row_id: string
  updated_at: string
  deleted: boolean
  payload: Record<string, unknown>
}

/* ------------------------------------------------------------------ */
/* 测试接缝                                                            */
/* ------------------------------------------------------------------ */

type CloudLike = { database: typeof cloud.database }
let activeCloud: CloudLike = cloud
let sessionOverride: { user: { id: string } } | null | undefined

/** 仅测试用：替换云客户端（与 lib/sync.ts 的接缝同形） */
export function __setTaskCloudForTest(next: CloudLike | null): void {
  activeCloud = next ?? cloud
}

/** 仅测试用：替换会话解析（null 表示未登录） */
export function __setTaskSessionForTest(next: { user: { id: string } } | null | undefined): void {
  sessionOverride = next
}

/* ------------------------------------------------------------------ */
/* 表映射                                                              */
/* ------------------------------------------------------------------ */

function tableOf(entity: string) {
  if (entity === 'tasks') return db.tasks as unknown as { toArray: () => Promise<Record<string, unknown>[]>; get: (id: string) => Promise<unknown>; put: (v: unknown) => Promise<unknown>; delete: (id: string) => Promise<void> }
  if (entity === 'taskReminders') return db.taskReminders as unknown as { toArray: () => Promise<Record<string, unknown>[]>; get: (id: string) => Promise<unknown>; put: (v: unknown) => Promise<unknown>; delete: (id: string) => Promise<void> }
  if (entity === 'taskOccurrences') return db.taskOccurrences as unknown as { toArray: () => Promise<Record<string, unknown>[]>; get: (id: string) => Promise<unknown>; put: (v: unknown) => Promise<unknown>; delete: (id: string) => Promise<void> }
  return null
}

/** 行版本：任务/提醒用自己的 rev；实例没有 rev，退化用行时间 */
function rowRev(row: Record<string, unknown> | undefined): number {
  if (!row) return -1
  const rev = row.rev
  if (typeof rev === 'number' && Number.isFinite(rev)) return rev
  const at = Date.parse(String(row.updatedAt ?? row.createdAt ?? ''))
  // 实例没有 rev：用时间戳换算成一个单调可比的「伪版本」
  return Number.isFinite(at) ? at : 0
}

function stripUndefined<T extends Record<string, unknown>>(row: T): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(row)) if (v !== undefined) out[k] = v
  return out
}

async function requireUid(): Promise<string> {
  const session = sessionOverride !== undefined ? sessionOverride : await getCloudSession()
  const uid = session?.user?.id
  if (!uid) throw new Error('请先登录云端账号，待办同步需要作者身份')
  return uid
}

/* ------------------------------------------------------------------ */
/* 全量分页读取（只取三类实体）                                          */
/* ------------------------------------------------------------------ */

/**
 * 分页读全表再在本地过滤。
 *
 * 不用 `.in('entity', …)`：现有同步引擎的查询构造器（含离线自测的模拟实现）
 * 只保证 eq / gt / order / range / limit 可用，用未保证的算子会让
 * 「自测通过、真机 0 条」这类问题重新出现。行数在万级以内，全表分页代价可接受。
 */
async function fetchTaskRows(): Promise<Row[]> {
  const PAGE = 1000
  const MAX = 200_000
  const wanted = new Set<string>(TASK_ENTITIES)
  const out: Row[] = []
  for (let offset = 0; offset < MAX; offset += PAGE) {
    const { data, error } = await activeCloud.database
      .from(SYNC_TABLE)
      .select('entity,row_id,updated_at,deleted,payload')
      .order('updated_at', { ascending: true })
      .range(offset, offset + PAGE - 1)
    if (error) throw new Error(`读取云端待办失败：${error.message}`)
    const page = (data ?? []) as Row[]
    for (const r of page) if (wanted.has(r.entity)) out.push(r)
    if (page.length < PAGE) break
  }
  return out
}

/* ------------------------------------------------------------------ */
/* 删除向上：墓碑上行                                                   */
/* ------------------------------------------------------------------ */

/**
 * 把本机待办删除推送成云端的 `deleted: true` 行。
 *
 * **这是曾经缺失的一步，也是「删除后再同步又回来了」的根因。**
 * 现象复现链路：
 *   1. 删除任务 → 本机 tasks 行删掉，tombstones 记一条（还没上传）；
 *   2. 点同步 → 先拉取，云端那一行还在且不是 deleted，本机却没有 →
 *      走进 `!local` 分支，把它**重新写回本机**；
 *   3. 再上行 → 本机又有这行了 → 推回云端。
 * 结果是删除被自己拉回来，而且每点一次同步都重复一遍。
 *
 * 只补 `flushTombstones()` 不够：那个只是把内存队列落到本地表，
 * 从来没有上行。必须显式把这些墓碑写成云端删除行。
 */
async function pushDeletions(): Promise<number> {
  const all = await db.tombstones.toArray()
  const wanted = new Set<string>(TASK_ENTITIES)
  const todo = all.filter((t) => !t.pushedAt && wanted.has(t.entity))
  if (!todo.length) return 0

  const rows: UpsertRow[] = todo.map((t) => ({
    entity: t.entity,
    row_id: t.rowId,
    updated_at: t.deletedAt,
    deleted: true,
    payload: {},
  }))
  const CHUNK = 60
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { error } = await activeCloud.database
      .from(SYNC_TABLE)
      .upsert(rows.slice(i, i + CHUNK), { onConflict: 'owner_id,entity,row_id' })
    if (error) throw new Error(`上传删除失败：${error.message}`)
  }
  const at = nowISO()
  await db.tombstones.bulkPut(todo.map((t) => ({ ...t, pushedAt: at })))
  return todo.length
}

/**
 * 本机已删、但还没推上去的行（`entity:rowId` → 删除时间 ms）。
 *
 * 拉取时用它挡住「自己刚删掉的云端旧行」。
 * 即使 `pushDeletions` 因为网络失败没成功，这一步也能保证
 * 本次同步不会把删除内容重新拉回本机。
 */
async function localDeletions(): Promise<Map<string, number>> {
  const all = await db.tombstones.toArray()
  const wanted = new Set<string>(TASK_ENTITIES)
  const map = new Map<string, number>()
  for (const t of all) {
    if (!wanted.has(t.entity)) continue
    map.set(`${t.entity}:${t.rowId}`, Date.parse(t.deletedAt) || Date.now())
  }
  return map
}

/* ------------------------------------------------------------------ */
/* 下行                                                                */
/* ------------------------------------------------------------------ */

async function pull(uid: string): Promise<{ pulled: number; rejected: number; deleted: number }> {
  const rows = await fetchTaskRows()
  const tombstones = await localDeletions()
  let pulled = 0
  let rejected = 0
  let deleted = 0

  for (const row of rows) {
    const table = tableOf(row.entity)
    if (!table) continue
    const local = (await table.get(row.row_id)) as Record<string, unknown> | undefined
    const key = `${row.entity}:${row.row_id}`

    if (row.deleted) {
      // 远端删除是最终行为：本机还留着就删。用抑制器避免记成一条新墓碑再推回去。
      if (local) {
        await withDeletionsSuppressed(() => table.delete(row.row_id))
        deleted++
      }
      continue
    }

    /**
     * 本机已删、云端还没收到删除 → 不要拉回来。
     *
     * 这是「删除后同步又回来」的第二道防线：即使墓碑上行失败
     * （离线、网关拒绝），只要本机墓碑还在，拉取就不会复活它，
     * 下次同步会继续尝试上传。
     */
    if (tombstones.has(key)) {
      rejected++
      continue
    }

    const payload = stripUndefined((row.payload ?? {}) as Record<string, unknown>)
    const remoteRev = rowRev(payload)
    const localRev = rowRev(local)

    if (!local) {
      await table.put({ ...payload, id: row.row_id })
      pulled++
      continue
    }
    if (remoteRev > localRev) {
      await table.put({ ...payload, id: row.row_id })
      pulled++
    } else if (remoteRev < localRev) {
      // 本机更新：不动，留给上行。计为「被拒绝的远端旧版本」，界面可展示而不是静默忽略。
      rejected++
    }
  }
  void uid
  return { pulled, rejected, deleted }
}

/* ------------------------------------------------------------------ */
/* 上行                                                                */
/* ------------------------------------------------------------------ */

async function push(uid: string): Promise<{ pushed: number; skipped: number }> {
  const rows = await fetchTaskRows()
  const remote = new Map<string, Row>()
  for (const r of rows) remote.set(`${r.entity}:${r.row_id}`, r)

  const out: UpsertRow[] = []
  let skipped = 0

  for (const entity of TASK_ENTITIES) {
    const table = tableOf(entity)
    if (!table) continue
    const local = await table.toArray()
    for (const row of local) {
      const id = String(row.id ?? '')
      if (!id) continue
      const key = `${entity}:${id}`
      const r = remote.get(key)
      if (r?.deleted) {
        // 云端已删：本机残行不再复活
        skipped++
        continue
      }
      const remoteRev = r ? rowRev(stripUndefined((r.payload ?? {}) as Record<string, unknown>)) : -1
      const localRev = rowRev(row)
      if (r && remoteRev > localRev) {
        // 云端更新，本机旧：不覆盖（与主同步方向一致），等下行更新本机
        skipped++
        continue
      }
      out.push({
        entity,
        row_id: id,
        updated_at: new Date(Date.parse(String(row.updatedAt ?? nowISO())) || Date.now()).toISOString(),
        deleted: false,
        payload: stripUndefined(row),
      })
    }
  }

  const CHUNK = 60
  for (let i = 0; i < out.length; i += CHUNK) {
    const { error } = await activeCloud.database
      .from(SYNC_TABLE)
      .upsert(out.slice(i, i + CHUNK), { onConflict: 'owner_id,entity,row_id' })
    if (error) throw new Error(`上传待办失败：${error.message}`)
  }
  void uid
  return { pushed: out.length, skipped }
}

/** 只推本机待办（登出前保住本机改动、或首次把本机任务送到云端） */
export async function pushTasksToCloud(): Promise<TaskSyncResult> {
  const now = nowISO()
  try {
    const uid = await requireUid()
    await flushTombstones()
    // 顺序：先推删除，再推业务行。反过来的话，一条「本机已删但云端还在」的行
    // 可能刚被 push() 跳过、删除又还没生效，中间态没有意义。
    const deleted = await pushDeletions()
    const res = await push(uid)
    return { pushed: res.pushed, pulled: 0, rejected: 0, deleted, lastSyncedAt: now }
  } catch (err) {
    return { pushed: 0, pulled: 0, rejected: 0, deleted: 0, lastSyncedAt: now, error: (err as Error).message }
  }
}

/** 只拉云端待办 */
export async function pullTasksFromCloud(): Promise<TaskSyncResult> {
  const now = nowISO()
  try {
    const uid = await requireUid()
    await flushTombstones()
    // 先上行删除再拉取：否则刚删的东西会在本次拉取里被「云端还有」复活一次
    const deleted = await pushDeletions()
    const res = await pull(uid)
    return { pushed: 0, pulled: res.pulled, rejected: res.rejected, deleted: deleted + res.deleted, lastSyncedAt: now }
  } catch (err) {
    return { pushed: 0, pulled: 0, rejected: 0, deleted: 0, lastSyncedAt: now, error: (err as Error).message }
  }
}

/**
 * 双向：先拉后推。
 *
 * 注意删除的顺序是「拉 → 推删除 → 推业务行」：
 * - 拉取阶段靠 `localDeletions()` 挡住本机刚删的行（第一道防线，不依赖网络）；
 * - 然后把墓碑上行成云端删除（第二道，让另一台设备也能删掉）；
 * - 最后推业务行（此时已删的行本机已不存在，不会被推回去）。
 *
 * 早先版本漏了「推删除」这一步，导致删除只活在本机，一次同步就被云端旧行复活。
 */
export async function syncTasks(): Promise<TaskSyncResult> {
  const now = nowISO()
  try {
    const uid = await requireUid()
    await flushTombstones()
    const pulled = await pull(uid)
    const deleted = await pushDeletions()
    const pushed = await push(uid)
    return {
      pushed: pushed.pushed,
      pulled: pulled.pulled,
      rejected: pulled.rejected,
      deleted: pulled.deleted + deleted,
      lastSyncedAt: now,
    }
  } catch (err) {
    return { pushed: 0, pulled: 0, rejected: 0, deleted: 0, lastSyncedAt: now, error: (err as Error).message }
  }
}

/** 离线队列规模：本地 rev 与最后一次成功同步时的快照差异（用于「待同步」状态展示） */
export async function pendingTaskChanges(lastSyncedRev: Record<string, number>): Promise<number> {
  let dirty = 0
  const check = async (entity: TaskEntity) => {
    const table = tableOf(entity)
    if (!table) return
    const rows = await table.toArray()
    for (const r of rows) {
      const id = String(r.id ?? '')
      const key = `${entity}:${id}`
      if (rowRev(r) !== (lastSyncedRev[key] ?? -1)) dirty++
    }
  }
  for (const e of TASK_ENTITIES) await check(e)
  return dirty
}

export type { Task, TaskReminder, TaskOccurrence }