/**
 * T6-H 访客端「今天一起做什么」：约会点子抽签。
 *
 * 规则：
 * - 卡池 = 内置原创卡 + 快照可选字段 `gameContent` 里的自定义卡（kind === 'dateCard'）；
 * - 每次从「活动 / 地点 / 小彩蛋」三类各抽一张，组合必须通过规则匹配
 *   （最典型的一条：室内活动不会配到公园这类室外地点）；
 * - 支持按室内/室外、时长、预算筛选；单项可锁定，再抽只替换未锁项；
 * - 固定 seed 结果可复现（Fisher–Yates + 可复现随机源，同 memory.ts）；
 * - 「喜欢的组合」只存 localStorage，键按发布版本隔离。
 *
 * 硬边界：不读取定位或商家信息，不写任务/日程，不访问网络或作者私有模块。
 */
import type { PublicGameContent } from '../types'
import { shuffleWithSeed } from './memory'

/* ------------------------------------------------------------------ */
/* 公开契约：自定义卡（快照 gameContent 中 kind === 'dateCard' 的条目）     */
/* ------------------------------------------------------------------ */

export type DateCardCategory = 'activity' | 'place' | 'surprise'
export type PublicDateCardContent = Extract<PublicGameContent, { kind: 'dateCard' }>

/* ------------------------------------------------------------------ */
/* 卡面属性：从 tags 前缀解析，未知前缀的标签原样展示                      */
/* ------------------------------------------------------------------ */

export type DateCardSetting = 'indoor' | 'outdoor'
export type DateCardBudget = 'free' | 'low' | 'mid'
export type DateCardDuration = 'short' | 'half' | 'day'

export interface DateCard extends PublicDateCardContent {
  builtin: boolean
  /** 未标注表示室内外都可以 */
  setting?: DateCardSetting
  /** 未标注表示对预算无要求 */
  budget?: DateCardBudget
  /** 未标注表示对时长无要求 */
  duration?: DateCardDuration
  /** 去掉机器前缀后的展示标签 */
  displayTags: string[]
}

const BUDGET_ORDER: Record<DateCardBudget, number> = { free: 0, low: 1, mid: 2 }

export const SETTING_LABELS: Record<DateCardSetting, string> = { indoor: '室内', outdoor: '室外' }
export const BUDGET_LABELS: Record<DateCardBudget, string> = { free: '免费', low: '低预算', mid: '百元级' }
export const DURATION_LABELS: Record<DateCardDuration, string> = { short: '2 小时内', half: '半天', day: '一整天' }

export const CATEGORY_ORDER: DateCardCategory[] = ['activity', 'place', 'surprise']
export const CATEGORY_LABELS: Record<DateCardCategory, string> = {
  activity: '一起做什么',
  place: '在哪里',
  surprise: '小小彩蛋',
}

function parseCard(raw: PublicDateCardContent, builtin: boolean): DateCard {
  let setting: DateCardSetting | undefined
  let budget: DateCardBudget | undefined
  let duration: DateCardDuration | undefined
  const displayTags: string[] = []
  for (const tag of raw.tags) {
    if (tag === 'setting:indoor' || tag === 'setting:outdoor') setting = tag.slice('setting:'.length) as DateCardSetting
    else if (tag === 'budget:free' || tag === 'budget:low' || tag === 'budget:mid') budget = tag.slice('budget:'.length) as DateCardBudget
    else if (tag === 'duration:short' || tag === 'duration:half' || tag === 'duration:day') duration = tag.slice('duration:'.length) as DateCardDuration
    else if (!tag.startsWith('conflicts:')) displayTags.push(tag)
  }
  return { ...raw, tags: [...raw.tags], text: raw.text.trim(), builtin, setting, budget, duration, displayTags }
}

/* ------------------------------------------------------------------ */
/* 内置原创卡池：三类各 8 张，覆盖室内/室外、低预算、短时长                 */
/* ------------------------------------------------------------------ */

