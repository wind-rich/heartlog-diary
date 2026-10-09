import type {
  CalendarType,
  EntryType,
  EvidenceType,
  HealthStatus,
  Mood,
  PreferenceDirection,
  WishStatus,
} from '../db/types'

export const ENTRY_TYPES: { value: EntryType; label: string; emoji: string; color: string }[] = [
  { value: 'daily', label: '日常', emoji: '🌤️', color: '#8CBF9B' },
  { value: 'date', label: '约会', emoji: '💞', color: '#F2A7A0' },
  { value: 'gift', label: '礼物', emoji: '🎁', color: '#E9B44C' },
  { value: 'interest', label: '兴趣', emoji: '🎯', color: '#8CA3D9' },
  { value: 'health', label: '健康', emoji: '🩺', color: '#7FB2C9' },
  { value: 'emotion', label: '情绪', emoji: '💗', color: '#C99BD9' },
  { value: 'other', label: '其他', emoji: '📌', color: '#B9ADA2' },
]

export const entryTypeMeta = (t: EntryType) => ENTRY_TYPES.find((x) => x.value === t) ?? ENTRY_TYPES[6]

export const MOODS: { value: Mood; label: string; emoji: string; color: string }[] = [
  { value: 'happy', label: '开心', emoji: '😊', color: '#E9B44C' },
  { value: 'calm', label: '平静', emoji: '🙂', color: '#8CBF9B' },
  { value: 'low', label: '低落', emoji: '😔', color: '#8CA3D9' },
  { value: 'anxious', label: '焦虑', emoji: '😰', color: '#C99BD9' },
  { value: 'angry', label: '生气', emoji: '😠', color: '#D9705F' },
  { value: 'custom', label: '自定义', emoji: '✏️', color: '#B9ADA2' },
]

export const moodMeta = (m?: Mood) => MOODS.find((x) => x.value === m)

export const PREF_CATEGORIES = [
  { value: 'game', label: '游戏', emoji: '🎮' },
  { value: 'food', label: '食物', emoji: '🍜' },
  { value: 'music', label: '音乐', emoji: '🎧' },
  { value: 'movie', label: '电影', emoji: '🎬' },
  { value: 'sport', label: '运动', emoji: '🏃' },
  { value: 'place', label: '地方', emoji: '🏔️' },
  { value: 'other', label: '其他', emoji: '✨' },
]

export const prefCategoryMeta = (c: string) =>
  PREF_CATEGORIES.find((x) => x.value === c) ?? { value: c, label: c, emoji: '✨' }

export const DIRECTIONS: { value: PreferenceDirection; label: string }[] = [
  { value: 'like', label: '喜欢' },
  { value: 'dislike', label: '不喜欢' },
  { value: 'want', label: '想尝试' },
]

export const WISH_STATUS: { value: WishStatus; label: string; color: string }[] = [
  { value: 'wish', label: '愿望', color: '#E9B44C' },
  { value: 'gifted', label: '已送出', color: '#8CBF9B' },
  { value: 'fulfilled', label: '已实现', color: '#8CA3D9' },
  { value: 'paused', label: '先搁置', color: '#B9ADA2' },
]

export const HEALTH_STATUS: { value: HealthStatus; label: string; color: string }[] = [
  { value: 'ongoing', label: '跟进中', color: '#D9705F' },
  { value: 'watching', label: '观察中', color: '#E9B44C' },
  { value: 'recovered', label: '已恢复', color: '#8CBF9B' },
]

export const PORTRAIT_DIMENSIONS = [
  { value: 'motivation', label: '兴趣与动力', hint: '什么事情能让 TA 投入、开心、有成就感' },
  { value: 'interaction', label: '相处偏好', hint: '喜欢怎样聊天、约会、安排时间' },
  { value: 'emotion', label: '情绪与支持方式', hint: '压力大时的表现，哪些安慰方式有帮助' },
  { value: 'values', label: '在意的事情', hint: '仪式感、承诺、个人空间、被理解等' },
  { value: 'habit', label: '生活习惯', hint: '作息、饮食、社交、娱乐方式' },
  { value: 'changes', label: '近期变化', hint: '最近新增的兴趣、压力来源、状态变化' },
]

export const EVIDENCE_TYPES: { value: EvidenceType; label: string; color: string; hint: string }[] = [
  { value: 'stated', label: 'TA 明确表达过', color: '#8CBF9B', hint: '有直接的原话或明确表态' },
  { value: 'repeated', label: '多次记录体现的倾向', color: '#E9B44C', hint: '至少两条记录互相印证' },
  { value: 'hypothesis', label: '需要进一步观察', color: '#B9ADA2', hint: '目前只是一两次的迹象，不下结论' },
]

export const evidenceMeta = (e: EvidenceType) => EVIDENCE_TYPES.find((x) => x.value === e) ?? EVIDENCE_TYPES[2]

export const CALENDAR_TYPES: { value: CalendarType; label: string }[] = [
  { value: 'solar', label: '公历' },
  { value: 'lunar', label: '农历' },
]

export const COMMON_TAGS = [
  '开心',
  '小惊喜',
  '争吵',
  '旅行',
  '约会',
  '加班',
  '压力',
  '生病',
  '家人',
  '朋友',
  '工作',
  '学习',
  '仪式感',
  '美食',
  '电影',
  '游戏',
]

export const QUICK_PRESETS = [
  { label: '今天很开心', type: 'daily' as EntryType, emoji: '😊' },
  { label: '一起吃饭', type: 'date' as EntryType, emoji: '🍜' },
  { label: '送了个礼物', type: 'gift' as EntryType, emoji: '🎁' },
  { label: 'TA 有点累', type: 'emotion' as EntryType, emoji: '😮‍💨' },
  { label: '发现新兴趣', type: 'interest' as EntryType, emoji: '✨' },
]
