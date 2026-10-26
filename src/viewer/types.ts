/**
 * 展示端公开契约（对应编程交接大纲 T1「发布格式与读取边界」）
 *
 * 约束：
 * - 这里只定义可以公开的字段。作者 AI 配置（含 apiKey）、设备凭据、完整备份都不在此结构内。
 * - 照片以资源引用表达，不携带 Blob；生产环境由发布服务按 key 下发 URL。
 * - 本文件不依赖 Dexie，展示端构建不会引入本地数据库。
 */

export const VIEWER_FORMAT_VERSION = 1

/* ------------------------------------------------------------------ */
/* 发布清单                                                            */
/* ------------------------------------------------------------------ */

export interface SnapshotManifest {
  formatVersion: number
  siteId: string
  /** 本次发布 ID，与线上版本指针一致 */
  publishId: string
  /** 本次发布所基于的线上版本，首次发布为空 */
  basePublishId?: string
  publishedAt: string
  /** 逐类记录数，提交前由服务端与内容文件核对 */
  counts: Record<string, number>
  /** 规范化业务内容哈希，用于判断两设备是否同一版本 */
  contentHash: string
}

/* ------------------------------------------------------------------ */
/* 媒体                                                                */
/* ------------------------------------------------------------------ */

export interface MediaAsset {
  /** 对象存储 key；原型阶段使用内联 data URL 直接占位 */
  key: string
  url: string
  mime: string
  size: number
  hash?: string
}

export interface PublicPhoto {
  id: string
  personId: string
  mime: string
  size: number
  width?: number
  height?: number
  /** 拍摄时间；缺失表示未知，不用创建时间冒充 */
  takenAt?: string
  caption?: string
  tags: string[]
  entryId?: string
  giftId?: string
  media: { thumb: MediaAsset; full: MediaAsset }
}

/* ------------------------------------------------------------------ */
/* 业务内容                                                            */
/* ------------------------------------------------------------------ */

export type EntryKind = 'daily' | 'date' | 'gift' | 'interest' | 'health' | 'emotion' | 'other'
export type Mood = 'happy' | 'calm' | 'low' | 'anxious' | 'angry' | 'custom'
export type CalendarKind = 'solar' | 'lunar'
export type PreferenceDirection = 'like' | 'dislike' | 'want'
export type WishStatus = 'wish' | 'gifted' | 'fulfilled' | 'paused'
export type HealthStatus = 'ongoing' | 'watching' | 'recovered'
export type EvidenceType = 'stated' | 'repeated' | 'hypothesis'
export type ConfirmState = 'pending' | 'confirmed' | 'rejected'
export type SummaryKind = 'week' | 'month' | 'year' | 'custom' | 'portrait' | 'advice' | 'gift' | 'query'

export interface PublicAnniversary {
  id: string
  name: string
  /** 公历 yyyy-MM-dd；农历同样存 yyyy-MM-dd，按 calendarType 解释 */
  date: string
  calendarType: CalendarKind
  repeatYearly: boolean
  note?: string
}

export interface PublicPerson {
  id: string
  /** 公开称呼，来自作者配置，不是自动推导 */
  displayName: string
  nickname?: string
  intro?: string
  avatarPhotoId?: string
  birthday?: string
  calendarType: CalendarKind
  zodiac?: string
  /** 相识日；不等于恋爱日起始 */
  meetDate?: string
  tags: string[]
}

export interface PublicEntry {
  id: string
  occurredAt: string
  kind: EntryKind
  title: string
  content?: string
  /** TA 说了什么 */
  taSaid?: string
  /** 我的观察，与上面分开保存 */
  myObservation?: string
  mood?: Mood
  moodCustom?: string
  moodLevel?: number
  tags: string[]
  photoIds: string[]
  quick: boolean
}

export interface PublicPreference {
  id: string
  category: string
  name: string
  direction: PreferenceDirection
  likeLevel?: number
  note?: string
  tags: string[]
  lastConfirmedAt?: string
  /** 依据记录 ID，用于区分长期偏好和一次性表现 */
  evidenceEntryIds: string[]
}

export interface PublicWish {
  id: string
  content: string
  raisedAt?: string
  status: WishStatus
  priority?: number
  occasion?: string
  note?: string
  giftId?: string
  entryIds: string[]
}

export interface PublicGift {
  id: string
  name: string
  givenAt: string
  occasion?: string
  feedback?: string
  note?: string
  photoIds: string[]
  wishId?: string
  entryId?: string
}

export interface PublicHealth {
  id: string
  occurredAt: string
  symptom: string
  severity?: number
  note?: string
  status: HealthStatus
  recovery?: string
  resolvedAt?: string
}

export interface PublicInsight {
  id: string
  dimension: string
  description: string
  /** 依据强度：TA 明确表达 / 多次记录体现 / 待观察 */
  evidenceType: EvidenceType
  evidenceEntryIds: string[]
  confirmState: ConfirmState
}

export interface PublicSummary {
  id: string
  kind: SummaryKind
  title: string
  rangeStart: string
  rangeEnd: string
  /** Markdown 正文 */
  content: string
  generator: 'manual' | 'ai'
  evidenceEntryIds: string[]
}

export interface PublicDailyStatus {
  id: string
  date: string
  mood?: Mood
  moodLevel?: number
  energy?: number
  sleepHours?: number
  goodThing?: string
  worry?: string
  note?: string
}

/* ------------------------------------------------------------------ */
/* 展示配置（逐字段白名单，不从整个 meta 复制）                          */
/* ------------------------------------------------------------------ */

export interface ViewerConfig {
  /** 中心人物引用 */
  centerPersonId: string
  /** 首页寄语，来自作者填写 */
  tagline: string
  /** 封面媒体；缺失时用中心人物头像 */
  coverPhotoId?: string
  /** 主题标记，首版只有一套暖色 */
  theme: 'warm-light'
  sections: {
    photos: boolean
    stories: boolean
    archive: boolean
    wishes: boolean
    health: boolean
    music: boolean
  }
  music?: {
    title: string
    artist?: string
    /** 音源地址；缺失时卡片降级为静态信息，不自动播放 */
    src?: string
  }
}

/* ------------------------------------------------------------------ */
/* 快照                                                                */
/* ------------------------------------------------------------------ */

export interface PublishedSnapshot {
  manifest: SnapshotManifest
  config: ViewerConfig
  person: PublicPerson
  anniversaries: PublicAnniversary[]
  entries: PublicEntry[]
  photos: PublicPhoto[]
  preferences: PublicPreference[]
  wishes: PublicWish[]
  gifts: PublicGift[]
  health: PublicHealth[]
  insights: PublicInsight[]
  summaries: PublicSummary[]
  statuses: PublicDailyStatus[]
  /**
   * 仅原型使用的草稿差异，不是公开发布格式的一部分。
   * 正式实现由发布服务在提交前计算逐类差异。
   */
  draft?: {
    basedOn: string
    addedEntries: number
    addedPhotos: number
    note: string
  }
}

/** 原型阶段的场景：默认演示 / 空态 / 压力数据 */
export type SnapshotScene = 'demo' | 'empty' | 'stress' | 'broken' | 'long'
