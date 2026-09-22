import { describe, expect, it, vi } from 'vitest'
import { linkContractToIntelligence, PermanentLinkError, type LinkContractJob, type LinkDeps } from './intelligence-link.js'

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const job: LinkContractJob = {
  contractId: 'c1', orgId: 'o1', userId: 'u1',
  s3Key: 'o1/contracts/1-msa.pdf', mimeType: 'application/pdf', filename: 'msa.pdf',
}

function deps(response: Response, over: Partial<LinkDeps> = {}) {
  const fetchMock = vi.fn(async () => response)
  const d: LinkDeps = {
    readObject: vi.fn(async () => Buffer.from('%PDF-1.4')),
    toPdf: vi.fn(async () => Buffer.from('%PDF-converted')),
    fetch: fetchMock as unknown as typeof fetch,
    intelligenceUrl: 'http://intelligence:8000/',
    internalSecret: 's3cret',
    ...over,
  }
  return { d, fetchMock }
}

const ok = () => new Response(JSON.stringify({ contract_id: 'i1', status: 'created' }), { status: 200 })

describe('linkContractToIntelligence', () => {
  it('posts the file with the ids and the internal secret', async () => {
    const { d, fetchMock } = deps(ok())
    const out = await linkContractToIntelligence(job, d)
    expect(out).toEqual({ status: 'linked', intelligenceContractId: 'i1', result: 'created' })

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('http://intelligence:8000/internal/contracts/link')
    expect((init.headers as Record<string, string>)['X-Internal-Secret']).toBe('s3cret')
    const form = init.body as FormData
    expect(form.get('platform_contract_id')).toBe('c1')
    expect(form.get('org_id')).toBe('o1')
    expect(form.get('user_id')).toBe('u1')
    expect((form.get('file') as File).name).toBe('msa.pdf')
  })

  it('converts a Word file to PDF first', async () => {
    const { d, fetchMock } = deps(ok())
    await linkContractToIntelligence({ ...job, mimeType: DOCX, filename: 'msa.docx' }, d)
    expect(d.toPdf).toHaveBeenCalledOnce()
    const form = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as FormData
    expect((form.get('file') as File).name).toBe('msa.pdf')
  })

  it('skips plain text without calling anything', async () => {
    const { d, fetchMock } = deps(ok())
    const out = await linkContractToIntelligence({ ...job, mimeType: 'text/plain' }, d)
    expect(out.status).toBe('skipped')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(d.readObject).not.toHaveBeenCalled()
  })

  it('refuses to call without a secret', async () => {
    const { d, fetchMock } = deps(ok(), { internalSecret: '' })
    await expect(linkContractToIntelligence(job, d)).rejects.toBeInstanceOf(PermanentLinkError)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('treats a 4xx refusal as permanent, so the job stops retrying', async () => {
    const { d } = deps(new Response('{"detail":"contract belongs to another organisation"}', { status: 422 }))
    await expect(linkContractToIntelligence(job, d)).rejects.toBeInstanceOf(PermanentLinkError)
  })

  it.each([500, 502, 503, 429, 408])('treats %i as retryable', async (status) => {
    const { d } = deps(new Response('down', { status }))
    const err = await linkContractToIntelligence(job, d).catch(e => e)
    expect(err).toBeInstanceOf(Error)
    expect(err).not.toBeInstanceOf(PermanentLinkError)
  })
})
