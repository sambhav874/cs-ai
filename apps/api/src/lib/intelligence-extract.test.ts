import { describe, expect, it, vi } from 'vitest'
import { requestObligationExtraction, type ExtractDeps } from './intelligence-extract.js'

const args = { contractId: 'c1', orgId: 'o1', userId: 'u1' }

function deps(response: Response | Error, over: Partial<ExtractDeps> = {}) {
  const fetchMock = vi.fn(async () => {
    if (response instanceof Error) throw response
    return response
  })
  return {
    d: { fetch: fetchMock as unknown as typeof fetch, intelligenceUrl: 'http://intel:8000/', internalSecret: 's', ...over },
    fetchMock,
  }
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status })

describe('requestObligationExtraction', () => {
  it('posts to the contract route with the secret and ids', async () => {
    const { d, fetchMock } = deps(json(200, { status: 'queued' }))
    expect(await requestObligationExtraction(args, d)).toEqual({ status: 'queued' })
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('http://intel:8000/internal/contracts/c1/extract-obligations')
    expect((init.headers as Record<string, string>)['X-Internal-Secret']).toBe('s')
    expect(JSON.parse(init.body as string)).toEqual({ org_id: 'o1', user_id: 'u1' })
  })

  it('maps 404 to not linked and 409 to busy', async () => {
    expect(await requestObligationExtraction(args, deps(json(404, { detail: 'x' })).d)).toEqual({ status: 'not_linked' })
    expect(await requestObligationExtraction(args, deps(json(409, { detail: 'Contract is still being analysed.' })).d))
      .toEqual({ status: 'busy', detail: 'Contract is still being analysed.' })
  })

  it('reports an unreachable or failing tier as unavailable', async () => {
    expect((await requestObligationExtraction(args, deps(new Error('ECONNREFUSED')).d)).status).toBe('unavailable')
    expect((await requestObligationExtraction(args, deps(new Response('oops', { status: 500 })).d)).status).toBe('unavailable')
  })

  it('refuses to call without a secret', async () => {
    const { d, fetchMock } = deps(json(200, {}), { internalSecret: '' })
    expect((await requestObligationExtraction(args, d)).status).toBe('unavailable')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
