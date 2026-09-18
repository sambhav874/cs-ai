import { describe, it, expect } from 'vitest'
import { splitHtmlIntoSections, stripTags } from './template-import.js'

describe('stripTags', () => {
  it('removes markup and collapses whitespace', () => {
    expect(stripTags('<p>Hello   <strong>world</strong></p>')).toBe('Hello world')
  })

  it('treats &nbsp; as whitespace', () => {
    expect(stripTags('<p>&nbsp;</p>')).toBe('')
  })

  it('returns empty for markup-only content', () => {
    expect(stripTags('<p></p>')).toBe('')
  })
})

describe('splitHtmlIntoSections', () => {
  it('falls back to a single section when the document has no headings', () => {
    const html = '<p>First para.</p><p>Second para.</p>'
    const out = splitHtmlIntoSections(html, 'Mutual NDA')

    expect(out).toHaveLength(1)
    expect(out[0].title).toBe('Mutual NDA')
    expect(out[0].content).toBe(html)
    expect(out[0].sortOrder).toBe(0)
  })

  it('creates one section per heading, in order', () => {
    const html =
      '<h1>Definitions</h1><p>A.</p>' +
      '<h1>Term</h1><p>B.</p>' +
      '<h1>Governing Law</h1><p>C.</p>'
    const out = splitHtmlIntoSections(html, 'Fallback')

    expect(out.map(s => s.title)).toEqual(['Definitions', 'Term', 'Governing Law'])
    expect(out.map(s => s.sortOrder)).toEqual([0, 1, 2])
  })

  it('strips the promoted heading from the section body', () => {
    // Critical: template-engine re-emits section.title as an <h2>. If the
    // original heading stayed in the content, every heading would render twice.
    const out = splitHtmlIntoSections('<h1>Confidentiality</h1><p>Body text.</p>', 'Fallback')

    expect(out[0].title).toBe('Confidentiality')
    expect(out[0].content).toBe('<p>Body text.</p>')
    expect(out[0].content).not.toContain('Confidentiality')
  })

  it('handles h2 headings and nested markup in the heading', () => {
    const out = splitHtmlIntoSections('<h2><strong>Payment  Terms</strong></h2><p>Net 30.</p>', 'Fallback')

    expect(out[0].title).toBe('Payment Terms')
    expect(out[0].content).toBe('<p>Net 30.</p>')
  })

  it('keeps a preamble before the first heading as its own section', () => {
    const out = splitHtmlIntoSections('<p>Preamble.</p><h1>Term</h1><p>One year.</p>', 'Service Agreement')

    expect(out).toHaveLength(2)
    // The leading chunk has no heading to promote, so it takes the fallback.
    expect(out[0].title).toBe('Service Agreement')
    expect(out[0].content).toBe('<p>Preamble.</p>')
    expect(out[1].title).toBe('Term')
    expect(out[1].content).toBe('<p>One year.</p>')
  })

  it('names an untitled heading section rather than leaving it blank', () => {
    const out = splitHtmlIntoSections('<h1>Intro</h1><p>A.</p><h1></h1><p>B.</p>', 'Fallback')

    expect(out[1].title).toBe('Section 2')
    expect(out[1].title).not.toBe('')
  })

  it('tolerates headings carrying attributes', () => {
    const out = splitHtmlIntoSections('<h1 id="x" class="y">Scope</h1><p>Work.</p>', 'Fallback')

    expect(out[0].title).toBe('Scope')
    expect(out[0].content).toBe('<p>Work.</p>')
  })

  it('produces a section with empty content when a heading has no body', () => {
    const out = splitHtmlIntoSections('<h1>Signatures</h1>', 'Fallback')

    expect(out[0].title).toBe('Signatures')
    expect(out[0].content).toBe('')
  })

  it('never returns zero sections for an empty document', () => {
    const out = splitHtmlIntoSections('', 'Untitled template')

    expect(out).toHaveLength(1)
    expect(out[0].title).toBe('Untitled template')
  })
})
