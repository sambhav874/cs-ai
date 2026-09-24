import { prisma } from './prisma.js'

// Prisma's JSON path filters ({ path: [...], gte }) are relational-only; on
// MongoDB they fail validation. These helpers query the nested field directly
// with findRaw and hand back ids, so the caller keeps its ordinary where clause
// and adds `{ id: { in: ids } }`.

export interface NumberRange { gte?: number; lte?: number }

/** A Mongo filter for a numeric range, or null when neither bound is set. */
export function rangeFilter(range: NumberRange): Record<string, number> | null {
  const out: Record<string, number> = {}
  if (range.gte !== undefined) out.$gte = range.gte
  if (range.lte !== undefined) out.$lte = range.lte
  return Object.keys(out).length ? out : null
}

type RawRow = { _id: unknown }

function ids(rows: unknown): string[] {
  return (rows as RawRow[]).map(r => String(r._id))
}

/** Ids of an org's contracts whose metadata fields fall inside the given ranges. */
export async function contractIdsByMetadata(
  orgId: string,
  ranges: Record<string, NumberRange>,
): Promise<string[] | null> {
  const filter: Record<string, string | Record<string, number>> = { orgId }
  for (const [field, range] of Object.entries(ranges)) {
    const f = rangeFilter(range)
    if (f) filter[`metadata.${field}`] = f
  }
  if (Object.keys(filter).length === 1) return null
  return ids(await prisma.contract.findRaw({ filter, options: { projection: { _id: 1 } } }))
}

/** Ids of an org's audit events whose metadata names this contract. */
export async function auditIdsForContract(orgId: string, contractId: string, actions: string[]): Promise<string[]> {
  return ids(await prisma.auditEvent.findRaw({
    filter:  { orgId, 'metadata.contractId': contractId, action: { $in: actions } },
    options: { projection: { _id: 1 } },
  }))
}
