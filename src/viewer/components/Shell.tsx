import { NavLink, Outlet, useLocation } from 'react-router-dom'
import clsx from 'clsx'
import { BookHeart, BookMarked, Images, Home, UserRound, Heart, Puzzle, Settings as SettingsIcon, CalendarCheck } from 'lucide-react'
import { Suspense, useEffect } from 'react'
import { useSnapshot, useSnapshotState } from '../state/SnapshotContext'
import { hasEnabledGames } from '../game/config'
import { SampleBadge } from './bits'
import { fmtDate, parseAny, fmtTime } from '../../lib/date'
import { snapshotCounts } from '../lib/data'
import { TaskBell } from '../author/lazy'

type NavItem = { to: string; label: string; icon: typeof Home; end?: boolean }

const NAV: NavItem[] = [
  { to: '/', label: '首页', icon: Home, end: true },
  { to: '/stories', label: '故事', icon: BookHeart },
  { to: '/album', label: '相册', icon: Images },
  { to: '/archive', label: '档案', icon: UserRound },
]

/**
 * T6 互动入口：**只有这一版快照至少启用一个子玩法时才出现**。
 * 老快照没有子开关时只兼容记忆配对，也不会让访客突然多出新玩法。
 */
function navWithGame(gameOn: boolean): NavItem[] {
  if (!gameOn) return NAV
  return [...NAV, { to: '/game', label: '互动', icon: Puzzle }]
}

/**
 * 作者端独有的「为他记着」入口。
 * 与访客端 NAV 分开维护：待办是私有内容（D-008），
 * 访客端既不显示入口，也没有对应路由。
 */
const AUTHOR_NAV = [
  { to: '/tasks', label: '记着', icon: CalendarCheck, end: false },
  // T5：回忆录是作者自己的整理稿，访客端既没有入口也没有路由
  { to: '/memoir', label: '回忆录', icon: BookMarked, end: false },
]

function PreviewBar({ onExit }: { onExit: () => void }) {
  const s = useSnapshot()
  const counts = snapshotCounts(s)
  return (
    <div className="relative z-30 border-b border-amber-200/70 bg-[#FFF7E8] px-4 py-2 text-[#8A5A2B]">
      <div className="mx-auto flex max-w-[1120px] flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px]">
        <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 font-semibold">
          预览模式 · 未发布草稿
        </span>
        {s.draft ? (
          <span className="text-[#A67744]">
            基于 {s.draft.basedOn} · 新增 {s.draft.addedEntries} 条记录、{s.draft.addedPhotos} 张照片
            <span className="hidden sm:inline"> · 当前草稿共 {counts.entries} 条 / {counts.photos} 张</span>
          </span>
        ) : (
          <span className="text-[#A67744]">
            基于线上版本 {s.manifest.basePublishId ?? '（首次发布）'} · 记录 {counts.entries} 条 · 照片{' '}
            {counts.photos} 张
          </span>
        )}
        <span className="hidden text-[#B98A57] lg:inline">预览不会改变线上内容</span>
        <div className="flex-1" />
        <button
          type="button"
          onClick={onExit}
          className="rounded-full border border-amber-300 bg-white px-2.5 py-0.5 font-medium transition hover:bg-amber-50"
        >
          退出预览
        </button>
      </div>
    </div>
  )
}

