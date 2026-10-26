import { Suspense, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import clsx from 'clsx'
import {
  ArrowRight,
  ArrowUpRight,
  BookHeart,
  CalendarDays,
  Heart,
  Images,
  Music4,
  Pause,
  Play,
  Sparkles,
  UserRound,
} from 'lucide-react'
import { useSnapshot, useSnapshotState } from '../state/SnapshotContext'
import { useAuthorReload } from '../author/AuthorReload'
import { PersonEditor } from '../author/lazy'
import {
  avatarUrlFor,
  DIRECTION_LABEL,
  anniversaryDateText,
  daysLeftText,
  daysSinceDate,
  photosDesc,
  recentEntries,
  snapshotCounts,
  upcomingAnniversaries,
  WISH_LABEL,
} from '../lib/data'
import { UniverseMap, type UniverseNodeSpec } from '../components/UniverseMap'
import { PreviewPanel } from '../components/PreviewPanel'
import { EntryCard } from '../components/EntryCard'
import { PhotoTile } from '../components/Photos'
import { EmptyState, Pill, SectionHead } from '../components/bits'
import { fmtDate, parseAny } from '../../lib/date'

const NODE_META = {
  photos: { label: '照片', icon: Images, accent: '#F0B48A' },
  stories: { label: '故事', icon: BookHeart, accent: '#E8917F' },
  anniversary: { label: '纪念日', icon: CalendarDays, accent: '#F2CB86' },
  wishes: { label: '心愿', icon: Sparkles, accent: '#C9A6D8' },
  archive: { label: '档案', icon: UserRound, accent: '#9DC0C8' },
} as const

type NodeKey = keyof typeof NODE_META

export default function Home() {
  const s = useSnapshot()
  const { editable } = useSnapshotState()
  const reload = useAuthorReload()
  const [personEditing, setPersonEditing] = useState(false)
  const counts = snapshotCounts(s)
  const [active, setActive] = useState<NodeKey | null>(null)
  const [paused, setPaused] = useState(() => {
    if (typeof window === 'undefined') return false
    return window.localStorage.getItem('hl-viewer-paused') === '1'
  })

  useEffect(() => {
    window.localStorage.setItem('hl-viewer-paused', paused ? '1' : '0')
  }, [paused])

  const nodes: UniverseNodeSpec[] = useMemo(() => {
    const archiveCount = s.preferences.length + s.insights.length + s.health.length + s.gifts.length + s.summaries.length
    const raw: Record<NodeKey, number> = {
      photos: s.photos.length,
      stories: s.entries.length,
      anniversary: s.anniversaries.length,
      wishes: s.wishes.length,
      archive: archiveCount,
    }
    return (Object.keys(NODE_META) as NodeKey[]).map((key) => ({
      key,
      label: NODE_META[key].label,
      icon: NODE_META[key].icon,
      accent: NODE_META[key].accent,
      count: raw[key] > 0 ? raw[key] : null,
    }))
  }, [s])

  const upcoming = upcomingAnniversaries(s)
  const next = upcoming[0]
  const recent = recentEntries(s, 3)
  const featured = photosDesc(s).slice(0, 10)
  const wishesOpen = s.wishes.filter((w) => w.status === 'wish')
  const avatar = avatarUrlFor(s)
  const days = s.person.meetDate ? daysSinceDate(s.person.meetDate) : null

  return (
    <div className="space-y-5">
      {/* ---------------- 宇宙主视觉 ---------------- */}
      <section
        className={clsx(
          'v-universe relative rounded-[26px] border border-[#4A2F3B]/60 px-5 pb-6 pt-5 shadow-[0_20px_60px_-24px_rgba(58,32,44,0.6)] sm:px-7 sm:pb-8 sm:pt-7',
          paused && 'v-motion-paused',
        )}
        data-testid="universe"
      >
        <div className="relative z-10 flex items-center gap-2">
          <span className="v-universe-kicker inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-[#F3D4BE]/25 bg-white/5 px-2.5 py-1 text-[10.5px] tracking-wide text-[#F0D6C6]/80">
            <Heart size={10} className="text-[#F2A7A0]" fill="currentColor" />
            以他为中心的宇宙
          </span>
          <div className="flex-1" />
          <button
            type="button"
            onClick={() => setPaused((p) => !p)}
            aria-pressed={paused}
            className="inline-flex min-h-11 items-center gap-1 whitespace-nowrap rounded-full border border-[#F3D4BE]/20 bg-white/5 px-2.5 py-1 text-[10.5px] text-[#F0D6C6]/75 transition hover:bg-white/10"
          >
            {paused ? <Play size={10} /> : <Pause size={10} />}
            {paused ? '已暂停' : '动效'}
          </button>
        </div>

        <div className="relative z-10 mt-2 grid grid-cols-1 items-center gap-3 lg:mt-0 lg:grid-cols-[minmax(0,1fr)_420px] lg:gap-6">
          <div className="order-1 lg:order-2">
            {editable && reload && (
              <>
                <div className="mt-1 flex justify-center">
                  <button
                    type="button"
                    onClick={() => setPersonEditing(true)}
                    className="rounded-full border border-[#F3D4BE]/25 bg-white/5 px-2.5 py-1 text-[11px] text-[#F0D6C6]/85 transition hover:bg-white/10"
                  >
                    编辑人物资料
                  </button>
                </div>
                <Suspense fallback={null}>
                  <PersonEditor
                    open={personEditing}
                    onClose={() => setPersonEditing(false)}
                    onSaved={() => void reload()}
                  />
                </Suspense>
              </>
            )}
            <UniverseMap
              name={s.person.displayName || '未设置称呼'}
              avatarUrl={avatar}
              archiveHref="/archive?tab=portrait"
              tagline={s.config.tagline || '还没有写寄语'}
              nodes={nodes}
              activeKey={active}
              onSelect={(k) => setActive(k)}
            />
          </div>

          <div className="order-2 px-1 lg:order-1 lg:pl-2">
            <p className="hidden text-[11px] tracking-[0.2em] text-[#E9C7B3]/55 lg:block">OUR LITTLE UNIVERSE</p>
            <h1 className="mx-auto mt-0 max-w-[340px] text-balance text-center text-[21px] font-semibold leading-snug text-[#FDF1E7] sm:text-[25px] lg:mx-0 lg:mt-3 lg:max-w-none lg:text-left lg:text-[29px]">
              {s.config.tagline || '关于你的每一件小事，都值得被记住'}
            </h1>
            <p className="v-clamp-3 mx-auto mt-2 max-w-[360px] text-center text-[12.5px] leading-relaxed text-[#EBD3C3]/80 lg:mx-0 lg:block lg:overflow-visible lg:text-left">
              {s.person.intro || '这里会写下关于他的小事：说过的话、喜欢的东西、一起过的日子。'}
            </p>

            <div className="mt-4 hidden items-stretch justify-start overflow-hidden rounded-2xl border border-[#F3D4BE]/15 bg-white/[0.045] lg:flex">
              {[
                { label: '相识', value: days === null ? '—' : String(days), unit: '天' },
                { label: '记录', value: String(counts.entries), unit: '条' },
                { label: '照片', value: String(counts.photos), unit: '张' },
              ].map((it, i) => (
                <div
                  key={it.label}
                  className={clsx('flex-1 px-3 py-2.5 text-center lg:flex-none lg:px-5 lg:text-left', i > 0 && 'border-l border-[#F3D4BE]/10')}
                >
                  <div className="text-[10px] text-[#E9C7B3]/55">{it.label}</div>
                  <div className="mt-0.5 text-[17px] font-semibold tabular-nums text-[#FDF1E7]">
                    {it.value}
                    <span className="ml-0.5 text-[10px] font-normal text-[#E9C7B3]/60">{it.unit}</span>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 lg:justify-start">
              <p className="text-[11px] text-[#E9C7B3]/70">轻点星球，看看围绕他的故事</p>
              <Link to="/archive?tab=portrait" className="inline-flex min-h-11 items-center gap-1 text-[11.5px] font-medium text-[#F3C6AA] transition hover:text-[#FFE4CF]">
                走进他的档案 <ArrowUpRight size={13} />
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ---------------- 相伴天数 / 下一纪念日 ---------------- */}
      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="rounded-2xl border border-cream-200 bg-white p-4 shadow-card">
          <div className="flex items-center gap-2 text-[11.5px] text-ink-500">
            <Heart size={13} className="text-rose-soft" />
            从相识那天算起
          </div>
          {days === null ? (
            <p className="mt-2 text-[13px] text-ink-500">还没有设置相识日</p>
          ) : (
            <>
              <p className="mt-1.5 text-[26px] font-semibold leading-none tabular-nums text-ink-900">
                {days}
                <span className="ml-1 text-[12px] font-normal text-ink-500">天</span>
              </p>
              <p className="mt-1.5 text-[11.5px] text-ink-500">
                {fmtDate(parseAny(s.person.meetDate as string))} · 只表示相识，不代表恋爱起始
              </p>
            </>
          )}
        </div>

        <div className="rounded-2xl border border-cream-200 bg-white p-4 shadow-card">
          <div className="flex items-center gap-2 text-[11.5px] text-ink-500">
            <CalendarDays size={13} className="text-[#D9A24A]" />
            下一个纪念日
          </div>
          {!next ? (
            <p className="mt-2 text-[13px] text-ink-500">还没有设置纪念日</p>
          ) : (
            <>
              <p className="mt-1.5 flex items-baseline gap-2 text-[15px] font-semibold text-ink-900">
                {next.item.name}
                <span className="text-[12px] font-normal text-rose-deep">{daysLeftText(next.daysLeft)}</span>
              </p>
              <p className="mt-1.5 text-[11.5px] text-ink-500">
                {fmtDate(next.date)}
                {typeof next.years === 'number' && next.years > 0 ? ` · 第 ${next.years} 个` : ''} ·{' '}
                {anniversaryDateText(next.item)}
              </p>
            </>
          )}
        </div>
      </section>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_336px] lg:gap-6">
        <div className="min-w-0 space-y-6">
          {/* ---------------- 最近回忆 ---------------- */}
          <section>
            <SectionHead title="最近回忆" hint={`共 ${counts.entries} 条记录，按发生时间倒序`} to="/stories" />
            {recent.length === 0 ? (
              <EmptyState
                icon={<BookHeart size={22} />}
                title="还没有已发布的记录"
                desc="作者的记录发布之后，这里会按时间显示最近的几条。"
                compact
              />
            ) : (
              <div className="space-y-2.5">
                {recent.map((e) => (
                  <EntryCard key={e.id} entry={e} photos={s.photos.filter((p) => p.entryId === e.id)} />
                ))}
              </div>
            )}
          </section>

          {/* ---------------- 精选照片 ---------------- */}
          <section>
            <SectionHead title="精选照片" hint={`共 ${counts.photos} 张`} to="/album" />
            {featured.length === 0 ? (
              <EmptyState icon={<Images size={22} />} title="还没有照片" desc="发布照片后会出现在这里。" compact />
            ) : (
              <div className="v-scroll-x -mx-4 flex snap-x gap-2.5 overflow-x-auto px-4 pb-1">
                {featured.map((p) => (
                  <Link key={p.id} to="/album" className="shrink-0 snap-start">
                    <PhotoTile photo={p} className="h-[132px] w-[104px]" />
                    <p className="mt-1.5 w-[104px] truncate text-[10.5px] text-ink-500">{p.caption || '未填写说明'}</p>
                  </Link>
                ))}
              </div>
            )}
          </section>

          {/* ---------------- 音乐 ---------------- */}
          {s.config.sections.music && s.config.music && (
            <section>
              <SectionHead title="这一首" hint="由你点击播放，不会自动开始" />
              <div className="flex items-center gap-3 rounded-2xl border border-cream-200 bg-white p-3.5 shadow-card">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-cream-100 text-rose-deep">
                  <Music4 size={18} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13.5px] font-medium text-ink-900">{s.config.music.title}</p>
                  <p className="mt-0.5 text-[11px] text-ink-500">{s.config.music.artist || '未填写来源'}</p>
                </div>
                <button
                  type="button"
                  disabled={!s.config.music.src}
                  className="rounded-full border border-cream-300 px-3 py-1.5 text-[11.5px] text-ink-500 disabled:cursor-not-allowed disabled:opacity-60"
                  title={s.config.music.src ? '播放' : '还没有配置音源'}
                >
                  {s.config.music.src ? '播放' : '音源未配置'}
                </button>
              </div>
            </section>
          )}
        </div>

        {/* ---------------- 侧栏 ---------------- */}
        <aside className="min-w-0 space-y-5">
          <section>
            <SectionHead title="分类入口" hint="首页没有展示的记录，都能从分类里找到" />
            <div className="overflow-hidden rounded-2xl border border-cream-200 bg-white shadow-card">
              {nodes.map((n, i) => {
                const Icon = n.icon
                return (
                  <button
                    key={n.key}
                    type="button"
                    onClick={() => setActive(n.key)}
                    className={clsx(
                      'flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-cream-50',
                      i > 0 && 'border-t border-cream-200',
                    )}
                  >
                    <span className="flex h-7 w-7 items-center justify-center rounded-lg" style={{ background: `${n.accent}1f` }}>
                      <Icon size={14} style={{ color: n.accent }} />
                    </span>
                    <span className="flex-1 text-[13px] text-ink-700">{n.label}</span>
                    <span className="text-[11.5px] tabular-nums text-ink-300">{n.count === null ? '暂无' : n.count}</span>
                    <ArrowRight size={13} className="text-ink-300" />
                  </button>
                )
              })}
            </div>
          </section>

          <section>
            <SectionHead title="关于他" to="/archive?tab=portrait" actionLabel="档案" />
            <div className="rounded-2xl border border-cream-200 bg-white p-4 shadow-card">
              <p className="text-[12.5px] leading-relaxed text-ink-700">
                {s.person.intro || '还没有填写介绍。'}
              </p>
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {s.person.tags.length ? (
                  s.person.tags.map((t) => <Pill key={t}>#{t}</Pill>)
                ) : (
                  <span className="text-[11px] text-ink-300">还没有标签</span>
                )}
              </div>
              <div className="mt-3 space-y-1 border-t border-cream-200 pt-2.5 text-[11.5px] text-ink-500">
                <div className="flex justify-between">
                  <span>生日</span>
                  <span className="text-ink-700">
                    {s.person.birthday ? `${s.person.birthday}${s.person.calendarType === 'lunar' ? '（农历）' : ''}` : '未设置'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>星座</span>
                  <span className="text-ink-700">{s.person.zodiac || '未设置'}</span>
                </div>
                <div className="flex justify-between">
                  <span>心愿</span>
                  <span className="text-ink-700">
                    {counts.wishes} 条{wishesOpen.length ? ` · ${wishesOpen.length} 条还没实现` : ''}
                  </span>
                </div>
              </div>
            </div>
          </section>

          <section>
            <SectionHead title="发布信息" />
            <div className="rounded-2xl border border-cream-200 bg-white p-4 text-[11.5px] leading-relaxed text-ink-500 shadow-card">
              <p>
                版本 <span className="text-ink-700">{s.manifest.publishId}</span>
              </p>
              {s.manifest.publishedAt && <p className="mt-1">发布于 {fmtDate(parseAny(s.manifest.publishedAt))}</p>}
              <p className="mt-1">
                已发布 {counts.entries} 条记录、{counts.photos} 张照片、{counts.anniversaries} 个纪念日
              </p>
            </div>
          </section>
        </aside>
      </div>

      {/* ---------------- 节点预览面板 ---------------- */}
      {active && (
        <PreviewPanel
          title={NODE_META[active].label}
          subtitle={nodeSubtitle(active, counts, wishesOpen.length)}
          icon={NODE_META[active].icon}
          accent={NODE_META[active].accent}
          onClose={() => setActive(null)}
          allHref={
            active === 'photos'
              ? '/album'
              : active === 'stories'
                ? '/stories'
                : active === 'anniversary'
                  ? '/archive?tab=anniversary'
                  : active === 'wishes'
                    ? '/archive?tab=wishes'
                    : '/archive'
          }
        >
          <NodePreviewBody node={active} />
        </PreviewPanel>
      )}
    </div>
  )
}

function nodeSubtitle(key: NodeKey, counts: ReturnType<typeof snapshotCounts>, openWishes: number): string {
  switch (key) {
    case 'photos':
      return `共 ${counts.photos} 张，按拍摄时间倒序`
    case 'stories':
      return `共 ${counts.entries} 条，包含原话与个人观察`
    case 'anniversary':
      return counts.anniversaries ? `共 ${counts.anniversaries} 个纪念日` : '还没有设置纪念日'
    case 'wishes':
      return openWishes ? `${counts.wishes} 条心愿，${openWishes} 条还没实现` : `共 ${counts.wishes} 条心愿`
    case 'archive':
      return `偏好 ${counts.preferences} · 画像 ${counts.insights} · 健康 ${counts.health}`
  }
}

function NodePreviewBody({ node }: { node: NodeKey }) {
  const s = useSnapshot()
  const counts = snapshotCounts(s)

  if (node === 'photos') {
    const list = photosDesc(s).slice(0, 6)
    if (!list.length) return <EmptyState icon={<Images size={20} />} title="还没有照片" compact />
    return (
      <div className="grid grid-cols-3 gap-1.5">
        {list.map((p) => (
          <PhotoTile key={p.id} photo={p} className="aspect-square" />
        ))}
      </div>
    )
  }

  if (node === 'stories') {
    const list = recentEntries(s, 3)
    if (!list.length) return <EmptyState icon={<BookHeart size={20} />} title="还没有记录" compact />
    return (
      <div className="space-y-2">
        {list.map((e) => (
          <EntryCard key={e.id} entry={e} photos={s.photos.filter((p) => p.entryId === e.id)} compact />
        ))}
      </div>
    )
  }

  if (node === 'anniversary') {
    const list = upcomingAnniversaries(s).slice(0, 4)
    if (!list.length) return <EmptyState icon={<CalendarDays size={20} />} title="还没有设置纪念日" compact />
    return (
      <ul className="space-y-2">
        {list.map((u) => (
          <li key={u.item.id} className="rounded-xl border border-cream-200 bg-[#FFFDFA] px-3 py-2.5">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[13px] font-medium text-ink-900">{u.item.name}</span>
              <span className="text-[11.5px] text-rose-deep">{daysLeftText(u.daysLeft)}</span>
            </div>
            <div className="mt-0.5 text-[11px] text-ink-500">
              {fmtDate(u.date)} · {anniversaryDateText(u.item)}
            </div>
          </li>
        ))}
      </ul>
    )
  }

  if (node === 'wishes') {
    const list = s.wishes.slice(0, 5)
    if (!list.length) return <EmptyState icon={<Sparkles size={20} />} title="还没有心愿" compact />
    return (
      <ul className="space-y-2">
        {list.map((w) => (
          <li key={w.id} className="rounded-xl border border-cream-200 bg-[#FFFDFA] px-3 py-2.5">
            <div className="flex items-start justify-between gap-2">
              <span className="text-[12.5px] leading-snug text-ink-900">{w.content}</span>
              <Pill tone={w.status === 'wish' ? 'rose' : 'neutral'}>{WISH_LABEL[w.status]}</Pill>
            </div>
            {w.note && <p className="mt-1 text-[11px] text-ink-500">{w.note}</p>}
          </li>
        ))}
      </ul>
    )
  }

  // archive
  const prefs = s.preferences.slice(0, 3)
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2 text-center">
        {[
          { label: '偏好', value: counts.preferences },
          { label: '画像', value: counts.insights },
          { label: '健康', value: counts.health },
        ].map((it) => (
          <div key={it.label} className="rounded-xl bg-cream-50 px-2 py-2.5">
            <div className="text-[16px] font-semibold tabular-nums text-ink-900">{it.value}</div>
            <div className="text-[10.5px] text-ink-500">{it.label}</div>
          </div>
        ))}
      </div>
      {prefs.length ? (
        <ul className="space-y-1.5">
          {prefs.map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-2 rounded-lg bg-[#FFFDFA] px-3 py-2 text-[12px]">
              <span className="truncate text-ink-700">{p.name}</span>
              <span className="shrink-0 text-[10.5px] text-ink-300">{DIRECTION_LABEL[p.direction]}</span>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState title="还没有偏好记录" compact />
      )}
    </div>
  )
}
