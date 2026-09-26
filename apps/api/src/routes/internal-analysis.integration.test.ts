/**
 * The key-term analysis sync: what ContractSense's extractor sends does to a
 * contract. Verified terms land with their quotes and pages, absent terms stay
 * absent without clearing anything a person filled in, a superseded run is
 * ignored, and the clauses go on to chunk-and-index and the playbook review.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'

const queued = vi.hoisted(() => ({ chunk: [] as unknown[], usage: [] as unknown[] }))
vi.mock('../lib/queue.js', async orig => ({
  ...(await orig<typeof import('../lib/queue.js')>()),
  queueChunkAndIndex: (job: unknown) => { queued.chunk.push(job) },
}))
vi.mock('../lib/costCap.js', async orig => ({
  ...(await orig<typeof import('../lib/costCap.js')>()),
  recordUsage: async (...args: unknown[]) => { queued.usage.push(args) },
}))

import { prisma } from '../lib/prisma.js'
import { getApp, closeApp, makeOrg, makeUser, makeContract, cleanupAll, type TestApp } from '../test-support/helpers.js'

let app: TestApp
let org: string, owner: string
const SECRET = { 'x-internal-secret': process.env.INTERNAL_SERVICE_SECRET ?? '' }

async function contractWithVersion(over: { metadata?: Record<string, unknown>; fieldConfidence?: Record<string, unknown>; counterpartyName?: string; currency?: string } = {}) {
  const id = await makeContract(org, owner, { title: 'upload-2025-03.pdf', type: 'MSA' })
  const version = await prisma.contractVersion.create({
    data: { contractId: id, versionNumber: 1, plainText: 'text', createdById: owner },
    select: { id: true },
  })
  await prisma.contract.update({
    where: { id },
    data: {
      currentVersionId: version.id,
      analysisStatus: 'EXTRACTING',
      counterpartyName: over.counterpartyName ?? null,
      currency: over.currency ?? null,
      fieldConfidence: (over.fieldConfidence ?? {}) as never,
      keyTerms: { governingLaw: 'Scotland' } as never,
      metadata: {
        obligationExtraction: { status: 'success' },
        keyTermAnalysis: { runId: 'run-1', status: 'running', triggeredBy: 'upload' },
        ...over.metadata,
      } as never,
    },
  })
  return { id, versionId: version.id }
}

const term = (value: unknown, quote: string, page = 2) =>
  ({ value, quote, section: null, confidence: 0.9, issue: null, page, pageEnd: page, spanStart: 10, spanEnd: 40 })

function payload(id: string, versionId: string, over: Record<string, unknown> = {}) {
  return {
    platformContractId: id, versionId, runId: 'run-1', status: 'success', source: 'analysis_copy', warnings: [],
    usage: { calls: 4, inputTokens: 12000, outputTokens: 900, provider: 'anthropic', model: 'claude-x', byok: true },
    analysis: {
      fields: {
        effectiveDate: term('2025-03-01', 'commences on 1 March 2025', 1),
        value: term(1500000, 'a total fee of £1,500,000'),
        governingLaw: term('England and Wales', 'governed by the laws of England and Wales', 3),
      },
      absent: { currency: 'no_quote', expiryDate: 'not_stated' },
      parties: [
        { role: 'Client', name: 'Northwind Retail plc', quote: 'Northwind Retail plc ("Client")', page: 1 },
        { role: 'Supplier', name: 'Acme Logistics Ltd', quote: 'Acme Logistics Ltd ("Supplier")', page: 1 },
      ],
      clauseFlags: { limitationOfLiability: true },
      typeFields: {},
      customFields: { po_number: term('PO-7', 'Purchase order PO-7') },
      openEndedFindings: [],
      clauses: [
        { clauseType: 'payment', content: 'The Client shall pay the Supplier a total fee of £1,500,000.', interpretation: null,
          riskRating: 'neutral', sectionRef: '2', sortOrder: 0, page: 2, pageEnd: 2, spanStart: 100, spanEnd: 160 },
        { clauseType: 'termination', content: 'Either party may terminate on ninety (90) days written notice.', interpretation: 'Exit on notice.',
          riskRating: null, sectionRef: '3', sortOrder: 1, page: 2, pageEnd: 3, spanStart: 200, spanEnd: 262 },
      ],
      contractType: 'MSA', suggestedTitle: 'Acme – Northwind Services Agreement', summary: 'A services agreement.',
      riskScore: 0.4, riskFactors: ['Capped liability'], overallConfidence: 0.9, hasPages: true,
      ledger: { fieldsProposed: 5, fieldsVerified: 3, fieldsDropped: 1, clausesProposed: 3, clausesKept: 2, clausesDropped: 1 },
    },
    ...over,
  }
}

const sync = (id: string, body: unknown, headers: Record<string, string> = SECRET) =>
  app.inject({ method: 'POST', url: `/api/internal/contracts/${id}/analysis/sync`, headers, payload: body as object })

beforeAll(async () => {
  app = await getApp()
  org = await makeOrg('Northwind Retail plc')
  owner = await makeUser(org)
})
beforeEach(() => { queued.chunk.length = 0; queued.usage.length = 0 })
afterAll(async () => { await cleanupAll(); await closeApp() })

describe('POST /api/internal/contracts/:id/analysis/sync', () => {
  it('writes verified terms with their evidence, and records absences without defaulting', async () => {
    const { id, versionId } = await contractWithVersion({ metadata: { po_number: 'PO-HUMAN' } })
    const res = await sync(id, payload(id, versionId))
    expect(res.statusCode).toBe(200)

    const c = await prisma.contract.findUniqueOrThrow({ where: { id } })
    const kt = c.keyTerms as Record<string, unknown>
    const fc = c.fieldConfidence as Record<string, Record<string, unknown>>
    expect(kt.governingLaw).toBe('England and Wales')
    expect(fc.governingLaw).toMatchObject({ quote: 'governed by the laws of England and Wales', page: 3, verified: true })
    expect(kt.currency).toBeNull()
    expect(fc.currency).toEqual({ absent: 'no_quote', quote: null })
    expect(c.currency).toBeNull()                         // not defaulted to anything
    expect(c.effectiveDate?.toISOString()).toBe('2025-03-01T00:00:00.000Z')
    expect(c.value).toBe(1500000)
    expect(c.jurisdiction).toBe('England and Wales')
    expect(c.counterpartyName).toBe('Acme Logistics Ltd') // not us
    expect(c.title).toBe('Acme – Northwind Services Agreement')
    expect(c.summary).toBe('A services agreement.')
    expect(c.analysisStatus).toBe('INDEXING')

    const meta = c.metadata as Record<string, unknown>
    expect(meta.obligationExtraction).toEqual({ status: 'success' }) // merged, not replaced
    expect(meta.po_number).toBe('PO-HUMAN')                         // an org field someone filled stays
    expect(meta.keyTermAnalysis).toMatchObject({ runId: 'run-1', status: 'success', source: 'analysis_copy', hasPages: true })

    const clauses = await prisma.contractClause.findMany({ where: { versionId }, orderBy: { sortOrder: 'asc' } })
    expect(clauses.map(cl => [cl.clauseType, cl.page, cl.pageEnd, cl.spanStart])).toEqual([
      ['payment', 2, 2, 100], ['termination', 2, 3, 200],
    ])
    const version = await prisma.contractVersion.findUniqueOrThrow({ where: { id: versionId } })
    expect(version.clauseFlags).toEqual({ limitationOfLiability: true })

    expect(queued.chunk).toEqual([{ contractId: id, versionId, orgId: org }])
    expect(queued.usage).toHaveLength(1)
    expect(queued.usage[0]).toEqual([org, expect.any(Number), expect.objectContaining({
      provider: 'anthropic', model: 'claude-x', toolName: 'contract_analysis', isByok: true, inputChars: 48000,
    })])
  })

  it('keeps a term a person verified, and a counterparty already set', async () => {
    const { id, versionId } = await contractWithVersion({
      counterpartyName: 'Chosen Ltd',
      fieldConfidence: { governingLaw: { confidence: 1, quote: 'Scots law', verifiedAt: '2026-01-01', verifiedBy: owner } },
    })
    await sync(id, payload(id, versionId))
    const c = await prisma.contract.findUniqueOrThrow({ where: { id } })
    expect((c.keyTerms as Record<string, unknown>).governingLaw).toBe('Scotland')
    expect((c.fieldConfidence as Record<string, Record<string, unknown>>).governingLaw.verifiedAt).toBe('2026-01-01')
    expect(c.jurisdiction).toBeNull()
    expect(c.counterpartyName).toBe('Chosen Ltd')
  })

  it('renames only after an upload, never on a re-analysis', async () => {
    const { id, versionId } = await contractWithVersion({ metadata: { keyTermAnalysis: { runId: 'run-1', triggeredBy: 'retype' } } })
    await sync(id, payload(id, versionId))
    expect((await prisma.contract.findUniqueOrThrow({ where: { id } })).title).toBe('upload-2025-03.pdf')
  })

  it('keeps a title the user typed at upload', async () => {
    const { id, versionId } = await contractWithVersion({ metadata: { titleFromFile: false } })
    await sync(id, payload(id, versionId))
    expect((await prisma.contract.findUniqueOrThrow({ where: { id } })).title).toBe('upload-2025-03.pdf')
    const fromFile = await contractWithVersion({ metadata: { titleFromFile: true } })
    await sync(fromFile.id, payload(fromFile.id, fromFile.versionId))
    expect((await prisma.contract.findUniqueOrThrow({ where: { id: fromFile.id } })).title).toBe('Acme – Northwind Services Agreement')
  })

  it('ignores a run a newer request superseded', async () => {
    const { id, versionId } = await contractWithVersion({ metadata: { keyTermAnalysis: { runId: 'run-2', status: 'running' } } })
    const res = await sync(id, payload(id, versionId))
    expect(res.json()).toEqual({ ok: true, ignored: 'superseded' })
    const c = await prisma.contract.findUniqueOrThrow({ where: { id } })
    expect(c.analysisStatus).toBe('EXTRACTING')
    expect(await prisma.contractClause.count({ where: { versionId } })).toBe(0)
    expect(queued.chunk).toEqual([])
  })

  it('a failed or skipped run reports why and touches nothing it found before', async () => {
    const { id, versionId } = await contractWithVersion()
    await sync(id, payload(id, versionId, { status: 'error', error: 'Key-term analysis failed: timeout', analysis: null }))
    let c = await prisma.contract.findUniqueOrThrow({ where: { id } })
    expect(c.analysisStatus).toBe('FAILED')
    expect(c.analysisError).toBe('Key-term analysis failed: timeout')
    expect((c.keyTerms as Record<string, unknown>).governingLaw).toBe('Scotland')

    await sync(id, payload(id, versionId, { status: 'skipped', error: 'AI review is off.', analysis: null }))
    c = await prisma.contract.findUniqueOrThrow({ where: { id } })
    expect(c.analysisStatus).toBe('SKIPPED')
    expect(queued.chunk).toEqual([])
  })

  it('refuses a malformed payload and a caller without the secret', async () => {
    const { id, versionId } = await contractWithVersion()
    expect((await sync(id, { ...payload(id, versionId), status: 'done' })).statusCode).toBe(400)
    expect((await sync('someone-else', payload(id, versionId))).statusCode).toBe(400)
    expect((await sync(id, payload(id, versionId), {})).statusCode).toBe(401)
  })
})
