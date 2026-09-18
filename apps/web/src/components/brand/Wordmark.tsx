/**
 * Wordmark — the product mark and name.
 *
 * The mark is an open "C" with a point beside it: the contract, and the one
 * thing in it that matters. Cobalt square, white glyph; it holds at 16px.
 * `kind="mark"` renders the square alone, for the collapsed sidebar.
 */
import { cn } from '@/lib/utils'
import { PRODUCT_NAME } from '@/lib/brand'

type Size = 'sm' | 'md' | 'lg' | 'xl' | '2xl'

const TEXT: Record<Size, string> = {
  sm: 'text-[13px]',
  md: 'text-[15px]',
  lg: 'text-[17px]',
  xl: 'text-[19px]',
  '2xl': 'text-[21px]',
}

const MARK: Record<Size, string> = {
  sm: 'size-4',
  md: 'size-5',
  lg: 'size-6',
  xl: 'size-7',
  '2xl': 'size-7',
}

export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden className={cn('shrink-0', className)}>
      <rect width="32" height="32" rx="8" className="fill-primary-solid" />
      <path
        d="M19.95 11.05A7 7 0 1 0 19.95 20.95"
        fill="none"
        stroke="white"
        strokeWidth="3.2"
        strokeLinecap="round"
      />
      <circle cx="23" cy="16" r="2" fill="white" />
    </svg>
  )
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
  return (
    <span
      className={cn('inline-flex items-center gap-2 select-none', TEXT[size], className)}
      aria-label={PRODUCT_NAME}
    >
      <BrandMark className={MARK[size]} />
      {kind === 'full' && (
        <span className="font-semibold tracking-[-0.025em] text-fg-950">{PRODUCT_NAME}</span>
      )}
    </span>
  )
}
