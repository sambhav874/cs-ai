import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const buttonVariants = cva(
  'inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-700 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default: 'bg-emerald-700 text-white hover:bg-emerald-800',
        outline:
          'border border-slate-300 bg-white text-slate-900 hover:border-slate-400 hover:bg-slate-50',
        ghost: 'text-slate-700 hover:bg-slate-100 hover:text-slate-900',
        link: 'text-emerald-700 underline-offset-4 hover:underline',
        light: 'bg-white text-emerald-900 hover:bg-emerald-50',
        dark: 'bg-slate-900 text-white hover:bg-slate-800',
      },
      size: {
        default: 'h-10 px-5 py-2',
        sm: 'h-9 px-4',
        lg: 'h-12 px-8 text-base',
        icon: 'h-10 w-10',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
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
