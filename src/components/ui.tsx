import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { Check, Info, Star, X } from 'lucide-react'
import clsx from 'clsx'
import { ensurePhotoUrl } from '../lib/photo'

/* ------------------------------------------------------------------ */
/* Toast                                                               */
/* ------------------------------------------------------------------ */

type ToastKind = 'ok' | 'err' | 'info'
interface ToastItem {
  id: number
  kind: ToastKind
  text: string
}
const ToastCtx = createContext<(text: string, kind?: ToastKind) => void>(() => undefined)
export const useToast = () => useContext(ToastCtx)

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const push = useCallback((text: string, kind: ToastKind = 'ok') => {
    const id = Date.now() + Math.random()
    setItems((prev) => [...prev, { id, kind, text }])
    setTimeout(() => setItems((prev) => prev.filter((i) => i.id !== id)), 3200)
  }, [])
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="fixed left-1/2 -translate-x-1/2 bottom-[calc(74px+var(--safe-bottom))] z-[80] flex flex-col items-center gap-2 px-4 w-full max-w-md pointer-events-none">
        {items.map((i) => (
          <div
            key={i.id}
            className={clsx(
              'animate-fade-up rounded-full px-4 py-2.5 text-[14px] shadow-pop flex items-center gap-2 max-w-full',
              i.kind === 'ok' && 'bg-ink-900 text-white',
              i.kind === 'err' && 'bg-[#B23A2C] text-white',
              i.kind === 'info' && 'bg-white text-ink-700 border border-cream-300',
            )}
          >
            {i.kind === 'ok' && <Check size={15} />}
            {i.kind === 'info' && <Info size={15} />}
            <span className="truncate">{i.text}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  )
}

/* ------------------------------------------------------------------ */
/* Confirm                                                             */
/* ------------------------------------------------------------------ */

interface ConfirmOptions {
  title: string
  desc?: string
  danger?: boolean
  confirmText?: string
  cancelText?: string
}
const ConfirmCtx = createContext<(o: ConfirmOptions) => Promise<boolean>>(async () => false)
export const useConfirm = () => useContext(ConfirmCtx)

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<{ o: ConfirmOptions; resolve: (v: boolean) => void } | null>(null)

  const ask = useCallback(
    (o: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        setState({ o, resolve })
      }),
    [],
  )

  const done = (v: boolean) => {
    state?.resolve(v)
    setState(null)
  }

  return (
    <ConfirmCtx.Provider value={ask}>
      {children}
      <Modal open={!!state} onClose={() => done(false)} title={state?.o.title ?? ''} maxWidth="max-w-sm">
        {state?.o.desc && <p className="text-[14px] text-ink-700 leading-relaxed whitespace-pre-line">{state.o.desc}</p>}
        <div className="flex gap-2 mt-5">
          <button className="btn-ghost flex-1" onClick={() => done(false)}>
            {state?.o.cancelText || '取消'}
          </button>
          <button
            className={clsx('flex-1', state?.o.danger ? 'btn bg-[#C6452F] text-white' : 'btn-primary')}
            onClick={() => done(true)}
          >
            {state?.o.confirmText || '确定'}
          </button>
        </div>
      </Modal>
    </ConfirmCtx.Provider>
  )
}

/* ------------------------------------------------------------------ */
/* Modal / Sheet                                                       */
/* ------------------------------------------------------------------ */

interface ModalProps {
  open: boolean
  onClose: () => void
  title?: React.ReactNode
  children?: React.ReactNode
  footer?: React.ReactNode
  maxWidth?: string
  /** 底部弹出（手机友好） */
  sheet?: boolean
  full?: boolean
}

