import { lazy, Suspense, useMemo } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Image as ImageIcon, Images, Puzzle, Shuffle, Sparkles, Star } from 'lucide-react'
import { useSnapshot } from '../state/SnapshotContext'
import { enabledGameIds, GAME_META, hasEnabledGames, isGameEnabled, isGameId } from '../game/config'
import { randomSeed, usablePhotos } from '../game/memory'
import type { GameId } from '../types'

const MemoryGame = lazy(() => import('./games/MemoryGame'))
const PuzzleGame = lazy(() => import('./games/PuzzleGame'))
const PhotoGuessGame = lazy(() => import('./games/PhotoGuessGame'))
const MemoryBoxGame = lazy(() => import('./games/MemoryBoxGame'))

const GAME_COMPONENTS: Record<GameId, typeof MemoryGame> = {
  memory: MemoryGame,
  puzzle: PuzzleGame,
  photoGuess: PhotoGuessGame,
  memoryBox: MemoryBoxGame,
}

const GAME_ICONS: Record<GameId, typeof Puzzle> = {
  memory: Images,
  puzzle: Puzzle,
  photoGuess: ImageIcon,
  memoryBox: Star,
}

function LoadingGame() {
  return <div className="mx-auto max-w-[560px] rounded-2xl border border-cream-200 bg-white/70 px-4 py-10 text-center text-[12px] text-ink-400">正在打开玩法…</div>
}

function GameDisabled({ reason, canGoHall }: { reason: string; canGoHall: boolean }) {
  return (
    <div className="mx-auto max-w-[520px] py-16 text-center">
      <Sparkles size={22} className="mx-auto text-rose-soft" />
      <p className="mt-3 text-[14px] text-ink-700">这个互动没有开启</p>
      <p className="mt-1 text-[12px] leading-relaxed text-ink-400">{reason}</p>
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

  const playable = useMemo(
    () => enabled.filter((id) => photoCount >= GAME_META[id].minPhotos),
    [enabled, photoCount],
  )

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
    <div className="mx-auto max-w-[760px] space-y-5 pb-6">
      <header className="text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-rose-soft/15 text-rose-deep">
          <Sparkles size={22} />
        </div>
        <h1 className="mt-3 text-[20px] font-semibold text-ink-900">回忆游乐园</h1>
        <p className="mx-auto mt-1 max-w-[480px] text-[12px] leading-relaxed text-ink-500">
          用已经公开的照片玩一点轻松的小互动。成绩只存在这台设备；中途退出只会丢掉本局进度。
        </p>
        <button
          type="button"
          onClick={pickRandom}
          disabled={!playable.length}
          className="btn-primary mt-4 inline-flex min-h-11 items-center gap-2 px-4 text-[13px] disabled:opacity-40"
        >
          <Shuffle size={15} /> 随便玩一个
        </button>
      </header>

      {!playable.length && (
        <div className="rounded-2xl border border-dashed border-cream-300 bg-white/60 px-4 py-8 text-center">
          <p className="text-[13px] font-medium text-ink-700">暂时还没有可玩的内容</p>
          <p className="mt-1 text-[12px] text-ink-500">已开启的玩法素材不足；可以先去相册或故事页看看。</p>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        {enabled.map((id) => {
          const meta = GAME_META[id]
          const Icon = GAME_ICONS[id]
          const enough = photoCount >= meta.minPhotos
          const card = (
            <article className={`h-full rounded-2xl border p-4 transition ${enough ? 'border-cream-200 bg-white/80 hover:border-rose-soft/60 hover:shadow-sm' : 'border-dashed border-cream-300 bg-white/50'}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-rose-soft/15 text-rose-deep"><Icon size={19} /></div>
                <span className={`rounded-full px-2 py-0.5 text-[10.5px] ${enough ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>{enough ? '可玩' : '素材不足'}</span>
              </div>
              <h2 className="mt-3 text-[15px] font-semibold text-ink-900">{meta.title}</h2>
              <p className="mt-1 min-h-[36px] text-[12px] leading-relaxed text-ink-500">{meta.description}</p>
              <div className="mt-3 flex items-center justify-between text-[11px] text-ink-400">
                <span>{meta.duration}</span>
                <span>{enough ? `需要 ${meta.minPhotos} 张照片` : `当前 ${photoCount} / 需要 ${meta.minPhotos}`}</span>
              </div>
            </article>
          )
          return enough ? (
            <Link key={id} to={`/game?play=${id}`} className="block rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-deep">{card}</Link>
          ) : (
            <div key={id} aria-disabled="true" className="cursor-not-allowed">{card}</div>
          )
        })}
      </div>
    </div>
  )
}
