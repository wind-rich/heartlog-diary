import type { ReactNode } from 'react'
import { ArrowRight } from 'lucide-react'
import clsx from 'clsx'
import { Link } from 'react-router-dom'

export function SectionHead({
  title,
  hint,
  eyebrow,
  to,
  actionLabel = '查看全部',
}: {
  title: string
  hint?: string
  eyebrow?: string
  to?: string
  actionLabel?: string
}) {
  return (
    <div className="v-section-head">
      <div className="min-w-0">
        {eyebrow && <div className="v-eyebrow">{eyebrow}</div>}
        <h2 className="v-section-title">{title}</h2>
        {hint && <p className="v-section-hint">{hint}</p>}
      </div>
      {to && (
        <Link to={to} className="v-section-action">
          {actionLabel}
          <ArrowRight size={13} />
        </Link>
      )}
    </div>
  )
}

export function Pill({
  children,
  tone = 'neutral',
  className,
}: {
  children: ReactNode
  tone?: 'neutral' | 'rose' | 'warn' | 'ok'
  className?: string
}) {
  const tones = {
    neutral: 'border-cream-300 bg-white text-ink-500',
    rose: 'border-rose-soft/50 bg-rose-soft/12 text-rose-deep',
    warn: 'border-amber-200 bg-amber-50 text-amber-700',
    ok: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  }
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] leading-normal',
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  )
}

export function EmptyState({
  icon,
  title,
  desc,
  compact,
}: {
  icon?: ReactNode
  title: string
  desc?: string
  compact?: boolean
}) {
  return (
    <div
      className={clsx(
        'flex flex-col items-center justify-center rounded-2xl border border-dashed border-cream-300 bg-white/60 text-center',
        compact ? 'px-4 py-6' : 'px-6 py-12',
      )}
    >
      {icon && <div className="mb-2 text-ink-300">{icon}</div>}
      <div className="text-[13px] font-medium text-ink-700">{title}</div>
      {desc && <div className="mt-1 max-w-[280px] text-[11.5px] leading-relaxed text-ink-500">{desc}</div>}
    </div>
  )
}

/** 示例数据标记：所有原型内容都带这个提示，避免与真实发布内容混淆 */
export function SampleBadge({ className }: { className?: string }) {
  return (
    <span
      className={clsx(
        'inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border border-[#E7C9A8]/60 bg-[#FFF1E0] px-2 py-0.5 text-[10.5px] font-medium text-[#9A6B3F]',
        className,
      )}
    >
      示例数据
    </span>
  )
}
