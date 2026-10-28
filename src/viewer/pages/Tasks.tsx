/**
 * 「为他记着」清单页（T8-B）。作者端专用，访客端不注册此路由。
 *
 * 页面结构按大纲要求：
 * - 六种状态分组（今天 / 即将到期 / 已逾期 / 未安排 / 已完成 / 已取消），
 *   已取消可追溯但不混入活跃清单；
 * - 两类事项筛选（他托我提醒 / 我准备为他做）；
 * - 每项可编辑、完成、撤销完成、取消、稍后提醒；
 * - 顶部独立展示同步状态与通知状态，两者互不冒充。
 *
 * 数据全部来自本机 Dexie，不读快照、不写公开发布。
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import clsx from 'clsx'
import {
  AlarmClock,
  Bell,
  BellOff,
  BookHeart,
  CalendarClock,
  Check,
  CheckCircle2,
  ChevronDown,
  Circle,
  Clock,
  EyeOff,
  Info,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Trash2,
  XCircle,
} from 'lucide-react'
import { useSnapshot } from '../state/SnapshotContext'
import { useAuthorReload } from '../author/AuthorReload'
import { useToast } from '../../components/ui'
import { db, nowISO } from '../../db/db'
import {
  cancelTask,
  completeTask,
  listReminders,
  reopenTask,
  restoreTask,
  snoozeTask,
  clearSnooze,
  sweepOccurrences,
  taskSummary,
} from '../../tasks/store'
import type { Task, TaskFilter, TaskKind, TaskReminder } from '../../tasks/types'
import { bucketOf, dueLabel, nextTrigger, planProblem, reminderLabel, todayInZone } from '../../tasks/model'
import { DEFAULT_TIME_ZONE } from '../../tasks/types'
import { probeNotifyCapability, requestNotifyPermission, showForegroundNotification } from '../../tasks/notify'
import { pendingTaskChanges, syncTasks } from '../../tasks/sync'
import { makeTaskPublic, revokeTaskPublic } from '../../tasks/makePublic'
import { TaskEditor, useTaskDelete } from '../author/tasks/TaskEditor'

const FILTERS: { key: TaskFilter; label: string }[] = [
  { key: 'today', label: '今天' },
  { key: 'upcoming', label: '即将到期' },
  { key: 'overdue', label: '已逾期' },
  { key: 'unscheduled', label: '未安排' },
  { key: 'done', label: '已完成' },
  { key: 'cancelled', label: '已取消' },
]

const KIND_LABEL: Record<TaskKind, string> = {
  remind: '他托我提醒',
  prepare: '我准备为他做',
}

const SNOOZE_OPTIONS = [
  { label: '30 分钟后', ms: 30 * 60_000 },
  { label: '1 小时后', ms: 60 * 60_000 },
  { label: '今晚 20:00', special: 'tonight' as const },
  { label: '明天此时', ms: 24 * 60 * 60_000 },
]

interface Row {
  task: Task
  reminders: TaskReminder[]
  nextAt?: number
}

export default function Tasks() {
  const snapshot = useSnapshot()
  const personId = snapshot.person.id
  const reload = useAuthorReload()
  const toast = useToast()

  const [params, setParams] = useSearchParams()
  const filter = (params.get('f') as TaskFilter) || 'today'
  const kindFilter = (params.get('k') as TaskKind | 'all') || 'all'
  const focusId = params.get('focus') || ''

  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<{ task?: Task } | null>(null)
  const [completing, setCompleting] = useState<Task | null>(null)
  const [openSnooze, setOpenSnooze] = useState<string>('')
  const [syncing, setSyncing] = useState(false)
  const [syncMsg, setSyncMsg] = useState('')
  const [dirty, setDirty] = useState(0)
  const [cap, setCap] = useState<Awaited<ReturnType<typeof probeNotifyCapability>> | null>(null)

  const todayStr = todayInZone(DEFAULT_TIME_ZONE)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const tasks = await db.tasks.where('personId').equals(personId).toArray()
      const out: Row[] = []
      for (const task of tasks) {
        const reminders = await listReminders(task.id)
        const next = nextTrigger(task, reminders)
        out.push({ task, reminders, nextAt: next?.atMs })
      }
      out.sort((a, b) => {
        // 有截止日期的按日期升序，没有的排后面；同日期按设置的提醒时间
        const da = a.task.dueDate ?? '9999-99-99'
        const db_ = b.task.dueDate ?? '9999-99-99'
        if (da !== db_) return da < db_ ? -1 : 1
        return (a.nextAt ?? Infinity) - (b.nextAt ?? Infinity)
      })
      setRows(out)
      setDirty(await pendingTaskChanges(readLastRevSnapshot()))
    } finally {
      setLoading(false)
    }
  }, [personId])

  useEffect(() => {
    void load()
    void probeNotifyCapability().then(setCap)
    // 进页面顺手补一次到期提醒，与铃铛的巡检同源、幂等
    void sweepOccurrences(personId).then(() => undefined)
  }, [load, personId])

  const filtered = useMemo(
    () =>
      rows.filter((r) => {
        if (kindFilter !== 'all' && r.task.kind !== kindFilter) return false
        const bucket = bucketOf(r.task, todayStr)
        if (filter === 'today') return bucket === 'today' || bucket === 'overdue'
        return bucket === filter
      }),
    [rows, filter, kindFilter, todayStr],
  )

  const summary = useMemo(() => {
    const active = rows.filter((r) => r.task.status === 'open')
    return {
      open: active.length,
      today: active.filter((r) => bucketOf(r.task, todayStr) === 'today').length,
      overdue: active.filter((r) => bucketOf(r.task, todayStr) === 'overdue').length,
    }
  }, [rows, todayStr])

  const counts = useMemo(() => {
    const out: Record<TaskFilter, number> = {
      today: 0,
      upcoming: 0,
      overdue: 0,
      unscheduled: 0,
      done: 0,
      cancelled: 0,
    }
    for (const r of rows) {
      const b = bucketOf(r.task, todayStr)
      // 「今天」这个分组按设计包含逾期项（逾期是最需要马上处理的「今天」），
      // 所以这里必须分别累加，不能对同一个 bucket 记两次 ——
      // 否则 chip 上的数字会比实际条数多一倍。
      if (b === 'overdue') {
        out.overdue++
        out.today++
      } else {
        out[b]++
      }
    }
    return out
  }, [rows, todayStr])

  const remove = useTaskDelete(() => {
    void load()
    void reload?.()
  })

  /**
   * 完成一条事项。
   * `share` 为 true 时顺手生成公开回忆 —— 这是 D-008 要求的**显式选择**，
   * 勾选框默认不勾，不勾就只留在自己这里。
   */
  async function doComplete(task: Task, note: string, share = false) {
    const done = await completeTask(task.id, note)
    if (share && done) {
      try {
        const res = await makeTaskPublic(done)
        toast(res.created ? '已办完，并写成了一条回忆' : '已办完（这条回忆之前就写过了）')
      } catch (err) {
        // 完成本身成功了，只是转公开失败：如实说，不假装整件事都成功
        toast(`已办完，但写成回忆失败：${(err as Error).message}`, 'err')
      }
    } else {
      toast(task.kind === 'remind' ? '已记录：我提醒过他了' : '已记录：这件事办好了')
    }
    await load()
    void reload?.()
  }

  /** 已完成但还没转公开的，补一次转换 */
  async function doShare(task: Task) {
    try {
      const res = await makeTaskPublic(task)
      toast(res.created ? '已写成一条公开回忆' : '这条回忆之前就写过了')
      await load()
      void reload?.()
    } catch (err) {
      toast(`转换失败：${(err as Error).message}`, 'err')
    }
  }

  async function doRevokeShare(task: Task) {
    const ok = await new Promise<boolean>((resolve) => {
      // 用一次轻量确认，避免误点把公开状态关掉
      resolve(window.confirm('取消公开只会断开关联，已经写好的那条回忆不会删除。继续？'))
    })
    if (!ok) return
    await revokeTaskPublic(task)
    toast('已取消公开状态，那条回忆仍保留在「故事」里')
    await load()
    void reload?.()
  }

  async function doReopen(task: Task) {
    await reopenTask(task.id)
    await load()
    void reload?.()
  }

  async function doCancel(task: Task) {
    await cancelTask(task.id)
    toast('已取消，可在「已取消」里找回')
    await load()
    void reload?.()
  }

  async function doRestore(task: Task) {
    await restoreTask(task.id)
    await load()
    void reload?.()
  }

  async function doSnooze(task: Task, opt: (typeof SNOOZE_OPTIONS)[number]) {
    let until: number
    if (opt.special === 'tonight') {
      const d = new Date()
      d.setHours(20, 0, 0, 0)
      // 已经过 20:00 就顺延到明天的 20:00
      if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1)
      until = d.getTime()
    } else {
      until = Date.now() + (opt.ms ?? 0)
    }
    await snoozeTask(task.id, until)
    setOpenSnooze('')
    toast(`已延后到 ${new Date(until).toLocaleString('zh-CN', { hour12: false })}`)
    await load()
  }

  async function doClearSnooze(task: Task) {
    await clearSnooze(task.id)
    toast('已取消延后，回到原计划')
    await load()
  }

  async function doSync() {
    setSyncing(true)
    setSyncMsg('')
    try {
      const res = await syncTasks()
      if (res.error) setSyncMsg(`同步失败：${res.error}`)
      else {
        setSyncMsg(`已同步：上传 ${res.pushed} 条、更新 ${res.pulled} 条${res.rejected ? `、${res.rejected} 条远端版本较旧已跳过` : ''}`)
        writeLastRevSnapshot(await currentRevSnapshot())
      }
      await load()
    } finally {
      setSyncing(false)
    }
  }

  async function enableNotify() {
    const ok = await requestNotifyPermission()
    setCap(await probeNotifyCapability())
    toast(ok ? '通知权限已授予（仅前台）' : '没有拿到通知权限', ok ? 'ok' : 'err')
  }

  async function sendTest() {
    const ok = await showForegroundNotification('测试通知', '前台通知可用；关掉网页后的推送不在本版范围内。', 'hl-test')
    toast(ok ? '已发送测试通知' : '发送失败', ok ? 'ok' : 'err')
  }

  function setFilter(next: TaskFilter) {
    const p = new URLSearchParams(params)
    p.set('f', next)
    setParams(p, { replace: true })
  }

  function setKind(next: TaskKind | 'all') {
    const p = new URLSearchParams(params)
    p.set('k', next)
    setParams(p, { replace: true })
  }

  return (
    <div className="v-tasks-page mx-auto max-w-[920px]">
      <header className="v-page-header">
        <div className="min-w-0">
          <div className="v-eyebrow">LITTLE THINGS, WELL REMEMBERED</div>
          <h1>为他记着</h1>
          <p>把关心放进日常。这些内容只存在你的设备与私有云端，不会出现在公网页。</p>
        </div>
        <button className="btn-primary inline-flex min-h-11 shrink-0 items-center gap-1.5 px-4 text-[13px]" onClick={() => setEditing({})}>
          <Plus size={15} /> 记一件事
        </button>
      </header>

      <div className="v-task-summary" aria-label="待办概览">
        <div><strong>{summary.open}</strong><span>未完成</span></div>
        <div><strong>{summary.today}</strong><span>今天</span></div>
        <div className={summary.overdue > 0 ? 'alert' : ''}><strong>{summary.overdue}</strong><span>已逾期</span></div>
      </div>

      {/* 状态条：同步 / 通知 分别说明，不合并成一句「已启用」 */}
      <StateBar
        dirty={dirty}
        syncing={syncing}
        syncMsg={syncMsg}
        cap={cap}
        onSync={() => void doSync()}
        onEnableNotify={() => void enableNotify()}
        onTest={() => void sendTest()}
      />

      {/* 分组 */}
      <div className="v-filter-row v-scroll-x" role="group" aria-label="按状态筛选事项">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFilter(f.key)}
            aria-pressed={filter === f.key}
            className={filter === f.key ? 'v-filter-chip active' : 'v-filter-chip'}
          >
            {f.label}
            {counts[f.key] > 0 && <span className="v-filter-count">{counts[f.key]}</span>}
          </button>
        ))}
      </div>

      <div className="v-task-kind-filter">
        <span>类型</span>
        {[
          { key: 'all' as const, label: '全部' },
          { key: 'remind' as const, label: '他托我提醒' },
          { key: 'prepare' as const, label: '我准备为他做' },
        ].map((k) => (
          <button
            key={k.key}
            type="button"
            onClick={() => setKind(k.key)}
            aria-pressed={kindFilter === k.key}
            className={kindFilter === k.key ? 'active' : ''}
          >
            {k.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-10 text-[12.5px] text-ink-300">
          <Loader2 size={14} className="animate-spin" /> 正在读取本机事项…
        </div>
      ) : filtered.length === 0 ? (
        <div className="v-task-empty">
          <Circle size={22} className="mx-auto" />
          <p className="mt-2 text-[13px] font-medium text-ink-700">
            {filter === 'today'
              ? '今天没有要提醒他的事'
              : filter === 'done'
                ? '还没有完成的事项'
                : filter === 'cancelled'
                  ? '没有被取消的事项'
                  : '这里还是空的'}
          </p>
          <p className="mt-1 text-[11.5px] leading-relaxed text-ink-500">
            待办默认只有自己能看到；完成后可以选择是否转成回忆。
          </p>
        </div>
      ) : (
        <ul className="v-task-list">
          {filtered.map((r) => (
            <TaskRow
              key={r.task.id}
              row={r}
              todayStr={todayStr}
              focused={r.task.id === focusId}
              snoozeOpen={openSnooze === r.task.id}
              onToggleSnooze={() => setOpenSnooze(openSnooze === r.task.id ? '' : r.task.id)}
              onSnooze={(opt) => void doSnooze(r.task, opt)}
              onClearSnooze={() => void doClearSnooze(r.task)}
              onEdit={() => setEditing({ task: r.task })}
              onComplete={() => setCompleting(r.task)}
              onReopen={() => void doReopen(r.task)}
              onCancel={() => void doCancel(r.task)}
              onRestore={() => void doRestore(r.task)}
              onDelete={() => void remove(r.task)}
              onShare={() => void doShare(r.task)}
              onRevokeShare={() => void doRevokeShare(r.task)}
            />
          ))}
        </ul>
      )}

      <p className="v-task-footnote">
        时区 {DEFAULT_TIME_ZONE}。重复事项按日历推进，月末不存在的日期会收敛到当月最后一天。
        「提醒过他了」与「他办完了」是两件事，勾选完成只记录前者。
      </p>

      {editing && (
        <TaskEditor
          open
          personId={personId}
          task={editing.task}
          onClose={() => setEditing(null)}
          onSaved={() => {
            void load()
            void reload?.()
          }}
        />
      )}

      {completing && (
        <CompleteInline
          task={completing}
          onClose={() => setCompleting(null)}
          onDone={(note, share) => void doComplete(completing, note, share)}
        />
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* 状态条                                                              */
/* ------------------------------------------------------------------ */

const PERM_LABEL: Record<string, string> = { granted: '已授予', denied: '已拒绝', default: '未授权', unsupported: '不支持' }

function StateBar({
  dirty,
  syncing,
  syncMsg,
  cap,
  onSync,
  onEnableNotify,
  onTest,
}: {
  dirty: number
  syncing: boolean
  syncMsg: string
  cap: Awaited<ReturnType<typeof probeNotifyCapability>> | null
  onSync: () => void
  onEnableNotify: () => void
  onTest: () => void
}) {
  return (
    <div className="v-task-state">
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1 rounded-full bg-cream-100 px-2.5 py-0.5 text-[11px] text-ink-700">
          <RefreshCw size={11} />
          {dirty > 0 ? `待同步 ${dirty} 条` : '本机已是最新'}
        </span>
        <button
          type="button"
          onClick={onSync}
          disabled={syncing}
          className="inline-flex items-center gap-1 rounded-full border border-cream-300 bg-white px-2.5 py-0.5 text-[11px] text-ink-700 disabled:opacity-60"
        >
          {syncing ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
          同步到私有云端
        </button>
        <span className="inline-flex items-center gap-1 rounded-full bg-cream-100 px-2.5 py-0.5 text-[11px] text-ink-500">
          <BellOff size={11} /> 关页推送：本版不含
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-cream-200 pt-2">
        <span className="inline-flex items-center gap-1 rounded-full bg-cream-100 px-2.5 py-0.5 text-[11px] text-ink-700">
          <Bell size={11} />
          {cap ? `通知权限：${PERM_LABEL[cap.permission] ?? cap.permission}` : '检查中…'}
        </span>
        <button
          type="button"
          onClick={onEnableNotify}
          disabled={!cap?.notifications || cap?.permission === 'granted'}
          className="rounded-full border border-cream-300 bg-white px-2.5 py-0.5 text-[11px] text-ink-700 disabled:opacity-50"
        >
          开启通知
        </button>
        <button
          type="button"
          onClick={onTest}
          disabled={cap?.permission !== 'granted'}
          className="rounded-full border border-cream-300 bg-white px-2.5 py-0.5 text-[11px] text-ink-700 disabled:opacity-50"
        >
          发送测试通知
        </button>
        <span className="inline-flex items-center gap-1 rounded-full bg-cream-100 px-2.5 py-0.5 text-[11px] text-ink-300">
          主屏幕 App：{cap?.standalone ? '是' : '否'}
        </span>
      </div>

      {cap && <p className="text-[11px] leading-relaxed text-ink-300">{cap.reason}</p>}
      {syncMsg && <p className="text-[11px] leading-relaxed text-ink-500">{syncMsg}</p>}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* 单行                                                                */
/* ------------------------------------------------------------------ */

function TaskRow({
  row,
  todayStr,
  focused,
  snoozeOpen,
  onToggleSnooze,
  onSnooze,
  onClearSnooze,
  onEdit,
  onComplete,
  onReopen,
  onCancel,
  onRestore,
  onDelete,
  onShare,
  onRevokeShare,
}: {
  row: Row
  todayStr: string
  focused: boolean
  snoozeOpen: boolean
  onToggleSnooze: () => void
  onSnooze: (opt: (typeof SNOOZE_OPTIONS)[number]) => void
  onClearSnooze: () => void
  onEdit: () => void
  onComplete: () => void
  onReopen: () => void
  onCancel: () => void
  onRestore: () => void
  onDelete: () => void
  onShare: () => void
  onRevokeShare: () => void
}) {
  const { task, reminders, nextAt } = row
  const bucket = bucketOf(task, todayStr)
  const problem = planProblem(task, reminders)
  const snoozed = reminders.some((r) => r.snoozedUntil)

  return (
    <li
      className={clsx(
        'v-task-row',
        focused && 'focused',
        task.status === 'cancelled' && 'cancelled',
      )}
    >
      <div className="flex items-start gap-2.5">
        <button
          type="button"
          onClick={task.status === 'open' ? onComplete : task.status === 'done' ? onReopen : undefined}
          disabled={task.status === 'cancelled'}
          aria-label={task.status === 'done' ? '撤销完成' : '标记完成'}
          className={clsx(
            'v-task-check',
            task.status === 'done' && 'done',
            task.status === 'cancelled' && 'cancelled',
          )}
        >
          <Check size={12} />
        </button>

        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-2">
            <p
              className={clsx(
                'min-w-0 flex-1 break-words text-[13.5px] font-medium leading-snug',
                task.status === 'done' || task.status === 'cancelled' ? 'text-ink-500 line-through' : 'text-ink-900',
              )}
            >
              {task.title}
            </p>
            <span className="v-task-kind-tag">{KIND_LABEL[task.kind]}</span>
          </div>

          <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] text-ink-500">
            <span className="inline-flex items-center gap-1">
              <CalendarClock size={11} />
              {dueLabel(task, todayStr)}
              {task.dueDate && ` · ${task.dueDate}${task.dueTime ? ` ${task.dueTime}` : ''}`}
            </span>
            {nextAt && task.status === 'open' && !problem && (
              <span className="inline-flex items-center gap-1">
                <AlarmClock size={11} />
                下次提醒 {new Date(nextAt).toLocaleString('zh-CN', { hour12: false, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
            {task.repeat && (
              <span className="inline-flex items-center gap-1">
                <RotateCcw size={11} />
                {task.repeat.freq === 'daily' ? '每天' : task.repeat.freq === 'weekly' ? '每周' : '每月'}
                {task.repeat.interval > 1 ? ` · 每 ${task.repeat.interval} 次` : ''}
              </span>
            )}
            {bucket === 'overdue' && (
              <span className="rounded-full bg-[#FDECEA] px-1.5 py-0.5 text-[10.5px] text-[#9B3B2E]">逾期</span>
            )}
            {task.status === 'done' && task.completionNote && (
              <span className="text-[10.5px] text-ink-300">回忆：{task.completionNote}</span>
            )}
          </div>

          {task.note && <p className="mt-1 line-clamp-2 text-[11.5px] leading-relaxed text-ink-500">{task.note}</p>}

          {problem && task.status === 'open' && (
            <p className="mt-1 inline-flex items-center gap-1 rounded-md bg-[#FFF3E6] px-1.5 py-0.5 text-[10.5px] text-[#A9762C]">
              <Info size={10} /> 提醒不会响：{problem}
            </p>
          )}

          {snoozed && (
            <div className="mt-1 flex items-center gap-1.5">
              <span className="rounded-md bg-[#EEF5EC] px-1.5 py-0.5 text-[10.5px] text-[#4F6B45]">已延后</span>
              <button type="button" onClick={onClearSnooze} className="text-[10.5px] text-ink-300 underline">
                恢复原计划
              </button>
            </div>
          )}

          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {task.status === 'open' && (
              <>
                <SmallBtn onClick={onEdit} icon={<Pencil size={11} />} label="编辑" />
                <SmallBtn onClick={onToggleSnooze} icon={<Clock size={11} />} label="稍后提醒" />
                <SmallBtn onClick={onCancel} icon={<XCircle size={11} />} label="取消" />
              </>
            )}
            {task.status === 'done' && (
              <>
                <SmallBtn onClick={onReopen} icon={<RotateCcw size={11} />} label="撤销完成" />
                {task.madePublic ? (
                  <>
                    <span className="inline-flex items-center gap-1 rounded-full bg-[#EEF5EC] px-2 py-0.5 text-[11px] text-[#4F6B45]">
                      <BookHeart size={11} /> 已写成回忆
                    </span>
                    <SmallBtn onClick={onRevokeShare} icon={<EyeOff size={11} />} label="取消公开" />
                  </>
                ) : (
                  <SmallBtn onClick={onShare} icon={<BookHeart size={11} />} label="写成回忆" />
                )}
              </>
            )}
            {task.status === 'cancelled' && <SmallBtn onClick={onRestore} icon={<CheckCircle2 size={11} />} label="恢复为待办" />}
            <button
              type="button"
              onClick={onDelete}
              className="v-task-action danger"
            >
              <Trash2 size={11} /> 删除
            </button>
          </div>

          {snoozeOpen && task.status === 'open' && (
            <div className="v-task-snooze">
              {SNOOZE_OPTIONS.map((o) => (
                <button
                  key={o.label}
                  type="button"
                  onClick={() => onSnooze(o)}
                  className="rounded-full border border-cream-300 bg-white px-2.5 py-1 text-[11.5px] text-ink-700"
                >
                  {o.label}
                </button>
              ))}
              <ChevronDown size={11} className="self-center text-ink-300" />
            </div>
          )}
        </div>
      </div>

      {reminders.length > 0 && task.status === 'open' && (
        <p className="mt-2 border-t border-cream-200 pt-1.5 text-[10.5px] text-ink-300">
          提醒：{reminders.map((r) => `${reminderLabel(r)}${r.enabled ? '' : '（已停用）'}`).join('；')}
        </p>
      )}
    </li>
  )
}

function SmallBtn({ onClick, icon, label }: { onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="v-task-action"
    >
      {icon} {label}
    </button>
  )
}

/* ------------------------------------------------------------------ */
/* 完成弹窗（内联，避免额外依赖）                                        */
/* ------------------------------------------------------------------ */

function CompleteInline({ task, onClose, onDone }: { task: Task; onClose: () => void; onDone: (note: string, share: boolean) => void }) {
  const [note, setNote] = useState(task.completionNote ?? '')
  const [share, setShare] = useState(false)
  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center sm:items-center">
      <div className="absolute inset-0 bg-[#151827]/45 backdrop-blur-[2px]" onClick={onClose} />
      <div className="v-task-complete-dialog relative w-full max-w-[420px] rounded-t-3xl p-5 sm:rounded-3xl">
        <p className="text-[15px] font-semibold text-ink-900">
          {task.kind === 'remind' ? '我已经提醒过他了' : '这件事已经办好了'}
        </p>
        <p className="mt-1 text-[12px] leading-relaxed text-ink-500">
          {task.kind === 'remind'
            ? '只记录我提醒过这件事；他有没有办完是另一件事，不会自动判定。'
            : '只记录我已经办好，不代表通知已被读过。'}
        </p>
        <textarea
          className="input mt-3"
          rows={3}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="留一句回忆（可留空，撤销完成也不会清掉）"
        />

        {/* 转为公开回忆：默认不勾，必须作者主动选（D-008） */}
        <label className="mt-2 flex cursor-pointer items-start gap-2 rounded-xl border border-cream-200 bg-white px-3 py-2">
          <input
            type="checkbox"
            checked={share}
            onChange={(e) => setShare(e.target.checked)}
            className="mt-0.5 h-4 w-4 accent-[#B4626B]"
          />
          <span className="min-w-0 flex-1">
            <span className="block text-[12.5px] text-ink-700">同时写成一条公开回忆</span>
            <span className="mt-0.5 block text-[11px] leading-relaxed text-ink-300">
              会在「故事」里生成一条记录，发布后访客也能看到。不勾选就只有你自己看得到。
            </span>
          </span>
        </label>

        <div className="mt-3 flex justify-end gap-2">
          <button type="button" className="btn-ghost px-3 py-1.5 text-[13px]" onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className="btn-primary px-3 py-1.5 text-[13px]"
            onClick={() => {
              onDone(note, share)
              onClose()
            }}
          >
            标记完成
          </button>
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* 「上次同步时的 rev 快照」：用于算「待同步」条数                        */
/* ------------------------------------------------------------------ */

const REV_SNAPSHOT_KEY = 'hl-task-rev-snapshot-v1'

function readLastRevSnapshot(): Record<string, number> {
  try {
    const raw = localStorage.getItem(REV_SNAPSHOT_KEY)
    return raw ? (JSON.parse(raw) as Record<string, number>) : {}
  } catch {
    return {}
  }
}

function writeLastRevSnapshot(snap: Record<string, number>): void {
  try {
    localStorage.setItem(REV_SNAPSHOT_KEY, JSON.stringify(snap))
  } catch {
    // 存不下只是状态展示不准，不影响同步本身
  }
}

async function currentRevSnapshot(): Promise<Record<string, number>> {
  const out: Record<string, number> = {}
  const [tasks, reminders, occ] = await Promise.all([
    db.tasks.toArray(),
    db.taskReminders.toArray(),
    db.taskOccurrences.toArray(),
  ])
  for (const t of tasks) out[`tasks:${t.id}`] = t.rev
  for (const r of reminders) out[`taskReminders:${r.id}`] = r.rev
  for (const o of occ) out[`taskOccurrences:${o.id}`] = Date.parse(o.updatedAt || nowISO())
  return out
}