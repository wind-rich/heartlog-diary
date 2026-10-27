/**
 * 星球寻宝的作者推荐（离线模板 + 可选 AI 草稿）。
 *
 * 只在作者点按钮时发生；AI 只使用作者勾选的记录/照片。
 * 输出永远只是草稿，作者必须核对目标和线索后才能保存/发布。
 */
import { aiChat, aiReady, AIError } from '../lib/ai'
import type { AIConfig, Entry, Photo } from '../db/types'

export interface TreasureSuggestionStep {
  clue: string
  targetType: 'entry' | 'photo'
  targetId: string
}

export interface TreasureSuggestion {
  title: string
  description: string
  steps: TreasureSuggestionStep[]
  completionMessage: string
}

/* ------------------------------- 离线模板 ------------------------------- */

function entryClue(no: number, entry: Entry): string {
  const date = entry.occurredAt.slice(0, 10)
  return `第 ${no} 颗星和 ${date} 那天的回忆有关。`
}

function photoClue(no: number, photo: Photo): string {
  const date = photo.takenAt?.slice(0, 10)
  return date
    ? `第 ${no} 颗星藏在 ${date} 前后的一张照片里。`
    : `第 ${no} 颗星藏在一张还没写说明的照片里。`
}

export function buildOfflineTreasureSuggestions(entries: Entry[], photos: Photo[]): TreasureSuggestion[] {
  const out: TreasureSuggestion[] = []
  const push = (title: string, description: string, steps: TreasureSuggestionStep[]) => {
    if (steps.length === 3 && steps.every((step) => step.clue && step.targetId)) {
      out.push({ title, description, steps, completionMessage: '三颗星都回来了。它们一直都在，只是等我们再看一眼。' })
    }
  }

  if (entries.length >= 3) {
    push('时光三站', '从最近的记录里找回三颗星。', [0, 1, 2].map((index) => ({
      clue: entryClue(index + 1, entries[index]),
      targetType: 'entry' as const,
      targetId: entries[index].id,
    })))
  }

  if (photos.length >= 3) {
    push('画面三帧', '从最近的照片里找回三颗星。', [0, 1, 2].map((index) => ({
      clue: photoClue(index + 1, photos[index]),
      targetType: 'photo' as const,
      targetId: photos[index].id,
    })))
  }

  if (entries.length >= 2 && photos.length >= 1) {
    push('回忆与画面', '一半在文字里，一半在照片里。', [
      { clue: entryClue(1, entries[0]), targetType: 'entry', targetId: entries[0].id },
      { clue: photoClue(2, photos[0]), targetType: 'photo', targetId: photos[0].id },
      { clue: entryClue(3, entries[1]), targetType: 'entry', targetId: entries[1].id },
    ])
  }

  return out.slice(0, 3)
}

/* ------------------------------- AI 草稿 ------------------------------- */

const TREASURE_RULES = `你在帮助作者为伴侣设计一次轻松的星球寻宝。只使用给出的记录和照片。

【硬性规则】
1. 每个寻宝固定 3 步；每步指向一个给出的记录或照片，三个目标不能重复。
2. 线索要能引导对方找到目标，但不要把目标标题或照片说明原文完整复述出来。
3. 不编造未出现的人、事、地点或情节；不做心理分析，不使用窥探或审讯式措辞。
4. 只输出 JSON，不要 Markdown 代码围栏，不要解释。

【JSON 格式】
{"hunts":[{"title":"...","description":"...","steps":[{"clue":"...","targetType":"entry","targetKey":"e1"}],"completionMessage":"..."}]}
targetKey 只能使用下面方括号里的编号；targetType 只能是 entry 或 photo。`

interface TargetIndexItem { targetType: 'entry' | 'photo'; targetId: string }

