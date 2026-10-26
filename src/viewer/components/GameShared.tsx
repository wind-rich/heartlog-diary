import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowLeft, Image as ImageIcon } from 'lucide-react'
import type { PublicPhoto } from '../types'
import { useSnapshot } from '../state/SnapshotContext'
import { relatedEntryForPhoto } from '../game/memoryBox'
import { Lightbox } from './Photos'

export function GameHeader({ title, description, aside }: { title: string; description: string; aside?: ReactNode }) {
  return (
    <header className="px-1">
      <Link to="/game" className="inline-flex min-h-11 items-center gap-1.5 text-[12px] text-ink-500 hover:text-rose-deep">
        <ArrowLeft size={14} /> 返回互动大厅
      </Link>
      <div className="mt-1 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-[19px] font-semibold text-ink-900">{title}</h1>
          <p className="mt-1 max-w-[540px] text-[12px] leading-relaxed text-ink-500">{description}</p>
        </div>
        {aside}
      </div>
    </header>
  )
}

/** 只关联当前公开快照里仍存在的记录；无关联时只提供完整照片。 */
export function PhotoMemoryLinks({ photo }: { photo: PublicPhoto }) {
  const snapshot = useSnapshot()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const entry = relatedEntryForPhoto(photo, snapshot.entries)
  return (
    <>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <button type="button" onClick={() => setOpen(true)} className="btn-ghost inline-flex min-h-11 items-center gap-1.5 px-3 text-[12px]">
          <ImageIcon size={14} /> 查看完整照片
        </button>
        {entry && (
          <Link to={`/stories/${entry.id}`} className="btn-ghost inline-flex min-h-11 items-center px-3 text-[12px]">
            看看这段回忆
          </Link>
        )}
      </div>
      {open && (
        <Lightbox
          photos={[photo]}
          index={0}
          onClose={() => setOpen(false)}
          onIndexChange={() => undefined}
          onOpenEntry={entry ? (id) => {
            setOpen(false)
            navigate(`/stories/${id}`)
          } : undefined}
        />
      )}
    </>
  )
}

/** 有效计时：切后台或打开阻断弹层时暂停，离开页面自动清理。 */
export function useGameTimer(active: boolean, resetKey: string | number): number {
  const [elapsed, setElapsed] = useState(0)
  const total = useRef(0)

  useEffect(() => {
    total.current = 0
    setElapsed(0)
  }, [resetKey])

  useEffect(() => {
    if (!active) return
    let last = Date.now()
    const tick = () => {
      const now = Date.now()
      if (!document.hidden) {
        total.current += Math.max(0, now - last)
        setElapsed(total.current)
      }
      last = now
    }
    const onVisibility = () => {
      last = Date.now()
    }
    const timer = window.setInterval(tick, 250)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      tick()
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [active])

  return elapsed
}

export function GameResult({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-[#CFE0C6] bg-[#F2F7EF] px-4 py-4 text-center" aria-live="polite">
      <h2 className="text-[15px] font-medium text-[#3F5F3A]">{title}</h2>
      <div className="mt-1 text-[12px] leading-relaxed text-[#4F6B45]">{children}</div>
    </section>
  )
}
