/**
 * T6 惊喜互动：记忆配对（照片翻牌）。
 *
 * 为什么选「记忆配对」而不是拼图：
 * - 拼图要裁切原图，手机上一次误触就会把图拖歪，还得处理不同宽高比；
 * - 配对只用**缩略图**，不裁不放大，触控目标天然是矩形，慢速网络下也不会卡；
 * - 规则一眼就懂，不需要教学层，不占用展示端主流程。
 *
 * 硬边界（T6 验收，写在这里避免以后被"顺手"改掉）：
 * - **只读**：牌面来自已发布的 `PublicPhoto`，不写作者数据库、不改照片、不碰发布版本；
 * - **进度只存 localStorage**，键里带 `publishId`，换一版不会串成绩；
 * - 没有上传、没有聊天、没有多人、没有服务端。
 */
import type { PublicPhoto, ViewerConfig } from '../types'

export interface MemoryCard {
  /** 卡面唯一键：`${photoId}#${副本序号}` */
  key: string
  photoId: string
  /** 卡面文字（照片说明），用于无障碍朗读 */
  label: string
  thumb: string
}

export interface MemoryBoard {
  cards: MemoryCard[]
  pairCount: number
}

export interface MemoryRecord {
  bestMoves: number
  bestMs: number
  clears: number
  lastAt: string
}

/** 模块开关：默认关闭（老快照没有这个字段，就不显示入口） */
export function gameEnabled(config: ViewerConfig | undefined): boolean {
  return config?.sections?.game === true
}

/** 只有带缩略图的照片能当牌面：没有缩略图的牌翻开是一片空白，等于坏体验 */
export function usablePhotos(photos: PublicPhoto[] | undefined): PublicPhoto[] {
  return (photos ?? []).filter((p) => Boolean(p?.media?.thumb?.url))
}

/* ------------------------------------------------------------------ */
/* 确定性洗牌：同一份内容每次打开顺序不同，但可复现（便于自测与排查）      */
/* ------------------------------------------------------------------ */

function hashString(input: string): number {
  let h = 2166136261
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Fisher–Yates + 可复现随机源（不用 Math.random，测试里才能断言顺序） */
export function shuffleWithSeed<T>(list: T[], seed: string): T[] {
  const rand = mulberry32(hashString(seed))
  const out = [...list]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

/**
 * 选牌：按拍摄时间倒序（最近的先出现），以一个由 `publishId` 决定的偏移取一段。
 *
 * 偏移由内容版本决定，而不是随机：同一次发布里反复进入看到的是同一组照片，
 * 作者重新发布后才会换一批——这比"每次随机"更不像抽奖。
 */
export function pickPhotos(photos: PublicPhoto[] | undefined, publishId: string, count = 6): PublicPhoto[] {
  const usable = usablePhotos(photos)
  if (!usable.length) return []
  const sorted = [...usable].sort((a, b) => {
    const at = a.takenAt ?? ''
    const bt = b.takenAt ?? ''
    if (at === bt) return a.id < b.id ? -1 : 1
    return at < bt ? 1 : -1
  })
  const take = Math.min(count, sorted.length)
  const offset = hashString(publishId || 'seed') % sorted.length
  const rotated = [...sorted.slice(offset), ...sorted.slice(0, offset)]
  return rotated.slice(0, take)
}

/** 组牌：每张照片两张，洗牌后返回；同一张照片的两张牌只在 key 上不同 */
export function buildBoard(photos: PublicPhoto[] | undefined, publishId: string, seed: string, count = 6): MemoryBoard {
  const picked = pickPhotos(photos, publishId, count)
  const cards: MemoryCard[] = []
  picked.forEach((p, i) => {
    for (let copy = 0; copy < 2; copy++) {
      cards.push({
        key: `${p.id}#${copy}`,
        photoId: p.id,
        label: p.caption?.trim() || `第 ${i + 1} 张照片`,
        thumb: p.media.thumb.url,
      })
    }
  })
  return { cards: shuffleWithSeed(cards, `${publishId}|${seed}`), pairCount: picked.length }
}

/* ------------------------------------------------------------------ */
/* 本地成绩：只写 localStorage，键按发布版本隔离                          */
/* ------------------------------------------------------------------ */

const storageKey = (publishId: string) => `heartlog.game.memory.v1.${publishId || 'unknown'}`

function readRaw(publishId: string): MemoryRecord | null {
  try {
    const raw = localStorage.getItem(storageKey(publishId))
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<MemoryRecord>
    if (typeof parsed?.bestMoves !== 'number' || typeof parsed?.bestMs !== 'number') return null
    return {
      bestMoves: parsed.bestMoves,
      bestMs: parsed.bestMs,
      clears: typeof parsed.clears === 'number' ? parsed.clears : 0,
      lastAt: typeof parsed.lastAt === 'string' ? parsed.lastAt : '',
    }
  } catch {
    // 隐私模式 / 存储被禁用：没有成绩可看，但不该影响玩
    return null
  }
}

export function loadRecord(publishId: string): MemoryRecord | null {
  return readRaw(publishId)
}

/**
 * 记一次通关。
 * 「最好成绩」按「步数少优先，步数相同再看用时」判定；`clears` 累加总通关次数。
 */
export function saveRecord(
  publishId: string,
  result: { moves: number; ms: number; at?: string },
): { record: MemoryRecord; isBest: boolean } {
  const prev = readRaw(publishId)
  const at = result.at ?? new Date().toISOString()
  const isBest =
    !prev || result.moves < prev.bestMoves || (result.moves === prev.bestMoves && result.ms < prev.bestMs)
  const record: MemoryRecord = {
    bestMoves: isBest ? result.moves : prev!.bestMoves,
    bestMs: isBest ? result.ms : prev!.bestMs,
    clears: (prev?.clears ?? 0) + 1,
    lastAt: at,
  }
  try {
    localStorage.setItem(storageKey(publishId), JSON.stringify(record))
  } catch {
    // 写不进去就只在本次会话里显示，不弹错
  }
  return { record, isBest }
}

/** 通关最少步数就是「对数」，用来判断成绩是否合理（自测会用到） */
export function minMoves(pairCount: number): number {
  return pairCount
}

/** 毫秒 → `m:ss`，计时展示用 */
export function fmtDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
}
