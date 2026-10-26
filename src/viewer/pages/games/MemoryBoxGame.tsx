import { useMemo, useState } from 'react'
import { Gift, RefreshCw, Sparkles, Star } from 'lucide-react'
import { useSnapshot } from '../../state/SnapshotContext'
import { randomSeed } from '../../game/memory'
import { buildMemoryBoxQueue, relatedEntryForPhoto } from '../../game/memoryBox'
import { useFullPhotoUrl } from '../../data/cloud'
import { GameHeader, GameResult, PhotoMemoryLinks } from '../../components/GameShared'
import { fmtDate, parseAny } from '../../../lib/date'

export default function MemoryBoxGame() {
  const snapshot = useSnapshot()
  const publishId = snapshot.manifest?.publishId ?? ''
  const [seed, setSeed] = useState(() => randomSeed())
  const [cursor, setCursor] = useState(0)
  const [revealed, setRevealed] = useState(false)
  const [failed, setFailed] = useState(false)
  const queue = useMemo(() => buildMemoryBoxQueue(snapshot.photos, `${publishId}|${seed}`), [snapshot.photos, publishId, seed])
  const photo = queue[cursor]
  const fullUrl = useFullPhotoUrl(photo)
  const entry = relatedEntryForPhoto(photo, snapshot.entries)
  const exhausted = queue.length > 0 && cursor >= queue.length

  const next = () => {
    setCursor((value) => value + 1)
    setRevealed(false)
    setFailed(false)
  }

  const reshuffle = () => {
    setSeed(randomSeed())
    setCursor(0)
    setRevealed(false)
    setFailed(false)
  }

  if (!queue.length) {
    return (
      <div className="mx-auto max-w-[560px]">
        <GameHeader title="今日回忆盲盒" description="需要至少 1 张带缩略图的已发布照片。" />
        <GameResult title="暂时还没有可打开的回忆">作者发布照片后，这里才能开始抽取。</GameResult>
      </div>
    )
  }

  if (exhausted) {
    return (
      <div className="mx-auto max-w-[560px] space-y-4">
        <GameHeader title="今日回忆盲盒" description="同一轮不会重复；抽完以后可以重新洗牌。" />
        <GameResult title="这一轮已经看完了">
          <p>本次共打开 {queue.length} 张照片。</p>
          <button type="button" onClick={reshuffle} className="btn-primary mt-3 inline-flex min-h-11 items-center gap-2 px-4 text-[12px]">
            <RefreshCw size={14} /> 重新洗牌
          </button>
        </GameResult>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-[560px] space-y-4 pb-6">
      <GameHeader title="今日回忆盲盒" description={`打开一颗星，看看它背后是哪段回忆。本轮还有 ${queue.length - cursor} 颗。`} />

      {!revealed ? (
        <section className="rounded-3xl border border-cream-200 bg-white/75 px-5 py-10 text-center">
          <button
            type="button"
            onClick={() => setRevealed(true)}
            className="mx-auto flex h-28 w-28 items-center justify-center rounded-full border border-amber-200 bg-[#FFF3D8] text-[#B77B21] shadow-sm transition hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-deep"
            aria-label="直接打开回忆盲盒"
          >
            <Star size={44} fill="currentColor" />
          </button>
          <p className="mt-4 text-[13px] text-ink-700">点一下星星，直接打开</p>
          <p className="mt-1 text-[11.5px] text-ink-400">不限制每日次数，也没有倒计时。</p>
        </section>
      ) : failed ? (
        <GameResult title="这张照片暂时没有加载成功">
          <button type="button" onClick={next} className="btn-ghost mt-2 min-h-11 px-3">换一张</button>
        </GameResult>
      ) : (
        <section className="overflow-hidden rounded-3xl border border-cream-200 bg-white/80" aria-live="polite">
          <img src={fullUrl} alt={photo?.caption || '回忆照片'} onError={() => setFailed(true)} className="max-h-[420px] w-full object-cover" />
          <div className="p-4 text-center">
            <div className="inline-flex items-center gap-1.5 rounded-full bg-rose-soft/15 px-3 py-1 text-[11px] text-rose-deep">
              <Gift size={12} /> 已打开第 {cursor + 1} / {queue.length} 颗
            </div>
            <h2 className="mt-3 text-[15px] font-medium text-ink-900">{photo?.caption || entry?.title || '一段安静的回忆'}</h2>
            {photo?.takenAt && <p className="mt-1 text-[11.5px] text-ink-400">{fmtDate(parseAny(photo.takenAt))}</p>}
            {entry?.content && <p className="mx-auto mt-2 max-w-[460px] text-[12px] leading-relaxed text-ink-500">{entry.content.slice(0, 120)}{entry.content.length > 120 ? '…' : ''}</p>}
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              {photo && <PhotoMemoryLinks photo={photo} />}
              <button type="button" onClick={next} className="btn-primary inline-flex min-h-11 items-center gap-1.5 px-4 text-[12px]">
                <Sparkles size={14} /> 再来一个
              </button>
            </div>
          </div>
        </section>
      )}
    </div>
  )
}
