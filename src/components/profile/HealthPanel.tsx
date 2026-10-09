import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Activity, Pencil, Plus, Trash2 } from 'lucide-react'
import { db, healthRepo } from '../../db/db'
import type { HealthRecord, HealthStatus } from '../../db/types'
import { HEALTH_STATUS } from '../../lib/constants'
import { fmtDate, toLocalInput, fromLocalInput, toDateStr } from '../../lib/date'
import { Chips, Empty, Field, Modal, Segmented, Stars, Switch, Tag, useConfirm, useToast } from '../ui'

export default function HealthPanel({ personId }: { personId: string }) {
  const toast = useToast()
  const confirm = useConfirm()
  const [filter, setFilter] = useState<'all' | HealthStatus>('all')
  const [editing, setEditing] = useState<HealthRecord | null>(null)
  const [open, setOpen] = useState(false)
  const [resolveTarget, setResolveTarget] = useState<HealthRecord | null>(null)
  const [recovery, setRecovery] = useState('')

  const list = useLiveQuery(
    async () => (await db.health.where('personId').equals(personId).toArray()).sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : -1)),
    [personId],
  )

  const filtered = useMemo(() => (list ?? []).filter((h) => filter === 'all' || h.status === filter), [list, filter])
  const activeCount = (list ?? []).filter((h) => h.status !== 'recovered').length

  const remove = async (h: HealthRecord) => {
    const ok = await confirm({ title: '删除这条健康记录？', desc: h.symptom, danger: true, confirmText: '删除' })
    if (!ok) return
    await healthRepo.remove(h.id)
    toast('已删除')
  }

  const doResolve = async () => {
    if (!resolveTarget) return
    await healthRepo.update(resolveTarget.id, {
      status: 'recovered',
      recovery: recovery.trim() || undefined,
      resolvedAt: new Date().toISOString(),
    })
    toast('已标记为恢复')
    setResolveTarget(null)
    setRecovery('')
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="flex-1 overflow-x-auto no-scrollbar">
          <Segmented
            options={[
              { value: 'all', label: '全部' },
              ...HEALTH_STATUS.map((s) => ({ value: s.value, label: s.label })),
            ]}
            value={filter}
            onChange={(v) => setFilter(v as typeof filter)}
          />
        </div>
        <button
          className="btn-primary !px-3 shrink-0"
          onClick={() => {
            setEditing(null)
            setOpen(true)
          }}
          aria-label="新增健康记录"
        >
          <Plus size={17} />
        </button>
      </div>

      <div className="rounded-xl bg-cream-100 border border-cream-200 p-3 text-[12.5px] text-ink-500 leading-relaxed">
        健康记录用于<span className="text-ink-700">记录与持续跟进</span>，不用于推断疾病，也不替代就医。
        {activeCount > 0 && <span className="text-[#A9762C]"> 目前有 {activeCount} 条还在跟进中。</span>}
      </div>

      {filtered.length === 0 ? (
        <Empty icon={<Activity size={28} />} title="还没有健康记录" desc="身体不适、就医、用药、恢复情况都可以记在这里。" />
      ) : (
        <div className="space-y-2.5">
          {filtered.map((h) => {
            const st = HEALTH_STATUS.find((s) => s.value === h.status)!
            return (
              <div key={h.id} className="card card-pad">
                <div className="flex items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[15.5px] text-ink-900 font-medium">{h.symptom}</span>
                      <Tag color={st.color}>{st.label}</Tag>
                      {h.severity ? <span className="text-[12px] text-ink-300">程度 {h.severity}/5</span> : null}
                    </div>
                    <div className="mt-1 text-[12px] text-ink-300">
                      开始于 {fmtDate(h.occurredAt)}
                      {h.resolvedAt ? ` · 恢复于 ${fmtDate(h.resolvedAt)}` : ''}
                    </div>
                    {h.medication && <p className="mt-1.5 text-[13px] text-ink-700 leading-snug">就医/用药：{h.medication}</p>}
                    {h.note && <p className="mt-1 text-[13px] text-ink-500 leading-snug">{h.note}</p>}
                    {h.recovery && <p className="mt-1 text-[13px] text-[#5E8E6F] leading-snug">恢复情况：{h.recovery}</p>}
                  </div>
                  <div className="flex gap-0.5 shrink-0">
                    <button
                      className="w-8 h-8 rounded-full flex items-center justify-center text-ink-300 hover:bg-cream-100"
                      onClick={() => {
                        setEditing(h)
                        setOpen(true)
                      }}
                      aria-label="编辑"
                    >
                      <Pencil size={15} />
                    </button>
                    <button
                      className="w-8 h-8 rounded-full flex items-center justify-center text-ink-300 hover:bg-cream-100"
                      onClick={() => remove(h)}
                      aria-label="删除"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
                {h.status !== 'recovered' && (
                  <button
                    className="btn-ghost !py-1.5 !px-3 text-[13px] mt-2.5"
                    onClick={() => {
                      setResolveTarget(h)
                      setRecovery('')
                    }}
                  >
                    更新情况 / 标记恢复
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}

      <HealthEditor key={editing?.id ?? 'new'} open={open} onClose={() => setOpen(false)} personId={personId} record={editing} />

      <Modal
        open={!!resolveTarget}
        onClose={() => setResolveTarget(null)}
        title="更新健康情况"
        footer={
          <div className="flex gap-2">
            <button className="btn-ghost flex-1" onClick={() => setResolveTarget(null)}>
              取消
            </button>
            <button className="btn-primary flex-[2]" onClick={doResolve}>
              标记为已恢复
            </button>
          </div>
        }
      >
        <p className="text-[14px] text-ink-700 mb-3">{resolveTarget?.symptom}</p>
        <Field label="恢复情况">
          <textarea
            className="textarea"
            rows={3}
            placeholder="例：吃了三天药，第 4 天完全好了"
            value={recovery}
            onChange={(e) => setRecovery(e.target.value)}
          />
        </Field>
      </Modal>
    </div>
  )
}

function HealthEditor({
  open,
  onClose,
  personId,
  record,
}: {
  open: boolean
  onClose: () => void
  personId: string
  record: HealthRecord | null
}) {
  const toast = useToast()
  const [symptom, setSymptom] = useState(record?.symptom ?? '')
  const [occurredAt, setOccurredAt] = useState(toLocalInput(record?.occurredAt ?? new Date()))
  const [severity, setSeverity] = useState<number | undefined>(record?.severity)
  const [medication, setMedication] = useState(record?.medication ?? '')
  const [note, setNote] = useState(record?.note ?? '')
  const [status, setStatus] = useState<HealthStatus>(record?.status ?? 'ongoing')

  const save = async () => {
    if (!symptom.trim()) {
      toast('写一下症状或不适', 'err')
      return
    }
    const data = {
      personId,
      symptom: symptom.trim(),
      occurredAt: fromLocalInput(occurredAt),
      severity,
      medication: medication.trim() || undefined,
      note: note.trim() || undefined,
      status,
      entryIds: record?.entryIds ?? [],
    }
    if (record) await healthRepo.update(record.id, data)
    else await healthRepo.create(data)
    toast(record ? '已更新' : '已记录')
    onClose()
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={record ? '编辑健康记录' : '新的健康记录'}
      footer={
        <div className="flex gap-2">
          <button className="btn-ghost flex-1" onClick={onClose}>
            取消
          </button>
          <button className="btn-primary flex-[2]" onClick={save}>
            保存
          </button>
        </div>
      }
    >
      <Field label="症状 / 不适" required>
        <input
          className="input"
          placeholder="例：嗓子疼、低烧"
          value={symptom}
          onChange={(e) => setSymptom(e.target.value)}
          style={{ fontSize: 16 }}
        />
      </Field>
      <Field label="发生时间">
        <input type="datetime-local" className="input" value={occurredAt} onChange={(e) => setOccurredAt(e.target.value)} />
      </Field>
      <Field label="程度（1~5）">
        <Stars value={severity} onChange={setSeverity} />
      </Field>
      <Field label="就医 / 用药备注">
        <textarea
          className="textarea"
          rows={2}
          placeholder="例：社区医院看过，开了三天消炎药"
          value={medication}
          onChange={(e) => setMedication(e.target.value)}
        />
      </Field>
      <Field label="其他备注">
        <textarea className="textarea" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      <Field label="跟进状态">
        <Chips
          options={HEALTH_STATUS.map((s) => ({ value: s.value, label: s.label }))}
          value={status}
          onChange={(v) => setStatus(v as HealthStatus)}
        />
      </Field>
      <Switch
        checked={status !== 'recovered'}
        onChange={(v) => setStatus(v ? 'ongoing' : 'recovered')}
        label="需要在「待跟进」里提醒我"
        desc="关闭后会从待跟进列表移除。"
      />
      <p className="text-[12px] text-ink-300 mt-2">
        记录时间：{toDateStr(new Date())}
      </p>
    </Modal>
  )
}
