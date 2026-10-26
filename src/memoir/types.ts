/**
 * T5 回忆录（memoir）数据模型。
 *
 * 为什么单独建实体而不是复用 `summaries`：
 * - 回顾（summary）是「一段时间内的自动/半自动汇总」，一条一段 Markdown；
 * - 回忆录是**人工整理的长文**，有章节顺序、每章各自引用哪些记录、
 *   哪些段落是 AI 草稿、哪些被作者改过。塞进 `summaries.content` 会把
 *   这些结构压在正文里，既不能排序也不能标记来源。
 *
 * 与既有约定的关系：
 * - 所有 ID 仍是稳定字符串，导出时直接作为锚点，不按序号生成（T5 要求格式升级后 ID 不变）；
 * - 章节正文是 Markdown，但**不引入 Markdown 文件与数据库的双向同步**——
 *   Markdown 只是导出产物，权威数据始终在本机库/云端作者数据（D-009）。
 */
import type { AIConfig } from '../db/types'

/** 章节来源：作者手写 / AI 生成 */
export type SectionOrigin = 'manual' | 'ai'

export interface MemoirSection {
  id: string
  heading: string
  /** Markdown 正文。作者手写与 AI 草稿都存在这里，靠 origin 区分来源 */
  body: string
  /** 本章引用了哪些记录（可追溯到具体 entry id） */
  entryIds: string[]
  origin: SectionOrigin
  /**
   * 正文里 `[E1]` 编号到真实记录 id 的映射。
   *
   * 为什么不在正文里直接写 id：读者看到 `[E1]` 是人话，`[e_abc123]` 不是；
   * 而导出时要能把它变成可点击的相对链接，就必须留着这层映射。
   * 作者手改正文后映射仍然有效（编号没变）。
   */
  citeMap?: Record<string, string>
  /** AI 生成信息；origin === 'ai' 时有值 */
  aiMeta?: {
    model: string
    at: string
    /** AI 实际引用的记录（已与允许范围取交集） */
    citedEntryIds: string[]
    /** 生成时的取材范围（yyyy-MM-dd），便于解释「为什么没写到某件事」 */
    rangeStart?: string
    rangeEnd?: string
  }
  /**
   * 作者动过这一章的时间。
   *
   * 只要这个字段有值，就视为「人工内容」：此后 AI 重新生成**不得覆盖**，
   * 只能另建新章节（T5 验收：人工修改的内容不得被重新生成覆盖）。
   */
  editedAt?: string
  createdAt: string
  updatedAt: string
}

export interface Memoir {
  id: string
  personId: string
  title: string
  subtitle?: string
  /** 取材范围（含两端，yyyy-MM-dd）；留空表示不限 */
  rangeStart?: string
  rangeEnd?: string
  sections: MemoirSection[]
  status: 'draft' | 'final'
  createdAt: string
  updatedAt: string
}

/** AI 生成一章草稿的输入 */
export interface MemoirDraftInput {
  memoirTitle: string
  heading: string
  /** 允许引用的记录（调用方先按范围筛好，AI 不能引用范围外的内容） */
  entries: {
    id: string
    occurredAt: string
    title: string
    content: string
    tags: string[]
    type?: string
  }[]
  /** 作者给的额外要求（例如「写短一点」「只用这一年的事」） */
  instruction?: string
  config: AIConfig
  cloudSignedIn?: boolean
}

export interface MemoirDraft {
  text: string
  /** 正文里 `E1` 编号 → 真实记录 id（导出时据此生成链接） */
  citeMap: Record<string, string>
  /** 正文里真实出现、且落在允许范围内的记录 id */
  citedEntryIds: string[]
  /** 正文里出现但不在允许范围内的引用（被剔除，用于提示） */
  rejectedIds: string[]
  model: string
  at: string
  /** 记录不足 / 模型提示的说明 */
  warnings: string[]
}
