import { Suspense, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import clsx from 'clsx'
import {
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
import { PersonEditor, PhotoCaptionButton, TaskSummaryCard } from '../author/lazy'
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
import { Lightbox, PhotoTile } from '../components/Photos'
import { EmptyState, Pill, SectionHead } from '../components/bits'
import { MilestoneGrid, PhotoPostcard, StoryCoverCard, GameCoverCard } from '../components/ContentBlocks'
import { enabledGameIds, GAME_META } from '../game/config'
import { gameAvailability } from '../game/availability'
import { usablePhotos } from '../game/memory'
import { fmtDate, parseAny } from '../../lib/date'

const NODE_META = {
  photos: { label: '照片', icon: Images, accent: '#D9BC89' },
  stories: { label: '故事', icon: BookHeart, accent: '#C8B8E2' },
  anniversary: { label: '纪念日', icon: CalendarDays, accent: '#E4C993' },
  wishes: { label: '心愿', icon: Sparkles, accent: '#B9ABD9' },
  archive: { label: '档案', icon: UserRound, accent: '#A9BED4' },
} as const

type NodeKey = keyof typeof NODE_META

export default function Home() {
  const s = useSnapshot()
  const { editable } = useSnapshotState()
  const reload = useAuthorReload()
  const [personEditing, setPersonEditing] = useState(false)
  const counts = snapshotCounts(s)
  const [active, setActive] = useState<NodeKey | null>(null)
  const [box, setBox] = useState<number | null>(null)
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
  const featured = photosDesc(s).slice(0, 3)
  const wishesOpen = s.wishes.filter((w) => w.status === 'wish')
  const avatar = avatarUrlFor(s)
  const days = s.person.meetDate ? daysSinceDate(s.person.meetDate) : null
  const enabled = enabledGameIds(s.config)
  const photoCount = usablePhotos(s.photos).length
  const homeGames = enabled.filter((id) => gameAvailability(id, s, photoCount).ok).slice(0, 2)

  return (
    <div className="v-home space-y-6 sm:space-y-8">
      {/* 作者到期提醒必须优先于氛围主视觉；访客不会加载这个私有模块。 */}
      {editable && reload && (
        <Suspense fallback={null}>
          <TaskSummaryCard />
        </Suspense>
      )}

      <section
        className={clsx(
          'v-universe relative rounded-[26px] border border-white/10 px-5 pb-6 pt-5 sm:px-7 sm:pb-8 sm:pt-7',
          paused && 'v-motion-paused',
        )}
        data-testid="universe"
      >
        <div className="relative z-10 flex items-center gap-2">
          <span className="v-universe-kicker inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-[#E4D9F2]/20 bg-white/5 px-2.5 py-1 text-[10.5px] tracking-wide text-[#EEE7F7]/80">
            <Heart size={10} className="text-[#D9BC89]" fill="currentColor" />
            以他为中心的宇宙
          </span>
          <div className="flex-1" />
          <button
            type="button"
            onClick={() => setPaused((p) => !p)}
            aria-pressed={paused}
            className="inline-flex min-h-11 items-center gap-1 whitespace-nowrap rounded-full border border-[#E4D9F2]/20 bg-white/5 px-2.5 py-1 text-[10.5px] text-[#EEE7F7]/80 transition hover:bg-white/10"
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
                    className="rounded-full border border-[#E4D9F2]/20 bg-white/5 px-2.5 py-1 text-[11px] text-[#EEE7F7]/85 transition hover:bg-white/10"
                  >
                    编辑人物资料
                  </button>
                </div>
                <Suspense fallback={null}>
                  <PersonEditor open={personEditing} onClose={() => setPersonEditing(false)} onSaved={() => void reload()} />
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
            <p className="hidden text-[11px] tracking-[0.2em] text-[#C8B8E2]/65 lg:block">OUR LITTLE UNIVERSE</p>
            <h1 className="v-hero-title mx-auto mt-0 max-w-[380px] text-balance text-center text-[23px] leading-snug text-[#F7F3ED] sm:text-[27px] lg:mx-0 lg:mt-3 lg:max-w-none lg:text-left lg:text-[34px]">
              {s.config.tagline || '关于你的每一件小事，都值得被记住'}
            </h1>
            <p className="v-clamp-3 mx-auto mt-2 max-w-[380px] text-center text-[13px] leading-[1.8] text-[#E7E0EF]/80 lg:mx-0 lg:block lg:overflow-visible lg:text-left">
              {s.person.intro || '这里会写下关于他的小事：说过的话、喜欢的东西、一起过的日子。'}
            </p>
            <div className="mt-3 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 lg:justify-start">
              <p className="text-[11px] text-[#C8B8E2]/75">轻点星球，看看围绕他的故事</p>
              <Link to="/archive?tab=portrait" className="inline-flex min-h-11 items-center gap-1 text-[11.5px] font-medium text-[#E4C993] transition hover:text-[#FFF3D9]">
                走进他的档案 <ArrowUpRight size={13} />
              </Link>
            </div>
          </div>
        </div>
      </section>

      <MilestoneGrid days={days} meetDate={s.person.meetDate} next={next} storyCount={counts.entries} photoCount={counts.photos} />

      <section className="v-home-block" aria-labelledby="home-photos-title">
        <SectionHead eyebrow="LITTLE POSTCARDS OF US" title="把光，留在这里" hint="最近照片，直接展开三帧时光" to="/album" actionLabel="全部照片" />
        <span id="home-photos-title" className="sr-only">最近照片</span>
        {featured.length === 0 ? (
          <EmptyState icon={<Images size={22} />} title="还没有照片" desc="发布照片后会出现在这里。" compact />
        ) : (
          <div className="v-photo-strip">
            {featured.map((photo, index) => (
              <PhotoPostcard key={photo.id} photo={photo} eager={index === 0} onOpen={() => setBox(index)} />
            ))}
          </div>
        )}
      </section>

      <section className="v-home-block" aria-labelledby="home-stories-title">
        <SectionHead eyebrow="MOMENTS, KEPT CLOSE" title="最近，想记住的事" hint={`共 ${counts.entries} 篇，按发生时间倒序`} to="/stories" actionLabel="翻开故事" />
        <span id="home-stories-title" className="sr-only">最近故事</span>
        {recent.length === 0 ? (
          <EmptyState icon={<BookHeart size={22} />} title="还没有已发布的记录" desc="作者的记录发布之后，这里会按时间显示最近的几条。" compact />
        ) : (
          <div className="v-home-stories">
            {recent.map((entry) => (
              <StoryCoverCard key={entry.id} entry={entry} photos={s.photos.filter((p) => p.entryId === entry.id)} />
            ))}
          </div>
        )}
      </section>

      {enabled.length > 0 && (
        <section className="v-home-block" aria-labelledby="home-games-title">
          <SectionHead eyebrow="A SMALL BREAK TOGETHER" title="一起玩一会儿" hint="从当前已开启且素材齐全的玩法里推荐" to="/game" actionLabel="全部玩法" />
          <span id="home-games-title" className="sr-only">精选互动</span>
          {homeGames.length === 0 ? (
            <EmptyState icon={<Sparkles size={22} />} title="玩法还缺一点素材" desc="互动大厅里会标明每种玩法还缺什么。" compact />
          ) : (
            <div className="v-home-games">
              {homeGames.map((id) => {
                const meta = GAME_META[id]
                const state = gameAvailability(id, s, photoCount)
                return <GameCoverCard key={id} id={id} title={meta.title} description={meta.description} duration={meta.duration} stateText={state.text} available={state.ok} />
              })}
            </div>
          )}
        </section>
      )}

      {s.config.sections.music && s.config.music && (
        <section className="v-home-block">
          <SectionHead title="这一首" hint="由你点击播放，不会自动开始" />
          <div className="v-paper-section flex items-center gap-3 p-4">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#EEE8F3] text-[#665080]"><Music4 size={18} /></span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13.5px] font-medium text-[#292635]">{s.config.music.title}</p>
              <p className="mt-0.5 text-[11px] text-[#666174]">{s.config.music.artist || '未填写来源'}</p>
            </div>
            <button type="button" disabled={!s.config.music.src} className="btn-ghost min-h-11 px-3 text-[11.5px]" title={s.config.music.src ? '播放' : '还没有配置音源'}>
              {s.config.music.src ? '播放' : '音源未配置'}
            </button>
          </div>
        </section>
      )}

      <section className="v-home-note" aria-label="寄语">
        <p>“ {s.config.tagline || '关于你的每一件小事，都值得被记住'} ”</p>
        <small>A NOTE FOR YOU</small>
      </section>

      {active && (
        <PreviewPanel
          title={NODE_META[active].label}
          subtitle={nodeSubtitle(active, counts, wishesOpen.length)}
          icon={NODE_META[active].icon}
          accent={NODE_META[active].accent}
          onClose={() => setActive(null)}
          allHref={active === 'photos' ? '/album' : active === 'stories' ? '/stories' : active === 'anniversary' ? '/archive?tab=anniversary' : active === 'wishes' ? '/archive?tab=wishes' : '/archive'}
        >
          <NodePreviewBody node={active} />
        </PreviewPanel>
      )}

      {box !== null && featured[box] && (
        <Lightbox
          photos={featured}
          index={box}
          onIndexChange={setBox}
          onClose={() => setBox(null)}
          renderCaption={
            editable && reload
              ? (photo) => (
                  <div className="mt-2">
                    <Suspense fallback={null}>
                      <PhotoCaptionButton photoId={photo.id} caption={photo.caption} onSaved={() => void reload()} />
                    </Suspense>
                  </div>
                )
              : undefined
          }
        />
      )}
    </div>
  )
}

function nodeSubtitle(key: NodeKey, counts: ReturnType<typeof snapshotCounts>, openWishes: number): string {
  switch (key) {
    case 'photos': return `共 ${counts.photos} 张，按拍摄时间倒序`
    case 'stories': return `共 ${counts.entries} 条，包含原话与个人观察`
    case 'anniversary': return counts.anniversaries ? `共 ${counts.anniversaries} 个纪念日` : '还没有设置纪念日'
    case 'wishes': return openWishes ? `${counts.wishes} 条心愿，${openWishes} 条还没实现` : `共 ${counts.wishes} 条心愿`
    case 'archive': return `偏好 ${counts.preferences} · 画像 ${counts.insights} · 健康 ${counts.health}`
  }
}

function NodePreviewBody({ node }: { node: NodeKey }) {
  const s = useSnapshot()
  const counts = snapshotCounts(s)

  if (node === 'photos') {
    const list = photosDesc(s).slice(0, 6)
    if (!list.length) return <EmptyState icon={<Images size={20} />} title="还没有照片" compact />
    return <div className="grid grid-cols-3 gap-1.5">{list.map((p) => <PhotoTile key={p.id} photo={p} className="aspect-square" />)}</div>
  }

  if (node === 'stories') {
    const list = recentEntries(s, 3)
    if (!list.length) return <EmptyState icon={<BookHeart size={20} />} title="还没有记录" compact />
    return <div className="space-y-2">{list.map((e) => <EntryCard key={e.id} entry={e} photos={s.photos.filter((p) => p.entryId === e.id)} compact />)}</div>
  }

  if (node === 'anniversary') {
    const list = upcomingAnniversaries(s).slice(0, 4)
    if (!list.length) return <EmptyState icon={<CalendarDays size={20} />} title="还没有设置纪念日" compact />
    return (
      <ul className="space-y-2">
        {list.map((u) => (
          <li key={u.item.id} className="rounded-xl border border-cream-200 bg-[#FFFDFA] px-3 py-2.5">
            <div className="flex items-baseline justify-between gap-2"><span className="text-[13px] font-medium text-ink-900">{u.item.name}</span><span className="text-[11.5px] text-[#665080]">{daysLeftText(u.daysLeft)}</span></div>
            <div className="mt-0.5 text-[11px] text-ink-500">{fmtDate(u.date)} · {anniversaryDateText(u.item)}</div>
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
            <div className="flex items-start justify-between gap-2"><span className="text-[12.5px] leading-snug text-ink-900">{w.content}</span><Pill tone={w.status === 'wish' ? 'rose' : 'neutral'}>{WISH_LABEL[w.status]}</Pill></div>
            {w.note && <p className="mt-1 text-[11px] text-ink-500">{w.note}</p>}
          </li>
        ))}
      </ul>
    )
  }

  const prefs = s.preferences.slice(0, 3)
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2 text-center">
        {[{ label: '偏好', value: counts.preferences }, { label: '画像', value: counts.insights }, { label: '健康', value: counts.health }].map((it) => (
          <div key={it.label} className="rounded-xl bg-cream-50 px-2 py-2.5"><div className="text-[16px] font-semibold tabular-nums text-ink-900">{it.value}</div><div className="text-[10.5px] text-ink-500">{it.label}</div></div>
        ))}
      </div>
      {prefs.length ? (
        <ul className="space-y-1.5">{prefs.map((p) => <li key={p.id} className="flex items-center justify-between gap-2 rounded-lg bg-[#FFFDFA] px-3 py-2 text-[12px]"><span className="truncate text-ink-700">{p.name}</span><span className="shrink-0 text-[10.5px] text-ink-300">{DIRECTION_LABEL[p.direction]}</span></li>)}</ul>
      ) : <EmptyState title="还没有偏好记录" compact />}
    </div>
  )
}
