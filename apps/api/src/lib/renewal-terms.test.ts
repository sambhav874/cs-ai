import { describe, expect, it } from 'vitest'
import {
  ObligationTermsSchema, autoRenewOf, noticeFromKeyTerms, noticeFromTerms, parseNoticePeriod,
  renewalTerms, subtractNotice, type ObligationTerms,
} from '@clm/types'
import { inBucket } from '../routes/renewals.js'
import { renewalMessage } from './obligation-scanner.js'
import { daysFromToday } from './renewal-terms.js'

const d = (s: string) => new Date(`${s}T00:00:00.000Z`)
const ymd = (x: Date | null) => x?.toISOString().slice(0, 10) ?? null
const terms = (over: Partial<ObligationTerms>): ObligationTerms =>
  ObligationTermsSchema.parse({ tiers: [], exceptions: [], ...over })

describe('parseNoticePeriod', () => {
  it('numbers are days', () => {
    expect(parseNoticePeriod(90)).toEqual({ amount: 90, unit: 'days' })
    expect(parseNoticePeriod(0)).toBeNull()
    expect(parseNoticePeriod(-5)).toBeNull()
  })

  it('phrases people and models write', () => {
    expect(parseNoticePeriod('90 days')).toEqual({ amount: 90, unit: 'days' })
    expect(parseNoticePeriod('90')).toEqual({ amount: 90, unit: 'days' })
    expect(parseNoticePeriod("60 days' notice")).toEqual({ amount: 60, unit: 'days' })
    expect(parseNoticePeriod('30 days prior written notice')).toEqual({ amount: 30, unit: 'days' })
    expect(parseNoticePeriod('12 weeks')).toEqual({ amount: 84, unit: 'days' })
    expect(parseNoticePeriod('3 months')).toEqual({ amount: 3, unit: 'months' })
    expect(parseNoticePeriod('1 year')).toEqual({ amount: 12, unit: 'months' })
  })

  it('refuses to guess', () => {
    expect(parseNoticePeriod('30-60 days')).toBeNull()
    expect(parseNoticePeriod('10 business days')).toBeNull()
    expect(parseNoticePeriod('reasonable notice')).toBeNull()
    expect(parseNoticePeriod('')).toBeNull()
    expect(parseNoticePeriod(null)).toBeNull()
  })
})

describe('noticeFromKeyTerms', () => {
  it('a reviewer correction outranks the extraction', () => {
    expect(noticeFromKeyTerms({ noticePeriodDays: 30, noticePeriod: '60 days' })).toEqual({ amount: 60, unit: 'days' })
  })

  it('reads every spelling and {value, quote} records', () => {
    expect(noticeFromKeyTerms({ noticePeriodDays: '45' })?.amount).toBe(45)
    expect(noticeFromKeyTerms({ noticeDays: 30 })?.amount).toBe(30)
    expect(noticeFromKeyTerms({ renewalNoticeDays: 120 })?.amount).toBe(120)
    expect(noticeFromKeyTerms({ noticePeriodDays: { value: 90, quote: 'ninety (90) days' } })?.amount).toBe(90)
  })

  it('an unreadable correction falls through to the next spelling', () => {
    expect(noticeFromKeyTerms({ noticePeriod: 'see clause 4', noticePeriodDays: 30 })?.amount).toBe(30)
  })
})

describe('noticeFromTerms', () => {
  it('reads an obligation stating days or months', () => {
    expect(noticeFromTerms(terms({ operator: 'no_later_than', value: 90, unit: 'days' }))).toEqual({ amount: 90, unit: 'days' })
    expect(noticeFromTerms(terms({ value: 6, unit: 'months' }))).toEqual({ amount: 6, unit: 'months' })
  })

  it('no unit, a percentage or a range is not a notice period', () => {
    expect(noticeFromTerms(terms({ value: 90 }))).toBeNull()
    expect(noticeFromTerms(terms({ value: 95, unit: '%' }))).toBeNull()
    expect(noticeFromTerms(terms({ value: 60, valueMax: 90, unit: 'days' }))).toBeNull()
  })
})

describe('autoRenewOf', () => {
  it('booleans and the strings extractors write', () => {
    expect(autoRenewOf({ autoRenew: true })).toBe(true)
    expect(autoRenewOf({ autoRenew: 'false' })).toBe(false)
    expect(autoRenewOf({ auto_renew: 'Yes' })).toBe(true)
    expect(autoRenewOf({ autoRenew: { value: true } })).toBe(true)
    expect(autoRenewOf({ autoRenew: 'maybe' })).toBeNull()
    expect(autoRenewOf(null)).toBeNull()
  })
})

describe('subtractNotice', () => {
  it('months clamp at month end', () => {
    expect(ymd(subtractNotice(d('2027-05-31'), { amount: 3, unit: 'months' }))).toBe('2027-02-28')
    expect(ymd(subtractNotice(d('2028-05-31'), { amount: 3, unit: 'months' }))).toBe('2028-02-29')
    expect(ymd(subtractNotice(d('2027-03-15'), { amount: 12, unit: 'months' }))).toBe('2026-03-15')
  })
})

