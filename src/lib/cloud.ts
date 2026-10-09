/**
 * 云服务客户端（单例）
 *
 * 四个模块（Auth / Database / Storage / LLM）共用这一个实例。
 * 登录后，共享的请求层会自动把当前会话带上 Database 与 Storage 请求，
 * 因此业务代码**不要**手动传 token / 用户 id。
 */
import { createWorkBuddyCloud, type CloudError } from '@tencent-ai/workbuddy-cloud-sdk'
import { CLOUD_PUBLIC_CONFIG } from './cloudConfig'

/* ------------------------------------------------------------------ */
/* 云端表结构（与 SQL 建表语句一一对应）                                */
/* 注意：必须用 type 而非 interface —— 泛型约束要求可赋值给              */
/* Record<string, unknown>，只有类型别名才会获得隐式索引签名。           */
/* ------------------------------------------------------------------ */

export type CloudBackupRow = {
  id: number
  owner_id: string
  backup_key: string
  label: string | null
  record_count: number
  photo_count: number
  photo_ids: string[]
  size_bytes: number
  app_version: number
  device: string | null
  created_at: string
}

export type CloudBackupInsert = {
  backup_key: string
  label?: string | null
  record_count?: number
  photo_count?: number
  photo_ids?: string[]
  size_bytes?: number
  app_version?: number
  device?: string | null
}

type HeartLogDatabase = {
  public: {
    Tables: {
      heartlog_backups: {
        Row: CloudBackupRow
        Insert: CloudBackupInsert
        Update: Partial<CloudBackupInsert>
        Relationships: []
      }
    }
    Views: Record<string, never>
    Functions: Record<string, never>
  }
}

export const cloud = createWorkBuddyCloud<HeartLogDatabase>({
  endpoint: CLOUD_PUBLIC_CONFIG.endpoint,
  oauthRelayBaseUrl: CLOUD_PUBLIC_CONFIG.oauthRelayBaseUrl,
  publishableKey: CLOUD_PUBLIC_CONFIG.publishableKey,
})

export class CloudUnavailableError extends Error {}

/**
 * 把 SDK 归一后的 CloudError 翻成用户能看懂的中文。
 * 按稳定的 kind 分支，不要去匹配 message 文案。
 */
export function cloudErrorText(err: CloudError | null | undefined, fallback = '操作失败，请稍后重试'): string {
  if (!err) return fallback
  switch (err.kind) {
    case 'unauthenticated':
      return '登录状态已失效，请重新登录'
    case 'permission-denied':
      return '没有权限执行这个操作'
    case 'not-found':
      return '云端没有找到对应的数据'
    case 'invalid-request':
      return `请求不合法：${err.message}`
    case 'credits-exhausted':
      return '云服务额度已用完，请到管理面板查看或升级'
    case 'rate-limited':
      return '操作太频繁，请稍后再试'
    case 'backend-unavailable':
      return '云服务暂时不可用，请稍后再试'
    case 'network':
      return '网络连接失败，请检查网络后重试'
    case 'unimplemented':
      return '当前环境未开放该能力'
    default:
      return err.message || fallback
  }
}

/** 当前会话（未登录返回 null）。会顺带刷新临近过期的 token。 */
export async function getCloudSession() {
  const { data, error } = await cloud.auth.getSession()
  if (error) return null
  return data
}

/** 是否已登录 */
export async function isCloudSignedIn(): Promise<boolean> {
  return (await getCloudSession()) !== null
}

/** 数据中心里的备份表名 */
export const BACKUP_TABLE = 'heartlog_backups'
