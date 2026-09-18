/**
 * ContractSense's Button API, rendered by the platform's Button — one button
 * across both halves of the product. Variants map by intent:
 *   default → default (cobalt)   secondary → outline   destructive → destructive
 *   outline → outline            ghost → ghost          link → link
 * Sizes: default → md, sm → sm, lg → md (wider), icon → icon.
 */
import * as React from 'react'
import { Button as PlatformButton, buttonVariants as platformVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'

type Variant = 'default' | 'destructive' | 'outline' | 'secondary' | 'ghost' | 'link'
type Size = 'default' | 'sm' | 'lg' | 'icon'

const VARIANT = {
  default: 'default',
  destructive: 'destructive',
  outline: 'outline',
  secondary: 'outline',
  ghost: 'ghost',
  link: 'link',
} as const

const SIZE = { default: 'md', sm: 'sm', lg: 'md', icon: 'icon' } as const

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant | null
  size?: Size | null
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant, size, className, ...props }, ref) => (
    <PlatformButton
      ref={ref}
      variant={VARIANT[variant ?? 'default']}
      size={SIZE[size ?? 'default']}
      className={cn(size === 'lg' && 'px-6', className)}
      {...props}
    />
  ),
)
Button.displayName = 'Button'

function buttonVariants({ variant, size, className }: { variant?: Variant | null; size?: Size | null; className?: string } = {}) {
  return platformVariants({
    variant: VARIANT[variant ?? 'default'],
    size: SIZE[size ?? 'default'],
    className: cn(size === 'lg' && 'px-6', className),
  })
}

export { Button, buttonVariants }
