import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, ChevronLeft, ChevronRight, Quote, Eye, Heart, Sparkles } from 'lucide-react'
import clsx from 'clsx'
import { useSnapshot, useSnapshotState } from '../state/SnapshotContext'
import { useAuthorReload } from '../author/AuthorReload'
import { DeleteEntryButton, EntryEditor } from '../author/lazy'
import {
  DIRECTION_LABEL,
  EVIDENCE_LABEL,
  KIND_LABEL,
  MOOD_LABEL,
  entryDateText,
  photosOfEntry,
  sortEntriesDesc,
} from '../lib/data'
import { EmptyState, Pill, SectionHead } from '../components/bits'
import { PhotoTile, Lightbox } from '../components/Photos'
import { TreasureTargetAction } from '../components/TreasureTargetAction'
import { Suspense, useState } from 'react'

export default function RecordDetail() {
  const { id } = useParams()
  const s = useSnapshot()
  const nav = useNavigate()
  const [box, setBox] = useState<number | null>(null)

  const entry = s.entries.find((e) => e.id === id)
  if (!entry) {
    return (
      <div className="space-y-4">
        <BackLink />
        <EmptyState title="这条记录不存在或未发布" desc="它可能还没有包含在当前发布版本里。" />
      </div>
    )
  }

  const photos = photosOfEntry(s, entry.id)
  const ordered = sortEntriesDesc(s.entries)
  const idx = ordered.findIndex((e) => e.id === entry.id)
  const older = ordered[idx + 1]
  const newer = ordered[idx - 1]

  const citingPrefs = s.preferences.filter((p) => p.evidenceEntryIds.includes(entry.id))
  const citingInsights = s.insights.filter((i) => i.evidenceEntryIds.includes(entry.id))
  const relatedGifts = s.gifts.filter((g) => g.entryId === entry.id)
  const relatedWishes = s.wishes.filter((w) => w.entryIds.includes(entry.id))

  const { editable } = useSnapshotState()
  const reload = useAuthorReload()
  const [editing, setEditing] = useState(false)

  return (
    <article className="v-record-detail mx-auto max-w-[760px] space-y-6">
      <BackLink />

      {editable && reload && entry && (
        <div className="flex flex-wrap items-center justify-end gap-2 px-1">
          <Suspense fallback={null}>
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="rounded-full border border-cream-300 bg-white px-2.5 py-0.5 text-[12px] text-ink-700 hover:text-rose-deep"
          >
            编辑这条
          </button>
          <DeleteEntryButton
            entryId={entry.id}
            onDeleted={() => {
              void reload()
              nav('/stories')
            }}
          />
          <EntryEditor
            open={editing}
            entry={{
              id: entry.id,
              title: entry.title,
              occurredAt: entry.occurredAt,
              type: entry.kind,
              content: entry.content,
              taSaid: entry.taSaid,
              myObservation: entry.myObservation,
              mood: entry.mood,
              tagList: entry.tags,
              photoIds: entry.photoIds,
            }}
            onClose={() => setEditing(false)}
            onSaved={() => void reload()}
          />
          </Suspense>
        </div>
      )}

      <header className="v-record-header">
        <div className="v-eyebrow">A PAGE FROM OUR DAYS</div>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-[12px] text-[#666174]">
          <span className="tabular-nums text-ink-700">{entryDateText(entry.occurredAt)}</span>
          <span className="text-cream-300">·</span>
          <span>{KIND_LABEL[entry.kind]}</span>
          {entry.mood && (
            <Pill tone="rose">
              {entry.mood === 'custom' ? entry.moodCustom || '心情' : MOOD_LABEL[entry.mood]}
              {entry.moodLevel ? ` ${entry.moodLevel}/5` : ''}
            </Pill>
          )}
          {entry.quick && <Pill>快速记录</Pill>}
        </div>
        <h1>{entry.title}</h1>
      </header>

      <TreasureTargetAction targetType="entry" targetId={entry.id} />

      {photos.length > 0 && (
        <div className={clsx('v-record-photos grid gap-2', photos.length === 1 ? 'grid-cols-1' : photos.length === 2 ? 'grid-cols-2' : 'grid-cols-3')}>
          {photos.map((p, i) => (
            <PhotoTile
              key={p.id}
              photo={p}
              eager={i === 0}
              onClick={() => setBox(i)}
              className={photos.length === 1 ? 'aspect-[4/3]' : 'aspect-square'}
            />
          ))}
        </div>
      )}

      <div className="space-y-3">
        {entry.content && (
          <section className="v-paper-section v-record-content">
            <p className="whitespace-pre-wrap">{entry.content}</p>
          </section>
        )}

        {entry.taSaid && (
          <section className="v-quote-section relative p-5 sm:p-6">
            <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium text-rose-deep">
              <Quote size={12} />
              TA 说的话
            </div>
            <p className="text-[13.5px] leading-[1.85] text-ink-900">「{entry.taSaid}」</p>
            <p className="mt-2 text-[10.5px] text-ink-300">原话单独保存，不改写、不与观察混写</p>
          </section>
        )}

        {entry.myObservation && (
          <section className="v-observation-section p-5 sm:p-6">
            <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium text-ink-500">
              <Eye size={12} />
              我的观察
            </div>
            <p className="text-[13px] leading-[1.85] text-ink-700">{entry.myObservation}</p>
            <p className="mt-2 text-[10.5px] text-ink-300">这是记录者当时的判断，不是 TA 的原话</p>
          </section>
        )}
      </div>

      {entry.tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5 px-1">
          {entry.tags.map((t) => (
            <Pill key={t}>#{t}</Pill>
          ))}
        </div>
      )}

      {(citingPrefs.length > 0 || citingInsights.length > 0) && (
        <section>
          <SectionHead title="这条记录被引用为" hint="偏好与画像的依据来源" />
          <ul className="space-y-2">
            {citingPrefs.map((p) => (
              <li key={p.id} className="flex items-start gap-2 rounded-xl border border-cream-200 bg-white px-3 py-2.5">
                <Heart size={13} className="mt-0.5 shrink-0 text-rose-soft" />
                <div className="min-w-0">
                  <div className="text-[12.5px] text-ink-900">
                    {p.name}
                    <span className="ml-1.5 text-[10.5px] text-ink-300">{DIRECTION_LABEL[p.direction]}</span>
                  </div>
                  {p.note && <p className="mt-0.5 text-[11px] text-ink-500">{p.note}</p>}
                </div>
              </li>
            ))}
            {citingInsights.map((i) => (
              <li key={i.id} className="flex items-start gap-2 rounded-xl border border-cream-200 bg-white px-3 py-2.5">
                <Sparkles size={13} className="mt-0.5 shrink-0 text-[#C9A6D8]" />
                <div className="min-w-0">
                  <div className="text-[12.5px] leading-snug text-ink-900">{i.description}</div>
                  <div className="mt-0.5 text-[10.5px] text-ink-300">
                    {i.dimension} · {EVIDENCE_LABEL[i.evidenceType]} · {i.confirmState === 'confirmed' ? '已确认' : '待确认'}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {(relatedGifts.length > 0 || relatedWishes.length > 0) && (
        <section>
          <SectionHead title="关联的心愿与礼物" />
          <ul className="space-y-1.5">
            {relatedWishes.map((w) => (
              <li key={w.id} className="rounded-xl bg-cream-50 px-3 py-2 text-[12px] text-ink-700">
                心愿：{w.content}
              </li>
            ))}
            {relatedGifts.map((g) => (
              <li key={g.id} className="rounded-xl bg-cream-50 px-3 py-2 text-[12px] text-ink-700">
                礼物：{g.name}
                {g.occasion ? ` · ${g.occasion}` : ''}
              </li>
            ))}
          </ul>
        </section>
      )}

      <nav className="flex items-stretch gap-2 border-t border-cream-200 pt-3">
        <button
          type="button"
          disabled={!older}
          onClick={() => older && nav(`/stories/${older.id}`)}
          className="flex min-w-0 flex-1 items-center gap-1.5 rounded-xl border border-cream-300 bg-white px-3 py-2.5 text-left text-[12px] text-ink-700 transition hover:bg-cream-50 disabled:opacity-40"
        >
          <ChevronLeft size={14} className="shrink-0" />
          <span className="truncate">{older ? `更早：${older.title}` : '没有更早的记录'}</span>
        </button>
        <button
          type="button"
          disabled={!newer}
          onClick={() => newer && nav(`/stories/${newer.id}`)}
          className="flex min-w-0 flex-1 items-center justify-end gap-1.5 rounded-xl border border-cream-300 bg-white px-3 py-2.5 text-right text-[12px] text-ink-700 transition hover:bg-cream-50 disabled:opacity-40"
        >
          <span className="truncate">{newer ? `更近：${newer.title}` : '已经是最新'}</span>
          <ChevronRight size={14} className="shrink-0" />
        </button>
      </nav>

      {box !== null && (
        <Lightbox photos={photos} index={box} onIndexChange={setBox} onClose={() => setBox(null)} />
      )}
    </article>
  )
}

function BackLink() {
  return (
    <Link to="/stories" className="v-back-link">
      <ArrowLeft size={14} />
      回到故事
    </Link>
  )
}
