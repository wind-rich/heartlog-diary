import type { AIConfig, Entry, PortraitInsight } from '../db/types'
import { EVIDENCE_TYPES, entryTypeMeta, HEALTH_STATUS, prefCategoryMeta, WISH_STATUS } from './constants'
import { fmtDate, fmtTime, parseAny, toDateStr } from './date'
import { moodLabelOf } from './stats'
import type { AllData } from './exporter'

/* ------------------------------------------------------------------ */
/* 基础调用                                                            */
/* ------------------------------------------------------------------ */

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string | { type: string; text?: string; image_url?: { url: string } }[]
}

export class AIError extends Error {
  constructor(message: string, readonly detail?: string) {
    super(message)
    this.name = 'AIError'
  }
}

export function aiReady(config: AIConfig): boolean {
  if (!config.enabled) return false
  if (config.viaProxy) return Boolean(config.proxyUrl)
  return Boolean(config.baseUrl && config.apiKey && config.model)
}

function endpointOf(config: AIConfig): string {
  if (config.viaProxy) {
    const base = (config.proxyUrl || '').replace(/\/$/, '')
    return base.endsWith('/chat/completions') ? base : `${base}/chat/completions`
  }
  const base = config.baseUrl.replace(/\/$/, '')
  return base.endsWith('/chat/completions') ? base : `${base}/chat/completions`
}

