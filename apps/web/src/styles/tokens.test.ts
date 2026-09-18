import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/*
 * Every foreground/background pair the components actually use, checked
 * against WCAG in both themes. A token change that breaks one fails here, not
 * in a user's eyes. 4.5:1 for text, 3:1 for a meaningful non-text mark (a
 * status dot, a focus ring).
 */

const css = readFileSync(new URL('./tokens.css', import.meta.url), 'utf8')

function block(selectorStart: string): Record<string, string> {
  const start = css.indexOf(selectorStart)
  const body = css.slice(css.indexOf('{', start) + 1, css.indexOf('\n}', start))
  const out: Record<string, string> = {}
  for (const m of body.matchAll(/--(c-[\w-]+):\s*([\d\s]+);/g)) out[m[1]] = m[2].trim()
  return out
}

const light = block(':root,')
const dark = { ...light, ...block('.dark {') }

function luminance(triplet: string): number {
  const [r, g, b] = triplet.split(/\s+/).map((v) => {
    const c = Number(v) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

const WHITE = '255 255 255'

type Pair = [fg: string, bg: string, min: number]

const PAIRS: Pair[] = [
  // Neutral text on every neutral ground it sits on.
  ['fg-950', 'surface-50', 4.5],
  ['fg-700', 'surface-100', 4.5],
  ['fg-500', 'surface-0', 4.5],
  ['fg-500', 'surface-100', 4.5],
  ['fg-400', 'surface-0', 4.5],
  ['fg-400', 'surface-50', 4.5],
  ['fg-350', 'surface-100', 3],
  // Meaning text on its own wash and pill.
  ['primary-700', 'surface-0', 4.5],
  ['primary-700', 'primary-50', 4.5],
  ['success-700', 'success-50', 4.5],
  ['success-700', 'surface-0', 4.5],
  ['info-700', 'info-100', 4.5],
  ['attention-700', 'attention-100', 4.5],
  ['risk-700', 'risk-50', 4.5],
  ['assist-700', 'assist-50', 4.5],
  // Status dots on the neutral pill.
  ['info-600', 'surface-100', 3],
  ['attention-600', 'surface-100', 3],
  ['success-700', 'surface-100', 3],
  ['risk-600', 'surface-100', 3],
]

const SOLIDS = ['primary', 'success', 'info', 'attention', 'risk', 'assist']

describe.each([
  ['light', light],
  ['dark', dark],
])('%s theme', (_name, t) => {
  it.each(PAIRS)('%s on %s ≥ %s:1', (fg, bg, min) => {
    expect(contrast(t[`c-${fg}`], t[`c-${bg}`])).toBeGreaterThanOrEqual(min)
  })

  it.each(SOLIDS)('white text on %s-solid ≥ 4.5:1', (family) => {
    expect(contrast(WHITE, t[`c-${family}-solid`])).toBeGreaterThanOrEqual(4.5)
    expect(contrast(WHITE, t[`c-${family}-solid-hover`])).toBeGreaterThanOrEqual(4.5)
  })

  it('the focus ring is visible on the app ground (3:1)', () => {
    const ring = _name === 'dark' ? t['c-primary-500'] : t['c-primary-700']
    expect(contrast(ring, t['c-surface-50'])).toBeGreaterThanOrEqual(3)
  })
})
