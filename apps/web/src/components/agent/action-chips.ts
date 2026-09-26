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

/**
 * A chip is sent as the user's own message when tapped, so it must read as
 * the user asking. The model still sometimes writes a question to the user
 * ("Would you like a side-by-side comparison…?"), which, sent back, reads as
 * the user asking themselves. Turn those into the request they offer.
 */
export function asUserRequest(label: string): string {
  const m = label.trim().match(
    /^(?:would you like|do you want|would you want|want|need|shall i|should i|can i|may i|i can|i could)(?:\s+me)?(?:\s+to)?\s+(.+?)\??$/i,
  )
  if (!m) return label.trim()
  let rest = m[1].trim().replace(/\?+$/, '')
  // "a summary of…" / "the playbook position…" → "Show a summary of…"
  if (/^(a|an|the|any|more|some|details?|summary|list)\b/i.test(rest)) rest = `show ${rest}`
  rest = rest.replace(/\byour\b/gi, 'our').replace(/\byou have\b/gi, 'we have').replace(/\byou\b/gi, 'us')
  return rest.charAt(0).toUpperCase() + rest.slice(1)
}

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
        // A bracket with no opener is the model closing a list it wrote as
        // "[chip]: …]" (seen live: "List any indemnification provisions]").
        const stripped = m[1].replace(/^(?:\*\*|__|\*|_)|(?:\*\*|__|\*|_)$/g, '').trim()
        const opens = (stripped.match(/\[/g) ?? []).length
        const closes = (stripped.match(/\]/g) ?? []).length
        const label = (closes > opens ? stripped.replace(/\]+\s*$/, '') : stripped).trim()
        if (label) chips.push({ id: `chip_${chips.length}`, label: asUserRequest(label) })
      }
      continue // drop the marker line from prose either way
    }
    kept.push(line)
  }
  // Collapse the whitespace gap the removed block leaves behind.
  const cleanProse = kept.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()
  return { cleanProse, chips }
}
