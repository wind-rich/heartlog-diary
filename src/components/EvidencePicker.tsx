import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Search } from 'lucide-react'
import { db } from '../db/db'
import type { Entry } from '../db/types'
import { entryTypeMeta } from '../lib/constants'
import { fmtDate, relativeDay } from '../lib/date'
import { Modal, Tag } from './ui'

/**
 * 依据记录选择器：从事件里挑出支撑这条偏好 / 画像的记录。
 * 刻意做成「可选但提示」：偏好可以没有依据，但界面上会提醒这样容易把偶发当成习惯。
 */
export default function EvidencePicker({
  open,
  onClose,
  personId,
  selected,
  onChange,
}: {
  open: boolean
  onClose: () => void
  personId: string
  selected: string[]
  onChange: (ids: string[]) => void
}) {
  const [kw, setKw] = useState('')
  const [local, setLocal] = useState<string[]>(selected)

  const entries = useLiveQuery(
    async () => (personId ? (await db.entries.where('personId').equals(personId).toArray()).sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : -1)) : []),
    [personId],
  )

  const list = useMemo(() => {
    const all = entries ?? []
    if (!kw.trim()) return all.slice(0, 60)
    const k = kw.trim().toLowerCase()
    return all
      .filter((e) =>
        [e.title, e.content, e.taSaid, e.myObservation, (e.tagList ?? []).join(' ')]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
          .includes(k),
      )
      .slice(0, 60)
  }, [entries, kw])

  const toggle = (id: string) =>
    setLocal((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="选择依据记录"
      full
      footer={
        <div className="flex gap-2">
          <button className="btn-ghost flex-1" onClick={() => setLocal([])}>
            清空
          </button>
          <button
            className="btn-primary flex-[2]"
            onClick={() => {
              onChange(local)
              onClose()
            }}
          >
            确定（已选 {local.length} 条）
          </button>
        </div>
      }
    >
      <div className="relative mb-3">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-300" />
        <input
          className="input pl-9"
          placeholder="搜索记录内容"
          value={kw}
          onChange={(e) => setKw(e.target.value)}
        />
      </div>

      {(entries ?? []).length === 0 ? (
        <p className="text-[13.5px] text-ink-300 py-6 text-center">
          还没有任何记录。有依据的偏好才是最可靠的，先去记几条吧。
        </p>
      ) : (
        <div className="space-y-2">
          {list.map((e) => (
            <SelectionRow key={e.id} entry={e} checked={local.includes(e.id)} onToggle={() => toggle(e.id)} />
          ))}
        </div>
      )}
    </Modal>
  )
}

function SelectionRow({ entry, checked, onToggle }: { entry: Entry; checked: boolean; onToggle: () => void }) {
  const meta = entryTypeMeta(entry.type)
  return (
    <button
      onClick={onToggle}
      className={`w-full text-left rounded-xl border p-3 transition ${
        checked ? 'border-rose-soft bg-rose-soft/8' : 'border-cream-200 bg-white'
      }`}
    >
      <div className="flex items-center gap-2">
        <div
          className={`w-4.5 h-4.5 rounded-md border flex items-center justify-center shrink-0 ${
            checked ? 'bg-rose-deep border-rose-deep text-white' : 'border-cream-300'
          }`}
          style={{ width: 18, height: 18 }}
        >
          {checked && <span className="text-[11px] leading-none">✓</span>}
        </div>
        <span className="text-[14px] text-ink-900 flex-1 min-w-0 truncate">{entry.title || '（无标题）'}</span>
        <span className="text-[11.5px] text-ink-300 shrink-0">{relativeDay(entry.occurredAt)}</span>
      </div>
      <div className="mt-1.5 flex items-center gap-2 pl-6">
        <Tag color={meta.color}>{meta.label}</Tag>
        <span className="text-[11.5px] text-ink-300 truncate">{fmtDate(entry.occurredAt)}</span>
      </div>
      {(entry.taSaid || entry.content) && (
        <p className="mt-1.5 pl-6 text-[12.5px] text-ink-500 line-clamp-2">
          {entry.taSaid ? `TA 说：${entry.taSaid}` : entry.content}
        </p>
      )}
    </button>
  )
}
