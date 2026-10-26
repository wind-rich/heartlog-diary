import { Link } from 'react-router-dom'
import clsx from 'clsx'
import type { PublicEntry, PublicPhoto } from '../types'
import { KIND_LABEL, MOOD_LABEL, entryDateShort, entryExcerpt } from '../lib/data'
import { PhotoTile } from './Photos'

interface Props {
  entry: PublicEntry
  photos: PublicPhoto[]
  onOpenPhoto?: (photoId: string) => void
  /** 紧凑模式用于侧栏与预览面板 */
  compact?: boolean
  className?: string
}

const MOOD_DOT: Record<string, string> = {
  happy: 'bg-amber-400',
  calm: 'bg-sky-400',
  low: 'bg-indigo-400',
  anxious: 'bg-orange-400',
  angry: 'bg-rose-400',
  custom: 'bg-ink-300',
}

export function EntryCard({ entry, photos, compact, className }: Props) {
  const excerpt = entryExcerpt(entry, compact ? 52 : 88)
  const cover = photos[0]

  return (
    <Link
      to={`/stories/${entry.id}`}
      className={clsx(
        'v-card-hover block rounded-2xl border border-cream-200 bg-white',
        compact ? 'p-3' : 'p-4',
        'shadow-card',
        className,
      )}
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-ink-500">
            <span className="tabular-nums">{entryDateShort(entry.occurredAt)}</span>
            <span className="text-cream-300">·</span>
            <span>{KIND_LABEL[entry.kind]}</span>
            {entry.mood && (
              <span className="inline-flex items-center gap-1">
                <span className={clsx('h-1.5 w-1.5 rounded-full', MOOD_DOT[entry.mood] ?? 'bg-ink-300')} />
                {entry.mood === 'custom' ? entry.moodCustom || '心情' : MOOD_LABEL[entry.mood]}
              </span>
            )}
          </div>
          <h3
            className={clsx(
              'mt-1 font-semibold leading-snug text-ink-900',
              compact ? 'text-[13.5px] v-clamp-2' : 'text-[14.5px]',
            )}
          >
            {entry.title}
          </h3>
          {excerpt && (
            <p className={clsx('mt-1 text-[12px] leading-relaxed text-ink-500', compact ? 'v-clamp-2' : 'v-clamp-2')}>
              {excerpt}
            </p>
          )}
          {entry.tags.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1.5 text-[10.5px] text-ink-300">
              {entry.tags.slice(0, 3).map((t) => (
                <span key={t}>#{t}</span>
              ))}
            </div>
          )}
        </div>

        {cover && (
          <PhotoTile
            photo={cover}
            className={clsx('shrink-0', compact ? 'h-14 w-14' : 'h-[68px] w-[68px]')}
          />
        )}
      </div>
    </Link>
  )
}
