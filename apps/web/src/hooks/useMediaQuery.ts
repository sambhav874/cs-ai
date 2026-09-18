/**
 * useMediaQuery — subscribes a component to a CSS media query.
 *
 * Mirrors the breakpoints defined in tailwind.config (Tailwind default
 * `md` = 768px, `lg` = 1024px, `xl` = 1280px). Returns true/false and
 * re-renders on transition. SSR-safe: returns `false` when window is
 * undefined.
 *
 * B.5.16 uses this to switch the contract-detail rail between:
 *   ≥ 1280 (xl) → full two-column layout
 *   768–1279  → slide-in drawer with a pill trigger
 *   < 768     → bottom sheet
 */
import { useEffect, useState } from 'react'

export function useMediaQuery(query: string): boolean {
  const get = () => (typeof window !== 'undefined' ? window.matchMedia(query).matches : false)
  const [matches, setMatches] = useState(get)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const mql = window.matchMedia(query)
    const handler = (e: MediaQueryListEvent) => setMatches(e.matches)
    setMatches(mql.matches)
    mql.addEventListener('change', handler)
    return () => mql.removeEventListener('change', handler)
  }, [query])

  return matches
}

/** Convenience breakpoints matching Tailwind defaults. */
export const BREAKPOINTS = {
  /** ≥ 640px */  sm: '(min-width: 640px)',
  /** ≥ 768px */  md: '(min-width: 768px)',
  /** ≥ 1024px */ lg: '(min-width: 1024px)',
  /** ≥ 1280px */ xl: '(min-width: 1280px)',
} as const
