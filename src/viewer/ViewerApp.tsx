import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import type { PublishedSnapshot, SnapshotScene } from './types'
import { VIEWER_FORMAT_VERSION } from './types'
import { SnapshotProvider } from './state/SnapshotContext'
import { getDraftSnapshot, getSnapshot } from './data/sample'
import { fetchCloudSnapshot, fetchPublishState, fetchThumbMap } from './data/cloud'
import { Shell } from './components/Shell'
import Home from './pages/Home'
import Stories from './pages/Stories'
import Album from './pages/Album'
import Archive from './pages/Archive'
import RecordDetail from './pages/RecordDetail'
import GamePage from './pages/Game'

function readScene(): SnapshotScene {
  const raw = new URLSearchParams(window.location.search).get('scene')
  return raw === 'empty' || raw === 'stress' || raw === 'broken' || raw === 'long' ? raw : 'demo'
}

/**
 * 真实快照地址（静态模式），优先级：
 *   1. URL 参数 ?snapshot=<url>
 *   2. 页面 meta[name="hl-snapshot"]（发布构建时注入）
 */
function readSnapshotUrl(): string | null {
  const raw = new URLSearchParams(window.location.search).get('snapshot')
  const fromMeta = document.querySelector('meta[name="hl-snapshot"]')?.getAttribute('content') || ''
  const target = raw || fromMeta
  if (!target) return null
  try {
    return new URL(target, window.location.href).toString()
  } catch {
    return null
  }
}

/** 把媒体相对路径解析成可请求的绝对地址；同时校验清单与内容是否自洽 */
function prepareSnapshot(
  input: unknown,
  snapshotUrl: string,
  rebaseMedia = true,
): { snapshot: PublishedSnapshot; warnings: string[] } {
  const snap = input as PublishedSnapshot
  if (!snap || typeof snap !== 'object') throw new Error('快照不是有效的 JSON 对象')
  if (!snap.manifest) throw new Error('快照缺少 manifest')
  if (snap.manifest.formatVersion !== VIEWER_FORMAT_VERSION) {
    throw new Error(`格式版本不匹配：快照为 ${snap.manifest.formatVersion}，展示端支持 ${VIEWER_FORMAT_VERSION}`)
  }
  for (const key of ['entries', 'photos', 'preferences', 'wishes', 'gifts', 'health', 'insights', 'summaries', 'statuses', 'anniversaries']) {
    if (!Array.isArray((snap as unknown as Record<string, unknown>)[key])) {
      throw new Error(`快照缺少 ${key} 列表`)
    }
  }

  // 云端模式下媒体地址是空的（按需从媒体表取），不能把空串解析成当前页地址
  const media = !rebaseMedia
    ? snap.photos
    : snap.photos.map((p) => {
        const url = (raw: string) => {
          if (!raw) return ''
          try {
            return new URL(raw, snapshotUrl).toString()
          } catch {
            return raw
          }
        }
        return {
          ...p,
          media: {
            thumb: { ...p.media.thumb, url: url(p.media.thumb.url) },
            full: { ...p.media.full, url: url(p.media.full.url) },
          },
        }
      })

  const warnings: string[] = []
  const counts = snap.manifest.counts || {}
  const actual: Record<string, number> = {
    entries: snap.entries.length,
    photos: snap.photos.length,
    preferences: snap.preferences.length,
    wishes: snap.wishes.length,
    gifts: snap.gifts.length,
    health: snap.health.length,
    insights: snap.insights.length,
    summaries: snap.summaries.length,
    statuses: snap.statuses.length,
    anniversaries: snap.anniversaries.length,
    gameContent: snap.gameContent?.length ?? 0,
  }
  for (const [key, n] of Object.entries(actual)) {
    if (typeof counts[key] === 'number' && counts[key] !== n) {
      warnings.push(`${key}：清单写 ${counts[key]}，实际 ${n}`)
    }
  }

  return { snapshot: { ...snap, photos: media }, warnings }
}

function CenteredCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#FFFCF8] px-6">
      <div className="w-full max-w-[360px] rounded-2xl border border-cream-200 bg-white p-5 text-center shadow-sm">
        <div className="text-[15px] font-semibold text-ink-900">{title}</div>
        <div className="mt-2 text-[12.5px] leading-relaxed text-ink-500">{children}</div>
      </div>
    </div>
  )
}

type Resolved =
  | { status: 'loading' }
  | { status: 'ready'; snapshot: PublishedSnapshot; warnings: string[] }
  | { status: 'sample' }
  | { status: 'error'; message: string }
  /** 作者主动撤回：明确告知「暂时没有开放」，不再回退到静态旧内容 */
  | { status: 'offline'; note: string }

/**
 * 展示端根组件。
 * 注意：这里不挂载作者端的 AppProvider，不创建人物，不读作者数据库。
 * 数据来源优先级：?snapshot=（静态快照）→ 云端已发布快照 → 合成演示。
 * 云端只读只用一个 publishable key 请求头，不加载云 SDK。
 */
