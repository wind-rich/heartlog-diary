/**
 * 待办编辑表单（T8-B）。作者端懒加载。
 *
 * 表单里最需要注意的两件事：
 * 1. **截止时间与提醒时间分开**。「只选了日期」时必须告诉用户提醒会落在几点，
 *    不能静默按午夜处理；提示文案直接读 DEFAULT_DUE_TIME，避免两处写死不一致。
 * 2. **「提前提醒」依赖截止时间**。没填截止日期时该模式不可用，
 *    并且明确解释原因，而不是保存成功后什么也不响。
 */
import { useEffect, useState } from 'react'
import { Minus, Plus, Trash2 } from 'lucide-react'
import { Modal, useConfirm, useToast } from '../../../components/ui'
import { db } from '../../../db/db'
import {
  addReminder,
  createTask,
  deleteReminder,
  listReminders,
  updateReminder,
  updateTask,
} from '../../../tasks/store'
import {
  DEFAULT_DUE_TIME,
  DEFAULT_TIME_ZONE,
  type RepeatFreq,
  type Task,
  type TaskKind,
  type TaskReminder,
} from '../../../tasks/types'
import { reminderLabel } from '../../../tasks/model'

export interface TaskEditorProps {
  open: boolean
  personId: string
  task?: Task
  onClose: () => void
  onSaved: () => void
}

const KINDS: { key: TaskKind; label: string; desc: string }[] = [
  { key: 'remind', label: '他托我提醒', desc: '勾选完成表示「我已经提醒过他了」，不代表他已经办完' },
  { key: 'prepare', label: '我准备为他做', desc: '勾选完成表示「我已经办好了」' },
]

const FREQS: { key: RepeatFreq; label: string }[] = [
  { key: 'daily', label: '每天' },
  { key: 'weekly', label: '每周' },
  { key: 'monthly', label: '每月' },
]

const OFFSETS = [
  { minutes: 0, label: '到点时' },
  { minutes: 30, label: '提前 30 分钟' },
  { minutes: 60, label: '提前 1 小时' },
  { minutes: 1440, label: '提前 1 天' },
]

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[12px] text-ink-500">
        {label}
        {hint && <span className="ml-1 text-ink-300">{hint}</span>}
      </span>
      {children}
    </label>
  )
}

