/**
 * 心意簿 数据模型
 * 说明：
 * - 所有实体使用稳定 id（字符串），便于导出、合并与后续跨设备同步。
 * - 照片二进制（Blob）单独存在 photos 表，其他表只引用 photoId，便于导出和同步。
 * - 时间统一用字符串保存：日期时间用 ISO（本地时区带偏移由 date-fns 处理），纯日期用 yyyy-MM-dd。
 * - 第一版只服务一个人物，但所有记录都带 personId，数据结构天然支持多人物。
 */

/** 历法类型：公历 / 农历 */
export type CalendarType = 'solar' | 'lunar'

/** 事件类型 */
export type EntryType = 'daily' | 'date' | 'gift' | 'interest' | 'health' | 'emotion' | 'other'

/** 心情 */
export type Mood = 'happy' | 'calm' | 'low' | 'anxious' | 'angry' | 'custom'

/** 偏好方向：喜欢 / 不喜欢 / 想尝试 */
export type PreferenceDirection = 'like' | 'dislike' | 'want'

/** 愿望状态 */
export type WishStatus = 'wish' | 'gifted' | 'fulfilled' | 'paused'

/** 健康跟进状态 */
export type HealthStatus = 'ongoing' | 'watching' | 'recovered'

/** 画像依据强度：TA 明确表达过 / 多次记录体现的倾向 / 暂时需要进一步观察 */
export type EvidenceType = 'stated' | 'repeated' | 'hypothesis'

/** 用户确认状态 */
export type ConfirmState = 'pending' | 'confirmed' | 'rejected'

/** 纪念日 */
export interface Anniversary {
  id: string
  name: string
  /** 公历存 yyyy-MM-dd；农历存 yyyy-MM-dd（年可忽略，用 2000 占位） */
  date: string
  calendarType: CalendarType
  /** 是否每年重复 */
  repeatYearly: boolean
  note?: string
}

/** 人物档案 */
export interface Person {
  id: string
  name: string
  nickname?: string
  /** 头像对应的 photoId */
  avatarPhotoId?: string
  /** 生日：公历存 yyyy-MM-dd；农历同样存 yyyy-MM-dd 但按 calendarType 解释 */
  birthday?: string
  calendarType: CalendarType
  /** 星座（可由公历生日计算，允许手动覆盖） */
  zodiac?: string
  zodiacOverridden?: boolean
  /** 相识日 */
  meetDate?: string
  anniversaries: Anniversary[]
  intro?: string
  tags: string[]
  isActive: boolean
  createdAt: string
  updatedAt: string
}

/** 兴趣与偏好 */
export interface Preference {
  id: string
  personId: string
  /** 分类：游戏 / 食物 / 音乐 / 电影 / 运动 / 其他 */
  category: string
  name: string
  direction: PreferenceDirection
  /** 喜欢程度 1~5，可空 */
  likeLevel?: number
  note?: string
  tags: string[]
  /** 最近确认时间 yyyy-MM-dd */
  lastConfirmedAt?: string
  /** 依据记录（事件 id），用于避免把一次偶然表现当成长期习惯 */
  evidenceEntryIds: string[]
  createdAt: string
  updatedAt: string
}

/** 生活时间线事件（含快速记录与完整记录） */
export interface Entry {
  id: string
  personId: string
  /** 发生时间（补记时保存真实发生时间，不等同于创建时间） */
  occurredAt: string
  type: EntryType
  title: string
  /** 具体经过 */
  content?: string
  /** TA 说了什么（直接表达） */
  taSaid?: string
  /** 我的观察（自己的判断，与上一项分开保存） */
  myObservation?: string
  mood?: Mood
  /** 自定义心情文字 */
  moodCustom?: string
  /** 心情程度 1~5 */
  moodLevel?: number
  tagList: string[]
  photoIds: string[]
  /** 后续需要做什么 */
  followUp?: string
  followUpDone: boolean
  /** 是否为快速记录 */
  quick: boolean
  createdAt: string
  updatedAt: string
}

