/* 心意簿 Service Worker —— 静态资源离线缓存（HTML 走网络优先，保证更新可用） */
const CACHE = 'heartlog-v3'
const PRECACHE = ['./', './index.html', './author.html', './manifest.webmanifest', './author.webmanifest', './icons/icon.svg']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(PRECACHE).catch(() => undefined)).then(() => self.skipWaiting()),
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
    // 两个入口共用一个 worker，缓存键必须按路径区分：
    // 早期实现把所有导航响存成 './index.html'，打开作者端会覆盖访客首屏，离线时看到错页。
    const isAuthor = new URL(req.url).pathname.endsWith('author.html')
    const key = isAuthor ? './author.html' : './index.html'
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone()
          caches.open(CACHE).then((c) => c.put(key, copy)).catch(() => undefined)
          return res
        })
        .catch(() => caches.match(key).then((r) => r || Response.error())),
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
