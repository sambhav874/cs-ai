import { useState } from 'react'
import { ArrowRight, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'

type Props = {
  source: string
  cta?: string
  placeholder?: string
  inline?: boolean
}

export function EmailCapture({
  source,
  cta = 'Get it free',
  placeholder = 'Work email',
  inline = false,
}: Props) {
  const [email, setEmail] = useState('')
  const [state, setState] = useState<'idle' | 'submitting' | 'done' | 'error'>('idle')

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email.includes('@')) return
    setState('submitting')
    try {
      const res = await fetch('/api/marketing/contact', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, source }),
      })
      if (!res.ok) throw new Error('failed')
      setState('done')
    } catch {
      setState('done')
    }
  }

  if (state === 'done') {
    return (
      <div className="inline-flex items-center gap-2 rounded-md bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">
        <Check className="h-4 w-4" />
        Check your inbox — we sent it.
      </div>
    )
  }

  return (
    <form
      onSubmit={submit}
      className={
        inline
          ? 'flex max-w-md gap-2'
          : 'flex max-w-md flex-col gap-2 sm:flex-row'
      }
    >
      <input
        type="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder={placeholder}
        className="flex-1 rounded-md border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-700/20"
      />
      <Button type="submit" disabled={state === 'submitting'}>
        {state === 'submitting' ? 'Sending…' : cta}
        <ArrowRight className="ml-1.5 h-4 w-4" />
      </Button>
    </form>
  )
}
