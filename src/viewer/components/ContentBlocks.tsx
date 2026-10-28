import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ArrowUpRight } from 'lucide-react'
import type { GameId, PublicEntry, PublicPhoto } from '../types'
import { entryDateText, entryExcerpt, photoDateText, type UpcomingAnniversary } from '../lib/data'
import { fmtDate, parseAny } from '../../lib/date'
import { PhotoTile } from './Photos'

export function MilestoneGrid({
  days,
  meetDate,
  next,
  storyCount,
  photoCount,
}: {
  days: number | null
  meetDate?: string
  next?: UpcomingAnniversary
  storyCount: number
  photoCount: number
}) {
  const items = [
    {
      eyebrow: 'TIME TOGETHER',
      value: days === null ? '—' : String(days),
      unit: days === null ? '' : '天',
      label: '相识的时光',
      note: days === null || !meetDate ? '尚未设置相识日' : `${fmtDate(parseAny(meetDate))} · 从那一天开始`,
    },
    {
      eyebrow: 'NEXT CHAPTER',
      value: !next ? '—' : next.daysLeft === 0 ? '今天' : String(next.daysLeft),
      unit: !next || next.daysLeft === 0 ? '' : '天',
      label: '下一次纪念日',
      note: next ? `${next.item.name} · ${fmtDate(next.date)}` : '尚未设置纪念日',
    },
    { eyebrow: 'STORIES KEPT', value: String(storyCount), unit: '篇', label: '写下的故事', note: '当前可见的全部记录' },
    { eyebrow: 'LIGHT COLLECTED', value: String(photoCount), unit: '张', label: '收藏的画面', note: '当前可见的全部照片' },
  ]
  return (
    <section className="v-milestones" aria-label="纪念数字">
      {items.map((item) => (
        <div className="v-milestone" key={item.eyebrow}>
          <small>{item.eyebrow}</small>
          <strong>{item.value}{item.unit && <span>{item.unit}</span>}</strong>
          <b>{item.label}</b>
          <small>{item.note}</small>
        </div>
      ))}
    </section>
  )
}

export function PhotoPostcard({ photo, onOpen, eager = false }: { photo: PublicPhoto; onOpen: () => void; eager?: boolean }) {
  return (
    <article className="v-postcard">
      <PhotoTile photo={photo} onClick={onOpen} eager={eager} className="v-postcard-photo" />
      <div className="v-postcard-copy">
        <h3>{photo.caption || '一张没有题注的照片'}</h3>
        <p>{photoDateText(photo)} · 点开这一帧 <ArrowUpRight size={12} aria-hidden="true" /></p>
      </div>
    </article>
  )
}

function StoryCoverImage({ photo, title }: { photo?: PublicPhoto; title: string }) {
  const [failed, setFailed] = useState(false)
  if (!photo || failed) {
    return <div className="v-story-cover-placeholder" aria-label={failed ? '封面图片加载失败' : '这篇故事没有封面'}>{failed ? '封面暂时无法读取' : '一页文字回忆'}</div>
  }
  return <img src={photo.media.thumb.url} alt={`${title}的封面`} loading="lazy" onError={() => setFailed(true)} />
}

export function StoryCoverCard({ entry, photos }: { entry: PublicEntry; photos: PublicPhoto[] }) {
  const cover = photos.find((p) => entry.photoIds.includes(p.id)) || photos[0]
  return (
    <Link to={`/stories/${entry.id}`} className="v-story-cover">
      <div className="v-story-cover-art"><StoryCoverImage photo={cover} title={entry.title} /></div>
      <div className="v-story-cover-copy">
        <small>{entryDateText(entry.occurredAt)}</small>
        <h3>{entry.title}</h3>
        <p>{entryExcerpt(entry, 96) || '这一页还没有写下摘要，点开读完整记录。'}</p>
        <span>读这一页 <ArrowUpRight size={13} aria-hidden="true" /></span>
      </div>
    </Link>
  )
}

