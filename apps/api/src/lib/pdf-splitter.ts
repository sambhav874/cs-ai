/**
 * PDF Splitter — slice a multi-agreement PDF binder into N separate PDFs.
 * Uses pdf-lib for page-level manipulation (no native dependencies).
 *
 * Input: original PDF bytes + split specs (one per detected agreement)
 * Output: array of { pdfBytes, title, type } — one per split
 */
import { PDFDocument } from 'pdf-lib'

export interface SplitSpec {
  pageStart:  number   // 1-indexed, inclusive
  pageEnd:    number   // 1-indexed, inclusive
  title?:     string
  type?:      string
}

export interface SplitResult {
  pdfBytes: Uint8Array
  title:    string
  type:     string
  pageStart: number
  pageEnd:   number
}

export async function splitPdf(
  pdfBytes:   Buffer | Uint8Array,
  specs:      SplitSpec[],
  totalPages: number,
): Promise<SplitResult[]> {
  const sourceDoc = await PDFDocument.load(pdfBytes)
  const results: SplitResult[] = []

  for (let i = 0; i < specs.length; i++) {
    const spec = specs[i]

    // Clamp to actual page count (1-indexed → 0-indexed)
    const start  = Math.max(1, spec.pageStart) - 1
    const end    = Math.min(totalPages, spec.pageEnd) - 1
    const pageIndices: number[] = []
    for (let p = start; p <= end; p++) pageIndices.push(p)

    if (pageIndices.length === 0) continue

    const newDoc = await PDFDocument.create()
    const pages  = await newDoc.copyPages(sourceDoc, pageIndices)
    for (const page of pages) newDoc.addPage(page)

    const pdfOut = await newDoc.save()

    results.push({
      pdfBytes:  pdfOut,
      title:     spec.title || `Part ${i + 1}`,
      type:      spec.type  || 'OTHER',
      pageStart: spec.pageStart,
      pageEnd:   spec.pageEnd,
    })
  }

  return results
}

/**
 * Get page count from a PDF buffer without loading all pages into memory.
 */
export async function getPdfPageCount(pdfBytes: Buffer | Uint8Array): Promise<number> {
  const doc = await PDFDocument.load(pdfBytes, { updateMetadata: false })
  return doc.getPageCount()
}
