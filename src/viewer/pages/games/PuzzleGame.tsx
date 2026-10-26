import { useEffect, useMemo, useRef, useState } from 'react'
import { Image as ImageIcon, Lightbulb, Play, RotateCcw, Shuffle } from 'lucide-react'
import { useSnapshot } from '../../state/SnapshotContext'
import { pickPhotos, randomSeed, usablePhotos } from '../../game/memory'
import {
  createPuzzleBoard,
  hintPuzzle,
  isPuzzleSolved,
  loadPuzzleRecord,
  PUZZLE_SIZES,
  savePuzzleRecord,
  swapPuzzlePieces,
  type PuzzleDifficulty,
  type PuzzleRecord,
} from '../../game/puzzle'
import { useFullPhotoUrl } from '../../data/cloud'
import { Lightbox } from '../../components/Photos'
import { GameHeader, GameResult, PhotoMemoryLinks, useGameTimer } from '../../components/GameShared'

export default function PuzzleGame() {
  const snapshot = useSnapshot()
  const publishId = snapshot.manifest?.publishId ?? ''
  const available = usablePhotos(snapshot.photos).length
  const [difficulty, setDifficulty] = useState<PuzzleDifficulty>('easy')
  const [started, setStarted] = useState(false)
  const [photoSeed, setPhotoSeed] = useState(() => randomSeed())
  const [boardSeed, setBoardSeed] = useState(() => randomSeed())
  const [round, setRound] = useState(0)
  const [board, setBoard] = useState<number[]>([])
  const [selected, setSelected] = useState<number | null>(null)
  const [moves, setMoves] = useState(0)
  const [hints, setHints] = useState(0)
  const [showOriginal, setShowOriginal] = useState(false)
  const [record, setRecord] = useState<PuzzleRecord | null>(null)
  const [isBest, setIsBest] = useState(false)
  const [imageFailed, setImageFailed] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const recordedRound = useRef('')
  const { rows, cols } = PUZZLE_SIZES[difficulty]
  const pieceCount = rows * cols
  const photo = useMemo(() => pickPhotos(snapshot.photos, publishId, 1, photoSeed)[0], [snapshot.photos, publishId, photoSeed])
  const fullUrl = useFullPhotoUrl(photo)
  const done = started && board.length === pieceCount && isPuzzleSolved(board)
  const elapsed = useGameTimer(started && !done && !showOriginal, `${publishId}|${difficulty}|${round}`)

  useEffect(() => setStarted(false), [publishId])
  useEffect(() => {
    if (started) setRecord(loadPuzzleRecord(publishId, difficulty))
  }, [started, publishId, difficulty])
  useEffect(() => {
    if (!done || recordedRound.current === `${publishId}|${round}`) return
    recordedRound.current = `${publishId}|${round}`
    const result = savePuzzleRecord(publishId, difficulty, { moves, ms: elapsed, hints })
    setRecord(result.record)
    setIsBest(result.isBest)
  }, [done, publishId, round, moves, elapsed, hints, difficulty])

  const begin = (changePhoto: boolean) => {
    if (changePhoto) setPhotoSeed(randomSeed())
    const nextBoardSeed = randomSeed()
    setBoardSeed(nextBoardSeed)
    setBoard(createPuzzleBoard(pieceCount, nextBoardSeed))
    setSelected(null)
    setMoves(0)
    setHints(0)
    setImageFailed(false)
    setIsBest(false)
    setRound((value) => value + 1)
    setStarted(true)
  }

  const choosePiece = (cell: number) => {
    if (done) return
    if (selected === null) { setSelected(cell); return }
    if (selected === cell) { setSelected(null); return }
    setBoard((current) => swapPuzzlePieces(current, selected, cell))
    setSelected(null)
    setMoves((value) => value + 1)
  }

  const useHint = () => {
    if (done) return
    const hint = hintPuzzle(board)
    if (!hint) return
    setBoard(hint.board)
    setSelected(null)
    setHints((value) => value + 1)
  }

  if (!available) {
    return <div className="mx-auto max-w-[560px]"><GameHeader title="拼回这一刻" description="需要至少 1 张带缩略图的已发布照片。" /><GameResult title="还没有可拼的照片">可以先返回大厅，选择素材足够的玩法。</GameResult></div>
  }

  if (!started || !photo) {
    return (
      <div className="mx-auto max-w-[560px] space-y-5">
        <GameHeader title="拼回这一刻" description="先点一块，再点另一块交换位置。不用拖拽，任意排列都能还原。" />
        <section className="rounded-2xl border border-cream-200 bg-white/75 p-4">
          <h2 className="text-[13px] font-medium text-ink-800">选择拼图难度</h2>
          <div className="mt-3 grid grid-cols-2 gap-2">
            {(['easy', 'hard'] as PuzzleDifficulty[]).map((id) => (
              <button key={id} type="button" onClick={() => { setDifficulty(id); setStarted(false) }} aria-pressed={difficulty === id} className={`min-h-11 rounded-xl border px-3 text-[12px] ${difficulty === id ? 'border-rose-soft bg-rose-soft/15 text-rose-deep' : 'border-cream-300 bg-white text-ink-600'}`}>
                {id === 'easy' ? '轻松 · 2 × 3' : '进阶 · 3 × 3'}
              </button>
            ))}
          </div>
          <button type="button" onClick={() => begin(true)} className="btn-primary mt-4 inline-flex min-h-11 items-center gap-2 px-4 text-[13px]"><Play size={15} /> 开始拼图</button>
        </section>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-[680px] space-y-4 pb-6">
      <GameHeader title="拼回这一刻" description={`${rows} × ${cols} · 已交换 ${moves} 次 · 提示 ${hints} 次${hints ? '（本局不进入无提示最佳）' : ''}`} />
      <div className="flex flex-wrap justify-center gap-2">
        <button type="button" onClick={() => setShowOriginal(true)} className="btn-ghost inline-flex min-h-11 items-center gap-1.5 px-3 text-[12px]"><ImageIcon size={14} /> 看原图</button>
        <button type="button" onClick={useHint} disabled={done} className="btn-ghost inline-flex min-h-11 items-center gap-1.5 px-3 text-[12px] disabled:opacity-40"><Lightbulb size={14} /> 提示一步</button>
        <button type="button" onClick={() => begin(false)} className="btn-ghost inline-flex min-h-11 items-center gap-1.5 px-3 text-[12px]"><RotateCcw size={14} /> 重新开始</button>
        <button type="button" onClick={() => begin(true)} className="btn-ghost inline-flex min-h-11 items-center gap-1.5 px-3 text-[12px]"><Shuffle size={14} /> 换张照片</button>
      </div>

      {imageFailed ? (
        <GameResult title="这张照片暂时没有加载成功"><button type="button" onClick={() => { setImageFailed(false); setReloadKey((value) => value + 1) }} className="btn-ghost mt-2 min-h-11 px-3">重试</button></GameResult>
      ) : (
        <div key={`${photo.id}|${reloadKey}`} className="mx-auto grid w-full max-w-[600px] gap-1 overflow-hidden rounded-2xl border border-cream-200 bg-cream-100 p-1" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, aspectRatio: photo.width && photo.height ? `${photo.width} / ${photo.height}` : '4 / 3' }} data-puzzle-board={done ? 'solved' : 'playing'}>
          {board.map((piece, cell) => {
            const pieceRow = Math.floor(piece / cols)
            const pieceCol = piece % cols
            return (
              <button
                key={cell}
                type="button"
                onClick={() => choosePiece(cell)}
                aria-label={`拼块 ${cell + 1}${selected === cell ? '，已选择' : ''}`}
                aria-pressed={selected === cell}
                data-puzzle-cell={cell}
                data-piece={piece}
                className={`relative min-h-11 overflow-hidden rounded-md border-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-deep ${selected === cell ? 'border-rose-deep' : 'border-transparent'}`}
                style={{
                  backgroundImage: `url(${JSON.stringify(fullUrl)})`,
                  backgroundSize: `${cols * 100}% ${rows * 100}%`,
                  backgroundPosition: `${cols === 1 ? 0 : (pieceCol / (cols - 1)) * 100}% ${rows === 1 ? 0 : (pieceRow / (rows - 1)) * 100}%`,
                  backgroundRepeat: 'no-repeat',
                }}
              >
                <span className="absolute bottom-1 left-1 rounded bg-black/55 px-1.5 py-0.5 text-[10px] text-white">{selected === cell ? '已选' : cell + 1}</span>
                <img key={reloadKey} src={fullUrl} alt="" onError={() => setImageFailed(true)} className="pointer-events-none absolute h-px w-px opacity-0" />
              </button>
            )
          })}
        </div>
      )}

      {done && (
        <div className="space-y-4">
          <GameResult title={isBest ? '拼完整了，也是新纪录' : '这一刻拼完整了'}>
            <p>{moves} 次交换 · {Math.floor(elapsed / 1000)} 秒 · 使用 {hints} 次提示</p>
            {record?.bestMoves !== null && record?.bestMoves !== undefined && <p className="mt-1">无提示最佳：{record.bestMoves} 次交换</p>}
            <button type="button" onClick={() => begin(true)} className="btn-primary mt-3 min-h-11 px-4 text-[12px]">再拼一张</button>
          </GameResult>
          <PhotoMemoryLinks photo={photo} />
        </div>
      )}
      {showOriginal && <Lightbox photos={[photo]} index={0} onClose={() => setShowOriginal(false)} onIndexChange={() => undefined} />}
    </div>
  )
}
