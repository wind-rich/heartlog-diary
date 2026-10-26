import { lazy } from 'react'

/**
 * 编辑组件一律懒加载。
 *
 * 原因：故事/相册/档案/首页这些页面同时被访客端和作者端复用。
 * 如果静态引入 editors（它会带进 Dexie 与数据库代码），
 * 访客端也会被迫下载数据库 chunk，破坏「访客不加载数据库」的边界。
 * 改成 lazy 后，只有作者端点开编辑时才会请求这段代码。
 */
export const EntryEditor = lazy(() => import('./editors').then((m) => ({ default: m.EntryEditor })))
export const PersonEditor = lazy(() => import('./editors').then((m) => ({ default: m.PersonEditor })))
export const DeleteEntryButton = lazy(() => import('./editors').then((m) => ({ default: m.DeleteEntryButton })))
export const PhotoUploadButton = lazy(() => import('./editors').then((m) => ({ default: m.PhotoUploadButton })))
export const DeletePhotoButton = lazy(() => import('./editors').then((m) => ({ default: m.DeletePhotoButton })))

/* 档案页（偏好 / 心愿 / 礼物 / 健康 / 画像 / 纪念日 / 回顾）的编辑器 */
export const ArchiveItemEditor = lazy(() => import('./archiveEditors').then((m) => ({ default: m.ArchiveItemEditor })))
export const ArchiveDeleteButton = lazy(() =>
  import('./archiveEditors').then((m) => ({ default: m.ArchiveDeleteButton })),
)
