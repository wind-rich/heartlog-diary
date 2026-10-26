/**
 * 云端只读数据源（D-012）。
 *
 * 公网页读的是作者「发布」时写进云端的两张表：
 *   heartlog_public_snapshot —— 一人一行，payload 就是 PublishedSnapshot
 *   heartlog_public_media    —— 一格一行，base64 存缩略图/网页图
 *
 * 这里刻意**不引入云 SDK**：匿名只读只需要 publishable key 这一个请求头，
 * 直接用 fetch 即可，访客端仍然不下载数据库与登录相关代码。
 */
import { useEffect, useState } from 'react'
import { CLOUD_PUBLIC_CONFIG } from '../../lib/cloudConfig'
import type { PublicPhoto, PublishedSnapshot } from '../types'

const REST = `${CLOUD_PUBLIC_CONFIG.endpoint}/.cloud/database/rest`
const HEADERS = { 'x-wb-webapp-access-key': CLOUD_PUBLIC_CONFIG.publishableKey }

async function selectRows<T>(table: string, query: string): Promise<T[]> {
  const res = await fetch(`${REST}/${table}?${query}`, { headers: HEADERS, cache: 'no-store' })
  if (!res.ok) throw new Error(`${table} 读取失败：HTTP ${res.status}`)
  return (await res.json()) as T[]
}

/** 当前已发布的快照；没有发布过返回 null（不是错误） */
export async function fetchCloudSnapshot(): Promise<PublishedSnapshot | null> {
  const rows = await selectRows<{ payload: PublishedSnapshot }>(
    'heartlog_public_snapshot',
    'select=payload&is_live=eq.true&order=published_at.desc&limit=1',
  )
  if (!rows.length) return null
  const snap = rows[0].payload
  if (!snap || typeof snap !== 'object' || !snap.manifest) return null
  return snap
}

/**
 * 访问控制指针。
 *
 * 只有「云端没有 live 快照」时才需要问它：作者撤回时会把快照下线，
 * 同时把指针置成 `retracted`。没有这一步，访客端会退回构建时打进去的
 * 静态快照——作者以为下线了，访客照样看得到。读失败按 none 处理（不阻塞展示）。
 */
export interface CloudPublishState {
  state: 'live' | 'retracted' | 'none'
  note: string
}

export async function fetchPublishState(): Promise<CloudPublishState> {
  try {
    const rows = await selectRows<{ state: string; note: string | null }>(
      'heartlog_publish_state',
      'select=state,note&limit=1',
    )
    if (!rows.length) return { state: 'none', note: '' }
    return {
      state: rows[0].state === 'retracted' ? 'retracted' : 'live',
      note: rows[0].note ?? '',
    }
  } catch {
    return { state: 'none', note: '' }
  }
}

/** 一次性取回全部缩略图（图很小，一次拿完比 104 次请求快得多） */
export async function fetchThumbMap(): Promise<Map<string, string>> {
  const rows = await selectRows<{ photo_id: string; data_b64: string; mime: string }>(
    'heartlog_public_media',
    'select=photo_id,mime,data_b64&is_live=eq.true&kind=eq.thumb&limit=1000',
  )
  const map = new Map<string, string>()
  for (const r of rows) map.set(r.photo_id, `data:${r.mime || 'image/jpeg'};base64,${r.data_b64}`)
  return map
}

const fullCache = new Map<string, string>()
const inflight = new Map<string, Promise<string | null>>()

export function cachedFull(photoId: string): string | undefined {
  return fullCache.get(photoId)
}

/** 按需取一张大图；同一张并发只发一次请求 */
export async function ensureFull(photoId: string): Promise<string | null> {
  const hit = fullCache.get(photoId)
  if (hit) return hit
  const running = inflight.get(photoId)
  if (running) return running
  const task = (async () => {
    try {
      const rows = await selectRows<{ data_b64: string; mime: string }>(
        'heartlog_public_media',
        `select=mime,data_b64&is_live=eq.true&kind=eq.web&photo_id=eq.${encodeURIComponent(photoId)}&limit=1`,
      )
      if (!rows.length) return null
      const url = `data:${rows[0].mime || 'image/jpeg'};base64,${rows[0].data_b64}`
      fullCache.set(photoId, url)
      return url
    } catch {
      return null
    } finally {
      inflight.delete(photoId)
    }
  })()
  inflight.set(photoId, task)
  return task
}

/**
 * 大图地址：静态快照模式直接用快照里的 URL；
 * 云端模式下快照不带媒体地址，按需取一次，取不到就先显示缩略图。
 */
export function useFullPhotoUrl(photo: PublicPhoto | undefined): string {
  const id = photo?.id ?? ''
  const direct = photo?.media?.full?.url ?? ''
  const [url, setUrl] = useState(() => direct || (id ? cachedFull(id) : undefined) || '')

  useEffect(() => {
    if (!id) return
    if (direct) {
      setUrl(direct)
      return
    }
    const hit = cachedFull(id)
    if (hit) {
      setUrl(hit)
      return
    }
    let alive = true
    void ensureFull(id).then((u) => {
      if (alive && u) setUrl(u)
    })
    return () => {
      alive = false
    }
  }, [id, direct])

  return url || photo?.media?.thumb?.url || ''
}
