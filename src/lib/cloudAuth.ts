/**
 * 邮箱登录 / 注册 / 会话
 *
 * 采用「邮箱验证码 + 邮箱密码」两条路：
 *   - 验证码：sendOtp 发码 → verifyOtp 提交（新用户需同时设密码）
 *   - 密码：signInWithPassword
 *
 * 发码与验码必须绑定到**两个不同的用户动作**：取码只发码，提交只验码，
 * 提交时绝不重新发码（包括验证码填错重试）。
 */
import { cloud, cloudErrorText } from './cloud'
import type { CloudUser } from '@tencent-ai/workbuddy-cloud-sdk'

export class AuthError extends Error {}

/** 待验证的邮箱验证码挑战，需在「取码」与「提交」两个动作之间保存在组件状态里 */
export interface PendingEmailOtp {
  email: string
  verificationId: string
  isExistingUser: boolean
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

/** 第一步：发送验证码（注册与登录共用） */
export async function sendEmailCode(email: string): Promise<PendingEmailOtp> {
  const target = normalizeEmail(email)
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(target)) {
    throw new AuthError('请输入正确的邮箱地址')
  }
  const sent = await cloud.auth.sendOtp({ email: target })
  if (sent.error) throw new AuthError(cloudErrorText(sent.error, '验证码发送失败'))
  return {
    email: target,
    verificationId: sent.data.verificationId,
    isExistingUser: sent.data.isExistingUser,
  }
}

/**
 * 第二步：提交验证码完成登录或注册。
 * 新邮箱注册必须带密码；已存在用户忽略该项。
 */
export async function submitEmailOtp(
  pending: PendingEmailOtp,
  token: string,
  password?: string,
): Promise<CloudUser> {
  if (!pending) throw new AuthError('请先获取验证码')
  if (!token.trim()) throw new AuthError('请输入验证码')
  if (!pending.isExistingUser && password !== undefined && password.length > 0 && password.length < 6) {
    throw new AuthError('密码至少 6 位')
  }

  const completed = await cloud.auth.verifyOtp({
    email: pending.email,
    verificationId: pending.verificationId,
    isExistingUser: pending.isExistingUser,
    token: token.trim(),
    password: pending.isExistingUser ? undefined : password,
  })
  if (completed.error) throw new AuthError(cloudErrorText(completed.error, '验证码不正确或已过期'))
  return completed.data.user
}

/** 邮箱 + 密码登录 */
export async function signInWithEmailPassword(email: string, password: string): Promise<CloudUser> {
  const target = normalizeEmail(email)
  if (!target) throw new AuthError('请输入邮箱')
  if (!password) throw new AuthError('请输入密码')
  const res = await cloud.auth.signInWithPassword({ email: target, password })
  if (res.error) throw new AuthError(cloudErrorText(res.error, '账号或密码不正确'))
  return res.data.user
}

export interface PasswordResetHandle {
  /** 提交收到的验证码与新密码 */
  updateUser(input: { nonce: string; password: string }): Promise<{ error: unknown }>
}

/** 忘记密码：发送重置验证码，返回可继续提交的句柄 */
export async function startPasswordReset(email: string): Promise<PasswordResetHandle> {
  const target = normalizeEmail(email)
  if (!target) throw new AuthError('请输入邮箱')
  const started = await cloud.auth.resetPasswordForEmail(target)
  if (started.error) throw new AuthError(cloudErrorText(started.error, '重置邮件发送失败'))
  return started.data
}

export async function signOutCloud(): Promise<void> {
  const res = await cloud.auth.signOut()
  if (res.error) throw new AuthError(cloudErrorText(res.error, '退出登录失败'))
}

export async function fetchCloudUser(): Promise<CloudUser | null> {
  const { data, error } = await cloud.auth.getSession()
  if (error) return null
  return data?.user ?? null
}
