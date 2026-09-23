import { beforeAll, describe, expect, it } from 'vitest'
import JSZip from 'jszip'
import mammoth from 'mammoth'
import { DOMParser } from '@xmldom/xmldom'

type XEl = Element
import {
  AlignmentType, Document, Header, HeadingLevel, LevelFormat, Packer, Paragraph, TextRun,
} from 'docx'
import { blockChanges, htmlBlocks, normalise, redlineOriginalDocx, wordDiff } from './docx-redline.js'

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const REV = { author: 'Ada Admin', date: '2026-09-24T10:00:00Z' }

/** A counterparty's contract: a styled title, numbered clauses, bold runs, a header. */
async function counterpartyDocx(): Promise<Buffer> {
  const doc = new Document({
    numbering: {
      config: [{
        reference: 'clauses',
        levels: [{ level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.START }],
      }],
    },
    sections: [{
      headers: { default: new Header({ children: [new Paragraph('ACME CONFIDENTIAL')] }) },
      children: [
        new Paragraph({ text: 'Master Services Agreement', heading: HeadingLevel.HEADING_1 }),
        new Paragraph({
          numbering: { reference: 'clauses', level: 0 },
          children: [new TextRun({ text: 'Payment. ', bold: true }), new TextRun('Customer shall pay each invoice within thirty (30) days of receipt.')],
        }),
        new Paragraph({
          numbering: { reference: 'clauses', level: 0 },
          children: [new TextRun({ text: 'Liability. ', bold: true }), new TextRun('Supplier has unlimited liability for any loss.')],
        }),
        new Paragraph({
          numbering: { reference: 'clauses', level: 0 },
          children: [new TextRun({ text: 'Term. ', bold: true }), new TextRun('This Agreement lasts two years.')],
        }),
        new Paragraph({
          numbering: { reference: 'clauses', level: 0 },
          children: [new TextRun({ text: 'Publicity. ', bold: true }), new TextRun('Supplier may name Customer in marketing.')],
        }),
      ],
    }],
  })
  return Packer.toBuffer(doc)
}

function paragraphs(xml: string): XEl[] {
  const doc = new DOMParser().parseFromString(xml, 'text/xml')
  return Array.from(doc.getElementsByTagNameNS(W, 'p')) as unknown as XEl[]
}

function isMarked(p: XEl, kind: 'ins' | 'del'): boolean {
  const pPr = Array.from(p.childNodes).find(n => (n as XEl).localName === 'pPr') as XEl | undefined
  const rPr = pPr && Array.from(pPr.childNodes).find(n => (n as XEl).localName === 'rPr') as XEl | undefined
  return !!rPr && Array.from(rPr.childNodes).some(n => (n as XEl).localName === kind)
}

/** The document's paragraphs as Word shows them after Accept All (or Reject All). */
function resolve(xml: string, accept: boolean): string[] {
  const out: string[] = []
  for (const p of paragraphs(xml)) {
    if (accept && isMarked(p, 'del')) continue
    if (!accept && isMarked(p, 'ins')) continue
    let text = ''
    const walk = (el: XEl, inIns: boolean, inDel: boolean) => {
      for (const n of Array.from(el.childNodes) as XEl[]) {
        if (n.nodeType !== 1) continue
        const ins = inIns || n.localName === 'ins', del = inDel || n.localName === 'del'
        if (n.localName === 't' && !(accept ? del : ins)) text += n.textContent ?? ''
        else if (n.localName === 'delText' && !accept && !ins) text += n.textContent ?? ''
        else if (n.localName === 'tab') text += '\t'
        else if (n.localName !== 'pPr') walk(n, ins, del)
      }
    }
    walk(p, false, false)
    if (normalise(text)) out.push(normalise(text))
  }
  return out
}

let original: Buffer
let baseHtml: string

beforeAll(async () => {
  original = await counterpartyDocx()
  baseHtml = (await mammoth.convertToHtml({ buffer: original })).value
})

