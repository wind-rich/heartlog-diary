import { useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useNavigate } from 'react-router-dom'
import { ImagePlus, Loader2 } from 'lucide-react'
import { db, deletePhotoCascade } from '../db/db'
import type { Photo } from '../db/types'
import { fmtDate, parseAny } from '../lib/date'
import { addPhotoFiles } from '../lib/photo'
import PhotoViewer from '../components/PhotoViewer'
import { Empty, PhotoImg, Segmented, useConfirm, useToast } from '../components/ui'
import { useApp } from '../state/app'

export default function Album() {
  const { person, prefs } = useApp()
  const toast = useToast()
  const confirm = useConfirm()
  const nav = useNavigate()
  const fileRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [viewer, setViewer] = useState<{ ids: string[]; index: number } | null>(null)
  const [filter, setFilter] = useState<'all' | 'linked' | 'loose'>('all')
  const [tagFilter, setTagFilter] = useState<string[]>([])

  const pid = person?.id

  const photos = useLiveQuery(
    async () =>
      pid
        ? (await db.photos.where('personId').equals(pid).toArray()).sort((a, b) =>
            (a.takenAt ?? a.createdAt) < (b.takenAt ?? b.createdAt) ? 1 : -1,
          )
        : [],
    [pid],
  )

  const tags = useMemo(() => {
    const map = new Map<string, number>()
    for (const p of photos ?? []) for (const t of p.tags ?? []) map.set(t, (map.get(t) ?? 0) + 1)
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]).slice(0, 12)
  }, [photos])

  const filtered = useMemo(() => {
    let list = photos ?? []
    if (filter === 'linked') list = list.filter((p) => p.entryId || p.giftId)
    if (filter === 'loose') list = list.filter((p) => !p.entryId && !p.giftId)
    if (tagFilter.length) list = list.filter((p) => tagFilter.some((t) => (p.tags ?? []).includes(t)))
    return list
  }, [photos, filter, tagFilter])

  const groups = useMemo(() => {
    const map = new Map<string, Photo[]>()
    for (const p of filtered) {
      const d = parseAny(p.takenAt ?? p.createdAt)
      const key = `${d.getFullYear()}年${d.getMonth() + 1}月`
      map.set(key, [...(map.get(key) ?? []), p])
    }
    return Array.from(map.entries())
  }, [filtered])

  if (!pid) return null

  const upload = async (files: FileList | null) => {
    if (!files?.length) return
    setBusy(true)
    try {
      const created = await addPhotoFiles(Array.from(files), {
        personId: pid,
        keepOriginal: prefs.keepOriginalPhoto,
        photoMaxEdge: prefs.photoMaxEdge,
        thumbMaxEdge: prefs.thumbMaxEdge,
      })
      toast(`已添加 ${created.length} 张照片（未关联记录，可在记录里补充）`)
    } catch (e) {
      toast(`上传失败：${(e as Error).message}`, 'err')
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const removePhoto = async (id: string) => {
    const ok = await confirm({
      title: '删除这张照片？',
      desc: '照片文件会被永久删除，关联的记录会保留但不再有这张图。',
      danger: true,
      confirmText: '删除',
    })
    if (!ok) return
    await deletePhotoCascade(id)
    setViewer((v) => {
      if (!v) return null
      const ids = v.ids.filter((x) => x !== id)
      if (!ids.length) return null
      return { ids, index: Math.min(v.index, ids.length - 1) }
    })
    toast('已删除')
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="flex-1 overflow-x-auto no-scrollbar">
          <Segmented
            options={[
              { value: 'all', label: `全部 ${photos?.length ?? 0}` },
              { value: 'linked', label: '已关联记录' },
              { value: 'loose', label: '自由照片' },
            ]}
            value={filter}
            onChange={(v) => setFilter(v as typeof filter)}
          />
        </div>
        <button className="btn-primary !px-3 shrink-0" onClick={() => fileRef.current?.click()} disabled={busy} aria-label="上传照片">
          {busy ? <Loader2 size={17} className="animate-spin" /> : <ImagePlus size={17} />}
        </button>
      </div>

      <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => upload(e.target.files)} />

      {tags.length > 0 && (
        <div className="flex gap-1.5 overflow-x-auto no-scrollbar pb-0.5">
          {tags.map(([t, c]) => (
            <button
              key={t}
              className={`shrink-0 ${tagFilter.includes(t) ? 'chip-on' : 'chip-off'}`}
              onClick={() => setTagFilter((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]))}
            >
              #{t} {c}
            </button>
          ))}
        </div>
      )}

      {filtered.length === 0 ? (
        <Empty
          icon={<ImagePlus size={28} />}
          title="相册还是空的"
          desc={'照片可以在写记录时一起上传（会自动关联到那条事件），\n也可以直接在这里上传，之后随时能关联。'}
        />
      ) : (
        <div className="space-y-5">
          {groups.map(([month, list]) => (
            <section key={month}>
              <div className="sticky top-14 z-30 -mx-4 px-4 py-1.5 bg-cream-50/95 backdrop-blur-sm text-[13.5px] font-semibold text-ink-900">
                {month}
                <span className="ml-2 text-[12px] font-normal text-ink-300">{list.length} 张</span>
              </div>
              <div className="grid grid-cols-3 gap-2 mt-2">
                {list.map((p, i) => (
                  <button
                    key={p.id}
                    className="relative aspect-square rounded-xl overflow-hidden bg-cream-200"
                    onClick={() => setViewer({ ids: list.map((x) => x.id), index: i })}
                  >
                    <PhotoImg photoId={p.id} className="w-full h-full object-cover" />
                    <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/55 to-transparent px-1.5 pb-1 pt-4 flex items-end justify-between">
                      <span className="text-[10.5px] text-white/90">{fmtDate(p.takenAt ?? p.createdAt).slice(5)}</span>
                      {p.entryId && <span className="text-[9px] text-white/85 bg-white/20 rounded px-1">已关联</span>}
                    </div>
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {viewer && (
        <PhotoViewer
          ids={viewer.ids}
          startIndex={viewer.index}
          onClose={() => setViewer(null)}
          onDelete={removePhoto}
          onOpenEntry={(entryId) => {
            setViewer(null)
            nav(`/timeline`)
            void entryId
          }}
        />
      )}
    </div>
  )
}
