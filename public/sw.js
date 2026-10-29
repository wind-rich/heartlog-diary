/* 心意簿 Service Worker —— 静态资源离线缓存（HTML 走网络优先，保证更新可用） */
// 两个入口各有自己的 worker（/v/sw.js、/a/sw.js），scope 不同，缓存必须分开：
// 同源下 CacheStorage 是共享的，用同一名字会让作者端与访客端互相覆盖。
const SCOPE_PATH = new URL(self.registration.scope).pathname
const CACHE = `heartlog-v4${SCOPE_PATH.replace(/\//g, '-').replace(/-$/, '')}`
const HOME_URL = new URL('./index.html', self.registration.scope).href
const PRECACHE = ['./', './index.html', './manifest.webmanifest', '../icons/icon.svg']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      // 逐条写入：addAll 是原子的，缺一个（比如没网或某个文件 403）会导致整批都不缓存
      .then((cache) => Promise.allSettled(PRECACHE.map((url) => cache.add(url))))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

/**
 * 绝不缓存的路径：云端数据接口。
 *
 * 关键前提：`CLOUD_PUBLIC_CONFIG.endpoint` 与站点**同源**（同一个
 * heartlog-viewer.app.workbuddy.host），因此「跨域就放行」这条规则挡不住它。
 * 一旦让这些请求落到下面的「缓存优先」分支，`/heartlog_public_media?...`
 * 这个 URL 就会被永久缓存 —— 作者重新发布后，访客端读到的还是旧快照的
 * 图片与内容，表现为「改了但展示端不变」「图片全部加载失败」。
 * 这类请求必须直连网络，不进缓存。
 */
function isCloudApi(url) {
  return (
    url.pathname.startsWith('/.cloud/') ||
    url.pathname.includes('heartlog_public_') ||
    url.pathname.includes('heartlog_sync_') ||
    url.pathname.includes('heartlog_backups')
  )
}

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return

  // 云端数据：直连，不读缓存也不写缓存
  if (isCloudApi(url)) return

  // 页面导航：网络优先，离线回落到缓存
  if (req.mode === 'navigate') {
    // 每个入口有自己的 worker 与 scope，首屏键固定为该 scope 下的 index.html
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone()
          caches.open(CACHE).then((c) => c.put(HOME_URL, copy)).catch(() => undefined)
          return res
        })
        .catch(() => caches.match(HOME_URL).then((r) => r || Response.error())),
    )
    return
  }

  // 带 hash 的静态资源：缓存优先
  event.respondWith(
    caches.match(req).then(
      (hit) =>
        hit ||
        fetch(req)
          .then((res) => {
            if (res.ok) {
              const copy = res.clone()
              caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => undefined)
            }
            return res
          })
          .catch(() => Response.error()),
    ),
  )
})
