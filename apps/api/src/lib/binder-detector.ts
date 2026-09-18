/**
 * Binder Detector — heuristic analysis to determine if a PDF contains
 * multiple distinct legal agreements merged into one file.
 *
 * Common cases:
 *  - Closing packs: NDA + MSA + SOW + DPA
 *  - M&A diligence binders
 *  - Template bundles sent by legal teams
 *
 * Returns suggested document boundaries based on text pattern detection.
 */

export interface SuggestedDocument {
  title:      string   // detected agreement title
  pageHint:   string   // approximate location description (e.g. "~page 15")
  charStart:  number   // character offset in plainText
  docType:    string   // NDA | MSA | SOW | SLA | OTHER
}

export interface BinderResult {
  isLikelyBinder:      boolean
  confidence:          number      // 0–1
  suggestedDocuments:  SuggestedDocument[]
  signatureBlockCount: number
}

// ─── Patterns ─────────────────────────────────────────────────────────────────

// Agreement title headers — these appear at the start of a new agreement
const AGREEMENT_HEADER_PATTERNS = [
  { pattern: /\b(MUTUAL\s+)?NON[-\s]?DISCLOSURE\s+AGREEMENT\b/gi, type: 'NDA' },
  { pattern: /\bNDA\b(?=\s*\n|\s*BETWEEN|\s*AGREEMENT)/g,          type: 'NDA' },
  { pattern: /\bMASTER\s+SERVICE[S]?\s+AGREEMENT\b/gi,              type: 'MSA' },
  { pattern: /\bMASTER\s+SUBSCRIPTION\s+AGREEMENT\b/gi,             type: 'MSA' },
  { pattern: /\bSTATEMENT\s+OF\s+WORK\b/gi,                        type: 'SOW' },
  { pattern: /\bSERVICE\s+LEVEL\s+AGREEMENT\b/gi,                   type: 'SLA' },
  { pattern: /\bDATA\s+PROCESSING\s+(?:ADDENDUM|AGREEMENT)\b/gi,    type: 'DPA' },
  { pattern: /\bDATA\s+PROTECTION\s+(?:ADDENDUM|AGREEMENT)\b/gi,    type: 'DPA' },
  { pattern: /\bEMPLOYMENT\s+AGREEMENT\b/gi,                        type: 'EMPLOYMENT' },
  { pattern: /\bINDEPENDENT\s+CONTRACTOR\s+AGREEMENT\b/gi,          type: 'SOW' },
  { pattern: /\bPURCHASE\s+ORDER\b/gi,                              type: 'ORDER_FORM' },
  { pattern: /\bORDER\s+FORM\b/gi,                                  type: 'ORDER_FORM' },
  { pattern: /\bSUBSCRIPTION\s+AGREEMENT\b/gi,                     type: 'MSA' },
  { pattern: /\bLICENSE\s+AGREEMENT\b/gi,                           type: 'LICENSE' },
  { pattern: /\bPARTNERSHIP\s+AGREEMENT\b/gi,                       type: 'PARTNERSHIP' },
  { pattern: /\bJOINT\s+VENTURE\s+AGREEMENT\b/gi,                   type: 'PARTNERSHIP' },
]

// Signature block patterns — "IN WITNESS WHEREOF" is the canonical legal phrase
const SIGNATURE_PATTERNS = [
  /\bIN\s+WITNESS\s+WHEREOF\b/gi,
  /\bSIGNED\s+BY\s+THE\s+PARTIES\b/gi,
  /\bEXECUTED\s+(?:BY\s+THE\s+PARTIES|AS\s+OF)\b/gi,
  /\bACCEPTED\s+AND\s+AGREED\b/gi,
  /\bFOR\s+AND\s+ON\s+BEHALF\s+OF\b/gi,
]

// Section restart signals — these appear at the very beginning of a new agreement
const SECTION_RESTART_PATTERNS = [
  /^\s*1\.\s+(?:DEFINITIONS|INTRODUCTION|BACKGROUND|RECITALS)/im,
  /^\s*ARTICLE\s+I[.:\s]/im,
  /^\s*SECTION\s+1[.:\s]/im,
]

// ─── Helper ───────────────────────────────────────────────────────────────────

function countMatches(text: string, patterns: RegExp[]): number {
  let count = 0
  for (const pattern of patterns) {
    const re = new RegExp(pattern.source, pattern.flags)
    const matches = text.match(re)
    count += matches?.length ?? 0
  }
  return count
}

function findAllMatches(text: string, patterns: { pattern: RegExp; type: string }[]): Array<{ charStart: number; title: string; docType: string }> {
  const results: Array<{ charStart: number; title: string; docType: string }> = []
  for (const { pattern, type } of patterns) {
    const re = new RegExp(pattern.source, pattern.flags)
    let m: RegExpExecArray | null
    while ((m = re.exec(text)) !== null) {
      results.push({
        charStart: m.index,
        title:     m[0].replace(/\s+/g, ' ').trim(),
        docType:   type,
      })
    }
  }
  return results.sort((a, b) => a.charStart - b.charStart)
}

// ─── Main export ──────────────────────────────────────────────────────────────

export function detectBinder(plainText: string): BinderResult {
  const signatureBlockCount = countMatches(plainText, SIGNATURE_PATTERNS)
  const headerMatches = findAllMatches(plainText, AGREEMENT_HEADER_PATTERNS)

  // Deduplicate: keep only the first match within 500 chars of each other
  const dedupedHeaders: typeof headerMatches = []
  for (const match of headerMatches) {
    const last = dedupedHeaders[dedupedHeaders.length - 1]
    if (!last || match.charStart - last.charStart > 500) {
      dedupedHeaders.push(match)
    }
  }

  // Scoring
  const headerCount = dedupedHeaders.length
  const uniqueTypes  = new Set(dedupedHeaders.map(h => h.docType)).size

  // A binder needs: multiple signature blocks OR multiple distinct agreement headers
  const isLikelyBinder = signatureBlockCount >= 2 || (headerCount >= 2 && uniqueTypes >= 2)

  // Confidence: higher when both signals agree
  let confidence = 0
  if (signatureBlockCount >= 2)    confidence += 0.5
  if (headerCount >= 2)            confidence += 0.3
  if (uniqueTypes >= 2)            confidence += 0.2
  if (signatureBlockCount >= 3)    confidence = Math.min(1, confidence + 0.2)
  confidence = Math.min(1, confidence)

  // Build suggested document list from deduplicated headers
  // Use char positions as approximate page hints (assumes ~3000 chars/page)
  const charsPerPage = 3_000
  const suggestedDocuments: SuggestedDocument[] = dedupedHeaders.map(h => ({
    title:     h.title,
    charStart: h.charStart,
    pageHint:  `~page ${Math.round(h.charStart / charsPerPage) + 1}`,
    docType:   h.docType,
  }))

  // If no headers found but multiple sig blocks: mark as unknown splits
  if (suggestedDocuments.length === 0 && signatureBlockCount >= 2) {
    // Try to split evenly by signature blocks
    const sigPattern = /\bIN\s+WITNESS\s+WHEREOF\b/gi
    let m: RegExpExecArray | null
    let i = 1
    while ((m = sigPattern.exec(plainText)) !== null) {
      suggestedDocuments.push({
        title:     `Agreement ${i++}`,
        charStart: Math.max(0, m.index - 5_000),
        pageHint:  `~page ${Math.round(m.index / charsPerPage) + 1}`,
        docType:   'OTHER',
      })
    }
  }

  return {
    isLikelyBinder,
    confidence,
    suggestedDocuments,
    signatureBlockCount,
  }
}
