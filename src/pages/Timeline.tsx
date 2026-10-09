import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useSearchParams } from 'react-router-dom'
import { CalendarPlus, ListFilter, Search, X } from 'lucide-react'
import { db, deleteEntryCascade } from '../db/db'
import type { Entry, EntryType } from '../db/types'
import { ENTRY_TYPES, entryTypeMeta } from '../lib/constants'
import { fmtDate, parseAny, relativeDay, toDateStr, WEEK_CN } from '../lib/date'
import { collectFollowUps } from '../lib/stats'
import { collectTags, filterEntries, groupByDay } from '../lib/query'
import EntryCard from '../components/EntryCard'
import EntryEditor from '../components/EntryEditor'
import PhotoViewer from '../components/PhotoViewer'
import { Chips, Empty, Modal, Segmented, useConfirm, useToast } from '../components/ui'
import { useApp } from '../state/app'

type RangeKey = 'all' | '7d' | '30d' | 'year'

export default function Timeline() {
  const { person } = useApp()
  const toast = useToast()
  const confirm = useConfirm()
  const [params, setParams] = useSearchParams()

  const [keyword, setKeyword] = useState('')
  const [types, setTypes] = useState<EntryType[]>([])
  const [tags, setTags] = useState<string[]>([])
  const [range, setRange] = useState<RangeKey>('all')
  const [followUpOnly, setFollowUpOnly] = useState(params.get('followUp') === '1')
  const [filterOpen, setFilterOpen] = useState(false)
  const [editorOpen, setEditorOpen] = useState(false)
  const [editing, setEditing] = useState<Entry | undefined>()
  const [defaultDate, setDefaultDate] = useState<Date | undefined>()
  const [viewer, setViewer] = useState<{ ids: string[]; index: number } | null>(null)

  const pid = person?.id

  useEffect(() => {
    setFollowUpOnly(params.get('followUp') === '1')
  }, [params])

  const allEntries = useLiveQuery(
    async () => (pid ? (await db.entries.where('personId').equals(pid).toArray()).sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : -1)) : []),
    [pid],
  )
  const allHealth = useLiveQuery(async () => (pid ? db.health.where('personId').equals(pid).toArray() : []), [pid])
  const allWishes = useLiveQuery(async () => (pid ? db.wishes.where('personId').equals(pid).toArray() : []), [pid])

  const tagOptions = useMemo(() => collectTags(allEntries ?? []).slice(0, 20), [allEntries])

  const rangeStart = useMemo(() => {
    const now = new Date()
    if (range === '7d') return new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6)
    if (range === '30d') return new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29)
    if (range === 'year') return new Date(now.getFullYear(), 0, 1)
    return undefined
  }, [range])

  const groupFollowUps = useMemo(() => {
    const list = collectFollowUps(allEntries ?? [], allHealth ?? [], allWishes ?? [])
    return new Set(list.filter((f) => f.kind === 'entry').map((f) => f.id))
  }, [allEntries, allHealth, allWishes])

  const filtered = useMemo(() => {
    let list = filterEntries(allEntries ?? [], {
      types: types.length ? types : undefined,
      tags: tags.length ? tags : undefined,
      keyword,
      from: rangeStart,
    })
    if (followUpOnly) list = list.filter((e) => e.followUp && !e.followUpDone && groupFollowUps.has(e.id))
    return list
  }, [allEntries, types, tags, keyword, rangeStart, followUpOnly, groupFollowUps])

  const groups = useMemo(() => groupByDay(filtered), [filtered])

  const activeFilters = (types.length ? 1 : 0) + (tags.length ? 1 : 0) + (range !== 'all' ? 1 : 0) + (followUpOnly ? 1 : 0)

  if (!pid) return null

  const removeEntry = async (e: Entry) => {
    const ok = await confirm({
      title: '删除这条记录？',
      desc: '文字记录会被永久删除，照片会保留在相册里。',
      danger: true,
      confirmText: '删除',
    })
    if (!ok) return
    await deleteEntryCascade(e.id)
    toast('已删除')
  }

  return (
    <div className="space-y-3">
      {/* 搜索栏 */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-300" />
          <input
            className="input pl-9"
            placeholder="搜索标题、经过、TA 说的话、标签…"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            style={{ fontSize: 16 }}
          />
          {keyword && (
            <button
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-300"
              onClick={() => setKeyword('')}
              aria-label="清空"
            >
              <X size={16} />
            </button>
          )}
        </div>
        <button
          className={`btn-ghost !px-3 relative ${activeFilters ? 'border-rose-soft text-rose-deep' : ''}`}
          onClick={() => setFilterOpen(true)}
          aria-label="筛选"
        >
          <ListFilter size={17} />
          {activeFilters > 0 && (
            <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-rose-deep text-white text-[10px] flex items-center justify-center">
              {activeFilters}
            </span>
          )}
        </button>
        <button
          className="btn-primary !px-3"
          onClick={() => {
            setEditing(undefined)
            setDefaultDate(new Date())
            setEditorOpen(true)
          }}
          aria-label="补记"
        >
          <CalendarPlus size={17} />
        </button>
      </div>

      {/* 类型快捷筛选 */}
      <div className="flex gap-1.5 overflow-x-auto no-scrollbar pb-0.5">
        <button
          className={types.length === 0 ? 'chip-on shrink-0' : 'chip-off shrink-0'}
          onClick={() => setTypes([])}
        >
          全部
        </button>
        {ENTRY_TYPES.map((t) => (
          <button
            key={t.value}
            className={`shrink-0 ${types.includes(t.value) ? 'chip-on' : 'chip-off'}`}
            onClick={() => setTypes((prev) => (prev.includes(t.value) ? prev.filter((x) => x !== t.value) : [...prev, t.value]))}
          >
            <span>{t.emoji}</span>
            {t.label}
          </button>
        ))}
      </div>

      {/* 结果统计 */}
      <div className="flex items-center gap-2 px-1 text-[12.5px] text-ink-300">
        <span>{filtered.length} 条记录</span>
        {followUpOnly && <span className="text-[#A9762C]">· 只看待跟进</span>}
        {(keyword || tags.length > 0 || range !== 'all') && (
          <button
            className="ml-auto text-rose-deep"
            onClick={() => {
              setKeyword('')
              setTags([])
              setTypes([])
              setRange('all')
              setFollowUpOnly(false)
              setParams({})
            }}
          >
            清空筛选
          </button>
        )}
      </div>

      {/* 列表 */}
      {groups.length === 0 ? (
        <Empty
          title="没有找到符合条件的记录"
          desc="换个关键词，或者清除筛选条件试试。也可以点右上角的＋补记以前发生的事。"
        />
      ) : (
        <div className="space-y-5">
          {groups.map((g) => {
            const d = parseAny(g.date)
            return (
              <section key={g.date}>
                <div className="sticky top-14 z-30 -mx-4 px-4 py-1.5 bg-cream-50/95 backdrop-blur-sm flex items-center gap-2">
                  <span className="text-[14px] font-semibold text-ink-900">{fmtDate(g.date)}</span>
                  <span className="text-[12px] text-ink-300">{WEEK_CN[d.getDay()]}</span>
                  <span className="text-[12px] text-ink-300">· {relativeDay(g.date)}</span>
                  <div className="flex-1" />
                  <button
                    className="text-[12px] text-rose-deep flex items-center gap-0.5"
                    onClick={() => {
                      setEditing(undefined)
                      setDefaultDate(d)
                      setEditorOpen(true)
                    }}
                  >
                    <CalendarPlus size={13} /> 补记
                  </button>
                </div>
                <div className="space-y-3 mt-1">
                  {g.items.map((e) => (
                    <EntryCard
                      key={e.id}
                      entry={e}
                      hideDate
                      onEdit={(x) => {
                        setEditing(x)
                        setEditorOpen(true)
                      }}
                      onDelete={removeEntry}
                      onOpenPhoto={(p, ids) => setViewer({ ids, index: ids.indexOf(p) })}
                    />
                  ))}
                </div>
              </section>
            )
          })}
        </div>
      )}

      {/* 筛选面板 */}
      <Modal
        open={filterOpen}
        onClose={() => setFilterOpen(false)}
        title="筛选"
        footer={
          <div className="flex gap-2">
            <button
              className="btn-ghost flex-1"
              onClick={() => {
                setTypes([])
                setTags([])
                setRange('all')
                setFollowUpOnly(false)
              }}
            >
              重置
            </button>
            <button className="btn-primary flex-[2]" onClick={() => setFilterOpen(false)}>
              查看结果（{filtered.length}）
            </button>
          </div>
        }
      >
        <div className="space-y-5">
          <div>
            <div className="label">时间范围</div>
            <Segmented
              options={[
                { value: 'all', label: '全部' },
                { value: '7d', label: '近 7 天' },
                { value: '30d', label: '近 30 天' },
                { value: 'year', label: '今年' },
              ]}
              value={range}
              onChange={(v) => setRange(v as RangeKey)}
            />
          </div>

          <div>
            <div className="label">事件类型</div>
            <Chips
              options={ENTRY_TYPES.map((t) => ({ value: t.value, label: t.label, emoji: t.emoji }))}
              value={types}
              onChange={(v) => setTypes(v as EntryType[])}
              multi
            />
          </div>

          {tagOptions.length > 0 && (
            <div>
              <div className="label">标签</div>
              <Chips
                options={tagOptions.map((t) => ({ value: t.tag, label: `${t.tag} ${t.count}` }))}
                value={tags}
                onChange={(v) => setTags(v as string[])}
                multi
              />
            </div>
          )}

          <div>
            <div className="label">其他</div>
            <button
              className={followUpOnly ? 'chip-on' : 'chip-off'}
              onClick={() => setFollowUpOnly((v) => !v)}
            >
              只看待跟进
            </button>
          </div>

          <div className="rounded-xl bg-cream-100 p-3 text-[12.5px] text-ink-500 leading-relaxed">
            提示：搜索框支持中文关键词模糊匹配，会同时检索标题、经过、TA 说的话、我的观察和标签。
            {types.length > 0 && ` 当前类型：${types.map((t) => entryTypeMeta(t).label).join('、')}。`}
          </div>
        </div>
      </Modal>

      <EntryEditor
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
        personId={pid}
        entry={editing}
        defaultDate={defaultDate}
      />

      {viewer && <PhotoViewer ids={viewer.ids} startIndex={viewer.index} onClose={() => setViewer(null)} />}
    </div>
  )
}

export { toDateStr }
