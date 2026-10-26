/**
 * T8-C 通知能力探测。
 *
 * 这个文件的全部意义是**如实报告**：不能把「浏览器支持 Notification API」
 * 说成「关掉网页也能收到提醒」。
 *
 * 已核实的事实（2026-10-26）：
 * - 当前托管环境（WorkBuddy 云服务）只提供数据库 / 认证 / 存储 / 大模型四个模块，
 *   没有定时任务、没有边缘函数、没有可以常驻的服务端进程。
 * - Web Push 要求由**服务端**在计划时刻调用推送服务（官方 Push API 文档）：
 *   浏览器关掉之后，页面里的 setTimeout、轮询、Service Worker 里的计时器都不再生效。
 *   因此「关页后的手机通知」在当前部署形态下**无法成立**，
 *   除非另有一个可持久调度并持有 VAPID 私钥的服务端。
 * - iOS/iPadOS 还额外要求站点被「添加到主屏幕」后以独立窗口运行才能申请推送权限。
 *
 * 结论：能力探测里 backgroundPush 恒为 false，界面必须照实显示为
 * 「未启用（当前环境不支持后台调度）」，不能只写「通知未授权」，
 * 也不能把站内提醒冒充成手机通知。
 */
import type { NotifyCapability } from './types'

/** 站点为推送预留的 SW 文件；未部署时探测会直接失败，属预期 */
export const PUSH_SW_URL = './tasks-sw.js'

function isStandalone(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return (
      window.matchMedia?.('(display-mode: standalone)').matches === true ||
      // iOS Safari 特有的历史属性
      (window.navigator as unknown as { standalone?: boolean }).standalone === true
    )
  } catch {
    return false
  }
}

export async function probeNotifyCapability(): Promise<NotifyCapability> {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return {
      notifications: false,
      push: false,
      standalone: false,
      permission: 'unsupported',
      serviceWorker: false,
      backgroundPush: false,
      reason: '当前环境没有浏览器通知能力',
    }
  }

  const notifications = 'Notification' in window
  const push = 'PushManager' in window && 'serviceWorker' in navigator
  const standalone = isStandalone()
  const permission: NotifyCapability['permission'] = notifications
    ? (Notification.permission as 'default' | 'granted' | 'denied')
    : 'unsupported'

  let serviceWorker = false
  if ('serviceWorker' in navigator) {
    try {
      const regs = await navigator.serviceWorker.getRegistrations()
      serviceWorker = regs.length > 0
    } catch {
      serviceWorker = false
    }
  }

  const parts: string[] = []
  if (!notifications) parts.push('这个浏览器不支持通知')
  if (permission === 'denied') parts.push('通知权限被拒绝，需要到系统/浏览器设置里恢复')
  if (notifications && permission === 'default') parts.push('尚未授权通知')
  if (!push) parts.push('不支持 Web Push')
  if (push && !standalone) parts.push('iPhone / iPad 需要先「添加到主屏幕」再授权')
  // 范围说明（D-016）：站内提醒是最终范围，关页推送已确认不做
  parts.push('提醒在打开网页时检查（含回到前台、联网恢复）；关掉网页后的手机推送不在本版范围内')

  return {
    notifications,
    push,
    standalone,
    permission,
    serviceWorker,
    backgroundPush: false,
    reason: parts.join('；'),
  }
}

/**
 * 申请通知权限。
 * 只在用户点击「开启通知」时调用，绝不在访客打开宇宙首页时弹窗。
 * 返回 true 仅表示**权限已授予**，不表示后台提醒可用。
 */
export async function requestNotifyPermission(): Promise<boolean> {
  if (typeof window === 'undefined' || !('Notification' in window)) return false
  if (Notification.permission === 'granted') return true
  if (Notification.permission === 'denied') return false
  try {
    const res = await Notification.requestPermission()
    return res === 'granted'
  } catch {
    return false
  }
}

/**
 * 页面在前台时用系统通知弹一次。
 *
 * 明确边界：这是**页面内**通知，页面关掉就不会响，不能计入「关页手机通知」。
 * 界面用它的前提是用户主动点了「发送测试通知」或开启开关。
 */
export async function showForegroundNotification(title: string, body: string, tag?: string): Promise<boolean> {
  if (typeof window === 'undefined' || !('Notification' in window)) return false
  if (Notification.permission !== 'granted') return false
  try {
    const reg = await navigator.serviceWorker?.getRegistration().catch(() => undefined)
    if (reg?.showNotification) {
      await reg.showNotification(title, { body, tag, badge: './icons/icon.svg', icon: './icons/icon.svg' })
      return true
    }
    new Notification(title, { body, tag, icon: './icons/icon.svg' })
    return true
  } catch {
    return false
  }
}