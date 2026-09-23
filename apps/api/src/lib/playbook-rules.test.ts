import { describe, expect, it } from 'vitest'
import { cleanPhrases, failedRules, phrasesFromRules, rulesWithPhrases, type PlaybookRules } from './playbook-rules.js'
import { judgeByRules } from './playbook-review.js'
import { splitLegacyMarker } from './org-seed/seed.js'

describe('phrase rules', () => {
  it('round-trips through rules with severities from the rung', () => {
    const rules = rulesWithPhrases(null, { mustInclude: ['12 months'], mustNotInclude: ['without notice'] }, 'fallback')
    expect(rules.must_have).toEqual([{ description: 'Should include "12 months"', check: 'contains', value: '12 months', severity: 'high' }])
    expect(rules.must_not?.[0]).toMatchObject({ value: 'without notice', severity: 'high' })
    expect(phrasesFromRules(rules)).toEqual({ mustInclude: ['12 months'], mustNotInclude: ['without notice'] })
  })

  it('walkaway phrases are a stop', () => {
    const rules = rulesWithPhrases(null, { mustNotInclude: ['unlimited liability'] }, 'walkaway')
    expect(rules.must_not?.[0].severity).toBe('walkaway')
  })

  it('keeps regex rules and bounds a person wrote by hand', () => {
    const existing: PlaybookRules = {
      must_have: [{ description: 'cap', check: 'regex', value: 'cap(ped)? at', severity: 'high' }],
      bounds: { capMonths: { min: 12, severity: 'high' } },
    }
    const next = rulesWithPhrases(existing, { mustInclude: ['fees'] }, 'preferred')
    expect(next.must_have?.map(r => r.check)).toEqual(['regex', 'contains'])
    expect(next.bounds).toEqual(existing.bounds)
    expect(phrasesFromRules(next).mustInclude).toEqual(['fees'])
  })

  it('an omitted list is left alone', () => {
    const existing = rulesWithPhrases(null, { mustInclude: ['a'], mustNotInclude: ['b'] }, 'preferred')
    expect(phrasesFromRules(rulesWithPhrases(existing, { mustInclude: ['c'] }, 'preferred'))).toEqual({ mustInclude: ['c'], mustNotInclude: ['b'] })
  })

  it('cleans phrases: trims, collapses spaces, drops blanks and case duplicates', () => {
    expect(cleanPhrases(['  Net  60 ', 'net 60', '', 7, 'x'.repeat(250)])).toEqual(['Net 60', 'x'.repeat(200)])
  })

  it('failed rules are worded at evaluation time', () => {
    const stale: PlaybookRules = { must_not: [{ description: 'old wording', check: 'contains', value: 'no cap', severity: 'walkaway' }] }
    expect(failedRules(stale, 'Liability: no cap applies.', 'walkaway')).toEqual([
      { description: 'Red flag: says "no cap"', severity: 'walkaway', kind: 'must_not', position: 'walkaway' },
    ])
  })
})

describe('judgeByRules', () => {
  const pos = (positionType: string, phrases: { mustInclude?: string[]; mustNotInclude?: string[] }) =>
    ({ positionType, rules: rulesWithPhrases(null, phrases, positionType) })
  const ladder = [
    pos('preferred',  { mustInclude: ['2x', 'consequential damages'] }),
    pos('acceptable', { mustInclude: ['12 months', 'consequential damages'] }),
    pos('fallback',   { mustInclude: ['12 months'] }),
    pos('walkaway',   { mustNotInclude: ['unlimited liability'] }),
  ]

  it('reaches the first rung whose phrases all hold, listing what stops it going higher', () => {
    const r = judgeByRules(ladder, 'Liability capped at 12 months of fees; no consequential damages.')
    expect(r.alignment).toBe('acceptable')
    expect(r.issues.map(i => i.description)).toEqual(['Should include "2x"'])
  })

  it('a clause at preferred has nothing to say', () => {
    expect(judgeByRules(ladder, 'Capped at 2x fees; consequential damages excluded.')).toEqual({ alignment: 'preferred', issues: [] })
  })

  it('no rung holds: outside the playbook', () => {
    expect(judgeByRules(ladder, 'Capped at fees paid.').alignment).toBe('outside_playbook')
  })

  it('a walkaway phrase overrides a rung that otherwise holds', () => {
    const r = judgeByRules(ladder, 'Capped at 12 months, except unlimited liability for data breach.')
    expect(r.alignment).toBe('walkaway')
    expect(r.issues).toHaveLength(1)
  })

  it('without phrases the rules have no view', () => {
    expect(judgeByRules([{ positionType: 'preferred', rules: null }], 'anything')).toEqual({ alignment: null, issues: [] })
  })
})

describe('splitLegacyMarker', () => {
  it('moves the seed key out of the notes', () => {
    expect(splitLegacyMarker('[seed-key:pb-x] Push hard.')).toEqual({ key: 'pb-x', notes: 'Push hard.' })
    expect(splitLegacyMarker('Plain note')).toBeNull()
    expect(splitLegacyMarker(null)).toBeNull()
  })
})