export function Shell({
  mode,
  onExitPreview,
  scene,
  source,
  warnings = [],
  editable = false,
}: {
  mode: 'published' | 'preview'
  onExitPreview: () => void
  scene: string
  source: 'sample' | 'snapshot' | 'local'
  warnings?: string[]
  editable?: boolean
}) {
  const s = useSnapshot()
  const loc = useLocation()
  const counts = snapshotCounts(s)

  // 页面切换先回到顶部；故事列表在挂载后会恢复自己的滚动位置。
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [loc.pathname])

  const switchScene = (next: string) => {
    const url = new URL(window.location.href)
    url.searchParams.set('scene', next)
    url.hash = ''
    window.location.assign(url.toString())
  }

  const goPreview = () => {
    const url = new URL(window.location.href)
    url.searchParams.set('mode', 'preview')
    url.hash = '#/'
    window.location.assign(url.toString())
  }

  const name = s.person.displayName || '未设置称呼'
  const publishedAt = s.manifest.publishedAt
  const navItems = navWithGame(hasEnabledGames(s.config))
  const allNav: NavItem[] = editable ? [...navItems, ...AUTHOR_NAV] : navItems

  return (
    <div className="flex min-h-full flex-col">
      {mode === 'preview' && <PreviewBar onExit={onExitPreview} />}

      {warnings.length > 0 && (
        <div className="border-b border-rose-soft/40 bg-[#FFF3F1] px-4 py-1.5 text-[11.5px] text-[#8E4850]">
          <div className="mx-auto max-w-[1120px]">清单与内容数量不一致：{warnings.join('；')}</div>
        </div>
      )}

      <header className="v-shell-header sticky top-0 z-40 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-[1120px] items-center gap-3 px-4">
          <NavLink to="/" className="flex min-w-0 items-center gap-2">
            <Heart size={16} className="shrink-0 text-[#8a759e]" fill="currentColor" />
            <span className="v-brand-name truncate text-[16px] text-[#292635]">{name}</span>
            {mode === 'preview' ? (
              <span className="inline-flex shrink-0 items-center rounded-full bg-amber-500/15 px-2 py-0.5 text-[10.5px] font-medium text-[#8A5A2B]">
                预览
              </span>
            ) : source === 'local' ? (
              <span className="inline-flex shrink-0 items-center rounded-full bg-rose-soft/15 px-2 py-0.5 text-[10.5px] font-medium text-rose-deep">
                编辑模式
              </span>
            ) : source === 'sample' ? (
              <SampleBadge />
            ) : (
              <span className="inline-flex shrink-0 items-center rounded-full bg-[#EEF5EC] px-2 py-0.5 text-[10.5px] font-medium text-[#4F6B45]">
                已发布
              </span>
            )}
          </NavLink>

          <div className="flex-1" />

          {editable && (
            <Suspense fallback={null}>
              <TaskBell />
            </Suspense>
          )}

          {editable && (
            <NavLink
              to="/settings"
              aria-label="设置"
              className={({ isActive }) =>
                clsx(
                  'flex h-9 w-9 items-center justify-center rounded-full transition',
                  isActive ? 'bg-rose-soft/15 text-rose-deep' : 'text-ink-500 hover:bg-cream-100',
                )
              }
            >
              <SettingsIcon size={18} />
            </NavLink>
          )}

          <nav className="hidden items-center gap-1 md:flex">
            {allNav.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                end={n.end}
                className={({ isActive }) => clsx('v-top-nav-link', isActive && 'active')}
              >
                {n.label}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>

      <main className="v-shell-main mx-auto w-full max-w-[1200px] flex-1 px-4 pb-[calc(84px+env(safe-area-inset-bottom,0px))] pt-4 sm:px-6 md:pb-16 lg:px-10">
        <Outlet />
      </main>

      <footer className="border-t border-cream-200 bg-[#FFF9F3] px-4 pb-[calc(84px+env(safe-area-inset-bottom,0px))] pt-6 text-[11px] leading-relaxed text-ink-500 md:pb-8">
        <div className="mx-auto max-w-[1120px] space-y-3">
          {source === 'local' ? (
            <p className="max-w-[720px]">
              当前是<strong className="font-medium text-ink-700">作者编辑模式</strong>
              ：页面上的改动直接写入本机数据库。对外发布仍需单独操作，访客看不到这里的内容。
            </p>
          ) : source === 'snapshot' ? (
            <p className="max-w-[720px]">
              本页读取作者主动发布的<strong className="font-medium text-ink-700">只读快照</strong>
              ：内容来自发布清单，访客不能编辑；不连接作者设备、数据库或云端 AI。
            </p>
          ) : (
            <p className="max-w-[720px]">
              本页是《心意簿》展示端的<strong className="font-medium text-ink-700">合成数据原型</strong>
              ：称呼、寄语、照片与记录均为示例，不代表任何真实发布的个人内容。
            </p>
          )}
          {source === 'sample' && (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
              <span className="text-ink-300">演示场景：</span>
              {[
                { key: 'demo', label: '默认演示' },
                { key: 'empty', label: '空态' },
                { key: 'stress', label: '压力数据' },
              ].map((it) => (
                <button
                  key={it.key}
                  type="button"
                  onClick={() => switchScene(it.key)}
                  className={clsx(
                    'rounded-full border px-2 py-0.5 transition',
                    scene === it.key
                      ? 'border-rose-soft bg-rose-soft/15 font-medium text-rose-deep'
                      : 'border-cream-300 bg-white text-ink-500 hover:bg-cream-100',
                  )}
                >
                  {it.label}
                </button>
              ))}
              <span className="text-cream-300">|</span>
              <button
                type="button"
                onClick={goPreview}
                className="rounded-full border border-cream-300 bg-white px-2 py-0.5 text-ink-500 transition hover:bg-cream-100"
              >
                作者发布预览
              </button>
            </div>
          )}
          <p className="text-ink-300">
            发布版本 {s.manifest.publishId}
            {publishedAt && ` · ${fmtDate(parseAny(publishedAt))} ${fmtTime(parseAny(publishedAt))}`} · 记录{' '}
            {counts.entries} · 照片 {counts.photos} · 纪念日 {counts.anniversaries}
            <span className="mx-1.5">·</span>
            当前路径 {loc.pathname}
          </p>
        </div>
      </footer>

      <nav className="v-bottom-nav fixed bottom-0 left-0 right-0 z-40 backdrop-blur-md md:hidden" aria-label="手机主导航">
        {/* 作者七项内容入口全部直接可见；设置仍保留在右上角，避免窄屏挤成第八项。 */}
        <div
          className="grid"
          style={{
            paddingBottom: 'var(--safe-bottom)',
            gridTemplateColumns: `repeat(${allNav.length || 4}, minmax(0, 1fr))`,
          }}
        >
          {allNav.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              className={({ isActive }) => clsx('v-bottom-nav-link', isActive && 'active')}
            >
              {({ isActive }) => (
                <>
                  <n.icon size={19} strokeWidth={isActive ? 2.1 : 1.7} />
                  <span>{n.label}</span>
                </>
              )}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  )
}
