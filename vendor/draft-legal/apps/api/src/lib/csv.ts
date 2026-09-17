/**
 * csv.ts — tiny CSV helpers (P9 Step 7).
 *
 * Avoids pulling in a CSV library for our straightforward export use
 * cases. Quote-on-special-char + escape doubled-quotes is enough for
 * Excel/Numbers/Sheets to parse cleanly.
 */

export function csvEscape(v: unknown): string {
  if (v == null) return ''
  const s = String(v)
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

export function csvLine(cells: unknown[]): string {
  return cells.map(csvEscape).join(',')
}

export function buildCsv(headers: string[], rows: unknown[][]): string {
  const lines: string[] = [csvLine(headers)]
  for (const r of rows) lines.push(csvLine(r))
  return lines.join('\n')
}

/**
 * Tiny CSV parser — handles quoted fields, embedded commas, doubled
 * quotes, and CRLF line endings. Sufficient for "Excel save as CSV"
 * exports; not fully RFC-4180 compliant (no per-row error reporting).
 */
export function parseCsv(input: string): string[][] {
  const rows: string[][] = []
  let current: string[] = []
  let cell = ''
  let inQuotes = false
  let i = 0
  while (i < input.length) {
    const ch = input[i]
    if (inQuotes) {
      if (ch === '"') {
        if (input[i + 1] === '"') { cell += '"'; i += 2; continue }
        inQuotes = false; i++; continue
      }
      cell += ch; i++; continue
    }
    if (ch === '"' && cell === '') { inQuotes = true; i++; continue }
    if (ch === ',') { current.push(cell); cell = ''; i++; continue }
    if (ch === '\n' || ch === '\r') {
      current.push(cell); rows.push(current)
      current = []; cell = ''
      // swallow CRLF
      if (ch === '\r' && input[i + 1] === '\n') i++
      i++; continue
    }
    cell += ch; i++
  }
  // last cell + last row (no trailing newline)
  if (cell.length > 0 || current.length > 0) {
    current.push(cell); rows.push(current)
  }
  // Drop trailing empty row that an editor's trailing newline produces.
  if (rows.length > 0 && rows[rows.length - 1].length === 1 && rows[rows.length - 1][0] === '') rows.pop()
  return rows
}
