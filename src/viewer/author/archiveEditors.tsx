/**
 * 档案页（偏好 / 心愿 / 礼物 / 健康 / 画像 / 纪念日 / 回顾）的作者端编辑器。
 *
 * 与 `editors.tsx` 分开的原因：
 * - 那边是记录、人物、照片三类编辑器，已经比较长；
 * - 这里统一入口是 `ArchiveItemEditor`（按 kind 分发），档案页只需要拿到一个懒加载组件。
 *
 * 写入一律走本机 Dexie，不经过发布快照；保存后由 AuthorReloadContext 让外壳重读本机数据。
 * 删除走 `db.<table>.delete`，因此会自动被 Dexie 的 deleting 钩子记入墓碑（多端同步用）；
 * 纪念日存在 person.anniversaries 数组里，没有独立表，只能整份写回 person。
 */
import { useEffect, useState, type ReactNode } from 'react'
import { Trash2 } from 'lucide-react'
import { Modal, useConfirm, useToast } from '../../components/ui'
import {
  db,
  giftRepo,
  healthRepo,
  insightRepo,
  prefRepo,
  savePerson,
  summaryRepo,
  uid,
  wishRepo,
  nowISO,
} from '../../db/db'
import type {
  Anniversary,
  CalendarType,
  ConfirmState,
  EvidenceType,
  HealthRecord,
  HealthStatus,
  PreferenceDirection,
  WishStatus,
} from '../../db/types'
import type {
  PublicAnniversary,
  PublicGift,
  PublicHealth,
  PublicInsight,
  PublicPreference,
  PublicSummary,
  PublicWish,
  SummaryKind,
} from '../types'

export type ArchiveKind = 'preference' | 'wish' | 'gift' | 'health' | 'insight' | 'anniversary' | 'summary'

export type ArchiveRow =
  | PublicPreference
  | PublicWish
  | PublicGift
  | PublicHealth
  | PublicInsight
  | PublicAnniversary
  | PublicSummary

export interface ArchiveEditorProps {
  open: boolean
  kind: ArchiveKind
  personId: string
  row?: ArchiveRow
  onClose: () => void
  onSaved: () => void
}

/* ------------------------------------------------------------------ */
/* 小工具                                                              */
/* ------------------------------------------------------------------ */

function localDate(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function toLocalInput(iso?: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${localDate(d)}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** datetime-local 的输入值 → ISO；空值回退当前时间 */
function fromLocalInput(value: string): string {
  if (!value) return nowISO()
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? nowISO() : d.toISOString()
}

function parseTags(raw: string): string[] {
  return raw
    .split(/[\s,，]+/)
    .map((t) => t.trim())
    .filter(Boolean)
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
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

function LevelSelect({ value, onChange }: { value?: number; onChange: (v: number | undefined) => void }) {
  return (
    <select
      className="input"
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value ? Number(e.target.value) : undefined)}
    >
      <option value="">未填</option>
      {[1, 2, 3, 4, 5].map((n) => (
        <option key={n} value={n}>
          {n}
        </option>
      ))}
    </select>
  )
}

function FormShell({
  open,
  title,
  onClose,
  onSave,
  saving,
  disabled,
  children,
}: {
  open: boolean
  title: string
  onClose: () => void
  onSave: () => void
  saving: boolean
  /** 必填项为空时禁用保存，避免点了没反应 */
  disabled?: boolean
  children: ReactNode
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <div className="flex items-center justify-end gap-2">
          {disabled && <span className="mr-auto text-[11.5px] text-ink-300">填写必填项后可保存</span>}
          <button type="button" className="btn-ghost px-3 py-1.5 text-[13px]" onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className="btn-primary px-3 py-1.5 text-[13px]"
            onClick={onSave}
            disabled={saving || disabled}
          >
            {saving ? '保存中…' : '保存'}
          </button>
        </div>
      }
    >
      <div className="space-y-3">{children}</div>
    </Modal>
  )
}

