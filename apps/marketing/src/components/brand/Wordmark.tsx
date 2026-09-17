/**
 * Wordmark — the draftLegal brand wordmark.
 *
 *   draft   slate-700 / medium — graphite pencil gray, the
 *                                "work-in-progress" half
 *   Legal   emerald-700 / bold — authoritative, the
 *                                "signed and final" half
 *
 * The color split is the brand: drafts (gray, in-flux) become legally
 * binding (green, final). Mirrors apps/web/src/components/brand/Wordmark.tsx
 * so the marketing site reads identically to the product.
 *
 * `kind="full"` shows "draftLegal"; `kind="mark"` shows just "dL"
 * for tight spaces.
 */
import { cn } from '@/lib/utils'

type Size = 'sm' | 'md' | 'lg' | 'xl' | '2xl'

const SIZE: Record<Size, string> = {
  sm: 'text-sm',
  md: 'text-base',
  lg: 'text-lg',
  xl: 'text-xl',
  '2xl': 'text-2xl',
}

export function Wordmark({
  size = 'md',
  kind = 'full',
  className,
}: {
  size?: Size
  kind?: 'full' | 'mark'
  className?: string
}) {
  const draft = kind === 'full' ? 'draft' : 'd'
  const legal = kind === 'full' ? 'Legal' : 'L'
  return (
    <span
      className={cn('inline-flex tracking-tight select-none', SIZE[size], className)}
      aria-label="draftLegal"
    >
      <span className="font-medium text-slate-700">{draft}</span>
      <span className="font-bold text-emerald-700">{legal}</span>
    </span>
  )
}
