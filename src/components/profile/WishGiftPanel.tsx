import { useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Gift as GiftIcon, ImagePlus, Loader2, Pencil, Plus, Sparkles, Trash2 } from 'lucide-react'
import { db, giftRepo, nowISO, wishRepo } from '../../db/db'
import type { Gift, Wish, WishStatus } from '../../db/types'
import { WISH_STATUS } from '../../lib/constants'
import { fmtDate, toDateStr } from '../../lib/date'
import { addPhotoFiles } from '../../lib/photo'
import { aiGiftSuggestions, aiReady } from '../../lib/ai'
import { loadAllData } from '../../lib/exporter'
import { Chips, Empty, Field, Markdown, Modal, PhotoImg, Segmented, Switch, Tag, useConfirm, useToast } from '../ui'
import { useApp } from '../../state/app'

/* ------------------------------------------------------------------ */
/* 愿望                                                                */
/* ------------------------------------------------------------------ */

export function WishPanel({ personId }: { personId: string }) {
  const toast = useToast()
  const confirm = useConfirm()
  const [editing, setEditing] = useState<Wish | null>(null)
  const [open, setOpen] = useState(false)
  const [filter, setFilter] = useState<'all' | WishStatus>('all')

  const list = useLiveQuery(
    async () => (await db.wishes.where('personId').equals(personId).toArray()).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)),
    [personId],
  )

  const filtered = useMemo(() => (list ?? []).filter((w) => filter === 'all' || w.status === filter), [list, filter])

  const remove = async (w: Wish) => {
    const ok = await confirm({ title: '删除这个愿望？', desc: w.content, danger: true, confirmText: '删除' })
    if (!ok) return
    await wishRepo.remove(w.id)
    toast('已删除')
  }

  const markGifted = async (w: Wish) => {
    await wishRepo.update(w.id, { status: 'gifted' })
    toast('已标记为「已送出」，可以在礼物页补充细节')
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="flex-1 overflow-x-auto no-scrollbar">
          <Segmented
            options={[
              { value: 'all', label: '全部' },
              ...WISH_STATUS.map((s) => ({ value: s.value, label: s.label })),
            ]}
            value={filter}
            onChange={(v) => setFilter(v as typeof filter)}
          />
        </div>
        <button
          className="btn-primary !px-3 shrink-0"
          onClick={() => {
            setEditing(null)
            setOpen(true)
          }}
          aria-label="新增愿望"
        >
          <Plus size={17} />
        </button>
      </div>

      {filtered.length === 0 ? (
        <Empty
          title="还没有愿望记录"
          desc={'TA 随口提到的想要的东西，记下来最有用。\n比如「想去看一次海」「想要一个降噪耳机」。'}
        />
      ) : (
        <div className="space-y-2.5">
          {filtered.map((w) => {
            const st = WISH_STATUS.find((s) => s.value === w.status)!
            return (
              <div key={w.id} className="card card-pad">
                <div className="flex items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-[15.5px] leading-snug ${w.status === 'fulfilled' ? 'text-ink-300 line-through' : 'text-ink-900'}`}>
                        {w.content}
                      </span>
                      <Tag color={st.color}>{st.label}</Tag>
                      {w.priority === 1 && <Tag color="#D9705F">优先</Tag>}
                    </div>
                    <div className="mt-1.5 flex items-center gap-2 text-[11.5px] text-ink-300 flex-wrap">
                      {w.raisedAt && <span>提出于 {fmtDate(w.raisedAt)}</span>}
                      {w.occasion && <span>· {w.occasion}</span>}
                    </div>
                    {w.note && <p className="mt-1.5 text-[13px] text-ink-500 leading-snug">{w.note}</p>}
                  </div>
                  <div className="flex gap-0.5 shrink-0">
                    <button
                      className="w-8 h-8 rounded-full flex items-center justify-center text-ink-300 hover:bg-cream-100"
                      onClick={() => {
                        setEditing(w)
                        setOpen(true)
                      }}
                      aria-label="编辑"
                    >
                      <Pencil size={15} />
                    </button>
                    <button
                      className="w-8 h-8 rounded-full flex items-center justify-center text-ink-300 hover:bg-cream-100"
                      onClick={() => remove(w)}
                      aria-label="删除"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
                {w.status === 'wish' && (
                  <div className="mt-2.5 flex gap-2">
                    <button className="btn-ghost !py-1.5 !px-3 text-[13px]" onClick={() => markGifted(w)}>
                      <GiftIcon size={14} /> 已送出
                    </button>
                    <button
                      className="btn-ghost !py-1.5 !px-3 text-[13px]"
                      onClick={async () => {
                        await wishRepo.update(w.id, { status: 'fulfilled' })
                        toast('标记为已实现')
                      }}
                    >
                      已实现
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      <WishEditor key={editing?.id ?? 'new'} open={open} onClose={() => setOpen(false)} personId={personId} wish={editing} />

      <GiftAdvisor personId={personId} wishes={list ?? []} />
    </div>
  )
}

function GiftAdvisor({ personId, wishes }: { personId: string; wishes: Wish[] }) {
  const { aiConfig } = useApp()
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [budget, setBudget] = useState('500 元以内')
  const [occasion, setOccasion] = useState('生日')
  const [result, setResult] = useState('')
  const [err, setErr] = useState('')

  const run = async () => {
    setBusy(true)
    setErr('')
    setResult('')
    try {
      const data = await loadAllData(personId)
      const res = await aiGiftSuggestions(aiConfig, data, budget, occasion, { includeHealth: false, includePrivate: false })
      setResult(res.content)
      await db.summaries.put({
        id: `s_${Date.now().toString(36)}`,
        personId,
        kind: 'gift',
        title: `礼物建议 · ${occasion} · ${budget}`,
        rangeStart: new Date(2000, 0, 1).toISOString(),
        rangeEnd: new Date().toISOString(),
        content: res.content,
        generator: 'ai',
        aiMeta: { model: aiConfig.model, includeHealth: false, includePrivate: false, citedEntryIds: res.citedEntryIds },
        evidenceEntryIds: res.citedEntryIds,
        createdAt: nowISO(),
        updatedAt: nowISO(),
      })
    } catch (e) {
      setErr((e as Error).message + ((e as { detail?: string }).detail ? `\n${(e as { detail?: string }).detail}` : ''))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button
        className="btn-ghost w-full"
        onClick={() => {
          setOpen(true)
          if (!aiReady(aiConfig)) toast('请先在设置里配置 AI', 'info')
        }}
      >
        <Sparkles size={15} /> 让 AI 结合愿望和送礼历史给点建议
      </button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="礼物建议"
        full
        footer={
          result ? (
            <button className="btn-primary w-full" onClick={() => setOpen(false)}>
              完成
            </button>
          ) : undefined
        }
      >
        <div className="space-y-3">
          <div className="rounded-xl bg-cream-100 border border-cream-200 p-3 text-[12.5px] text-ink-500 leading-relaxed">
            会发送的资料：愿望清单（{wishes.length} 条）、历史礼物、TA 明确表达过的偏好与相关记录。
            <b className="text-ink-700">不会</b>发送健康记录和「我的观察」。
          </div>
          <Field label="场合">
            <Chips
              options={[
                { value: '生日', label: '生日' },
                { value: '纪念日', label: '纪念日' },
                { value: '节日', label: '节日' },
                { value: '日常惊喜', label: '日常惊喜' },
                { value: '道歉/和好', label: '道歉/和好' },
              ]}
              value={occasion}
              onChange={(v) => setOccasion(v as string)}
            />
          </Field>
          <Field label="预算">
            <Chips
              options={[
                { value: '100 元以内', label: '100 元以内' },
                { value: '500 元以内', label: '500 元以内' },
                { value: '2000 元以内', label: '2000 元以内' },
                { value: '不限', label: '不限' },
              ]}
              value={budget}
              onChange={(v) => setBudget(v as string)}
            />
          </Field>
          <button className="btn-primary w-full" onClick={run} disabled={busy || !aiReady(aiConfig)}>
            {busy ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
            {busy ? '正在挑礼物…' : '开始'}
          </button>
          {!aiReady(aiConfig) && <p className="text-[12.5px] text-ink-300">AI 未配置，此功能暂不可用（其余功能不受影响）。</p>}
          {err && <div className="rounded-xl bg-[#FDECEA] border border-[#F5C9C3] p-3 text-[13px] text-[#9B3B2E] whitespace-pre-line">{err}</div>}
          {result && (
            <div className="card card-pad">
              <Markdown text={result} />
            </div>
          )}
        </div>
      </Modal>
    </>
  )
}

function WishEditor({
  open,
  onClose,
  personId,
  wish,
}: {
  open: boolean
  onClose: () => void
  personId: string
  wish: Wish | null
}) {
  const toast = useToast()
  const [content, setContent] = useState(wish?.content ?? '')
  const [raisedAt, setRaisedAt] = useState(wish?.raisedAt?.slice(0, 10) ?? toDateStr(new Date()))
  const [status, setStatus] = useState<WishStatus>(wish?.status ?? 'wish')
  const [priority, setPriority] = useState<number | undefined>(wish?.priority)
  const [occasion, setOccasion] = useState(wish?.occasion ?? '')
  const [note, setNote] = useState(wish?.note ?? '')

  const save = async () => {
    if (!content.trim()) {
      toast('写一下 TA 想要什么', 'err')
      return
    }
    const data = {
      personId,
      content: content.trim(),
      raisedAt,
      status,
      priority,
      occasion: occasion.trim() || undefined,
      note: note.trim() || undefined,
      entryIds: wish?.entryIds ?? [],
    }
    if (wish) await wishRepo.update(wish.id, data)
    else await wishRepo.create(data)
    toast(wish ? '已更新' : '已添加')
    onClose()
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={wish ? '编辑愿望' : '新的愿望'}
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
      <Field label="TA 想要什么" required>
        <input
          className="input"
          placeholder="例：想去看一次海"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          style={{ fontSize: 16 }}
        />
      </Field>
      <Field label="提出时间" hint="TA 是什么时候提到这件事的">
        <input type="date" className="input" value={raisedAt} onChange={(e) => setRaisedAt(e.target.value)} />
      </Field>
      <Field label="状态">
        <Chips
          options={WISH_STATUS.map((s) => ({ value: s.value, label: s.label }))}
          value={status}
          onChange={(v) => setStatus(v as WishStatus)}
        />
      </Field>
      <Field label="优先级">
        <Chips
          options={[
            { value: '1', label: '很想要' },
            { value: '2', label: '一般' },
            { value: '3', label: '随口一提' },
          ]}
          value={priority ? String(priority) : ''}
          onChange={(v) => setPriority(v ? Number(v) : undefined)}
        />
      </Field>
      <Field label="场合">
        <input
          className="input"
          placeholder="例：生日、纪念日"
          value={occasion}
          onChange={(e) => setOccasion(e.target.value)}
        />
      </Field>
      <Field label="备注" hint="当时的情景、TA 的语气，写下来以后回看更有意思。">
        <textarea className="textarea" rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
    </Modal>
  )
}

/* ------------------------------------------------------------------ */
/* 礼物                                                                */
/* ------------------------------------------------------------------ */

export function GiftPanel({ personId }: { personId: string }) {
  const { prefs } = useApp()
  const toast = useToast()
  const confirm = useConfirm()
  const [editing, setEditing] = useState<Gift | null>(null)
  const [open, setOpen] = useState(false)
  const [pickOwner, setPickOwner] = useState<Gift | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)

  const list = useLiveQuery(
    async () => (await db.gifts.where('personId').equals(personId).toArray()).sort((a, b) => (a.givenAt < b.givenAt ? 1 : -1)),
    [personId],
  )

  const totalAmount = useMemo(() => (list ?? []).reduce((s, g) => s + (g.amount ?? 0), 0), [list])

  const remove = async (g: Gift) => {
    const ok = await confirm({ title: '删除这条礼物记录？', desc: g.name, danger: true, confirmText: '删除' })
    if (!ok) return
    await giftRepo.remove(g.id)
    toast('已删除')
  }

  const addPhotos = async (files: FileList | null) => {
    if (!files?.length || !pickOwner) return
    setBusy(true)
    try {
      const created = await addPhotoFiles(Array.from(files), {
        personId,
        giftId: pickOwner.id,
        keepOriginal: prefs.keepOriginalPhoto,
        photoMaxEdge: prefs.photoMaxEdge,
        thumbMaxEdge: prefs.thumbMaxEdge,
      })
      await giftRepo.update(pickOwner.id, { photoIds: [...(pickOwner.photoIds ?? []), ...created.map((p) => p.id)] })
      toast(`已添加 ${created.length} 张照片`)
      setPickOwner(null)
    } catch (e) {
      toast(`照片添加失败：${(e as Error).message}`, 'err')
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="flex-1 text-[12.5px] text-ink-300 px-1">
          共 {list?.length ?? 0} 份礼物{totalAmount > 0 ? ` · 累计 ¥${totalAmount}` : ''}
        </div>
        <button
          className="btn-primary !px-3 shrink-0"
          onClick={() => {
            setEditing(null)
            setOpen(true)
          }}
          aria-label="新增礼物"
        >
          <Plus size={17} />
        </button>
      </div>

      {!list?.length ? (
        <Empty title="还没有礼物记录" desc="记下送了什么和 TA 的反应，以后准备礼物会轻松很多。" />
      ) : (
        <div className="space-y-2.5">
          {list.map((g) => (
            <div key={g.id} className="card card-pad">
              <div className="flex items-start gap-2">
                <div className="w-9 h-9 rounded-xl bg-[#E9B44C22] flex items-center justify-center shrink-0">🎁</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[15.5px] text-ink-900 font-medium">{g.name}</span>
                    {g.amount ? <Tag color="#8A7D72">¥{g.amount}</Tag> : null}
                  </div>
                  <div className="mt-1 text-[12px] text-ink-300">
                    {fmtDate(g.givenAt)}
                    {g.occasion ? ` · ${g.occasion}` : ''}
                  </div>
                  {g.feedback && <p className="mt-1.5 text-[13px] text-ink-700 leading-snug">TA 的反应：{g.feedback}</p>}
                  {g.note && <p className="mt-1 text-[12.5px] text-ink-500 leading-snug">{g.note}</p>}
                  {(g.photoIds?.length ?? 0) > 0 && (
                    <div className="mt-2 flex gap-2 flex-wrap">
                      {g.photoIds.map((pid) => (
                        <PhotoImg key={pid} photoId={pid} className="w-[68px] h-[68px] rounded-xl object-cover bg-cream-200" />
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex gap-0.5 shrink-0">
                  <button
                    className="w-8 h-8 rounded-full flex items-center justify-center text-ink-300 hover:bg-cream-100"
                    onClick={() => {
                      setPickOwner(g)
                      fileRef.current?.click()
                    }}
                    aria-label="加照片"
                  >
                    <ImagePlus size={15} />
                  </button>
                  <button
                    className="w-8 h-8 rounded-full flex items-center justify-center text-ink-300 hover:bg-cream-100"
                    onClick={() => {
                      setEditing(g)
                      setOpen(true)
                    }}
                    aria-label="编辑"
                  >
                    <Pencil size={15} />
                  </button>
                  <button
                    className="w-8 h-8 rounded-full flex items-center justify-center text-ink-300 hover:bg-cream-100"
                    onClick={() => remove(g)}
                    aria-label="删除"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => addPhotos(e.target.files)} />
      {busy && <p className="text-center text-[12.5px] text-ink-300">正在处理照片…</p>}

      <GiftEditor key={editing?.id ?? 'new'} open={open} onClose={() => setOpen(false)} personId={personId} gift={editing} />
    </div>
  )
}

function GiftEditor({
  open,
  onClose,
  personId,
  gift,
}: {
  open: boolean
  onClose: () => void
  personId: string
  gift: Gift | null
}) {
  const toast = useToast()
  const [name, setName] = useState(gift?.name ?? '')
  const [givenAt, setGivenAt] = useState(gift?.givenAt?.slice(0, 10) ?? toDateStr(new Date()))
  const [occasion, setOccasion] = useState(gift?.occasion ?? '')
  const [feedback, setFeedback] = useState(gift?.feedback ?? '')
  const [note, setNote] = useState(gift?.note ?? '')
  const [amount, setAmount] = useState(gift?.amount ? String(gift.amount) : '')
  const [wishId, setWishId] = useState(gift?.wishId ?? '')

  const wishes = useLiveQuery(
    async () => (await db.wishes.where('personId').equals(personId).toArray()).filter((w) => w.status === 'wish' || w.status === 'gifted'),
    [personId],
  )

  const save = async () => {
    if (!name.trim()) {
      toast('写一下送了什么', 'err')
      return
    }
    const data = {
      personId,
      name: name.trim(),
      givenAt,
      occasion: occasion.trim() || undefined,
      feedback: feedback.trim() || undefined,
      note: note.trim() || undefined,
      amount: amount ? Number(amount) : undefined,
      wishId: wishId || undefined,
      photoIds: gift?.photoIds ?? [],
    }
    if (gift) await giftRepo.update(gift.id, data)
    else await giftRepo.create(data)
    if (wishId) await wishRepo.update(wishId, { status: 'gifted', giftId: gift?.id })
    toast(gift ? '已更新' : '已添加')
    onClose()
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={gift ? '编辑礼物' : '新的礼物'}
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
      <Field label="送了什么" required>
        <input
          className="input"
          placeholder="例：降噪耳机"
          value={name}
          onChange={(e) => setName(e.target.value)}
          style={{ fontSize: 16 }}
        />
      </Field>
      <Field label="赠送日期">
        <input type="date" className="input" value={givenAt} onChange={(e) => setGivenAt(e.target.value)} />
      </Field>
      <Field label="场合">
        <Chips
          options={[
            { value: '生日', label: '生日' },
            { value: '纪念日', label: '纪念日' },
            { value: '节日', label: '节日' },
            { value: '日常惊喜', label: '日常惊喜' },
            { value: '道歉/和好', label: '道歉/和好' },
          ]}
          value={occasion}
          onChange={(v) => setOccasion(v as string)}
        />
      </Field>
      <Field label="TA 的反应">
        <textarea
          className="textarea"
          rows={2}
          placeholder="例：拆开的时候愣了一下，然后一直戴着不肯摘"
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
        />
      </Field>
      <Field label="金额（可选）">
        <input type="number" className="input" placeholder="0" value={amount} onChange={(e) => setAmount(e.target.value)} />
      </Field>
      {wishes && wishes.length > 0 && (
        <Field label="关联愿望（可选）" hint="关联后这个愿望会标记为「已送出」。">
          <select className="input" value={wishId} onChange={(e) => setWishId(e.target.value)}>
            <option value="">不关联</option>
            {wishes.map((w) => (
              <option key={w.id} value={w.id}>
                {w.content}
              </option>
            ))}
          </select>
        </Field>
      )}
      <Field label="备注">
        <textarea className="textarea" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      <Switch checked={false} onChange={() => undefined} label="照片可在列表里点「图片」按钮添加" desc="保存后回到列表，点礼物卡片上的图片按钮即可上传。" />
    </Modal>
  )
}