export function Modal({ open, onClose, title, children, footer, maxWidth = 'max-w-lg', sheet = true, full }: ModalProps) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prev
      window.removeEventListener('keydown', onKey)
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[70] flex sm:items-center sm:justify-center items-end justify-center">
      <div className="absolute inset-0 bg-[#4A3B31]/40 backdrop-blur-[2px]" onClick={onClose} />
      <div
        ref={ref}
        className={clsx(
          'relative w-full bg-cream-50 flex flex-col shadow-pop animate-fade-up sm:animate-none',
          sheet ? 'rounded-t-3xl sm:rounded-3xl' : 'rounded-3xl',
          maxWidth,
          'sm:max-h-[88vh]',
          full ? 'h-[94vh]' : 'max-h-[92vh]',
          'sm:mx-4',
        )}
        style={{ paddingBottom: 'var(--safe-bottom)' }}
      >
        {sheet && <div className="sm:hidden pt-2.5 pb-1 flex justify-center"><div className="w-10 h-1 rounded-full bg-cream-300" /></div>}
        {(title || !sheet) && (
          <div className="flex items-center gap-3 px-4 pt-3 pb-3 border-b border-cream-200">
            <div className="text-[17px] font-semibold text-ink-900 flex-1 min-w-0 truncate">{title}</div>
            <button
              onClick={onClose}
              aria-label="关闭"
              className="w-8 h-8 rounded-full bg-cream-200 text-ink-500 flex items-center justify-center hover:bg-cream-300 shrink-0"
            >
              <X size={16} />
            </button>
          </div>
        )}
        <div className="flex-1 overflow-y-auto px-4 py-4">{children}</div>
        {footer && <div className="px-4 py-3 border-t border-cream-200 bg-cream-50">{footer}</div>}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* 表单                                                                */
/* ------------------------------------------------------------------ */

export function Field({
  label,
  hint,
  required,
  children,
  className,
}: {
  label?: React.ReactNode
  hint?: React.ReactNode
  required?: boolean
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={clsx('mb-3.5', className)}>
      {label && (
        <label className="label">
          {label}
          {required && <span className="text-rose-deep ml-0.5">*</span>}
        </label>
      )}
      {children}
      {hint && <p className="mt-1 text-[12px] text-ink-300 leading-snug">{hint}</p>}
    </div>
  )
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  className,
}: {
  options: { value: T; label: string }[]
  value: T
  onChange: (v: T) => void
  className?: string
}) {
  return (
    <div className={clsx('inline-flex p-1 rounded-xl bg-cream-100 border border-cream-200', className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={clsx(
            'px-3.5 py-1.5 rounded-lg text-[13.5px] transition',
            value === o.value ? 'bg-white text-ink-900 font-medium shadow-sm' : 'text-ink-500',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Chips({
  options,
  value,
  onChange,
  multi = false,
  allowCustom = false,
}: {
  options: { value: string; label: string; emoji?: string }[]
  value: string | string[]
  onChange: (v: string | string[]) => void
  multi?: boolean
  allowCustom?: boolean
}) {
  const [custom, setCustom] = useState('')
  const selected = (Array.isArray(value) ? value : [value]).filter(Boolean)
  const toggle = (v: string) => {
    if (multi) {
      const arr = Array.isArray(value) ? [...value] : []
      const i = arr.indexOf(v)
      if (i >= 0) arr.splice(i, 1)
      else arr.push(v)
      onChange(arr)
    } else {
      onChange(v)
    }
  }
  const extra = multi ? selected.filter((s) => !options.some((o) => o.value === s)) : []
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => {
        const on = selected.includes(o.value)
        return (
          <button key={o.value} type="button" className={on ? 'chip-on' : 'chip-off'} onClick={() => toggle(o.value)}>
            {o.emoji && <span>{o.emoji}</span>}
            {o.label}
          </button>
        )
      })}
      {extra.map((e) => (
        <button key={e} type="button" className="chip-on" onClick={() => toggle(e)}>
          {e} <X size={12} />
        </button>
      ))}
      {allowCustom && multi && (
        <div className="inline-flex items-center gap-1">
          <input
            className="chip-off w-24 outline-none focus:border-rose-soft"
            placeholder="自定义标签"
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && custom.trim()) {
                e.preventDefault()
                toggle(custom.trim())
                setCustom('')
              }
            }}
          />
        </div>
      )}
    </div>
  )
}

