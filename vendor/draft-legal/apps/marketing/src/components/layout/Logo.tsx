import { Link } from 'react-router-dom'
import { Wordmark } from '@/components/brand/Wordmark'
import { cn } from '@/lib/utils'

export function Logo({ className, size = '2xl' }: { className?: string; size?: 'md' | 'lg' | 'xl' | '2xl' }) {
  return (
    <Link
      to="/"
      className={cn('inline-flex items-center', className)}
      aria-label="draftLegal — home"
    >
      <Wordmark size={size} />
    </Link>
  )
}
