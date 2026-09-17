/**
 * action-chips.ts (A9 / P1 fix)
 *
 * The orchestrator's A9 rule makes the LLM end research-style turns with
 * 2-3 follow-up suggestions, one per line:
 *
 *   [chip]: Show me details on the Mayo Clinic MSA
 *   [chip]: Filter to only EXECUTED contracts
 *
 * This parser strips those marker lines out of the prose (so they never
 * render as raw text in the bubble) and returns them as structured chips
 * the ChipRow renders as one-tap follow-up buttons.
 */

export interface ActionChip {
  id:    string
  label: string
  payload?: unknown
}

export interface ParsedChips {
  cleanProse: string
  chips:      ActionChip[]
}

// Tolerant of common LLM formatting drift: optional list bullet, optional
// bold/italic wrapping of the marker, flexible whitespace, case-insensitive.
//   "[chip]: Foo"  "- [chip]: Foo"  "• [Chip]:Foo"  "**[chip]:** Foo"
const CHIP_LINE = /^\s*(?:[-*•]\s*)?(?:\*\*|__|\*|_)?\[chip\]:?(?:\*\*|__|\*|_)?\s*(.+?)\s*$/i

const MAX_CHIPS = 5

export function parseActionChips(content: string): ParsedChips {
  if (!content || !content.toLowerCase().includes('[chip]')) {
    return { cleanProse: content, chips: [] }
  }
  const chips: ActionChip[] = []
  const kept: string[] = []
  for (const line of content.split('\n')) {
    const m = line.match(CHIP_LINE)
    if (m && m[1].trim()) {
      if (chips.length < MAX_CHIPS) {
        // Strip residual markdown emphasis + trailing punctuation noise.
        const label = m[1].replace(/^(?:\*\*|__|\*|_)|(?:\*\*|__|\*|_)$/g, '').trim()
        if (label) chips.push({ id: `chip_${chips.length}`, label })
      }
      continue // drop the marker line from prose either way
    }
    kept.push(line)
  }
  // Collapse the whitespace gap the removed block leaves behind.
  const cleanProse = kept.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()
  return { cleanProse, chips }
}
