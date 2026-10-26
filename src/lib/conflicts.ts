/**
 * 同步冲突副本。
 *
 * 背景：多端同步的合并规则是「较新者胜」（D-011 / R-008）。这条规则本身简单可靠，
 * 但有损：同一条记录在两台设备都改过时，较早那次修改会被较新那次覆盖，
 * 而且**没有任何痕迹**——用户事后只会发现「我明明改过，怎么变回去了」。
 *
 * 这里不试图做自动合并（那需要字段级三方合并，收益远小于复杂度）。
 * 只做一件事：**在覆盖发生前，把即将被丢弃的版本存一份**。
 * 冲突仍然会发生、较新者仍然获胜，但被丢弃的那份可以事后查看、手工取回。
 *
 * 存的是业务行本身的快照（payload），不含二进制；照片冲突按行处理，
 * 二进制仍以云端那份为准。
 */
import { db, nowISO } from '../db/db'

export interface ConflictCopy {
  /** `${entity}:${rowId}:${discardedUpdatedAt}`，同一版本重复记录天然去重 */
  id: string
  entity: string
  rowId: string
  /** 被丢弃版本的业务时间 */
  discardedUpdatedAt: string
  /** 获胜版本的业务时间（来自云端） */
  keptUpdatedAt: string
  /** 冲突发生的时刻（本机 now） */
  detectedAt: string
  /** 被丢弃版本的完整业务行 */
  payload: Record<string, unknown>
  /** 用户是否已处理（看过并决定忽略 / 取回过）；为空表示未处理 */
  dismissedAt?: string
  /** 取回时刻：与「只是忽略」区分开，便于说明「这一版已经写回本机」 */
  resolvedAt?: string
}

/** 冲突记录的展示标签，与 sync 的实体名对应 */
const ENTITY_LABEL: Record<string, string> = {
  persons: '人物资料',
  preferences: '偏好',
  entries: '记录',
  dailyStatus: '每日状态',
  health: '健康',
  gifts: '礼物',
  wishes: '心愿',
  photos: '照片',
  insights: '画像',
  summaries: '回顾',
}

export function conflictEntityLabel(entity: string): string {
  return ENTITY_LABEL[entity] || entity
}

/** 冲突副本的摘要：优先取常见可读字段，取不到就退回 id */
export function conflictSummary(c: ConflictCopy): string {
  const p = c.payload || {}
  const pick = (k: string) => (typeof p[k] === 'string' && p[k] ? String(p[k]) : '')
  return pick('name') || pick('title') || pick('content') || pick('goodThing') || c.rowId
}

/* ------------------------------------------------------------------ */
/* 取回 / 忽略 / 清理                                                   */
/* ------------------------------------------------------------------ */

/** 冲突副本落到哪张本机表；照片没有二进制，不能取回 */
const ENTITY_TABLE: Record<string, 'persons' | 'preferences' | 'entries' | 'dailyStatus' | 'health' | 'gifts' | 'wishes' | 'insights' | 'summaries'> = {
  persons: 'persons',
  preferences: 'preferences',
  entries: 'entries',
  dailyStatus: 'dailyStatus',
  health: 'health',
  gifts: 'gifts',
  wishes: 'wishes',
  insights: 'insights',
  summaries: 'summaries',
}

export interface RestoreResult {
  ok: boolean
  message: string
}

/**
 * 把某条冲突副本写回本机库（「取回这一版」）。
 *
 * 关键点：写入时把 `updatedAt` 改成**现在**。
 * 副本里保存的是被覆盖那一刻的旧时间戳，原样写回去会立刻在下一轮同步里
 * 再输给云端那份「较新」的版本 —— 用户点了取回却什么都没发生。
 * 改成本机当前时间，既让这条成为本机最新版本，下一次同步也会把它推上去，
 * 于是「以这一版为准」在多端之间也成立。
 *
 * 照片不提供取回：副本里只有元数据、没有二进制，写回去会得到一条指向
 * 不存在图片的记录。照片冲突以云端那份为准（D-011）。
 */
export async function restoreConflict(c: ConflictCopy): Promise<RestoreResult> {
  const tableName = ENTITY_TABLE[c.entity]
  if (!tableName) {
    return { ok: false, message: c.entity === 'photos' ? '照片冲突不能取回：图片以云端那份为准' : `不支持的实体：${c.entity}` }
  }
  if (!c.payload || typeof c.payload !== 'object') return { ok: false, message: '这条副本没有可用内容' }

  const table = db[tableName] as unknown as {
    get: (id: string) => Promise<Record<string, unknown> | undefined>
    put: (row: Record<string, unknown>) => Promise<unknown>
  }
  const current = await table.get(c.rowId)
  if (!current) {
    return { ok: false, message: '本机已经没有这一条了（可能已被删除），取回会把它重新建出来，请改用「恢复备份」' }
  }

  const restored = { ...c.payload, id: c.rowId, updatedAt: nowISO() }
  await table.put(restored)
  await db.conflicts.update(c.id, { dismissedAt: nowISO(), resolvedAt: nowISO() })
  return { ok: true, message: '已取回这一版，下一次「双向同步」会把它推到其他设备' }
}

/** 忽略一条副本：只是标记已处理，不删内容，免得「我明明看到过」变成争论 */
export async function dismissConflict(id: string): Promise<void> {
  await db.conflicts.update(id, { dismissedAt: nowISO() })
}

/**
 * 清理冲突副本。
 *
 * 规则刻意保守：只删**已处理**（忽略或取回过）且超过 `keepDays` 天的条目，
 * 再把总量收敛到 `keepCount` 条（保留最新的）。
 * 未处理的副本一律不动 —— 那是用户还没看过的、可能唯一存在的旧版本。
 */
export async function cleanupConflicts(opts: { keepDays?: number; keepCount?: number; now?: number } = {}): Promise<number> {
  const keepDays = opts.keepDays ?? 90
  const keepCount = opts.keepCount ?? 200
  const now = opts.now ?? Date.now()
  const all = await db.conflicts.toArray()
  const cutoff = now - keepDays * 86_400_000

  const expired = all.filter((c) => {
    if (!c.dismissedAt) return false
    const t = Date.parse(c.dismissedAt)
    return Number.isFinite(t) && t < cutoff
  })
  const expiredIds = new Set(expired.map((c) => c.id))
  if (expiredIds.size) await db.conflicts.bulkDelete([...expiredIds])

  // 再按总量收敛：先按「检测时间」倒序，超出部分里只删已处理的
  const remain = all
    .filter((c) => !expiredIds.has(c.id))
    .sort((a, b) => (a.detectedAt < b.detectedAt ? 1 : -1))
  const overflow = remain.slice(keepCount).filter((c) => Boolean(c.dismissedAt))
  if (overflow.length) await db.conflicts.bulkDelete(overflow.map((c) => c.id))

  return expiredIds.size + overflow.length
}

/** 已处理 / 未处理条数，供面板显示 */
export function conflictTally(list: ConflictCopy[]): { pending: number; handled: number } {
  let pending = 0
  let handled = 0
  for (const c of list) (c.dismissedAt ? handled++ : pending++)
  return { pending, handled }
}