export function TaskEditor({ open, personId, task, onClose, onSaved }: TaskEditorProps) {
  const toast = useToast()
  const confirm = useConfirm()

  const [title, setTitle] = useState('')
  const [kind, setKind] = useState<TaskKind>('remind')
  const [note, setNote] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [dueTime, setDueTime] = useState('')
  const [repeatFreq, setRepeatFreq] = useState<RepeatFreq | ''>('')
  const [repeatInterval, setRepeatInterval] = useState(1)
  const [reminders, setReminders] = useState<TaskReminder[]>([])
  const [saving, setSaving] = useState(false)

  // 新建时的默认提醒：一项「到点时」
  const [newReminders, setNewReminders] = useState<{ mode: 'absolute' | 'before'; offsetMinutes: number; date: string; time: string }[]>([])

  useEffect(() => {
    if (!open) return
    setTitle(task?.title ?? '')
    setKind(task?.kind ?? 'remind')
    setNote(task?.note ?? '')
    setDueDate(task?.dueDate ?? '')
    setDueTime(task?.dueTime ?? '')
    setRepeatFreq(task?.repeat?.freq ?? '')
    setRepeatInterval(task?.repeat?.interval ?? 1)
    setNewReminders([])
    if (task) {
      void listReminders(task.id).then(setReminders)
    } else {
      setReminders([])
    }
  }, [open, task])

  const hasDue = Boolean(dueDate)
  // 只选日期时的实际提醒时刻：界面必须显式展示，不能默认为午夜
  const effectiveTime = dueTime || DEFAULT_DUE_TIME

  async function save() {
    if (!title.trim()) return
    setSaving(true)
    try {
      const repeat = repeatFreq
        ? {
            freq: repeatFreq,
            interval: Math.max(1, repeatInterval),
            seriesId: task?.repeat?.seriesId ?? `sr_${Date.now().toString(36)}`,
          }
        : undefined

      let id = task?.id
      if (task) {
        const next = await updateTask(task.id, {
          title: title.trim(),
          kind,
          note: note.trim() || undefined,
          dueDate: dueDate || undefined,
          dueTime: dueDate ? dueTime || undefined : undefined,
          repeat,
        })
        if (!next) throw new Error('任务已不存在')
      } else {
        const created = await createTask({
          personId,
          title,
          kind,
          note,
          dueDate: dueDate || undefined,
          dueTime: dueDate ? dueTime || undefined : undefined,
          repeat,
        })
        id = created.id
      }

      // 新加的提醒落库
      if (id) {
        for (const nr of newReminders) {
          await addReminder(id, {
            mode: nr.mode,
            date: nr.mode === 'absolute' ? nr.date || dueDate || undefined : undefined,
            time: nr.mode === 'absolute' ? nr.time || effectiveTime : undefined,
            offsetMinutes: nr.mode === 'before' ? nr.offsetMinutes : undefined,
          })
        }
      }

      toast(task ? '已保存' : '已添加')
      onSaved()
      onClose()
    } catch (err) {
      toast(`保存失败：${(err as Error).message}`, 'err')
    } finally {
      setSaving(false)
    }
  }

  async function removeReminder(id: string) {
    await deleteReminder(id)
    if (task) setReminders(await listReminders(task.id))
  }

  async function toggleReminder(r: TaskReminder) {
    await updateReminder(r.id, { enabled: !r.enabled })
    if (task) setReminders(await listReminders(task.id))
  }

  const kindDesc = KINDS.find((k) => k.key === kind)?.desc ?? ''

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={task ? '编辑事项' : '新增事项'}
      footer={
        <div className="flex items-center justify-end gap-2">
          {!title.trim() && <span className="mr-auto text-[11.5px] text-ink-300">填写标题后可保存</span>}
          <button type="button" className="btn-ghost px-3 py-1.5 text-[13px]" onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className="btn-primary px-3 py-1.5 text-[13px]"
            onClick={() => void save()}
            disabled={saving || !title.trim()}
          >
            {saving ? '保存中…' : '保存'}
          </button>
        </div>
      }
    >
      <div className="space-y-3.5">
        <Field label="标题">
          <input
            className="input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="比如 提醒他取快递 / 给他买生日蛋糕"
            maxLength={120}
          />
        </Field>

        <Field label="类型" hint="两类事项的完成含义不同">
          <div className="flex gap-2">
            {KINDS.map((k) => (
              <button
                key={k.key}
                type="button"
                onClick={() => setKind(k.key)}
                className={
                  kind === k.key
                    ? 'flex-1 rounded-xl border border-rose-soft bg-rose-soft/12 px-2 py-2 text-[12.5px] font-medium text-rose-deep'
                    : 'flex-1 rounded-xl border border-cream-300 bg-white px-2 py-2 text-[12.5px] text-ink-500'
                }
              >
                {k.label}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-[11.5px] leading-relaxed text-ink-300">{kindDesc}</p>
        </Field>

        <Field label="备注">
          <textarea className="input" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>

        <div className="grid grid-cols-2 gap-2">
          <Field label="截止日期" hint="可留空">
            <input className="input" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </Field>
          <Field label="截止时刻" hint="可留空">
            <input
              className="input"
              type="time"
              value={dueTime}
              onChange={(e) => setDueTime(e.target.value)}
              disabled={!dueDate}
            />
          </Field>
        </div>

        {hasDue && (
          <p className="rounded-lg bg-cream-100 px-2.5 py-1.5 text-[11.5px] leading-relaxed text-ink-500">
            只填日期不填时刻时，默认按 <b className="text-ink-700">{DEFAULT_DUE_TIME}</b> 处理（不会用午夜），
            时区 {DEFAULT_TIME_ZONE}。
          </p>
        )}

        <Field label="重复" hint="按日历计算，月末会自动收敛到当月最后一天">
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => setRepeatFreq('')}
              className={
                repeatFreq === ''
                  ? 'rounded-full bg-rose-deep px-3 py-1 text-[12px] text-white'
                  : 'rounded-full bg-cream-200 px-3 py-1 text-[12px] text-ink-700'
              }
            >
              不重复
            </button>
            {FREQS.map((f) => (
              <button
                key={f.key}
                type="button"
                onClick={() => setRepeatFreq(f.key)}
                className={
                  repeatFreq === f.key
                    ? 'rounded-full bg-rose-deep px-3 py-1 text-[12px] text-white'
                    : 'rounded-full bg-cream-200 px-3 py-1 text-[12px] text-ink-700'
                }
              >
                {f.label}
              </button>
            ))}
          </div>
          {repeatFreq && (
            <div className="mt-2 flex items-center gap-2">
              <span className="text-[12px] text-ink-500">每</span>
              <input
                className="input w-16 py-1 text-center"
                type="number"
                min={1}
                max={30}
                value={repeatInterval}
                onChange={(e) => setRepeatInterval(Number(e.target.value) || 1)}
              />
              <span className="text-[12px] text-ink-500">
                {repeatFreq === 'daily' ? '天' : repeatFreq === 'weekly' ? '周' : '月'}一次
              </span>
            </div>
          )}
        </Field>

        {/* 提醒计划 */}
        <div className="rounded-xl border border-cream-200 bg-white p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[12.5px] font-medium text-ink-700">提醒</span>
            <span className="text-[11px] text-ink-300">可与截止时间不同</span>
          </div>

          {task && reminders.length > 0 && (
            <ul className="mb-2 space-y-1.5">
              {reminders.map((r) => (
                <li key={r.id} className="flex items-center gap-2 rounded-lg bg-cream-50 px-2.5 py-1.5">
                  <button
                    type="button"
                    onClick={() => void toggleReminder(r)}
                    className={
                      r.enabled
                        ? 'h-4 w-4 shrink-0 rounded-full bg-rose-deep'
                        : 'h-4 w-4 shrink-0 rounded-full border border-cream-300 bg-white'
                    }
                    aria-label={r.enabled ? '停用这个提醒' : '启用这个提醒'}
                  />
                  <span className="flex-1 text-[12px] text-ink-700">{reminderLabel(r)}</span>
                  <button
                    type="button"
                    onClick={() => void removeReminder(r.id)}
                    className="text-ink-300 hover:text-rose-deep"
                    aria-label="删除这个提醒"
                  >
                    <Trash2 size={12} />
                  </button>
                </li>
              ))}
            </ul>
          )}

          {newReminders.length > 0 && (
            <ul className="mb-2 space-y-1.5">
              {newReminders.map((nr, i) => (
                <li key={i} className="flex items-center gap-2 rounded-lg bg-[#FFF7E8] px-2.5 py-1.5">
                  <span className="flex-1 text-[12px] text-[#8A5A2B]">
                    {nr.mode === 'absolute'
                      ? `在 ${nr.date || dueDate || '（待填日期）'} ${nr.time || effectiveTime} 提醒`
                      : `${OFFSETS.find((o) => o.minutes === nr.offsetMinutes)?.label ?? `提前 ${nr.offsetMinutes} 分钟`}提醒`}
                    <span className="ml-1 text-[10.5px] text-[#B98A57]">保存后生效</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => setNewReminders((list) => list.filter((_, idx) => idx !== i))}
                    className="text-[#B98A57]"
                    aria-label="移除这条待保存的提醒"
                  >
                    <Minus size={12} />
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() =>
                setNewReminders((l) => [...l, { mode: 'absolute', offsetMinutes: 0, date: dueDate, time: effectiveTime }])
              }
              className="inline-flex items-center gap-1 rounded-full border border-cream-300 bg-white px-2.5 py-1 text-[11.5px] text-ink-700"
            >
              <Plus size={11} /> 指定时刻
            </button>
            {OFFSETS.map((o) => (
              <button
                key={o.minutes}
                type="button"
                disabled={!hasDue}
                onClick={() =>
                  setNewReminders((l) => [...l, { mode: 'before', offsetMinutes: o.minutes, date: '', time: '' }])
                }
                title={hasDue ? undefined : '「提前提醒」需要先填截止日期'}
                className="rounded-full border border-cream-300 bg-white px-2.5 py-1 text-[11.5px] text-ink-700 disabled:cursor-not-allowed disabled:opacity-45"
              >
                {o.label}
              </button>
            ))}
          </div>
          {!hasDue && (
            <p className="mt-2 text-[11px] leading-relaxed text-ink-300">
              没有截止日期时，「提前提醒」不可用；可以改用「指定时刻」单独设一个提醒时间。
            </p>
          )}
        </div>

        {task && (
          <p className="text-[11px] leading-relaxed text-ink-300">
            修订版本 rev {task.rev} · 新增待办默认仅自己可见，不会出现在公网页或宇宙里。
          </p>
        )}
      </div>
    </Modal>
  )
}

/* ------------------------------------------------------------------ */
/* 完成时留回忆                                                         */
/* ------------------------------------------------------------------ */

export function CompleteTaskDialog({
  open,
  task,
  onClose,
  onDone,
}: {
  open: boolean
  task?: Task
  onClose: () => void
  onDone: (note: string) => void
}) {
  const [note, setNote] = useState('')
  useEffect(() => {
    if (open) setNote(task?.completionNote ?? '')
  }, [open, task])

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={task?.kind === 'remind' ? '我已经提醒过他了' : '这件事已经办好了'}
      footer={
        <div className="flex items-center justify-end gap-2">
          <button type="button" className="btn-ghost px-3 py-1.5 text-[13px]" onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className="btn-primary px-3 py-1.5 text-[13px]"
            onClick={() => {
              onDone(note)
              onClose()
            }}
          >
            标记完成
          </button>
        </div>
      }
    >
      <div className="space-y-3">
        <p className="text-[12.5px] leading-relaxed text-ink-500">
          {task?.kind === 'remind'
            ? '这里只记录「我已经提醒过他了」。他有没有办完是另一件事，不会自动判定。'
            : '这里只记录「我已经办好了」。'}
        </p>
        <Field label="留一句回忆" hint="可留空；撤销完成也不会清掉它">
          <textarea
            className="input"
            rows={3}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="比如 他答应明天一定去"
          />
        </Field>
        <label className="flex items-center gap-2 text-[12px] text-ink-500">
          <input
            type="checkbox"
            checked={Boolean(task?.madePublic)}
            readOnly
            className="opacity-50"
          />
          转为公开回忆（本版尚未提供入口，默认保持私有）
        </label>
      </div>
    </Modal>
  )
}

/** 供页面调用的确认删除 */
export function useTaskDelete(onDeleted: () => void) {
  const confirm = useConfirm()
  const toast = useToast()
  return async (task: Task) => {
    const ok = await confirm({
      title: '删除这条事项？',
      desc: '提醒计划与提醒记录会一起删除，且无法撤销。已完成的历史也会一起消失，如果只是想收起来，用「取消」更合适。',
      danger: true,
    })
    if (!ok) return
    try {
      const { deleteTaskCascade } = await import('../../../tasks/store')
      await deleteTaskCascade(task.id)
      toast('已删除')
      onDeleted()
    } catch (err) {
      toast(`删除失败：${(err as Error).message}`, 'err')
    }
  }
}

export { db }