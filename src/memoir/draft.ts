/**
 * 回忆录的 AI 草稿（可选能力）。
 *
 * 设计原则（对应 T5 验收）：
 * - **只在作者点按钮时发生**：没有任何自动把记录发给外部模型的路径。
 * - **只用给定范围**：调用方传入的 `entries` 就是允许引用的全部内容，
 *   模型引用了范围外的编号一律剔除（`rejectedIds`），不静默接受。
 * - **保留引用**：正文里的 `[E1]` 与 `citeMap` 一起落库，导出时变成可点击链接。
 * - **不覆盖人工内容**：本模块只产出草稿，是否替换章节由 store 层判断
 *   （`replaceAiSection` 会拒绝已由作者修改过的章节）。
 * - **失败不阻塞**：抛错由界面捕获并提示，保存/导出完全不受影响。
 */
import { aiChat, AIError } from '../lib/ai'
import type { MemoirDraft, MemoirDraftInput } from './types'

const MEMOIR_RULES = `你在帮助作者整理一本关于「TA」的私人回忆录。你的任务是把给定记录写成一段连贯、克制的散文式章节。

【硬性规则】
1. 只使用下面给出的记录，不编造任何未出现的人、事、时间、地点或对话。
2. 每处具体事实后面用 [E1] 这样的编号标注来源；没有记录支撑的话不要写。
3. 明确区分三类内容，并在行文中体现出来：
   - TA 明确说过的话（用引号，注明是原话）
   - 作者多次观察到的倾向（至少两条记录互相印证）
   - 只有一两次迹象、更像推测的内容（写成「也许」「看起来」）
4. 不做心理诊断，不推断疾病，不评判任何一方，不制造焦虑。
5. 记录不足时直接说明缺什么，不要用漂亮句子填空。
6. 只输出章节正文（Markdown），不要重复章节标题，不要加「以下是」之类的开场白。
7. 语气像作者自己在写，不要过度抒情，不要堆砌形容词。`

function numberedContext(entries: MemoirDraftInput['entries']): { text: string; citeMap: Record<string, string> } {
  const citeMap: Record<string, string> = {}
  const lines: string[] = []
  entries.forEach((e, i) => {
    const no = `E${i + 1}`
    citeMap[no] = e.id
    const head = [`[${no}]`, e.occurredAt.slice(0, 16).replace('T', ' '), e.title].filter(Boolean).join(' · ')
    const tags = e.tags?.length ? `\n标签：${e.tags.join('、')}` : ''
    const type = e.type ? `\n类型：${e.type}` : ''
    lines.push(`${head}${type}${tags}\n${e.content || '（无正文）'}`)
  })
  return { text: lines.join('\n\n'), citeMap }
}

/**
 * 生成一章草稿。
 *
 * `entries` 为空时直接抛错——「没有素材也要生成」只会得到编造内容，
 * 这比报错危险得多。
 */
export async function aiMemoirDraft(input: MemoirDraftInput): Promise<MemoirDraft> {
  if (!input.entries.length) {
    throw new AIError('这一章还没有可用的记录', '先在回忆录里选定取材范围，或给这一章挑几条记录再生成草稿。')
  }
  const { text: ctxText, citeMap } = numberedContext(input.entries)

  const scope =
    input.entries.length > 0
      ? `${input.entries[input.entries.length - 1].occurredAt.slice(0, 10)} 至 ${input.entries[0].occurredAt.slice(0, 10)}（按时间倒序给出）`
      : '未限定'

  const userMessage = `【回忆录标题】${input.memoirTitle}
【本章标题】${input.heading || '（未命名）'}
【可引用记录】${input.entries.length} 条，覆盖 ${scope}
【作者额外要求】${input.instruction?.trim() || '无'}

【记录内容】
${ctxText}

【任务】
写这一章，字数 400–700 字。只写记录里能支撑的内容，缺的地方直接说明。`

  const raw = await aiChat(
    input.config,
    [
      { role: 'system', content: MEMOIR_RULES },
      { role: 'user', content: userMessage },
    ],
    { maxTokens: 2000 },
  )

  const text = raw.trim()
  const allowed = new Set(Object.keys(citeMap))
  const cited = new Set<string>()
  const rejected = new Set<string>()
  const re = /\[(E\d+)\]/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    if (allowed.has(m[1])) cited.add(citeMap[m[1]])
    else rejected.add(m[1])
  }

  const warnings: string[] = []
  if (rejected.size) warnings.push(`模型引用了 ${rejected.size} 个范围外编号，已剔除`)
  if (!cited.size) warnings.push('正文没有出现任何可追溯的引用，建议核对是否用了给定记录')

  return {
    text,
    citeMap,
    citedEntryIds: Array.from(cited),
    rejectedIds: Array.from(rejected),
    model: input.config.provider === 'cloud' ? input.config.cloudModel || 'cloud' : input.config.model,
    at: new Date().toISOString(),
    warnings,
  }
}
