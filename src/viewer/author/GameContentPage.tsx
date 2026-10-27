import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, CircleCheck, CircleOff, Pencil, Plus, Trash2 } from 'lucide-react'
import { db, nowISO, uid } from '../../db/db'
import type { Entry, GameContent, GameContentKind, Photo } from '../../db/types'
import { useAuthorReload } from './AuthorReload'
import { useConfirm, useToast } from '../../components/ui'
import { GAME_CONTENT_SCHEMA_VERSION, gameContentKindLabel, validateGameContent } from '../../lib/gameContent'

interface Draft {
  id?: string
  kind: 'quiz' | 'dateCard'
  enabled: boolean
  prompt: string
  options: { id: string; text: string }[]
  correctOptionId: string
  explanation: string
  photoId: string
  sourceEntryId: string
  category: 'activity' | 'place' | 'surprise'
  text: string
  tags: string
}

const blankDraft = (kind: 'quiz' | 'dateCard'): Draft => ({
  kind,
  enabled: true,
  prompt: '',
  options: [
    { id: `opt_${Date.now().toString(36)}_a`, text: '' },
    { id: `opt_${Date.now().toString(36)}_b`, text: '' },
  ],
  correctOptionId: `opt_${Date.now().toString(36)}_a`,
  explanation: '',
  photoId: '',
  sourceEntryId: '',
  category: 'activity',
  text: '',
  tags: '',
})

function fromRow(row: GameContent): Draft {
  return {
    id: row.id,
    kind: row.kind === 'dateCard' ? 'dateCard' : 'quiz',
    enabled: row.enabled !== false,
    prompt: row.prompt ?? '',
    options: (row.options ?? []).map((option) => ({ id: option.id, text: option.text })),
    correctOptionId: row.correctOptionId ?? '',
    explanation: row.explanation ?? '',
    photoId: row.photoId ?? '',
    sourceEntryId: row.sourceEntryIds?.[0] ?? '',
    category: row.category ?? 'activity',
    text: row.text ?? '',
    tags: (row.tags ?? []).join('，'),
  }
}

