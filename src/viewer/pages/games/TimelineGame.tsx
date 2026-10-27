import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowDown, ArrowUp, Eye, ListOrdered, Play, RotateCcw, Shuffle } from 'lucide-react'
import { useSnapshot } from '../../state/SnapshotContext'
import { fmtDuration, randomSeed, usablePhotos } from '../../game/memory'
import {
  TIMELINE_ITEM_COUNTS,
  buildTimelinePool,
  buildTimelinePuzzle,
  gradeTimeline,
  loadTimelineRecord,
  moveTimelineItem,
  saveTimelineRecord,
  type TimelineDifficulty,
  type TimelineItem,
  type TimelineRecord,
} from '../../game/timeline'
import { GameHeader, GameResult, useGameTimer } from '../../components/GameShared'
import { fmtDate, parseAny } from '../../../lib/date'

const DIFFICULTY_LABELS: Record<TimelineDifficulty, string> = {
  easy: `轻松 · ${TIMELINE_ITEM_COUNTS.easy} 条`,
  standard: `标准 · ${TIMELINE_ITEM_COUNTS.standard} 条`,
}

export default function TimelineGame() {
  const snapshot = useSnapshot()
  const publishId = snapshot.manifest?.publishId ?? ''
  const poolSize = useMemo(() => buildTimelinePool(snapshot.entries).length, [snapshot.entries])
  const photoById = useMemo(() => new Map(usablePhotos(snapshot.photos).map((photo) => [photo.id, photo])), [snapshot.photos])

  const [difficulty, setDifficulty] = useState<TimelineDifficulty>('easy')
  const [started, setStarted] = useState(false)
  const [seed, setSeed] = useState(() => randomSeed())
  const [round, setRound] = useState(0)
  const [order, setOrder] = useState<string[]>([])
  const [submitted, setSubmitted] = useState(false)
  const [results, setResults] = useState<boolean[] | null>(null)
  const [revealed, setRevealed] = useState(false)
  const [record, setRecord] = useState<TimelineRecord | null>(null)

  const puzzle = useMemo(
    () => buildTimelinePuzzle(snapshot.entries, publishId, seed, difficulty),
    [snapshot.entries, publishId, seed, difficulty],
  )
  const itemById = useMemo(() => new Map((puzzle?.items ?? []).map((item) => [item.entryId, item])), [puzzle])
  const answerIndexById = useMemo(
    () => new Map((puzzle?.answer ?? []).map((item, index) => [item.entryId, index])),
    [puzzle],
  )
  const correct = results ? results.filter(Boolean).length : 0
  const elapsed = useGameTimer(started && !submitted, `${publishId}|${difficulty}|${round}`)

  useEffect(() => setStarted(false), [publishId])
  useEffect(() => {
    if (!started) setRecord(loadTimelineRecord(publishId, difficulty))
  }, [started, publishId, difficulty])

  const begin = () => {
    setSeed(randomSeed())
    setRound((value) => value + 1)
    setOrder([])
    setSubmitted(false)
    setResults(null)
    setRevealed(false)
    setStarted(true)
    // order 依赖新 seed 算出的 puzzle，放在 effect 里初始化
  }

  useEffect(() => {
    if (started && puzzle && order.length === 0) setOrder(puzzle.items.map((item) => item.entryId))
  }, [started, puzzle, order.length])

  const submit = () => {
    if (!puzzle || submitted) return
    const graded = gradeTimeline(puzzle.answer, order)
    setResults(graded)
    setSubmitted(true)
    setRecord(
      saveTimelineRecord(publishId, difficulty, {
        correct: graded.filter(Boolean).length,
        total: puzzle.answer.length,
        ms: elapsed,
      }),
    )
  }

  const retry = () => {
    if (!puzzle) return
    setOrder(puzzle.items.map((item) => item.entryId))
    setSubmitted(false)
    setResults(null)
    setRevealed(false)
  }

  const total = TIMELINE_ITEM_COUNTS[difficulty]

  if (poolSize < TIMELINE_ITEM_COUNTS.easy) {
    return (
      <div className="mx-auto max-w-[560px]">
        <GameHeader title="把时光排好" description={`需要至少 ${TIMELINE_ITEM_COUNTS.easy} 条不同日期、带可信时间的已发布记录。`} />
        <GameResult title="可排序的回忆还不够">
          当前有 {poolSize} 条不同日期的记录；同一天只取最早一条，日期未知的记录不参与出题。
        </GameResult>
      </div>
    )
  }

  if (!started) {
    return (
      <div className="mx-auto max-w-[560px] space-y-5">
        <GameHeader title="把时光排好" description="把打乱的回忆卡片按发生先后排好。日期会在提交前藏起来，慢慢想，没有倒计时。" />
        <section className="rounded-2xl border border-cream-200 bg-white/75 p-4">
          <h2 className="text-[13px] font-medium text-ink-800">选择难度</h2>
          <div className="mt-3 grid grid-cols-2 gap-2">
            {(['easy', 'standard'] as TimelineDifficulty[]).map((id) => {
              const enough = poolSize >= TIMELINE_ITEM_COUNTS[id]
              return (
                <button
                  key={id}
                  type="button"
                  disabled={!enough}
                  onClick={() => setDifficulty(id)}
                  aria-pressed={difficulty === id}
                  className={`min-h-11 rounded-xl border px-3 text-[12px] disabled:opacity-40 ${difficulty === id ? 'border-rose-soft bg-rose-soft/15 text-rose-deep' : 'border-cream-300 bg-white text-ink-600'}`}
                >
                  {DIFFICULTY_LABELS[id]}{enough ? '' : '（素材不足）'}
                </button>
              )
            })}
          </div>
          <p className="mt-3 text-[11.5px] text-ink-400">本题库有 {poolSize} 条不同日期的记录可用。成绩只保存在这台设备。</p>
          {record && record.plays > 0 && (
            <p className="mt-1 text-[11.5px] text-ink-400">
              本难度最佳：排对 {record.bestCorrect} 个位置{record.bestMs > 0 ? ` · 全对最快 ${fmtDuration(record.bestMs)}` : ''} · 全对 {record.clears} 次
            </p>
          )}
          <button type="button" onClick={() => begin()} disabled={poolSize < total} className="btn-primary mt-4 inline-flex min-h-11 items-center gap-2 px-4 text-[13px] disabled:opacity-40">
            <Play size={15} /> 开始排序
          </button>
        </section>
      </div>
    )
  }

  if (!puzzle) {
    return (
      <div className="mx-auto max-w-[560px]">
        <GameHeader title="把时光排好" description="当前题池已经变化。" />
        <GameResult title="这一局无法继续">
          <p>这一难度需要 {total} 条不同日期的记录，当前只有 {poolSize} 条。</p>
          <button type="button" onClick={() => setStarted(false)} className="btn-ghost mt-2 min-h-11 px-3">返回重新选择难度</button>
        </GameResult>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-[680px] space-y-4 pb-6">
      <GameHeader
        title="把时光排好"
        description={`${DIFFICULTY_LABELS[difficulty]} · 用卡片旁的箭头调整顺序，由上到下按时间从最早到最晚排列。`}
      />

      <ol className="space-y-2">
        {order.map((entryId, index) => {
          const item = itemById.get(entryId)
          if (!item) return null
          const photos = item.photoIds.map((id) => photoById.get(id)).filter((photo) => Boolean(photo)).slice(0, 3)
          const isCorrect = submitted ? results?.[index] === true : null
          const answerIndex = answerIndexById.get(entryId)
          return (
            <li
              key={entryId}
              data-timeline-card={entryId}
              data-result={isCorrect === null ? '' : isCorrect ? 'correct' : 'wrong'}
              className={`flex items-center gap-3 rounded-2xl border bg-white/80 p-3 ${
                isCorrect === null ? 'border-cream-200' : isCorrect ? 'border-emerald-600' : 'border-rose-600'
              }`}
            >
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-cream-100 text-[12px] text-ink-600">{index + 1}</span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-medium text-ink-900">{item.title || '一段没有标题的回忆'}</p>
                {photos.length > 0 && (
                  <div className="mt-1.5 flex gap-1.5">
                    {photos.map((photo) => (
                      <img key={photo!.id} src={photo!.media.thumb.url} alt={photo!.caption || ''} draggable={false} className="h-12 w-12 rounded-lg object-cover" />
                    ))}
                  </div>
                )}
                {submitted && (
                  <p className={`mt-1.5 text-[11px] ${isCorrect ? 'text-emerald-700' : 'text-rose-700'}`}>
                    {isCorrect ? '位置正确' : `正确位置：第 ${(answerIndex ?? 0) + 1} 位`}
                  </p>
                )}
              </div>
              <div className="flex shrink-0 flex-col gap-1">
                <button
                  type="button"
                  disabled={submitted || index === 0}
                  onClick={() => setOrder((current) => moveTimelineItem(current, index, -1))}
                  aria-label={`把「${item.title || '这条回忆'}」上移一位`}
                  className="btn-ghost inline-flex min-h-11 items-center justify-center px-2 disabled:opacity-40"
                >
                  <ArrowUp size={16} />
                </button>
                <button
                  type="button"
                  disabled={submitted || index === order.length - 1}
                  onClick={() => setOrder((current) => moveTimelineItem(current, index, 1))}
                  aria-label={`把「${item.title || '这条回忆'}」下移一位`}
                  className="btn-ghost inline-flex min-h-11 items-center justify-center px-2 disabled:opacity-40"
                >
                  <ArrowDown size={16} />
                </button>
              </div>
            </li>
          )
        })}
      </ol>

      {!submitted ? (
        <div className="text-center">
          <button type="button" onClick={submit} className="btn-primary inline-flex min-h-11 items-center gap-2 px-5 text-[13px]">
            <ListOrdered size={15} /> 排好了，提交
          </button>
        </div>
      ) : (
        <div className="space-y-4" aria-live="polite">
          <GameResult title={correct === puzzle.answer.length ? '全部排对了' : `排对了 ${correct} / ${puzzle.answer.length} 个位置`}>
            <p>用时 {fmtDuration(elapsed)}</p>
            {record && <p className="mt-1">本难度最佳：排对 {record.bestCorrect} 个位置{record.bestMs > 0 ? ` · 全对最快 ${fmtDuration(record.bestMs)}` : ''}</p>}
            <div className="mt-3 flex flex-wrap justify-center gap-2">
              <button type="button" onClick={retry} className="btn-ghost inline-flex min-h-11 items-center gap-1.5 px-3 text-[12px]">
                <RotateCcw size={14} /> 再试一次
              </button>
              {!revealed && (
                <button type="button" onClick={() => setRevealed(true)} className="btn-ghost inline-flex min-h-11 items-center gap-1.5 px-3 text-[12px]">
                  <Eye size={14} /> 揭晓完整时间线
                </button>
              )}
              <button type="button" onClick={() => begin()} className="btn-primary inline-flex min-h-11 items-center gap-1.5 px-4 text-[12px]">
                <Shuffle size={14} /> 换一组
              </button>
            </div>
          </GameResult>

          {revealed && (
            <section className="rounded-2xl border border-cream-200 bg-white/75 p-4" aria-live="polite">
              <h2 className="text-[13px] font-medium text-ink-800">完整时间线（从最早开始）</h2>
              <ol className="mt-3 space-y-2">
                {puzzle.answer.map((item: TimelineItem, index: number) => (
                  <li key={item.entryId} className="flex items-center gap-3 rounded-xl border border-cream-200 bg-white/80 px-3 py-2">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-rose-soft/15 text-[11px] text-rose-deep">{index + 1}</span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[12.5px] font-medium text-ink-900">{item.title || '一段没有标题的回忆'}</p>
                      <p className="mt-0.5 text-[11px] text-ink-400">{fmtDate(parseAny(item.occurredAt))}</p>
                    </div>
                    <Link to={`/stories/${item.entryId}`} className="btn-ghost inline-flex min-h-11 shrink-0 items-center px-3 text-[12px]">
                      看看这段回忆
                    </Link>
                  </li>
                ))}
              </ol>
            </section>
          )}
        </div>
      )}
    </div>
  )
}