describe('text helpers', () => {
  it('reads inline formatting of a new paragraph', async () => {
    const { inlineRuns } = await import('./docx-redline.js')
    expect(inlineRuns('<strong>Audit. </strong>Customer <em>may</em> audit &amp; copy.')).toEqual([
      { text: 'Audit. ', b: true, i: false, u: false },
      { text: 'Customer ', b: false, i: false, u: false },
      { text: 'may', b: false, i: true, u: false },
      { text: ' audit & copy.', b: false, i: false, u: false },
    ])
  })

  it('reads blocks the way mammoth writes them', () => {
    expect(htmlBlocks('<h1>Title</h1><ol><li><strong>A.</strong> one</li></ol><table><tr><td><p>cell</p></td></tr></table><p></p>'))
      .toEqual(['Title', 'A. one', 'cell'])
  })

  it('word diff keeps unchanged words and spacing', () => {
    expect(wordDiff('pay within thirty (30) days', 'pay within sixty (60) days')).toEqual([
      { kind: 'eq', text: 'pay within ' },
      { kind: 'del', text: 'thirty (30)' },
      { kind: 'ins', text: 'sixty (60)' },
      { kind: 'eq', text: ' days' },
    ])
  })

  it('pairs a reworded block as an edit, not a delete and an insert', () => {
    expect(blockChanges(['a b c d', 'x'], ['a b c e', 'x'])).toEqual([
      { kind: 'edit', base: 0, next: 0 },
      { kind: 'same', base: 1, next: 1 },
    ])
  })
})

describe('redlining the counterparty\'s own file', () => {
  const edit = (html: string) => html
    .replace('within thirty (30) days', 'within sixty (60) days')
    .replace(/<li><strong>Publicity\.[\s\S]*?<\/li>/, '')
    .replace(/(<li><strong>Term\.[\s\S]*?<\/li>)/, '$1<li><strong>Audit. </strong>Customer may audit Supplier once a year.</li>')

  it('accept all gives the edited text; reject all gives the original back', async () => {
    const nextHtml = edit(baseHtml)
    const { bytes, stats } = await redlineOriginalDocx({ docx: original, baseHtml, nextHtml, revision: REV })
    expect(stats).toEqual({ paragraphsEdited: 1, paragraphsInserted: 1, paragraphsDeleted: 1, unmatched: 0 })

    const xml = await (await JSZip.loadAsync(bytes)).file('word/document.xml')!.async('string')
    expect(resolve(xml, true)).toEqual(htmlBlocks(nextHtml).map(normalise))
    expect(resolve(xml, false)).toEqual(htmlBlocks(baseHtml).map(normalise))
    expect(xml).toContain('w:author="Ada Admin"')
  })

  it('leaves untouched paragraphs, numbering and the header exactly as they were', async () => {
    const { bytes } = await redlineOriginalDocx({ docx: original, baseHtml, nextHtml: edit(baseHtml), revision: REV })
    const before = await JSZip.loadAsync(original)
    const after = await JSZip.loadAsync(bytes)
    for (const name of Object.keys(before.files).filter(n => n !== 'word/document.xml' && !before.files[n].dir)) {
      expect(await after.file(name)!.async('string'), name).toBe(await before.file(name)!.async('string'))
    }
    const xml = await after.file('word/document.xml')!.async('string')
    const paras = paragraphs(xml)
    const liability = paras.find(p => (p.textContent ?? '').includes('unlimited liability'))!
    expect(liability.toString()).not.toMatch(/w:ins|w:del/)
    // The edited clause keeps its numbering and its bold lead-in.
    const payment = paras.find(p => (p.textContent ?? '').includes('Payment'))!
    expect(payment.toString()).toContain('w:numPr')
    expect(payment.toString()).toMatch(/<w:b\/>[\s\S]*Payment/)
    // The inserted clause joins the same numbered list.
    const audit = paras.find(p => (p.textContent ?? '').includes('Audit'))!
    expect(audit.toString()).toContain('w:numPr')
    // Bold where the edit made it bold (the title), body formatting for the rest.
    const runs = audit.toString().split('<w:r>').slice(1)
    expect(runs.find(r => r.includes('Audit.'))).toContain('<w:b/>')
    expect(runs.find(r => r.includes('Customer may audit'))).not.toContain('<w:b/>')
  })

  it('the result is still a Word file a converter can read', async () => {
    const { bytes } = await redlineOriginalDocx({ docx: original, baseHtml, nextHtml: edit(baseHtml), revision: REV })
    const back = await mammoth.convertToHtml({ buffer: Buffer.from(bytes) })
    expect(back.value).toContain('sixty (60)')
  })

  it('no change, no revisions', async () => {
    const { bytes, stats } = await redlineOriginalDocx({ docx: original, baseHtml, nextHtml: baseHtml, revision: REV })
    expect(stats).toEqual({ paragraphsEdited: 0, paragraphsInserted: 0, paragraphsDeleted: 0, unmatched: 0 })
    const xml = await (await JSZip.loadAsync(bytes)).file('word/document.xml')!.async('string')
    expect(xml).not.toMatch(/<w:ins |<w:del /)
  })
})
