import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  BookHeart,
  Download,
  Heart,
  Loader2,
  Search,
  Sparkles,
  Trash2,
  Wand2,
} from 'lucide-react'
import { db, nowISO } from '../db/db'
import type { Summary } from '../db/types'
import { ENTRY_TYPES } from '../lib/constants'
import { fmtDate, fmtDateTime, parseAny, toDateStr } from '../lib/date'
import { buildBaseSummary } from '../lib/stats'
import { searchLocal, type SearchHit } from '../lib/query'
import { aiAdvice, aiDisabledHint, aiNaturalQuery, aiPeriodSummary, type AITaskOptions } from '../lib/ai'
import { loadAllData, rangePresets, type AllData } from '../lib/exporter'
import ExportDialog from '../components/ExportDialog'
import { Empty, Field, Markdown, Modal, SectionCard, Segmented, Switch, Tag, useConfirm, useToast } from '../components/ui'
import { useApp, useAIReady } from '../state/app'

type RangeKey = 'week' | 'lastWeek' | 'month' | 'lastMonth' | 'year'

const RANGE_LABELS: Record<RangeKey, string> = {
  week: '本周',
  lastWeek: '上周',
  month: '本月',
  lastMonth: '上月',
  year: '今年',
}

export default function Review() {
  const { person, aiConfig } = useApp()
  const aiOk = useAIReady()
  const toast = useToast()
  const confirm = useConfirm()
  const presets = useMemo(() => rangePresets(), [])
  const [rangeKey, setRangeKey] = useState<RangeKey>('month')
  const [aiOpen, setAiOpen] = useState(false)
  const [adviceOpen, setAdviceOpen] = useState(false)
  const [queryOpen, setQueryOpen] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [viewing, setViewing] = useState<Summary | null>(null)

  const pid = person?.id

  const data = useLiveQuery(async () => (pid ? loadAllData(pid) : undefined), [pid])
  const summaries = useLiveQuery(
    async () => (pid ? (await db.summaries.where('personId').equals(pid).toArray()).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)) : []),
    [pid],
  )

  const range = presets[rangeKey === 'week' ? 'thisWeek' : rangeKey === 'lastWeek' ? 'lastWeek' : rangeKey === 'month' ? 'thisMonth' : rangeKey === 'lastMonth' ? 'lastMonth' : 'thisYear']

  const bundle = useMemo(() => {
    if (!data) return undefined
    const s = range.start.getTime()
    const e = range.end.getTime()
    const inR = (iso?: string) => {
      if (!iso) return false
      const t = parseAny(iso).getTime()
      return t >= s && t <= e
    }
    return {
      entries: data.entries.filter((x) => inR(x.occurredAt)),
      statuses: data.statuses.filter((x) => inR(x.date)),
      preferences: data.preferences.filter((x) => inR(x.updatedAt) || (x.lastConfirmedAt ? inR(x.lastConfirmedAt) : false)),
      wishes: data.wishes.filter((x) => inR(x.raisedAt ?? x.createdAt)),
      gifts: data.gifts.filter((x) => inR(x.givenAt)),
      health: data.health.filter((x) => inR(x.occurredAt) || x.status !== 'recovered'),
      photos: data.photos.filter((x) => inR(x.takenAt ?? x.createdAt)),
      insights: data.insights,
    }
  }, [data, range])

  const base = useMemo(() => {
    if (!data || !bundle) return undefined
    return buildBaseSummary({ person: data.person, start: range.start, end: range.end, bundle, allEntries: data.entries })
  }, [data, bundle, range])

  if (!pid) return null

  const saveSummary = async (s: Omit<Summary, 'id' | 'createdAt' | 'updatedAt'>) => {
    const row: Summary = { ...s, id: `s_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, createdAt: nowISO(), updatedAt: nowISO() }
    await db.summaries.put(row)
    return row
  }

  return (
    <div className="space-y-4">
      {/* 范围选择 */}
      <div className="card card-pad">
        <div className="flex items-center gap-2 mb-2">
          <BookHeart size={16} className="text-rose-deep" />
          <span className="text-[15px] font-semibold text-ink-900">回顾范围</span>
          <div className="flex-1" />
          <button className="btn-text" onClick={() => setExportOpen(true)}>
            <Download size={14} /> 导出
          </button>
        </div>
        <div className="flex gap-1.5 overflow-x-auto no-scrollbar">
          {(Object.keys(RANGE_LABELS) as RangeKey[]).map((k) => (
            <button key={k} className={`shrink-0 ${rangeKey === k ? 'chip-on' : 'chip-off'}`} onClick={() => setRangeKey(k)}>
              {RANGE_LABELS[k]}
            </button>
          ))}
        </div>
        <p className="mt-2 text-[12.5px] text-ink-300">
          {fmtDate(range.start)} 至 {fmtDate(range.end)} · {bundle?.entries.length ?? 0} 条事件 ·{' '}
          {bundle?.statuses.length ?? 0} 天有心情记录
        </p>
      </div>

      {/* 基础总结 */}
      <SectionCard
        title={
          <>
            <Wand2 size={15} className="text-rose-deep" /> 基础总结（不依赖 AI）
          </>
        }
        action={
          <button
            className="btn-text"
            onClick={async () => {
              if (!base) return
              await saveSummary({
                personId: pid,
                kind: rangeKey === 'year' ? 'year' : rangeKey.includes('Week') || rangeKey === 'week' || rangeKey === 'lastWeek' ? 'week' : 'month',
                title: `${RANGE_LABELS[rangeKey]}总结 · ${toDateStr(range.start)} ~ ${toDateStr(range.end)}`,
                rangeStart: range.start.toISOString(),
                rangeEnd: range.end.toISOString(),
                content: base.markdown,
                generator: 'manual',
                evidenceEntryIds: (bundle?.entries ?? []).map((e) => e.id),
              })
              toast('已保存到历史报告')
            }}
          >
            保存为报告
          </button>
        }
      >
        {base ? (
          <>
            <div className="grid grid-cols-3 gap-2 mb-3">
              <StatBox label="事件" value={base.stats.entryCount} />
              <StatBox label="有记录天数" value={`${base.stats.recordedDays}/${base.stats.totalDays}`} />
              <StatBox label="照片" value={base.stats.photoCount} />
            </div>
            <details className="group">
              <summary className="text-[13.5px] text-rose-deep cursor-pointer list-none">
                查看完整汇总内容 ▾
              </summary>
              <div className="mt-2 max-h-[420px] overflow-y-auto rounded-xl border border-cream-200 bg-white p-3">
                <Markdown text={base.markdown} />
              </div>
            </details>
          </>
        ) : (
          <p className="text-[13.5px] text-ink-300">正在汇总…</p>
        )}
      </SectionCard>

      {/* AI 功能 */}
      <SectionCard
        title={
          <>
            <Sparkles size={15} className="text-rose-deep" /> AI 增强
          </>
        }
      >
        {!aiOk && (
          <p className="text-[12.5px] text-ink-500 mb-3 leading-relaxed">{aiDisabledHint(aiConfig)}</p>
        )}
        <div className="grid grid-cols-1 gap-2">
          <button className="btn-ghost justify-start" disabled={!aiOk} onClick={() => setAiOpen(true)}>
            <Sparkles size={16} /> 生成 {RANGE_LABELS[rangeKey]}总结
          </button>
          <button className="btn-ghost justify-start" disabled={!aiOk} onClick={() => setAdviceOpen(true)}>
            <Heart size={16} /> 相处建议（3-5 条，附依据）
          </button>
          <button className="btn-ghost justify-start" disabled={!aiOk} onClick={() => setQueryOpen(true)}>
            <Search size={16} /> 用一句话查记录
          </button>
        </div>
        <p className="mt-3 text-[12px] text-ink-300 leading-relaxed">
          AI 只会读取你在弹窗里勾选的文字内容，照片分析是单独开关、默认关闭。所有结论都会标注引用的记录编号，找不到依据时会直接说「记录不足」。
        </p>
      </SectionCard>

      {/* 历史报告 */}
      <SectionCard title={`历史报告（${summaries?.length ?? 0}）`}>
        {!summaries?.length ? (
          <Empty title="还没有保存过报告" desc="上面的「基础总结」和 AI 总结都可以保存下来，之后随时回看或导出。" />
        ) : (
          <div className="divide-soft">
            {summaries.map((s) => (
              <div key={s.id} className="py-3 first:pt-0 flex items-start gap-2">
                <div className="flex-1 min-w-0">
                  <button className="text-left w-full" onClick={() => setViewing(s)}>
                    <div className="text-[14.5px] text-ink-900">{s.title}</div>
                    <div className="mt-1 flex items-center gap-2 text-[11.5px] text-ink-300 flex-wrap">
                      <Tag color={s.generator === 'ai' ? '#C99BD9' : '#8CBF9B'}>{s.generator === 'ai' ? `AI · ${s.aiMeta?.model ?? ''}` : '手动'}</Tag>
                      <span>{fmtDateTime(s.createdAt)}</span>
                      <span>引用 {s.evidenceEntryIds?.length ?? 0} 条记录</span>
                    </div>
                  </button>
                </div>
                <button
                  className="w-8 h-8 rounded-full flex items-center justify-center text-ink-300 hover:bg-cream-100 shrink-0"
                  onClick={async () => {
                    const ok = await confirm({ title: '删除这份报告？', desc: s.title, danger: true, confirmText: '删除' })
                    if (ok) {
                      await db.summaries.delete(s.id)
                      toast('已删除')
                    }
                  }}
                  aria-label="删除报告"
                >
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      {/* 弹窗 */}
      {aiOpen && data && (
        <AISummaryModal
          onClose={() => setAiOpen(false)}
          data={data}
          start={range.start}
          end={range.end}
          label={RANGE_LABELS[rangeKey]}
          onSaved={() => toast('已保存到历史报告')}
        />
      )}
      {adviceOpen && data && (
        <AIAdviceModal onClose={() => setAdviceOpen(false)} data={data} start={range.start} end={range.end} onSaved={() => toast('建议已保存')} />
      )}
      {queryOpen && data && (
        <AIQueryModal onClose={() => setQueryOpen(false)} data={data} onSaved={() => toast('已保存到历史报告')} />
      )}

      {viewing && (
        <Modal open onClose={() => setViewing(null)} title={viewing.title} full>
          <div className="mb-3 flex items-center gap-2 flex-wrap text-[12px] text-ink-300">
            <Tag color={viewing.generator === 'ai' ? '#C99BD9' : '#8CBF9B'}>{viewing.generator === 'ai' ? 'AI 生成' : '手动汇总'}</Tag>
            <span>{fmtDateTime(viewing.createdAt)}</span>
            <span>
              范围 {toDateStr(viewing.rangeStart)} ~ {toDateStr(viewing.rangeEnd)}
            </span>
          </div>
          <Markdown text={viewing.content} />
        </Modal>
      )}

      {data && <ExportDialog open={exportOpen} onClose={() => setExportOpen(false)} data={data} />}
    </div>
  )
}

function StatBox({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl bg-cream-100 border border-cream-200 px-2.5 py-2 text-center">
      <div className="text-[17px] font-semibold text-ink-900 leading-tight">{value}</div>
      <div className="text-[11px] text-ink-300 mt-0.5">{label}</div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* AI 总结                                                             */
/* ------------------------------------------------------------------ */

function AIOptions({ opts, setOpts }: { opts: AITaskOptions; setOpts: (o: AITaskOptions) => void }) {
  return (
    <div className="rounded-xl bg-cream-100 border border-cream-200 p-3">
      <Switch
        checked={opts.includePrivate}
        onChange={(v) => setOpts({ ...opts, includePrivate: v })}
        label="包含「我的观察」与私人备注"
        desc="关闭后只发送 TA 的原话与客观经过。"
      />
      <Switch
        checked={opts.includeHealth}
        onChange={(v) => setOpts({ ...opts, includeHealth: v })}
        label="包含健康记录"
        desc="默认关闭。健康记录只用于回顾，AI 不会被要求做任何医学推断。"
      />
      <p className="text-[12px] text-ink-300 mt-1">照片分析需要单独开启，当前版本不发送任何图片。</p>
    </div>
  )
}

function AIResultView({ content, cited, gaps }: { content: string; cited: number; gaps?: string }) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-2 text-[12px] text-ink-300">
        <Tag color="#C99BD9">AI 生成</Tag>
        <span>引用 {cited} 条原始记录</span>
      </div>
      <div className="rounded-xl border border-cream-200 bg-white p-3">
        <Markdown text={content} />
      </div>
      <p className="mt-2 text-[12px] text-ink-300 leading-relaxed">
        {gaps || '带 [E编号] 的结论可以回到时间线里核对原始记录。觉得不准确的地方可以直接忽略或修改。'}
      </p>
    </div>
  )
}

function AISummaryModal({
  onClose,
  data,
  start,
  end,
  label,
  onSaved,
}: {
  onClose: () => void
  data: AllData
  start: Date
  end: Date
  label: string
  onSaved: () => void
}) {
  const { aiConfig } = useApp()
  const [opts, setOpts] = useState<AITaskOptions>({ includeHealth: false, includePrivate: true })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [content, setContent] = useState('')
  const [cited, setCited] = useState<string[]>([])

  const run = async () => {
    setBusy(true)
    setErr('')
    setContent('')
    try {
      const kind = label === '本周' || label === '上周' ? 'week' : label === '今年' ? 'year' : 'month'
      const res = await aiPeriodSummary(aiConfig, data, start, end, kind, opts)
      setContent(res.content)
      setCited(res.citedEntryIds)
    } catch (e) {
      setErr((e as Error).message + ((e as { detail?: string })?.detail ? `\n${(e as { detail?: string }).detail}` : ''))
    } finally {
      setBusy(false)
    }
  }

  const save = async () => {
    await db.summaries.put({
      id: `s_${Date.now().toString(36)}`,
      personId: data.person?.id ?? '',
      kind: 'custom',
      title: `${label}总结（AI）· ${toDateStr(start)} ~ ${toDateStr(end)}`,
      rangeStart: start.toISOString(),
      rangeEnd: end.toISOString(),
      content,
      generator: 'ai',
      aiMeta: { model: aiConfig.model, includeHealth: opts.includeHealth, includePrivate: opts.includePrivate, citedEntryIds: cited },
      evidenceEntryIds: cited,
      createdAt: nowISO(),
      updatedAt: nowISO(),
    })
    onSaved()
    onClose()
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`AI ${label}总结`}
      full
      footer={
        content ? (
          <div className="flex gap-2">
            <button className="btn-ghost flex-1" onClick={onClose}>
              关闭
            </button>
            <button className="btn-primary flex-[2]" onClick={save}>
              保存到历史报告
            </button>
          </div>
        ) : undefined
      }
    >
      <div className="space-y-3">
        <AIOptions opts={opts} setOpts={setOpts} />
        <p className="text-[12.5px] text-ink-500">
          将发送 {fmtDate(start)} 至 {fmtDate(end)} 的文字记录。健康记录：{opts.includeHealth ? '包含' : '不包含'} ·
          私人备注：{opts.includePrivate ? '包含' : '不包含'}。
        </p>
        <button className="btn-primary w-full" onClick={run} disabled={busy}>
          {busy ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
          {busy ? '正在整理这段时间…' : content ? '重新生成' : '开始生成'}
        </button>
        {err && <div className="rounded-xl bg-[#FDECEA] border border-[#F5C9C3] p-3 text-[13px] text-[#9B3B2E] whitespace-pre-line">{err}</div>}
        {content && <AIResultView content={content} cited={cited.length} />}
      </div>
    </Modal>
  )
}

function AIAdviceModal({
  onClose,
  data,
  start,
  end,
  onSaved,
}: {
  onClose: () => void
  data: AllData
  start: Date
  end: Date
  onSaved: () => void
}) {
  const { aiConfig } = useApp()
  const [opts, setOpts] = useState<AITaskOptions>({ includeHealth: false, includePrivate: true })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [content, setContent] = useState('')
  const [cited, setCited] = useState<string[]>([])

  const run = async () => {
    setBusy(true)
    setErr('')
    try {
      const res = await aiAdvice(aiConfig, data, start, end, opts)
      setContent(res.content)
      setCited(res.citedEntryIds)
    } catch (e) {
      setErr((e as Error).message + ((e as { detail?: string })?.detail ? `\n${(e as { detail?: string }).detail}` : ''))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="相处建议"
      full
      footer={
        content ? (
          <div className="flex gap-2">
            <button className="btn-ghost flex-1" onClick={onClose}>
              关闭
            </button>
            <button
              className="btn-primary flex-[2]"
              onClick={async () => {
                await db.summaries.put({
                  id: `s_${Date.now().toString(36)}`,
                  personId: data.person?.id ?? '',
                  kind: 'advice',
                  title: `相处建议 · ${toDateStr(new Date())}`,
                  rangeStart: start.toISOString(),
                  rangeEnd: end.toISOString(),
                  content,
                  generator: 'ai',
                  aiMeta: { model: aiConfig.model, includeHealth: opts.includeHealth, includePrivate: opts.includePrivate, citedEntryIds: cited },
                  evidenceEntryIds: cited,
                  createdAt: nowISO(),
                  updatedAt: nowISO(),
                })
                onSaved()
                onClose()
              }}
            >
              保存
            </button>
          </div>
        ) : undefined
      }
    >
      <div className="space-y-3">
        <div className="rounded-xl bg-cream-100 border border-cream-200 p-3 text-[12.5px] text-ink-500 leading-relaxed">
          建议会严格基于明确记录给出，并注明依据。它不会替你做决定，也不会评判任何一方。
        </div>
        <AIOptions opts={opts} setOpts={setOpts} />
        <button className="btn-primary w-full" onClick={run} disabled={busy}>
          {busy ? <Loader2 size={16} className="animate-spin" /> : <Heart size={16} />}
          {busy ? '正在阅读记录…' : content ? '重新生成' : '生成建议'}
        </button>
        {err && <div className="rounded-xl bg-[#FDECEA] border border-[#F5C9C3] p-3 text-[13px] text-[#9B3B2E] whitespace-pre-line">{err}</div>}
        {content && <AIResultView content={content} cited={cited.length} />}
      </div>
    </Modal>
  )
}

function AIQueryModal({
  onClose,
  data,
  onSaved,
}: {
  onClose: () => void
  data: AllData
  onSaved: () => void
}) {
  const { aiConfig } = useApp()
  const aiOk = useAIReady()
  const toast = useToast()
  const [q, setQ] = useState('')
  const [opts, setOpts] = useState<AITaskOptions>({ includeHealth: false, includePrivate: true })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [content, setContent] = useState('')
  const [localHits, setLocalHits] = useState<SearchHit[] | null>(null)

  const runLocal = () => {
    if (!q.trim()) return
    const hits = searchLocal(
      {
        entries: data.entries,
        preferences: data.preferences,
        wishes: data.wishes,
        gifts: data.gifts,
        health: opts.includeHealth ? data.health : [],
        statuses: data.statuses,
        insights: data.insights,
        photos: data.photos,
      },
      q,
      20,
    )
    setLocalHits(hits)
  }

  const runAI = async () => {
    if (!q.trim()) return
    setBusy(true)
    setErr('')
    setContent('')
    try {
      const res = await aiNaturalQuery(aiConfig, data, q, opts)
      setContent(res.content)
    } catch (e) {
      setErr((e as Error).message + ((e as { detail?: string })?.detail ? `\n${(e as { detail?: string }).detail}` : ''))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="用一句话查记录"
      full
      footer={
        content ? (
          <button
            className="btn-primary w-full"
            onClick={async () => {
              await db.summaries.put({
                id: `s_${Date.now().toString(36)}`,
                personId: data.person?.id ?? '',
                kind: 'query',
                title: `查询：${q.slice(0, 24)}`,
                rangeStart: new Date(2000, 0, 1).toISOString(),
                rangeEnd: new Date().toISOString(),
                content,
                generator: 'ai',
                aiMeta: { model: aiConfig.model, includeHealth: opts.includeHealth, includePrivate: opts.includePrivate, citedEntryIds: [], query: q },
                evidenceEntryIds: [],
                createdAt: nowISO(),
                updatedAt: nowISO(),
              })
              onSaved()
              onClose()
            }}
          >
            保存结果
          </button>
        ) : undefined
      }
    >
      <div className="space-y-3">
        <Field label="想问什么">
          <input
            className="input"
            placeholder="例：TA 之前提过想玩什么游戏？"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            style={{ fontSize: 16 }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') runLocal()
            }}
          />
        </Field>
        <div className="flex gap-2">
          <button className="btn-ghost flex-1" onClick={runLocal} disabled={!q.trim()}>
            <Search size={15} /> 本地检索
          </button>
          <button className="btn-primary flex-1" onClick={runAI} disabled={!q.trim() || busy || !aiOk}>
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />} AI 回答
          </button>
        </div>

        <AIOptions opts={opts} setOpts={setOpts} />

        {err && <div className="rounded-xl bg-[#FDECEA] border border-[#F5C9C3] p-3 text-[13px] text-[#9B3B2E] whitespace-pre-line">{err}</div>}

        {content && <AIResultView content={content} cited={0} />}

        {localHits && (
          <div>
            <div className="section-title">本地检索到 {localHits.length} 条（不联网，结果来自你自己的记录）</div>
            {localHits.length === 0 ? (
              <p className="text-[13px] text-ink-300">没有找到相关记录。可以换个说法，或者先去补充记录。</p>
            ) : (
              <div className="space-y-2">
                {localHits.map((h) => (
                  <div key={`${h.kind}-${h.id}`} className="rounded-xl border border-cream-200 bg-white p-3">
                    <div className="flex items-center gap-2">
                      <Tag color={h.kind === 'entry' ? '#8CBF9B' : h.kind === 'preference' ? '#8CA3D9' : '#E9B44C'}>
                        {h.kind === 'entry'
                          ? '事件'
                          : h.kind === 'preference'
                            ? '偏好'
                            : h.kind === 'wish'
                              ? '愿望'
                              : h.kind === 'gift'
                                ? '礼物'
                                : h.kind === 'health'
                                  ? '健康'
                                  : h.kind === 'insight'
                                    ? '画像'
                                    : h.kind === 'photo'
                                      ? '照片'
                                      : '每日状态'}
                      </Tag>
                      <span className="text-[14px] text-ink-900 flex-1 min-w-0 truncate">{h.title}</span>
                    </div>
                    {h.snippet && <p className="mt-1 text-[12.5px] text-ink-500 line-clamp-2">{h.snippet}</p>}
                    <p className="mt-1 text-[11.5px] text-ink-300">{fmtDate(h.at)}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <p className="text-[12px] text-ink-300 leading-relaxed">
          本地检索完全离线，可随时使用；AI 回答会联网，并只发送你勾选的内容。
        </p>
      </div>
    </Modal>
  )
}
