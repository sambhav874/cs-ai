import { describe, expect, it } from 'vitest'
import {
  extractedFields, frequencyToRecurrence, partyToOwner, planSync, SyncPayloadSchema,
  toObligationType, type StoredRow, type SyncRecord,
} from './obligation-sync.js'

const rec = (externalId: string, over: Partial<SyncRecord> = {}): SyncRecord => ({
  externalId,
  name: 'On-time delivery',
  description: 'Deliver 95% of critical-lane loads on time',
  kpiType: 'sla',
  obligationClass: null,
  partyRole: 'supplier',
  frequency: 'monthly',
  trigger: null,
  quote: 'Critical Lane On-Time Delivery below 95.0% in any month.',
  page: 3,
  section: 'Section 9.01',
  needsReview: false,
  packId: 'logistics',
  packVersion: '1.2.0',
  ...over,
})

const row = (id: string, externalId: string | null, over: Partial<StoredRow> = {}): StoredRow => ({
  id, externalId, status: 'OPEN', assigneeId: null, ...over,
})

describe('planSync', () => {
  it('updates matched rows and creates new ones', () => {
    const plan = planSync([row('o1', 'k1')], [rec('k1'), rec('k2')])
    expect(plan.update).toEqual([{ id: 'o1', record: rec('k1') }])
    expect(plan.create.map(r => r.externalId)).toEqual(['k2'])
    expect(plan.delete).toEqual([])
    expect(plan.orphan).toEqual([])
  })

  it('deletes an untouched row the latest run no longer finds', () => {
    expect(planSync([row('o1', 'gone')], []).delete).toEqual(['o1'])
  })

  it('keeps and flags a vanished row someone has worked on', () => {
    const plan = planSync([
      row('assigned', 'g1', { assigneeId: 'u1' }),
      row('done', 'g2', { status: 'COMPLETED' }),
      row('waived', 'g3', { status: 'WAIVED' }),
      row('overdue', 'g4', { status: 'OVERDUE' }),
    ], [])
    expect(plan.orphan).toEqual(['assigned', 'done', 'waived'])
    expect(plan.delete).toEqual(['overdue'])
  })

  it('collapses duplicate external ids in one payload to one row', () => {
    const plan = planSync([], [rec('k1'), rec('k1', { description: 'dup' })])
    expect(plan.create).toHaveLength(1)
    expect(plan.create[0].description).toBe('Deliver 95% of critical-lane loads on time')
  })

  it('an empty completed run clears only untouched rows', () => {
    const plan = planSync([row('a', 'k1'), row('b', 'k2', { assigneeId: 'u' })], [])
    expect(plan.delete).toEqual(['a'])
    expect(plan.orphan).toEqual(['b'])
  })
})

describe('extractedFields', () => {
  it('maps ContractSense vocabulary and never carries person-owned fields', () => {
    const fields = extractedFields(rec('k1'))
    expect(fields).toEqual({
      type: 'sla',
      description: 'Deliver 95% of critical-lane loads on time',
      owner: 'provider',
      recurrence: 'monthly',
      trigger: null,
      quote: 'Critical Lane On-Time Delivery below 95.0% in any month.',
      page: 3,
      sectionRef: 'Section 9.01',
      needsReview: false,
      packId: 'logistics',
      packVersion: '1.2.0',
      terms: null,
      ruleType: null,
    })
    for (const key of ['assigneeId', 'dueDate', 'status', 'completedAt', 'severity']) {
      expect(fields).not.toHaveProperty(key)
    }
  })

  it('falls back to name, then quote, for the description', () => {
    expect(extractedFields(rec('k', { description: null })).description).toBe('On-time delivery')
    expect(extractedFields(rec('k', { description: null, name: null })).description)
      .toBe('Critical Lane On-Time Delivery below 95.0% in any month.')
  })
})

describe('vocabulary', () => {
  it('party roles', () => {
    expect(partyToOwner('supplier')).toBe('provider')
    expect(partyToOwner('client')).toBe('customer')
    expect(partyToOwner('mutual')).toBe('either')
    expect(partyToOwner(null)).toBe('unknown')
    expect(partyToOwner('carrier')).toBe('unknown')
  })

  it('frequencies', () => {
    expect(frequencyToRecurrence('quarterly')).toBe('quarterly')
    expect(frequencyToRecurrence('hourly')).toBe('daily')
    expect(frequencyToRecurrence('per_actual')).toBe('on-event')
    expect(frequencyToRecurrence('per_invoice')).toBe('on-event')
    expect(frequencyToRecurrence(undefined)).toBe('unknown')
  })

  it('types', () => {
    expect(toObligationType('penalty')).toBe('payment')
    expect(toObligationType('sla')).toBe('sla')
    expect(toObligationType('timeline', 'renewal_notice')).toBe('renewal')
    expect(toObligationType('obligation', 'termination_right')).toBe('termination')
    expect(toObligationType('reporting')).toBe('report')
    expect(toObligationType(null, null)).toBe('other')
  })

  it('reads the name when the type is generic', () => {
    expect(toObligationType('obligation', null, 'Renewal Notice Period')).toBe('renewal')
    expect(toObligationType('obligation', null, 'Monthly Performance Report Delivery')).toBe('report')
    expect(toObligationType('obligation', null, 'Payment Deadline: Invoice Payment within 30 Days')).toBe('payment')
    expect(toObligationType('obligation', null, 'Insurance Floor: Goods-in-Transit Coverage')).toBe('compliance')
    expect(toObligationType('obligation', null, 'Confidentiality Retention Period')).toBe('compliance')
    expect(toObligationType('obligation', null, 'Collect and Deliver Goods')).toBe('other')
    // A specific type still wins over the name.
    expect(toObligationType('penalty', null, 'Band: On-time Delivery <95% Credit')).toBe('payment')
  })
})

describe('terms', () => {
  it('carry through and lift ruleType for filtering', () => {
    const terms = { ruleType: 'threshold', operator: '>=', value: 95, unit: '%', tiers: [], exceptions: [] }
    const fields = extractedFields(rec('k', { terms } as never))
    expect(fields.ruleType).toBe('threshold')
    expect(fields.terms).toEqual(terms)
  })

  it('the payload validator rejects a malformed tier rather than storing it', () => {
    const bad = SyncPayloadSchema.safeParse({
      platformContractId: 'c1', status: 'success',
      records: [{ ...rec('k1'), terms: { tiers: [{ label: 'T1', value: 'lots' }] } }],
    })
    expect(bad.success).toBe(false)
  })
})

describe('SyncPayloadSchema', () => {
  it('rejects a record without a quote', () => {
    const bad = SyncPayloadSchema.safeParse({
      platformContractId: 'c1', status: 'success',
      records: [{ ...rec('k1'), quote: '' }],
    })
    expect(bad.success).toBe(false)
  })

  it('accepts an error run with no register', () => {
    const ok = SyncPayloadSchema.safeParse({ platformContractId: 'c1', status: 'error', error: 'boom', records: null })
    expect(ok.success).toBe(true)
  })
})
