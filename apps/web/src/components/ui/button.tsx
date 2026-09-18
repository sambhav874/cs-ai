import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

/*
 * Button.
 *
 * One primary per view: cobalt, the action colour. `success` (green) and
 * `danger` (red) are DECISION buttons — approve, sign, reject — and belong on
 * those surfaces only. `assist` is violet and reserved for asking the model to
 * do something; pair it with <AssistMark />.
 *
 * Fills use the -solid tokens so white text stays legible in dark mode.
 */
const buttonVariants = cva(
  'inline-flex items-center justify-center whitespace-nowrap font-medium ' +
    'transition-[color,background-color,border-color,box-shadow,transform] duration-micro ease-out active:translate-y-px ' +
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ' +
    'focus-visible:ring-offset-background disabled:pointer-events-none ' +
    'disabled:border-surface-200 disabled:bg-surface-100 disabled:text-fg-400 ' +
    '[&_svg]:shrink-0',
  {
    variants: {
      variant: {
        // Cobalt. The default, and the only default.
        default: 'border border-primary-solid bg-primary-solid text-white shadow-e1 hover:bg-primary-solid-hover hover:border-primary-solid-hover',
        outline: 'border border-input bg-card text-fg-950 shadow-e1 hover:bg-surface-50 hover:border-surface-300',
        ghost: 'border border-transparent text-fg-700 hover:bg-surface-100 hover:text-fg-950',
        // Decision — approval + signature surfaces only.
        success: 'border border-success-solid bg-success-solid text-white hover:bg-success-solid-hover hover:border-success-solid-hover',
        danger: 'border border-risk-200 bg-card text-risk-700 hover:bg-risk-50',
        // Destructive fill. For irreversible deletes, not for "Reject".
        destructive: 'border border-risk-solid bg-risk-solid text-white hover:bg-risk-solid-hover hover:border-risk-solid-hover',
        // Machine. Pair with <AssistMark /> so the glyph rule holds.
        assist: 'border border-assist-solid bg-assist-solid text-white hover:bg-assist-solid-hover hover:border-assist-solid-hover',
        assistOutline: 'border border-assist-200 bg-card text-assist-700 hover:bg-assist-50',
        link: 'border border-transparent text-fg-950 underline underline-offset-2 decoration-surface-300 hover:decoration-primary-700 hover:text-primary-700',
      },
      size: {
        xs: 'h-[26px] gap-1.5 rounded-sm px-2.5 text-[12px] [&_svg]:size-3',
        sm: 'h-8 gap-[7px] rounded-md px-3.5 text-[13px] [&_svg]:size-3.5',
        md: 'h-9 gap-2 rounded-md px-4 text-[14px] [&_svg]:size-4',
        icon: 'size-8 rounded-md [&_svg]:size-4',
        'icon-xs': 'size-[26px] rounded-sm [&_svg]:size-3.5',
      },
    },
    defaultVariants: {
      variant: 'default',
      // 32px is the system default — legal ops spend the day in rows.
      size: 'sm',
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button'
    return (
      <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
    )
  }
)
Button.displayName = 'Button'

export { Button, buttonVariants }
