import { Suspense, useEffect, useMemo, useState } from 'react'
import { BookHeart, Plus, Search, X } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useSnapshot, useSnapshotState } from '../state/SnapshotContext'
import { useAuthorReload } from '../author/AuthorReload'
import { EntryEditor } from '../author/lazy'
import { KIND_LABEL, MOOD_LABEL, entryExcerpt, groupByMonth, searchEntries, sortEntriesDesc } from '../lib/data'
import { EmptyState, Pill } from '../components/bits'
import type { EntryKind, PublicEntry, PublicPhoto } from '../types'
import { parseAny } from '../../lib/date'

const BATCH = 12
const VIEW_KEY = 'hl-stories-view-v1'
const SCROLL_KEY = 'hl-stories-scroll-v1'

const TYPES: { key: EntryKind | 'all'; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'daily', label: '日常' },
  { key: 'date', label: '相处' },
  { key: 'emotion', label: '心情' },
  { key: 'interest', label: '兴趣' },
  { key: 'health', label: '健康' },
]

function readView(): { query: string; type: EntryKind | 'all'; limit: number } {
  try {
    const raw = sessionStorage.getItem(VIEW_KEY)
    if (!raw) return { query: '', type: 'all', limit: BATCH }
    const parsed = JSON.parse(raw) as { query?: string; type?: EntryKind | 'all'; limit?: number }
    return {
      query: typeof parsed.query === 'string' ? parsed.query : '',
      type: parsed.type && TYPES.some((item) => item.key === parsed.type) ? parsed.type : 'all',
      limit: typeof parsed.limit === 'number' && parsed.limit >= BATCH ? parsed.limit : BATCH,
    }
  } catch {
    return { query: '', type: 'all', limit: BATCH }
  }
}

export default function Stories() {
  const s = useSnapshot()
  const { editable } = useSnapshotState()
  const reload = useAuthorReload()
  const initialView = useMemo(readView, [])
  const [editorOpen, setEditorOpen] = useState(false)
  const [query, setQuery] = useState(initialView.query)
  const [type, setType] = useState<EntryKind | 'all'>(initialView.type)
  const [limit, setLimit] = useState(initialView.limit)

  const filtered = useMemo(() => {
    let list = sortEntriesDesc(s.entries)
    if (type !== 'all') list = list.filter((e) => e.kind === type)
    return searchEntries(list, query)
  }, [s.entries, query, type])

  const shown = filtered.slice(0, limit)
  const groups = groupByMonth(shown)
  const hasMore = filtered.length > shown.length

  useEffect(() => {
    try {
      sessionStorage.setItem(VIEW_KEY, JSON.stringify({ query, type, limit }))
    } catch {
      /* 会话存储不可用时只影响返回恢复，不影响浏览 */
    }
  }, [query, type, limit])

  useEffect(() => {
    try {
      const saved = Number(sessionStorage.getItem(SCROLL_KEY) || 0)
      if (saved > 0) requestAnimationFrame(() => window.scrollTo(0, saved))
    } catch {
      /* noop */
    }
  }, [])

  const rememberPosition = () => {
    try {
      sessionStorage.setItem(SCROLL_KEY, String(window.scrollY))
    } catch {
      /* noop */
    }
  }

  return (
    <div className="v-stories-page mx-auto max-w-[880px]">
      <header className="v-page-header">
        <div>
          <div className="v-eyebrow">THE DAYS WE KEEP</div>
          <h1>我们的故事</h1>
          <p>共 {s.entries.length} 条记录 · 原话与个人观察分开保存，不会被样式合并。</p>
        </div>
        {editable && reload && (
          <button type="button" onClick={() => setEditorOpen(true)} className="btn-primary inline-flex min-h-11 shrink-0 items-center gap-1.5 px-4 text-[13px]">
            <Plus size={15} /> 记一笔
          </button>
        )}
      </header>

      {editable && reload && (
        <Suspense fallback={null}>
          <EntryEditor open={editorOpen} onClose={() => setEditorOpen(false)} onSaved={() => void reload()} />
        </Suspense>
      )}

      <div className="v-story-toolbar">
        <div className="v-story-search">
          <Search size={15} aria-hidden="true" />
          <input
            value={query}
            aria-label="搜索故事"
            onChange={(e) => {
              setQuery(e.target.value)
              setLimit(BATCH)
            }}
            placeholder="搜索标题、正文、原话或标签"
          />
          {query && (
            <button
              type="button"
              onClick={() => {
                setQuery('')
                setLimit(BATCH)
              }}
              aria-label="清除搜索"
            >
              <X size={14} />
            </button>
          )}
        </div>

        <div className="v-filter-row v-scroll-x" role="group" aria-label="按记录类型筛选">
          {TYPES.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => {
                setType(t.key)
                setLimit(BATCH)
              }}
              aria-pressed={type === t.key}
              className={type === t.key ? 'v-filter-chip active' : 'v-filter-chip'}
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
        <div className="v-story-groups">
          {groups.map((g) => (
            <section key={g.key} className="v-story-month">
              <h2>
                <span>{g.label}</span>
                <small>{g.entries.length} 条</small>
              </h2>
              <ul className="v-story-list">
                {g.entries.map((e) => (
                  <StoryRow key={e.id} entry={e} photoIds={e.photoIds} onOpen={rememberPosition} />
                ))}
              </ul>
            </section>
          ))}

          {hasMore && (
            <button type="button" onClick={() => setLimit((value) => value + BATCH)} className="v-load-more">
              加载更多（还有 {filtered.length - shown.length} 条）
            </button>
          )}
          {!hasMore && filtered.length > BATCH && <p className="v-list-end">已显示全部 {filtered.length} 条</p>}
        </div>
      )}
    </div>
  )
}

