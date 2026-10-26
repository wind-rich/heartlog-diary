import { createContext, useContext, useMemo, type ReactNode } from 'react'
import type { PublishedSnapshot, SnapshotScene } from '../types'

export interface SnapshotState {
  snapshot: PublishedSnapshot
  /** published = 读者看到的线上版本；preview = 作者端未发布草稿 */
  mode: 'published' | 'preview'
  scene: SnapshotScene
  /** sample = 合成演示数据；snapshot = 作者发布的真实只读快照；local = 作者本机数据 */
  source: 'sample' | 'snapshot' | 'local'
  /** 是否显示编辑入口（仅作者端为 true） */
  editable?: boolean
}

const Ctx = createContext<SnapshotState | null>(null)

export function SnapshotProvider({ value, children }: { value: SnapshotState; children: ReactNode }) {
  const memo = useMemo(() => value, [value])
  return <Ctx.Provider value={memo}>{children}</Ctx.Provider>
}

export function useSnapshotState(): SnapshotState {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('SnapshotProvider 缺失')
  return ctx
}

export function useSnapshot(): PublishedSnapshot {
  return useSnapshotState().snapshot
}