export async function aiChat(
  config: AIConfig,
  messages: ChatMessage[],
  opts: { temperature?: number; maxTokens?: number; signal?: AbortSignal } = {},
): Promise<string> {
  if (!config.enabled) throw new AIError('AI 功能未启用')
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (!config.viaProxy && config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`

  let res: Response
  try {
    res = await fetch(endpointOf(config), {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: config.model,
        messages,
        temperature: opts.temperature ?? config.temperature ?? 0.7,
        max_tokens: opts.maxTokens ?? 2400,
        stream: false,
        ...(config.viaProxy ? { apiKey: config.apiKey } : {}),
      }),
      signal: opts.signal,
    })
  } catch (err) {
    throw new AIError(
      '无法连接到 AI 服务',
      `${(err as Error).message}\n\n常见原因：\n1) 接口地址写错；\n2) 浏览器跨域（CORS）被拦截 —— 改用「服务端代理」模式，并运行项目内 server/proxy.mjs；\n3) 网络不可达。`,
    )
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    let hint = ''
    if (res.status === 401) hint = 'API Key 无效或已过期。'
    else if (res.status === 404) hint = '模型名或接口地址不对。'
    else if (res.status === 429) hint = '触发限流或余额不足。'
    throw new AIError(`AI 服务返回 ${res.status}`, `${text.slice(0, 500)}${hint ? `\n\n提示：${hint}` : ''}`)
  }

  const json = (await res.json()) as {
    choices?: { message?: { content?: string }; text?: string }[]
    error?: { message?: string }
  }
  if (json.error?.message) throw new AIError('AI 服务返回错误', json.error.message)
  const content = json.choices?.[0]?.message?.content ?? json.choices?.[0]?.text
  if (!content) throw new AIError('AI 返回内容为空')
  return content.trim()
}

/* ------------------------------------------------------------------ */
/* 上下文构建（默认只发送用户选定的文字内容）                           */
/* ------------------------------------------------------------------ */

export interface ContextOptions {
  includeHealth: boolean
  /** 包含「我的观察」与私人备注 */
  includePrivate: boolean
  maxEntries?: number
}

export interface BuiltContext {
  text: string
  /** 记录编号 -> 真实 id */
  index: Map<string, string>
}

export function buildContext(
  data: AllData,
  start: Date,
  end: Date,
  opts: ContextOptions,
): BuiltContext {
  const L: string[] = []
  const index = new Map<string, string>()
  let n = 0

  const person = data.person
  const name = person?.nickname || person?.name || 'TA'
  L.push(`# 关于 ${name} 的记录（${fmtDate(start)} 至 ${fmtDate(end)}）`)
  L.push('')

  if (person) {
    L.push('## 基础档案')
    L.push(`- 昵称：${person.nickname || person.name || '未填'}`)
    if (person.birthday) {
      L.push(`- 生日：${person.birthday}（${person.calendarType === 'lunar' ? '农历' : '公历'}）`)
    }
    if (person.zodiac) L.push(`- 星座（仅作档案展示，不得据此推断性格）：${person.zodiac}`)
    if (person.meetDate) L.push(`- 相识日：${person.meetDate}`)
    if (person.intro) L.push(`- 自我介绍：${person.intro}`)
    L.push('')
  }

  const inR = (iso?: string) => {
    if (!iso) return false
    const t = parseAny(iso).getTime()
    return t >= start.getTime() && t <= end.getTime()
  }

  const entries = data.entries.filter((e) => inR(e.occurredAt)).sort((a, b) => parseAny(a.occurredAt).getTime() - parseAny(b.occurredAt).getTime())
  L.push('## 事件记录（每条有编号，引用时请使用编号）')
  if (!entries.length) {
    L.push('（该时间段没有事件记录）')
  } else {
    for (const e of entries.slice(-(opts.maxEntries ?? 200))) {
      n++
      const tag = `E${n}`
      index.set(tag, e.id)
      const meta = entryTypeMeta(e.type)
      L.push(`[${tag}] ${fmtDate(e.occurredAt)} ${fmtTime(e.occurredAt)} · ${meta.label} · ${e.title || '（无标题）'}`)
      if (e.content) L.push(`    经过：${e.content}`)
      if (e.taSaid) L.push(`    TA 原话：${e.taSaid}`)
      if (opts.includePrivate && e.myObservation) L.push(`    我的观察（非 TA 原话）：${e.myObservation}`)
      if (e.mood) L.push(`    当天心情：${moodLabelOf(e.mood, e.moodCustom)}${e.moodLevel ? `（${e.moodLevel}/5）` : ''}`)
      if (e.tagList?.length) L.push(`    标签：${e.tagList.join('、')}`)
      if (e.followUp) L.push(`    待跟进：${e.followUp}${e.followUpDone ? '（已完成）' : ''}`)
    }
  }
  L.push('')

  const statuses = data.statuses.filter((s) => inR(s.date)).sort((a, b) => (a.date < b.date ? -1 : 1))
  if (statuses.length) {
    L.push('## 每日状态')
    for (const s of statuses) {
      const parts = [
        `心情：${s.mood ? moodLabelOf(s.mood, s.moodCustom) : '未记录'}`,
        s.moodLevel ? `程度 ${s.moodLevel}/5` : '',
        s.energy ? `精力 ${s.energy}/5` : '',
        s.sleepHours ? `睡眠 ${s.sleepHours}h` : '',
        s.goodThing ? `好事：${s.goodThing}` : '',
        s.worry ? `烦心事：${s.worry}` : '',
        s.needAttention ? `需关注：${s.needAttention}` : '',
      ].filter(Boolean)
      L.push(`- ${s.date}｜${parts.join('；')}`)
    }
    L.push(`（区间共 ${Math.round((end.getTime() - start.getTime()) / 86400000) + 1} 天，其中 ${statuses.length} 天有状态记录；未记录的日期视为空白，不要臆测。）`)
    L.push('')
  }

  const prefs = data.preferences.filter((p) => p.personId === person?.id)
  if (prefs.length) {
    L.push('## 已确认的兴趣与偏好（含依据与最近确认时间）')
    for (const p of prefs) {
      const dir = p.direction === 'like' ? '喜欢' : p.direction === 'dislike' ? '不喜欢' : '想尝试'
      L.push(
        `- ${prefCategoryMeta(p.category).label}｜${p.name}｜${dir}${p.likeLevel ? `｜程度 ${p.likeLevel}/5` : ''}${p.lastConfirmedAt ? `｜最近确认 ${p.lastConfirmedAt}` : ''}｜依据 ${p.evidenceEntryIds?.length ?? 0} 条记录${p.note ? `｜备注：${p.note}` : ''}`,
      )
    }
    L.push('')
  }

  const wishes = data.wishes.filter((w) => w.personId === person?.id)
  if (wishes.length) {
    L.push('## 愿望清单')
    for (const w of wishes) {
      L.push(`- ${w.content}｜${WISH_STATUS.find((x) => x.value === w.status)?.label ?? w.status}${w.raisedAt ? `｜提出于 ${toDateStr(w.raisedAt)}` : ''}${w.occasion ? `｜场合 ${w.occasion}` : ''}`)
    }
    L.push('')
  }

  const gifts = data.gifts.filter((g) => g.personId === person?.id)
  if (gifts.length) {
    L.push('## 历史礼物')
    for (const g of gifts) {
      L.push(`- ${fmtDate(g.givenAt)}｜${g.name}${g.occasion ? `｜${g.occasion}` : ''}${g.amount ? `｜¥${g.amount}` : ''}${g.feedback ? `｜TA 的反应：${g.feedback}` : ''}`)
    }
    L.push('')
  }

  if (opts.includeHealth) {
    const health = data.health.filter((h) => h.personId === person?.id)
    if (health.length) {
      L.push('## 健康记录（仅供回顾，严禁据此推断疾病或给出诊断）')
      for (const h of health) {
        L.push(
          `- ${fmtDate(h.occurredAt)}｜${h.symptom}｜${HEALTH_STATUS.find((x) => x.value === h.status)?.label ?? h.status}${h.severity ? `｜程度 ${h.severity}/5` : ''}${h.medication ? `｜就医/用药：${h.medication}` : ''}${h.recovery ? `｜恢复：${h.recovery}` : ''}`,
        )
      }
      L.push('')
    }
  } else {
    L.push('## 健康记录')
    L.push('（用户选择不发送健康记录，此部分不可见，也不要臆测。）')
    L.push('')
  }

  const insights = data.insights.filter((i) => i.personId === person?.id)
  if (insights.length) {
    L.push('## 已有画像条目（用户确认状态）')
    for (const i of insights) {
      L.push(`- 【${i.dimension}】${i.description}｜依据类型：${EVIDENCE_TYPES.find((x) => x.value === i.evidenceType)?.label ?? i.evidenceType}｜状态：${i.confirmState === 'confirmed' ? '已确认' : i.confirmState === 'rejected' ? '用户已否决（请勿再提）' : '待确认'}`)
    }
    L.push('')
  }

  return { text: L.join('\n'), index }
}

