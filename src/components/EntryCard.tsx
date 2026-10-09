import { MoreHorizontal, Pencil, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { Entry } from '../db/types'
import { entryTypeMeta } from '../lib/constants'
import { fmtTime, relativeDay } from '../lib/date'
import { moodLabelOf } from '../lib/stats'
import { PhotoImg, Tag } from './ui'

export default function EntryCard({
  entry,
  onEdit,
  onDelete,
  hideDate = false,
  onOpenPhoto,
}: {
  entry: Entry
  onEdit?: (e: Entry) => void
  onDelete?: (e: Entry) => void
  hideDate?: boolean
  onOpenPhoto?: (photoId: string, ids: string[]) => void
}) {
  const meta = entryTypeMeta(entry.type)
  const [menu, setMenu] = useState(false)
  const photos = entry.photoIds ?? []
  const snippet = useMemo(() => {
    const parts: string[] = []
    if (entry.content) parts.push(entry.content)
    if (entry.taSaid) parts.push(`TA 说：${entry.taSaid}`)
    if (entry.myObservation) parts.push(`我的观察：${entry.myObservation}`)
    return parts.join('\n')
  }, [entry])

  return (
    <article className="card card-pad relative">
      <div className="flex items-start gap-2.5">
        <div
          className="w-9 h-9 rounded-xl flex items-center justify-center text-[17px] shrink-0"
          style={{ background: `${meta.color}1f` }}
        >
          {meta.emoji}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-start gap-2">
            <h3 className="text-[15.5px] font-medium text-ink-900 leading-snug flex-1 min-w-0 break-words">
              {entry.title || '（无标题）'}
            </h3>
            <span className="text-[11.5px] text-ink-300 shrink-0 mt-0.5">
              {hideDate ? fmtTime(entry.occurredAt) : `${relativeDay(entry.occurredAt)} ${fmtTime(entry.occurredAt)}`}
            </span>
            {(onEdit || onDelete) && (
              <button
                className="-mt-1 -mr-1 w-7 h-7 rounded-full flex items-center justify-center text-ink-300 hover:bg-cream-100 shrink-0"
                onClick={() => setMenu((v) => !v)}
                aria-label="更多操作"
              >
                <MoreHorizontal size={16} />
              </button>
            )}
          </div>

          <div className="mt-1 flex items-center gap-2 flex-wrap">
            <Tag color={meta.color}>{meta.label}</Tag>
            {entry.mood && (
              <span className="text-[12px] text-ink-500">
                {moodLabelOf(entry.mood, entry.moodCustom)}
                {entry.moodLevel ? ` · ${entry.moodLevel}/5` : ''}
              </span>
            )}
            {entry.quick && <span className="text-[11px] text-ink-300">随手记</span>}
          </div>

          {snippet && <p className="mt-2 text-[13.5px] text-ink-700 whitespace-pre-line leading-relaxed">{snippet}</p>}

          {entry.tagList?.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {entry.tagList.map((t) => (
                <Tag key={t} color="#8A7D72">
                  #{t}
                </Tag>
              ))}
            </div>
          )}

          {photos.length > 0 && (
            <div className="mt-2.5 flex gap-2 flex-wrap">
              {photos.map((pid, i) => (
                <PhotoImg
                  key={pid}
                  photoId={pid}
                  className="w-[76px] h-[76px] rounded-xl object-cover bg-cream-200"
                  onClick={() => onOpenPhoto?.(pid, photos.slice(i).concat(photos.slice(0, i)))}
                />
              ))}
            </div>
          )}

          {entry.followUp && (
            <div
              className={`mt-2.5 rounded-xl px-3 py-2 text-[13px] ${
                entry.followUpDone ? 'bg-cream-100 text-ink-300 line-through' : 'bg-[#FFF3E6] text-[#A9762C]'
              }`}
            >
              待跟进：{entry.followUp}
            </div>
          )}
        </div>
      </div>

      {menu && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setMenu(false)} />
          <div className="absolute right-3 top-11 z-20 bg-white rounded-xl shadow-pop border border-cream-200 py-1 w-32">
            {onEdit && (
              <button
                className="w-full px-3 py-2 text-left text-[14px] flex items-center gap-2 hover:bg-cream-100"
                onClick={() => {
                  setMenu(false)
                  onEdit(entry)
                }}
              >
                <Pencil size={14} /> 编辑
              </button>
            )}
            {onDelete && (
              <button
                className="w-full px-3 py-2 text-left text-[14px] flex items-center gap-2 text-[#C6452F] hover:bg-cream-100"
                onClick={() => {
                  setMenu(false)
                  onDelete(entry)
                }}
              >
                <Trash2 size={14} /> 删除
              </button>
            )}
          </div>
        </>
      )}
    </article>
  )
}
