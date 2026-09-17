import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { APP_URL } from '@/lib/utils'

export function StickyCta() {
  const [show, setShow] = useState(false)
  const { pathname } = useLocation()

  useEffect(() => {
    const onScroll = () => setShow(window.scrollY > 700)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  if (pathname === '/contact') return null

  return (
    <div
      className={[
        'pointer-events-none fixed inset-x-0 bottom-0 z-30 flex justify-center px-4 pb-4 transition-all duration-300',
        show ? 'translate-y-0 opacity-100' : 'translate-y-8 opacity-0',
      ].join(' ')}
    >
      <div className="pointer-events-auto flex items-center gap-3 rounded-full border border-slate-200 bg-white/95 px-4 py-2 shadow-lg backdrop-blur md:hidden">
        <span className="text-xs font-medium text-slate-700">
          Try Draft Legal free
        </span>
        <Button asChild size="sm">
          <a href={`${APP_URL}/register`}>Start →</a>
        </Button>
      </div>
      <div className="pointer-events-auto hidden items-center gap-3 rounded-full border border-slate-200 bg-white/95 px-5 py-2 shadow-lg backdrop-blur md:flex">
        <span className="text-sm font-medium text-slate-700">
          Open-source, agent-first CLM. Free forever to self-host.
        </span>
        <Button asChild size="sm" variant="ghost">
          <Link to="/pricing">Pricing</Link>
        </Button>
        <Button asChild size="sm">
          <a href={`${APP_URL}/register`}>Start free →</a>
        </Button>
      </div>
    </div>
  )
}
