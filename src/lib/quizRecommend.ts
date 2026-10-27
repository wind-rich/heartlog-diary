/**
 * 按作者选定的记录生成五道题草稿。
 *
 * 只在作者点按钮时调用；模型输出必须经过结构校验和来源白名单校验。
 * 生成结果永远只是草稿：答案可能猜错，作者必须核对后才能保存/发布。
 */
import { aiChat, aiReady, AIError } from '../lib/ai'
import type { AIConfig, Entry } from '../db/types'

export interface QuizSuggestion {
  prompt: string
  options: string[]
  correctIndex: number
  explanation: string
  sourceEntryIds: string[]
}

const QUIZ_RULES = `你在帮助作者为伴侣准备一组轻松的小测验。只根据给出的记录出题。

【硬性规则】
1. 不编造记录里没有出现的人、事、时间、地点或偏好。
2. 每题 2～4 个选项，只有一个最符合记录支撑的答案；其余选项必须合理但明显不被记录支持。
3. 如果记录不足以确定答案，就换一个记录能支撑的问题；不要猜。
4. 不做心理诊断、不评价关系、不使用窥探或审讯式措辞。
5. 只输出 JSON，不要 Markdown 代码围栏，不要解释。

【JSON 格式】
{"questions":[{"prompt":"题干","options":["选项A","选项B","选项C"],"correctIndex":0,"explanation":"一句简短说明","sourceEntryIds":["e1"]}]}
sourceEntryIds 只能使用下面记录方括号里的编号对应关系，不允许编造。`

function contextOf(entries: Entry[]): { text: string; index: Map<string, string> } {
  const index = new Map<string, string>()
  const lines = entries.map((entry, i) => {
    const no = `e${i + 1}`
    index.set(no, entry.id)
    const tags = entry.tagList?.length ? `；标签：${entry.tagList.join('、')}` : ''
    return `[${no}] ${entry.occurredAt.slice(0, 10)} ${entry.title}${tags}\n${entry.content || entry.taSaid || entry.myObservation || '（只有标题）'}`
  })
  return { text: lines.join('\n\n'), index }
}

export function parseQuizSuggestions(raw: string, entries: Entry[], count = 3): QuizSuggestion[] {
  const parsed = parseJson(raw) as { questions?: unknown[] }
  if (!Array.isArray(parsed.questions)) throw new AIError('AI 返回格式不对', '没有 questions 数组，请重试。')
  const { index } = contextOf(entries)
  const out: QuizSuggestion[] = []
  for (const item of parsed.questions) {
    if (!item || typeof item !== 'object') continue
    const row = item as Record<string, unknown>
    const prompt = typeof row.prompt === 'string' ? row.prompt.trim() : ''
    const options = Array.isArray(row.options)
      ? row.options.map((option) => (typeof option === 'string' ? option.trim() : '')).filter(Boolean)
      : []
    const correctIndex = typeof row.correctIndex === 'number' ? row.correctIndex : -1
    if (!prompt || prompt.length > 120) continue
    if (options.length < 2 || options.length > 4 || new Set(options).size !== options.length) continue
    if (!Number.isInteger(correctIndex) || correctIndex < 0 || correctIndex >= options.length) continue
    const sourceEntryIds = Array.isArray(row.sourceEntryIds)
      ? [...new Set(row.sourceEntryIds.map((id) => (typeof id === 'string' ? index.get(id) : '')).filter((id): id is string => Boolean(id)))]
      : []
    if (!sourceEntryIds.length) continue
    out.push({
      prompt,
      options,
      correctIndex,
      explanation: typeof row.explanation === 'string' ? row.explanation.trim().slice(0, 300) : '',
      sourceEntryIds,
    })
    if (out.length >= count) break
  }
  if (!out.length) throw new AIError('AI 生成的题目没有通过校验', '请重试，或改用离线模板后手动补充答案。')
  return out
}

function parseJson(raw: string): unknown {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start < 0 || end <= start) throw new AIError('AI 没有返回可解析的题目')
  try {
    return JSON.parse(cleaned.slice(start, end + 1))
  } catch {
    throw new AIError('AI 返回的题目不是有效 JSON', '请重试一次；如果持续失败，可以改用离线模板。')
  }
}

export async function aiQuizSuggestions(config: AIConfig, entries: Entry[], count = 3, cloudSignedIn = false): Promise<QuizSuggestion[]> {
  if (!entries.length) throw new AIError('还没有选记录', '先勾选至少一条有内容的记录。')
  if (!aiReady(config, cloudSignedIn)) throw new AIError('AI 功能未启用', '请先在设置里启用 AI，或使用离线模板。')
  const { text } = contextOf(entries)
  const raw = await aiChat(
    config,
    [
      { role: 'system', content: QUIZ_RULES },
      {
        role: 'user',
        content: `请根据下面 ${entries.length} 条记录，出 ${count} 道题。正确答案必须有记录支撑。\n\n${text}`,
      },
    ],
    { temperature: 0.5, maxTokens: 1800 },
  )
  return parseQuizSuggestions(raw, entries, count)
}
