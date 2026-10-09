import { db, nowISO, putPhoto, uid } from '../db/db'
import type { Photo } from '../db/types'

/* ------------------------------------------------------------------ */
/* 图片压缩与缩略图                                                    */
/* ------------------------------------------------------------------ */

const urlCache = new Map<string, string>()

async function loadBitmap(file: Blob): Promise<{ width: number; height: number; draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void; close?: () => void }> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bmp = await createImageBitmap(file)
      return {
        width: bmp.width,
        height: bmp.height,
        draw: (ctx, w, h) => ctx.drawImage(bmp, 0, 0, w, h),
        close: () => bmp.close(),
      }
    } catch {
      // 某些浏览器不支持部分格式，回落到 Image
    }
  }
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error('图片解码失败'))
      el.src = url
    })
    return {
      width: img.naturalWidth,
      height: img.naturalHeight,
      draw: (ctx, w, h) => ctx.drawImage(img, 0, 0, w, h),
    }
  } finally {
    // 交给 GC，用 setTimeout 避免过早回收
    setTimeout(() => URL.revokeObjectURL(url), 5000)
  }
}

/** 等比缩放并输出为 Blob；最大边不超过 maxEdge */
export async function resizeImage(file: Blob, maxEdge: number, quality = 0.82): Promise<Blob> {
  const bmp = await loadBitmap(file)
  const scale = Math.min(1, maxEdge / Math.max(bmp.width, bmp.height))
  const w = Math.max(1, Math.round(bmp.width * scale))
  const h = Math.max(1, Math.round(bmp.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    bmp.close?.()
    return file
  }
  ctx.imageSmoothingQuality = 'high'
  bmp.draw(ctx, w, h)
  bmp.close?.()
  const out = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob((b) => resolve(b), 'image/jpeg', quality),
  )
  return out ?? file
}

/* ------------------------------------------------------------------ */
/* 新增照片                                                            */
/* ------------------------------------------------------------------ */

export interface AddPhotoOptions {
  personId: string
  entryId?: string
  giftId?: string
  caption?: string
  tags?: string[]
  keepOriginal?: boolean
  photoMaxEdge?: number
  thumbMaxEdge?: number
  takenAt?: string
}

export async function addPhotoFile(file: File, opts: AddPhotoOptions): Promise<Photo> {
  const keepOriginal = opts.keepOriginal ?? false
  const photoMaxEdge = opts.photoMaxEdge ?? 1920
  const thumbMaxEdge = opts.thumbMaxEdge ?? 400

  const isImage = file.type.startsWith('image/')
  if (!isImage) throw new Error('只能上传图片文件')

  const stored = keepOriginal ? file : await resizeImage(file, photoMaxEdge, 0.85)
  const thumb = await resizeImage(file, thumbMaxEdge, 0.7)

  const photo: Photo = {
    id: uid('ph_'),
    personId: opts.personId,
    blob: stored,
    thumb,
    mime: stored.type || file.type || 'image/jpeg',
    size: stored.size,
    takenAt: opts.takenAt || new Date(file.lastModified || Date.now()).toISOString(),
    caption: opts.caption,
    entryId: opts.entryId,
    giftId: opts.giftId,
    tags: opts.tags ?? [],
    keepOriginal,
    createdAt: nowISO(),
  }
  return putPhoto(photo)
}

export async function addPhotoFiles(files: File[], opts: AddPhotoOptions): Promise<Photo[]> {
  const out: Photo[] = []
  for (const f of files) {
    out.push(await addPhotoFile(f, opts))
  }
  return out
}

/* ------------------------------------------------------------------ */
/* Object URL 缓存（列表渲染复用，避免重复创建）                        */
/* ------------------------------------------------------------------ */

export function photoUrl(id: string, kind: 'thumb' | 'full'): string | undefined {
  return urlCache.get(`${kind}:${id}`)
}

export async function ensurePhotoUrl(id: string, kind: 'thumb' | 'full'): Promise<string | undefined> {
  const key = `${kind}:${id}`
  const cached = urlCache.get(key)
  if (cached) return cached
  const photo = await db.photos.get(id)
  if (!photo) return undefined
  const blob = kind === 'thumb' ? photo.thumb : photo.blob
  const url = URL.createObjectURL(blob)
  urlCache.set(key, url)
  return url
}

export function releasePhotoUrl(id: string, kind: 'thumb' | 'full'): void {
  const key = `${kind}:${id}`
  const url = urlCache.get(key)
  if (url) {
    URL.revokeObjectURL(url)
    urlCache.delete(key)
  }
}

/** 导出用：把 Blob 读成 DataURL（用于打印页/内联预览） */
export function blobToDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

export function blobToArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  return blob.arrayBuffer()
}

export function dataURLToBlob(dataUrl: string): Blob {
  const [head, body] = dataUrl.split(',')
  const mime = /:(.*?);/.exec(head)?.[1] ?? 'image/jpeg'
  const isBase64 = head.includes('base64')
  const bin = isBase64 ? atob(body) : decodeURIComponent(body)
  const len = bin.length
  const bytes = new Uint8Array(len)
  for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i)
  return new Blob([bytes], { type: mime })
}

export function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
