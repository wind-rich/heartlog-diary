import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Heart, Play, RotateCcw, Sparkles, Timer, Trophy } from 'lucide-react'
import { useSnapshot } from '../../state/SnapshotContext'
import {
  buildBoard,
  fmtDuration,
  loadRecord,
  MEMORY_PAIR_COUNTS,
  randomSeed,
  resolveMemoryPairCount,
  saveRecord,
  usablePhotos,
  type MemoryCard,
  type MemoryDifficulty,
  type MemoryRecord,
} from '../../game/memory'
import { GameHeader, GameResult, PhotoMemoryLinks, useGameTimer } from '../../components/GameShared'

const DIFFICULTIES: { id: MemoryDifficulty; label: string }[] = [
  { id: 'easy', label: '轻松 · 3 对' },
  { id: 'standard', label: '标准 · 6 对' },
  { id: 'challenge', label: '挑战 · 8 对' },
]

export default function MemoryGame() {
  const snapshot = useSnapshot()
  const publishId = snapshot.manifest?.publishId ?? ''
  const available = usablePhotos(snapshot.photos).length
  const [difficulty, setDifficulty] = useState<MemoryDifficulty>('standard')
  const [started, setStarted] = useState(false)
  const [seed, setSeed] = useState(() => randomSeed())
  const [round, setRound] = useState(0)
  const [flipped, setFlipped] = useState<string[]>([])
  const [matched, setMatched] = useState<string[]>([])
  const [moves, setMoves] = useState(0)
  const [done, setDone] = useState(false)
  const [record, setRecord] = useState<MemoryRecord | null>(null)
  const [isBest, setIsBest] = useState(false)
  const lock = useRef(false)
  const timeout = useRef<number | null>(null)
  const session = useRef(0)
  const pairCount = resolveMemoryPairCount(available, difficulty)
  const elapsed = useGameTimer(started && !done, `${publishId}|${difficulty}|${round}`)
  const legacyRecord = useMemo(() => loadRecord(publishId), [publishId])

  const board = useMemo(
    () => buildBoard(snapshot.photos, publishId, `${round}-${seed}`, pairCount ?? 3),
    [snapshot.photos, publishId, round, seed, pairCount],
  )

  const clearPending = useCallback(() => {
    session.current += 1
    if (timeout.current !== null) window.clearTimeout(timeout.current)
    timeout.current = null
    lock.current = false
  }, [])

  useEffect(() => clearPending, [clearPending])
  useEffect(() => setStarted(false), [publishId])
  useEffect(() => {
    if (started && pairCount) setRecord(loadRecord(publishId, difficulty, pairCount))
  }, [started, publishId, difficulty, pairCount])

  const reset = useCallback((play: boolean) => {
    clearPending()
    setSeed(randomSeed())
    setRound((value) => value + 1)
    setFlipped([])
    setMatched([])
    setMoves(0)
    setDone(false)
    setIsBest(false)
    setStarted(play)
  }, [clearPending])

  const onFlip = useCallback((card: MemoryCard) => {
    if (!started || done || lock.current || matched.includes(card.photoId) || flipped.includes(card.key)) return
    const next = [...flipped, card.key]
    setFlipped(next)
    if (next.length < 2) return

    const [a, b] = next.map((key) => board.cards.find((item) => item.key === key)).filter(Boolean) as MemoryCard[]
    const usedMoves = moves + 1
    setMoves(usedMoves)
    lock.current = true
    const thisSession = session.current
    const matching = a?.photoId === b?.photoId
    timeout.current = window.setTimeout(() => {
      if (thisSession !== session.current) return
      if (matching) {
        const nextMatched = [...new Set([...matched, a.photoId])]
        setMatched(nextMatched)
        if (nextMatched.length === board.pairCount) {
          setDone(true)
          const result = saveRecord(publishId, { moves: usedMoves, ms: elapsed }, difficulty, board.pairCount)
          setRecord(result.record)
          setIsBest(result.isBest)
        }
      }
      setFlipped([])
      lock.current = false
      timeout.current = null
    }, matching ? 260 : 720)
  }, [started, done, matched, flipped, board, moves, publishId, elapsed, difficulty])

  if (available < 3) {
    return (
      <div className="mx-auto max-w-[560px]">
        <GameHeader title="记忆配对" description="至少需要 3 张带缩略图的已发布照片，才能开始轻松模式。" />
        <GameResult title="照片还不够玩">当前有 {available} 张可用照片。可以先去相册看看，或返回大厅选择其他玩法。</GameResult>
      </div>
    )
  }

  if (!started) {
    return (
      <div className="mx-auto max-w-[560px] space-y-5">
        <GameHeader title="记忆配对" description="翻开两张牌，同一张照片就留下。每次开始都会换一组照片，没有强制倒计时。" />
        <section className="rounded-2xl border border-cream-200 bg-white/75 p-4">
          <h2 className="text-[13px] font-medium text-ink-800">选择难度</h2>
          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            {DIFFICULTIES.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => { setDifficulty(item.id); reset(false) }}
                aria-pressed={difficulty === item.id}
                className={`min-h-11 rounded-xl border px-3 py-2 text-[12px] ${difficulty === item.id ? 'border-rose-soft bg-rose-soft/15 text-rose-deep' : 'border-cream-300 bg-white text-ink-600'}`}
              >
                {item.label}
              </button>
            ))}
          </div>
          {pairCount !== MEMORY_PAIR_COUNTS[difficulty] && (
            <p className="mt-3 text-[12px] text-amber-700">目前只有 {available} 张可用照片，开始时会降为 {pairCount} 对。</p>
          )}
          {legacyRecord && <p className="mt-3 text-[11.5px] text-ink-400">旧版成绩仍保留：通关 {legacyRecord.clears} 次；不会与新难度混排。</p>}
          <button type="button" onClick={() => reset(true)} className="btn-primary mt-4 inline-flex min-h-11 items-center gap-2 px-4 text-[13px]">
            <Play size={15} /> 开始配对
          </button>
        </section>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-[620px] space-y-4 pb-6">
      <GameHeader
        title="记忆配对"
        description={`${board.pairCount} 对照片 · 步数少优先，同分看有效用时；切到后台会暂停计时。`}
        aside={<button type="button" onClick={() => reset(false)} className="btn-ghost min-h-11 px-3 text-[12px]">难度</button>}
      />
      <div className="flex flex-wrap items-center justify-center gap-3 text-[12px] text-ink-600">
        <span className="inline-flex items-center gap-1"><Sparkles size={12} /> 步数 {moves}</span>
        <span className="inline-flex items-center gap-1"><Timer size={12} /> {fmtDuration(elapsed)}</span>
        <span className="inline-flex items-center gap-1"><Trophy size={12} className="text-[#C9A227]" />{record ? `最佳 ${record.bestMoves} 步 / ${fmtDuration(record.bestMs)}` : '还没有本档成绩'}</span>
      </div>

      <div className="grid grid-cols-3 gap-2 sm:gap-2.5 md:grid-cols-4">
        {board.cards.map((card) => {
          const isMatched = matched.includes(card.photoId)
          const isFlipped = flipped.includes(card.key) || isMatched
          return (
            <button
              key={card.key}
              type="button"
              onClick={() => onFlip(card)}
              data-card-key={card.key}
              data-photo-id={card.photoId}
              data-state={isMatched ? 'matched' : isFlipped ? 'flipped' : 'hidden'}
              aria-label={isFlipped ? `照片：${card.label}` : '未翻开的卡片'}
              aria-pressed={isFlipped}
              className={`relative aspect-square min-h-11 overflow-hidden rounded-xl border transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-deep ${isMatched ? 'border-[#CFE0C6] bg-[#F2F7EF]' : isFlipped ? 'border-rose-soft/60 bg-white' : 'border-cream-200 bg-[#FFF3EC]'}`}
            >
              {isFlipped ? <img src={card.thumb} alt={card.label} draggable={false} className="h-full w-full object-cover" /> : <span className="flex h-full w-full items-center justify-center"><Heart size={18} className="text-rose-soft" fill="currentColor" /></span>}
              {isMatched && <span className="absolute right-1 top-1 rounded-full bg-white/90 px-1.5 py-0.5 text-[10px] text-[#4F6B45]">配对</span>}
            </button>
          )
        })}
      </div>
      <div className="flex justify-center">
        <button type="button" onClick={() => reset(true)} className="btn-ghost inline-flex min-h-11 items-center gap-1.5 px-3 text-[12px]"><RotateCcw size={14} /> 重新开始</button>
      </div>

      {done && (
        <div className="space-y-4">
          <GameResult title={isBest ? '新纪录！全部配对完成' : '全部配对完成'}>
            <p>{moves} 步 · {fmtDuration(elapsed)} · 通关 {record?.clears ?? 1} 次</p>
            <p className="mt-1">成绩只保存在本机浏览器，按发布版本、难度和实际对数分开记录。</p>
            <button type="button" onClick={() => reset(true)} className="btn-primary mt-3 inline-flex min-h-11 items-center gap-1.5 px-4 text-[12px]"><RotateCcw size={14} /> 再玩一次</button>
          </GameResult>
          <section>
            <h2 className="mb-2 text-center text-[13px] font-medium text-ink-700">这一局的照片</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              {snapshot.photos.filter((photo) => matched.includes(photo.id)).map((photo) => (
                <article key={photo.id} className="rounded-2xl border border-cream-200 bg-white/70 p-3">
                  <img src={photo.media.thumb.url} alt={photo.caption || '本局照片'} className="aspect-[4/3] w-full rounded-xl object-cover" />
                  <p className="my-2 text-center text-[12px] text-ink-600">{photo.caption || '一段没有写下说明的回忆'}</p>
                  <PhotoMemoryLinks photo={photo} />
                </article>
              ))}
            </div>
          </section>
        </div>
      )}
    </div>
  )
}
