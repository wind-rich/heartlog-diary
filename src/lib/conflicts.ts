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
  /** 用户是否已处理（看过并决定忽略）；为空表示未处理 */
  dismissedAt?: string
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