/** 统一的保存状态与错误提示：把 async 保存逻辑收成 { run, saving } */
function useSaver(onSaved: () => void, onClose: () => void) {
  const toast = useToast()
  const [saving, setSaving] = useState(false)

  async function run(fn: () => Promise<void>, okText: string) {
    setSaving(true)
    try {
      await fn()
      toast(okText)
      onSaved()
      onClose()
    } catch (err) {
      toast(`保存失败：${(err as Error).message}`, 'err')
    } finally {
      setSaving(false)
    }
  }

  return { saving, run }
}

const DIRECTIONS: { key: PreferenceDirection; label: string }[] = [
  { key: 'like', label: '喜欢' },
  { key: 'dislike', label: '不喜欢' },
  { key: 'want', label: '想尝试' },
]

const WISH_STATES: { key: WishStatus; label: string }[] = [
  { key: 'wish', label: '心愿' },
  { key: 'gifted', label: '已送出' },
  { key: 'fulfilled', label: '已实现' },
  { key: 'paused', label: '暂缓' },
]

const HEALTH_STATES: { key: HealthStatus; label: string }[] = [
  { key: 'ongoing', label: '进行中' },
  { key: 'watching', label: '观察中' },
  { key: 'recovered', label: '已恢复' },
]

const EVIDENCE_TYPES: { key: EvidenceType; label: string }[] = [
  { key: 'stated', label: 'TA 明确说过' },
  { key: 'repeated', label: '多次记录体现' },
  { key: 'hypothesis', label: '待观察' },
]

const CONFIRM_STATES: { key: ConfirmState; label: string }[] = [
  { key: 'confirmed', label: '已确认' },
  { key: 'pending', label: '待确认' },
  { key: 'rejected', label: '已排除' },
]

const SUMMARY_KINDS: { key: SummaryKind; label: string }[] = [
  { key: 'week', label: '周回顾' },
  { key: 'month', label: '月回顾' },
  { key: 'year', label: '年回顾' },
  { key: 'custom', label: '自定义' },
  { key: 'portrait', label: '画像总结' },
  { key: 'advice', label: '建议' },
  { key: 'gift', label: '礼物建议' },
  { key: 'query', label: '问答' },
]

/* ------------------------------------------------------------------ */
/* 偏好习惯                                                            */
/* ------------------------------------------------------------------ */

