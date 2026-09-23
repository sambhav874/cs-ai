/**
 * Golden tests for clauseType → ClauseCategory matching.
 *
 * There is no foreign key here: `clauseType` is a free-text label the extractor
 * produces (`limitation_of_liability`) and category names are human-written
 * (`Limitation of Liability`). The join is by normalised name, and per this
 * module's own docstring the same normalisation lived in three places with
 * three different rules before it was consolidated.
 *
 * A miss is SILENT and expensive: the rewriter runs with `hasPlaybook: false`,
 * invents language from the clause alone, and returns something that still
 * looks like a playbook-grounded redline. Nothing in the response says the
 * playbook was lost. That is the worst failure shape this codebase has, and it
 * turns entirely on one regex.
 */
import { describe, it, expect } from 'vitest'
import { normalisedKey, matchCategory, type MatchedCategory } from './clause-category.js'

const cat = (name: string, id = name): MatchedCategory => ({ id, name })

describe('normalisedKey', () => {
  it.each([
    ['limitation_of_liability', 'limitation of liability'],
    ['limitation-of-liability', 'limitation of liability'],
    ['Limitation of Liability', 'limitation of liability'],
    ['LIMITATION  OF   LIABILITY', 'limitation of liability'],
    ['  limitation of liability  ', 'limitation of liability'],
    ['limitation__of--liability', 'limitation of liability'],
    ['limitation_-_of_-_liability', 'limitation of liability'],
  ])('collapses %j', (input, expected) => {
    expect(normalisedKey(input)).toBe(expected)
  })

  it('is idempotent — normalising twice changes nothing', () => {
    const once = normalisedKey('Limitation__of-Liability')
    expect(normalisedKey(once)).toBe(once)
  })

  it('leaves an already-clean key alone', () => {
    expect(normalisedKey('indemnification')).toBe('indemnification')
  })

  it('does NOT strip other punctuation', () => {
    // Pinned as a limitation, not a feature. A category named
    // "Limitation of Liability (Mutual)" will not match clauseType
    // `limitation_of_liability` — the parenthetical survives normalisation. If
    // a customer's taxonomy uses parentheses, this is where it breaks.
    expect(normalisedKey('Limitation of Liability (Mutual)'))
      .toBe('limitation of liability (mutual)')
    expect(normalisedKey('fees & payment')).toBe('fees & payment')
    expect(normalisedKey("supplier's obligations")).toBe("supplier's obligations")
  })

  it('handles the empty string without throwing', () => {
    expect(normalisedKey('')).toBe('')
    expect(normalisedKey('___')).toBe('')
  })
})

describe('matchCategory', () => {
  const categories = [
    cat('Limitation of Liability', 'c1'),
    cat('Indemnification', 'c2'),
    cat('Fees and Payment', 'c3'),
  ]

  it('matches across the separator and casing mismatch that motivated this module', () => {
    expect(matchCategory(categories, 'limitation_of_liability')).toEqual(cat('Limitation of Liability', 'c1'))
    expect(matchCategory(categories, 'limitation-of-liability')).toEqual(cat('Limitation of Liability', 'c1'))
    expect(matchCategory(categories, 'LIMITATION OF LIABILITY')).toEqual(cat('Limitation of Liability', 'c1'))
  })

  it('matches when the CATEGORY is the hyphenated one', () => {
    // The regression named in the module docstring: a category written
    // `limitation-of-liability` resolved in the checker and missed in the
    // rewriter, because only one of the two normalised both sides.
    expect(matchCategory([cat('limitation-of-liability', 'c9')], 'limitation_of_liability'))
      .toEqual(cat('limitation-of-liability', 'c9'))
  })

  it('returns null rather than a near-miss', () => {
    expect(matchCategory(categories, 'termination')).toBeNull()
    expect(matchCategory(categories, '')).toBeNull()
  })

  it('is exact after normalisation — NOT substring containment', () => {
    // One of the three original implementations used substring containment.
    // It is the dangerous one: `liability` would have matched
    // "Limitation of Liability" and quietly applied the wrong playbook.
    expect(matchCategory(categories, 'liability')).toBeNull()
    expect(matchCategory(categories, 'limitation')).toBeNull()
    expect(matchCategory([cat('Fees')], 'fees and payment')).toBeNull()
  })

  it('returns the first match when a taxonomy has duplicates', () => {
    const dupes = [cat('Indemnification', 'first'), cat('indemnification', 'second')]
    expect(matchCategory(dupes, 'indemnification')?.id).toBe('first')
  })

  it('returns null for an empty taxonomy', () => {
    expect(matchCategory([], 'indemnification')).toBeNull()
  })
})

describe('matchCategory — extractor vocabulary', () => {
  // The seeded universal playbook's names.
  const seeded = [
    'Fees & Payment', 'Term & Termination', 'Intellectual Property', 'Representations & Warranties',
    'Limitation of Liability', 'Force Majeure & Excused Events', 'Assignment & Change of Control',
    'Notices & Miscellaneous', 'Dispute Resolution', 'Data Protection & Privacy', 'Confidentiality',
  ].map((n, i) => cat(n, `s${i}`))
  const name = (t: string) => matchCategory(seeded, t)?.name ?? null

  it('maps the review agent\'s clause types onto the seeded playbook', () => {
    expect(name('payment')).toBe('Fees & Payment')
    expect(name('termination')).toBe('Term & Termination')
    expect(name('auto_renewal')).toBe('Term & Termination')
    expect(name('ip_ownership')).toBe('Intellectual Property')
    expect(name('representations_warranties')).toBe('Representations & Warranties')
    expect(name('uncapped_liability')).toBe('Limitation of Liability')
    expect(name('force_majeure')).toBe('Force Majeure & Excused Events')
    expect(name('change_of_control')).toBe('Assignment & Change of Control')
    expect(name('notice')).toBe('Notices & Miscellaneous')
    expect(name('governing_law')).toBe('Dispute Resolution')
    expect(name('data_protection')).toBe('Data Protection & Privacy')
    expect(name('confidential_info_definition')).toBe('Confidentiality')
  })

  it('an exact name still wins over an alias, and "and" is "&"', () => {
    const cats = [cat('Fees & Payment', 'a'), cat('Payment', 'b'), cat('Term and Termination', 'c')]
    expect(matchCategory(cats, 'payment')?.id).toBe('b')
    expect(matchCategory(cats, 'termination')?.id).toBe('c')
  })

  it('types with no counterpart stay unmapped', () => {
    expect(name('non_compete')).toBeNull()
    expect(name('mfn')).toBeNull()
    expect(name('general')).toBeNull()
  })
})
