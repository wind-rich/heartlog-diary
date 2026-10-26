import React from 'react'
import ReactDOM from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import App from './App'
import { ErrorBoundary } from './components/ErrorBoundary'
import './viewer/viewer.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <HashRouter>
        <App />
      </HashRouter>
    </ErrorBoundary>
  </React.StrictMode>,
)

// 渲染之外的异常（Promise、事件回调）不会进错误边界，这里补一个可见提示
function showFatal(message: string) {
  if (document.getElementById('hl-fatal')) return
  const box = document.createElement('div')
  box.id = 'hl-fatal'
  box.style.cssText =
    'position:fixed;left:12px;right:12px;bottom:12px;z-index:99999;background:#FFF3F1;border:1px solid #E7B4B4;border-radius:12px;padding:10px 12px;font:12px/1.6 system-ui;color:#7A3B42;white-space:pre-wrap;max-height:50vh;overflow:auto'
  box.textContent = `页面出错了（异步）：\n${message}`
  document.body.appendChild(box)
}
window.addEventListener('error', (e) => showFatal(e.message || String(e.error)))
window.addEventListener('unhandledrejection', (e) => showFatal(String((e.reason && e.reason.message) || e.reason)))

// 离线缓存：只在生产构建时注册，避免开发时被旧缓存干扰
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => undefined)
  })
}