/** 每日状态 */
export interface DailyStatus {
  id: string
  personId: string
  /** yyyy-MM-dd */
  date: string
  mood?: Mood
  moodCustom?: string
  moodLevel?: number
  /** 精力 1~5 */
  energy?: number
  /** 睡眠小时数 */
  sleepHours?: number
  /** 今天的好事 */
  goodThing?: string
  /** 烦心事 */
  worry?: string
  /** 需要关注的事 */
  needAttention?: string
  note?: string
  createdAt: string
  updatedAt: string
}

/** 健康记录（以记录与跟进为主，不用于推断疾病） */
export interface HealthRecord {
  id: string
  personId: string
  occurredAt: string
  symptom: string
  /** 程度 1~5 */
  severity?: number
  /** 就医 / 用药备注 */
  medication?: string
  note?: string
  status: HealthStatus
  /** 恢复情况 */
  recovery?: string
  resolvedAt?: string
  entryIds: string[]
  createdAt: string
  updatedAt: string
}

/** 礼物 */
export interface Gift {
  id: string
  personId: string
  name: string
  givenAt: string
  occasion?: string
  /** 对方的反应 */
  feedback?: string
  note?: string
  amount?: number
  entryId?: string
  wishId?: string
  photoIds: string[]
  createdAt: string
  updatedAt: string
}

/** 愿望 */
export interface Wish {
  id: string
  personId: string
  content: string
  raisedAt?: string
  status: WishStatus
  /** 1 高 2 中 3 低 */
  priority?: number
  occasion?: string
  note?: string
  giftId?: string
  entryIds: string[]
  createdAt: string
  updatedAt: string
}

/** 照片 */
export interface Photo {
  id: string
  personId: string
  /** 原图或压缩图（取决于上传时的选择） */
  blob: Blob
  /** 缩略图 */
  thumb: Blob
  mime: string
  /** 字节数 */
  size: number
  /** 拍摄时间 */
  takenAt?: string
  caption?: string
  entryId?: string
  giftId?: string
  tags: string[]
  /** 是否保留原图 */
  keepOriginal: boolean
  createdAt: string
}

/** 个人画像条目 */
export interface PortraitInsight {
  id: string
  personId: string
  /** 维度：兴趣与动力 / 相处偏好 / 情绪与支持方式 / 在意的事情 / 生活习惯 / 近期变化 */
  dimension: string
  description: string
  evidenceType: EvidenceType
  evidenceEntryIds: string[]
  confirmState: ConfirmState
  /** 是否被用户手动编辑过（AI 更新时不覆盖） */
  userEdited: boolean
  createdAt: string
  updatedAt: string
}

/** 总结 / 报告 */
export interface Summary {
  id: string
  personId: string
  kind: 'week' | 'month' | 'year' | 'custom' | 'portrait' | 'advice' | 'gift' | 'query'
  title: string
  rangeStart: string
  rangeEnd: string
  /** Markdown 正文 */
  content: string
  generator: 'manual' | 'ai'
  /** AI 生成时的元信息 */
  aiMeta?: {
    model?: string
    includeHealth: boolean
    includePrivate: boolean
    query?: string
    /** 引用的记录 id */
    citedEntryIds: string[]
    /** 记录不足部分的说明 */
    gaps?: string
  }
  evidenceEntryIds: string[]
  createdAt: string
  updatedAt: string
}

/** 键值设置（AI 配置、界面偏好等） */
export interface MetaRow<T = unknown> {
  key: string
  value: T
}

/** AI 配置 */
export interface AIConfig {
  enabled: boolean
  /** OpenAI 兼容的接口地址，例如 https://api.deepseek.com/v1 */
  baseUrl: string
  apiKey: string
  model: string
  /** 是否经过自建代理（服务端保存密钥，浏览器端不存 Key） */
  viaProxy: boolean
  proxyUrl?: string
  temperature?: number
}

/** 应用偏好设置 */
export interface AppPrefs {
  /** 上传图片时是否默认保留原图 */
  keepOriginalPhoto: boolean
  /** 压缩后最长边像素 */
  photoMaxEdge: number
  /** 缩略图最长边像素 */
  thumbMaxEdge: number
  /** 心情统计是否展示未记录日期为空白（大纲要求，固定 true，保留字段） */
  moodBlankForMissing: boolean
  /** 提醒开关（本地） */
  remindersEnabled: boolean
  /** 纪念日提前提醒天数 */
  remindDaysAhead: number
}
