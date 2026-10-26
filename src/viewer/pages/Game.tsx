/**
 * T6 记忆配对页面（访客端 + 作者端共用）。
 *
 * 刻意不依赖任何数据库模块：这个页面会进访客包，
 * 一旦 import 了 Dexie/同步/待办，访客端就会被迫下载数据库代码
 * （`verify-author` 与 `verify-tasks` 都盯着这条边界）。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Heart, RotateCcw, Sparkles, Timer, Trophy } from 'lucide-react'
import { useSnapshot } from '../state/SnapshotContext'
import { buildBoard, fmtDuration, gameEnabled, loadRecord, saveRecord, type MemoryCard, type MemoryRecord } from '../game/memory'

export default function GamePage() {
  const snapshot = useSnapshot()
  const publishId = snapshot.manifest?.publishId ?? ''
  const enabled = gameEnabled(snapshot.config)

  const [round, setRound] = useState(0)
  const [flipped, setFlipped] = useState<string[]>([])
  const [matched, setMatched] = useState<string[]>([])
  const [moves, setMoves] = useState(0)
  const [startedAt, setStartedAt] = useState(0)
  const [now, setNow] = useState(0)
  const [done, setDone] = useState(false)
  const [record, setRecord] = useState<MemoryRecord | null>(null)
  const [isBest, setIsBest] = useState(false)
  const lock = useRef(false)

  const board = useMemo(
    () => buildBoard(snapshot.photos, publishId, `r${round}`),
    [snapshot.photos, publishId, round],
  )

  useEffect(() => {
    setRecord(loadRecord(publishId))
  }, [publishId])

  useEffect(() => {
    if (!startedAt || done) return
    const t = window.setInterval(() => setNow(Date.now()), 500)
    return () => window.clearInterval(t)
  }, [startedAt, done])

  const restart = useCallback(() => {
    setRound((r) => r + 1)
    setFlipped([])
    setMatched([])
    setMoves(0)
    setStartedAt(0)
    setNow(0)
    setDone(false)
    setIsBest(false)
    lock.current = false
  }, [])

  const finish = useCallback(
    (ms: number, usedMoves: number) => {
      setDone(true)
      const res = saveRecord(publishId, { moves: usedMoves, ms })
      setRecord(res.record)
      setIsBest(res.isBest)
    },
    [publishId],
  )

  const onFlip = useCallback(
    (card: MemoryCard) => {
      if (done || lock.current) return
      if (matched.includes(card.photoId)) return
      if (flipped.includes(card.key)) return
      const started = startedAt || Date.now()
      if (!startedAt) {
        setStartedAt(started)
        setNow(started)
      }
      const next = [...flipped, card.key]
      setFlipped(next)
      if (next.length < 2) return

      const [a, b] = next.map((k) => board.cards.find((c) => c.key === k)).filter(Boolean) as MemoryCard[]
      const usedMoves = moves + 1
      setMoves(usedMoves)

      if (a?.photoId === b?.photoId) {
        lock.current = true
        window.setTimeout(() => {
          const nextMatched = [...new Set([...matched, a.photoId])]
          setMatched(nextMatched)
          setFlipped([])
          lock.current = false
          if (nextMatched.length === board.pairCount) finish(Date.now() - started, usedMoves)
        }, 260)
      } else {
        lock.current = true
        window.setTimeout(() => {
          setFlipped([])
          lock.current = false
        }, 720)
      }
    },
    [board, done, finish, flipped, matched, moves, startedAt],
  )

  if (!enabled) {
    return (
      <div className="mx-auto max-w-[520px] py-16 text-center">
        <Sparkles size={22} className="mx-auto text-rose-soft" />
        <p className="mt-3 text-[14px] text-ink-700">这个互动没有开启</p>
        <p className="mt-1 text-[12px] text-ink-400">作者可以在设置里打开「展示端小游戏」。</p>
        <Link to="/" className="btn-ghost mt-4 inline-flex px-3 py-1.5 text-[12.5px]">
          回到首页
        </Link>
      </div>
    )
  }

  if (board.pairCount < 2) {
    return (
      <div className="mx-auto max-w-[520px] py-16 text-center">
        <Heart size={22} className="mx-auto text-rose-soft" />
        <p className="mt-3 text-[14px] text-ink-700">照片还不够玩</p>
        <p className="mt-1 text-[12px] text-ink-400">至少需要 2 张带缩略图的照片。</p>
        <Link to="/album" className="btn-ghost mt-4 inline-flex px-3 py-1.5 text-[12.5px]">
          去看相册
        </Link>
      </div>
    )
  }

  const elapsed = startedAt ? (done ? now - startedAt : (now || Date.now()) - startedAt) : 0

  return (
    <div className="mx-auto max-w-[560px] pb-6">
      <header className="text-center">
        <h1 className="text-[18px] font-semibold text-ink-900">记忆配对</h1>
        <p className="mx-auto mt-1 max-w-[400px] text-[12px] leading-relaxed text-ink-500">
          翻开两张，是同一张照片就留下。一共 {board.pairCount} 对，全部配对成功即通关。
          <span className="text-ink-400">成绩只存在这台设备的浏览器里。</span>
        </p>
      </header>

      <div className="mt-3 flex items-center justify-center gap-3 text-[12px] text-ink-600">
        <span className="inline-flex items-center gap-1">
          <Sparkles size={12} className="text-rose-deep" /> 步数 {moves}
        </span>
        <span className="inline-flex items-center gap-1">
          <Timer size={12} className="text-rose-deep" /> {fmtDuration(elapsed)}
        </span>
        <span className="inline-flex items-center gap-1 text-ink-500">
          <Trophy size={12} className="text-[#C9A227]" />
          {record ? `最佳 ${record.bestMoves} 步 / ${fmtDuration(record.bestMs)}` : '还没有成绩'}
        </span>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2 sm:gap-2.5 md:grid-cols-4">
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
              className={`relative aspect-square overflow-hidden rounded-xl border transition ${
                isMatched
                  ? 'border-[#CFE0C6] bg-[#F2F7EF] opacity-95'
                  : isFlipped
                    ? 'border-rose-soft/60 bg-white'
                    : 'border-cream-200 bg-[#FFF3EC] hover:bg-[#FFEDE1]'
              }`}
              style={{ touchAction: 'manipulation' }}
            >
              {isFlipped ? (
                <img
                  src={card.thumb}
                  alt={card.label}
                  loading="lazy"
                  draggable={false}
                  className="h-full w-full object-cover"
                />
              ) : (
                <span className="flex h-full w-full items-center justify-center">
                  <Heart size={18} className="text-rose-soft" fill="currentColor" />
                </span>
              )}
              {isMatched && (
                <span className="absolute right-1 top-1 rounded-full bg-white/85 px-1.5 py-0.5 text-[10px] text-[#4F6B45]">
                  配对
                </span>
              )}
            </button>
          )
        })}
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
        <button
          type="button"
          onClick={restart}
          className="btn-ghost inline-flex items-center gap-1.5 px-3 py-1.5 text-[12.5px]"
        >
          <RotateCcw size={13} /> 重新开始
        </button>
        {record && <span className="text-[11.5px] text-ink-400">已通关 {record.clears} 次</span>}
      </div>

      {done && (
        <div className="mt-4 rounded-2xl border border-[#CFE0C6] bg-[#F2F7EF] px-4 py-3 text-center">
          <p className="text-[14px] font-medium text-[#3F5F3A]">
            {isBest ? '新纪录！' : '全部配对完成'}
          </p>
          <p className="mt-1 text-[12px] text-[#4F6B45]">
            {moves} 步 · {fmtDuration(elapsed)}
            {record && !isBest ? ` · 最佳仍是 ${record.bestMoves} 步` : ''}
          </p>
          <p className="mt-1 text-[11.5px] text-[#6C8567]">
            这里的成绩只保存在本机浏览器，不会写到作者的数据里，也不影响展示内容。
          </p>
          <button type="button" onClick={restart} className="btn-primary mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 text-[12.5px]">
            <RotateCcw size={13} /> 再玩一次
          </button>
        </div>
      )}
    </div>
  )
}