export default function GameContentPage() {
  const toast = useToast()
  const confirm = useConfirm()
  const reloadAuthor = useAuthorReload()
  const [rows, setRows] = useState<GameContent[]>([])
  const [entries, setEntries] = useState<Entry[]>([])
  const [photos, setPhotos] = useState<Photo[]>([])
  const [personId, setPersonId] = useState('')
  const [draft, setDraft] = useState<Draft | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    const [content, entryRows, photoRows, persons] = await Promise.all([
      db.gameContent.toArray(),
      db.entries.toArray(),
      db.photos.toArray(),
      db.persons.toArray(),
    ])
    setRows(content.sort((a, b) => a.kind.localeCompare(b.kind) || b.updatedAt.localeCompare(a.updatedAt)))
    setEntries(entryRows.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)))
    setPhotos(photoRows.sort((a, b) => (b.takenAt ?? '').localeCompare(a.takenAt ?? '')))
    setPersonId((persons.find((p) => p.isActive) ?? persons[0])?.id ?? '')
  }, [])

  useEffect(() => {
    void load().finally(() => setLoading(false))
  }, [load])

  const context = useMemo(() => ({
    entryIds: new Set(entries.map((entry) => entry.id)),
    photoIds: new Set(photos.map((photo) => photo.id)),
  }), [entries, photos])

  const draftErrors = useMemo(() => {
    if (!draft || !personId) return []
    return validateGameContent(toRow(draft, personId, rows.find((row) => row.id === draft.id)), context)
  }, [draft, personId, rows, context])

  const save = async () => {
    if (!draft || !personId) return
    const existing = rows.find((row) => row.id === draft.id)
    const row = toRow(draft, personId, existing)
    const errors = validateGameContent(row, context)
    if (errors.length) return
    await db.gameContent.put(row)
    setDraft(null)
    await load()
    await reloadAuthor?.()
    toast(existing ? '互动内容已保存' : '互动内容已创建')
  }

  const toggle = async (row: GameContent) => {
    await db.gameContent.put({ ...row, enabled: !row.enabled, updatedAt: nowISO() })
    await load()
    await reloadAuthor?.()
  }

  const remove = async (row: GameContent) => {
    const ok = await confirm({
      title: '删除这条互动内容？',
      desc: '删除会进入同步墓碑；如果已经发布过，需要重新发布才会从访客端移除。',
      confirmText: '删除',
      danger: true,
    })
    if (!ok) return
    await db.gameContent.delete(row.id)
    await load()
    await reloadAuthor?.()
    toast('已删除')
  }

  const quizRows = rows.filter((row) => row.kind === 'quiz')
  const cardRows = rows.filter((row) => row.kind === 'dateCard')

  return (
    <div className="mx-auto max-w-[860px] space-y-4 pb-8">
      <header className="flex items-start justify-between gap-3 px-1">
        <div>
          <Link to="/settings" className="inline-flex min-h-11 items-center gap-1.5 text-[12px] text-ink-500 hover:text-rose-deep">
            <ArrowLeft size={14} /> 返回设置
          </Link>
          <h1 className="mt-1 text-[20px] font-semibold text-ink-900">互动内容</h1>
          <p className="mt-1 max-w-[620px] text-[12px] leading-relaxed text-ink-500">
            管理「关于他的五道题」和「今天一起做什么」的内容。保存只写入作者数据；要点一次「发布到展示端」，访客才能看到更新。
          </p>
        </div>
      </header>

      <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-[12px] leading-relaxed text-amber-800">
        题目、答案、说明和抽卡内容发布后都可被访客读取。请不要填写不适合公开的细节；来源记录也必须属于本次发布内容。
      </div>

      {loading ? (
        <div className="rounded-2xl border border-cream-200 bg-white/70 px-4 py-10 text-center text-[12px] text-ink-400">正在读取互动内容…</div>
      ) : (
        <>
          <ContentSection
            title="关于他的五道题"
            count={quizRows.length}
            action={() => setDraft(blankDraft('quiz'))}
            rows={quizRows}
            context={context}
            onEdit={(row) => setDraft(fromRow(row))}
            onToggle={toggle}
            onDelete={remove}
          />
          <ContentSection
            title="今天一起做什么"
            count={cardRows.length}
            action={() => setDraft(blankDraft('dateCard'))}
            rows={cardRows}
            context={context}
            onEdit={(row) => setDraft(fromRow(row))}
            onToggle={toggle}
            onDelete={remove}
          />
        </>
      )}

      {draft && (
        <div className="fixed inset-0 z-[70] overflow-y-auto bg-ink-900/35 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="编辑互动内容">
          <div className="mx-auto my-8 max-w-[640px] rounded-3xl bg-[#FFFCF8] p-5 shadow-xl">
            <h2 className="text-[17px] font-semibold text-ink-900">{draft.id ? '编辑' : '新增'}{gameContentKindLabel(draft.kind)}</h2>
            <div className="mt-4 space-y-4">
              {draft.kind === 'quiz' ? (
                <QuizEditor draft={draft} setDraft={setDraft} entries={entries} photos={photos} />
              ) : (
                <DateCardEditor draft={draft} setDraft={setDraft} />
              )}
              <label className="flex items-center gap-2 text-[13px] text-ink-700">
                <input type="checkbox" checked={draft.enabled} onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })} />
                保存后允许进入发布候选
              </label>
              {draftErrors.length > 0 && (
                <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] leading-relaxed text-rose-700">
                  {draftErrors.map((error, index) => <div key={`${index}-${error}`}>{error}</div>)}
                </div>
              )}
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setDraft(null)} className="btn-ghost min-h-11 px-4 text-[12px]">取消</button>
                <button type="button" onClick={() => void save()} disabled={draftErrors.length > 0} className="btn-primary min-h-11 px-4 text-[12px] disabled:opacity-40">保存</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function toRow(draft: Draft, personId: string, existing?: GameContent): GameContent {
  const now = nowISO()
  const common = {
    id: draft.id ?? uid('gc_'),
    personId,
    kind: draft.kind,
    schemaVersion: GAME_CONTENT_SCHEMA_VERSION,
    enabled: draft.enabled,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  }
  if (draft.kind === 'quiz') {
    return {
      ...common,
      kind: 'quiz',
      prompt: draft.prompt.trim(),
      options: draft.options.map((option) => ({ id: option.id, text: option.text.trim() })),
      correctOptionId: draft.correctOptionId,
      explanation: draft.explanation.trim() || undefined,
      photoId: draft.photoId || undefined,
      sourceEntryIds: draft.sourceEntryId ? [draft.sourceEntryId] : [],
    }
  }
  return {
    ...common,
    kind: 'dateCard',
    category: draft.category,
    text: draft.text.trim(),
    tags: draft.tags.split(/[，,\s]+/).map((tag) => tag.trim()).filter(Boolean),
  }
}

