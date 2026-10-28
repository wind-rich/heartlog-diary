/**
 * 首页「为他记着」提醒卡（T8-B）。
 *
 * 定位：这是首页**真正会用的一块**，不只是计数。
 * - 顶部先给「已到期该提醒」的未读提醒（带快速完成/稍后）
 * - 中间是今天与逾期的待办，显示下次提醒时刻
 * - 底部一键新增
 *
 * 为什么单独成文件：Home.tsx 同时被访客端复用，
 * 访客端不能下载任何 tasks / Dexie 代码。lazy 之后访客端打开首页不会请求这个 chunk。
 *
 * 与铃铛（TaskBell）的分工：铃铛是「历史未读提醒」，这里是「现在该做什么」。
 * 两者共用同一批发生实例与任务，不重复生成。
 */
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import clsx from 'clsx'
import {
  AlarmClock,
  ArrowRight,
  BellRing,
  CalendarCheck,
  Check,
  Clock,
  Loader2,
  Plus,
  Sun,
} from 'lucide-react'
import { useSnapshot } from '../../state/SnapshotContext'
import { useAuthorReload } from '../AuthorReload'
import { db } from '../../../db/db'
import {
  completeTask,
  listReminders,
  markOccurrenceRead,
  snoozeTask,
  sweepOccurrences,
} from '../../../tasks/store'
import { bucketOf, dueLabel, nextTrigger, todayInZone } from '../../../tasks/model'
import { DEFAULT_TIME_ZONE } from '../../../tasks/types'
import type { Task, TaskOccurrence } from '../../../tasks/types'

interface Row {
  task: Task
  nextAt?: number
  bucket: 'overdue' | 'today' | 'upcoming' | 'unscheduled' | 'done' | 'cancelled'
}

interface Alert {
  occurrence: TaskOccurrence
  task?: Task
}

