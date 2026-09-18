import * as React from 'react'
import { cn } from '@/lib/utils'

/*
 * Machine-authored content.
 *
 * One hue, one glyph, one rule: anything a model wrote is marked, and the mark
 * scales with how sure it is. Violet and the spark belong to the machine and
 * to nothing else — no button, chip or nav item outside an agent surface may
 * use them.
 */

/** The spark. Drawn, not an icon, so it never reads as clickable. */
export function AssistMark({
  confidence = 'high',
  className,
}: {
  /** low renders hollow — the mark asks to be read rather than trusted. */
  confidence?: 'high' | 'medium' | 'low'
  className?: string
}) {
  return (
    <svg
      viewBox="0 0 10 10"
      aria-hidden
      className={cn(
        'inline-block size-2 shrink-0',
        confidence === 'low' ? 'fill-none stroke-assist-600' : 'fill-assist-600',
        confidence === 'medium' && 'opacity-60',
        className
      )}
      strokeWidth={confidence === 'low' ? 1.1 : undefined}
    >
      <path d="M5 0C5.4 3.1 6.9 4.6 10 5 6.9 5.4 5.4 6.9 5 10 4.6 6.9 3.1 5.4 0 5 3.1 4.6 4.6 3.1 5 0Z" />
    </svg>
  )
}

/** Inline chip marking a machine-authored value or an agent context. */
export function AssistChip({
  children,
  icon,
  className,
}: {
  children: React.ReactNode
  icon?: React.ReactNode
  className?: string
}) {
  return (
    <span
      className={cn(
        'inline-flex w-fit items-center gap-1.5 rounded-full border border-assist-200 bg-assist-50',
        'px-2 py-0.5 text-[10.5px] font-semibold text-assist-700',
        className
      )}
    >
      {icon ?? <AssistMark className="size-[7px]" />}
      {children}
    </span>
  )
}

/**
 * AssistCard — a low-confidence suggestion that needs a human decision.
 * The violet wash is the strongest form of the mark and is the only place the
 * machine is allowed to take over a surface.
 */
export function AssistCard({
  eyebrow,
  children,
  actions,
  className,
}: {
  eyebrow?: React.ReactNode
  children: React.ReactNode
  actions?: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn('rounded-lg border border-assist-200 bg-assist-50 p-3', className)}>
      {eyebrow != null && (
        <div className="mb-2 flex items-center gap-[7px]">
          <AssistMark />
          <span className="text-[10.5px] font-bold uppercase tracking-[0.07em] text-assist-700">
            {eyebrow}
          </span>
        </div>
      )}
      <div className="text-dense leading-[1.55] text-assist-900">{children}</div>
      {actions != null && <div className="mt-2.5 flex flex-wrap gap-[7px]">{actions}</div>}
    </div>
  )
}