function ContentSection({
  title,
  count,
  action,
  rows,
  context,
  onEdit,
  onToggle,
  onDelete,
}: {
  title: string
  count: number
  action: () => void
  rows: GameContent[]
  context: { entryIds: Set<string>; photoIds: Set<string> }
  onEdit: (row: GameContent) => void
  onToggle: (row: GameContent) => void
  onDelete: (row: GameContent) => void
}) {
  return (
    <section className="rounded-2xl border border-cream-200 bg-white/75 p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-semibold text-ink-900">{title}</h2>
          <p className="mt-0.5 text-[11.5px] text-ink-500">共 {count} 条；停用不会删除内容</p>
        </div>
        <button type="button" onClick={action} className="btn-primary inline-flex min-h-11 items-center gap-1.5 px-3 text-[12px]">
          <Plus size={14} /> 新增
        </button>
      </div>
      <div className="mt-3 space-y-2">
        {rows.length === 0 ? (
          <div className="rounded-xl border border-dashed border-cream-300 px-3 py-6 text-center text-[12px] text-ink-400">还没有内容</div>
        ) : rows.map((row) => {
          const errors = validateGameContent(row, context)
          return (
            <article key={row.id} className="rounded-xl border border-cream-200 bg-white px-3 py-2.5">
              <div className="flex items-start gap-3">
                <span className={`mt-1 ${row.enabled ? 'text-emerald-600' : 'text-ink-300'}`}>{row.enabled ? <CircleCheck size={16} /> : <CircleOff size={16} />}</span>
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-medium text-ink-900">{row.prompt || row.text || row.title || row.id}</div>
                  <div className="mt-1 text-[11px] text-ink-400">
                    {row.kind === 'quiz' ? `${row.options?.length ?? 0} 个选项` : `${row.category === 'activity' ? '活动' : row.category === 'place' ? '地点类型' : '小彩蛋'} · ${(row.tags ?? []).join(' / ') || '无标签'}`}
                  </div>
                  {errors.length > 0 && <div className="mt-1 text-[11px] text-rose-700">{errors[0]}</div>}
                </div>
                <div className="flex shrink-0 gap-1">
                  <button type="button" onClick={() => onToggle(row)} className="btn-ghost min-h-11 px-2 text-[11.5px]">{row.enabled ? '停用' : '启用'}</button>
                  <button type="button" onClick={() => onEdit(row)} aria-label="编辑" className="btn-ghost min-h-11 px-2"><Pencil size={14} /></button>
                  <button type="button" onClick={() => onDelete(row)} aria-label="删除" className="btn-ghost min-h-11 px-2 text-rose-700"><Trash2 size={14} /></button>
                </div>
              </div>
            </article>
          )
        })}
      </div>
    </section>
  )
}

