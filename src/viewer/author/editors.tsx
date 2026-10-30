/**
 * 作者端编辑组件：直接用本机数据写入，不经过发布快照。
 * 只做展示端界面里的编辑入口，界面风格沿用浏览态（暖色卡片 + 同一套间距）。
 */
import { useEffect, useRef, useState } from 'react'
import { Camera, Pencil, Trash2, Upload } from 'lucide-react'
import { Modal, useToast, useConfirm } from '../../components/ui'
import { db, deletePhotoCascade, entryRepo, savePerson, nowISO, updatePhotoCaption } from '../../db/db'
import { addPhotoFiles } from '../../lib/photo'
import { useApp } from '../../state/app'
import type { Entry, EntryType, Mood, Photo } from '../../db/types'

const KINDS: { key: EntryType; label: string }[] = [
  { key: 'daily', label: '日常' },
  { key: 'date', label: '约会' },
  { key: 'gift', label: '礼物' },
  { key: 'interest', label: '兴趣' },
  { key: 'health', label: '健康' },
  { key: 'emotion', label: '情绪' },
  { key: 'other', label: '其他' },
]

const MOODS: { key: Mood; label: string }[] = [
  { key: 'happy', label: '开心' },
  { key: 'calm', label: '平静' },
  { key: 'low', label: '低落' },
  { key: 'anxious', label: '焦虑' },
  { key: 'angry', label: '生气' },
]

