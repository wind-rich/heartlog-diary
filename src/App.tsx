import { Navigate, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { BookHeart, CalendarDays, Images, ListTree, Settings as SettingsIcon, UserRound } from 'lucide-react'
import clsx from 'clsx'
import { AppProvider, useApp } from './state/app'
import { ConfirmProvider, ToastProvider } from './components/ui'
import Today from './pages/Today'
import Timeline from './pages/Timeline'
import Album from './pages/Album'
import Review from './pages/Review'
import ProfilePage from './pages/Profile'
import SettingsPage from './pages/Settings'

const NAV = [
  { to: '/today', label: '今天', icon: CalendarDays },
  { to: '/timeline', label: '时间线', icon: ListTree },
  { to: '/album', label: '相册', icon: Images },
  { to: '/review', label: '回顾', icon: BookHeart },
  { to: '/profile', label: '档案', icon: UserRound },
]

function Shell() {
  const { person, loading } = useApp()
  const nav = useNavigate()
  const loc = useLocation()
  const hideNav = loc.pathname.startsWith('/settings')

  if (loading) {
    return (
      <div className="min-h-full flex items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-ink-300">
          <div className="text-3xl">♥</div>
          <div className="text-[13px]">正在打开你的记录…</div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-full flex flex-col bg-cream-50">
      <header className="sticky top-0 z-40 bg-cream-50/92 backdrop-blur-md border-b border-cream-200">
        <div className="max-w-2xl mx-auto px-4 h-14 flex items-center gap-2">
          <button className="flex items-center gap-2 min-w-0" onClick={() => nav('/profile')}>
            <span className="text-rose-deep text-lg leading-none">♥</span>
            <span className="font-semibold text-ink-900 text-[16px] truncate">
              {person?.nickname || person?.name || '心意簿'}
            </span>
          </button>
          <div className="flex-1" />
          <button
            className="w-9 h-9 rounded-full flex items-center justify-center text-ink-500 hover:bg-cream-200"
            onClick={() => nav('/settings')}
            aria-label="设置"
          >
            <SettingsIcon size={19} />
          </button>
        </div>
      </header>

      <main className="flex-1 max-w-2xl w-full mx-auto px-4 pt-4 pb-[calc(84px+var(--safe-bottom))]">
        <Routes>
          <Route path="/" element={<Navigate to="/today" replace />} />
          <Route path="/today" element={<Today />} />
          <Route path="/timeline" element={<Timeline />} />
          <Route path="/album" element={<Album />} />
          <Route path="/review" element={<Review />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/today" replace />} />
        </Routes>
      </main>

      {!hideNav && (
        <nav className="fixed bottom-0 left-0 right-0 z-50 bg-cream-50/95 backdrop-blur-md border-t border-cream-200">
          <div
            className="max-w-2xl mx-auto grid grid-cols-5"
            style={{ paddingBottom: 'var(--safe-bottom)' }}
          >
            {NAV.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                className={({ isActive }) =>
                  clsx(
                    'flex flex-col items-center gap-0.5 py-2.5 transition',
                    isActive ? 'text-rose-deep' : 'text-ink-300',
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    <n.icon size={21} strokeWidth={isActive ? 2.2 : 1.8} />
                    <span className="text-[11px]">{n.label}</span>
                  </>
                )}
              </NavLink>
            ))}
          </div>
        </nav>
      )}
    </div>
  )
}

export default function App() {
  return (
    <AppProvider>
      <ToastProvider>
        <ConfirmProvider>
          <Shell />
        </ConfirmProvider>
      </ToastProvider>
    </AppProvider>
  )
}