describe('renewalTerms', () => {
  it('auto-renewing with notice acts by the deadline', () => {
    const r = renewalTerms({ expiryDate: d('2027-06-30'), keyTerms: { autoRenew: true, noticePeriodDays: 90 } })
    expect(ymd(r.noticeDeadline)).toBe('2027-04-01')
    expect(ymd(r.actBy)).toBe('2027-04-01')
    expect(r).toMatchObject({ autoRenew: true, noticeDays: 90, noticeSource: 'key_terms' })
  })

  it('a contract that does not renew acts by expiry', () => {
    const r = renewalTerms({ expiryDate: d('2027-06-30'), keyTerms: { autoRenew: false, noticePeriodDays: 90 } })
    expect(r.noticeDeadline).toBeNull()
    expect(ymd(r.actBy)).toBe('2027-06-30')
  })

  it('unknown renewal type with a notice period still acts by the deadline', () => {
    const r = renewalTerms({ expiryDate: d('2027-06-30'), keyTerms: { noticePeriod: '3 months' } })
    expect(r.autoRenew).toBeNull()
    expect(ymd(r.actBy)).toBe('2027-03-30')
    expect(r.noticeDays).toBe(92)
  })

  it('falls back to the longest renewal obligation', () => {
    const r = renewalTerms({
      expiryDate: d('2027-06-30'),
      keyTerms: { autoRenew: true },
      obligationTerms: [terms({ value: 30, unit: 'days' }), null, terms({ value: 60, unit: 'days' })],
    })
    expect(r).toMatchObject({ noticeDays: 60, noticeSource: 'obligation' })
    expect(ymd(r.actBy)).toBe('2027-05-01')
  })

  it('key terms beat an obligation', () => {
    const r = renewalTerms({
      expiryDate: d('2027-06-30'), keyTerms: { noticePeriodDays: 30 },
      obligationTerms: [terms({ value: 90, unit: 'days' })],
    })
    expect(r).toMatchObject({ noticeDays: 30, noticeSource: 'key_terms' })
  })

  it('no expiry, no dates', () => {
    const r = renewalTerms({ expiryDate: null, keyTerms: { autoRenew: true, noticePeriodDays: 90 } })
    expect(r).toMatchObject({ expiryDate: null, noticeDeadline: null, actBy: null, noticeDays: 90 })
  })

  it('garbage key terms are ignored', () => {
    expect(ymd(renewalTerms({ expiryDate: '2027-06-30', keyTerms: ['x'] }).actBy)).toBe('2027-06-30')
    expect(renewalTerms({ expiryDate: 'not a date' }).actBy).toBeNull()
  })
})

describe('buckets', () => {
  const now = new Date('2027-01-10T15:00:00.000Z')
  it('are day-granular: today is due, not overdue', () => {
    expect(inBucket('overdue', d('2027-01-10'), now)).toBe(false)
    expect(inBucket('this_week', d('2027-01-10'), now)).toBe(true)
    expect(inBucket('overdue', d('2027-01-09'), now)).toBe(true)
    expect(inBucket('next_30', d('2027-02-09'), now)).toBe(true)
    expect(inBucket('next_30', d('2027-02-10'), now)).toBe(false)
    expect(daysFromToday(d('2027-01-17'), now)).toBe(7)
  })
})

describe('renewalMessage', () => {
  const c = { title: 'Acme MSA', counterpartyName: 'Acme', value: 120000, currency: 'USD' }
  const now = d('2027-03-02')

  it('leads with the notice deadline', () => {
    const r = renewalTerms({ expiryDate: d('2027-06-30'), keyTerms: { autoRenew: true, noticePeriodDays: 90 } })
    const m = renewalMessage(c, r, now)
    expect(m.title).toBe('Notice due in 30d · Acme MSA')
    expect(m.body).toContain('Renews automatically on 30 Jun 2027 unless notice is served by 1 Apr 2027 (90 days\' notice)')
  })

  it('says when the deadline has passed', () => {
    const r = renewalTerms({ expiryDate: d('2027-05-30'), keyTerms: { noticePeriodDays: 90 } })
    expect(renewalMessage(c, r, now).title).toBe('Notice deadline passed 1d ago · Acme MSA')
    expect(renewalMessage(c, r, now).body).toContain('may renew automatically on 30 May 2027')
  })

  it('falls back to expiry wording', () => {
    const r = renewalTerms({ expiryDate: d('2027-03-12'), keyTerms: { autoRenew: false } })
    expect(renewalMessage(c, r, now)).toEqual({ title: 'Expires in 10d · Acme MSA', body: 'Acme · USD 120000 — review renewal options now.' })
  })
})
