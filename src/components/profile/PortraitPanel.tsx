import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Check, Pencil, Plus, Sparkles, Trash2, Wand2, X } from 'lucide-react'
import { db, insightRepo, nowISO } from '../../db/db'
import type { EvidenceType, PortraitInsight } from '../../db/types'
import { EVIDENCE_TYPES, PORTRAIT_DIMENSIONS, evidenceMeta } from '../../lib/constants'
import { fmtDate } from '../../lib/date'
import { aiUpdatePortrait, type PortraitDraft } from '../../lib/ai'
import EvidencePicker from '../EvidencePicker'
import { Chips, Empty, Field, Modal, SectionCard, Segmented, Switch, Tag, useConfirm, useToast } from '../ui'
import { useApp, useAIReady } from '../../state/app'
import { loadAllData } from '../../lib/exporter'

export default function PortraitPanel({ personId }: { personId: string }) {
  const toast = useToast()
  const confirm = useConfirm()
  const { aiConfig } = useApp()
  const aiOk = useAIReady()
  const [editing, setEditing] = useState<PortraitInsight | null>(null)
  const [open, setOpen] = useState(false)
  const [stateFilter, setStateFilter] = useState<'all' | 'pending' | 'confirmed' | 'rejected'>('all')
  const [expanded, setExpanded] = useState<string | null>(null)

  // AI 更新
  const [aiOpen, setAiOpen] = useState(false)
  const [aiBusy, setAiBusy] = useState(false)
  const [aiErr, setAiErr] = useState('')
  const [drafts, setDrafts] = useState<(PortraitDraft & { accepted: boolean })[]>([])
  const [rangeDays, setRangeDays] = useState(30)
  const [includeHealth, setIncludeHealth] = useState(false)
  const [includePrivate, setIncludePrivate] = useState(true)

  const list = useLiveQuery(
    async () => (await db.insights.where('personId').equals(personId).toArray()).sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1)),
    [personId],
  )

  const filtered = useMemo(
    () => (list ?? []).filter((i) => stateFilter === 'all' || i.confirmState === stateFilter),
    [list, stateFilter],
  )

  const groups = useMemo(() => {
    const map = new Map<string, PortraitInsight[]>()
    for (const i of filtered) map.set(i.dimension, [...(map.get(i.dimension) ?? []), i])
    return PORTRAIT_DIMENSIONS.map((d) => ({ ...d, items: map.get(d.label) ?? [] })).filter((g) => g.items.length)
  }, [filtered])

  const setState = async (i: PortraitInsight, state: PortraitInsight['confirmState']) => {
    await insightRepo.update(i.id, { confirmState: state })
    toast(state === 'confirmed' ? '已确认' : state === 'rejected' ? '已否决' : '已置为待确认')
  }

  const remove = async (i: PortraitInsight) => {
    const ok = await confirm({ title: '删除这条画像？', desc: i.description, danger: true, confirmText: '删除' })
    if (!ok) return
    await insightRepo.remove(i.id)
    toast('已删除')
  }

  const runAI = async () => {
    setAiBusy(true)
    setAiErr('')
    try {
      const data = await loadAllData(personId)
      const end = new Date()
      const start = new Date(end.getTime() - rangeDays * 86400000)
      const res = await aiUpdatePortrait(aiConfig, data, start, end, data.insights, { includeHealth, includePrivate })
      if (!res.drafts.length) {
        setAiErr(res.gaps || '这次没有提取到有充分依据的新条目。')
        setDrafts([])
      } else {
        setDrafts(res.drafts.map((d) => ({ ...d, accepted: true })))
      }
    } catch (e) {
      setAiErr((e as Error).message + ((e as { detail?: string }).detail ? `\n${(e as { detail?: string }).detail}` : ''))
    } finally {
      setAiBusy(false)
    }
  }

  const acceptDrafts = async () => {
    const chosen = drafts.filter((d) => d.accepted)
    for (const d of chosen) {
      await insightRepo.create({
        personId,
        dimension: d.dimension,
        description: d.description,
        evidenceType: d.evidenceType,
        evidenceEntryIds: d.evidenceEntryIds,
        confirmState: 'pending',
        userEdited: false,
      })
    }
    toast(`已加入 ${chosen.length} 条待确认画像`)
    setAiOpen(false)
    setDrafts([])
  }

  const pendingCount = (list ?? []).filter((i) => i.confirmState === 'pending').length

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Segmented
          options={[
            { value: 'all', label: '全部' },
            { value: 'pending', label: '待确认' },
            { value: 'confirmed', label: '已确认' },
            { value: 'rejected', label: '已否决' },
          ]}
          value={stateFilter}
          onChange={(v) => setStateFilter(v as typeof stateFilter)}
          className="flex-1 overflow-x-auto"
        />
        <button
          className="btn-primary !px-3 shrink-0"
          onClick={() => {
            setEditing(null)
            setOpen(true)
          }}
          aria-label="新增画像"
        >
          <Plus size={17} />
        </button>
      </div>

      <div className="card card-pad bg-gradient-to-br from-cream-100 to-white">
        <div className="flex items-start gap-3">
          <Wand2 size={18} className="text-rose-deep mt-0.5 shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-[14.5px] font-medium text-ink-900">从记录里更新画像</div>
            <p className="text-[12.5px] text-ink-500 mt-1 leading-relaxed">
              {aiOk
                ? 'AI 只负责「提取」，结论一律先进入「待确认」，你确认后才算数。每条都会标注依据强度和引用记录。'
                : '需要先在「设置 → AI 增强」里配置模型。未配置时，你仍然可以手动添加和编辑画像。'}
            </p>
            <button
              className="btn-primary mt-3 !py-2 !px-3.5 text-[14px]"
              disabled={!aiOk}
              onClick={() => {
                setDrafts([])
                setAiErr('')
                setAiOpen(true)
              }}
            >
              <Sparkles size={15} /> 开始提取
            </button>
            {pendingCount > 0 && (
              <span className="ml-2 text-[12.5px] text-[#A9762C]">有 {pendingCount} 条待确认</span>
            )}
          </div>
        </div>
      </div>

      {groups.length === 0 ? (
        <Empty
          title="还没有画像条目"
          desc={'画像不是猜的，是从一条条记录里长出来的。\n先积累记录，再用 AI 提取，或者手动写下你的观察。'}
        />
      ) : (
        groups.map((g) => (
          <SectionCard key={g.label} title={g.label}>
            <p className="text-[12px] text-ink-300 -mt-1 mb-2">{g.hint}</p>
            <div className="space-y-2.5">
              {g.items.map((i) => {
                const em = evidenceMeta(i.evidenceType)
                return (
                  <div
                    key={i.id}
                    className={`rounded-xl border p-3 ${
                      i.confirmState === 'rejected' ? 'border-cream-200 bg-cream-100 opacity-60' : 'border-cream-200 bg-white'
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      <p className="flex-1 text-[14.5px] text-ink-900 leading-snug">{i.description}</p>
                      <div className="flex gap-0.5 shrink-0">
                        <button
                          className="w-7 h-7 rounded-full flex items-center justify-center text-ink-300 hover:bg-cream-100"
                          onClick={() => {
                            setEditing(i)
                            setOpen(true)
                          }}
                          aria-label="编辑"
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          className="w-7 h-7 rounded-full flex items-center justify-center text-ink-300 hover:bg-cream-100"
                          onClick={() => remove(i)}
                          aria-label="删除"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                    <div className="mt-2 flex items-center gap-2 flex-wrap">
                      <Tag color={em.color}>{em.label}</Tag>
                      <button
                        className="text-[11.5px] text-ink-300 inline-flex items-center gap-1"
                        onClick={() => setExpanded(expanded === i.id ? null : i.id)}
                      >
                        {i.evidenceEntryIds?.length ?? 0} 条引用
                      </button>
                      {i.confirmState === 'pending' && (
                        <div className="ml-auto flex gap-1.5">
                          <button
                            className="inline-flex items-center gap-1 rounded-full bg-[#8CBF9B22] text-[#5E8E6F] px-2.5 py-1 text-[12px]"
                            onClick={() => setState(i, 'confirmed')}
                          >
                            <Check size={12} /> 确认
                          </button>
                          <button
                            className="inline-flex items-center gap-1 rounded-full bg-cream-200 text-ink-500 px-2.5 py-1 text-[12px]"
                            onClick={() => setState(i, 'rejected')}
                          >
                            <X size={12} /> 不准确
                          </button>
                        </div>
                      )}
                      {i.confirmState === 'confirmed' && <span className="ml-auto text-[11.5px] text-[#5E8E6F]">已确认</span>}
                      {i.confirmState === 'rejected' && <span className="ml-auto text-[11.5px] text-ink-300">已否决</span>}
                    </div>
                    {expanded === i.id && <EvidenceList ids={i.evidenceEntryIds ?? []} />}
                  </div>
                )
              })}
            </div>
          </SectionCard>
        ))
      )}

      <PortraitEditor
        key={editing?.id ?? 'new'}
        open={open}
        onClose={() => setOpen(false)}
        personId={personId}
        insight={editing}
      />

      {/* AI 提取面板 */}
      <Modal
        open={aiOpen}
        onClose={() => setAiOpen(false)}
        title="从记录里更新画像"
        full
        footer={
          drafts.length > 0 ? (
            <div className="flex gap-2">
              <button className="btn-ghost flex-1" onClick={() => setAiOpen(false)}>
                取消
              </button>
              <button className="btn-primary flex-[2]" onClick={acceptDrafts} disabled={!drafts.some((d) => d.accepted)}>
                加入 {drafts.filter((d) => d.accepted).length} 条待确认
              </button>
            </div>
          ) : undefined
        }
      >
        <div className="space-y-4">
          <div className="rounded-xl bg-cream-100 border border-cream-200 p-3 space-y-1">
            <Field label="分析范围" className="mb-2">
              <Segmented
                options={[
                  { value: '14', label: '近 14 天' },
                  { value: '30', label: '近 30 天' },
                  { value: '90', label: '近 90 天' },
                  { value: '365', label: '近一年' },
                ]}
                value={String(rangeDays)}
                onChange={(v) => setRangeDays(Number(v))}
              />
            </Field>
            <Switch
              checked={includePrivate}
              onChange={setIncludePrivate}
              label="包含「我的观察」与私人备注"
              desc="关闭后只发送 TA 的原话与客观经过，判断会更保守。"
            />
            <Switch
              checked={includeHealth}
              onChange={setIncludeHealth}
              label="包含健康记录"
              desc="默认不发送。健康记录只用于回顾，AI 不会被要求做任何医学推断。"
            />
          </div>

          <button className="btn-primary w-full" onClick={runAI} disabled={aiBusy}>
            <Sparkles size={16} /> {aiBusy ? '正在分析记录…' : '开始分析'}
          </button>

          {aiErr && (
            <div className="rounded-xl bg-[#FDECEA] border border-[#F5C9C3] p-3 text-[13px] text-[#9B3B2E] whitespace-pre-line">
              {aiErr}
            </div>
          )}

          {drafts.length > 0 && (
            <div>
              <div className="section-title">提取结果（默认全部勾选，逐条确认后再加入）</div>
              <div className="space-y-2">
                {drafts.map((d, idx) => (
                  <div
                    key={idx}
                    className={`rounded-xl border p-3 ${d.accepted ? 'border-rose-soft bg-rose-soft/8' : 'border-cream-200 bg-white'}`}
                  >
                    <div className="flex items-start gap-2">
                      <button
                        className={`w-[18px] h-[18px] rounded-md border flex items-center justify-center shrink-0 mt-0.5 ${
                          d.accepted ? 'bg-rose-deep border-rose-deep text-white' : 'border-cream-300'
                        }`}
                        onClick={() => setDrafts((prev) => prev.map((x, i) => (i === idx ? { ...x, accepted: !x.accepted } : x)))}
                      >
                        {d.accepted && <Check size={12} />}
                      </button>
                      <div className="flex-1 min-w-0">
                        <input
                          className="input !py-1.5 !text-[14px]"
                          value={d.description}
                          onChange={(e) =>
                            setDrafts((prev) => prev.map((x, i) => (i === idx ? { ...x, description: e.target.value } : x)))
                          }
                        />
                        <div className="mt-2 flex items-center gap-2 flex-wrap">
                          <Tag color="#8A7D72">{d.dimension}</Tag>
                          <Tag color={evidenceMeta(d.evidenceType).color}>{evidenceMeta(d.evidenceType).label}</Tag>
                          <span className="text-[11.5px] text-ink-300">{d.evidenceEntryIds.length} 条引用</span>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <p className="mt-3 text-[12px] text-ink-300 leading-relaxed">
                加入后状态是「待确认」。在列表里点「确认」才算数，觉得不准确的可以直接否决。
              </p>
            </div>
          )}
        </div>
      </Modal>
    </div>
  )
}

function EvidenceList({ ids }: { ids: string[] }) {
  const entries = useLiveQuery(async () => (ids.length ? db.entries.bulkGet(ids) : []), [ids.join(',')])
  if (!ids.length) return <p className="mt-2 text-[12px] text-ink-300">没有关联记录。</p>
  return (
    <div className="mt-2 space-y-1.5">
      {(entries ?? []).filter(Boolean).map((e) => (
        <div key={e!.id} className="rounded-lg bg-cream-100 px-2.5 py-1.5 text-[12.5px]">
          <span className="text-ink-300 mr-1.5">{fmtDate(e!.occurredAt)}</span>
          <span className="text-ink-700">{e!.title || '（无标题）'}</span>
          {e!.taSaid && <span className="text-ink-500"> · TA 说：{e!.taSaid}</span>}
        </div>
      ))}
    </div>
  )
}

function PortraitEditor({
  open,
  onClose,
  personId,
  insight,
}: {
  open: boolean
  onClose: () => void
  personId: string
  insight: PortraitInsight | null
}) {
  const toast = useToast()
  const [dimension, setDimension] = useState(insight?.dimension ?? PORTRAIT_DIMENSIONS[0].label)
  const [description, setDescription] = useState(insight?.description ?? '')
  const [evidenceType, setEvidenceType] = useState<EvidenceType>(insight?.evidenceType ?? 'stated')
  const [evidence, setEvidence] = useState<string[]>(insight?.evidenceEntryIds ?? [])
  const [pickerOpen, setPickerOpen] = useState(false)

  const save = async () => {
    if (!description.trim()) {
      toast('写一句具体的描述', 'err')
      return
    }
    const data = {
      personId,
      dimension,
      description: description.trim(),
      evidenceType,
      evidenceEntryIds: evidence,
      confirmState: insight?.confirmState ?? ('confirmed' as const),
      userEdited: true,
    }
    if (insight) await insightRepo.update(insight.id, data)
    else await insightRepo.create(data)
    toast(insight ? '已更新' : '已添加')
    onClose()
  }

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title={insight ? '编辑画像条目' : '新增画像条目'}
        footer={
          <div className="flex gap-2">
            <button className="btn-ghost flex-1" onClick={onClose}>
              取消
            </button>
            <button className="btn-primary flex-[2]" onClick={save}>
              保存
            </button>
          </div>
        }
      >
        <Field label="维度">
          <Chips
            options={PORTRAIT_DIMENSIONS.map((d) => ({ value: d.label, label: d.label }))}
            value={dimension}
            onChange={(v) => setDimension(v as string)}
          />
        </Field>
        <Field label="描述" required hint="一句话，具体到可以核对。不要写「TA 很好」这类无法验证的判断。">
          <textarea
            className="textarea"
            rows={2}
            placeholder="例：压力大的时候更想一个人待着，不太愿意说话"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </Field>
        <Field label="依据强度">
          <div className="space-y-2">
            {EVIDENCE_TYPES.map((e) => (
              <button
                key={e.value}
                className={`w-full text-left rounded-xl border p-3 ${evidenceType === e.value ? 'border-rose-soft bg-rose-soft/8' : 'border-cream-200 bg-white'}`}
                onClick={() => setEvidenceType(e.value)}
              >
                <div className="text-[14px] text-ink-900">{e.label}</div>
                <div className="text-[12px] text-ink-300 mt-0.5">{e.hint}</div>
              </button>
            ))}
          </div>
        </Field>
        <div className="rounded-xl bg-cream-100 border border-cream-200 p-3">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[13px] font-medium text-ink-700">引用记录</span>
            <button className="btn-text" onClick={() => setPickerOpen(true)}>
              {evidence.length ? `已选 ${evidence.length} 条` : '去选择'}
            </button>
          </div>
          {evidence.length > 0 ? <EvidenceList ids={evidence} /> : (
            <p className="text-[12px] text-ink-300">建议至少选 1 条，方便以后回看这条结论是怎么来的。</p>
          )}
        </div>
      </Modal>
      <EvidencePicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        personId={personId}
        selected={evidence}
        onChange={setEvidence}
      />
    </>
  )
}