export function Stars({
  value,
  onChange,
  max = 5,
  readOnly = false,
}: {
  value?: number
  onChange?: (v: number | undefined) => void
  max?: number
  readOnly?: boolean
}) {
  return (
    <div className="flex items-center gap-1">
      {Array.from({ length: max }).map((_, i) => {
        const n = i + 1
        const on = (value ?? 0) >= n
        return (
          <button
            key={n}
            type="button"
            disabled={readOnly}
            onClick={() => onChange?.(value === n ? undefined : n)}
            className={clsx('p-0.5 transition', readOnly && 'cursor-default')}
            aria-label={`${n} 分`}
          >
            <Star size={20} className={on ? 'fill-[#E9B44C] text-[#E9B44C]' : 'text-cream-300'} />
          </button>
        )
      })}
      {!readOnly && value != null && (
        <button type="button" className="ml-1 text-[12px] text-ink-300" onClick={() => onChange?.(undefined)}>
          清除
        </button>
      )}
    </div>
  )
}

export function Switch({
  checked,
  onChange,
  label,
  desc,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: React.ReactNode
  desc?: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="w-full flex items-start gap-3 text-left py-2.5"
    >
      <div className="flex-1 min-w-0">
        <div className="text-[15px] text-ink-900">{label}</div>
        {desc && <div className="text-[12.5px] text-ink-300 mt-0.5 leading-snug">{desc}</div>}
      </div>
      <div
        className={clsx(
          'w-11 h-6.5 rounded-full shrink-0 mt-0.5 relative transition',
          checked ? 'bg-rose-deep' : 'bg-cream-300',
        )}
        style={{ height: 26, width: 46 }}
      >
        <div
          className="absolute top-[3px] w-5 h-5 rounded-full bg-white shadow transition-all"
          style={{ left: checked ? 23 : 3 }}
        />
      </div>
    </button>
  )
}

/* ------------------------------------------------------------------ */
/* 展示                                                                */
/* ------------------------------------------------------------------ */

