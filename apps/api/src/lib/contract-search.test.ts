import { describe, it, expect } from 'vitest'
import { excerpt, nameWords } from './contract-search.js'

describe('nameWords', () => {
  it('drops stop words and punctuation', () => {
    expect(nameWords('the Acme Corporation Master Services Agreement')).toEqual(['acme', 'corporation', 'master', 'services'])
    expect(nameWords('Globex — NDA')).toEqual(['globex', 'nda'])
  })
})

describe('excerpt', () => {
  it('wraps the first match in <em> with context either side', () => {
    const text = `${'x'.repeat(200)} the Supplier shall indemnify the Customer ${'y'.repeat(200)}`
    const out = excerpt(text, /indemnify/i, 20)!
    expect(out).toMatch(/^….{20}<em>indemnify<\/em>.{20}…$/)
  })

  it('keeps the matched text as written and collapses whitespace', () => {
    expect(excerpt('Force\n\nMajeure applies', /majeure/i)).toBe('Force <em>Majeure</em> applies')
  })

  it('returns null when nothing matches', () => {
    expect(excerpt('no match here', /indemnity/i)).toBeNull()
  })
})
