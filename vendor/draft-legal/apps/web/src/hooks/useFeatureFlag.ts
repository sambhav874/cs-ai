/**
 * Tiny feature-flag hook (D.1.1)
 *
 * Reads `localStorage["feature:<NAME>"]` so devs can flip flags from the
 * browser console without a redeploy:
 *
 *   localStorage.setItem('feature:AGENT_SIDE_PANEL_V2', '0')   // explicit off
 *   localStorage.setItem('feature:AGENT_SIDE_PANEL_V2', '1')   // explicit on
 *
 * Per-flag defaults live in DEFAULT_FLAGS below — flags omitted from
 * localStorage fall back to that default. Listens to storage events so
 * toggling in DevTools flips the UI live across tabs too.
 *
 * Not meant to be a full LaunchDarkly / GrowthBook replacement — that
 * comes in Phase 09.
 */
import { useEffect, useState } from 'react'

export type FeatureFlag =
  | 'AGENT_SIDE_PANEL_V2'

/**
 * P7.0.3 (F-01) — Default-on for the agent surfaces. The HeroAgent
 * + side rail were gated behind this flag (defaulted off) for the
 * D-wave rollout; that's stayed in place for 6 months and is now the
 * #1 thing fresh users complain about: "I don't see any agent."
 *
 * Flipping the default to `true` means a fresh login renders the
 * HeroAgent composer at the top of /dashboard + the AI Assistant
 * rail without anyone needing to type localStorage incantations.
 *
 * Users who explicitly opt-out (set the key to '0') still get their
 * preference respected — the read below honors `'0'` as off.
 */
const DEFAULT_FLAGS: Record<FeatureFlag, boolean> = {
  AGENT_SIDE_PANEL_V2: true,
}

function readFlag(name: FeatureFlag): boolean {
  if (typeof window === 'undefined') return DEFAULT_FLAGS[name]
  const raw = window.localStorage.getItem(`feature:${name}`)
  if (raw === null || raw === undefined) return DEFAULT_FLAGS[name]
  // Explicit value wins over default (lets users opt-out of default-on flags)
  return raw === '1' || raw === 'true'
}

export function useFeatureFlag(name: FeatureFlag): boolean {
  const [enabled, setEnabled] = useState<boolean>(() => readFlag(name))

  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key === `feature:${name}`) setEnabled(readFlag(name))
    }
    window.addEventListener('storage', onStorage)
    // Custom event so same-tab toggles (via setFlag below) propagate instantly
    function onCustom() { setEnabled(readFlag(name)) }
    window.addEventListener('feature-flag-changed', onCustom)
    return () => {
      window.removeEventListener('storage', onStorage)
      window.removeEventListener('feature-flag-changed', onCustom)
    }
  }, [name])

  return enabled
}

/** Toggle a flag from code (e.g., an admin "Enable beta" button). */
export function setFeatureFlag(name: FeatureFlag, value: boolean): void {
  window.localStorage.setItem(`feature:${name}`, value ? '1' : '0')
  window.dispatchEvent(new CustomEvent('feature-flag-changed', { detail: { name, value } }))
}
