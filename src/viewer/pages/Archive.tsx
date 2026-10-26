import { Suspense, useState, type ReactNode } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import clsx from 'clsx'
import {
  Activity,
  CalendarDays,
  Gift,
  Heart,
  MessageSquareQuote,
  Pencil,
  Plus,
  Smile,
  Sparkles,
  UserRound,
} from 'lucide-react'
import { useSnapshot, useSnapshotState } from '../state/SnapshotContext'
import { useAuthorReload } from '../author/AuthorReload'
import { ArchiveDeleteButton, ArchiveItemEditor } from '../author/lazy'
import type { ArchiveKind, ArchiveRow } from '../author/archiveEditors'
import {
  DIRECTION_LABEL,
  EVIDENCE_LABEL,
  HEALTH_LABEL,
  WISH_LABEL,
  anniversaryDateText,
  daysLeftText,
  upcomingAnniversaries,
} from '../lib/data'
import { EmptyState, Pill } from '../components/bits'
import { MarkdownLite } from '../components/MarkdownLite'
import { fmtDate, parseAny } from '../../lib/date'

const TABS = [
  { key: 'preferences', label: '偏好习惯', icon: Heart, kind: 'preference' },
  { key: 'wishes', label: '心愿礼物', icon: Sparkles, kind: 'wish' },
  { key: 'health', label: '状态健康', icon: Activity, kind: 'health' },
  { key: 'status', label: '每日状态', icon: Smile, kind: 'status' },
  { key: 'portrait', label: '他的画像', icon: UserRound, kind: 'insight' },
  { key: 'anniversary', label: '纪念日', icon: CalendarDays, kind: 'anniversary' },
  { key: 'review', label: '历史回顾', icon: MessageSquareQuote, kind: 'summary' },
] as const

type TabKey = (typeof TABS)[number]['key']

/** 作者端编辑能力；访客端 canEdit 为 false，所有编辑入口不渲染 */
interface EditCtx {
  canEdit: boolean
  openCreate: (kind: ArchiveKind) => void
  openEdit: (kind: ArchiveKind, row: ArchiveRow) => void
  onChanged: () => void
}

export default function Archive() {
  const s = useSnapshot()
  const { editable } = useSnapshotState()
  const reload = useAuthorReload()
  const [params, setParams] = useSearchParams()
  const [editing, setEditing] = useState<{ kind: ArchiveKind; row?: ArchiveRow } | null>(null)

  const raw = params.get('tab') as TabKey | null
  const tab: TabKey = TABS.some((t) => t.key === raw) ? (raw as TabKey) : 'preferences'

  const edit: EditCtx = {
    canEdit: Boolean(editable && reload),
    openCreate: (kind) => setEditing({ kind }),
    openEdit: (kind, row) => setEditing({ kind, row }),
    onChanged: () => void reload?.(),
  }

  return (
    <div className="mx-auto max-w-[820px] space-y-4">
      <header className="flex items-start justify-between gap-3 px-1">
        <div className="min-w-0">
          <h1 className="text-[19px] font-semibold text-ink-900">{s.person.displayName || '他'}的档案</h1>
          <p className="mt-1 text-[11.5px] text-ink-500">
            偏好、心愿、健康、画像与回顾都按分类保存；推断出来的内容会标出依据强度，不会写成已确认事实
          </p>
        </div>
        {edit.canEdit && tab !== 'wishes' && (
          <AddButton
            label="新增"
            onClick={() => edit.openCreate((TABS.find((t) => t.key === tab)?.kind ?? 'preference') as ArchiveKind)}
          />
        )}
      </header>

      <div className="v-scroll-x -mx-1 flex gap-1.5 overflow-x-auto px-1">
        {TABS.map((t) => {
          const Icon = t.icon
          const active = tab === t.key
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setParams({ tab: t.key }, { replace: true })}
              className={clsx(
                'inline-flex shrink-0 items-center gap-1 rounded-full border px-3 py-1.5 text-[11.5px] transition',
                active
                  ? 'border-rose-soft bg-rose-soft/15 font-medium text-rose-deep'
                  : 'border-cream-300 bg-white text-ink-500 hover:bg-cream-50',
              )}
            >
              <Icon size={12} />
              {t.label}
            </button>
          )
        })}
      </div>

      {tab === 'preferences' && <Preferences edit={edit} />}
      {tab === 'wishes' && <Wishes edit={edit} />}
      {tab === 'health' && <Health edit={edit} />}
      {tab === 'status' && <Statuses edit={edit} />}
      {tab === 'portrait' && <Portrait edit={edit} />}
      {tab === 'anniversary' && <Anniversaries edit={edit} />}
      {tab === 'review' && <Reviews edit={edit} />}

      {edit.canEdit && (
        <Suspense fallback={null}>
          <ArchiveItemEditor
            open={!!editing}
            kind={editing?.kind ?? 'preference'}
            personId={s.person.id}
            row={editing?.row}
            onClose={() => setEditing(null)}
            onSaved={edit.onChanged}
          />
        </Suspense>
      )}
    </div>
  )
}

