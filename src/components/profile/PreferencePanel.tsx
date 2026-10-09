import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Link2, Pencil, Plus, Trash2 } from 'lucide-react'
import { db, nowISO, prefRepo } from '../../db/db'
import type { Preference, PreferenceDirection } from '../../db/types'
import { DIRECTIONS, PREF_CATEGORIES, prefCategoryMeta } from '../../lib/constants'
import { fmtDate, toDateStr } from '../../lib/date'
import EvidencePicker from '../EvidencePicker'
import { Chips, Empty, Field, Modal, SectionCard, Segmented, Stars, useConfirm, useToast } from '../ui'

export default function PreferencePanel({ personId }: { personId: string }) {
  const toast = useToast()
  const confirm = useConfirm()
  const [editing, setEditing] = useState<Preference | null>(null)
  const [open, setOpen] = useState(false)
  const [dir, setDir] = useState<'all' | PreferenceDirection>('all')
  const [expanded, setExpanded] = useState<string | null>(null)

  const list = useLiveQuery(
    async () => (await db.preferences.where('personId').equals(personId).toArray()).sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1)),
    [personId],
  )

  const filtered = useMemo(() => (list ?? []).filter((p) => dir === 'all' || p.direction === dir), [list, dir])
  const groups = useMemo(() => {
    const map = new Map<string, Preference[]>()
    for (const p of filtered) map.set(p.category, [...(map.get(p.category) ?? []), p])
    return Array.from(map.entries())
  }, [filtered])

  const remove = async (p: Preference) => {
    const ok = await confirm({
      title: `删除「${p.name}」？`,
      desc: '这条偏好会被永久删除，关联的依据记录不受影响。',
      danger: true,
      confirmText: '删除',
    })
    if (!ok) return
    await prefRepo.remove(p.id)
    toast('已删除')
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Segmented
          options={[
            { value: 'all', label: '全部' },
            { value: 'like', label: '喜欢' },
            { value: 'dislike', label: '不喜欢' },
            { value: 'want', label: '想尝试' },
          ]}
          value={dir}
          onChange={(v) => setDir(v as typeof dir)}
          className="flex-1 overflow-x-auto"
        />
        <button
          className="btn-primary !px-3 shrink-0"
          onClick={() => {
            setEditing(null)
            setOpen(true)
          }}
          aria-label="新增偏好"
        >
          <Plus size={17} />
        </button>
      </div>

      <p className="text-[12.5px] text-ink-300 px-1 leading-relaxed">
        偏好记得写「依据」和「最近确认时间」，这样就不会把一次偶然的表现当成长期习惯。
      </p>

      {groups.length === 0 ? (
        <Empty title="还没有记录偏好" desc="比如「喜欢合作类游戏」「不喜欢太吵的餐厅」「想尝试露营」" />
      ) : (
        groups.map(([cat, items]) => (
          <SectionCard key={cat} title={<>{prefCategoryMeta(cat).emoji} {prefCategoryMeta(cat).label}</>}>
            <div className="divide-soft">
              {items.map((p) => (
                <div key={p.id} className="py-2.5 first:pt-0">
                  <div className="flex items-start gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[15px] text-ink-900 font-medium">{p.name}</span>
                        <span
                          className={`text-[11.5px] rounded-full px-2 py-0.5 ${
                            p.direction === 'like'
                              ? 'bg-[#8CBF9B22] text-[#5E8E6F]'
                              : p.direction === 'dislike'
                                ? 'bg-[#D9705F22] text-[#B0554A]'
                                : 'bg-[#8CA3D922] text-[#5C74A8]'
                          }`}
                        >
                          {DIRECTIONS.find((d) => d.value === p.direction)?.label}
                        </span>
                        {p.likeLevel != null && <Stars value={p.likeLevel} readOnly />}
                      </div>
                      {p.note && <p className="text-[13px] text-ink-500 mt-1 leading-snug">{p.note}</p>}
                      <div className="mt-1.5 flex items-center gap-3 text-[11.5px] text-ink-300 flex-wrap">
                        {p.lastConfirmedAt && <span>最近确认 {fmtDate(p.lastConfirmedAt)}</span>}
                        <button
                          className="inline-flex items-center gap-1"
                          onClick={() => setExpanded(expanded === p.id ? null : p.id)}
                        >
                          <Link2 size={12} />
                          {p.evidenceEntryIds?.length ?? 0} 条依据
                        </button>
                        {!p.lastConfirmedAt && !p.evidenceEntryIds?.length && (
                          <span className="text-[#A9762C]">还没有依据，建议补上</span>
                        )}
                      </div>
                      {expanded === p.id && <EvidenceList ids={p.evidenceEntryIds ?? []} />}
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <button
                        className="w-8 h-8 rounded-full flex items-center justify-center text-ink-300 hover:bg-cream-100"
                        onClick={() => {
                          setEditing(p)
                          setOpen(true)
                        }}
                        aria-label="编辑"
                      >
                        <Pencil size={15} />
                      </button>
                      <button
                        className="w-8 h-8 rounded-full flex items-center justify-center text-ink-300 hover:bg-cream-100"
                        onClick={() => remove(p)}
                        aria-label="删除"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </SectionCard>
        ))
      )}

      <PreferenceEditor
        key={editing?.id ?? 'new'}
        open={open}
        onClose={() => setOpen(false)}
        personId={personId}
        preference={editing}
      />
    </div>
  )
}

function EvidenceList({ ids }: { ids: string[] }) {
  const entries = useLiveQuery(async () => (ids.length ? db.entries.bulkGet(ids) : []), [ids.join(',')])
  if (!ids.length) return <p className="mt-2 text-[12px] text-ink-300 pl-1">没有关联依据记录。</p>
  return (
    <div className="mt-2 space-y-1.5 pl-1">
      {(entries ?? []).filter(Boolean).map((e) => (
        <div key={e!.id} className="rounded-lg bg-cream-100 px-2.5 py-1.5 text-[12.5px]">
          <span className="text-ink-300 mr-1.5">{fmtDate(e!.occurredAt)}</span>
          <span className="text-ink-700">{e!.title || '（无标题）'}</span>
          {e!.taSaid && <span className="text-ink-500"> · TA 说：{e!.taSaid}</span>}
        </div>
      ))}
    </div>
  )
}

function PreferenceEditor({
  open,
  onClose,
  personId,
  preference,
}: {
  open: boolean
  onClose: () => void
  personId: string
  preference: Preference | null
}) {
  const toast = useToast()
  const [name, setName] = useState(preference?.name ?? '')
  const [category, setCategory] = useState(preference?.category ?? 'game')
  const [direction, setDirection] = useState<PreferenceDirection>(preference?.direction ?? 'like')
  const [likeLevel, setLikeLevel] = useState<number | undefined>(preference?.likeLevel)
  const [note, setNote] = useState(preference?.note ?? '')
  const [tags, setTags] = useState<string[]>(preference?.tags ?? [])
  const [lastConfirmedAt, setLastConfirmedAt] = useState(preference?.lastConfirmedAt?.slice(0, 10) ?? '')
  const [evidence, setEvidence] = useState<string[]>(preference?.evidenceEntryIds ?? [])
  const [pickerOpen, setPickerOpen] = useState(false)

  const save = async () => {
    if (!name.trim()) {
      toast('写一下偏好的名字', 'err')
      return
    }
    const data = {
      personId,
      name: name.trim(),
      category,
      direction,
      likeLevel,
      note: note.trim() || undefined,
      tags,
      lastConfirmedAt: lastConfirmedAt || undefined,
      evidenceEntryIds: evidence,
    }
    if (preference) await prefRepo.update(preference.id, data)
    else await prefRepo.create(data)
    toast(preference ? '已更新' : '已添加')
    onClose()
  }

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title={preference ? '编辑偏好' : '新增偏好'}
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
        <Field label="偏好内容" required>
          <input
            className="input"
            placeholder="例：喜欢合作类游戏"
            value={name}
            onChange={(e) => setName(e.target.value)}
            style={{ fontSize: 16 }}
          />
        </Field>
        <Field label="分类">
          <Chips
            options={PREF_CATEGORIES.map((c) => ({ value: c.value, label: c.label, emoji: c.emoji }))}
            value={category}
            onChange={(v) => setCategory(v as string)}
          />
        </Field>
        <Field label="方向">
          <Chips
            options={DIRECTIONS.map((d) => ({ value: d.value, label: d.label }))}
            value={direction}
            onChange={(v) => setDirection(v as PreferenceDirection)}
          />
        </Field>
        {direction !== 'dislike' && (
          <Field label="喜欢程度（可选）">
            <Stars value={likeLevel} onChange={setLikeLevel} />
          </Field>
        )}
        <Field label="备注">
          <textarea className="textarea" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <Field label="标签">
          <Chips
            options={[{ value: '近期新增', label: '近期新增' }, { value: '一起做', label: '一起做' }, { value: '口头提过', label: '口头提过' }]}
            value={tags}
            onChange={(v) => setTags(v as string[])}
            multi
            allowCustom
          />
        </Field>
        <Field label="最近确认时间" hint="上次确认这件事的时间，避免用很久以前的印象判断现在。">
          <input
            type="date"
            className="input"
            value={lastConfirmedAt}
            onChange={(e) => setLastConfirmedAt(e.target.value)}
          />
        </Field>

        <div className="rounded-xl bg-cream-100 border border-cream-200 p-3">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[13px] font-medium text-ink-700">依据记录</span>
            <button className="btn-text" onClick={() => setPickerOpen(true)}>
              {evidence.length ? `已选 ${evidence.length} 条` : '去选择'}
            </button>
          </div>
          <p className="text-[12px] text-ink-300 leading-snug">
            例：9月12日一起玩某游戏时，TA 说比竞技游戏轻松。没有依据时也可以保存，但记得之后补。
          </p>
          {evidence.length > 0 && <EvidenceList ids={evidence} />}
        </div>

        {!preference && (
          <button
            className="btn-text mt-3"
            onClick={() => {
              setLastConfirmedAt(toDateStr(new Date()))
              toast('已设为今天')
            }}
          >
            把「最近确认」设为今天
          </button>
        )}
      </Modal>

      <EvidencePicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        personId={personId}
        selected={evidence}
        onChange={setEvidence}
      />
    </>
  )
}

export { nowISO }
