/**
 * 完成待办后「转为公开回忆」（D-008 / D-017）。
 *
 * 语义边界，必须严格：
 * 1. **必须由作者显式操作**。默认私有；没有点这个按钮，待办就不进公开快照。
 * 2. 转换不是「把 task 标成公开」，而是**额外生成一条 `entries` 记录**：
 *    公开发布链路只认 `entries`，待办三表根本不在白名单里。
 *    这样公开的是一段回忆文字，不是一条未完成意图的任务状态。
 * 3. **幂等**：同一条待办反复点，只会有一条回忆。用 `entryId` 回写建立关联，
 *    已转过就直接跳回去，不产生第二条。
 * 4. **撤销公开只断开关联，不删回忆**：作者可能已经在那条回忆里补了别的细节，
 *    删掉属于数据丢失。真要去掉，让作者在故事页自己删。
 * 5. 转换后待办本身仍是私有；`madePublic` 只表示「已有一条派生回忆」。
 */
import { db, nowISO, uid } from '../db/db'
import type { Entry } from '../db/types'
import type { Task } from './types'

export interface MakePublicResult {
  /** 新建的回忆 id；已存在时为原 id */
  entryId: string
  /** true 表示这次真的新建了，false 表示之前已经转过 */
  created: boolean
}

/** 由待办生成回忆的正文：保留完成时写的那句话，不改写、不加工 */
function composeContent(task: Task): string {
  const parts: string[] = []
  if (task.completionNote?.trim()) parts.push(task.completionNote.trim())
  if (task.note?.trim()) parts.push(task.note.trim())
  if (!parts.length) {
    parts.push(task.kind === 'remind' ? '这件事我提醒过他了。' : '这件事已经为他办好了。')
  }
  return parts.join('\n\n')
}

/**
 * 把一条已完成的待办转成公开回忆。
 *
 * 只允许 `status === 'done'`：未完成或已取消的事项写进「故事」会让时间线失真。
 */
export async function makeTaskPublic(task: Task): Promise<MakePublicResult> {
  if (task.status !== 'done') {
    throw new Error('只有已完成的事项才能转为回忆')
  }

  // 幂等：已经转过就直接返回，不新建第二条
  if (task.entryId) {
    const exists = await db.entries.get(task.entryId)
    if (exists) return { entryId: task.entryId, created: false }
  }

  // 再兜一层：查有没有指向这条待办的回忆（防 entryId 回写失败造成的重复）
  const all = await db.entries.where('personId').equals(task.personId).toArray()
  const existing = all.find((e) => e.followUp === `task:${task.id}`)
  if (existing) {
    await db.tasks.update(task.id, { entryId: existing.id, madePublic: true, updatedAt: nowISO() })
    return { entryId: existing.id, created: false }
  }

  const at = nowISO()
  // 发生时间取「完成时间」而不是创建时间：回忆对应的是事情办成的那一刻
  const occurredAt = task.completedAt || at
  const entry: Entry = {
    id: uid('e_'),
    personId: task.personId,
    occurredAt,
    type: 'daily',
    title: task.title,
    content: composeContent(task),
    tagList: [],
    photoIds: [],
    // 用固定前缀把「这条回忆来自哪条待办」记下来，供幂等判断与撤销关联。
    // 不放进 tagList，避免污染用户的标签体系。
    followUp: `task:${task.id}`,
    followUpDone: true,
    quick: false,
    createdAt: at,
    updatedAt: at,
  }
  await db.entries.put(entry)
  await db.tasks.update(task.id, { entryId: entry.id, madePublic: true, updatedAt: nowISO() })
  return { entryId: entry.id, created: true }
}

/**
 * 撤销公开：只把待办上的关联断开，**不删除**已经生成的回忆。
 *
 * 为什么保留回忆：作者很可能在那条回忆里继续补了照片或细节，
 * 删掉是把别的数据一起毁了。真要移除，作者可以到故事页单条删除，
 * 那条路径有明确的删除确认。
 */
export async function revokeTaskPublic(task: Task): Promise<void> {
  await db.tasks.update(task.id, { madePublic: false, updatedAt: nowISO() })
}

/** 这条待办对应的回忆是否还在（用于界面如实显示状态） */
export async function publicEntryOf(task: Task): Promise<Entry | undefined> {
  if (!task.entryId) return undefined
  return db.entries.get(task.entryId)
}