export default function ViewerApp() {
  const snapshotUrl = useMemo(readSnapshotUrl, [])
  const scene = useMemo(readScene, [])
  const mode = useMemo<'published' | 'preview'>(
    () => (new URLSearchParams(window.location.search).get('mode') === 'preview' ? 'preview' : 'published'),
    [],
  )
  const forced = useMemo(() => new URLSearchParams(window.location.search).get('source'), [])

  const [resolved, setResolved] = useState<Resolved>({ status: 'loading' })

  useEffect(() => {
    // 预览模式、显式演示、带 ?scene= 的合成场景：不碰网络（保证场景可复现、离线可用）
    const hasScene = new URLSearchParams(window.location.search).has('scene')
    if (mode === 'preview' || forced === 'sample' || hasScene) {
      setResolved({ status: 'sample' })
      return
    }

    let cancelled = false

    /** 静态快照（显式 ?snapshot= 或构建注入的 meta） */
    const loadStatic = async (): Promise<boolean> => {
      if (!snapshotUrl) return false
      try {
        const res = await fetch(snapshotUrl, { cache: 'no-store' })
        if (!res.ok) throw new Error(`读取失败：HTTP ${res.status}`)
        const prepared = prepareSnapshot(await res.json(), snapshotUrl)
        if (!cancelled) setResolved({ status: 'ready', ...prepared })
        return true
      } catch (err) {
        if (!cancelled) setResolved({ status: 'error', message: err instanceof Error ? err.message : String(err) })
        return true
      }
    }

    // 显式指定静态地址，或要求只看静态：不走云端
    const explicitParam = new URLSearchParams(window.location.search).get('snapshot')
    if (explicitParam || forced === 'static') {
      ;(async () => {
        if (!(await loadStatic()) && !cancelled) setResolved({ status: 'sample' })
      })()
      return () => {
        cancelled = true
      }
    }

    // 默认：先问云端「有没有已发布的新版本」，没有再退回构建时的静态快照
    ;(async () => {
      try {
        const snap = await fetchCloudSnapshot()
        if (snap) {
          const thumbs = await fetchThumbMap()
          const withMedia: PublishedSnapshot = {
            ...snap,
            photos: snap.photos.map((p) => ({
              ...p,
              media: { ...p.media, thumb: { ...p.media.thumb, url: thumbs.get(p.id) || p.media.thumb.url } },
            })),
          }
          const prepared = prepareSnapshot(withMedia, window.location.href, false)
          if (!cancelled) setResolved({ status: 'ready', ...prepared })
          return
        }
      } catch {
        // 云端不可用（离线/策略变更）不是致命错误，继续走静态
      }
      if (cancelled) return

      /**
       * 云端没有 live 快照时，先问访问指针再决定要不要退回静态。
       *
       * 作者撤回后快照会下线（is_live=false），如果这里直接退回构建时的静态
       * 快照，撤回就完全无效——访客看到的还是那套旧内容。只有当指针说
       * 「已经下线」时停在这里；指针不存在（从没发布过）才继续走静态/演示。
       */
      const publishState = await fetchPublishState()
      if (cancelled) return
      if (publishState.state === 'retracted') {
        setResolved({ status: 'offline', note: publishState.note })
        return
      }

      if (!(await loadStatic()) && !cancelled) setResolved({ status: 'sample' })
    })()

    return () => {
      cancelled = true
    }
  }, [mode, forced, snapshotUrl])

  const sample = useMemo(
    () => (mode === 'preview' ? getDraftSnapshot(scene) : getSnapshot(scene)),
    [mode, scene],
  )

  const exitPreview = () => {
    const url = new URL(window.location.href)
    url.searchParams.delete('mode')
    url.hash = '#/'
    window.location.assign(url.toString())
  }

  if (resolved.status === 'loading') {
    return (
      <CenteredCard title="正在读取发布内容">
        内容来自作者发布的只读快照，不连接作者设备或数据库。
      </CenteredCard>
    )
  }

  if (resolved.status === 'offline') {
    return (
      <CenteredCard title="这个页面暂时没有开放">
        <p>{resolved.note ? resolved.note : '作者把展示页暂时下线了，稍后再来看看吧。'}</p>
        <p className="mt-2 text-[11.5px] text-ink-300">
          这里不会显示旧内容：下线是作者的选择，不是加载失败。
        </p>
      </CenteredCard>
    )
  }

  if (resolved.status === 'error') {
    return (
      <CenteredCard title="内容读取失败">
        <p>{resolved.message}</p>
        <div className="mt-3 flex justify-center gap-2">
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="rounded-full border border-cream-300 bg-white px-3 py-1 text-[12px] text-ink-700"
          >
            重试
          </button>
          <a href="./viewer.html?source=sample" className="rounded-full bg-rose-deep px-3 py-1 text-[12px] text-white">
            看合成演示
          </a>
        </div>
      </CenteredCard>
    )
  }

  if (resolved.status === 'ready') {
    return (
      <SnapshotProvider value={{ snapshot: resolved.snapshot, mode: 'published', scene: 'demo', source: 'snapshot' }}>
        <Routes>
          <Route
            element={
              <Shell
                mode="published"
                onExitPreview={exitPreview}
                scene={scene}
                source="snapshot"
                warnings={resolved.warnings}
              />
            }
          >
            <Route index element={<Home />} />
            <Route path="stories" element={<Stories />} />
            <Route path="stories/:id" element={<RecordDetail />} />
            <Route path="album" element={<Album />} />
            {/* T6：入口是否显示由快照配置决定，路由本身常备（直接访问也不会 404） */}
            <Route path="game" element={<GamePage />} />
            <Route path="archive" element={<Archive />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </SnapshotProvider>
    )
  }

  return (
    <SnapshotProvider value={{ snapshot: sample, mode, scene, source: 'sample' }}>
      <Routes>
        <Route element={<Shell mode={mode} onExitPreview={exitPreview} scene={scene} source="sample" />}>
          <Route index element={<Home />} />
          <Route path="stories" element={<Stories />} />
          <Route path="stories/:id" element={<RecordDetail />} />
          <Route path="album" element={<Album />} />
          <Route path="game" element={<GamePage />} />
          <Route path="archive" element={<Archive />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </SnapshotProvider>
  )
}