/* ------------------------------------------------------------------ */
/* 系统提示词                                                          */
/* ------------------------------------------------------------------ */

const BASE_RULES = `你是「心意簿」里的私人记录助手，帮助用户回顾与伴侣之间的日常记录。

【硬性规则】
1. 只依据用户提供的记录作答，不编造事实、不脑补未记录的细节。
2. 每条结论后用 [E1] 这样的编号标注来源；没有依据就直说「记录不足」。
3. 时间范围、记录条数必须写清楚。
4. 区分三类信息并明确标注：
   - TA 明确表达过（原文或明确表态）
   - 多次记录体现的倾向（至少两条记录互相印证）
   - 暂时需要进一步观察（仅一两次迹象）
5. 「TA 原话」与「我的观察」不是一回事，不要把用户的推测当作 TA 说过的内容。
6. 严禁根据星座、生肖推断性格；严禁根据情绪或健康记录推断疾病，也不给医疗建议。
7. 语气温和、具体、不说教。不制造焦虑，不评判任何一方。
8. 用中文回答，Markdown 格式，不要输出与任务无关的寒暄。`

/* ------------------------------------------------------------------ */
/* 各功能                                                              */
/* ------------------------------------------------------------------ */

export interface AITaskOptions {
  includeHealth: boolean
  includePrivate: boolean
  signal?: AbortSignal
}

export interface AIResult {
  content: string
  citedEntryIds: string[]
  gaps: string
}

function extractCitations(content: string, index: Map<string, string>): string[] {
  const ids = new Set<string>()
  const re = /\[(E\d+)\]/g
  let m: RegExpExecArray | null
  while ((m = re.exec(content))) {
    const id = index.get(m[1])
    if (id) ids.add(id)
  }
  return Array.from(ids)
}

async function runTask(
  config: AIConfig,
  ctx: BuiltContext,
  start: Date,
  end: Date,
  taskPrompt: string,
  opts: AITaskOptions,
  maxTokens = 2400,
): Promise<AIResult> {
  const userMessage = `【时间范围】${fmtDate(start)} 至 ${fmtDate(end)}
【健康记录是否可见】${opts.includeHealth ? '可见' : '不可见'}
【私人备注是否可见】${opts.includePrivate ? '可见' : '不可见'}

【记录内容】
${ctx.text}

【任务】
${taskPrompt}`
  const content = await aiChat(
    config,
    [
      { role: 'system', content: BASE_RULES },
      { role: 'user', content: userMessage },
    ],
    { maxTokens, signal: opts.signal },
  )
  return { content, citedEntryIds: extractCitations(content, ctx.index), gaps: '' }
}

