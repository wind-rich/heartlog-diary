import type { GameId, ViewerConfig } from '../types'

export const GAME_IDS: GameId[] = ['memory', 'puzzle', 'photoGuess', 'memoryBox', 'timeline', 'quiz', 'dateDraw', 'treasure']

export interface GameMeta {
  title: string
  description: string
  duration: string
  minPhotos: number
  minEntries: number
  minContent: number
  contentKind?: 'quiz' | 'dateCard' | 'treasure'
}

export const GAME_META: Record<GameId, GameMeta> = {
  memory: { title: '记忆配对', description: '翻开两张牌，找回同一张照片。', duration: '1～3 分钟', minPhotos: 3, minEntries: 0, minContent: 0 },
  puzzle: { title: '拼回这一刻', description: '点击两块交换位置，把照片拼完整。', duration: '1～3 分钟', minPhotos: 1, minEntries: 0, minContent: 0 },
  photoGuess: { title: '猜猜是哪一张', description: '从照片局部，认出完整的回忆。', duration: '1～2 分钟', minPhotos: 4, minEntries: 0, minContent: 0 },
  memoryBox: { title: '今日回忆盲盒', description: '打开一颗星，遇见一段已经公开的回忆。', duration: '约 1 分钟', minPhotos: 1, minEntries: 0, minContent: 0 },
  timeline: { title: '把时光排好', description: '把几张回忆卡按发生时间排回正确顺序。', duration: '1～2 分钟', minPhotos: 0, minEntries: 3, minContent: 0 },
  quiz: { title: '关于他的五道题', description: '答一组由作者写下的小问题。', duration: '1～3 分钟', minPhotos: 0, minEntries: 0, minContent: 1, contentKind: 'quiz' },
  dateDraw: { title: '今天一起做什么', description: '抽一组活动、地点和小彩蛋，给今天一点灵感。', duration: '约 1 分钟', minPhotos: 0, minEntries: 0, minContent: 0, contentKind: 'dateCard' },
  treasure: { title: '星球寻宝', description: '根据三条线索，在故事和相册里找回三颗星。', duration: '3～6 分钟', minPhotos: 0, minEntries: 0, minContent: 1, contentKind: 'treasure' },
}

export function isGameId(value: string | null): value is GameId {
  return GAME_IDS.includes(value as GameId)
}

/** 总开关优先；旧快照没有 games 时只开放记忆配对。 */
export function enabledGameIds(config: ViewerConfig | undefined): GameId[] {
  if (config?.sections?.game !== true) return []
  if (config.games === undefined) return ['memory']
  return GAME_IDS.filter((id) => config.games?.[id]?.enabled === true)
}

export function isGameEnabled(config: ViewerConfig | undefined, id: GameId): boolean {
  return enabledGameIds(config).includes(id)
}

export function hasEnabledGames(config: ViewerConfig | undefined): boolean {
  return enabledGameIds(config).length > 0
}

/** 保留首版纯逻辑测试使用的函数名，语义仍是“记忆配对是否可用”。 */
export function gameEnabled(config: ViewerConfig | undefined): boolean {
  return isGameEnabled(config, 'memory')
}