function fmtClock(ms: number): string {
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export default function TaskSummaryCard() {
  const snapshot = useSnapshot()
  const personId = snapshot.person.id
  const reload = useAuthorReload()

  const [rows, setRows] = useState<Row[]>([])
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState('')

  const todayStr = todayInZone(DEFAULT_TIME_ZONE)

  const load = useCallback(async () => {
    // 进首页顺手巡检一次：到期但还没生成实例的，在这里补上
    try {
      await sweepOccurrences(personId)
    } catch {
      // 巡检失败不阻塞展示
    }

    const tasks = await db.tasks.where('personId').equals(personId).toArray()
    const active = tasks
      .filter((t) => t.status === 'open')
      .map((t) => ({ task: t, bucket: bucketOf(t, todayStr) }))
      // 逾期与今天优先，其次按截止日期
      .sort((a, b) => {
        const rank = { overdue: 0, today: 1, upcoming: 2, unscheduled: 3, done: 4, cancelled: 5 } as const
        if (rank[a.bucket] !== rank[b.bucket]) return rank[a.bucket] - rank[b.bucket]
        return (a.task.dueDate ?? '9999-99-99') < (b.task.dueDate ?? '9999-99-99') ? -1 : 1
      })

    const withNext: Row[] = []
    for (const r of active) {
      const reminders = await listReminders(r.task.id)
      withNext.push({ ...r, nextAt: nextTrigger(r.task, reminders)?.atMs })
    }

    const occ = (await db.taskOccurrences.toArray()).filter(
      (o) => o.firedAt && !o.readAt && !o.dismissedAt,
    )
    occ.sort((a, b) => (a.slotAt < b.slotAt ? 1 : -1))
    const map = new Map(tasks.map((t) => [t.id, t]))

    setRows(withNext)
    setAlerts(occ.slice(0, 3).map((o) => ({ occurrence: o, task: map.get(o.taskId) })))
    setLoaded(true)
    return withNext
  }, [personId, todayStr])

  useEffect(() => {
    void load()
  }, [load])

  /** 完成一条：顺手把它的未读提醒标为已读（避免铃铛里留着已完成的事） */
  async function finish(task: Task) {
    setBusy(task.id)
    try {
      await completeTask(task.id)
      const occ = (await db.taskOccurrences.toArray()).filter((o) => o.taskId === task.id && !o.readAt)
      for (const o of occ) await markOccurrenceRead(o.id)
      await load()
      void reload?.()
    } finally {
      setBusy('')
    }
  }

  async function snooze(task: Task) {
    setBusy(task.id)
    try {
      // 首页的「稍后」固定 +1 小时：这是最常用的一档，细粒度选项在清单页
      await snoozeTask(task.id, Date.now() + 60 * 60_000)
      await load()
      void reload?.()
    } finally {
      setBusy('')
    }
  }

  // 完全空白时只留一个轻入口，不占首屏
  if (loaded && rows.length === 0 && alerts.length === 0) {
    return (
      <Link
        to="/tasks"
        className="v-task-home-empty"
      >
        <CalendarCheck size={14} className="text-rose-soft" />
        <span className="flex-1">还没有「为他记着」的事项，可以记下要提醒他的事</span>
        <Plus size={14} className="text-ink-300" />
      </Link>
    )
  }

  const todayCount = rows.filter((r) => r.bucket === 'today').length
  const overdueCount = rows.filter((r) => r.bucket === 'overdue').length
  // 首页只放最需要看的：逾期 + 今天，最多 4 条
  const focus = rows.filter((r) => r.bucket === 'overdue' || r.bucket === 'today').slice(0, 4)

  return (
    <section className="v-task-home-card">
      {/* 头部 */}
      <div className="v-task-home-head">
        <CalendarCheck size={14} className="text-rose-deep" />
        <span className="text-[13px] font-semibold text-ink-900">为他记着</span>
        {alerts.length > 0 && (
          <span className="inline-flex items-center gap-0.5 rounded-full bg-rose-soft/20 px-1.5 py-0.5 text-[10px] font-medium text-rose-deep">
            <BellRing size={9} /> {alerts.length}
          </span>
        )}
        <div className="flex-1" />
        <span className="text-[11px] text-ink-500">
          今天 <b className="text-ink-900">{todayCount}</b>
          {overdueCount > 0 && (
            <>
              {' · '}逾期 <b className="text-[#9B3B2E]">{overdueCount}</b>
            </>
          )}
        </span>
        <Link to="/tasks" className="ml-1 inline-flex items-center gap-0.5 text-[11.5px] text-rose-deep">
          全部 <ArrowRight size={12} />
        </Link>
      </div>

      {/* 到点提醒：最高优先级 */}
      {alerts.length > 0 && (
        <div className="border-b border-[#F3DFC4] bg-[#FFF7E8] px-4 py-2.5">
          <p className="mb-1.5 flex items-center gap-1 text-[11px] font-medium text-[#8A5A2B]">
            <AlarmClock size={11} /> 该提醒了
          </p>
          <ul className="space-y-1.5">
            {alerts.map(({ occurrence, task }) => (
              <li key={occurrence.id} className="flex items-start gap-2">
                <span className="mt-[6px] h-1.5 w-1.5 shrink-0 rounded-full bg-[#D9A24A]" />
                <div className="min-w-0 flex-1">
                  <Link
                    to={`/tasks?focus=${occurrence.taskId}`}
                    onClick={() => void markOccurrenceRead(occurrence.id)}
                    className="block truncate text-[12.5px] font-medium text-[#6B4520] underline-offset-2 hover:underline"
                  >
                    {task?.title ?? '（任务已删除）'}
                  </Link>
                  <p className="text-[10.5px] text-[#A9762C]">
                    原定 {occurrence.slotLocal}
                    {task ? ` · ${task.kind === 'remind' ? '提醒他' : '为他做'}` : ''}
                  </p>
                </div>
                {task && (
                  <button
                    type="button"
                    onClick={() => void finish(task)}
                    disabled={busy === task.id}
                    className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-white px-2 py-0.5 text-[10.5px] font-medium text-[#8A5A2B] disabled:opacity-50"
                  >
                    {busy === task.id ? <Loader2 size={9} className="animate-spin" /> : <Check size={9} />}
                    完成
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* 今天 / 逾期 */}
      {focus.length > 0 ? (
        <ul className="divide-y divide-cream-200">
          {focus.map(({ task, nextAt, bucket }) => (
            <li key={task.id} className="flex items-start gap-2.5 px-4 py-2.5">
              <button
                type="button"
                onClick={() => void finish(task)}
                disabled={busy === task.id}
                aria-label={`完成：${task.title}`}
                className="mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border border-cream-300 text-transparent transition hover:border-rose-soft hover:text-rose-soft disabled:opacity-50"
              >
                {busy === task.id ? <Loader2 size={9} className="animate-spin text-ink-300" /> : <Check size={11} />}
              </button>
              <div className="min-w-0 flex-1">
                <Link
                  to={`/tasks?focus=${task.id}`}
                  className="block break-words text-[12.5px] leading-snug text-ink-900 hover:text-rose-deep"
                >
                  {task.title}
                </Link>
                <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[10.5px] text-ink-500">
                  <span className={clsx(bucket === 'overdue' && 'text-[#9B3B2E]')}>{dueLabel(task, todayStr)}</span>
                  {nextAt && (
                    <span className="inline-flex items-center gap-0.5">
                      <Clock size={9} /> {fmtClock(nextAt)}
                    </span>
                  )}
                  <span className="text-ink-300">{task.kind === 'remind' ? '提醒他' : '为他做'}</span>
                </p>
              </div>
              <button
                type="button"
                onClick={() => void snooze(task)}
                disabled={busy === task.id}
                className="shrink-0 rounded-full border border-cream-300 px-2 py-0.5 text-[10.5px] text-ink-500 transition hover:text-rose-deep disabled:opacity-50"
              >
                1 小时后
              </button>
            </li>
          ))}
        </ul>
      ) : alerts.length > 0 ? (
        // 有到期提醒、但没有「今天/逾期」的待办时不要再写「今天没有到期的事」——
        // 上面刚刚提示了一条到期的，两句话会互相打脸。
        <div className="px-4 py-2.5">
          <p className="text-[11.5px] text-ink-300">上面的提醒处理完就清空了；其它待办在「即将到期」里。</p>
        </div>
      ) : (
        <div className="px-4 py-3">
          <p className="flex items-center gap-1.5 text-[12px] text-ink-500">
            <Sun size={12} className="text-[#D9A24A]" /> 今天没有到期的事，剩下的都在「即将到期」里
          </p>
        </div>
      )}

      {/* 底部 */}
      <div className="v-task-home-foot">
        <Link
          to="/tasks"
          className="v-task-home-primary"
        >
          <Plus size={10} /> 记一件事
        </Link>
        {rows.length > focus.length && (
          <Link to="/tasks?f=upcoming" className="text-[11px] text-ink-500">
            还有 {rows.length - focus.length} 件 <ArrowRight size={10} className="inline" />
          </Link>
        )}
        <div className="flex-1" />
        <span className="text-[10px] text-ink-300">仅自己可见</span>
      </div>
    </section>
  )
}