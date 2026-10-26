import { Suspense, useMemo, useState } from 'react'
import { BookHeart, Search, X } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useSnapshot, useSnapshotState } from '../state/SnapshotContext'
import { useAuthorReload } from '../author/AuthorReload'
import { EntryEditor } from '../author/lazy'
import { Plus } from 'lucide-react'
import { KIND_LABEL, MOOD_LABEL, entryDateShort, entryExcerpt, groupByMonth, searchEntries, sortEntriesDesc } from '../lib/data'
import { EmptyState, Pill } from '../components/bits'
import { PhotoTile } from '../components/Photos'
import type { EntryKind, PublicEntry } from '../types'

const BATCH = 12

const TYPES: { key: EntryKind | 'all'; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'daily', label: '日常' },
  { key: 'date', label: '相处' },
  { key: 'emotion', label: '心情' },
  { key: 'interest', label: '兴趣' },
  { key: 'health', label: '健康' },
]

export default function Stories() {
  const s = useSnapshot()
  const { editable } = useSnapshotState()
  const reload = useAuthorReload()
  const [editorOpen, setEditorOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [type, setType] = useState<EntryKind | 'all'>('all')
  const [limit, setLimit] = useState(BATCH)

  const filtered = useMemo(() => {
    let list = sortEntriesDesc(s.entries)
    if (type !== 'all') list = list.filter((e) => e.kind === type)
    return searchEntries(list, query)
  }, [s.entries, query, type])

  const shown = filtered.slice(0, limit)
  const groups = groupByMonth(shown)
  const hasMore = filtered.length > shown.length

  return (
    <div className="mx-auto max-w-[760px] space-y-4">
      <header className="flex items-start justify-between gap-3 px-1">
        <div>
          <h1 className="text-[19px] font-semibold text-ink-900">我们的故事</h1>
          <p className="mt-1 text-[11.5px] text-ink-500">
            共 {s.entries.length} 条记录 · 原话与个人观察分开保存，不会混在一起写
          </p>
        </div>
        {editable && reload && (
          <button
            type="button"
            onClick={() => setEditorOpen(true)}
            className="inline-flex shrink-0 items-center gap-1 rounded-full bg-rose-deep px-3 py-1.5 text-[12.5px] text-white"
          >
            <Plus size={14} /> 记一笔
          </button>
        )}
      </header>

      {editable && reload && (
        <Suspense fallback={null}>
          <EntryEditor open={editorOpen} onClose={() => setEditorOpen(false)} onSaved={() => void reload()} />
        </Suspense>
      )}

      <div className="flex flex-col gap-2.5">
        <div className="relative">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-300" />
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setLimit(BATCH)
            }}
            placeholder="搜索标题、正文、原话或标签"
            className="w-full rounded-xl border border-cream-300 bg-white py-2.5 pl-9 pr-9 text-[13.5px] text-ink-900 outline-none transition placeholder:text-ink-300 focus:border-rose-soft focus:ring-2 focus:ring-rose-soft/20"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              aria-label="清除搜索"
              className="absolute right-0.5 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full text-ink-500 hover:bg-cream-100"
            >
              <X size={13} />
            </button>
          )}
        </div>

        <div className="v-scroll-x -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5">
          {TYPES.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => {
                setType(t.key)
                setLimit(BATCH)
              }}
                className={
                type === t.key
                  ? 'min-h-11 shrink-0 rounded-full border border-rose-soft bg-rose-soft/15 px-4 py-2 text-[12px] font-medium text-rose-deep'
                  : 'min-h-11 shrink-0 rounded-full border border-cream-300 bg-white px-4 py-2 text-[12px] text-ink-500'
              }
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={<BookHeart size={22} />}
          title={s.entries.length ? '没有匹配的记录' : '还没有已发布的记录'}
          desc={s.entries.length ? '换一个关键词，或者切换到「全部」分类。' : '作者发布记录之后，这里会按年月显示。'}
        />
      ) : (
        <div className="space-y-5">
          {groups.map((g) => (
            <section key={g.key}>
              <h2 className="sticky top-14 z-10 -mx-1 mb-2 bg-[#FFFCF8]/90 px-1 py-1.5 text-[11.5px] font-medium tracking-wide text-ink-500 backdrop-blur">
                {g.label}
                <span className="ml-2 text-ink-300">{g.entries.length} 条</span>
              </h2>
              <ul className="space-y-2.5">
                {g.entries.map((e) => (
                  <StoryRow key={e.id} entry={e} photoIds={e.photoIds} />
                ))}
              </ul>
            </section>
          ))}

          {hasMore && (
            <button
              type="button"
              onClick={() => setLimit((l) => l + BATCH)}
              className="w-full rounded-xl border border-cream-300 bg-white py-2.5 text-[12.5px] text-ink-700 transition hover:bg-cream-50"
            >
              加载更多（还有 {filtered.length - shown.length} 条）
            </button>
          )}
          {!hasMore && filtered.length > BATCH && (
            <p className="pb-2 text-center text-[11px] text-ink-300">已显示全部 {filtered.length} 条</p>
          )}
        </div>
      )}
    </div>
  )
}

function StoryRow({ entry, photoIds }: { entry: PublicEntry; photoIds: string[] }) {
  const s = useSnapshot()
  const photos = s.photos.filter((p) => photoIds.includes(p.id))
  const excerpt = entryExcerpt(entry, 96)

  return (
    <li>
      <Link
        to={`/stories/${entry.id}`}
        className="v-card-hover block rounded-2xl border border-cream-200 bg-white p-3.5 shadow-card"
      >
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-ink-500">
          <span className="tabular-nums text-ink-700">{entryDateShort(entry.occurredAt)}</span>
          <span className="text-cream-300">·</span>
          <span>{KIND_LABEL[entry.kind]}</span>
          {entry.mood && (
            <Pill className="!border-cream-200 !bg-cream-50 !text-ink-500">
              {entry.mood === 'custom' ? entry.moodCustom || '心情' : MOOD_LABEL[entry.mood]}
              {entry.moodLevel ? ` ${entry.moodLevel}/5` : ''}
            </Pill>
          )}
          {entry.quick && <span className="text-ink-300">快速记录</span>}
        </div>

        <div className="mt-1.5 flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h3 className="text-[14.5px] font-semibold leading-snug text-ink-900">{entry.title}</h3>
            {excerpt && <p className="mt-1 text-[12px] leading-relaxed text-ink-500 v-clamp-2">{excerpt}</p>}
            {entry.taSaid && (
              <p className="mt-1.5 border-l-2 border-rose-soft/50 pl-2 text-[11.5px] italic leading-relaxed text-ink-500 v-clamp-2">
                「{entry.taSaid}」
              </p>
            )}
          </div>
          {photos.length > 0 && (
            <div className="flex shrink-0 gap-1">
              {photos.slice(0, 2).map((p) => (
                <PhotoTile key={p.id} photo={p} className="h-16 w-16" />
              ))}
            </div>
          )}
        </div>

        {entry.tags.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5 text-[10.5px] text-ink-300">
            {entry.tags.map((t) => (
              <span key={t}>#{t}</span>
            ))}
            {photos.length > 2 && <span>· 另有 {photos.length - 2} 张照片</span>}
          </div>
        )}
      </Link>
    </li>
  )
}
