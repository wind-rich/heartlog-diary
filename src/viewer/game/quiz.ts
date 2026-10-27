/**
 * T6-G 访客端「关于他的五道题」。
 *
 * 硬边界（与 T6 其他玩法一致）：
 * - **只读**：题目来自已发布快照的 `gameContent`，不写作者数据库、不请求网络；
 * - **成绩只存 localStorage**，键里带 `publishId` 与实际题数，换版本/换题量互不串；
 * - 题目顺序与选项顺序由 seed 确定性洗牌，可复现；`correctOptionId` 不随洗牌变化。
 */
import type { PublicGameContent } from '../types'
import { shuffleWithSeed } from './memory'

/** 公共快照 `gameContent` 中 quiz 条目的共享类型。 */
export type PublicQuizGameContent = Extract<PublicGameContent, { kind: 'quiz' }>

export interface QuizQuestion {
  id: string
  prompt: string
  /** 选项顺序已按 seed 洗牌；正确答案用 correctOptionId 判定，不看位置 */
  options: { id: string; text: string }[]
  correctOptionId: string
  explanation?: string
  photoId?: string
  sourceEntryIds: string[]
}

export interface QuizRecord {
  bestCorrect: number
  bestAssists: number
  rounds: number
}

export const QUIZ_MAX_QUESTIONS = 5

/**
 * 只保留规则完备的题目：
 * - 单选，2-4 个选项，选项 ID 唯一且文本非空；
 * - 正确答案唯一且必须在选项里；
 * - 题干非空；sourceEntryIds 缺省视为空数组。
 * 不合格的题目直接丢弃，不用脏数据凑局。
 */
export function validQuizItems(content: PublicGameContent[] | undefined): PublicQuizGameContent[] {
  const out: PublicQuizGameContent[] = []
  const seen = new Set<string>()
  for (const item of content ?? []) {
    if (!item || item.kind !== 'quiz' || typeof item.id !== 'string' || !item.id) continue
    if (seen.has(item.id)) continue
    if (typeof item.prompt !== 'string' || !item.prompt.trim()) continue
    const options = Array.isArray(item.options) ? item.options : []
    if (options.length < 2 || options.length > 4) continue
    const optionIds = new Set<string>()
    let ok = true
    for (const option of options) {
      if (!option || typeof option.id !== 'string' || !option.id || optionIds.has(option.id)) { ok = false; break }
      if (typeof option.text !== 'string' || !option.text.trim()) { ok = false; break }
      optionIds.add(option.id)
    }
    if (!ok || !optionIds.has(item.correctOptionId)) continue
    seen.add(item.id)
    out.push({ ...item, sourceEntryIds: Array.isArray(item.sourceEntryIds) ? item.sourceEntryIds : [] })
  }
  return out
}

/**
 * 组一局：从有效题库里按 seed 洗牌取前 5 题，题内选项再按 seed 洗牌。
 * 同一份内容 + 同一个 seed 必然得到同样的题序与选项序，便于自测与排查。
 */
export function buildQuizQuestions(
  content: PublicGameContent[] | undefined,
  publishId: string,
  seed: string,
  count = QUIZ_MAX_QUESTIONS,
): QuizQuestion[] {
  const pool = validQuizItems(content)
  if (!pool.length) return []
  const picked = shuffleWithSeed(pool, `${publishId}|quiz-questions|${seed}`).slice(0, Math.min(count, pool.length))
  return picked.map((item, index) => ({
    id: item.id,
    prompt: item.prompt.trim(),
    options: shuffleWithSeed(
      item.options.map((option) => ({ id: option.id, text: option.text.trim() })),
      `${publishId}|quiz-options|${seed}|${item.id}|${index}`,
    ),
    correctOptionId: item.correctOptionId,
    explanation: item.explanation?.trim() || undefined,
    photoId: item.photoId,
    sourceEntryIds: item.sourceEntryIds,
  }))
}

/* ------------------------------------------------------------------ */
/* 本地成绩：只写 localStorage，键按发布版本与实际题数隔离                 */
/* ------------------------------------------------------------------ */

const keyFor = (publishId: string, questionCount: number) =>
  `heartlog.game.quiz.v1.${publishId || 'unknown'}.${questionCount}`

export function loadQuizRecord(publishId: string, questionCount: number): QuizRecord | null {
  try {
    const raw = localStorage.getItem(keyFor(publishId, questionCount))
    if (!raw) return null
    const value = JSON.parse(raw) as Partial<QuizRecord>
    if (typeof value.bestCorrect !== 'number') return null
    return { bestCorrect: value.bestCorrect, bestAssists: value.bestAssists ?? 0, rounds: value.rounds ?? 0 }
  } catch {
    // 隐私模式 / 存储被禁用：没有成绩可看，但不该影响玩
    return null
  }
}

/**
 * 记一局成绩。「最好成绩」按答对多优先，答对相同再看辅助少；`rounds` 累加总完成局数。
 * 跳过不计答错，也不计入答对；结果展示只按正确数/实际题数。
 */
export function saveQuizRecord(
  publishId: string,
  questionCount: number,
  result: { correct: number; assists: number },
): QuizRecord {
  const previous = loadQuizRecord(publishId, questionCount)
  const better =
    !previous || result.correct > previous.bestCorrect ||
    (result.correct === previous.bestCorrect && result.assists < previous.bestAssists)
  const record: QuizRecord = {
    bestCorrect: better ? result.correct : previous!.bestCorrect,
    bestAssists: better ? result.assists : previous!.bestAssists,
    rounds: (previous?.rounds ?? 0) + 1,
  }
  try {
    localStorage.setItem(keyFor(publishId, questionCount), JSON.stringify(record))
  } catch {
    // 写不进去就只在本次会话里显示，不弹错
  }
  return record
}
