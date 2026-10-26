/**
 * T5 回忆录（作者端专属）。
 *
 * 定位：**人工整理**是主线，AI 只是可选草稿。
 * 所以界面顺序也是「先能写，再谈生成」：标题/取材范围 → 章节手写 → 引用记录 → 最后才是 AI 按钮。
 *
 * 两条规则在界面里就能看出来：
 * 1. AI 生成的章节带「AI 草稿」标记，作者一旦改动就变成「已人工修改」；
 *    此后 AI 不会再覆盖它（store 层的 `replaceAiSection` 也会拒绝）。
 * 2. AI 不可用时按钮只是禁用并说明原因，编辑、保存、导出完全不受影响。
 */
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  BookMarked,
  Check,
  Download,
  Loader2,
  Plus,
  Sparkles,
  Trash2,
  Wand2,
  X,
} from 'lucide-react'
import { db } from '../../db/db'
import type { Entry } from '../../db/types'
import { useApp } from '../../state/app'
import { Markdown, Modal, Switch, useConfirm, useToast } from '../../components/ui'
import {
  appendDraft,
  createMemoir,
  deleteMemoir,
  emptySection,
  getMemoir,
  listMemoirs,
  memoirLength,
  removeSection,
  replaceAiSection,
  saveSections,
  sectionLocked,
  updateMemoir,
} from '../../memoir/store'
import { aiMemoirDraft } from '../../memoir/draft'
import type { Memoir, MemoirSection } from '../../memoir/types'
import { aiReady } from '../../lib/ai'
import { exportMarkdownBundle } from '../../lib/markdownBundle'
import { fmtDate, parseAny } from '../../lib/date'