function toLocalInput(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** 编辑时只需要这些字段，访客端的 PublicEntry 也能直接传进来 */
export interface EntrySeed {
  id: string
  title: string
  occurredAt: string
  type: EntryType
  content?: string
  taSaid?: string
  myObservation?: string
  mood?: Mood
  tagList: string[]
  photoIds: string[]
}

export function EntryEditor({
  open,
  entry,
  onClose,
  onSaved,
}: {
  open: boolean
  entry?: EntrySeed
  onClose: () => void
  onSaved: () => void
}) {
  const { person } = useApp()
  const toast = useToast()
  const [title, setTitle] = useState('')
  const [occurredAt, setOccurredAt] = useState('')
  const [kind, setKind] = useState<EntryType>('daily')
  const [content, setContent] = useState('')
  const [taSaid, setTaSaid] = useState('')
  const [observation, setObservation] = useState('')
  const [mood, setMood] = useState<Mood | ''>('')
  const [tags, setTags] = useState('')
  const [photoIds, setPhotoIds] = useState<string[]>([])
  const [photos, setPhotos] = useState<Photo[]>([])
  const [pending, setPending] = useState<File[]>([])
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setTitle(entry?.title ?? '')
    setOccurredAt(toLocalInput(entry?.occurredAt ?? nowISO()))
    setKind(entry?.type ?? 'daily')
    setContent(entry?.content ?? '')
    setTaSaid(entry?.taSaid ?? '')
    setObservation(entry?.myObservation ?? '')
    setMood(entry?.mood ?? '')
    setTags((entry?.tagList ?? []).join(' '))
    setPhotoIds(entry?.photoIds ?? [])
    setPending([])
    void db.photos.toArray().then(setPhotos)
  }, [open, entry])

  /** 新建时先暂存文件，保存记录后再入库并挂到这条记录上 */
  async function addPhotosFrom(list: FileList | null) {
    if (!list?.length || !person) return
    const files = [...list]
    if (!entry) {
      setPending((prev) => [...prev, ...files])
      toast(`已选 ${files.length} 张，保存这条记录后会一起加入`)
      return
    }
    setUploading(true)
    try {
      const added = await addPhotoFiles(files, { personId: person.id, entryId: entry.id })
      setPhotoIds((prev) => [...prev, ...added.map((p) => p.id)])
      setPhotos(await db.photos.toArray())
      toast(`已添加 ${added.length} 张照片`)
    } catch (err) {
      toast(`添加照片失败：${(err as Error).message}`, 'err')
    } finally {
      setUploading(false)
    }
  }

  async function save() {
    if (!person) return
    if (!title.trim() && !content.trim()) {
      toast('至少写个标题或正文', 'err')
      return
    }
    setSaving(true)
    try {
      const iso = occurredAt ? new Date(occurredAt).toISOString() : nowISO()
      const tagList = tags
        .split(/[\s,，]+/)
        .map((t) => t.trim())
        .filter(Boolean)
      const payload = {
        personId: person.id,
        occurredAt: iso,
        type: kind,
        title: title.trim(),
        content: content.trim() || undefined,
        taSaid: taSaid.trim() || undefined,
        myObservation: observation.trim() || undefined,
        mood: mood || undefined,
        tagList,
        photoIds,
        quick: false,
      }
      let savedId = entry?.id
      if (entry) await entryRepo.update(entry.id, payload)
      else {
        const created = await entryRepo.create({ ...payload, followUpDone: false })
        savedId = created.id
      }
      // 新建时暂存的照片在这里入库，并把 id 补进这条记录
      if (pending.length && savedId) {
        const added = await addPhotoFiles(pending, { personId: person.id, entryId: savedId })
        if (added.length) {
          await entryRepo.update(savedId, { photoIds: [...photoIds, ...added.map((p) => p.id)] })
        }
      }
      toast(entry ? '已保存' : '已记下')
      onSaved()
      onClose()
    } catch (err) {
      toast(`保存失败：${(err as Error).message}`, 'err')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={entry ? '编辑记录' : '记一笔'}
      footer={
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost px-3 py-1.5 text-[13px]" onClick={onClose}>
            取消
          </button>
          <button type="button" className="btn-primary px-3 py-1.5 text-[13px]" onClick={() => void save()} disabled={saving}>
            {saving ? '保存中…' : '保存'}
          </button>
        </div>
      }
    >
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className="mb-1 block text-[12px] text-ink-500">时间</span>
            <input className="input" type="datetime-local" value={occurredAt} onChange={(e) => setOccurredAt(e.target.value)} />
          </label>
          <label className="block">
            <span className="mb-1 block text-[12px] text-ink-500">类型</span>
            <select className="input" value={kind} onChange={(e) => setKind(e.target.value as EntryType)}>
              {KINDS.map((k) => (
                <option key={k.key} value={k.key}>
                  {k.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="block">
          <span className="mb-1 block text-[12px] text-ink-500">标题</span>
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="一句话概括" />
        </label>

        <label className="block">
          <span className="mb-1 block text-[12px] text-ink-500">经过</span>
          <textarea className="input" rows={4} value={content} onChange={(e) => setContent(e.target.value)} placeholder="发生了什么" />
        </label>

        <div className="grid gap-2 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-[12px] text-ink-500">TA 说的</span>
            <textarea className="input" rows={2} value={taSaid} onChange={(e) => setTaSaid(e.target.value)} />
          </label>
          <label className="block">
            <span className="mb-1 block text-[12px] text-ink-500">我的观察</span>
            <textarea className="input" rows={2} value={observation} onChange={(e) => setObservation(e.target.value)} />
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[12px] text-ink-500">心情</span>
          {MOODS.map((m) => (
            <button
              key={m.key}
              type="button"
              onClick={() => setMood(mood === m.key ? '' : m.key)}
              className={
                mood === m.key
                  ? 'rounded-full border border-rose-soft bg-rose-soft/15 px-2.5 py-0.5 text-[12px] text-rose-deep'
                  : 'rounded-full border border-cream-300 bg-white px-2.5 py-0.5 text-[12px] text-ink-500'
              }
            >
              {m.label}
            </button>
          ))}
        </div>

        <div>
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <span className="block text-[12px] text-ink-500">照片</span>
            <button
              type="button"
              disabled={uploading}
              onClick={() => fileRef.current?.click()}
              className="inline-flex items-center gap-1 rounded-full border border-cream-300 bg-white px-2.5 py-1 text-[11.5px] text-ink-600 transition hover:text-rose-deep disabled:opacity-60"
            >
              <Camera size={12} /> {uploading ? '上传中…' : '上传新照片'}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => {
                void addPhotosFrom(e.target.files)
                e.target.value = ''
              }}
            />
          </div>

          {pending.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {pending.map((f, i) => (
                <span key={`${f.name}-${i}`} className="relative h-12 w-12 overflow-hidden rounded-lg border border-cream-200">
                  <img
                    src={URL.createObjectURL(f)}
                    alt=""
                    className="h-full w-full object-cover"
                    onLoad={(e) => URL.revokeObjectURL((e.target as HTMLImageElement).src)}
                  />
                  <button
                    type="button"
                    aria-label="移除这张待上传照片"
                    onClick={() => setPending((prev) => prev.filter((_, idx) => idx !== i))}
                    className="absolute right-0 top-0 flex h-4 w-4 items-center justify-center rounded-bl bg-black/60 text-[10px] leading-none text-white"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}

          {photos.length > 0 ? (
            <>
              <span className="mb-1 block text-[11px] text-ink-400">已有照片（点选关联）</span>
              <div className="grid max-h-[160px] grid-cols-6 gap-1.5 overflow-y-auto">
                {photos.map((p) => {
                  const picked = photoIds.includes(p.id)
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setPhotoIds((prev) => (picked ? prev.filter((x) => x !== p.id) : [...prev, p.id]))}
                      className={`relative aspect-square overflow-hidden rounded-lg border ${picked ? 'border-rose-deep ring-2 ring-rose-soft/60' : 'border-cream-200'}`}
                      aria-label={picked ? '取消选择' : '选择这张'}
                    >
                      <img
                        src={URL.createObjectURL(p.thumb)}
                        alt=""
                        className="h-full w-full object-cover"
                        onLoad={(e) => URL.revokeObjectURL((e.target as HTMLImageElement).src)}
                      />
                    </button>
                  )
                })}
              </div>
            </>
          ) : (
            pending.length === 0 && <span className="text-[11px] text-ink-400">还没有照片，点右上角「上传新照片」。</span>
          )}
        </div>

        <label className="block">
          <span className="mb-1 block text-[12px] text-ink-500">标签（空格分隔）</span>
          <input className="input" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="旅行 电影" />
        </label>

      </div>
    </Modal>
  )
}

export function PersonEditor({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const { person, refreshPerson } = useApp()
  const toast = useToast()
  const [name, setName] = useState('')
  const [nickname, setNickname] = useState('')
  const [intro, setIntro] = useState('')
  const [birthday, setBirthday] = useState('')
  const [meetDate, setMeetDate] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open || !person) return
    setName(person.name ?? '')
    setNickname(person.nickname ?? '')
    setIntro(person.intro ?? '')
    setBirthday(person.birthday ?? '')
    setMeetDate(person.meetDate ?? '')
  }, [open, person])

  async function save() {
    if (!person) return
    setSaving(true)
    try {
      await savePerson({
        id: person.id,
        name: name.trim(),
        nickname: nickname.trim() || undefined,
        intro: intro.trim() || undefined,
        birthday: birthday || undefined,
        meetDate: meetDate || undefined,
      })
      await refreshPerson()
      toast('已保存')
      onSaved()
      onClose()
    } catch (err) {
      toast(`保存失败：${(err as Error).message}`, 'err')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="编辑人物资料"
      footer={
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost px-3 py-1.5 text-[13px]" onClick={onClose}>
            取消
          </button>
          <button type="button" className="btn-primary px-3 py-1.5 text-[13px]" onClick={() => void save()} disabled={saving}>
            {saving ? '保存中…' : '保存'}
          </button>
        </div>
      }
    >
      <div className="space-y-3">
        <label className="block">
          <span className="mb-1 block text-[12px] text-ink-500">称呼（显示在首页中心）</span>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="block">
          <span className="mb-1 block text-[12px] text-ink-500">昵称</span>
          <input className="input" value={nickname} onChange={(e) => setNickname(e.target.value)} />
        </label>
        <label className="block">
          <span className="mb-1 block text-[12px] text-ink-500">简介（会显示在首页中心下方）</span>
          <textarea className="input" rows={3} value={intro} onChange={(e) => setIntro(e.target.value)} />
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className="mb-1 block text-[12px] text-ink-500">生日</span>
            <input className="input" type="date" value={birthday} onChange={(e) => setBirthday(e.target.value)} />
          </label>
          <label className="block">
            <span className="mb-1 block text-[12px] text-ink-500">相识日</span>
            <input className="input" type="date" value={meetDate} onChange={(e) => setMeetDate(e.target.value)} />
          </label>
        </div>
      </div>
    </Modal>
  )
}

export function DeleteEntryButton({ entryId, onDeleted }: { entryId: string; onDeleted: () => void }) {
  const confirm = useConfirm()
  const toast = useToast()
  return (
    <button
      type="button"
      className="inline-flex items-center gap-1 rounded-full border border-cream-300 bg-white px-2.5 py-0.5 text-[12px] text-ink-500 hover:text-rose-deep"
      onClick={async () => {
        const ok = await confirm({ title: '删除这条记录？', desc: '删除后无法撤销，关联照片不会跟着删除。' })
        if (!ok) return
        await entryRepo.remove(entryId)
        toast('已删除')
        onDeleted()
      }}
    >
      <Trash2 size={12} /> 删除
    </button>
  )
}

/**
 * 删除一张照片。
 *
 * compact 用于相册网格上的小角标；不带 compact 时是带文字的行内按钮（大图查看器用）。
 * 走 deletePhotoCascade：会同时解除记录/礼物/头像上的引用，并留下删除墓碑（同步用）。
 */
export function DeletePhotoButton({
  photoId,
  onDeleted,
  compact = false,
  label = '删除',
}: {
  photoId: string
  onDeleted: () => void
  compact?: boolean
  label?: string
}) {
  const confirm = useConfirm()
  const toast = useToast()
  const [busy, setBusy] = useState(false)

  async function run() {
    const ok = await confirm({
      title: '删除这张照片？',
      desc: '删除后会从相册移除，并解除记录与礼物上的引用。云端同步会在下次同步时把删除同步到其他设备。',
    })
    if (!ok) return
    setBusy(true)
    try {
      await deletePhotoCascade(photoId)
      toast('照片已删除')
      onDeleted()
    } catch (err) {
      toast(`删除失败：${(err as Error).message}`, 'err')
    } finally {
      setBusy(false)
    }
  }

  if (compact) {
    return (
      <button
        type="button"
        aria-label="删除这张照片"
        title="删除这张照片"
        disabled={busy}
        onClick={(e) => {
          e.stopPropagation()
          e.preventDefault()
          void run()
        }}
        className="flex h-8 w-8 items-center justify-center rounded-full bg-black/50 text-white ring-1 ring-white/25 backdrop-blur-sm transition hover:bg-[#8E4850]/90 disabled:opacity-50"
      >
        <Trash2 size={14} />
      </button>
    )
  }

  return (
    <button
      type="button"
      disabled={busy}
      onClick={() => void run()}
      className="inline-flex items-center gap-1 rounded-full border border-white/25 px-2 py-0.5 text-[11px] text-[#F3E4D8]/85 transition hover:bg-white/10 disabled:opacity-50"
    >
      <Trash2 size={11} /> {label}
    </button>
  )
}

export function PhotoCaptionButton({
  photoId,
  caption,
  onSaved,
}: {
  photoId: string
  caption?: string
  onSaved: () => void
}) {
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(caption ?? '')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open) setDraft(caption ?? '')
  }, [open, caption])

  async function save() {
    setSaving(true)
    try {
      await updatePhotoCaption(photoId, draft)
      toast(draft.trim() ? '题注已保存' : '题注已清空')
      setOpen(false)
      onSaved()
    } catch (err) {
      toast(`保存失败：${(err as Error).message}`, 'err')
    } finally {
      setSaving(false)
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          setOpen(true)
        }}
        className="inline-flex items-center gap-1 rounded-full border border-white/25 px-2 py-0.5 text-[11px] text-[#F3E4D8]/85 transition hover:bg-white/10"
      >
        <Pencil size={11} /> {caption?.trim() ? '改题注' : '写题注'}
      </button>
    )
  }

  return (
    <div className="w-full" onClick={(e) => e.stopPropagation()}>
      <textarea
        autoFocus
        rows={2}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="写一句这张照片的说明，会显示在首页和相册"
        className="w-full resize-y rounded-xl border border-white/25 bg-white/10 px-3 py-2 text-[12.5px] leading-relaxed text-[#F3E4D8] outline-none placeholder:text-[#F3E4D8]/40 focus:border-white/50"
      />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={saving}
          onClick={() => void save()}
          className="rounded-full bg-white px-3 py-1 text-[12px] font-medium text-[#2A1F26] disabled:opacity-60"
        >
          {saving ? '保存中…' : '保存题注'}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-full border border-white/25 px-3 py-1 text-[12px] text-[#F3E4D8]/85"
        >
          取消
        </button>
        {caption?.trim() && (
          <button type="button" onClick={() => setDraft('')} className="text-[11px] text-[#F3E4D8]/60 underline">
            清空
          </button>
        )}
      </div>
    </div>
  )
}

export function PhotoUploadButton({ personId, onDone }: { personId: string; onDone: () => void }) {
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  return (
    <label className="btn-ghost inline-flex cursor-pointer items-center gap-1.5 px-3 py-1.5 text-[13px]">
      {busy ? '上传中…' : <><Upload size={14} /> 上传照片</>}
      <input
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        disabled={busy}
        onChange={async (e) => {
          const files = Array.from(e.target.files ?? [])
          e.currentTarget.value = ''
          if (!files.length) return
          setBusy(true)
          try {
            await addPhotoFiles(files, { personId })
            toast(`已上传 ${files.length} 张`)
            onDone()
          } catch (err) {
            toast(`上传失败：${(err as Error).message}`, 'err')
          } finally {
            setBusy(false)
          }
        }}
      />
    </label>
  )
}
