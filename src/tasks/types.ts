/**
 * T8「为他记着」数据契约（T8-A）
 *
 * 语义约定（来自 D-007 / D-008 与编程交接大纲 T8-A）：
 * - 两类事项：`remind` = 他托我提醒他；`prepare` = 我准备为他做。
 * - 完成语义按类型分流：`remind` 勾完表示**我已经提醒过他**；`prepare` 表示**我已经办好**。
 *   两者都不表示「他已经办完」，也不是「系统已发出通知」。
 * - 截止时间（dueDate/dueTime）与提醒时间（TaskReminder）是两个独立字段，
 *   绝不把 dueAt 当 remindAt；没有截止日期的事项也允许只设提醒。
 * - 新增待办默认私有（D-008）：本文件的任何字段都不进入公开发布快照。
 * - 版本用 `rev` 单调递增，用于私有同步时拒绝「旧版本覆盖新版本」，
 *   与其它实体的 `updatedAt` 较新者胜是两套规则，不混用。
 */

/** 事项类型：他托我提醒 / 我准备为他做 */
export type TaskKind = 'remind' | 'prepare'

/** 状态：待办 / 完成 / 取消（取消可追溯，不混入活跃清单） */
export type TaskStatus = 'open' | 'done' | 'cancelled'

/** 重复频率；按日历计算，不用固定秒数 */
export type RepeatFreq = 'daily' | 'weekly' | 'monthly'

export interface TaskRepeat {
  freq: RepeatFreq
  /** 间隔倍数，>=1；如「每 2 周」= weekly + interval 2 */
  interval: number
  /** 系列 ID：同一系列的各次发生共享它，用于实例去重与历史追溯 */
  seriesId: string
}

/** 内容关联：指向已有业务对象，完成后可自愿转为回忆 */
export interface TaskLinks {
  wishId?: string
  giftId?: string
  entryId?: string
  photoId?: string
  anniversaryId?: string
}

export interface Task {
  id: string
  personId: string
  title: string
  kind: TaskKind
  note?: string
  status: TaskStatus
  /** 截止日期，墙钟日期 yyyy-MM-dd（按 timeZone 解释） */
  dueDate?: string
  /**
   * 截止时刻 HH:mm。
   * 只选日期时使用界面显式展示的默认值（见 DEFAULT_DUE_TIME），
   * 不静默用午夜，避免「以为是晚上 8 点，其实 0 点就响了」。
   */
  dueTime?: string
  /** 业务时区，默认 Asia/Shanghai */
  timeZone: string
  repeat?: TaskRepeat
  links: TaskLinks
  /** 完成时自愿留下的回忆文字；撤销完成不清空它 */
  completionNote?: string
  /** 作者显式选择转为公开回忆（默认 false = 私有，D-008） */
  madePublic?: boolean
  /** 修订版本：每次业务字段变化 +1 */
  rev: number
  createdAt: string
  updatedAt: string
  completedAt?: string
  cancelledAt?: string
}

/** 提醒基准：绝对时刻 / 相对截止时刻提前若干分钟 */
export type ReminderMode = 'absolute' | 'before'

/**
 * 提醒计划：独立稳定 ID，与任务一对多。
 * 一个任务可以有多个提醒（例如提前一天 + 当天早上），也可稍后提醒（snoozedUntil）。
 */
export interface TaskReminder {
  id: string
  taskId: string
  mode: ReminderMode
  /** mode=absolute：绝对墙钟日期 */
  date?: string
  /** mode=absolute：绝对墙钟时刻 HH:mm */
  time?: string
  /** mode=before：相对截止时刻提前的分钟数（正数） */
  offsetMinutes?: number
  enabled: boolean
  /** 计划版本：编辑提醒时间/启停都要 +1，旧待发计划据此失效 */
  rev: number
  /** 稍后提醒：本地 computed 的下一触发时间（ISO），优先于其它模式 */
  snoozedUntil?: string
  createdAt: string
  updatedAt: string
}

/**
 * 发生实例（occurrence）。
 *
 * id 是幂等键：`${taskId}@${slotMs}`。同一任务同一次计划时间只会有一行，
 * 站内提醒与系统通知共用它，因此「已读」与「完成」天然分离：
 * 读了一条通知不代表事情做完，勾了完成也不代表通知被读过。
 */
export interface TaskOccurrence {
  id: string
  taskId: string
  /** 该次计划触发时间（ISO，绝对时刻） */
  slotAt: string
  /** 计划触发时间（墙钟表示，便于人读与排错） */
  slotLocal: string
  /** 合并了哪些提醒计划（多计划的同一分钟只生成一条实例） */
  planIds: string[]
  /** 站内提醒生成时间 */
  firedAt?: string
  /** 站内提醒已读时间 */
  readAt?: string
  /** 已在页面内尝试系统通知的时间（不代表设备真的显示了） */
  systemAt?: string
  /** 用户主动忽略 */
  dismissedAt?: string
  createdAt: string
  updatedAt: string
}

/** 清单筛选（活跃清单与历史分开，取消的单独可追溯） */
export type TaskFilter = 'today' | 'upcoming' | 'overdue' | 'unscheduled' | 'done' | 'cancelled'

/** 设备通知能力（如实报告，不把「能申请权限」说成「关页也能收到」） */
export interface NotifyCapability {
  /** 浏览器是否支持 Notification API */
  notifications: boolean
  /** 是否支持 Push API（Web Push） */
  push: boolean
  /** 是否已在主屏幕/独立窗口运行（iOS 推送的前置条件） */
  standalone: boolean
  /** 当前权限状态 */
  permission: 'default' | 'granted' | 'denied' | 'unsupported'
  /** 是否已注册可用的 Service Worker */
  serviceWorker: boolean
  /** 关页后由服务端调度推送的能力。按 D-016 已确认不做，恒为 false */
  backgroundPush: false
  /** 供界面展示的原因说明 */
  reason: string
}

/**
 * 提醒能力范围（D-016，2026-10-26 用户确认）。
 *
 * 「打开网页后的站内提醒」是**最终交付范围**；关页/锁屏后的手机通知
 * 经核实当前托管无调度能力，且用户已明确不投入，因此不再作为待办缺口。
 * 界面据此如实说明，而不是长期挂着「未启用」让人以为还在等实现。
 */
export const REMINDER_SCOPE_NOTE =
  '提醒范围：打开网页后显示站内提醒（含回到前台、联网恢复）。关掉网页后的手机推送不在本版范围内。'

/** 提醒计划的默认截止时刻：选了日期但没选时间时使用，界面必须展示 */
export const DEFAULT_DUE_TIME = '09:00'

/** 默认业务时区（单作者，武汉/北京） */
export const DEFAULT_TIME_ZONE = 'Asia/Shanghai'

/** 漏过的多次提醒只保留最近一次：避免恢复后一口气推送全部历史 */
export const MAX_LOOKBACK_DAYS = 7