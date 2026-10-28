import type { GameId, PublishedSnapshot } from '../types'
import { GAME_META } from './config'
import { buildTimelinePool } from './timeline'
import { validQuizItems } from './quiz'
import { findTreasureHunt } from './treasure'

/** 首页推荐与互动大厅共用同一份可玩状态，避免入口和实际玩法不一致。 */
export function gameAvailability(id: GameId, snapshot: PublishedSnapshot, photoCount: number): { ok: boolean; text: string } {
  const meta = GAME_META[id]
  if (meta.minPhotos > 0) {
    return photoCount >= meta.minPhotos
      ? { ok: true, text: `需要 ${meta.minPhotos} 张照片` }
      : { ok: false, text: `当前 ${photoCount} / 需要 ${meta.minPhotos} 张照片` }
  }
  if (id === 'timeline') {
    const count = buildTimelinePool(snapshot.entries).length
    return count >= 3 ? { ok: true, text: `可用 ${count} 条不同日期的回忆` } : { ok: false, text: `当前 ${count} / 需要 3 条不同日期的回忆` }
  }
  if (id === 'quiz') {
    const count = validQuizItems(snapshot.gameContent).length
    return count > 0 ? { ok: true, text: `题库 ${count} 题` } : { ok: false, text: '还没有可用题目' }
  }
  if (id === 'dateDraw') return { ok: true, text: '内置卡组 + 作者自定义卡' }
  if (id === 'treasure') {
    const hunt = findTreasureHunt(snapshot.gameContent)
    return hunt ? { ok: true, text: `${hunt.steps.length} 步 · ${hunt.title}` } : { ok: false, text: '还没有已发布的寻宝' }
  }
  return { ok: true, text: '可以开始' }
}
