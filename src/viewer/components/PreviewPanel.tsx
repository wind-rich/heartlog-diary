import { useEffect, useRef, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, X } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

interface Props {
  title: string
  subtitle?: string
  icon: LucideIcon
  accent: string
  onClose: () => void
  /** 「查看全部」跳转路径；缺失表示这一类没有独立列表页 */
  allHref?: string
  allLabel?: string
  children: ReactNode
}

/**
 * 节点预览面板。
 * 手机：底部面板；桌面：右侧面板。Esc / 点击背景关闭，关闭后焦点回到触发节点。
 */
export function PreviewPanel({ title, subtitle, icon: Icon, accent, onClose, allHref, allLabel = '查看全部', children }: Props) {
  const panelRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null
    closeRef.current?.focus()

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'Tab' && panelRef.current) {
        const nodes = panelRef.current.querySelectorAll<HTMLElement>(
          'button, a[href], input, [tabindex]:not([tabindex="-1"])',
        )
        if (!nodes.length) return
        const first = nodes[0]
        const last = nodes[nodes.length - 1]
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault()
          last.focus()
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }
    document.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
      prev?.focus?.()
    }
  }, [onClose])

  return (
    <div className="fixed inset-0 z-[70] flex items-end md:items-stretch md:justify-end" role="dialog" aria-modal="true" aria-label={`${title}预览`}>
      <button
        type="button"
        aria-label="关闭预览"
        onClick={onClose}
        className="v-fade absolute inset-0 cursor-default bg-[#151827]/50 backdrop-blur-[2px]"
        tabIndex={-1}
      />

      <div
        ref={panelRef}
        className="v-preview-panel v-panel-responsive relative flex max-h-[78vh] w-full flex-col overflow-hidden rounded-t-3xl shadow-pop md:max-h-none md:h-full md:w-[400px] md:rounded-none"
      >
        <div className="v-preview-head flex items-start gap-3 px-4 pb-3 pt-4">
          <span
            className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
            style={{ background: `${accent}22`, color: accent }}
          >
            <Icon size={17} />
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="v-preview-title">{title}</h3>
            {subtitle && <p className="v-preview-subtitle">{subtitle}</p>}
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="关闭"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-ink-500 transition hover:bg-cream-100"
          >
            <X size={17} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">{children}</div>

        {allHref && (
          <div className="v-preview-foot px-4 py-3">
            <Link
              to={allHref}
              onClick={onClose}
              className="v-preview-all"
            >
              {allLabel}
              <ArrowRight size={14} />
            </Link>
          </div>
        )}
      </div>
    </div>
  )
}
