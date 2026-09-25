import { describe, expect, it } from 'vitest'
import { citationHref, type AnswerCitation } from './CitationPills'
import { linkCitationMarkers } from './MarkdownProse'
import { parseActionChips } from './action-chips'
import { locateInItems, normalizeQuote } from '../contract/PdfQuoteViewer'

const cite = (over: Partial<AnswerCitation> = {}): AnswerCitation => ({
  ref: 1, contractId: 'cmabc', quote: 'billed in advance on the first business day', page: 3, sectionRef: null,
  verified: true, ...over,
})

describe('citation links', () => {
  it('open the contract at the page with the passage to highlight', () => {
    const href = citationHref(cite())!
    const url = new URL(href, 'https://x')
    expect(url.pathname).toBe('/contracts/cmabc')
    expect(url.searchParams.get('page')).toBe('3')
    expect(url.searchParams.get('quote')).toBe('billed in advance on the first business day')
  })

  it('carry no quote for a Space fact, whose words are not the contract’s', () => {
    expect(new URL(citationHref(cite({ kind: 'fact' }))!, 'https://x').searchParams.has('quote')).toBe(false)
  })
})

describe('[n] markers', () => {
  it('become links for the refs that have a source, and nothing else', () => {
    expect(linkCitationMarkers('Fee is $4.2M [1]. Rate $3.85 [2]. See [9].', new Set(['1', '2'])))
      .toBe('Fee is $4.2M [1](#cite-1). Rate $3.85 [2](#cite-2). See [9].')
    expect(linkCitationMarkers('A [link](https://x) and [1](#cite-1)', new Set(['1']))).toBe('A [link](https://x) and [1](#cite-1)')
  })
})

describe('chips', () => {
  it('drop a closing bracket the model left on the line', () => {
    const { chips } = parseActionChips('Answer.\n[chip]: Show the pricing schedule\n[chip]: List any indemnification provisions]')
    expect(chips.map(c => c.label)).toEqual(['Show the pricing schedule', 'List any indemnification provisions'])
    expect(parseActionChips('[chip]: Open [Section 3]').chips[0].label).toBe('Open [Section 3]')
  })
})

describe('finding a quote in a PDF page', () => {
  const item = (str: string) => ({ str, transform: [1, 0, 0, 1, 0, 0], width: 100, height: 10 })

  it('matches across text runs, ignoring case, spacing, and quote/dash style', () => {
    const items = [item('Customer shall pay a fixed Monthly Compute'), item('Reservation Fee of'), item('$4,200,000.00 per calendar month — billed in advance.')]
    const hit = locateInItems(items, 'monthly compute reservation fee of $4,200,000.00 per calendar month - billed')
    expect(hit?.start).toEqual([0, 27])
    expect(hit?.end[0]).toBe(2)
    expect(locateInItems(items, 'annual fee')).toBeNull()
    expect(normalizeQuote('“Hello”  —  World')).toBe('"hello" - world')
  })
})