function contextOf(entries: Entry[], photos: Photo[]): { text: string; index: Map<string, TargetIndexItem> } {
  const index = new Map<string, TargetIndexItem>()
  const lines: string[] = []
  entries.forEach((entry, i) => {
    const key = `e${i + 1}`
    index.set(key, { targetType: 'entry', targetId: entry.id })
    const tags = entry.tagList?.length ? `；标签：${entry.tagList.join('、')}` : ''
    lines.push(`[${key}] 记录 ${entry.occurredAt.slice(0, 10)} ${entry.title}${tags}\n${entry.content || entry.taSaid || entry.myObservation || '（只有标题）'}`)
  })
  photos.forEach((photo, i) => {
    const key = `p${i + 1}`
    index.set(key, { targetType: 'photo', targetId: photo.id })
    lines.push(`[${key}] 照片 ${photo.takenAt?.slice(0, 10) || '时间未知'} ${photo.caption || '（无说明）'}`)
  })
  return { text: lines.join('\n\n'), index }
}

export function parseTreasureSuggestions(
  raw: string,
  entries: Entry[],
  photos: Photo[],
  count = 1,
): TreasureSuggestion[] {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start < 0 || end <= start) throw new AIError('AI 没有返回可解析的寻宝')
  let parsed: { hunts?: unknown }
  try {
    parsed = JSON.parse(cleaned.slice(start, end + 1)) as { hunts?: unknown }
  } catch {
    throw new AIError('AI 返回的寻宝不是有效 JSON', '请重试一次；如果持续失败，可以改用离线模板。')
  }
  if (!Array.isArray(parsed.hunts)) throw new AIError('AI 返回格式不对', '没有 hunts 数组，请重试。')

  const { index } = contextOf(entries, photos)
  const out: TreasureSuggestion[] = []
  for (const item of parsed.hunts) {
    if (!item || typeof item !== 'object') continue
    const row = item as Record<string, unknown>
    const title = typeof row.title === 'string' ? row.title.trim() : ''
    const description = typeof row.description === 'string' ? row.description.trim() : ''
    const completionMessage = typeof row.completionMessage === 'string' ? row.completionMessage.trim() : ''
    if (!title || title.length > 40) continue
    if (description.length > 200) continue
    if (!completionMessage || completionMessage.length > 200) continue

    const rawSteps = Array.isArray(row.steps) ? row.steps : []
    if (rawSteps.length !== 3) continue
    const steps: TreasureSuggestionStep[] = []
    const usedKeys = new Set<string>()
    let valid = true
    for (const rawStep of rawSteps) {
      if (!rawStep || typeof rawStep !== 'object') { valid = false; break }
      const step = rawStep as Record<string, unknown>
      const clue = typeof step.clue === 'string' ? step.clue.trim() : ''
      const targetType = step.targetType === 'entry' || step.targetType === 'photo' ? step.targetType : null
      const targetKey = typeof step.targetKey === 'string' ? step.targetKey.trim() : ''
      if (!clue || clue.length > 100 || !targetType || !targetKey) { valid = false; break }
      const target = index.get(targetKey)
      if (!target || target.targetType !== targetType || usedKeys.has(targetKey)) { valid = false; break }
      usedKeys.add(targetKey)
      steps.push({ clue, targetType, targetId: target.targetId })
    }
    if (!valid || steps.length !== 3) continue
    out.push({ title, description, steps, completionMessage })
    if (out.length >= count) break
  }

  if (!out.length) throw new AIError('AI 生成的寻宝没有通过校验', '请重试，或改用离线模板后手动调整。')
  return out
}

export async function aiTreasureSuggestion(
  config: AIConfig,
  entries: Entry[],
  photos: Photo[],
  cloudSignedIn = false,
): Promise<TreasureSuggestion> {
  if (!entries.length && !photos.length) throw new AIError('还没有选内容', '先勾选至少一条记录或一张照片。')
  if (!aiReady(config, cloudSignedIn)) throw new AIError('AI 功能未启用', '请先在设置里启用 AI，或使用离线模板。')
  const { text } = contextOf(entries, photos)
  const raw = await aiChat(
    config,
    [
      { role: 'system', content: TREASURE_RULES },
      {
        role: 'user',
        content: `请根据下面 ${entries.length} 条记录和 ${photos.length} 张照片，设计 1 个三步寻宝。\n\n${text}`,
      },
    ],
    { temperature: 0.4, maxTokens: 1600 },
  )
  const suggestions = parseTreasureSuggestions(raw, entries, photos, 1)
  return suggestions[0]
}
