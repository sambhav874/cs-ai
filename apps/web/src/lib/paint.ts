/**
 * Token colours for code that paints with literal values — Recharts, and DOM
 * built outside React. Classes cannot reach those, so they read the same CSS
 * variables the classes use, at call time: a chart drawn after a theme switch
 * picks up the new values, and no hex is restated here to drift from
 * styles/tokens.css.
 */
export function token(name: string, alpha?: number): string {
  if (typeof document === 'undefined') return 'currentColor'
  const raw = getComputedStyle(document.documentElement).getPropertyValue(`--c-${name}`).trim()
  if (!raw) return 'currentColor'
  return alpha === undefined ? `rgb(${raw})` : `rgb(${raw} / ${alpha})`
}

/** For inline styles inside the page: resolves where it is used, so it follows
 *  the element's own theme (the contract canvas stays light in dark mode). */
export function tokenVar(name: string, alpha?: number): string {
  return alpha === undefined ? `rgb(var(--c-${name}))` : `rgb(var(--c-${name}) / ${alpha})`
}