function QuizEditor({ draft, setDraft, entries, photos }: { draft: Draft; setDraft: (draft: Draft) => void; entries: Entry[]; photos: Photo[] }) {
  const updateOption = (index: number, text: string) => {
    const options = [...draft.options]
    options[index] = { ...options[index], text }
    setDraft({ ...draft, options })
  }
  return (
    <>
      <label className="block text-[12px] font-medium text-ink-700">题干（120 字内）
        <textarea value={draft.prompt} onChange={(event) => setDraft({ ...draft, prompt: event.target.value })} rows={3} className="mt-1 w-full rounded-xl border border-cream-300 bg-white px-3 py-2 text-[13px]" placeholder="例如：他最怕哪种天气？" />
      </label>
      <div className="space-y-2">
        <div className="text-[12px] font-medium text-ink-700">选项（2～4 个，选择正确答案）</div>
        {draft.options.map((option, index) => (
          <div key={option.id} className="flex items-center gap-2">
            <input type="radio" name="correct" checked={draft.correctOptionId === option.id} onChange={() => setDraft({ ...draft, correctOptionId: option.id })} aria-label={`选项 ${index + 1} 为正确答案`} />
            <input value={option.text} onChange={(event) => updateOption(index, event.target.value)} placeholder={`选项 ${index + 1}`} className="min-h-11 flex-1 rounded-xl border border-cream-300 bg-white px-3 text-[13px]" />
            {draft.options.length > 2 && <button type="button" onClick={() => {
              const options = draft.options.filter((_, i) => i !== index)
              setDraft({ ...draft, options, correctOptionId: draft.correctOptionId === option.id ? options[0]?.id ?? '' : draft.correctOptionId })
            }} className="btn-ghost min-h-11 px-2">删除</button>}
          </div>
        ))}
        {draft.options.length < 4 && <button type="button" onClick={() => setDraft({ ...draft, options: [...draft.options, { id: uid('opt_'), text: '' }] })} className="btn-ghost min-h-11 px-3 text-[12px]">添加选项</button>}
      </div>
      <label className="block text-[12px] font-medium text-ink-700">答对后的说明（可选，300 字内）
        <textarea value={draft.explanation} onChange={(event) => setDraft({ ...draft, explanation: event.target.value })} rows={2} className="mt-1 w-full rounded-xl border border-cream-300 bg-white px-3 py-2 text-[13px]" />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-[12px] font-medium text-ink-700">来源记录（可选）
          <select value={draft.sourceEntryId} onChange={(event) => setDraft({ ...draft, sourceEntryId: event.target.value })} className="mt-1 min-h-11 w-full rounded-xl border border-cream-300 bg-white px-3 text-[13px]">
            <option value="">不关联记录</option>
            {entries.map((entry) => <option key={entry.id} value={entry.id}>{entry.title}</option>)}
          </select>
        </label>
        <label className="block text-[12px] font-medium text-ink-700">配图（可选）
          <select value={draft.photoId} onChange={(event) => setDraft({ ...draft, photoId: event.target.value })} className="mt-1 min-h-11 w-full rounded-xl border border-cream-300 bg-white px-3 text-[13px]">
            <option value="">不使用照片</option>
            {photos.map((photo) => <option key={photo.id} value={photo.id}>{photo.caption || photo.id}</option>)}
          </select>
        </label>
      </div>
    </>
  )
}

function DateCardEditor({ draft, setDraft }: { draft: Draft; setDraft: (draft: Draft) => void }) {
  return (
    <>
      <label className="block text-[12px] font-medium text-ink-700">类别
        <select value={draft.category} onChange={(event) => setDraft({ ...draft, category: event.target.value as Draft['category'] })} className="mt-1 min-h-11 w-full rounded-xl border border-cream-300 bg-white px-3 text-[13px]">
          <option value="activity">活动</option>
          <option value="place">地点类型</option>
          <option value="surprise">小彩蛋</option>
        </select>
      </label>
      <label className="block text-[12px] font-medium text-ink-700">内容（80 字内）
        <textarea value={draft.text} onChange={(event) => setDraft({ ...draft, text: event.target.value })} rows={3} className="mt-1 w-full rounded-xl border border-cream-300 bg-white px-3 py-2 text-[13px]" placeholder="例如：一起做一顿不需要出门的晚餐" />
      </label>
      <label className="block text-[12px] font-medium text-ink-700">标签（用逗号分隔）
        <input value={draft.tags} onChange={(event) => setDraft({ ...draft, tags: event.target.value })} className="mt-1 min-h-11 w-full rounded-xl border border-cream-300 bg-white px-3 text-[13px]" placeholder="setting:indoor, budget:free, duration:short" />
      </label>
      <p className="text-[11.5px] leading-relaxed text-ink-400">筛选使用 `setting:indoor/outdoor`、`duration:short/halfDay/day`、`budget:free/low/medium/high`；标签也会用于规则匹配。</p>
    </>
  )
}