export function Empty({
  icon,
  title,
  desc,
  action,
}: {
  icon?: React.ReactNode
  title: string
  desc?: string
  action?: React.ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-12 px-6">
      {icon && <div className="text-cream-300 mb-3">{icon}</div>}
      <div className="text-[15px] text-ink-700 font-medium">{title}</div>
      {desc && <div className="text-[13px] text-ink-300 mt-1.5 leading-relaxed max-w-xs whitespace-pre-line">{desc}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

export function Tag({ children, color, soft = true }: { children: React.ReactNode; color?: string; soft?: boolean }) {
  const c = color || '#B9ADA2'
  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-0.5 text-[11.5px] leading-5"
      style={soft ? { background: `${c}22`, color: c } : { background: c, color: '#fff' }}
    >
      {children}
    </span>
  )
}

export function SectionCard({
  title,
  action,
  children,
  className,
}: {
  title?: React.ReactNode
  action?: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    <section className={clsx('card card-pad', className)}>
      {(title || action) && (
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-[15px] font-semibold text-ink-900 flex items-center gap-1.5">{title}</h2>
          {action}
        </div>
      )}
      {children}
    </section>
  )
}

export function ListRow({
  left,
  title,
  desc,
  right,
  onClick,
}: {
  left?: React.ReactNode
  title: React.ReactNode
  desc?: React.ReactNode
  right?: React.ReactNode
  onClick?: () => void
}) {
  const Comp = onClick ? 'button' : 'div'
  return (
    <Comp
      onClick={onClick}
      className={clsx('w-full flex items-center gap-3 py-3 text-left', onClick && 'active:bg-cream-100 rounded-xl')}
    >
      {left}
      <div className="flex-1 min-w-0">
        <div className="text-[15px] text-ink-900 truncate">{title}</div>
        {desc && <div className="text-[12.5px] text-ink-300 mt-0.5 truncate">{desc}</div>}
      </div>
      {right}
    </Comp>
  )
}

/* ------------------------------------------------------------------ */
/* 照片                                                                */
/* ------------------------------------------------------------------ */

export function PhotoImg({
  photoId,
  kind = 'thumb',
  className,
  alt,
  onClick,
}: {
  photoId: string
  kind?: 'thumb' | 'full'
  className?: string
  alt?: string
  onClick?: () => void
}) {
  const [url, setUrl] = useState<string | undefined>(() => undefined)
  useEffect(() => {
    let alive = true
    ensurePhotoUrl(photoId, kind).then((u) => {
      if (alive) setUrl(u)
    })
    return () => {
      alive = false
    }
  }, [photoId, kind])

  if (!url) {
    return <div className={clsx('bg-cream-200 animate-pulse', className)} />
  }
  return <img src={url} alt={alt || '照片'} className={className} onClick={onClick} loading="lazy" />
}

export function Avatar({
  photoId,
  name,
  size = 64,
  className,
}: {
  photoId?: string
  name?: string
  size?: number
  className?: string
}) {
  const initial = (name || 'TA').trim().slice(0, 1) || 'TA'
  if (photoId) {
    return (
      <div className={clsx('rounded-full overflow-hidden bg-cream-200 shrink-0', className)} style={{ width: size, height: size }}>
        <PhotoImg photoId={photoId} className="w-full h-full object-cover" alt={name || '头像'} />
      </div>
    )
  }
  return (
    <div
      className={clsx('rounded-full bg-cream-200 text-rose-deep flex items-center justify-center font-semibold shrink-0', className)}
      style={{ width: size, height: size, fontSize: size * 0.4 }}
    >
      {initial}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* 轻量 Markdown 渲染（用于报告预览）                                   */
/* ------------------------------------------------------------------ */

function inline(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
    .replace(/\[(E\d+)\]/g, '<span class="text-rose-deep text-[12px]">[$1]</span>')
}

export function Markdown({ text, className }: { text: string; className?: string }) {
  const html = useMemo(() => {
    const lines = (text || '').split('\n')
    const out: string[] = []
    let inList: 'ul' | 'ol' | null = null
    let inTable = false
    let tableRows: string[][] = []

    const closeList = () => {
      if (inList) {
        out.push(`</${inList}>`)
        inList = null
      }
    }
    const flushTable = () => {
      if (!inTable) return
      const [head, ...body] = tableRows
      out.push(
        `<table><thead><tr>${(head ?? []).map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${body
          .map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`)
          .join('')}</tbody></table>`,
      )
      inTable = false
      tableRows = []
    }

    for (const raw of lines) {
      const line = raw.replace(/\s+$/, '')
      if (/^\s*\|.*\|\s*$/.test(line)) {
        const cells = line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim())
        if (cells.every((c) => /^:?-{2,}:?$/.test(c))) continue
        closeList()
        inTable = true
        tableRows.push(cells)
        continue
      }
      if (inTable) flushTable()

      if (!line.trim()) {
        closeList()
        continue
      }
      const h = /^(#{1,6})\s+(.*)$/.exec(line)
      if (h) {
        closeList()
        out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`)
        continue
      }
      if (/^(-{3,}|\*{3,})$/.test(line.trim())) {
        closeList()
        out.push('<hr/>')
        continue
      }
      const q = /^>\s?(.*)$/.exec(line)
      if (q) {
        closeList()
        out.push(`<blockquote>${inline(q[1])}</blockquote>`)
        continue
      }
      const ul = /^(\s*)[-*+]\s+(.*)$/.exec(line)
      if (ul) {
        if (inList !== 'ul') {
          closeList()
          out.push('<ul>')
          inList = 'ul'
        }
        out.push(`<li>${inline(ul[2])}</li>`)
        continue
      }
      const ol = /^(\s*)\d+[.)]\s+(.*)$/.exec(line)
      if (ol) {
        if (inList !== 'ol') {
          closeList()
          out.push('<ol>')
          inList = 'ol'
        }
        out.push(`<li>${inline(ol[2])}</li>`)
        continue
      }
      closeList()
      out.push(`<p>${inline(line)}</p>`)
    }
    closeList()
    flushTable()
    return out.join('')
  }, [text])

  return <div className={clsx('md', className)} dangerouslySetInnerHTML={{ __html: html }} />
}
