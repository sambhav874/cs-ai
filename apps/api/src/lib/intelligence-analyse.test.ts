import { describe, expect, it, vi } from 'vitest'
import { AnalysisRequestError, expectsAnalysisCopy, requestAnalysis, type AnalyseDeps, type AnalysisRequest } from './intelligence-analyse.js'
import { isPlaceholderTitle, pickCounterparty } from './analysis-sync.js'

const req: AnalysisRequest = {
  contractId: 'c1', orgId: 'o1', versionId: 'v1', runId: 'r1', plainText: 'text', contractType: 'MSA',
  customFields: [{ fieldKey: 'po', fieldLabel: 'PO', fieldType: 'text', options: [] }], expectLinked: true,
}

function deps(response: Response | Error, over: Partial<AnalyseDeps> = {}) {
  const fetchMock = vi.fn(async () => {
    if (response instanceof Error) throw response
    return response
  })
  return {
    d: { fetch: fetchMock as unknown as typeof fetch, intelligenceUrl: 'http://intel:8000/', internalSecret: 's', ...over },
    fetchMock,
  }
}

describe('requestAnalysis', () => {
  it('posts the contract, its text, type, fields and run id to the analyse route', async () => {
    const { d, fetchMock } = deps(new Response('{"status":"queued"}', { status: 200 }))
    await requestAnalysis(req, d)
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('http://intel:8000/internal/contracts/c1/analyse')
    expect((init.headers as Record<string, string>)['X-Internal-Secret']).toBe('s')
    expect(JSON.parse(init.body as string)).toEqual({
      org_id: 'o1', version_id: 'v1', run_id: 'r1', plain_text: 'text', contract_type: 'MSA',
      custom_fields: req.customFields, expect_linked: true,
    })
  })

  it('says whether another attempt could help', async () => {
    const outcome = async (r: Response | Error) => requestAnalysis(req, deps(r).d).catch(e => e as AnalysisRequestError)
    expect((await outcome(new Error('ECONNREFUSED')))?.retryable).toBe(true)
    expect((await outcome(new Response('down', { status: 503 })))?.retryable).toBe(true)
    expect((await outcome(new Response('no', { status: 404 })))?.retryable).toBe(false)
    await expect(requestAnalysis(req, deps(new Response('{}'), { internalSecret: '' }).d)).rejects.toMatchObject({ retryable: false })
  })
})

describe('expectsAnalysisCopy', () => {
  it('is true only for a stored PDF or DOCX, which the intelligence tier links', () => {
    expect(expectsAnalysisCopy({ s3Key: 'k', mimeType: 'application/pdf' })).toBe(true)
    expect(expectsAnalysisCopy({ s3Key: 'k', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })).toBe(true)
    expect(expectsAnalysisCopy({ s3Key: 'k', mimeType: 'text/plain' })).toBe(false)
    expect(expectsAnalysisCopy({ s3Key: null, mimeType: 'application/pdf' })).toBe(false)
  })
})

describe('pickCounterparty', () => {
  const parties = [{ role: 'Client', name: 'Northwind Retail plc' }, { role: 'Supplier', name: 'Acme Ltd' }]
  it('is the party that is not us', () => {
    expect(pickCounterparty(parties, 'Northwind Retail')).toBe('Acme Ltd')
    expect(pickCounterparty(parties, 'Acme Ltd.')).toBe('Northwind Retail plc')
  })
  it('without our name, skips the usual client-side roles, then takes the first', () => {
    expect(pickCounterparty(parties, null)).toBe('Acme Ltd')
    expect(pickCounterparty([{ role: 'Client', name: 'Only' }], null)).toBe('Only')
    expect(pickCounterparty([], 'x')).toBeNull()
  })
})

describe('isPlaceholderTitle', () => {
  it('catches the titles a model writes when it found no parties', () => {
    expect(isPlaceholderTitle('Unnamed Contract - No Identified Parties')).toBe(true)
    expect(isPlaceholderTitle('Acme – Northwind MSA')).toBe(false)
  })
})
