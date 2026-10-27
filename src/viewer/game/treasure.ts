/**
 * T6-I 星球寻宝（访客端纯逻辑）。
 *
 * 只读公开快照；进度只存 localStorage。目标只允许公开记录或照片，
 * 不支持任意 URL、定位或脚本。每局固定三步，只有当前目标被主动确认才推进。
 */
import type { PublicEntry, PublicGameContent, PublicPhoto } from '../types'

export type TreasureHunt = Extract<PublicGameContent, { kind: 'treasure' }>
export type TreasureTargetType = 'entry' | 'photo'

export interface TreasureProgress {
  /** 已完成的星数，0..3；等于 3 表示完成 */
  stepIndex: number
  /** 是否使用过求助揭晓 */
  assisted: boolean
  completedAt?: string
  updatedAt: string
}

export const TREASURE_STEP_COUNT = 3

export function findTreasureHunt(content: PublicGameContent[] | undefined): TreasureHunt | null {
  return (content ?? []).find((item): item is TreasureHunt => item.kind === 'treasure') ?? null
}

export function targetExists(targetType: TreasureTargetType, targetId: string, entries: PublicEntry[], photos: PublicPhoto[]): boolean {
  return targetType === 'entry'
    ? entries.some((entry) => entry.id === targetId)
    : photos.some((photo) => photo.id === targetId)
}

export function targetTitle(targetType: TreasureTargetType, targetId: string, entries: PublicEntry[], photos: PublicPhoto[]): string | null {
  if (targetType === 'entry') return entries.find((entry) => entry.id === targetId)?.title ?? null
  const photo = photos.find((item) => item.id === targetId)
  return photo ? (photo.caption || '一张照片') : null
}

/** 发布后目标缺失时整局停止，不能把失效目标当成完成。 */
export function validateTreasureTargets(hunt: TreasureHunt, entries: PublicEntry[], photos: PublicPhoto[]): string[] {
  const errors: string[] = []
  hunt.steps.forEach((step, index) => {
    if (!targetExists(step.targetType, step.targetId, entries, photos)) {
      errors.push(`第 ${index + 1} 颗星的目标已不在当前发布内容里`)
    }
  })
  return errors
}

export function currentTreasureStep(hunt: TreasureHunt, progress: TreasureProgress | null) {
  if (!progress || progress.stepIndex >= hunt.steps.length) return null
  return hunt.steps[progress.stepIndex] ?? null
}

/** 只有目标完全匹配且尚未完成时推进；重复确认返回原对象。 */
export function confirmTreasureTarget(
  hunt: TreasureHunt,
  progress: TreasureProgress,
  targetType: TreasureTargetType,
  targetId: string,
): TreasureProgress {
  if (progress.stepIndex >= hunt.steps.length) return progress
  const step = hunt.steps[progress.stepIndex]
  if (!step || step.targetType !== targetType || step.targetId !== targetId) return progress
  const nextIndex = progress.stepIndex + 1
  return {
    ...progress,
    stepIndex: nextIndex,
    completedAt: nextIndex >= hunt.steps.length ? new Date().toISOString() : progress.completedAt,
    updatedAt: new Date().toISOString(),
  }
}

export function markTreasureAssisted(progress: TreasureProgress): TreasureProgress {
  if (progress.assisted) return progress
  return { ...progress, assisted: true, updatedAt: new Date().toISOString() }
}

const progressKey = (publishId: string, huntId: string) =>
  `heartlog.game.treasure.v1.${publishId || 'unknown'}.${huntId}`

export function loadTreasureProgress(publishId: string, huntId: string): TreasureProgress | null {
  try {
    const raw = localStorage.getItem(progressKey(publishId, huntId))
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<TreasureProgress>
    if (typeof parsed?.stepIndex !== 'number' || !Number.isFinite(parsed.stepIndex)) return null
    const stepIndex = Math.max(0, Math.min(TREASURE_STEP_COUNT, Math.floor(parsed.stepIndex)))
    return {
      stepIndex,
      assisted: parsed.assisted === true,
      completedAt: typeof parsed.completedAt === 'string' ? parsed.completedAt : undefined,
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date().toISOString(),
    }
  } catch {
    return null
  }
}

export function saveTreasureProgress(publishId: string, huntId: string, progress: TreasureProgress): void {
  try {
    localStorage.setItem(progressKey(publishId, huntId), JSON.stringify(progress))
  } catch {
    // 隐私模式 / 配额不足：只影响跨页续关，不影响当前页面
  }
}

export function freshTreasureProgress(): TreasureProgress {
  return { stepIndex: 0, assisted: false, updatedAt: new Date().toISOString() }
}