function AddButton({ onClick, label = '新增' }: { onClick: () => void; label?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex shrink-0 items-center gap-1 rounded-full border border-rose-soft/60 bg-rose-soft/10 px-2.5 py-1 text-[12px] font-medium text-rose-deep transition hover:bg-rose-soft/20"
    >
      <Plus size={13} /> {label}
    </button>
  )
}

function BlockHead({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="mb-3 flex items-end justify-between gap-3 px-1">
      <div className="min-w-0">
        <h2 className="text-[15px] font-semibold tracking-wide text-ink-900">{title}</h2>
        {hint && <p className="mt-0.5 text-[11.5px] text-ink-500">{hint}</p>}
      </div>
      {action}
    </div>
  )
}

/** 单行的编辑 / 删除入口；访客端返回 null */
function RowActions({ edit, kind, row }: { edit: EditCtx; kind: ArchiveKind; row: ArchiveRow }) {
  const s = useSnapshot()
  if (!edit.canEdit) return null
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5">
      <button
        type="button"
        onClick={() => edit.openEdit(kind, row)}
        className="inline-flex items-center gap-1 rounded-full border border-cream-300 bg-white px-2.5 py-0.5 text-[11.5px] text-ink-700 transition hover:text-rose-deep"
      >
        <Pencil size={11} /> 编辑
      </button>
      <Suspense fallback={null}>
        <ArchiveDeleteButton kind={kind} id={row.id} personId={s.person.id} onDeleted={edit.onChanged} />
      </Suspense>
    </div>
  )
}

