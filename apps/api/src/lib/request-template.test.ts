import { describe, expect, it } from 'vitest'
import { requestTemplateVariables, type RequestFacts } from './request-template.js'
import { interpolateVariables } from './template-engine.js'

const facts: RequestFacts = {
  title: 'Northstar logistics MSA',
  type: 'MSA',
  description: 'Managed transportation for five DCs',
  counterpartyName: 'Northstar Freight & Fulfillment LLC',
  estimatedValue: 5_400_000,
  requesterName: 'Maya Ortiz',
  metadata: { governing_law: 'New York', notes: { nested: true } },
}

describe('requestTemplateVariables', () => {
  it('fills aliases from request facts, whatever the variable naming style', () => {
    const vars = requestTemplateVariables(facts, [
      { key: 'counterparty_name' }, { key: 'CounterpartyName' }, { key: 'contractValue' },
      { key: 'scope' }, { key: 'requester' }, { key: 'contract_type' },
    ])
    expect(vars).toEqual({
      counterparty_name: 'Northstar Freight & Fulfillment LLC',
      CounterpartyName: 'Northstar Freight & Fulfillment LLC',
      contractValue: 5_400_000,
      scope: 'Managed transportation for five DCs',
      requester: 'Maya Ortiz',
      contract_type: 'MSA',
    })
  })

  it('prefers an intake field named like the variable', () => {
    expect(requestTemplateVariables(facts, [{ key: 'governingLaw' }])).toEqual({ governingLaw: 'New York' })
  })

  it('never guesses: unknown keys, missing facts and non-scalar fields stay unfilled', () => {
    const vars = requestTemplateVariables({ ...facts, counterpartyName: null }, [
      { key: 'effective_date' }, { key: 'counterparty' }, { key: 'notes' },
    ])
    expect(vars).toEqual({})
  })
})

describe('interpolateVariables', () => {
  it('escapes values so request text cannot inject markup', () => {
    const { html } = interpolateVariables('<p>{{counterparty}}</p>', { counterparty: '<img src=x onerror=alert(1)>' })
    expect(html).toBe('<p>&lt;img src=x onerror=alert(1)&gt;</p>')
  })

  it('escapes ampersands and quotes in ordinary names', () => {
    const { html } = interpolateVariables('{{n}}', { n: `Northstar Freight & "Fulfillment"` })
    expect(html).toBe('Northstar Freight &amp; &quot;Fulfillment&quot;')
  })
})