function GameArt({ id }: { id: GameId }) {
  const common: Record<GameId, ReactNode> = {
    memory: <><rect x="38" y="23" width="54" height="70" rx="9" fill="#c6b5d6" transform="rotate(-12 65 58)"/><rect x="70" y="28" width="54" height="70" rx="9" fill="#f2e5d8" transform="rotate(12 97 63)"/><path d="m79 54 8-7 8 7-8 7z" fill="#665080"/></>,
    puzzle: <><path d="M42 25h38v25c14-8 22 12 5 16v29H42V67c-14 8-22-12-5-16V25Z" fill="#a7b9a2"/><path d="M85 25h34v70H85V66c14-8 5-24-5-16V25Z" fill="#d8b7c7"/></>,
    photoGuess: <><rect x="39" y="24" width="68" height="70" rx="12" fill="#dbc5af"/><circle cx="69" cy="52" r="13" fill="#f3ddad"/><path d="m43 87 24-25 16 14 12-11 9 22" fill="#9ca9b6"/><circle cx="91" cy="68" r="24" fill="none" stroke="#f8f2e8" strokeWidth="7"/><path d="m108 86 17 17" stroke="#665080" strokeWidth="8" strokeLinecap="round"/></>,
    memoryBox: <><path d="m35 47 45-25 45 25v51H35Z" fill="#efd9cc"/><path d="m35 49 45 34 45-34" fill="none" stroke="#a8869d" strokeWidth="3"/><path d="m80 14 5 14 14 5-14 5-5 14-5-14-14-5 14-5z" fill="#d9bc89"/></>,
    timeline: <><path d="M37 88 121 33" stroke="#9b85ae" strokeWidth="3" strokeDasharray="5 6"/><rect x="28" y="67" width="38" height="35" rx="7" fill="#f8f2e8"/><rect x="61" y="43" width="38" height="35" rx="7" fill="#e8dded"/><rect x="94" y="19" width="38" height="35" rx="7" fill="#f1dfbd"/></>,
    quiz: <><rect x="47" y="16" width="70" height="90" rx="12" fill="#f8f1e5" transform="rotate(7 82 61)"/><text x="82" y="76" textAnchor="middle" fontSize="52" fill="#8b729e" fontFamily="Georgia">?</text></>,
    dateDraw: <><rect x="29" y="38" width="54" height="65" rx="9" fill="#b5c5b4" transform="rotate(-14 56 70)"/><rect x="78" y="32" width="54" height="65" rx="9" fill="#e7c0b5" transform="rotate(14 105 64)"/><rect x="53" y="23" width="56" height="70" rx="9" fill="#f4e7ca"/><path d="m81 40 4 10 10 4-10 4-4 10-4-10-10-4 10-4z" fill="#8b729e"/></>,
    treasure: <><path d="m37 87 43-52 43 52" fill="none" stroke="#f4e7ca" strokeWidth="2" strokeDasharray="4 5"/><circle cx="37" cy="87" r="17" fill="#c6b5d6"/><circle cx="80" cy="35" r="17" fill="#d9bc89"/><circle cx="123" cy="87" r="17" fill="#b5c5b4"/><path d="m80 25 3 7 7 3-7 3-3 7-3-7-7-3 7-3z" fill="#fff8ea"/></>,
  }
  return <div className={`v-game-art v-game-art-${id}`}><svg viewBox="0 0 160 120" aria-hidden="true">{common[id]}</svg></div>
}

export function GameCoverCard({
  id,
  title,
  description,
  duration,
  stateText,
  available,
}: {
  id: GameId
  title: string
  description: string
  duration: string
  stateText: string
  available: boolean
}) {
  const content = (
    <>
      <GameArt id={id} />
      <div className="v-game-card-copy">
        <div className="v-game-card-top"><span className={available ? 'v-game-status ok' : 'v-game-status'}>{available ? '可玩' : '素材不足'}</span><span>{duration}</span></div>
        <h3>{title}</h3>
        <p>{description}</p>
        <div className="v-game-card-foot"><span>{stateText}</span>{available && <ArrowUpRight size={14} aria-hidden="true" />}</div>
      </div>
    </>
  )
  return available ? (
    <Link to={`/game?play=${id}`} className="v-game-card">{content}</Link>
  ) : (
    <div className="v-game-card disabled" aria-disabled="true">{content}</div>
  )
}
