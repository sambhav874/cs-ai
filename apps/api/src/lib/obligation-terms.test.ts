import { describe, expect, it } from 'vitest'
import {
  ObligationTermsSchema, consequenceLine, formatAmount, nextDueDate, termsHeadline, tierLines,
  type ObligationTerms,
} from '@clm/types'

const terms = (over: Partial<ObligationTerms> = {}): ObligationTerms =>
  ObligationTermsSchema.parse({ tiers: [], exceptions: [], ...over })

describe('termsHeadline', () => {
  it('threshold with operator and aggregation', () => {
    expect(termsHeadline(terms({ operator: '>=', value: 95, unit: '%', aggregation: 'monthly_average' })))
      .toBe('at least 95% · monthly average')
  })

  it('deadline wording', () => {
    expect(termsHeadline(terms({ operator: 'no_later_than', value: 30, unit: 'days' }))).toBe('no later than 30 days')
  })

  it('range', () => {
    expect(termsHeadline(terms({ valueMin: 2, valueMax: 4, unit: 'hours', period: 'per_event' }))).toBe('between 2 hours and 4 hours')
  })

  it('tiers win over a stray single value', () => {
    expect(termsHeadline(terms({ value: 180, tiers: [{ label: 'T1' }, { label: 'T2' }] as never }))).toBe('2 tiers')
  })

  it('nothing to say is null, not an empty string', () => {
    expect(termsHeadline(terms())).toBeNull()
    expect(termsHeadline(null)).toBeNull()
  })

  it('an unknown operator is humanised, not dropped', () => {
    expect(termsHeadline(terms({ operator: 'not_less_than', value: 3 }))).toBe('not less than 3')
  })
})

describe('consequenceLine', () => {
  it('amount with currency and mechanism', () => {
    expect(consequenceLine(terms({ consequence: { value: 12000, unit: 'per 0.1 percentage point', currency: 'usd', mechanism: 'service_credit' } })))
      .toBe('USD 12,000 per 0.1 percentage point · service credit')
  })

  it('does not repeat a unit that is the currency', () => {
    expect(consequenceLine(terms({ consequence: { value: 5000, unit: 'USD', currency: 'USD' } }))).toBe('USD 5,000')
  })

  it('mechanism alone', () => {
    expect(consequenceLine(terms({ consequence: { mechanism: 'termination_right' } }))).toBe('termination right')
  })
})

describe('tierLines', () => {
  it('reads each tier', () => {
    expect(tierLines(terms({ tiers: [
      { label: 'Tier 1', range: '99.990%-99.994%', creditPct: 5 },
      { label: 'Band B', range: '3,000-5,000 kg', value: 420, unit: 'per turn', currency: 'EUR' },
      { label: 'Tier 3' },
    ] as never }))).toEqual([
      'Tier 1: 99.990%-99.994% → 5% credit',
      'Band B: 3,000-5,000 kg → EUR 420 per turn',
      'Tier 3',
    ])
  })
})

describe('formatAmount', () => {
  it('units', () => {
    expect(formatAmount(1250000, null, 'usd')).toBe('USD 1,250,000')
    expect(formatAmount(99.5, 'percent')).toBe('99.5%')
    expect(formatAmount(25, '$')).toBe('$25')
    expect(formatAmount(null, '%')).toBeNull()
  })
})

describe('nextDueDate', () => {
  const d = (s: string) => new Date(`${s}T09:00:00.000Z`)
  const iso = (x: Date | null) => x?.toISOString().slice(0, 10)

  it('steps by recurrence', () => {
    expect(iso(nextDueDate(d('2027-03-10'), 'daily'))).toBe('2027-03-11')
    expect(iso(nextDueDate(d('2027-03-10'), 'weekly'))).toBe('2027-03-17')
    expect(iso(nextDueDate(d('2027-03-10'), 'monthly'))).toBe('2027-04-10')
    expect(iso(nextDueDate(d('2027-03-10'), 'quarterly'))).toBe('2027-06-10')
    expect(iso(nextDueDate(d('2027-03-10'), 'annually'))).toBe('2028-03-10')
  })

  it('clamps month ends and keeps the anchor day', () => {
    const feb = nextDueDate(d('2027-01-31'), 'monthly')
    expect(iso(feb)).toBe('2027-02-28')
    expect(iso(nextDueDate(feb!, 'monthly', 31))).toBe('2027-03-31')
    expect(iso(nextDueDate(d('2028-01-31'), 'monthly'))).toBe('2028-02-29')
  })

  it('keeps the time of day', () => {
    expect(nextDueDate(d('2027-03-10'), 'monthly')?.toISOString()).toBe('2027-04-10T09:00:00.000Z')
  })

  it('one-off and unknown recurrences have no next date', () => {
    for (const r of ['one-time', 'on-event', 'unknown', null]) expect(nextDueDate(d('2027-03-10'), r)).toBeNull()
  })
})