function StoryThumb({ photo, title }: { photo: PublicPhoto; title: string }) {
  const [failed, setFailed] = useState(false)
  return failed ? (
    <div className="v-story-row-fallback" aria-label="图片加载失败">图片暂时无法读取</div>
  ) : (
    <img src={photo.media.thumb.url} alt={photo.caption || `${title}的照片`} loading="lazy" onError={() => setFailed(true)} />
  )
}

function StoryRow({ entry, photoIds, onOpen }: { entry: PublicEntry; photoIds: string[]; onOpen: () => void }) {
  const s = useSnapshot()
  const photos = s.photos.filter((p) => photoIds.includes(p.id))
  const excerpt = entryExcerpt(entry, 116)
  const date = parseAny(entry.occurredAt)
  const day = String(date.getDate()).padStart(2, '0')
  const month = `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, '0')}`

  return (
    <li>
      <Link to={`/stories/${entry.id}`} className="v-story-row" onClick={onOpen}>
        <div className="v-story-row-date" aria-hidden="true">
          <b>{day}</b>
          <small>{month}</small>
        </div>

        <div className="v-story-row-main">
          <div className="v-story-row-meta">
            <span>{KIND_LABEL[entry.kind]}</span>
            {entry.mood && (
              <Pill className="!border-[#e5ded5] !bg-[#f7f3ed] !text-[#666174]">
                {entry.mood === 'custom' ? entry.moodCustom || '心情' : MOOD_LABEL[entry.mood]}
                {entry.moodLevel ? ` ${entry.moodLevel}/5` : ''}
              </Pill>
            )}
            {entry.quick && <span>快速记录</span>}
          </div>
          <h3>{entry.title}</h3>
          {excerpt && <p className="v-story-row-excerpt">{excerpt}</p>}
          {entry.taSaid && <blockquote>「{entry.taSaid}」</blockquote>}
          {entry.tags.length > 0 && (
            <div className="v-story-row-tags">
              {entry.tags.map((tag) => <span key={tag}>#{tag}</span>)}
              {photos.length > 1 && <span>· {photos.length} 张照片</span>}
            </div>
          )}
        </div>

        {photos[0] && (
          <div className="v-story-row-art">
            <StoryThumb photo={photos[0]} title={entry.title} />
            {photos.length > 1 && <span aria-label={`共 ${photos.length} 张照片`}>{photos.length}</span>}
          </div>
        )}
      </Link>
    </li>
  )
}
