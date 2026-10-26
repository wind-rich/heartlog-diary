import { useCallback, useEffect, useState, Suspense, lazy } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { AppProvider, useApp } from './state/app'
import { ConfirmProvider, ToastProvider } from './components/ui'
import { StartGate } from './components/StartGate'
import { SnapshotProvider } from './viewer/state/SnapshotContext'
import { Shell } from './viewer/components/Shell'
import { AuthorReloadContext } from './viewer/author/AuthorReload'
import { buildLocalSnapshot, revokeLocalMedia } from './viewer/data/local'
import type { PublishedSnapshot } from './viewer/types'
import Home from './viewer/pages/Home'
import Stories from './viewer/pages/Stories'
import Album from './viewer/pages/Album'
import Archive from './viewer/pages/Archive'
import RecordDetail from './viewer/pages/RecordDetail'
import GamePage from './viewer/pages/Game'
import SettingsPage from './pages/Settings'

/**
 * T8「为他记着」清单页由作者端懒加载。
 * 直接静态 import 会把 tasks 模块（含 Dexie 查询）带进共享 chunk，
 * 而 Home / Shell 是访客端也用的，必须保持访客端零数据库依赖。
 */
const Tasks = lazy(() => import('./viewer/pages/Tasks'))

/**
 * T5 回忆录页面同样懒加载：它带进 memoir 模块与导出器，
 * 访客端连路由都不该有，更不该下载这段代码。
 */
const Memoir = lazy(() => import('./viewer/pages/Memoir'))

/**
 * 作者端：不再使用旧的「今天/时间线/回顾」界面，
 * 直接套用访客端那套页面（宇宙首页 / 故事 / 相册 / 档案），
 * 数据来自本机 Dexie，页面上额外出现编辑入口。
 */

function Loading({ text }: { text: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-cream-50">
      <div className="flex flex-col items-center gap-3 text-ink-300">
        <div className="text-3xl">♥</div>
        <div className="text-[13px]">{text}</div>
      </div>
    </div>
  )
}

function AuthorViewer() {
  const [snapshot, setSnapshot] = useState<PublishedSnapshot | null>(null)
  const [failed, setFailed] = useState('')

  const reload = useCallback(async () => {
    try {
      const snap = await buildLocalSnapshot()
      if (!snap) {
        setFailed('本机没有可用的人物档案')
        return
      }
      setSnapshot(snap)
    } catch (err) {
      setFailed((err as Error).message)
    }
  }, [])

  useEffect(() => {
    void reload()
    return () => revokeLocalMedia()
  }, [reload])

  if (failed) return <Loading text={`读取本机数据失败：${failed}`} />
  if (!snapshot) return <Loading text="正在读取本机记录…" />

  return (
    <AuthorReloadContext.Provider value={reload}>
      <SnapshotProvider value={{ snapshot, mode: 'published', scene: 'demo', source: 'local', editable: true }}>
        <Routes>
          <Route element={<Shell mode="published" onExitPreview={() => undefined} scene="demo" source="local" editable />}>
            <Route index element={<Home />} />
            <Route path="stories" element={<Stories />} />
            <Route path="stories/:id" element={<RecordDetail />} />
            <Route path="album" element={<Album />} />
            <Route path="game" element={<GamePage />} />
            <Route path="archive" element={<Archive />} />
            <Route
              path="tasks"
              element={
                <Suspense fallback={<Loading text="正在打开「为他记着」…" />}>
                  <Tasks />
                </Suspense>
              }
            />
            <Route
              path="memoir"
              element={
                <Suspense fallback={<Loading text="正在打开回忆录…" />}>
                  <Memoir />
                </Suspense>
              }
            />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </SnapshotProvider>
    </AuthorReloadContext.Provider>
  )
}

function Root() {
  const { loading, phase } = useApp()
  if (loading || phase === 'loading') return <Loading text="正在打开你的记录…" />
  if (phase === 'empty') return <StartGate />
  return <AuthorViewer />
}

export default function App() {
  return (
    <AppProvider>
      <ToastProvider>
        <ConfirmProvider>
          <Root />
        </ConfirmProvider>
      </ToastProvider>
    </AppProvider>
  )
}
