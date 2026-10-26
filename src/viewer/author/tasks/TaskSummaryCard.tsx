/**
 * 首页「为他记着」摘要卡（T8-B）。仅作者端按需加载。
 *
 * 为什么单独成文件而不是写进 Home.tsx：Home 同时被访客端复用，
 * 访客端不能下载任何 tasks / Dexie 相关代码。这里做 lazy 后，
 * 访客端打开首页不会请求这个 chunk。
 */
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlarmClock, ArrowRight, BellRing, CalendarCheck, Plus } from 'lucide-react'
import { useSnapshot } from '../../state/SnapshotContext'
import { db } from '../../../db/db'
import { listReminders, taskSummary } from '../../../tasks/store'
import { nextTrigger, dueLabel, todayInZone } from '../../../tasks/model'
import { DEFAULT_TIME_ZONE } from '../../../tasks/types'
import type { Task } from '../../../tasks/types'

interface Item {
  task: Task
  nextAt?: number
}

export default function TaskSummaryCard() {
  const snapshot = useSnapshot()
  const personId = snapshot.person.id
  const [counts, setCounts] = useState<{ today: number; overdue: number; open: number; unread: number } | null>(null)
  const [items, setItems] = useState<Item[]>([])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const s = await taskSummary(personId)
      const tasks = await db.tasks.where('personId').equals(personId).toArray()
      const todayStr = todayInZone(DEFAULT_TIME_ZONE)
      const active = tasks
        .filter((t) => t.status === 'open')
        .sort((a, b) => (a.dueDate ?? '9999-99-99') < (b.dueDate ?? '9999-99-99') ? -1 : 1)
      const picked: Item[] = []
      for (const t of active.slice(0, 6)) {
        const reminders = await listReminders(t.id)
        picked.push({ task: t, nextAt: nextTrigger(t, reminders)?.atMs })
      }
      if (cancelled) return
      setCounts(s)
      setItems(picked.slice(0, 3))
      void todayStr
    })()
    return () => {
      cancelled = true
    }
  }, [personId])

  // 没有任务时不占首屏空间，只留一个轻入口
  if (counts && counts.open === 0) {
    return (
      <Link
        to="/tasks"
        className="flex items-center gap-2 rounded-2xl border border-dashed border-cream-300 bg-white/70 px-4 py-3 text-[12.5px] text-ink-500 transition hover:bg-cream-50"
      >
        <CalendarCheck size={14} className="text-rose-soft" />
        <span className="flex-1">还没有「为他记着」的事项，可以记下要提醒他的事</span>
        <Plus size={14} className="text-ink-300" />
      </Link>
    )
  }

  const todayStr = todayInZone(DEFAULT_TIME_ZONE)

  return (
    <section className="rounded-2xl border border-cream-200 bg-white p-4 shadow-card">
      <div className="flex items-center gap-2">
        <CalendarCheck size={14} className="text-rose-deep" />
        <span className="text-[13px] font-semibold text-ink-900">为他记着</span>
        {counts && counts.unread > 0 && (
          <span className="inline-flex items-center gap-0.5 rounded-full bg-rose-soft/18 px-1.5 py-0.5 text-[10px] text-rose-deep">
            <BellRing size={9} /> {counts.unread}
          </span>
        )}
        <div className="flex-1" />
        <Link to="/tasks" className="inline-flex items-center gap-0.5 text-[11.5px] text-rose-deep">
          全部 <ArrowRight size={12} />
        </Link>
      </div>

      <div className="mt-2 flex items-center gap-3 text-[12px] text-ink-500">
        <span>
          今天 <b className="text-ink-900">{counts?.today ?? 0}</b> 件
        </span>
        <span>
          逾期{' '}
          <b className={counts && counts.overdue > 0 ? 'text-[#9B3B2E]' : 'text-ink-900'}>{counts?.overdue ?? 0}</b> 件
        </span>
        <span className="text-ink-300">共 {counts?.open ?? 0} 件待办</span>
      </div>

      {items.length > 0 && (
        <ul className="mt-2.5 space-y-1.5 border-t border-cream-200 pt-2.5">
          {items.map(({ task, nextAt }) => (
            <li key={task.id} className="flex items-start gap-2">
              <span className="mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full bg-rose-soft" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[12.5px] text-ink-700">{task.title}</p>
                <p className="text-[10.5px] text-ink-300">
                  {dueLabel(task, todayStr)}
                  {nextAt ? ` · 提醒 ${new Date(nextAt).toLocaleString('zh-CN', { hour12: false, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}` : ''}
                </p>
              </div>
              <span className="shrink-0 text-[10px] text-ink-300">
                {task.kind === 'remind' ? '提醒他' : '为他做'}
              </span>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-2 flex items-center gap-1 text-[10.5px] text-ink-300">
        <AlarmClock size={10} /> 仅自己可见，不会出现在公网页
      </p>
    </section>
  )
}