export const BUILTIN_DATE_CARDS: PublicDateCardContent[] = [
  // ---- 活动 ----
  { id: 'builtin-activity-cook', kind: 'dateCard', schemaVersion: 1, category: 'activity', text: '一起下厨，每人负责一道菜，咸淡都不许嫌弃', tags: ['setting:indoor', 'budget:low', 'duration:short', '做饭'] },
  { id: 'builtin-activity-movie', kind: 'dateCard', schemaVersion: 1, category: 'activity', text: '窝在一起看一部两人都没看过的老电影', tags: ['setting:indoor', 'budget:free', 'duration:short', '电影'] },
  { id: 'builtin-activity-boardgame', kind: 'dateCard', schemaVersion: 1, category: 'activity', text: '来一局双人桌游或合作拼图，输的人讲一个冷笑话', tags: ['setting:indoor', 'budget:low', 'duration:short', '游戏'] },
  { id: 'builtin-activity-walk', kind: 'dateCard', schemaVersion: 1, category: 'activity', text: '慢慢散步，各自拍下今天最想留住的三张照片', tags: ['setting:outdoor', 'budget:free', 'duration:short', '散步', '拍照'] },
  { id: 'builtin-activity-ride', kind: 'dateCard', schemaVersion: 1, category: 'activity', text: '骑单车去城市另一头，赶在日落之前到达', tags: ['setting:outdoor', 'budget:free', 'duration:half', '骑行', '日落'] },
  { id: 'builtin-activity-market', kind: 'dateCard', schemaVersion: 1, category: 'activity', text: '挑战一百元超市采购，回家做一顿盲盒晚餐', tags: ['setting:indoor', 'budget:low', 'duration:short', '采购'] },
  { id: 'builtin-activity-concert', kind: 'dateCard', schemaVersion: 1, category: 'activity', text: '在家开一场双人演唱会，轮流点歌，跑调也算数', tags: ['setting:indoor', 'budget:free', 'duration:short', '唱歌'] },
  { id: 'builtin-activity-greenway', kind: 'dateCard', schemaVersion: 1, category: 'activity', text: '走一段没去过的绿道或山坡，到顶再回家', tags: ['setting:outdoor', 'budget:free', 'duration:half', '徒步'] },
  // ---- 地点 ----
  { id: 'builtin-place-carpet', kind: 'dateCard', schemaVersion: 1, category: 'place', text: '客厅地毯上，把手机放远一点', tags: ['setting:indoor', 'budget:free', 'duration:short', '家里'] },
  { id: 'builtin-place-diner', kind: 'dateCard', schemaVersion: 1, category: 'place', text: '常去的那家小馆子，还是坐老位置', tags: ['setting:indoor', 'budget:low', 'duration:short', '小馆子'] },
  { id: 'builtin-place-park', kind: 'dateCard', schemaVersion: 1, category: 'place', text: '附近公园临水的那排长椅', tags: ['setting:outdoor', 'budget:free', 'duration:short', '公园'] },
  { id: 'builtin-place-river', kind: 'dateCard', schemaVersion: 1, category: 'place', text: '河边步道，风刚刚好的那一段', tags: ['setting:outdoor', 'budget:free', 'duration:short', '河边'] },
  { id: 'builtin-place-library', kind: 'dateCard', schemaVersion: 1, category: 'place', text: '图书馆靠窗的角落，各看各的书也很好', tags: ['setting:indoor', 'budget:free', 'duration:half', '图书馆'] },
  { id: 'builtin-place-homestore', kind: 'dateCard', schemaVersion: 1, category: 'place', text: '家居店里慢慢逛，给未来的家挑一点灵感', tags: ['setting:indoor', 'budget:free', 'duration:half', '逛街'] },
  { id: 'builtin-place-rooftop', kind: 'dateCard', schemaVersion: 1, category: 'place', text: '顶楼天台，看路灯一盏一盏亮起来', tags: ['setting:outdoor', 'budget:free', 'duration:short', '天台', '夜景'] },
  { id: 'builtin-place-cafe', kind: 'dateCard', schemaVersion: 1, category: 'place', text: '街角咖啡店的双人位，坐到杯子见底', tags: ['setting:indoor', 'budget:low', 'duration:short', '咖啡'] },
  // ---- 小彩蛋 ----
  { id: 'builtin-surprise-note', kind: 'dateCard', schemaVersion: 1, category: 'surprise', text: '各写一张「今天想谢谢你」的纸条，睡前交换', tags: ['budget:free', 'duration:short', '纸条'] },
  { id: 'builtin-surprise-drink', kind: 'dateCard', schemaVersion: 1, category: 'surprise', text: '为对方挑一杯没喝过的饮料，盲选不许偷看', tags: ['budget:low', 'duration:short', '饮料'] },
  { id: 'builtin-surprise-photo', kind: 'dateCard', schemaVersion: 1, category: 'surprise', text: '拍一张只属于今天的合照，表情越怪越好', tags: ['budget:free', 'duration:short', '合照'] },
  { id: 'builtin-surprise-moment', kind: 'dateCard', schemaVersion: 1, category: 'surprise', text: '轮流说出最近一件被对方打动的小事', tags: ['budget:free', 'duration:short', '谈心'] },
  { id: 'builtin-surprise-codeword', kind: 'dateCard', schemaVersion: 1, category: 'surprise', text: '约定一个只有今天能用的暗号，明天就作废', tags: ['budget:free', 'duration:short', '暗号'] },
  { id: 'builtin-surprise-sunset', kind: 'dateCard', schemaVersion: 1, category: 'surprise', text: '把今天的日落拍下来发给对方，哪怕人就在旁边', tags: ['setting:outdoor', 'budget:free', 'duration:short', '日落'] },
  { id: 'builtin-surprise-massage', kind: 'dateCard', schemaVersion: 1, category: 'surprise', text: '睡前互相认真按摩十分钟，不许敷衍', tags: ['setting:indoor', 'budget:free', 'duration:short', '放松'] },
  { id: 'builtin-surprise-playlist', kind: 'dateCard', schemaVersion: 1, category: 'surprise', text: '各挑三首歌拼成今晚的歌单，按顺序听完', tags: ['budget:free', 'duration:short', '歌单'] },
]