function Preferences({ edit }: { edit: EditCtx }) {
  const s = useSnapshot()
  if (!s.preferences.length) {
    return <EmptyState icon={<Heart size={22} />} title="还没有偏好记录" desc="登记之后，这里会按分类整理他的喜好。" />
  }

  const byCategory = s.preferences.reduce<Record<string, typeof s.preferences>>((acc, p) => {
    const key = p.category || '其他'
    acc[key] = acc[key] ? [...acc[key], p] : [p]
    return acc
  }, {})

  return (
    <div className="space-y-5">
      {Object.entries(byCategory).map(([category, list]) => (
        <section key={category}>
          <BlockHead title={category} hint={`${list.length} 条`} />
          <ul className="overflow-hidden rounded-2xl border border-cream-200 bg-white shadow-card">
            {list.map((p, i) => (
              <li key={p.id} className={clsx('px-4 py-3', i > 0 && 'border-t border-cream-200')}>
                <div className="flex items-start justify-between gap-2">
                  <span className="text-[13.5px] font-medium text-ink-900">{p.name}</span>
                  <Pill tone={p.direction === 'dislike' ? 'neutral' : 'rose'}>{DIRECTION_LABEL[p.direction]}</Pill>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] text-ink-500">
                  {typeof p.likeLevel === 'number' && (
                    <span className="inline-flex items-center gap-1">
                      喜欢程度
                      <span className="inline-flex gap-0.5">
                        {Array.from({ length: 5 }).map((_, idx) => (
                          <span
                            key={idx}
                            className={clsx('h-1.5 w-1.5 rounded-full', idx < (p.likeLevel ?? 0) ? 'bg-rose-soft' : 'bg-cream-300')}
                          />
                        ))}
                      </span>
                    </span>
                  )}
                  {p.lastConfirmedAt && <span>最近确认 {p.lastConfirmedAt}</span>}
                  {p.evidenceEntryIds.length > 0 && <span>依据 {p.evidenceEntryIds.length} 条记录</span>}
                </div>
                {p.note && <p className="mt-1 text-[11.5px] leading-relaxed text-ink-500">{p.note}</p>}
                {p.evidenceEntryIds.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {p.evidenceEntryIds.slice(0, 3).map((id) => {
                      const e = s.entries.find((x) => x.id === id)
                      return e ? (
                        <Link
                          key={id}
                          to={`/stories/${id}`}
                          className="rounded-full border border-cream-300 bg-cream-50 px-2 py-0.5 text-[10.5px] text-ink-500 hover:bg-cream-100"
                        >
                          {e.title}
                        </Link>
                      ) : null
                    })}
                  </div>
                )}
                <RowActions edit={edit} kind="preference" row={p} />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}

function Wishes({ edit }: { edit: EditCtx }) {
  const s = useSnapshot()
  return (
    <div className="space-y-5">
      <section>
        <BlockHead
          title="心愿"
          hint={`${s.wishes.length} 条`}
          action={edit.canEdit ? <AddButton label="新增心愿" onClick={() => edit.openCreate('wish')} /> : undefined}
        />
        {s.wishes.length === 0 ? (
          <EmptyState icon={<Sparkles size={20} />} title="还没有心愿" compact />
        ) : (
          <ul className="overflow-hidden rounded-2xl border border-cream-200 bg-white shadow-card">
            {s.wishes.map((w, i) => (
              <li key={w.id} className={clsx('px-4 py-3', i > 0 && 'border-t border-cream-200')}>
                <div className="flex items-start justify-between gap-2">
                  <span className="text-[13px] leading-snug text-ink-900">{w.content}</span>
                  <Pill tone={w.status === 'wish' ? 'rose' : w.status === 'fulfilled' ? 'ok' : 'neutral'}>
                    {WISH_LABEL[w.status]}
                  </Pill>
                </div>
                <div className="mt-1 flex flex-wrap gap-x-2.5 gap-y-1 text-[11px] text-ink-500">
                  {w.raisedAt && <span>提出于 {w.raisedAt}</span>}
                  {w.occasion && <span>{w.occasion}</span>}
                  {w.priority && <span>优先级 {w.priority === 1 ? '高' : w.priority === 2 ? '中' : '低'}</span>}
                </div>
                {w.note && <p className="mt-1 text-[11.5px] text-ink-500">{w.note}</p>}
                <RowActions edit={edit} kind="wish" row={w} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <BlockHead
          title="送过的礼物"
          hint={`${s.gifts.length} 件`}
          action={edit.canEdit ? <AddButton label="新增礼物" onClick={() => edit.openCreate('gift')} /> : undefined}
        />
        {s.gifts.length === 0 ? (
          <EmptyState icon={<Gift size={20} />} title="还没有礼物记录" compact />
        ) : (
          <ul className="overflow-hidden rounded-2xl border border-cream-200 bg-white shadow-card">
            {s.gifts.map((g, i) => (
              <li key={g.id} className={clsx('px-4 py-3', i > 0 && 'border-t border-cream-200')}>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-[13px] font-medium text-ink-900">{g.name}</span>
                  <span className="shrink-0 text-[11px] text-ink-300">{g.givenAt}</span>
                </div>
                {g.occasion && <div className="mt-0.5 text-[11px] text-ink-500">{g.occasion}</div>}
                {g.feedback && (
                  <p className="mt-1 border-l-2 border-cream-300 pl-2 text-[11.5px] leading-relaxed text-ink-500">
                    {g.feedback}
                  </p>
                )}
                <RowActions edit={edit} kind="gift" row={g} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function Health({ edit }: { edit: EditCtx }) {
  const s = useSnapshot()
  if (!s.health.length) {
    return <EmptyState icon={<Activity size={22} />} title="还没有健康记录" desc="只做记录与跟进，不用于推断疾病。" />
  }
  return (
    <ul className="overflow-hidden rounded-2xl border border-cream-200 bg-white shadow-card">
      {s.health.map((h, i) => (
        <li key={h.id} className={clsx('px-4 py-3', i > 0 && 'border-t border-cream-200')}>
          <div className="flex items-start justify-between gap-2">
            <span className="text-[13.5px] font-medium text-ink-900">{h.symptom}</span>
            <Pill tone={h.status === 'recovered' ? 'ok' : h.status === 'ongoing' ? 'warn' : 'neutral'}>
              {HEALTH_LABEL[h.status]}
            </Pill>
          </div>
          <div className="mt-1 flex flex-wrap gap-x-2.5 gap-y-1 text-[11px] text-ink-500">
            <span>{fmtDate(parseAny(h.occurredAt))}</span>
            {h.severity && <span>程度 {h.severity}/5</span>}
            {h.resolvedAt && <span>恢复于 {h.resolvedAt}</span>}
          </div>
          {h.note && <p className="mt-1 text-[11.5px] leading-relaxed text-ink-500">{h.note}</p>}
          {h.recovery && <p className="mt-0.5 text-[11.5px] text-ink-500">恢复情况：{h.recovery}</p>}
          <RowActions edit={edit} kind="health" row={h} />
        </li>
      ))}
    </ul>
  )
}

const STATUS_MOOD_LABEL: Record<string, string> = {
  happy: '开心',
  calm: '平静',
  low: '低落',
  anxious: '焦虑',
  angry: '生气',
  custom: '自定义',
}

function Statuses({ edit }: { edit: EditCtx }) {
  const s = useSnapshot()
  const rows = [...(s.statuses || [])].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
  if (!rows.length) {
    return (
      <EmptyState
        icon={<Smile size={22} />}
        title="还没有每日状态"
        desc="按天记一笔心情与精力，回头能看出起伏。"
      />
    )
  }
  return (
    <ul className="overflow-hidden rounded-2xl border border-cream-200 bg-white shadow-card">
      {rows.map((d, i) => (
        <li key={d.id} className={clsx('px-4 py-3', i > 0 && 'border-t border-cream-200')}>
          <div className="flex items-start justify-between gap-2">
            <span className="text-[13.5px] font-medium text-ink-900">{d.date}</span>
            {d.mood && (
              <Pill tone="neutral">
                {STATUS_MOOD_LABEL[d.mood] || d.mood}
                {d.moodLevel ? ` ${d.moodLevel}/5` : ''}
              </Pill>
            )}
          </div>
          <div className="mt-1 flex flex-wrap gap-x-2.5 gap-y-1 text-[11px] text-ink-500">
            {d.energy !== undefined && <span>精力 {d.energy}/5</span>}
            {d.sleepHours !== undefined && <span>睡眠 {d.sleepHours} 小时</span>}
          </div>
          {d.goodThing && <p className="mt-1 text-[11.5px] leading-relaxed text-ink-600">好事：{d.goodThing}</p>}
          {d.worry && <p className="mt-0.5 text-[11.5px] leading-relaxed text-ink-500">烦心：{d.worry}</p>}
          {d.note && <p className="mt-0.5 text-[11.5px] text-ink-400">{d.note}</p>}
          <RowActions edit={edit} kind="status" row={d} />
        </li>
      ))}
    </ul>
  )
}

function Portrait({ edit }: { edit: EditCtx }) {
  const s = useSnapshot()
  if (!s.insights.length) {
    return <EmptyState icon={<UserRound size={22} />} title="还没有画像条目" desc="画像只记录有依据的观察，推断项会标为待观察。" />
  }
  return (
    <div className="space-y-2.5">
      {s.insights.map((ins) => (
        <article key={ins.id} className="rounded-2xl border border-cream-200 bg-white p-4 shadow-card">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] tracking-wide text-ink-300">{ins.dimension}</span>
            <Pill tone={ins.confirmState === 'confirmed' ? 'ok' : ins.confirmState === 'pending' ? 'warn' : 'neutral'}>
              {ins.confirmState === 'confirmed' ? '已确认' : ins.confirmState === 'pending' ? '待确认' : '已排除'}
            </Pill>
          </div>
          <p className="mt-1.5 text-[13px] leading-relaxed text-ink-900">{ins.description}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-[10.5px] text-ink-500">
            <span className="rounded-full bg-cream-50 px-2 py-0.5">{EVIDENCE_LABEL[ins.evidenceType]}</span>
            <span>依据 {ins.evidenceEntryIds.length} 条记录</span>
          </div>
          {ins.evidenceEntryIds.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {ins.evidenceEntryIds.map((id) => {
                const e = s.entries.find((x) => x.id === id)
                return e ? (
                  <Link
                    key={id}
                    to={`/stories/${id}`}
                    className="rounded-full border border-cream-300 bg-cream-50 px-2 py-0.5 text-[10.5px] text-ink-500 hover:bg-cream-100"
                  >
                    {e.title}
                  </Link>
                ) : null
              })}
            </div>
          )}
          <RowActions edit={edit} kind="insight" row={ins} />
        </article>
      ))}
    </div>
  )
}

function Anniversaries({ edit }: { edit: EditCtx }) {
  const s = useSnapshot()
  if (!s.anniversaries.length) {
    return <EmptyState icon={<CalendarDays size={22} />} title="还没有纪念日" desc="公历、农历与是否每年重复都会按原有语义展示。" />
  }
  const upcoming = upcomingAnniversaries(s)
  return (
    <ul className="space-y-2.5">
      {s.anniversaries.map((a) => {
        const u = upcoming.find((x) => x.item.id === a.id)
        return (
          <li key={a.id} className="rounded-2xl border border-cream-200 bg-white p-4 shadow-card">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="text-[13.5px] font-medium text-ink-900">{a.name}</div>
                <div className="mt-1 text-[11.5px] text-ink-500">
                  {anniversaryDateText(a)}
                  <span className="mx-1.5 text-cream-300">·</span>
                  {a.calendarType === 'lunar' ? '农历' : '公历'}
                  <span className="mx-1.5 text-cream-300">·</span>
                  {a.repeatYearly ? '每年' : '仅一次'}
                </div>
              </div>
              {u ? (
                <div className="shrink-0 text-right">
                  <div className="text-[15px] font-semibold tabular-nums text-rose-deep">{u.daysLeft}</div>
                  <div className="text-[10.5px] text-ink-300">天后</div>
                </div>
              ) : (
                <span className="shrink-0 text-[11px] text-ink-300">今年已过</span>
              )}
            </div>
            {u && <div className="mt-1.5 text-[11px] text-ink-500">下一次 {fmtDate(u.date)} · {daysLeftText(u.daysLeft)}</div>}
            {a.note && <p className="mt-1 text-[11.5px] text-ink-500">{a.note}</p>}
            <RowActions edit={edit} kind="anniversary" row={a} />
          </li>
        )
      })}
      <li className="rounded-xl bg-cream-50 px-3 py-2 text-[10.5px] leading-relaxed text-ink-500">
        日期只按天展示：有日期就展示日期与天数，不补零凑出秒级计时。
      </li>
    </ul>
  )
}

function Reviews({ edit }: { edit: EditCtx }) {
  const s = useSnapshot()
  if (!s.summaries.length) {
    return <EmptyState icon={<MessageSquareQuote size={22} />} title="还没有回顾" desc="回顾可以是人工整理的，也可以标注为 AI 生成。" />
  }
  return (
    <div className="space-y-3">
      {s.summaries.map((m) => (
        <article key={m.id} className="rounded-2xl border border-cream-200 bg-white p-4 shadow-card">
          <div className="flex items-start justify-between gap-2">
            <h3 className="text-[14px] font-semibold leading-snug text-ink-900">{m.title}</h3>
            <Pill tone={m.generator === 'ai' ? 'warn' : 'neutral'} className="shrink-0">
              {m.generator === 'ai' ? 'AI 草稿' : '人工整理'}
            </Pill>
          </div>
          <div className="mt-1 text-[11px] text-ink-300">
            {m.rangeStart} → {m.rangeEnd} · 引用 {m.evidenceEntryIds.length} 条记录
          </div>
          <div className="mt-2 border-t border-cream-200 pt-1">
            <MarkdownLite text={m.content} />
          </div>
          <RowActions edit={edit} kind="summary" row={m} />
        </article>
      ))}
    </div>
  )
}