export default function MemoirPage() {
  const nav = useNavigate()
  const { person, aiConfig, cloudUser } = useApp()
  const toast = useToast()
  const confirm = useConfirm()

  const [memoirs, setMemoirs] = useState<Memoir[]>([])
  const [current, setCurrent] = useState<Memoir | undefined>()
  const [entries, setEntries] = useState<Entry[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [preview, setPreview] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerTarget, setPickerTarget] = useState<string>('')
  const [aiBusy, setAiBusy] = useState('')
  const [aiHint, setAiHint] = useState('')
  const [instruction, setInstruction] = useState('')

  const aiUsable = useMemo(() => aiReady(aiConfig, Boolean(cloudUser)), [aiConfig, cloudUser])

  const reload = async (keepId?: string) => {
    if (!person) return
    const list = await listMemoirs(person.id)
    setMemoirs(list)
    const id = keepId ?? current?.id ?? list[0]?.id
    if (id) setCurrent(await getMemoir(id))
    else setCurrent(undefined)
  }

  useEffect(() => {
    let alive = true
    ;(async () => {
      if (!person) {
        setLoading(false)
        return
      }
      const [list, rows] = await Promise.all([listMemoirs(person.id), db.entries.where('personId').equals(person.id).toArray()])
      if (!alive) return
      setMemoirs(list)
      setEntries(rows.sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : -1)))
      setCurrent(list[0])
      setLoading(false)
    })()
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [person?.id])

  /** 取材范围：回忆录设了范围就按范围，否则用全部记录；最多 80 条，避免把整库塞给模型 */
  const scopedEntries = (m: Memoir): Entry[] => {
    const list = entries.filter((e) => {
      if (m.rangeStart && e.occurredAt.slice(0, 10) < m.rangeStart) return false
      if (m.rangeEnd && e.occurredAt.slice(0, 10) > m.rangeEnd) return false
      return true
    })
    return list.slice(0, 80)
  }

  const persist = async (next: Memoir): Promise<Memoir | undefined> => {
    setSaving(true)
    try {
      await updateMemoir(next.id, {
        title: next.title,
        subtitle: next.subtitle,
        rangeStart: next.rangeStart,
        rangeEnd: next.rangeEnd,
        status: next.status,
      })
      const saved = await saveSections(next.id, next.sections)
      if (saved) setCurrent(saved)
      await reload(next.id)
      return saved
    } finally {
      setSaving(false)
    }
  }

  const patchCurrent = (patch: Partial<Memoir>) => setCurrent((c) => (c ? { ...c, ...patch } : c))

  const patchLocalSection = (sectionId: string, patch: Partial<MemoirSection>) =>
    setCurrent((c) =>
      c ? { ...c, sections: c.sections.map((s) => (s.id === sectionId ? { ...s, ...patch } : s)) } : c,
    )

  const doCreate = async () => {
    if (!person) return
    const row = await createMemoir(person.id, { title: '新的回忆录' })
    await reload(row.id)
    toast('已新建回忆录')
  }

  const doDelete = async () => {
    if (!current) return
    const ok = await confirm({
      title: `删除《${current.title}》？`,
      desc: '会同时删除这本回忆录的全部章节。删除会随同步生效（其他设备也会删），但**不会**影响任何记录与照片。',
      danger: true,
      confirmText: '删除',
    })
    if (!ok) return
    await deleteMemoir(current.id)
    setCurrent(undefined)
    await reload()
  }

  const doAddSection = () => {
    if (!current) return
    patchCurrent({ sections: [...current.sections, emptySection({ heading: `第 ${current.sections.length + 1} 章` })] })
  }

  const doSave = async () => {
    if (!current) return
    await persist(current)
    toast('已保存')
  }

  /** 生成一章：已锁定的章节只追加，不覆盖 */
  const doDraft = async (section?: MemoirSection) => {
    if (!current) return
    const scope = section?.entryIds?.length
      ? entries.filter((e) => section.entryIds.includes(e.id))
      : scopedEntries(current)
    if (!scope.length) {
      toast('这段范围里没有记录可引用，先在回忆录里设取材范围或给章节挑几条记录', 'err')
      return
    }
    setAiBusy(section?.id ?? 'new')
    setAiHint('')
    try {
      // 先把当前编辑内容落库，避免 AI 结果覆盖掉未保存的改动
      const saved = await persist(current)
      const base = saved ?? current
      const draft = await aiMemoirDraft({
        memoirTitle: base.title,
        heading: section?.heading ?? `第 ${base.sections.length + 1} 章`,
        entries: scope.map((e) => ({
          id: e.id,
          occurredAt: e.occurredAt,
          title: e.title,
          content: [e.content, e.taSaid ? `TA 说：${e.taSaid}` : '', e.myObservation ? `我的观察：${e.myObservation}` : '']
            .filter(Boolean)
            .join('\n'),
          tags: e.tagList ?? [],
          type: e.type,
        })),
        instruction,
        config: aiConfig,
        cloudSignedIn: Boolean(cloudUser),
      })

      const heading = section?.heading || `第 ${base.sections.length + 1} 章`
      const canReplace = section && section.origin === 'ai' && !sectionLocked(section)
      const res = canReplace
        ? await replaceAiSection(base.id, section.id, draft)
        : await appendDraft(base.id, draft, heading, draft.citedEntryIds)

      if (!res.ok) {
        toast(res.message, 'err')
        return
      }
      if (draft.warnings.length) setAiHint(draft.warnings.join('；'))
      if (res.memoir) setCurrent(res.memoir)
      await reload(base.id)
      toast(canReplace ? '已用新草稿替换这一章' : '已插入一章 AI 草稿，可直接修改')
    } catch (e) {
      toast(`草稿生成失败：${(e as Error).message}`, 'err')
    } finally {
      setAiBusy('')
    }
  }

  const doExportOne = async () => {
    if (!current) return
    await persist(current)
    try {
      const m = await exportMarkdownBundle({ memoirIds: [current.id], includeArchives: false, includeSummaries: false })
      toast(`已导出《${m.counts.memoirs ? current.title : current.title}》与引用的照片`)
    } catch (e) {
      toast(`导出失败：${(e as Error).message}`, 'err')
    }
  }

  if (loading) {
    return <div className="py-16 text-center text-[13px] text-ink-300">正在读取回忆录…</div>
  }

  if (!person) {
    return <div className="py-16 text-center text-[13px] text-ink-400">还没有人物档案，先记点什么再来写回忆录。</div>
  }

  const pickerEntries = current ? scopedEntries(current) : []

  return (
    <div className="space-y-4 pb-6">
      <div className="flex items-center gap-2">
        <button type="button" className="btn-text inline-flex items-center gap-1 px-0 py-0 text-[12.5px]" onClick={() => nav(-1)}>
          <ArrowLeft size={13} /> 返回
        </button>
        <div className="flex-1" />
        <button type="button" className="btn-ghost inline-flex items-center gap-1.5 px-3 py-1.5 text-[12.5px]" onClick={() => void doCreate()}>
          <Plus size={13} /> 新建回忆录
        </button>
      </div>

      <div className="grid gap-4 md:grid-cols-[220px_minmax(0,1fr)]">
        {/* 左侧：回忆录列表 */}
        <aside className="space-y-1.5">
          {memoirs.length === 0 && <p className="text-[12.5px] text-ink-400">还没有回忆录。点右上角新建。</p>}
          {memoirs.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => setCurrent(m)}
              className={`w-full rounded-xl border px-3 py-2 text-left transition ${
                current?.id === m.id ? 'border-rose-soft/60 bg-rose-soft/10' : 'border-cream-200 bg-white hover:bg-cream-50'
              }`}
            >
              <p className="truncate text-[13px] font-medium text-ink-800">{m.title}</p>
              <p className="mt-0.5 text-[11px] text-ink-400">
                {m.sections.length} 章 · {memoirLength(m)} 字 · {m.status === 'final' ? '已定稿' : '草稿'}
              </p>
            </button>
          ))}
        </aside>

        {/* 右侧：编辑区 */}
        {!current ? (
          <div className="rounded-2xl border border-dashed border-cream-300 bg-cream-50/60 px-4 py-16 text-center">
            <BookMarked size={22} className="mx-auto text-rose-soft" />
            <p className="mt-2 text-[13px] text-ink-500">选一本回忆录，或者新建一本开始写。</p>
            <p className="mt-1 text-[11.5px] text-ink-400">回忆录只在自己这里；要给别人看，导出文稿包发出去。</p>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="rounded-2xl border border-cream-200 bg-white px-4 py-3">
              <input
                className="w-full border-0 bg-transparent text-[17px] font-semibold text-ink-900 outline-none placeholder:text-ink-300"
                value={current.title}
                placeholder="回忆录标题"
                onChange={(e) => patchCurrent({ title: e.target.value })}
              />
              <input
                className="mt-1 w-full border-0 bg-transparent text-[12.5px] text-ink-500 outline-none placeholder:text-ink-300"
                value={current.subtitle ?? ''}
                placeholder="副标题（可留空）"
                onChange={(e) => patchCurrent({ subtitle: e.target.value })}
              />
              <div className="mt-2 flex flex-wrap items-center gap-2 text-[11.5px] text-ink-500">
                <span>取材范围</span>
                <input
                  type="date"
                  className="input w-[130px] px-2 py-1 text-[11.5px]"
                  value={current.rangeStart ?? ''}
                  onChange={(e) => patchCurrent({ rangeStart: e.target.value || undefined })}
                />
                <span>~</span>
                <input
                  type="date"
                  className="input w-[130px] px-2 py-1 text-[11.5px]"
                  value={current.rangeEnd ?? ''}
                  onChange={(e) => patchCurrent({ rangeEnd: e.target.value || undefined })}
                />
                <span className="text-ink-400">（留空表示不限；只影响 AI 素材，不影响已写内容）</span>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <button type="button" className="btn-primary inline-flex items-center gap-1.5 px-3 py-1.5 text-[12.5px]" onClick={() => void doSave()} disabled={saving}>
                  {saving ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} 保存
                </button>
                <button type="button" className="btn-ghost inline-flex items-center gap-1.5 px-3 py-1.5 text-[12.5px]" onClick={() => void doExportOne()}>
                  <Download size={13} /> 导出这一本
                </button>
                <button type="button" className="btn-text px-1 py-1 text-[11.5px]" onClick={() => setPreview((v) => !v)}>
                  {preview ? '收起预览' : '预览'}
                </button>
                <Switch
                  checked={current.status === 'final'}
                  onChange={(v) => patchCurrent({ status: v ? 'final' : 'draft' })}
                  label="定稿"
                />
                <div className="flex-1" />
                <button type="button" className="inline-flex items-center gap-1 text-[11.5px] text-[#8E4850] hover:underline" onClick={() => void doDelete()}>
                  <Trash2 size={12} /> 删除这本
                </button>
              </div>
            </div>

            {/* AI 说明与额外要求：不可用时只是提示，不影响手写 */}
            <div className="rounded-2xl border border-cream-200 bg-cream-50 px-4 py-2.5 text-[11.5px] leading-relaxed text-ink-500">
              <div className="flex flex-wrap items-center gap-2">
                <Sparkles size={13} className="text-rose-deep" />
                <span className="font-medium text-ink-700">AI 草稿（可选）</span>
                {!aiUsable && (
                  <span className="text-[#8A6A28]">当前不可用（未配置或未登录）——手写、保存与导出一律不受影响</span>
                )}
              </div>
              <input
                className="input mt-1.5 w-full px-2 py-1 text-[11.5px]"
                placeholder="给模型的额外要求（可留空），例如：写短一点 / 只用这一年的事 / 少用形容词"
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
              />
              {aiHint && <p className="mt-1 text-[#8A6A28]">{aiHint}</p>}
            </div>

            {/* 章节 */}
            {current.sections.map((s, i) => (
              <div key={s.id} className="rounded-2xl border border-cream-200 bg-white px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    className="min-w-0 flex-1 border-0 bg-transparent text-[14px] font-medium text-ink-800 outline-none"
                    value={s.heading}
                    placeholder="章节标题"
                    onChange={(e) => patchLocalSection(s.id, { heading: e.target.value })}
                  />
                  <span
                    className={`rounded-full px-1.5 py-0.5 text-[10.5px] ${
                      s.origin === 'ai' ? 'bg-[#EEF2FB] text-[#4C5F8A]' : 'bg-cream-100 text-ink-500'
                    }`}
                  >
                    {s.origin === 'ai' ? 'AI 草稿' : '手写'}
                  </span>
                  {s.editedAt && <span className="rounded-full bg-[#EEF5EC] px-1.5 py-0.5 text-[10.5px] text-[#4F6B45]">已人工修改</span>}
                  <div className="flex items-center gap-0.5">
                    <button type="button" className="rounded p-1 text-ink-400 hover:bg-cream-100 disabled:opacity-30" disabled={i === 0} onClick={() => void moveLocal(current, s.id, -1, setCurrent)}>
                      <ArrowUp size={12} />
                    </button>
                    <button type="button" className="rounded p-1 text-ink-400 hover:bg-cream-100 disabled:opacity-30" disabled={i === current.sections.length - 1} onClick={() => void moveLocal(current, s.id, 1, setCurrent)}>
                      <ArrowDown size={12} />
                    </button>
                    <button
                      type="button"
                      className="rounded p-1 text-[#8E4850] hover:bg-[#FFF3F1]"
                      onClick={async () => {
                        if (!current) return
                        setCurrent(await removeSection(current.id, s.id))
                      }}
                    >
                      <X size={12} />
                    </button>
                  </div>
                </div>

                <textarea
                  className="mt-2 min-h-[120px] w-full resize-y rounded-xl border border-cream-200 bg-cream-50/60 px-3 py-2 text-[12.5px] leading-relaxed text-ink-700 outline-none focus:border-rose-soft"
                  value={s.body}
                  placeholder="在这里写这一章。想引用具体记录就点下面的「引用记录」，写好后保存。"
                  onChange={(e) => patchLocalSection(s.id, { body: e.target.value })}
                />

                <div className="mt-2 flex flex-wrap items-center gap-2 text-[11.5px]">
                  <button
                    type="button"
                    className="btn-text px-1 py-0.5"
                    onClick={() => {
                      setPickerTarget(s.id)
                      setPickerOpen(true)
                    }}
                  >
                    引用记录（{s.entryIds?.length ?? 0}）
                  </button>
                  {s.citeMap && Object.keys(s.citeMap).length > 0 && <span className="text-ink-400">含 {Object.keys(s.citeMap).length} 条 AI 引用</span>}
                  <div className="flex-1" />
                  <button
                    type="button"
                    className="btn-ghost inline-flex items-center gap-1 px-2 py-1 text-[11.5px]"
                    disabled={!aiUsable || aiBusy === s.id}
                    onClick={() => void doDraft(s)}
                  >
                    {aiBusy === s.id ? <Loader2 size={12} className="animate-spin" /> : <Wand2 size={12} />}
                    {s.origin === 'ai' && !s.editedAt ? '重新生成' : '按这章写草稿'}
                  </button>
                </div>
              </div>
            ))}

            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn-ghost inline-flex items-center gap-1.5 px-3 py-1.5 text-[12.5px]" onClick={doAddSection}>
                <Plus size={13} /> 添加章节
              </button>
              <button
                type="button"
                className="btn-ghost inline-flex items-center gap-1.5 px-3 py-1.5 text-[12.5px]"
                disabled={!aiUsable || aiBusy === 'new'}
                onClick={() => void doDraft()}
              >
                {aiBusy === 'new' ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
                让 AI 写新的一章
              </button>
            </div>

            {preview && (
              <div className="rounded-2xl border border-cream-200 bg-white px-4 py-3">
                <p className="mb-2 text-[11.5px] text-ink-400">预览（只读，未保存的改动也会显示）</p>
                <h2 className="text-[17px] font-semibold text-ink-900">{current.title}</h2>
                {current.subtitle && <p className="mt-0.5 text-[12.5px] text-ink-500">{current.subtitle}</p>}
                {current.sections.map((s) => (
                  <section key={s.id} className="mt-3">
                    <h3 className="text-[14px] font-medium text-ink-800">{s.heading}</h3>
                    <Markdown text={s.body} className="mt-1 text-[12.5px] leading-relaxed text-ink-700" />
                  </section>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* 引用记录选择器 */}
      <Modal open={pickerOpen} onClose={() => setPickerOpen(false)} title="引用这些记录" full>
        <p className="mb-2 text-[11.5px] text-ink-500">
          选中的记录会成为这一章的引用来源：AI 只在这些记录里取素材，导出时也会列出对应链接。
        </p>
        <div className="max-h-[60vh] space-y-1.5 overflow-auto">
          {pickerEntries.length === 0 && <p className="text-[12px] text-ink-400">取材范围里没有记录。</p>}
          {pickerEntries.map((e) => {
            const target = current?.sections.find((s) => s.id === pickerTarget)
            const checked = Boolean(target?.entryIds?.includes(e.id))
            return (
              <button
                key={e.id}
                type="button"
                className={`flex w-full items-start gap-2 rounded-lg border px-2.5 py-1.5 text-left text-[12px] ${
                  checked ? 'border-rose-soft/60 bg-rose-soft/10' : 'border-cream-200 bg-white'
                }`}
                onClick={() => {
                  if (!current) return
                  const ids = new Set(target?.entryIds ?? [])
                  if (checked) ids.delete(e.id)
                  else ids.add(e.id)
                  patchLocalSection(pickerTarget, { entryIds: Array.from(ids) })
                }}
              >
                <span className={`mt-0.5 h-3.5 w-3.5 shrink-0 rounded border ${checked ? 'border-rose-deep bg-rose-deep' : 'border-cream-300'}`} />
                <span className="min-w-0">
                  <span className="block truncate text-ink-800">
                    {fmtDate(parseAny(e.occurredAt))} · {e.title}
                  </span>
                  <span className="block truncate text-[11px] text-ink-400">{e.content?.slice(0, 40) || e.type}</span>
                </span>
              </button>
            )
          })}
        </div>
        <div className="mt-3 flex justify-end">
          <button type="button" className="btn-primary px-3 py-1.5 text-[12.5px]" onClick={() => setPickerOpen(false)}>
            完成
          </button>
        </div>
      </Modal>
    </div>
  )
}

/** 章节上下移动：本地先动，保存时一起落库 */
async function moveLocal(current: Memoir, sectionId: string, dir: -1 | 1, setCurrent: (m: Memoir) => void) {
  const i = current.sections.findIndex((s) => s.id === sectionId)
  const j = i + dir
  if (i < 0 || j < 0 || j >= current.sections.length) return
  const sections = [...current.sections]
  ;[sections[i], sections[j]] = [sections[j], sections[i]]
  setCurrent({ ...current, sections })
}
