/**
 * ContractSense's Badge, on the platform's pill language: neutral by default,
 * colour only where a variant names a meaning.
 */
import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const badgeVariants = cva(
  'inline-flex w-fit items-center gap-1 rounded-full border px-2 py-0.5 text-[11.5px] font-medium transition-colors',
  {
    variants: {
      variant: {
        default: 'border-primary-200 bg-primary-50 text-primary-700',
        secondary: 'border-surface-200 bg-surface-100 text-fg-700',
        destructive: 'border-risk-200 bg-risk-50 text-risk-700',
        outline: 'border-surface-200 bg-card text-fg-700',
        success: 'border-success-200 bg-success-50 text-success-700',
        warning: 'border-attention-200 bg-attention-50 text-attention-700',
        info: 'border-info-200 bg-info-50 text-info-700',
        neutral: 'border-surface-200 bg-surface-100 text-fg-700',
        status: 'border-primary-200 bg-primary-50 text-primary-700',
      },
    },
    defaultVariants: { variant: 'default' },
  },
)

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />
}

export { Badge, badgeVariants }
