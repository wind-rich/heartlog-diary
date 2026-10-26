/**
 * 删除同步的本地墓碑（tombstone）。
 *
 * 为什么需要它：同步只合并「新增 / 修改」，一条记录在 A 端被删掉后，
 * 云端如果什么都不留，B 端永远不知道要跟着删，下次还会把它推回来。
 * 所以在删除发生时记一条墓碑，随同步上行成 `deleted: true` 的行。
 *
 * 实现要点：
 * - 由 Dexie 的 `deleting` 钩子统一采集，**不依赖各个调用点**（新增删除逻辑不会漏记）。
 * - 钩子运行在事务里，不能安全地往另一张表写，所以先进内存队列，
 *   事务结束后再落到 `tombstones` 表。
 * - 批量清空（覆盖恢复、清空全部数据）必须用 `withDeletionsSuppressed` 包住：
 *   否则「恢复备份」会被记成一堆删除，同步时把云端数据也一并删掉。
 */
export interface Tombstone {
  /** `${entity}:${rowId}`，天然去重 */
  id: string
  entity: string
  rowId: string
  deletedAt: string
  /** 已推送到云端的时间；为空表示还需要推 */
  pushedAt?: string
}

/** 哪些表参与删除同步（必须与 sync 的实体名一致；meta / tombstones 自身除外） */
export const TOMBSTONE_ENTITIES = [
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
  // T8 待办三张表也参与删除同步：删除发生在 A 端时，B 端要能跟着删，
  // 否则下次上行会把本机残行推回去，表现为「删了又回来」。
  // 它们不进主同步的业务上行（SYNC_ENTITIES 不含），只共用墓碑上行与私有同步读端。
  'tasks',
  'taskReminders',
  'taskOccurrences',
] as const

let suppressed = 0
const pending = new Map<string, Tombstone>()
let flushTimer: ReturnType<typeof setTimeout> | null = null
let sink: ((items: Tombstone[]) => Promise<void>) | null = null

/** 批量操作期间暂停采集。嵌套调用安全（计数器）。 */
export async function withDeletionsSuppressed<T>(fn: () => Promise<T>): Promise<T> {
  suppressed++
  try {
    return await fn()
  } finally {
    suppressed--
  }
}

export function isDeletionSuppressed(): boolean {
  return suppressed > 0
}

/** db 层在创建实例后注册落库函数（避免 db ↔ tombstones 的循环依赖） */
export function setTombstoneSink(fn: (items: Tombstone[]) => Promise<void>): void {
  sink = fn
}

/** 采集一条删除。同步调用，可在 Dexie 钩子里直接调用。 */
export function recordDeletion(entity: string, rowId: string): void {
  if (suppressed > 0) return
  if (!rowId) return
  const id = `${entity}:${rowId}`
  const existing = pending.get(id)
  pending.set(id, {
    id,
    entity,
    rowId,
    // 首次删除的时间就是权威时间；重复删除不要刷新它，否则会一直「比本机新」
    deletedAt: existing?.deletedAt ?? new Date().toISOString(),
  })
  scheduleFlush()
}

function scheduleFlush(): void {
  if (flushTimer) return
  flushTimer = setTimeout(() => {
    flushTimer = null
    void flush()
  }, 0)
}

/** 把内存队列落到 tombstones 表。失败不抛：删除已发生，墓碑丢了最多退回旧行为。 */
export async function flush(): Promise<void> {
  if (!sink || pending.size === 0) return
  const items = [...pending.values()]
  pending.clear()
  try {
    await sink(items)
  } catch (err) {
    console.warn('[heartlog] 墓碑写入失败', err)
  }
}

/** 测试/诊断用：当前还没落库的条目 */
export function peekPending(): Tombstone[] {
  return [...pending.values()]
}

/** 测试用：清空内存队列，避免用例互相污染 */
export function resetPending(): void {
  pending.clear()
  if (flushTimer) {
    clearTimeout(flushTimer)
    flushTimer = null
  }
}
