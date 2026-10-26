/**
 * 站内提醒铃（T8-B）。
 *
 * 只在作者端挂载（Shell 里由 editable 控制）。它做三件事：
 * 1. 在进入页面 / 回到前台 / 联网恢复 / 前台每分钟巡检时，把到期的提醒落成「发生实例」；
 * 2. 把未读实例显示成铃铛角标，点开可逐条已读或全部已读；
 * 3. 如实展示通知能力状态，并提供「开启通知 / 发送测试通知」入口。
 *
 * 关键边界：
 * - 实例是幂等的（id = taskId@slotMs），反复巡检不会重复弹同一条。
 * - 已读不代表完成，完成也不代表已读 —— 二者写不同字段。
 * - 这里的系统通知只是**页面内**通知；关页后不会有提醒，界面必须写明。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import clsx from 'clsx'
import { Bell, BellRing, CheckCheck, Clock3, Info, Loader2, X } from 'lucide-react'
import { useSnapshot } from '../../state/SnapshotContext'
import { useAuthorReload } from '../AuthorReload'
import { db } from '../../../db/db'
import { markAllRead, markOccurrenceRead, dismissOccurrence, sweepOccurrences } from '../../../tasks/store'
import type { Task, TaskOccurrence } from '../../../tasks/types'
import { probeNotifyCapability, requestNotifyPermission, showForegroundNotification } from '../../../tasks/notify'

const SWEEP_INTERVAL_MS = 60_000

interface Row {
  occurrence: TaskOccurrence
  task?: Task
}

export default function TaskBell() {
  const snapshot = useSnapshot()
  const personId = snapshot.person.id
  const reload = useAuthorReload()

  const [open, setOpen] = useState(false)
  const [rows, setRows] = useState<Row[]>([])
  const [suppressed, setSuppressed] = useState(0)
  const [cap, setCap] = useState<Awaited<ReturnType<typeof probeNotifyCapability>> | null>(null)
  const [testing, setTesting] = useState(false)
  const [testMsg, setTestMsg] = useState('')
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)

  const load = useCallback(async () => {
    const all = await db.taskOccurrences.toArray()
    const unread = all.filter((o) => o.firedAt && !o.readAt && !o.dismissedAt)
    unread.sort((a, b) => (a.slotAt < b.slotAt ? 1 : -1))
    const tasks = await db.tasks.toArray()
    const map = new Map(tasks.map((t) => [t.id, t]))
    setRows(unread.map((o) => ({ occurrence: o, task: map.get(o.taskId) })))
  }, [])

  /** 巡检一次：生成到期实例；有新增时刷新列表并让外壳重读（任务状态可能变化） */
  const sweep = useCallback(async () => {
    try {
      const res = await sweepOccurrences(personId)
      setSuppressed(res.suppressed)
      if (res.created.length) {
        await load()
        // 页面内提示：仅在已授权且用户主动开过通知开关时弹系统通知
        if ((await probeNotifyCapability()).permission === 'granted') {
          for (const occ of res.created.slice(0, 3)) {
            const task = await db.tasks.get(occ.taskId)
            if (task) void showForegroundNotification(task.title, '「为他记着」到期提醒', occ.id)
          }
        }
        void reload?.()
      }
    } catch {
      // 巡检失败不阻塞界面：下次触发会重试，而且实例是幂等的
    }
  }, [personId, load, reload])

  useEffect(() => {
    void sweep()
    void load()
    void probeNotifyCapability().then(setCap)

    timer.current = setInterval(() => void sweep(), SWEEP_INTERVAL_MS)
    const onVisible = () => {
      if (document.visibilityState === 'visible') void sweep()
    }
    const onOnline = () => void sweep()
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('online', onOnline)
    return () => {
      if (timer.current) clearInterval(timer.current)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('online', onOnline)
    }
  }, [sweep, load])

  const unread = rows.length

  async function readOne(id: string) {
    await markOccurrenceRead(id)
    await load()
  }

  async function readAll() {
    await markAllRead()
    await load()
  }

  async function dismiss(id: string) {
    await dismissOccurrence(id)
    await load()
  }

  async function enableNotify() {
    const ok = await requestNotifyPermission()
    const next = await probeNotifyCapability()
    setCap(next)
    setTestMsg(
      ok
        ? '权限已授予。这只允许页面在前台时弹一条系统通知；关掉网页后的推送不在本版范围内。'
        : '没有得到通知权限。可以到浏览器/系统设置里手动允许后重试。',
    )
  }

  async function testNotify() {
    setTesting(true)
    setTestMsg('')
    try {
      const ok = await showForegroundNotification('测试通知', '如果你看到这条，说明前台通知可用；关页提醒仍需服务端调度。', 'hl-test')
      setTestMsg(ok ? '已发送一条前台测试通知。' : '发送失败：权限未授予或浏览器不支持。')
    } finally {
      setTesting(false)
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true)
          void load()
        }}
        aria-label={`站内提醒${unread ? `，${unread} 条未读` : ''}`}
        className="relative flex h-9 w-9 items-center justify-center rounded-full text-ink-500 transition hover:bg-cream-100"
      >
        {unread ? <BellRing size={18} className="text-rose-deep" /> : <Bell size={18} />}
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-deep px-1 text-[9.5px] font-semibold text-white">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="fixed inset-0 z-[75] flex items-start justify-center px-3 pt-16 sm:items-center sm:pt-0">
          <div className="absolute inset-0 bg-[#4A3B31]/35 backdrop-blur-[2px]" onClick={() => setOpen(false)} />
          <div className="relative max-h-[76vh] w-full max-w-[440px] overflow-hidden rounded-2xl border border-cream-200 bg-[#FFFCF8] shadow-pop">
            <div className="flex items-center gap-2 border-b border-cream-200 px-4 py-3">
              <BellRing size={15} className="text-rose-deep" />
              <div className="flex-1 text-[14px] font-semibold text-ink-900">站内提醒</div>
              {unread > 0 && (
                <button type="button" onClick={() => void readAll()} className="btn-text text-[12px]">
                  <CheckCheck size={13} /> 全部已读
                </button>
              )}
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="关闭"
                className="flex h-7 w-7 items-center justify-center rounded-full bg-cream-200 text-ink-500"
              >
                <X size={14} />
              </button>
            </div>

            <div className="max-h-[46vh] overflow-y-auto px-4 py-3">
              {rows.length === 0 ? (
                <p className="py-6 text-center text-[12.5px] text-ink-500">没有未读提醒。</p>
              ) : (
                <ul className="space-y-2">
                  {rows.map(({ occurrence, task }) => (
                    <li key={occurrence.id} className="rounded-xl border border-cream-200 bg-white px-3 py-2.5">
                      <div className="flex items-start gap-2">
                        <Clock3 size={13} className="mt-0.5 shrink-0 text-rose-soft" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[13px] font-medium text-ink-900">
                            {task?.title ?? '（任务已删除）'}
                          </p>
                          <p className="mt-0.5 text-[11px] text-ink-500">
                            原定 {occurrence.slotLocal}
                            {task ? ` · ${task.kind === 'remind' ? '他托我提醒' : '我准备为他做'}` : ''}
                          </p>
                          {task?.note && <p className="mt-1 line-clamp-2 text-[11.5px] text-ink-500">{task.note}</p>}
                        </div>
                      </div>
                      <div className="mt-2 flex items-center gap-2">
                        <Link
                          to={`/tasks?focus=${occurrence.taskId}`}
                          onClick={() => {
                            void readOne(occurrence.id)
                            setOpen(false)
                          }}
                          className="rounded-full bg-rose-soft/15 px-2.5 py-0.5 text-[11.5px] font-medium text-rose-deep"
                        >
                          打开事项
                        </Link>
                        {!occurrence.readAt && (
                          <button
                            type="button"
                            onClick={() => void readOne(occurrence.id)}
                            className="rounded-full border border-cream-300 px-2.5 py-0.5 text-[11.5px] text-ink-500"
                          >
                            标为已读
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => void dismiss(occurrence.id)}
                          className="ml-auto text-[11px] text-ink-300"
                        >
                          忽略
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}

              {suppressed > 0 && (
                <p className="mt-3 rounded-lg bg-[#FFF3E6] px-2.5 py-1.5 text-[11px] leading-relaxed text-[#A9762C]">
                  还有 {suppressed} 次更早的提醒已错过，只保留了最近一次，不重复弹出。
                </p>
              )}
            </div>

            <div className="border-t border-cream-200 bg-[#FFF9F3] px-4 py-3">
              <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-ink-500">
                <Info size={12} className="mt-0.5 shrink-0" />
                <span>
                  站内提醒在打开页面、回到前台或联网后检查一次，可离线保存。
                  {cap ? ` 通知能力：${cap.reason}` : ' 正在检查通知能力…'}
                </span>
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => void enableNotify()}
                  className={clsx(
                    'rounded-full px-3 py-1 text-[11.5px] font-medium',
                    cap?.permission === 'granted'
                      ? 'bg-[#EEF5EC] text-[#4F6B45]'
                      : 'bg-rose-deep text-white',
                  )}
                >
                  {cap?.permission === 'granted' ? '通知权限已授予' : '开启通知'}
                </button>
                <button
                  type="button"
                  onClick={() => void testNotify()}
                  disabled={testing}
                  className="inline-flex items-center gap-1 rounded-full border border-cream-300 bg-white px-3 py-1 text-[11.5px] text-ink-700 disabled:opacity-60"
                >
                  {testing && <Loader2 size={11} className="animate-spin" />}
                  发送测试通知
                </button>
                <span className="rounded-full bg-cream-100 px-2.5 py-1 text-[11px] text-ink-500">
                  关页推送：本版不含
                </span>
              </div>
              {testMsg && <p className="mt-2 text-[11px] leading-relaxed text-ink-500">{testMsg}</p>}
            </div>
          </div>
        </div>
      )}
    </>
  )
}