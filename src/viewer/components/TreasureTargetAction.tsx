import { useNavigate } from 'react-router-dom'
import { Sparkles, Star } from 'lucide-react'
import { useSnapshot } from '../state/SnapshotContext'
import {
  confirmTreasureTarget,
  currentTreasureStep,
  findTreasureHunt,
  loadTreasureProgress,
  saveTreasureProgress,
} from '../game/treasure'

/** 出现在故事详情/照片大图里：只有当前寻宝步骤的目标才显示确认按钮。 */
export function TreasureTargetAction({ targetType, targetId }: { targetType: 'entry' | 'photo'; targetId: string }) {
  const snapshot = useSnapshot()
  const nav = useNavigate()
  const hunt = findTreasureHunt(snapshot.gameContent)
  if (!hunt) return null
  const progress = loadTreasureProgress(snapshot.manifest.publishId, hunt.id)
  const step = currentTreasureStep(hunt, progress)
  if (!step || step.targetType !== targetType || step.targetId !== targetId) return null

  const confirm = () => {
    const current = progress ?? { stepIndex: 0, assisted: false, updatedAt: new Date().toISOString() }
    const next = confirmTreasureTarget(hunt, current, targetType, targetId)
    saveTreasureProgress(snapshot.manifest.publishId, hunt.id, next)
    nav('/game?play=treasure')
  }

  return (
    <div className="my-3 rounded-2xl border border-amber-200 bg-amber-50/95 px-4 py-3 text-amber-900 shadow-sm">
      <div className="flex items-start gap-2">
        <Sparkles size={16} className="mt-0.5 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-[12.5px] font-medium">这颗星好像在这里</p>
          <p className="mt-0.5 text-[11.5px] leading-relaxed text-amber-800">确认后进入下一颗星；浏览页面本身不算找到。</p>
        </div>
      </div>
      <button type="button" onClick={confirm} className="btn-primary mt-2 inline-flex min-h-11 items-center gap-1.5 px-3 text-[12px]">
        <Star size={14} /> 这是我要找的
      </button>
    </div>
  )
}
