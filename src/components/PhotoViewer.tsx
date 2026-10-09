import { useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight, FileText, Trash2, X } from 'lucide-react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/db'
import { fmtDateTime } from '../lib/date'
import { PhotoImg } from './ui'

export default function PhotoViewer({
  ids,
  startIndex = 0,
  onClose,
  onDelete,
  onOpenEntry,
}: {
  ids: string[]
  startIndex?: number
  onClose: () => void
  onDelete?: (id: string) => void
  onOpenEntry?: (entryId: string) => void
}) {
  const [idx, setIdx] = useState(startIndex)
  const id = ids[idx]

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowRight') setIdx((i) => Math.min(ids.length - 1, i + 1))
      if (e.key === 'ArrowLeft') setIdx((i) => Math.max(0, i - 1))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [ids.length, onClose])

  const photo = useLiveQuery(async () => (id ? db.photos.get(id) : undefined), [id])

  if (!id) return null

  return (
    <div className="fixed inset-0 z-[90] bg-[#2A211B]/95 flex flex-col">
      <div className="flex items-center gap-2 px-3 py-3 text-white/85">
        <span className="text-[13px]">
          {idx + 1} / {ids.length}
        </span>
        <div className="flex-1" />
        {onDelete && (
          <button
            className="w-9 h-9 rounded-full flex items-center justify-center hover:bg-white/10"
            onClick={() => onDelete(id)}
            aria-label="删除照片"
          >
            <Trash2 size={18} />
          </button>
        )}
        <button
          className="w-9 h-9 rounded-full flex items-center justify-center hover:bg-white/10"
          onClick={onClose}
          aria-label="关闭"
        >
          <X size={20} />
        </button>
      </div>

      <div className="flex-1 flex items-center justify-center px-2 min-h-0 relative">
        {ids.length > 1 && (
          <button
            className="absolute left-2 z-10 w-10 h-10 rounded-full bg-white/10 text-white flex items-center justify-center disabled:opacity-25"
            onClick={() => setIdx((i) => Math.max(0, i - 1))}
            disabled={idx === 0}
            aria-label="上一张"
          >
            <ChevronLeft size={22} />
          </button>
        )}
        <PhotoImg photoId={id} kind="full" className="max-h-full max-w-full object-contain rounded-xl" />
        {ids.length > 1 && (
          <button
            className="absolute right-2 z-10 w-10 h-10 rounded-full bg-white/10 text-white flex items-center justify-center disabled:opacity-25"
            onClick={() => setIdx((i) => Math.min(ids.length - 1, i + 1))}
            disabled={idx === ids.length - 1}
            aria-label="下一张"
          >
            <ChevronRight size={22} />
          </button>
        )}
      </div>

      <div className="px-4 py-3 text-white/85 text-[13px] space-y-1">
        {photo?.caption && <div className="font-medium">{photo.caption}</div>}
        <div className="text-white/55">
          拍摄 {fmtDateTime(photo?.takenAt ?? photo?.createdAt ?? new Date())}
          {photo?.keepOriginal ? ' · 原图' : ' · 已压缩'}
        </div>
        {photo?.tags?.length ? <div className="text-white/55">标签：{photo.tags.join('、')}</div> : null}
        {photo?.entryId && onOpenEntry && (
          <button className="inline-flex items-center gap-1.5 text-rose-soft pt-1" onClick={() => onOpenEntry(photo.entryId!)}>
            <FileText size={14} /> 查看所属记录
          </button>
        )}
      </div>
    </div>
  )
}
