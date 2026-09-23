/**
 * Intake → template: fill a template's variables from a contract request, so
 * converting a request never asks anyone to re-type what the requester said.
 *
 * Only facts the request actually carries are filled. Anything else (an
 * effective date, a governing law) stays an unfilled placeholder the drafter
 * sees in the editor — never a guess.
 *
 * PURE: no database, so the mapping is unit-tested.
 */
import type { VariableMap } from './template-engine.js'

export interface RequestFacts {
  title:            string
  type:             string
  description:      string | null
  counterpartyName: string | null
  estimatedValue:   number | null
  requesterName:    string | null
  metadata:         Record<string, unknown>
}

/** Template variable keys (normalised) → the request fact they mean. */
const ALIASES: Record<string, keyof Omit<RequestFacts, 'metadata'>> = {
  counterparty: 'counterpartyName', counterpartyname: 'counterpartyName', partyb: 'counterpartyName',
  customername: 'counterpartyName', vendorname: 'counterpartyName', suppliername: 'counterpartyName',
  value: 'estimatedValue', contractvalue: 'estimatedValue', estimatedvalue: 'estimatedValue',
  amount: 'estimatedValue', totalvalue: 'estimatedValue',
  title: 'title', contracttitle: 'title',
  contracttype: 'type', type: 'type',
  description: 'description', scope: 'description', scopeofwork: 'description', purpose: 'description',
  requester: 'requesterName', requestername: 'requesterName', requestedby: 'requesterName',
}

const norm = (key: string) => key.toLowerCase().replace(/[^a-z0-9]/g, '')

export function requestTemplateVariables(
  facts: RequestFacts,
  variableDefs: Array<{ key: string }>,
): VariableMap {
  const vars: VariableMap = {}
  const metaByNorm = new Map(Object.entries(facts.metadata ?? {}).map(([k, v]) => [norm(k), v]))
  for (const { key } of variableDefs) {
    if (!key) continue
    // An intake field named exactly like the variable wins: it is the most
    // specific thing the requester told us.
    const fromMeta = metaByNorm.get(norm(key))
    if (isScalar(fromMeta)) { vars[key] = fromMeta; continue }
    const fact = ALIASES[norm(key)]
    const value = fact ? facts[fact] : null
    if (value !== null && value !== undefined && value !== '') vars[key] = value
  }
  return vars
}

function isScalar(v: unknown): v is string | number | boolean {
  return (typeof v === 'string' && v.trim() !== '') || typeof v === 'number' || typeof v === 'boolean'
}
