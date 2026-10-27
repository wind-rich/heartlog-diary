import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Compass, Eye, RotateCcw, Star } from 'lucide-react'
import { useSnapshot } from '../../state/SnapshotContext'
import { GameHeader } from '../../components/GameShared'
import {
  TREASURE_STEP_COUNT,
  currentTreasureStep,
  findTreasureHunt,
  freshTreasureProgress,
  loadTreasureProgress,
  markTreasureAssisted,
  saveTreasureProgress,
  targetTitle,
  validateTreasureTargets,
  type TreasureProgress,
} from '../../game/treasure'

export default function TreasureGame() {
  const snapshot = useSnapshot()
  const publishId = snapshot.manifest.publishId
  const hunt = findTreasureHunt(snapshot.gameContent)
  const [progress, setProgress] = useState<TreasureProgress>(() =>
    hunt ? loadTreasureProgress(publishId, hunt.id) ?? freshTreasureProgress() : freshTreasureProgress(),
  )
  const [showHint, setShowHint] = useState(false)

  useEffect(() => {
    if (hunt) saveTreasureProgress(publishId, hunt.id, progress)
  }, [hunt, progress, publishId])

  const targetErrors = useMemo(
    () => (hunt ? validateTreasureTargets(hunt, snapshot.entries, snapshot.photos) : []),
    [hunt, snapshot.entries, snapshot.photos],
  )

  if (!hunt) {
    return (
      <div className="mx-auto max-w-[620px] space-y-4">
        <GameHeader title="星球寻宝" description="这一版还没有可玩的寻宝。" />
        <div className="rounded-2xl border border-dashed border-cream-300 bg-white/70 px-4 py-8 text-center">
          <p className="text-[13px] text-ink-700">作者还没有发布寻宝关卡。</p>
          <Link to="/game" className="btn-ghost mt-3 inline-flex min-h-11 items-center px-3 text-[12px]">返回互动大厅</Link>
        </div>
      </div>
    )
  }

  if (targetErrors.length) {
    return (
      <div className="mx-auto max-w-[620px] space-y-4">
        <GameHeader title={hunt.title} description="这一关暂时走不下去了。" />
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-5 text-center">
          <p className="text-[13px] font-medium text-amber-900">线索失效，本关已停止</p>
          <p className="mt-1 text-[12px] leading-relaxed text-amber-800">发布内容发生变化，目标已不在当前版本里。不会把失效目标判为找到。</p>
          <p className="mt-2 text-[11px] text-amber-700">{targetErrors[0]}</p>
          <Link to="/game" className="btn-ghost mt-3 inline-flex min-h-11 items-center px-3 text-[12px]">返回互动大厅</Link>
        </div>
      </div>
    )
  }

  const completed = progress.stepIndex >= hunt.steps.length
  const step = currentTreasureStep(hunt, progress)
  const hint = step ? targetTitle(step.targetType, step.targetId, snapshot.entries, snapshot.photos) : null

  const assist = () => {
    setShowHint(true)
    setProgress((value) => markTreasureAssisted(value))
  }

  const restart = () => {
    const fresh = freshTreasureProgress()
    setProgress(fresh)
    setShowHint(false)
    saveTreasureProgress(publishId, hunt.id, fresh)
  }

  if (completed) {
    return (
      <div className="mx-auto max-w-[680px] space-y-4 pb-8">
        <GameHeader title={hunt.title} description={hunt.description || '三颗星已经回到同一片天空。'} />
        <section className="rounded-3xl border border-amber-200 bg-gradient-to-b from-[#FFF8EC] to-[#FDF2F4] px-5 py-8 text-center">
          <div className="relative mx-auto h-24 w-44" aria-hidden="true">
            <div className="absolute left-2 top-3 h-2 w-2 rounded-full bg-amber-300" />
            <div className="absolute right-3 top-7 h-1.5 w-1.5 rounded-full bg-rose-300" />
            <div className="absolute left-16 top-0 h-1.5 w-1.5 rounded-full bg-amber-200" />
            <svg viewBox="0 0 176 90" className="absolute inset-0 h-full w-full">
              <path d="M12 18 L84 58 L144 28 M84 58 L92 16" stroke="#E8C98A" strokeWidth="1.5" fill="none" strokeDasharray="4 4" />
            </svg>
            <Star className="absolute left-[76px] top-[46px] h-8 w-8 fill-amber-400 text-amber-500" />
          </div>
          <h2 className="mt-2 text-[20px] font-semibold text-ink-900">三颗星都找到了</h2>
          <p className="mt-2 text-[11.5px] text-ink-400">{progress.assisted ? '这次使用了求助揭晓，星星仍然点亮了。' : '这一次全靠线索找到。'}</p>
          <div className="mx-auto mt-5 max-w-[480px] rounded-2xl border border-cream-200 bg-white/80 px-4 py-4">
            <p className="text-[11px] tracking-wide text-ink-400">作者留下的完成寄语</p>
            <p className="mt-2 whitespace-pre-wrap text-[14px] leading-relaxed text-ink-800">{hunt.completionMessage}</p>
          </div>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            <button type="button" onClick={restart} className="btn-ghost inline-flex min-h-11 items-center gap-1.5 px-3 text-[12px]"><RotateCcw size={14} /> 再走一次</button>
            <Link to="/game" className="btn-primary inline-flex min-h-11 items-center px-3 text-[12px]">返回互动大厅</Link>
          </div>
        </section>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-[680px] space-y-4 pb-8">
      <GameHeader title={hunt.title} description={hunt.description || '根据线索，在故事和相册里找回三颗星。'} />
      <div className="rounded-2xl border border-cream-200 bg-white/80 px-4 py-4">
        <div className="flex items-center justify-between text-[12px] text-ink-500">
          <span>第 {Math.min(progress.stepIndex + 1, TREASURE_STEP_COUNT)} / {hunt.steps.length} 颗星</span>
          <span>{progress.assisted ? '已使用求助' : '主动探索'}</span>
        </div>
        <div className="mt-2 flex gap-1.5" aria-label={`进度 ${progress.stepIndex} / ${hunt.steps.length}`}>
          {hunt.steps.map((item, index) => (
            <span key={item.id} className={`h-1.5 flex-1 rounded-full ${index < progress.stepIndex ? 'bg-amber-400' : 'bg-cream-200'}`} />
          ))}
        </div>
      </div>

      <section className="rounded-3xl border border-amber-200 bg-[#FFF8EC] px-5 py-6">
        <div className="flex items-center gap-2 text-[11.5px] tracking-wide text-amber-700">
          <Compass size={15} /> 第 {progress.stepIndex + 1} 条线索
        </div>
        <p className="mt-3 whitespace-pre-wrap text-[17px] leading-relaxed text-ink-900">{step?.clue}</p>
        {showHint && (
          <div className="mt-4 rounded-xl border border-amber-300 bg-white/75 px-3 py-2.5 text-[12px] leading-relaxed text-amber-900">
            提示：目标更接近「{hint || '当前内容已不可用'}」。使用后仍可完成，但会标注这次用了辅助。
          </div>
        )}
        <div className="mt-5 flex flex-wrap gap-2">
          {step?.targetType === 'entry' ? (
            <Link to="/stories" className="btn-primary inline-flex min-h-11 items-center gap-1.5 px-3 text-[12px]">去故事里找 <ArrowRight size={14} /></Link>
          ) : (
            <Link to="/album" className="btn-primary inline-flex min-h-11 items-center gap-1.5 px-3 text-[12px]">去相册里找 <ArrowRight size={14} /></Link>
          )}
          {step && !showHint && (
            <button type="button" onClick={assist} className="btn-ghost inline-flex min-h-11 items-center gap-1.5 px-3 text-[12px]"><Eye size={14} /> 求助揭晓</button>
          )}
        </div>
      </section>

      <p className="px-2 text-[11.5px] leading-relaxed text-ink-400">
        浏览故事或相册时，只有目标详情会出现「这是我要找的」。单纯经过页面不会推进；离开后回来会接着当前进度。
      </p>
    </div>
  )
}