function PreferenceForm({ open, personId, row, onClose, onSaved }: ArchiveEditorProps) {
  const seed = row as PublicPreference | undefined
  const [category, setCategory] = useState('')
  const [name, setName] = useState('')
  const [direction, setDirection] = useState<PreferenceDirection>('like')
  const [likeLevel, setLikeLevel] = useState<number | undefined>(undefined)
  const [lastConfirmedAt, setLastConfirmedAt] = useState('')
  const [tags, setTags] = useState('')
  const [note, setNote] = useState('')
  const { saving, run } = useSaver(onSaved, onClose)

  useEffect(() => {
    if (!open) return
    setCategory(seed?.category ?? '')
    setName(seed?.name ?? '')
    setDirection(seed?.direction ?? 'like')
    setLikeLevel(seed?.likeLevel)
    setLastConfirmedAt(seed?.lastConfirmedAt ?? '')
    setTags((seed?.tags ?? []).join(' '))
    setNote(seed?.note ?? '')
  }, [open, seed])

  function save() {
    if (!name.trim()) return
    void run(async () => {
      const payload = {
        personId,
        category: category.trim() || '其他',
        name: name.trim(),
        direction,
        likeLevel,
        lastConfirmedAt: lastConfirmedAt || undefined,
        tags: parseTags(tags),
        note: note.trim() || undefined,
        evidenceEntryIds: seed?.evidenceEntryIds ?? [],
      }
      if (seed) await prefRepo.update(seed.id, payload)
      else await prefRepo.create(payload)
    }, seed ? '已保存' : '已添加')
  }

  return (
    <FormShell
      open={open}
      title={seed ? '编辑偏好' : '新增偏好'}
      onClose={onClose}
      onSave={save}
      saving={saving}
      disabled={!name.trim()}
    >
      <div className="grid grid-cols-2 gap-2">
        <Field label="分类" hint="食物 / 音乐 / 运动…">
          <input className="input" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="其他" />
        </Field>
        <Field label="方向">
          <select className="input" value={direction} onChange={(e) => setDirection(e.target.value as PreferenceDirection)}>
            {DIRECTIONS.map((d) => (
              <option key={d.key} value={d.key}>
                {d.label}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <Field label="名称">
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="比如 冰美式" />
      </Field>

      <div className="grid grid-cols-2 gap-2">
        <Field label="喜欢程度" hint="1~5">
          <LevelSelect value={likeLevel} onChange={setLikeLevel} />
        </Field>
        <Field label="最近确认">
          <input
            className="input"
            type="date"
            value={lastConfirmedAt}
            onChange={(e) => setLastConfirmedAt(e.target.value)}
          />
        </Field>
      </div>

      <Field label="标签" hint="空格分隔">
        <input className="input" value={tags} onChange={(e) => setTags(e.target.value)} />
      </Field>

      <Field label="备注">
        <textarea className="input" rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
    </FormShell>
  )
}

/* ------------------------------------------------------------------ */
/* 心愿                                                                */
/* ------------------------------------------------------------------ */

function WishForm({ open, personId, row, onClose, onSaved }: ArchiveEditorProps) {
  const seed = row as PublicWish | undefined
  const [content, setContent] = useState('')
  const [raisedAt, setRaisedAt] = useState('')
  const [status, setStatus] = useState<WishStatus>('wish')
  const [priority, setPriority] = useState<number | undefined>(undefined)
  const [occasion, setOccasion] = useState('')
  const [note, setNote] = useState('')
  const { saving, run } = useSaver(onSaved, onClose)

  useEffect(() => {
    if (!open) return
    setContent(seed?.content ?? '')
    setRaisedAt(seed?.raisedAt ?? '')
    setStatus(seed?.status ?? 'wish')
    setPriority(seed?.priority)
    setOccasion(seed?.occasion ?? '')
    setNote(seed?.note ?? '')
  }, [open, seed])

  function save() {
    if (!content.trim()) return
    void run(async () => {
      const payload = {
        personId,
        content: content.trim(),
        raisedAt: raisedAt || undefined,
        status,
        priority,
        occasion: occasion.trim() || undefined,
        note: note.trim() || undefined,
        giftId: seed?.giftId,
        entryIds: seed?.entryIds ?? [],
      }
      if (seed) await wishRepo.update(seed.id, payload)
      else await wishRepo.create(payload)
    }, seed ? '已保存' : '已添加')
  }

  return (
    <FormShell
      open={open}
      title={seed ? '编辑心愿' : '新增心愿'}
      onClose={onClose}
      onSave={save}
      saving={saving}
      disabled={!content.trim()}
    >
      <Field label="心愿内容">
        <textarea className="input" rows={2} value={content} onChange={(e) => setContent(e.target.value)} />
      </Field>

      <div className="grid grid-cols-2 gap-2">
        <Field label="提出时间">
          <input className="input" type="date" value={raisedAt} onChange={(e) => setRaisedAt(e.target.value)} />
        </Field>
        <Field label="状态">
          <select className="input" value={status} onChange={(e) => setStatus(e.target.value as WishStatus)}>
            {WISH_STATES.map((w) => (
              <option key={w.key} value={w.key}>
                {w.label}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Field label="优先级" hint="1 高 / 3 低">
          <LevelSelect value={priority} onChange={setPriority} />
        </Field>
        <Field label="场合">
          <input className="input" value={occasion} onChange={(e) => setOccasion(e.target.value)} placeholder="生日 / 纪念日" />
        </Field>
      </div>

      <Field label="备注">
        <textarea className="input" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
    </FormShell>
  )
}

/* ------------------------------------------------------------------ */
/* 礼物                                                                */
/* ------------------------------------------------------------------ */

function GiftForm({ open, personId, row, onClose, onSaved }: ArchiveEditorProps) {
  const seed = row as PublicGift | undefined
  const [name, setName] = useState('')
  const [givenAt, setGivenAt] = useState('')
  const [occasion, setOccasion] = useState('')
  const [feedback, setFeedback] = useState('')
  const [note, setNote] = useState('')
  const { saving, run } = useSaver(onSaved, onClose)

  useEffect(() => {
    if (!open) return
    setName(seed?.name ?? '')
    setGivenAt(seed?.givenAt ?? localDate())
    setOccasion(seed?.occasion ?? '')
    setFeedback(seed?.feedback ?? '')
    setNote(seed?.note ?? '')
  }, [open, seed])

  function save() {
    if (!name.trim()) return
    void run(async () => {
      const payload = {
        personId,
        name: name.trim(),
        givenAt: givenAt || localDate(),
        occasion: occasion.trim() || undefined,
        feedback: feedback.trim() || undefined,
        note: note.trim() || undefined,
        photoIds: seed?.photoIds ?? [],
        wishId: seed?.wishId,
        entryId: seed?.entryId,
      }
      if (seed) await giftRepo.update(seed.id, payload)
      else await giftRepo.create(payload)
    }, seed ? '已保存' : '已添加')
  }

  return (
    <FormShell
      open={open}
      title={seed ? '编辑礼物' : '新增礼物'}
      onClose={onClose}
      onSave={save}
      saving={saving}
      disabled={!name.trim()}
    >
      <div className="grid grid-cols-2 gap-2">
        <Field label="礼物名称">
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="送出日期">
          <input className="input" type="date" value={givenAt} onChange={(e) => setGivenAt(e.target.value)} />
        </Field>
      </div>

      <Field label="场合">
        <input className="input" value={occasion} onChange={(e) => setOccasion(e.target.value)} placeholder="生日 / 纪念日" />
      </Field>

      <Field label="对方的反应">
        <textarea className="input" rows={2} value={feedback} onChange={(e) => setFeedback(e.target.value)} />
      </Field>

      <Field label="备注">
        <textarea className="input" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
    </FormShell>
  )
}

/* ------------------------------------------------------------------ */
/* 健康                                                                */
/* ------------------------------------------------------------------ */

function HealthForm({ open, personId, row, onClose, onSaved }: ArchiveEditorProps) {
  const seed = row as PublicHealth | undefined
  const [symptom, setSymptom] = useState('')
  const [occurredAt, setOccurredAt] = useState('')
  const [severity, setSeverity] = useState<number | undefined>(undefined)
  const [status, setStatus] = useState<HealthStatus>('ongoing')
  const [note, setNote] = useState('')
  const [recovery, setRecovery] = useState('')
  const [resolvedAt, setResolvedAt] = useState('')
  const { saving, run } = useSaver(onSaved, onClose)

  useEffect(() => {
    if (!open) return
    setSymptom(seed?.symptom ?? '')
    setOccurredAt(toLocalInput(seed?.occurredAt ?? nowISO()))
    setSeverity(seed?.severity)
    setStatus(seed?.status ?? 'ongoing')
    setNote(seed?.note ?? '')
    setRecovery(seed?.recovery ?? '')
    setResolvedAt(seed?.resolvedAt ?? '')
  }, [open, seed])

  function save() {
    if (!symptom.trim()) return
    void run(async () => {
      const payload = {
        personId,
        symptom: symptom.trim(),
        occurredAt: fromLocalInput(occurredAt),
        severity,
        status,
        note: note.trim() || undefined,
        recovery: recovery.trim() || undefined,
        resolvedAt: resolvedAt || undefined,
        // PublicHealth 不含 entryIds，但编辑时要保留本机关联，避免被清空
        entryIds: (seed as { entryIds?: string[] } | undefined)?.entryIds ?? [],
      }
      if (seed) await healthRepo.update(seed.id, payload as Partial<HealthRecord>)
      else await healthRepo.create(payload)
    }, seed ? '已保存' : '已添加')
  }

  return (
    <FormShell
      open={open}
      title={seed ? '编辑健康记录' : '新增健康记录'}
      onClose={onClose}
      onSave={save}
      saving={saving}
      disabled={!symptom.trim()}
    >
      <Field label="症状 / 情况">
        <input className="input" value={symptom} onChange={(e) => setSymptom(e.target.value)} placeholder="比如 偏头痛" />
      </Field>

      <div className="grid grid-cols-2 gap-2">
        <Field label="发生时间">
          <input
            className="input"
            type="datetime-local"
            value={occurredAt}
            onChange={(e) => setOccurredAt(e.target.value)}
          />
        </Field>
        <Field label="程度" hint="1~5">
          <LevelSelect value={severity} onChange={setSeverity} />
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Field label="状态">
          <select className="input" value={status} onChange={(e) => setStatus(e.target.value as HealthStatus)}>
            {HEALTH_STATES.map((h) => (
              <option key={h.key} value={h.key}>
                {h.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="恢复日期">
          <input className="input" type="date" value={resolvedAt} onChange={(e) => setResolvedAt(e.target.value)} />
        </Field>
      </div>

      <Field label="备注" hint="只记录与跟进，不推断疾病">
        <textarea className="input" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>

      <Field label="恢复情况">
        <textarea className="input" rows={2} value={recovery} onChange={(e) => setRecovery(e.target.value)} />
      </Field>
    </FormShell>
  )
}

/* ------------------------------------------------------------------ */
/* 画像                                                                */
/* ------------------------------------------------------------------ */

function InsightForm({ open, personId, row, onClose, onSaved }: ArchiveEditorProps) {
  const seed = row as PublicInsight | undefined
  const [dimension, setDimension] = useState('')
  const [description, setDescription] = useState('')
  const [evidenceType, setEvidenceType] = useState<EvidenceType>('stated')
  const [confirmState, setConfirmState] = useState<ConfirmState>('pending')
  const { saving, run } = useSaver(onSaved, onClose)

  useEffect(() => {
    if (!open) return
    setDimension(seed?.dimension ?? '')
    setDescription(seed?.description ?? '')
    setEvidenceType(seed?.evidenceType ?? 'stated')
    setConfirmState(seed?.confirmState ?? 'pending')
  }, [open, seed])

  function save() {
    if (!description.trim()) return
    void run(async () => {
      const payload = {
        personId,
        dimension: dimension.trim() || '其他',
        description: description.trim(),
        evidenceType,
        confirmState,
        evidenceEntryIds: seed?.evidenceEntryIds ?? [],
        // 手动编辑过的画像，AI 更新时不覆盖
        userEdited: true,
      }
      if (seed) await insightRepo.update(seed.id, payload)
      else await insightRepo.create(payload)
    }, seed ? '已保存' : '已添加')
  }

  return (
    <FormShell
      open={open}
      title={seed ? '编辑画像条目' : '新增画像条目'}
      onClose={onClose}
      onSave={save}
      saving={saving}
      disabled={!description.trim()}
    >
      <Field label="维度" hint="兴趣与动力 / 相处偏好…">
        <input className="input" value={dimension} onChange={(e) => setDimension(e.target.value)} />
      </Field>

      <Field label="描述">
        <textarea className="input" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
      </Field>

      <div className="grid grid-cols-2 gap-2">
        <Field label="依据强度">
          <select className="input" value={evidenceType} onChange={(e) => setEvidenceType(e.target.value as EvidenceType)}>
            {EVIDENCE_TYPES.map((e) => (
              <option key={e.key} value={e.key}>
                {e.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="确认状态">
          <select className="input" value={confirmState} onChange={(e) => setConfirmState(e.target.value as ConfirmState)}>
            {CONFIRM_STATES.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label}
              </option>
            ))}
          </select>
        </Field>
      </div>
    </FormShell>
  )
}

/* ------------------------------------------------------------------ */
/* 纪念日（存在 person.anniversaries 数组里）                            */
/* ------------------------------------------------------------------ */

async function readPersonAnniversaries(personId: string): Promise<{ id: string; list: Anniversary[] }> {
  const person = await db.persons.get(personId)
  if (!person) throw new Error('找不到人物档案')
  return { id: person.id, list: person.anniversaries ?? [] }
}

function AnniversaryForm({ open, personId, row, onClose, onSaved }: ArchiveEditorProps) {
  const seed = row as PublicAnniversary | undefined
  const [name, setName] = useState('')
  const [date, setDate] = useState('')
  const [calendarType, setCalendarType] = useState<CalendarType>('solar')
  const [repeatYearly, setRepeatYearly] = useState(true)
  const [note, setNote] = useState('')
  const { saving, run } = useSaver(onSaved, onClose)

  useEffect(() => {
    if (!open) return
    setName(seed?.name ?? '')
    setDate(seed?.date ?? '')
    setCalendarType(seed?.calendarType ?? 'solar')
    setRepeatYearly(seed?.repeatYearly ?? true)
    setNote(seed?.note ?? '')
  }, [open, seed])

  function save() {
    if (!name.trim() || !date) return
    void run(async () => {
      const { id, list } = await readPersonAnniversaries(personId)
      const next: Anniversary = {
        id: seed?.id ?? uid('a_'),
        name: name.trim(),
        date,
        calendarType,
        repeatYearly,
        note: note.trim() || undefined,
      }
      const anniversaries = seed ? list.map((a) => (a.id === seed.id ? next : a)) : [...list, next]
      await savePerson({ id, anniversaries })
    }, seed ? '已保存' : '已添加')
  }

  return (
    <FormShell
      open={open}
      title={seed ? '编辑纪念日' : '新增纪念日'}
      onClose={onClose}
      onSave={save}
      saving={saving}
      disabled={!name.trim() || !date}
    >
      <Field label="名称">
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="比如 相识纪念日" />
      </Field>

      <div className="grid grid-cols-2 gap-2">
        <Field label="日期">
          <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="历法">
          <select className="input" value={calendarType} onChange={(e) => setCalendarType(e.target.value as CalendarType)}>
            <option value="solar">公历</option>
            <option value="lunar">农历</option>
          </select>
        </Field>
      </div>

      <label className="flex items-center gap-2 text-[12.5px] text-ink-700">
        <input type="checkbox" checked={repeatYearly} onChange={(e) => setRepeatYearly(e.target.checked)} />
        每年重复
      </label>

      <Field label="备注">
        <textarea className="input" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
    </FormShell>
  )
}

/* ------------------------------------------------------------------ */
/* 历史回顾                                                            */
/* ------------------------------------------------------------------ */

function SummaryForm({ open, personId, row, onClose, onSaved }: ArchiveEditorProps) {
  const seed = row as PublicSummary | undefined
  const [title, setTitle] = useState('')
  const [kind, setKind] = useState<SummaryKind>('custom')
  const [rangeStart, setRangeStart] = useState('')
  const [rangeEnd, setRangeEnd] = useState('')
  const [content, setContent] = useState('')
  const [generator, setGenerator] = useState<'manual' | 'ai'>('manual')
  const { saving, run } = useSaver(onSaved, onClose)

  useEffect(() => {
    if (!open) return
    setTitle(seed?.title ?? '')
    setKind(seed?.kind ?? 'custom')
    setRangeStart(seed?.rangeStart ?? localDate())
    setRangeEnd(seed?.rangeEnd ?? localDate())
    setContent(seed?.content ?? '')
    setGenerator(seed?.generator ?? 'manual')
  }, [open, seed])

  function save() {
    if (!title.trim()) return
    void run(async () => {
      const payload = {
        personId,
        kind,
        title: title.trim(),
        rangeStart: rangeStart || localDate(),
        rangeEnd: rangeEnd || rangeStart || localDate(),
        content: content.trim(),
        generator,
        evidenceEntryIds: seed?.evidenceEntryIds ?? [],
      }
      if (seed) await summaryRepo.update(seed.id, payload)
      else await summaryRepo.create(payload)
    }, seed ? '已保存' : '已添加')
  }

  return (
    <FormShell
      open={open}
      title={seed ? '编辑回顾' : '新增回顾'}
      onClose={onClose}
      onSave={save}
      saving={saving}
      disabled={!title.trim()}
    >
      <div className="grid grid-cols-2 gap-2">
        <Field label="标题">
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field label="类型">
          <select className="input" value={kind} onChange={(e) => setKind(e.target.value as SummaryKind)}>
            {SUMMARY_KINDS.map((k) => (
              <option key={k.key} value={k.key}>
                {k.label}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Field label="开始日期">
          <input className="input" type="date" value={rangeStart} onChange={(e) => setRangeStart(e.target.value)} />
        </Field>
        <Field label="结束日期">
          <input className="input" type="date" value={rangeEnd} onChange={(e) => setRangeEnd(e.target.value)} />
        </Field>
      </div>

      <Field label="正文" hint="支持简单 Markdown">
        <textarea className="input" rows={6} value={content} onChange={(e) => setContent(e.target.value)} />
      </Field>

      <Field label="来源">
        <select className="input" value={generator} onChange={(e) => setGenerator(e.target.value as 'manual' | 'ai')}>
          <option value="manual">人工整理</option>
          <option value="ai">AI 草稿</option>
        </select>
      </Field>
    </FormShell>
  )
}

/* ------------------------------------------------------------------ */
/* 分发入口                                                            */
/* ------------------------------------------------------------------ */

export function ArchiveItemEditor(props: ArchiveEditorProps) {
  switch (props.kind) {
    case 'preference':
      return <PreferenceForm {...props} />
    case 'wish':
      return <WishForm {...props} />
    case 'gift':
      return <GiftForm {...props} />
    case 'health':
      return <HealthForm {...props} />
    case 'insight':
      return <InsightForm {...props} />
    case 'anniversary':
      return <AnniversaryForm {...props} />
    case 'summary':
      return <SummaryForm {...props} />
    default:
      return null
  }
}

/* ------------------------------------------------------------------ */
/* 删除                                                                */
/* ------------------------------------------------------------------ */

const DELETE_TEXT: Record<ArchiveKind, { title: string; desc: string; noun: string }> = {
  preference: { noun: '偏好', title: '删除这条偏好？', desc: '删除后无法撤销；关联的记录本身不会删除。' },
  wish: { noun: '心愿', title: '删除这条心愿？', desc: '删除后无法撤销；已经记录的礼物不会跟着删除。' },
  gift: { noun: '礼物', title: '删除这件礼物？', desc: '删除后无法撤销；指向它的心愿链接会被清空。' },
  health: { noun: '健康记录', title: '删除这条健康记录？', desc: '删除后无法撤销；关联的记录本身不会删除。' },
  insight: { noun: '画像条目', title: '删除这条画像？', desc: '删除后无法撤销；依据的记录本身不会删除。' },
  anniversary: { noun: '纪念日', title: '删除这个纪念日？', desc: '删除后无法撤销，首页与档案的天数计算会一起更新。' },
  summary: { noun: '回顾', title: '删除这份回顾？', desc: '删除后无法撤销；引用的记录本身不会删除。' },
}

export function ArchiveDeleteButton({
  kind,
  id,
  personId,
  onDeleted,
  label = '删除',
}: {
  kind: ArchiveKind
  id: string
  personId: string
  onDeleted: () => void
  label?: string
}) {
  const confirm = useConfirm()
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const text = DELETE_TEXT[kind]

  async function run() {
    const ok = await confirm({ title: text.title, desc: text.desc })
    if (!ok) return
    setBusy(true)
    try {
      if (kind === 'preference') await prefRepo.remove(id)
      else if (kind === 'wish') await wishRepo.remove(id)
      else if (kind === 'gift') {
        await giftRepo.remove(id)
        // 心愿上的 giftId 指向已删除的礼物，清掉避免出现死链
        const wishes = await db.wishes.where('personId').equals(personId).toArray()
        for (const w of wishes) {
          if (w.giftId === id) await wishRepo.update(w.id, { giftId: undefined })
        }
      } else if (kind === 'health') await healthRepo.remove(id)
      else if (kind === 'insight') await insightRepo.remove(id)
      else if (kind === 'summary') await summaryRepo.remove(id)
      else if (kind === 'anniversary') {
        const { id: pid, list } = await readPersonAnniversaries(personId)
        await savePerson({ id: pid, anniversaries: list.filter((a) => a.id !== id) })
      }
      toast(`${text.noun}已删除`)
      onDeleted()
    } catch (err) {
      toast(`删除失败：${(err as Error).message}`, 'err')
    } finally {
      setBusy(false)
    }
  }

  return (
    <button
      type="button"
      disabled={busy}
      onClick={() => void run()}
      className="inline-flex items-center gap-1 rounded-full border border-cream-300 bg-white px-2.5 py-0.5 text-[11.5px] text-ink-500 transition hover:text-rose-deep disabled:opacity-50"
    >
      <Trash2 size={11} /> {label}
    </button>
  )
}