export async function aiPeriodSummary(
  config: AIConfig,
  data: AllData,
  start: Date,
  end: Date,
  kind: 'week' | 'month' | 'year' | 'custom',
  opts: AITaskOptions,
): Promise<AIResult> {
  const ctx = buildContext(data, start, end, opts)
  const kindText = kind === 'week' ? '周' : kind === 'month' ? '月' : kind === 'year' ? '年度' : '阶段性'
  return runTask(
    config,
    ctx,
    start,
    end,
    `请生成一份${kindText}总结，结构如下：
1. **这段时间的概况**（几句话，说清整体气氛）
2. **发生过的重要事件**（按时间顺序，每条带 [E编号]）
3. **情绪与状态变化**（只写有记录的日期，说明记录了多少天；没有记录的日子不要填）
4. **新出现的兴趣、愿望或变化**（标注依据强度）
5. **值得注意或需要跟进的事**
6. **记录不足的地方**（明确指出哪些方面缺少记录，导致无法判断）

字数 400-700 字。`,
    opts,
  )
}

export interface PortraitDraft {
  dimension: string
  description: string
  evidenceType: 'stated' | 'repeated' | 'hypothesis'
  evidenceEntryIds: string[]
}

export async function aiUpdatePortrait(
  config: AIConfig,
  data: AllData,
  start: Date,
  end: Date,
  existing: PortraitInsight[],
  opts: AITaskOptions,
): Promise<{ drafts: PortraitDraft[]; raw: string; gaps: string }> {
  const ctx = buildContext(data, start, end, opts)
  const existingText = existing.length
    ? existing.map((i) => `- 【${i.dimension}】${i.description}（${i.confirmState}）`).join('\n')
    : '（暂无）'

  const prompt = `【时间范围】${fmtDate(start)} 至 ${fmtDate(end)}
【记录内容】
${ctx.text}

【已有画像条目】
${existingText}

【任务】
从上面的记录中提取可以补充或更新的个人画像条目，只输出 JSON，不要输出任何解释文字或代码块标记。格式：
{
  "insights": [
    {
      "dimension": "兴趣与动力|相处偏好|情绪与支持方式|在意的事情|生活习惯|近期变化 六选一",
      "description": "一句具体、可核对的话，控制在 40 字以内",
      "evidenceType": "stated|repeated|hypothesis",
      "evidence": ["E1","E3"]
    }
  ]
}

要求：
- dimension 必须严格用上面六个词之一。
- evidence 必须是记录里真实存在的编号；只出现一次的迹象用 hypothesis，不要写成 stated。
- 已有且没有变化、或用户已否决的条目不要重复输出。
- 如果记录不足以得出任何新结论，返回 {"insights": []}。`

  const raw = await aiChat(
    config,
    [
      { role: 'system', content: BASE_RULES },
      { role: 'user', content: prompt },
    ],
    { maxTokens: 2000, signal: opts.signal },
  )

  const drafts = parsePortraitJson(raw, ctx.index)
  return { drafts, raw, gaps: drafts.length ? '' : '本次没有提取到有充分依据的新画像条目。' }
}

export function parsePortraitJson(raw: string, index: Map<string, string>): PortraitDraft[] {
  const cleaned = raw
    .replace(/^```(?:json)?/gm, '')
    .replace(/```$/gm, '')
    .trim()
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start < 0 || end <= start) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(cleaned.slice(start, end + 1))
  } catch {
    return []
  }
  const list = (parsed as { insights?: unknown }).insights
  if (!Array.isArray(list)) return []
  const validDims = ['兴趣与动力', '相处偏好', '情绪与支持方式', '在意的事情', '生活习惯', '近期变化']
  const out: PortraitDraft[] = []
  for (const item of list as Record<string, unknown>[]) {
    const dimension = String(item.dimension ?? '').trim()
    const description = String(item.description ?? '').trim()
    if (!dimension || !description) continue
    const evRaw = Array.isArray(item.evidence) ? (item.evidence as unknown[]).map(String) : []
    const evidenceEntryIds = evRaw.map((t) => index.get(t.replace(/[[\]]/g, ''))).filter((x): x is string => Boolean(x))
    const et = String(item.evidenceType ?? 'hypothesis')
    out.push({
      dimension: validDims.includes(dimension) ? dimension : '近期变化',
      description,
      evidenceType: (['stated', 'repeated', 'hypothesis'].includes(et) ? et : 'hypothesis') as PortraitDraft['evidenceType'],
      evidenceEntryIds,
    })
  }
  return out
}