/* ------------------------------------------------------------------ */
/* 自定义卡解析与卡池合并                                                */
/* ------------------------------------------------------------------ */

const CATEGORIES: DateCardCategory[] = ['activity', 'place', 'surprise']

function isValidCustomCard(value: unknown): value is PublicDateCardContent {
  if (!value || typeof value !== 'object') return false
  const raw = value as Record<string, unknown>
  return (
    raw.kind === 'dateCard' &&
    typeof raw.id === 'string' && raw.id.trim().length > 0 &&
    typeof raw.schemaVersion === 'number' &&
    typeof raw.text === 'string' && raw.text.trim().length > 0 &&
    CATEGORIES.includes(raw.category as DateCardCategory) &&
    Array.isArray(raw.tags) && raw.tags.every((t) => typeof t === 'string')
  )
}

/**
 * 从快照可选字段 `gameContent` 里挑出自定义约会卡。
 * 字段缺失、不是数组、条目不合约都静默忽略——旧快照没有 gameContent 也能正常玩。
 */
export function parseCustomDateCards(gameContent: unknown): PublicDateCardContent[] {
  if (!Array.isArray(gameContent)) return []
  return gameContent.filter(isValidCustomCard).map((raw) => ({
    id: raw.id.trim(),
    kind: 'dateCard' as const,
    schemaVersion: raw.schemaVersion,
    category: raw.category,
    text: raw.text,
    tags: raw.tags.filter((t) => t.trim().length > 0),
  }))
}

/** 合并内置卡与自定义卡；同 id 时先出现的（内置）生效，保证结果稳定。 */
export function allDateCards(gameContent?: unknown): DateCard[] {
  const seen = new Set<string>()
  const out: DateCard[] = []
  for (const raw of BUILTIN_DATE_CARDS) {
    seen.add(raw.id)
    out.push(parseCard(raw, true))
  }
  for (const raw of parseCustomDateCards(gameContent)) {
    if (seen.has(raw.id)) continue
    seen.add(raw.id)
    out.push(parseCard(raw, false))
  }
  return out
}

/* ------------------------------------------------------------------ */
/* 筛选与组合规则                                                       */
/* ------------------------------------------------------------------ */

export interface DateDrawFilters {
  setting: 'any' | DateCardSetting
  duration: 'any' | DateCardDuration
  budget: 'any' | DateCardBudget
}

export const DEFAULT_FILTERS: DateDrawFilters = { setting: 'any', duration: 'any', budget: 'any' }

export function matchFilters(card: DateCard, filters: DateDrawFilters): boolean {
  if (filters.setting !== 'any' && card.setting && card.setting !== filters.setting) return false
  if (filters.duration !== 'any' && card.duration && card.duration !== filters.duration) return false
  // 预算按上限理解：筛「低预算」时免费卡也成立
  if (filters.budget !== 'any' && card.budget && BUDGET_ORDER[card.budget] > BUDGET_ORDER[filters.budget]) return false
  return true
}

/**
 * 两张卡能否出现在同一组合：
 * - 一张标了室内、另一张标了室外 → 矛盾（例如室内活动配公园）；
 * - `conflicts:<标签>` 显式声明的冲突同样排除。
 */
export function compatible(a: DateCard, b: DateCard): boolean {
  if (a.setting && b.setting && a.setting !== b.setting) return false
  const aConflicts = a.tags.filter((t) => t.startsWith('conflicts:')).map((t) => t.slice('conflicts:'.length))
  const bConflicts = b.tags.filter((t) => t.startsWith('conflicts:')).map((t) => t.slice('conflicts:'.length))
  if (aConflicts.some((c) => b.tags.includes(c))) return false
  if (bConflicts.some((c) => a.tags.includes(c))) return false
  return true
}

