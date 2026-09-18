/**
 * Hand-written replacement for ContractSense's shadcn toast hook: same call
 * shape, rendered by the platform's one Toaster (components/common/Toaster),
 * so both halves of the product notify the same way.
 */
import type { ReactNode } from 'react'
import { toast as platformToast } from '@/components/common/Toaster'

type ToastInput = {
  title?: ReactNode
  description?: ReactNode
  variant?: 'default' | 'destructive' | 'success'
  duration?: number
}

const text = (n: ReactNode) => (typeof n === 'string' || typeof n === 'number' ? String(n) : undefined)

function toast({ title, description, variant, duration }: ToastInput) {
  const opts = { description: text(description), durationMs: duration }
  const heading = text(title) ?? text(description) ?? ''
  if (variant === 'destructive') platformToast.error(heading, opts)
  else if (variant === 'success') platformToast.success(heading, opts)
  else platformToast.info(heading, opts)
  return { id: '', dismiss: () => {}, update: () => {} }
}

function useToast() {
  return { toast, toasts: [] as never[], dismiss: (_id?: string) => {} }
}

export { useToast, toast }
