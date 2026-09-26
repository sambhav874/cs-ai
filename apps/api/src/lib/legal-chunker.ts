/**
 * Legal Chunker — clause-level chunking.
 *
 * Algorithm:
 *  1. Use AI-extracted clauseSegments as primary chunk boundaries (already typed)
 *  2. For clauses with content.length > MAX_CLAUSE_LEN: sliding-window sub-chunks
 *  3. snapToSentence(): snap cut points to nearest `. ` within ±SNAP_WINDOW chars
 *  4. Upsert ContractClause rows (with isSubChunk, windowIndex, charStart, charEnd)
 */
import { prisma } from './prisma.js'

const MAX_CLAUSE_LEN  = 2_000   // chars — clauses over this get sliding-window sub-chunks
const SUB_CHUNK_LEN   = 1_800   // max chars per sub-chunk
const SUB_CHUNK_OVERLAP = 360   // chars — ~10% overlap to prevent boundary loss
const SNAP_WINDOW     = 100     // chars to search left/right for a sentence boundary

// ─── Sentence boundary snapping ──────────────────────────────────────────────

function snapToSentence(text: string, pos: number): number {
  const lo = Math.max(0, pos - SNAP_WINDOW)
  const hi = Math.min(text.length, pos + SNAP_WINDOW)
  const window = text.slice(lo, hi)

  // Look for `. ` or `.\n` nearest to the target position
  let bestDist = Infinity
  let bestPos  = pos

  for (let i = 0; i < window.length - 1; i++) {
    if (window[i] === '.' && (window[i + 1] === ' ' || window[i + 1] === '\n')) {
      const absPos = lo + i + 2  // +2: start after `. `
      const dist   = Math.abs(absPos - pos)
      if (dist < bestDist) {
        bestDist = dist
        bestPos  = absPos
      }
    }
  }
  return bestPos
}

// ─── Sliding window sub-chunks ────────────────────────────────────────────────

interface SubChunk {
  content:     string
  charStart:   number
  charEnd:     number
  windowIndex: number
}

function slidingWindowChunks(text: string, baseOffset = 0): SubChunk[] {
  if (text.length <= MAX_CLAUSE_LEN) {
    return [{
      content:     text,
      charStart:   baseOffset,
      charEnd:     baseOffset + text.length,
      windowIndex: 0,
    }]
  }

  const chunks: SubChunk[] = []
  let start = 0
  let windowIndex = 0

  while (start < text.length) {
    let end = Math.min(start + SUB_CHUNK_LEN, text.length)

    if (end < text.length) {
      end = snapToSentence(text, end)
    }

    const content = text.slice(start, end).trim()
    if (content.length > 0) {
      chunks.push({
        content,
        charStart:   baseOffset + start,
        charEnd:     baseOffset + end,
        windowIndex: windowIndex++,
      })
    }

    // Advance with overlap
    start = end - SUB_CHUNK_OVERLAP
    if (start <= 0 || start >= text.length) break
  }

  return chunks
}

// ─── Main export ─────────────────────────────────────────────────────────────

interface RawClause {
  id:         string
  clauseType: string
  content:    string
  sortOrder:  number
}

export async function legalChunkAndStore(
  versionId:   string,
  rawClauses:  RawClause[],
): Promise<void> {
  if (rawClauses.length === 0) return

  // Build all final chunks (primary clauses + sub-chunks for long ones)
  type FinalChunk = {
    dbId:        string   // cuid from DB
    clauseType:  string
    content:     string
    sortOrder:   number
    isSubChunk:  boolean
    windowIndex: number | null
    charStart:   number | null
    charEnd:     number | null
  }

  const finalChunks: FinalChunk[] = []

  for (const clause of rawClauses) {
    const subs = slidingWindowChunks(clause.content)

    if (subs.length === 1) {
      // Primary chunk — fits within limits, no sub-chunking needed
      finalChunks.push({
        dbId:        clause.id,
        clauseType:  clause.clauseType,
        content:     subs[0].content,
        sortOrder:   clause.sortOrder,
        isSubChunk:  false,
        windowIndex: null,
        charStart:   subs[0].charStart,
        charEnd:     subs[0].charEnd,
      })
    } else {
      // Sub-chunks — update the primary row with sub-chunk 0, create new rows for rest
      for (let i = 0; i < subs.length; i++) {
        finalChunks.push({
          dbId:        i === 0 ? clause.id : '',   // placeholder — will be set after upsert
          clauseType:  clause.clauseType,
          content:     subs[i].content,
          sortOrder:   clause.sortOrder,
          isSubChunk:  i > 0,
          windowIndex: subs[i].windowIndex,
          charStart:   subs[i].charStart,
          charEnd:     subs[i].charEnd,
        })
      }
    }
  }

  // Upsert DB rows
  for (const chunk of finalChunks) {
    if (chunk.dbId) {
      // Update existing row (primary / sub-chunk 0). Its content is NOT
      // replaced by the window: the primary row is the clause every consumer
      // reads (playbook review, redline, clause apply — all filter
      // isSubChunk: false), and cutting it to the first 1,800 characters
      // silently truncated every long clause.
      await prisma.contractClause.update({
        where: { id: chunk.dbId },
        data: {
          isSubChunk:  chunk.isSubChunk,
          windowIndex: chunk.windowIndex,
          charStart:   chunk.charStart,
          charEnd:     chunk.charEnd,
        },
      })
    } else {
      // Create new sub-chunk row
      const created = await prisma.contractClause.create({
        data: {
          versionId:   versionId,
          clauseType:  chunk.clauseType,
          content:     chunk.content,
          sortOrder:   chunk.sortOrder,
          isSubChunk:  true,
          windowIndex: chunk.windowIndex,
          charStart:   chunk.charStart,
          charEnd:     chunk.charEnd,
        },
      })
      chunk.dbId = created.id
    }
  }
}