export async function aiAdvice(
  config: AIConfig,
  data: AllData,
  start: Date,
  end: Date,
  opts: AITaskOptions,
): Promise<AIResult> {
  const ctx = buildContext(data, start, end, opts)
  return runTask(
    config,
    ctx,
    start,
    end,
    `请给出 3-5 条相处建议。要求：
- 每条建议必须来自记录中的具体事实，并标注 [E编号]；
- 具体、可执行（比如"这周找一次一起做的事"），不要空泛的"多沟通"；
- 温和、不说教，不指责任何一方；
- 最后单列一段「我不确定的地方」，说明哪些建议只是因为记录太少而比较保守。`,
    opts,
  )
}

export async function aiGiftSuggestions(
  config: AIConfig,
  data: AllData,
  budget: string,
  occasion: string,
  opts: AITaskOptions,
): Promise<AIResult> {
  const start = new Date(2000, 0, 1)
  const end = new Date(2100, 0, 1)
  const ctx = buildContext(data, start, end, opts)
  return runTask(
    config,
    ctx,
    start,
    end,
    `请给出 4-6 个礼物建议，用于场合「${occasion || '日常'}」，预算「${budget || '不限'}」。
每条包含：礼物名称、为什么适合 TA（必须引用 [E编号] 的依据，优先引用愿望清单和 TA 明确表达过的偏好）、大概价格区间、需要注意的点。
最后说明哪些建议依据充分、哪些只是猜测。避免重复 TA 已经收到过的礼物。`,
    opts,
  )
}

export async function aiNaturalQuery(
  config: AIConfig,
  data: AllData,
  query: string,
  opts: AITaskOptions,
): Promise<AIResult> {
  const start = new Date(2000, 0, 1)
  const end = new Date(2100, 0, 1)
  const ctx = buildContext(data, start, end, opts)
  return runTask(
    config,
    ctx,
    start,
    end,
    `用户的问题是：「${query}」

请直接回答这个问题。规则：
- 只依据记录回答，列出找到的原文片段并标注 [E编号] 和日期；
- 如果记录里找不到相关内容，明确说「记录中没有找到」，并建议用户可以在哪些方面补充记录；
- 不要编造。回答控制在 300 字以内。`,
    opts,
  )
}

/** 照片分析是独立开关，默认关闭；启用后单独发送图片 */
export async function aiAnalyzePhotos(
  config: AIConfig,
  images: { dataUrl: string; caption?: string; date?: string }[],
  question: string,
  opts: AITaskOptions,
): Promise<AIResult> {
  const content: { type: string; text?: string; image_url?: { url: string } }[] = [
    {
      type: 'text',
      text: `请只描述照片里能客观看到的内容，不要推测 TA 的性格、心情或健康状况。
${question ? `关注点：${question}` : ''}
输出格式：每张照片一段，写「看到什么」+「如果要记录，可以记什么」。不要编造照片里没有的信息。`,
    },
  ]
  for (const img of images.slice(0, 4)) {
    content.push({ type: 'image_url', image_url: { url: img.dataUrl } })
  }
  const ctx: BuiltContext = { text: '', index: new Map() }
  void ctx
  const out = await aiChat(
    config,
    [
      { role: 'system', content: '你是照片内容描述助手。只描述可见事实，不做心理、健康或性格推断。' },
      { role: 'user', content },
    ],
    { maxTokens: 1200, signal: opts.signal },
  )
  return { content: out, citedEntryIds: [], gaps: '' }
}

/* ------------------------------------------------------------------ */
/* 建议提示（无 AI 时提示用户可开启）                                    */
/* ------------------------------------------------------------------ */

export function aiDisabledHint(): string {
  return 'AI 功能未配置或未启用。所有记录、检索、统计与导出功能不受影响，可在「设置 → AI 增强」中开启。'
}
