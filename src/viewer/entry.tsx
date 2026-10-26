import React from 'react'
import ReactDOM from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import ViewerApp from './ViewerApp'
import { ErrorBoundary } from '../components/ErrorBoundary'
import './viewer.css'

/**
 * 自愈：清掉同源下由作者端注册的旧 Service Worker 缓存。
 *
 * 背景：作者端 (`author.html`) 会注册 `sw.js` 做离线缓存，而它与访客端同域，
 * 所以访客页同样受该 SW 管辖。早期版本的 SW 把云端数据接口
 * （`/.cloud/database/rest/heartlog_public_*`）当成静态资源做了「缓存优先」，
 * 导致作者重新发布后，访客端一直读到旧快照 —— 表现为「改了但展示端不变」
 * 和「图片全部加载失败」。
 *
 * SW 本身已修（见 public/sw.js 的 isCloudApi），但已经装过旧 SW 的设备
 * 缓存里仍存着那些坏响应。这里在访客端启动时主动清一次：
 * 只删含云端接口的缓存条目 + 注销旧 SW，不碰 IndexedDB，也不影响离线能力。
 * 用 localStorage 记一次，避免每次访问都清。
 */
async function healStaleCloudCache(): Promise<void> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return
  // 只在真的装了 SW 时才动手：没装过 SW 的设备读到的就是最新内容，无需清理，
  // 也避免在访客端做任何多余的存储写入（访客端必须保持零本地数据库）。
  if (!navigator.serviceWorker.controller) return
  const FLAG = 'hl-sw-healed-v2'
  try {
    if (localStorage.getItem(FLAG)) return
    const regs = await navigator.serviceWorker.getRegistrations()
    for (const reg of regs) {
      // 注销旧 SW，让下一次加载拿到修好的版本；页面本身不受影响
      await reg.unregister().catch(() => undefined)
    }
    if (typeof caches !== 'undefined') {
      for (const name of await caches.keys()) {
        const cache = await caches.open(name)
        const reqs = await cache.keys()
        for (const req of reqs) {
          const p = new URL(req.url).pathname
          if (p.startsWith('/.cloud/') || p.includes('heartlog_public_')) {
            await cache.delete(req).catch(() => undefined)
          }
        }
      }
    }
    localStorage.setItem(FLAG, '1')
  } catch {
    // 清理失败不影响展示：SW 已修，下次加载会走新逻辑
  }
}

void healStaleCloudCache()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <HashRouter>
        <ViewerApp />
      </HashRouter>
    </ErrorBoundary>
  </React.StrictMode>,
)
