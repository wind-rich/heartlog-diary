import { NavLink, Outlet, useLocation } from 'react-router-dom'
import clsx from 'clsx'
import { BookHeart, BookMarked, Images, Home, UserRound, Heart, Puzzle, Settings as SettingsIcon, CalendarCheck } from 'lucide-react'
import { Suspense, useEffect } from 'react'
import { useSnapshot } from '../state/SnapshotContext'
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
    <div className="v-preview-bar">
      <div className="v-preview-bar-inner">
        <span className="v-stamp-tag">预览模式 · 未发布草稿</span>
        {s.draft ? (
          <span>
            基于 {s.draft.basedOn} · 新增 {s.draft.addedEntries} 条记录、{s.draft.addedPhotos} 张照片
            <span className="hidden sm:inline"> · 当前草稿共 {counts.entries} 条 / {counts.photos} 张</span>
          </span>
        ) : (
          <span>
            基于线上版本 {s.manifest.basePublishId ?? '（首次发布）'} · 记录 {counts.entries} 条 · 照片{' '}
            {counts.photos} 张
          </span>
        )}
        <span className="hidden opacity-70 lg:inline">预览不会改变线上内容</span>
        <div className="flex-1" />
        <button type="button" onClick={onExit} className="v-preview-exit">
          退出预览
        </button>
      </div>
    </div>
  )
}

function StatusBadge({ mode, source }: { mode: 'published' | 'preview'; source: 'sample' | 'snapshot' | 'local' }) {
  if (mode === 'preview') return <span className="v-badge v-badge-warn">预览</span>
  if (source === 'local') return <span className="v-badge v-badge-seal">编辑模式</span>
  if (source === 'sample') return <SampleBadge className="v-badge" />
  return <span className="v-badge v-badge-ok">已发布</span>
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
    <div className="v-app">
      {/*
        同一个 <header>：手机上是顶部细条，md 以上变成左侧「目录」栏。
        页眉里始终能读到称呼，测试与读屏都只认这一处。
      */}
      <header className="v-rail">
        <NavLink to="/" className="v-rail-brand">
          <span className="v-rail-seal" aria-hidden="true">
            <Heart size={13} fill="currentColor" />
          </span>
          <span className="min-w-0">
            <span className="v-rail-kicker">心意簿 · HEARTLOG</span>
            <span className="v-brand-name">{name}</span>
          </span>
        </NavLink>
        <div className="v-rail-badge">
          <StatusBadge mode={mode} source={source} />
        </div>

        <nav className="v-rail-nav" aria-label="目录导航">
          <p className="v-rail-label">目录 · CONTENTS</p>
          {allNav.map((n, i) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              className={({ isActive }) => clsx('v-top-nav-link', isActive && 'active')}
            >
              <span className="v-nav-no">{String(i + 1).padStart(2, '0')}</span>
              <span className="v-nav-text">{n.label}</span>
              <n.icon size={15} strokeWidth={1.7} className="v-nav-icon" aria-hidden="true" />
            </NavLink>
          ))}
        </nav>

        <div className="v-rail-spacer" />

        {editable && (
          <div className="v-rail-tools">
            <Suspense fallback={null}>
              <TaskBell />
            </Suspense>
            <NavLink to="/settings" aria-label="设置" className={({ isActive }) => clsx('v-icon-btn', isActive && 'active')}>
              <SettingsIcon size={18} />
            </NavLink>
          </div>
        )}

        <div className="v-rail-meta">
          <p>
            {counts.entries} 篇 · {counts.photos} 帧 · {counts.anniversaries} 个纪念日
          </p>
          {publishedAt && <p>发布于 {fmtDate(parseAny(publishedAt))}</p>}
        </div>
      </header>

      <div className="v-stage">
        {mode === 'preview' && <PreviewBar onExit={onExitPreview} />}

        {warnings.length > 0 && <div className="v-warn-strip">清单与内容数量不一致：{warnings.join('；')}</div>}

        <main className="v-shell-main">
          <Outlet />
        </main>

        <footer className="v-colophon">
          <div className="v-colophon-inner">
            <p className="v-colophon-mark">心意簿 · 只写给一个人的刊物</p>
            {source === 'local' ? (
              <p>
                当前是<strong>作者编辑模式</strong>
                ：页面上的改动直接写入本机数据库。对外发布仍需单独操作，访客看不到这里的内容。
              </p>
            ) : source === 'snapshot' ? (
              <p>
                本页读取作者主动发布的<strong>只读快照</strong>
                ：内容来自发布清单，访客不能编辑；不连接作者设备、数据库或云端 AI。
              </p>
            ) : (
              <p>
                本页是《心意簿》展示端的<strong>合成数据原型</strong>
                ：称呼、寄语、照片与记录均为示例，不代表任何真实发布的个人内容。
              </p>
            )}
            {source === 'sample' && (
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
                <span className="opacity-70">演示场景：</span>
                {[
                  { key: 'demo', label: '默认演示' },
                  { key: 'empty', label: '空态' },
                  { key: 'stress', label: '压力数据' },
                ].map((it) => (
                  <button
                    key={it.key}
                    type="button"
                    onClick={() => switchScene(it.key)}
                    className={clsx('v-colophon-chip', scene === it.key && 'active')}
                  >
                    {it.label}
                  </button>
                ))}
                <span className="opacity-40">|</span>
                <button type="button" onClick={goPreview} className="v-colophon-chip">
                  作者发布预览
                </button>
              </div>
            )}
            <p className="v-colophon-fine">
              发布版本 {s.manifest.publishId}
              {publishedAt && ` · ${fmtDate(parseAny(publishedAt))} ${fmtTime(parseAny(publishedAt))}`} · 记录{' '}
              {counts.entries} · 照片 {counts.photos} · 纪念日 {counts.anniversaries}
              <span className="mx-1.5">·</span>
              当前路径 {loc.pathname}
            </p>
          </div>
        </footer>
      </div>

      <nav className="v-bottom-nav" aria-label="手机主导航">
        {/* 作者七项内容入口全部直接可见；设置仍保留在右上角，避免窄屏挤成第八项。 */}
        <div className="v-dock" style={{ gridTemplateColumns: `repeat(${allNav.length || 4}, minmax(0, 1fr))` }}>
          {allNav.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              className={({ isActive }) => clsx('v-bottom-nav-link', isActive && 'active')}
            >
              {({ isActive }) => (
                <>
                  <n.icon size={18} strokeWidth={isActive ? 2.2 : 1.7} />
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
