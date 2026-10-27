import { db } from '../db/db'
import type { GameContent } from '../db/types'
import type { PublicGameContent } from '../viewer/types'

export const GAME_CONTENT_SCHEMA_VERSION = 1

const KIND_LABEL: Record<string, string> = {
  quiz: '五道题',
  dateCard: '活动抽卡',
  treasure: '星球寻宝',
}

export function gameContentKindLabel(kind: string): string {
  return KIND_LABEL[kind] || kind
}

function cleanText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function uniqueStrings(values: unknown): string[] {
  if (!Array.isArray(values)) return []
  return [...new Set(values.map((v) => cleanText(v)).filter(Boolean))]
}

/** 校验一条作者内容。所有错误都给作者可读文本，发布前会整体阻断。 */
export function validateGameContent(
  row: GameContent,
  context: { entryIds: Set<string>; photoIds: Set<string> },
): string[] {
  const errors: string[] = []
  const label = gameContentKindLabel(row.kind)
  if (!row.id) errors.push(`${label}：缺少稳定 ID`)
  if (row.schemaVersion !== GAME_CONTENT_SCHEMA_VERSION) errors.push(`${label}：schemaVersion 应为 ${GAME_CONTENT_SCHEMA_VERSION}`)

  if (row.kind === 'quiz') {
    const prompt = cleanText(row.prompt)
    if (!prompt) errors.push('五道题：题干不能为空')
    if (prompt.length > 120) errors.push('五道题：题干不能超过 120 字')
    const options = Array.isArray(row.options) ? row.options : []
    if (options.length < 2 || options.length > 4) errors.push('五道题：每题需要 2～4 个选项')
    const ids = new Set<string>()
    const texts = new Set<string>()
    for (const option of options) {
      const id = cleanText(option?.id)
      const text = cleanText(option?.text)
      if (!id || ids.has(id)) errors.push('五道题：选项 ID 不能为空或重复')
      if (!text || texts.has(text)) errors.push('五道题：选项文字不能为空或重复')
      if (text.length > 40) errors.push('五道题：单个选项不能超过 40 字')
      ids.add(id)
      texts.add(text)
    }
    if (!cleanText(row.correctOptionId) || !ids.has(cleanText(row.correctOptionId))) errors.push('五道题：必须选择一个有效正确答案')
    if (cleanText(row.explanation).length > 300) errors.push('五道题：说明不能超过 300 字')
    if (row.photoId && !context.photoIds.has(row.photoId)) errors.push('五道题：引用的照片不在本次可发布照片里')
    for (const entryId of row.sourceEntryIds ?? []) {
      if (!context.entryIds.has(entryId)) errors.push(`五道题：来源记录 ${entryId} 不在本次可发布记录里`)
    }
    return errors
  }

  if (row.kind === 'dateCard') {
    if (row.category !== 'activity' && row.category !== 'place' && row.category !== 'surprise') errors.push('活动抽卡：类别必须是活动、地点类型或小彩蛋')
    const text = cleanText(row.text)
    if (!text) errors.push('活动抽卡：内容不能为空')
    if (text.length > 80) errors.push('活动抽卡：单张卡不能超过 80 字')
    for (const tag of row.tags ?? []) if (cleanText(tag).length > 20) errors.push('活动抽卡：单个标签不能超过 20 字')
    return errors
  }

  if (row.kind === 'treasure') {
    if (row.enabled) errors.push('星球寻宝：属于第四版，当前请先停用')
    return errors
  }

  errors.push(`未知内容类型：${String(row.kind)}`)
  return errors
}

/** 白名单映射：不透传 personId、createdAt、updatedAt 或未来内部字段。 */
export function toPublicGameContent(row: GameContent): PublicGameContent | null {
  if (row.enabled !== true) return null
  if (row.kind === 'quiz') {
    return {
      id: row.id,
      kind: 'quiz',
      schemaVersion: row.schemaVersion,
      prompt: cleanText(row.prompt),
      options: (row.options ?? []).map((option) => ({ id: cleanText(option.id), text: cleanText(option.text) })),
      correctOptionId: cleanText(row.correctOptionId),
      explanation: cleanText(row.explanation) || undefined,
      photoId: row.photoId || undefined,
      sourceEntryIds: uniqueStrings(row.sourceEntryIds),
    }
  }
  if (row.kind === 'dateCard') {
    return {
      id: row.id,
      kind: 'dateCard',
      schemaVersion: row.schemaVersion,
      category: row.category as 'activity' | 'place' | 'surprise',
      text: cleanText(row.text),
      tags: uniqueStrings(row.tags),
    }
  }
  return null
}

/** 作者预览使用的映射：无效内容不进快照，同时返回原因给编辑界面/发布检查。 */
export function mapPublicGameContent(
  rows: GameContent[],
  context: { entryIds: Set<string>; photoIds: Set<string> },
): { items: PublicGameContent[]; errors: string[] } {
  const items: PublicGameContent[] = []
  const errors: string[] = []
  for (const row of rows) {
    if (row.enabled !== true) continue
    const problems = validateGameContent(row, context)
    if (problems.length) {
      errors.push(...problems.map((problem) => `${row.prompt || row.text || row.title || row.id}：${problem}`))
      continue
    }
    const item = toPublicGameContent(row)
    if (item) items.push(item)
  }
  return { items, errors }
}

/** 发布前的硬门槛：已启用内容只要有一条校验失败，就中止发布。 */
export async function assertGameContentPublishable(): Promise<void> {
  const [rows, entries, photos] = await Promise.all([db.gameContent.toArray(), db.entries.toArray(), db.photos.toArray()])
  const context = { entryIds: new Set(entries.map((entry) => entry.id)), photoIds: new Set(photos.map((photo) => photo.id)) }
  const { errors } = mapPublicGameContent(rows, context)
  if (errors.length) {
    throw new Error(`互动内容还不能发布：\n${errors.slice(0, 5).join('\n')}${errors.length > 5 ? `\n另有 ${errors.length - 5} 项` : ''}`)
  }
}
