import { lazy, Suspense, useMemo } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Shuffle, Sparkles } from 'lucide-react'
import { useSnapshot } from '../state/SnapshotContext'
import { enabledGameIds, GAME_META, hasEnabledGames, isGameEnabled, isGameId } from '../game/config'
import { randomSeed, usablePhotos } from '../game/memory'
import { gameAvailability } from '../game/availability'
import type { GameId } from '../types'
import { GameCoverCard } from '../components/ContentBlocks'

const MemoryGame = lazy(() => import('./games/MemoryGame'))
const PuzzleGame = lazy(() => import('./games/PuzzleGame'))
const PhotoGuessGame = lazy(() => import('./games/PhotoGuessGame'))
const MemoryBoxGame = lazy(() => import('./games/MemoryBoxGame'))
const TimelineGame = lazy(() => import('./games/TimelineGame'))
const QuizGame = lazy(() => import('./games/QuizGame'))
const DateDrawGame = lazy(() => import('./games/DateDrawGame'))
const TreasureGame = lazy(() => import('./games/TreasureGame'))

const GAME_COMPONENTS: Record<GameId, typeof MemoryGame> = {
  memory: MemoryGame,
  puzzle: PuzzleGame,
  photoGuess: PhotoGuessGame,
  memoryBox: MemoryBoxGame,
  timeline: TimelineGame,
  quiz: QuizGame,
  dateDraw: DateDrawGame,
  treasure: TreasureGame,
}

function LoadingGame() {
  return <div className="v-paper-section mx-auto max-w-[560px] px-4 py-10 text-center text-[13px] text-[#666174]">正在打开玩法…</div>
}

function GameDisabled({ reason, canGoHall }: { reason: string; canGoHall: boolean }) {
  return (
    <div className="mx-auto max-w-[520px] py-16 text-center">
      <Sparkles size={22} className="mx-auto text-[#8A759E]" />
      <p className="mt-3 text-[15px] text-[#292635]">这个互动没有开启</p>
      <p className="mt-1 text-[13px] leading-relaxed text-[#666174]">{reason}</p>
      <Link to={canGoHall ? '/game' : '/'} className="btn-ghost mt-4 inline-flex min-h-11 items-center px-3 text-[12.5px]">
        {canGoHall ? '返回互动大厅' : '回到首页'}
      </Link>
    </div>
  )
}

export default function GamePage() {
  const snapshot = useSnapshot()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const enabled = enabledGameIds(snapshot.config)
  const photoCount = usablePhotos(snapshot.photos).length
  const requested = searchParams.get('play')
  const availability = useMemo(
    () => Object.fromEntries(enabled.map((id) => [id, gameAvailability(id, snapshot, photoCount)])) as Record<GameId, { ok: boolean; text: string }>,
    [enabled, snapshot, photoCount],
  )
  const playable = enabled.filter((id) => availability[id]?.ok)

  if (requested && isGameId(requested)) {
    if (!isGameEnabled(snapshot.config, requested)) {
      return <GameDisabled reason="作者没有在这一版发布中开启它；旧版快照也不会因为升级而自动开放新玩法。" canGoHall={enabled.length > 0} />
    }
    const Component = GAME_COMPONENTS[requested]
    return <Suspense fallback={<LoadingGame />}><Component /></Suspense>
  }

  if (!hasEnabledGames(snapshot.config)) {
    return <GameDisabled reason="作者可以在设置里选择要开放的互动，并重新发布到展示端。" canGoHall={false} />
  }

  const pickRandom = () => {
    if (!playable.length) return
    const id = playable[parseInt(randomSeed().slice(0, 8), 16) % playable.length]
    navigate(`/game?play=${id}`)
  }

  return (
    <div className="mx-auto max-w-[1080px] space-y-7 pb-6">
      <header className="v-game-intro">
        <div>
          <div className="v-eyebrow">A LITTLE PLAY, A LITTLE MEMORY</div>
          <h1>回忆游乐园</h1>
          <p>把已经公开的照片、回忆和作者写下的内容，变成一点小小的快乐。成绩只存在这台设备。</p>
        </div>
        <button type="button" onClick={pickRandom} disabled={!playable.length} className="btn-primary inline-flex min-h-11 shrink-0 items-center gap-2 px-4 text-[13px] disabled:opacity-40">
          <Shuffle size={15} /> 随便玩一个
        </button>
      </header>

      {!playable.length && (
        <div className="rounded-2xl border border-dashed border-[#D8D0C8] bg-[#FFFDFA]/70 px-4 py-8 text-center">
          <p className="text-[13px] font-medium text-[#292635]">暂时还没有可玩的内容</p>
          <p className="mt-1 text-[12px] text-[#666174]">已开启的玩法素材不足；可以先去相册或故事页看看。</p>
        </div>
      )}

      <div className="v-game-grid">
        {enabled.map((id) => {
          const meta = GAME_META[id]
          const state = availability[id]
          return <GameCoverCard key={id} id={id} title={meta.title} description={meta.description} duration={meta.duration} stateText={state.text} available={state.ok} />
        })}
      </div>
    </div>
  )
}
