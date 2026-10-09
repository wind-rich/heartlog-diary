import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useNavigate } from 'react-router-dom'
import { CalendarHeart, ChevronRight, ListTodo, Moon, Plus, Send, Sparkles } from 'lucide-react'
import { db, deleteEntryCascade, entryRepo, upsertDailyStatus } from '../db/db'
import type { Entry, Mood } from '../db/types'
import { MOODS, QUICK_PRESETS } from '../lib/constants'
import { festivalsOf, fmtDate, lunarInfoOf, toDateStr, WEEK_CN } from '../lib/date'
import { collectFollowUps, collectUpcoming } from '../lib/stats'
import EntryCard from '../components/EntryCard'
import EntryEditor from '../components/EntryEditor'
import PhotoViewer from '../components/PhotoViewer'
import { Chips, Empty, Field, Modal, SectionCard, Stars, useConfirm, useToast } from '../components/ui'
import { useApp } from '../state/app'

export default function Today() {
  const { person } = useApp()
  const toast = useToast()
  const confirm = useConfirm()
  const nav = useNavigate()
  const today = new Date()
  const todayStr = toDateStr(today)

  const [quickText, setQuickText] = useState('')
  const [quickType, setQuickType] = useState<Entry['type']>('daily')
  const [editorOpen, setEditorOpen] = useState(false)
  const [editing, setEditing] = useState<Entry | undefined>()
  const [viewer, setViewer] = useState<{ ids: string[]; index: number } | null>(null)
  const [statusOpen, setStatusOpen] = useState(false)

  const pid = person?.id

  const todayEntries = useLiveQuery(async () => {
    if (!pid) return []
    const list = await db.entries.where('personId').equals(pid).toArray()
    return list
      .filter((e) => toDateStr(e.occurredAt) === todayStr)
      .sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : -1))
  }, [pid, todayStr])

  const status = useLiveQuery(async () => {
    if (!pid) return undefined
    const list = await db.dailyStatus.where('personId').equals(pid).toArray()
    return list.find((s) => s.date === todayStr)
  }, [pid, todayStr])

  const allEntries = useLiveQuery(async () => (pid ? db.entries.where('personId').equals(pid).toArray() : []), [pid])
  const allHealth = useLiveQuery(async () => (pid ? db.health.where('personId').equals(pid).toArray() : []), [pid])
  const allWishes = useLiveQuery(async () => (pid ? db.wishes.where('personId').equals(pid).toArray() : []), [pid])
  const photoCount = useLiveQuery(async () => (pid ? db.photos.where('personId').equals(pid).count() : 0), [pid])

  const lunar = useMemo(() => lunarInfoOf(today), [todayStr])
  const festivals = useMemo(() => festivalsOf(today), [todayStr])
  const feasts = useMemo(() => collectUpcoming(person, 60), [person])
  const followUps = useMemo(
    () => collectFollowUps(allEntries ?? [], allHealth ?? [], allWishes ?? []).slice(0, 5),
    [allEntries, allHealth, allWishes],
  )
  const recordedDays = useMemo(() => {
    const set = new Set<string>()
    for (const e of allEntries ?? []) set.add(toDateStr(e.occurredAt))
    return set.size
  }, [allEntries])

  if (!pid) return null

  const saveQuick = async () => {
    if (!quickText.trim()) return
    await entryRepo.create({
      personId: pid,
      occurredAt: new Date().toISOString(),
      type: quickType,
      title: quickText.trim(),
      tagList: [],
      photoIds: [],
      followUpDone: false,
      quick: true,
    })
    setQuickText('')
    toast('已记下')
  }

  const removeEntry = async (e: Entry) => {
    const ok = await confirm({
      title: '删除这条记录？',
      desc: '文字记录会被永久删除，照片会保留在相册里。',
      danger: true,
      confirmText: '删除',
    })
    if (!ok) return
    await deleteEntryCascade(e.id)
    toast('已删除')
  }

  return (
    <div className="space-y-4">
      {/* 日期头 */}
      <div className="card card-pad bg-gradient-to-br from-cream-100 to-cream-50">
        <div className="flex items-baseline gap-2">
          <span className="text-[26px] font-semibold text-ink-900 leading-none">{today.getDate()}</span>
          <span className="text-[14px] text-ink-500">
            {today.getFullYear()}年{today.getMonth() + 1}月 · {WEEK_CN[today.getDay()]}
          </span>
          <div className="flex-1" />
          <span className="text-[12.5px] text-ink-300">
            农历{lunar.monthInChinese}月{lunar.dayInChinese}
          </span>
        </div>
        {festivals.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {festivals.map((f) => (
              <span
                key={f}
                className="inline-flex items-center rounded-full px-2.5 py-0.5 text-[12px] text-rose-deep bg-rose-soft/12 border border-rose-soft/40"
              >
                {f}
              </span>
            ))}
          </div>
        )}
        <div className="mt-2.5 flex items-center gap-3 text-[12.5px] text-ink-300">
          <span>累计记录 {recordedDays} 天</span>
          <span>照片 {photoCount ?? 0} 张</span>
          <span>{lunar.ganzhi}</span>
        </div>
      </div>

      {/* 快速记录 */}
      <SectionCard
        title={
          <>
            <Sparkles size={15} className="text-rose-deep" /> 随手记一笔
          </>
        }
      >
        <div className="flex flex-wrap gap-1.5 mb-2.5">
          {QUICK_PRESETS.map((p) => (
            <button
              key={p.label}
              className="chip-off !text-[12.5px]"
              onClick={() => {
                setQuickType(p.type)
                setQuickText(p.label)
              }}
            >
              <span>{p.emoji}</span>
              {p.label}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            className="input flex-1"
            placeholder="一句话记下今天的事…"
            value={quickText}
            style={{ fontSize: 16 }}
            onChange={(e) => setQuickText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') saveQuick()
            }}
          />
          <button className="btn-primary !px-3.5" onClick={saveQuick} disabled={!quickText.trim()} aria-label="保存">
            <Send size={17} />
          </button>
        </div>
        <button
          className="btn-text mt-2.5"
          onClick={() => {
            setEditing(undefined)
            setEditorOpen(true)
          }}
        >
          <Plus size={14} /> 写一条完整记录（经过 / TA 说了什么 / 心情 / 照片）
        </button>
      </SectionCard>

      {/* 今日状态 */}
      <SectionCard
        title={
          <>
            <Moon size={15} className="text-rose-deep" /> 今日状态
          </>
        }
        action={
          <button className="btn-text" onClick={() => setStatusOpen(true)}>
            {status ? '修改' : '填写'} <ChevronRight size={14} />
          </button>
        }
      >
        {status && (status.mood || status.energy || status.sleepHours || status.goodThing || status.worry) ? (
          <div className="space-y-2 text-[14px]">
            <div className="flex items-center gap-3 flex-wrap">
              {status.mood && (
                <span className="text-ink-700">
                  心情 {MOODS.find((m) => m.value === status.mood)?.emoji}
                  {MOODS.find((m) => m.value === status.mood)?.label ?? status.moodCustom}
                  {status.moodLevel ? ` · ${status.moodLevel}/5` : ''}
                </span>
              )}
              {status.energy ? <span className="text-ink-500">精力 {status.energy}/5</span> : null}
              {status.sleepHours ? <span className="text-ink-500">睡眠 {status.sleepHours}h</span> : null}
            </div>
            {status.goodThing && <p className="text-ink-700">☀️ {status.goodThing}</p>}
            {status.worry && <p className="text-ink-500">🌧️ {status.worry}</p>}
            {status.needAttention && <p className="text-[13px] text-[#A9762C]">👀 {status.needAttention}</p>}
          </div>
        ) : (
          <p className="text-[13.5px] text-ink-300">还没有今天的记录。不要求每天打卡，想写的时候写一句就好。</p>
        )}
      </SectionCard>

      {/* 临近纪念日 */}
      <SectionCard
        title={
          <>
            <CalendarHeart size={15} className="text-rose-deep" /> 临近的纪念日
          </>
        }
      >
        {feasts.length === 0 ? (
          <p className="text-[13.5px] text-ink-300">
            {person?.birthday || person?.meetDate ? '60 天内没有临近的生日或纪念日。' : '还没有填写生日和纪念日，可以在「档案」里补上。'}
          </p>
        ) : (
          <div className="divide-soft">
            {feasts.slice(0, 4).map((f) => (
              <div key={f.key} className="py-2.5 flex items-center gap-3 first:pt-0">
                <div className="w-11 h-11 rounded-xl bg-rose-soft/12 text-rose-deep flex flex-col items-center justify-center shrink-0">
                  <span className="text-[15px] font-semibold leading-none">{f.daysLeft === 0 ? '今天' : f.daysLeft}</span>
                  {f.daysLeft !== 0 && <span className="text-[10px] mt-0.5">天后</span>}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[14.5px] text-ink-900 truncate">{f.name}</div>
                  <div className="text-[12px] text-ink-300">
                    {fmtDate(f.date)} · 农历{f.lunarText}
                    {f.yearsCount && f.yearsCount > 0 ? ` · 第 ${f.yearsCount + 1} 年` : ''}
                  </div>
                </div>
                {f.daysLeft <= 30 && (
                  <button className="btn-text shrink-0" onClick={() => nav('/profile?tab=wish')}>
                    准备
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      {/* 待跟进 */}
      <SectionCard
        title={
          <>
            <ListTodo size={15} className="text-rose-deep" /> 待跟进
          </>
        }
        action={
          <button className="btn-text" onClick={() => nav('/timeline?followUp=1')}>
            全部 <ChevronRight size={14} />
          </button>
        }
      >
        {followUps.length === 0 ? (
          <p className="text-[13.5px] text-ink-300">没有待跟进的事情。</p>
        ) : (
          <div className="divide-soft">
            {followUps.map((f) => (
              <div key={`${f.kind}-${f.id}`} className="py-2.5 first:pt-0 flex items-start gap-2.5">
                <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-rose-soft shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-[14px] text-ink-900 leading-snug">{f.title}</p>
                  {f.detail && <p className="text-[12px] text-ink-300 mt-0.5 truncate">{f.detail}</p>}
                </div>
                <span className="text-[11.5px] text-ink-300 shrink-0">{fmtDate(f.at).slice(5)}</span>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      {/* 今天的记录 */}
      <div>
        <div className="section-title">今天记下的</div>
        {(todayEntries ?? []).length === 0 ? (
          <Empty title="今天还没有记录" desc="随手写一句也可以，比如「今天 TA 说想去看海」" />
        ) : (
          <div className="space-y-3">
            {todayEntries!.map((e) => (
              <EntryCard
                key={e.id}
                entry={e}
                hideDate
                onEdit={(x) => {
                  setEditing(x)
                  setEditorOpen(true)
                }}
                onDelete={removeEntry}
                onOpenPhoto={(p, ids) => setViewer({ ids, index: ids.indexOf(p) })}
              />
            ))}
          </div>
        )}
      </div>

      <EntryEditor open={editorOpen} onClose={() => setEditorOpen(false)} personId={pid} entry={editing} />

      {statusOpen && (
        <StatusModal
          today={todayStr}
          initial={status}
          onClose={() => setStatusOpen(false)}
          onSaved={() => {
            setStatusOpen(false)
            toast('今日状态已保存')
          }}
          personId={pid}
        />
      )}

      {viewer && <PhotoViewer ids={viewer.ids} startIndex={viewer.index} onClose={() => setViewer(null)} />}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* 今日状态编辑                                                        */
/* ------------------------------------------------------------------ */

function StatusModal({
  personId,
  today,
  initial,
  onClose,
  onSaved,
}: {
  personId: string
  today: string
  initial?: { mood?: Mood; moodCustom?: string; moodLevel?: number; energy?: number; sleepHours?: number; goodThing?: string; worry?: string; needAttention?: string }
  onClose: () => void
  onSaved: () => void
}) {
  const [draft, setDraft] = useState({
    mood: initial?.mood as Mood | undefined,
    moodCustom: initial?.moodCustom ?? '',
    moodLevel: initial?.moodLevel,
    energy: initial?.energy,
    sleepHours: initial?.sleepHours,
  })
  const [goodThing, setGoodThing] = useState(initial?.goodThing ?? '')
  const [worry, setWorry] = useState(initial?.worry ?? '')
  const [needAttention, setNeedAttention] = useState(initial?.needAttention ?? '')

  const save = async () => {
    await upsertDailyStatus(personId, today, {
      mood: draft.mood,
      moodCustom: draft.mood === 'custom' ? draft.moodCustom.trim() || undefined : undefined,
      moodLevel: draft.moodLevel,
      energy: draft.energy,
      sleepHours: draft.sleepHours,
      goodThing: goodThing.trim() || undefined,
      worry: worry.trim() || undefined,
      needAttention: needAttention.trim() || undefined,
    })
    onSaved()
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="今日状态"
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
      <Field label="心情（可以留空）">
        <Chips
          options={MOODS.map((m) => ({ value: m.value, label: m.label, emoji: m.emoji }))}
          value={draft.mood ?? ''}
          onChange={(v) => setDraft({ ...draft, mood: (v as Mood) || undefined })}
        />
        {draft.mood === 'custom' && (
          <input
            className="input mt-2"
            placeholder="自定义心情，例如「松了一口气」"
            value={draft.moodCustom}
            onChange={(e) => setDraft({ ...draft, moodCustom: e.target.value })}
          />
        )}
      </Field>
      <Field label="心情程度">
        <Stars value={draft.moodLevel} onChange={(v) => setDraft({ ...draft, moodLevel: v })} />
      </Field>
      <Field label="精力">
        <Stars value={draft.energy} onChange={(v) => setDraft({ ...draft, energy: v })} />
      </Field>
      <Field label="睡眠时长（小时）">
        <input
          type="number"
          min={0}
          max={24}
          step={0.5}
          className="input"
          value={draft.sleepHours ?? ''}
          onChange={(e) => setDraft({ ...draft, sleepHours: e.target.value ? Number(e.target.value) : undefined })}
        />
      </Field>
      <Field label="今天的好事">
        <textarea className="textarea" rows={2} value={goodThing} onChange={(e) => setGoodThing(e.target.value)} />
      </Field>
      <Field label="烦心事">
        <textarea className="textarea" rows={2} value={worry} onChange={(e) => setWorry(e.target.value)} />
      </Field>
      <Field label="需要关注的事">
        <textarea className="textarea" rows={2} value={needAttention} onChange={(e) => setNeedAttention(e.target.value)} />
      </Field>
    </Modal>
  )
}