/* ------------------------------------------------------------------ */
/* 抽签：固定 seed 可复现；锁定的项不参与重抽                              */
/* ------------------------------------------------------------------ */

export interface DateDrawOutcome {
  combo: Partial<Record<DateCardCategory, DateCard>>
  /** 本轮想抽但抽不到的分类（锁定项不算），用于「建议放宽筛选」提示 */
  missing: DateCardCategory[]
}

/**
 * 抽一组三张卡。`locked` 里的卡原样保留；其余分类按固定顺序（地点 → 活动 → 彩蛋）
 * 依次从「通过筛选且与已确定卡全部兼容」的候选中确定性抽取。
 */
export function drawDateCombo(
  cards: DateCard[],
  filters: DateDrawFilters,
  locked: Partial<Record<DateCardCategory, DateCard>>,
  seed: string,
): DateDrawOutcome {
  const combo: Partial<Record<DateCardCategory, DateCard>> = { ...locked }
  const missing: DateCardCategory[] = []
  // 先抽地点再抽活动，活动的室内外标注最多，放在后面更容易配平
  for (const category of ['place', 'activity', 'surprise'] as DateCardCategory[]) {
    if (combo[category]) continue
    const chosen = CATEGORY_ORDER.map((c) => combo[c]).filter((c): c is DateCard => Boolean(c))
    const candidates = cards.filter(
      (card) => card.category === category && matchFilters(card, filters) && chosen.every((other) => compatible(other, card)),
    )
    const picked = shuffleWithSeed(candidates, `${seed}|${category}`)[0]
    if (picked) combo[category] = picked
    else missing.push(category)
  }
  return { combo, missing }
}

/* ------------------------------------------------------------------ */
/* 喜欢的组合：只存本机 localStorage                                     */
/* ------------------------------------------------------------------ */

export interface FavoriteDateCombo {
  /** 三张卡 id 拼接，作为去重主键 */
  id: string
  savedAt: string
  activity: PublicDateCardContent
  place: PublicDateCardContent
  surprise: PublicDateCardContent
}

const MAX_FAVORITES = 30

const favoritesKey = (publishId: string) => `heartlog.game.dateDraw.v1.${publishId || 'unknown'}`

function toContent(card: DateCard): PublicDateCardContent {
  return { id: card.id, kind: 'dateCard', schemaVersion: card.schemaVersion, category: card.category, text: card.text, tags: [...card.tags] }
}

/** 三张都齐才构成可收藏的组合，否则返回 null */
export function comboKey(combo: Partial<Record<DateCardCategory, DateCard>>): string | null {
  const { activity, place, surprise } = combo
  if (!activity || !place || !surprise) return null
  return `${activity.id}|${place.id}|${surprise.id}`
}

export function loadDateFavorites(publishId: string): FavoriteDateCombo[] {
  try {
    const raw = localStorage.getItem(favoritesKey(publishId))
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (item): item is FavoriteDateCombo =>
        Boolean(item) &&
        typeof item.id === 'string' &&
        typeof item.savedAt === 'string' &&
        isValidCustomCard(item.activity) &&
        isValidCustomCard(item.place) &&
        isValidCustomCard(item.surprise),
    )
  } catch {
    return []
  }
}

function writeFavorites(publishId: string, favorites: FavoriteDateCombo[]): void {
  try {
    localStorage.setItem(favoritesKey(publishId), JSON.stringify(favorites))
  } catch {
    // 隐私模式 / 存储被禁用：本次会话内仍然显示，不弹错
  }
}

/** 收藏当前组合；同一组合重复收藏只更新时间。 */
export function saveDateFavorite(
  publishId: string,
  combo: { activity: DateCard; place: DateCard; surprise: DateCard },
  at = new Date().toISOString(),
): FavoriteDateCombo[] {
  const favorite: FavoriteDateCombo = {
    id: comboKey(combo)!,
    savedAt: at,
    activity: toContent(combo.activity),
    place: toContent(combo.place),
    surprise: toContent(combo.surprise),
  }
  const rest = loadDateFavorites(publishId).filter((item) => item.id !== favorite.id)
  const next = [favorite, ...rest].slice(0, MAX_FAVORITES)
  writeFavorites(publishId, next)
  return next
}

export function removeDateFavorite(publishId: string, id: string): FavoriteDateCombo[] {
  const next = loadDateFavorites(publishId).filter((item) => item.id !== id)
  writeFavorites(publishId, next)
  return next
}
