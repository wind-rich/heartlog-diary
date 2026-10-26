import type { ReactNode } from 'react'
import { useFullPhotoUrl } from '../data/cloud'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, ImageOff, RefreshCw, X } from 'lucide-react'
import clsx from 'clsx'
import type { PublicPhoto } from '../types'
import { photoDateText } from '../lib/data'

/* ------------------------------------------------------------------ */
/* 缩略图                                                              */
/* ------------------------------------------------------------------ */

interface TileProps {
  photo: PublicPhoto
  className?: string
  onClick?: () => void
  /** 首屏关键图优先加载 */
  eager?: boolean
}

export function PhotoTile({ photo, className, onClick, eager }: TileProps) {
  const [failed, setFailed] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  const retry = () => {
    setFailed(false)
    setReloadKey((k) => k + 1)
  }

  return (
    <button
      type="button"
      onClick={failed ? retry : onClick}
      className={clsx(
        'group relative block overflow-hidden rounded-xl bg-cream-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-deep/60',
        className,
      )}
      aria-label={failed ? '照片加载失败，点击重试' : photo.caption ? `查看照片：${photo.caption}` : '查看照片'}
    >
      {failed ? (
        <span className="flex h-full w-full flex-col items-center justify-center gap-1 bg-cream-100 px-2 text-center text-[11px] text-ink-500">
          <ImageOff size={16} />
          <span>加载失败</span>
          <span className="inline-flex items-center gap-1 rounded-full border border-cream-300 bg-white px-2 py-0.5 text-[11px] text-ink-700">
            <RefreshCw size={10} /> 重试
          </span>
        </span>
      ) : (
        <img
          key={reloadKey}
          src={photo.media.thumb.url}
          alt={photo.caption || '照片'}
          loading={eager ? 'eager' : 'lazy'}
          onError={() => setFailed(true)}
          className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.03]"
          draggable={false}
        />
      )}
    </button>
  )
}

/* ------------------------------------------------------------------ */
/* 大图查看                                                            */
/* ------------------------------------------------------------------ */

interface LightboxProps {
  photos: PublicPhoto[]
  index: number
  onClose: () => void
  onIndexChange: (i: number) => void
  onOpenEntry?: (entryId: string) => void
  /** 作者端才有：大图里的删除入口（渲染插槽，访客端不传） */
  renderDelete?: () => ReactNode
}

export function Lightbox({ photos, index, onClose, onIndexChange, onOpenEntry, renderDelete }: LightboxProps) {
  const photo = photos[index]
  const touchX = useRef<number | null>(null)
  // 云端模式没带图地址，按需取一次大图；静态模式直接返回原地址
  const fullUrl = useFullPhotoUrl(photo)



  const go = useCallback(
    (delta: number) => {
      const next = (index + delta + photos.length) % photos.length
      onIndexChange(next)
    },
    [index, photos.length, onIndexChange],
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowRight') go(1)
      if (e.key === 'ArrowLeft') go(-1)
    }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [go, onClose])

  if (!photo) return null

  return (
    <div
      className="v-fade fixed inset-0 z-[80] flex flex-col bg-[#140e14]/95 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="照片大图"
      onClick={onClose}
      onTouchStart={(e) => {
        touchX.current = e.touches[0].clientX
      }}
      onTouchEnd={(e) => {
        if (touchX.current === null) return
        const dx = e.changedTouches[0].clientX - touchX.current
        touchX.current = null
        if (Math.abs(dx) > 48) go(dx < 0 ? 1 : -1)
      }}
    >
      <div className="flex items-center justify-between px-4 pt-[calc(12px+env(safe-area-inset-top,0px))] text-[#F5E7DC]">
        <span className="text-[12px] tabular-nums text-[#F5E7DC]/70">
          {index + 1} / {photos.length}
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="关闭"
          className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-[#F5E7DC] transition hover:bg-white/20"
        >
          <X size={18} />
        </button>
      </div>

      <div className="relative flex min-h-0 flex-1 items-center justify-center px-3">
        <button
          type="button"
          aria-label="上一张"
          onClick={(e) => {
            e.stopPropagation()
            go(-1)
          }}
          className="absolute left-1 top-1/2 z-10 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white/80 transition hover:bg-white/20 sm:left-3"
        >
          <ChevronLeft size={20} />
        </button>
        <img
          src={fullUrl}
          alt={photo.caption || '照片'}
          onClick={(e) => e.stopPropagation()}
          className="max-h-full max-w-full rounded-lg object-contain"
          draggable={false}
        />
        <button
          type="button"
          aria-label="下一张"
          onClick={(e) => {
            e.stopPropagation()
            go(1)
          }}
          className="absolute right-1 top-1/2 z-10 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white/80 transition hover:bg-white/20 sm:right-3"
        >
          <ChevronRight size={20} />
        </button>
      </div>

      <div
        className="px-5 pb-[calc(20px+env(safe-area-inset-bottom,0px))] pt-3 text-[#F3E4D8]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-[13px] leading-relaxed">{photo.caption || '未填写说明'}</div>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[#F3E4D8]/60">
          <span>{photoDateText(photo)}</span>
          {photo.tags.map((t) => (
            <span key={t}>#{t}</span>
          ))}
          {renderDelete?.()}
          {photo.entryId && onOpenEntry && (
            <button
              type="button"
              onClick={() => onOpenEntry(photo.entryId as string)}
              className="rounded-full border border-white/25 px-2 py-0.5 text-[11px] text-[#F3E4D8]/85 transition hover:bg-white/10"
            >
              查看关联记录
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
