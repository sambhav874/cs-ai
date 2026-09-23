import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import jwt from 'jsonwebtoken'

beforeAll(() => { process.env.JWT_SECRET ??= 'unit-test-jwt-secret-32-characters-long' })
afterEach(() => { delete process.env.FILE_LINKS })

const { contentDisposition, fileLink, fileLinkMode, readFileLink } = await import('./file-links.js')
const { signAccessToken } = await import('./jwt.js')

const tokenOf = (url: string) => url.replace('/api/v1/files/', '')

describe('file links', () => {
  it('are same-origin API links by default, never the storage host', async () => {
    const url = await fileLink({ key: 'org/contracts/1790-msa.pdf', contentType: 'application/pdf', disposition: 'inline' })
    expect(fileLinkMode()).toBe('proxy')
    expect(url.startsWith('/api/v1/files/')).toBe(true)
    expect(url).not.toContain('minio')
    expect(readFileLink(tokenOf(url))).toMatchObject({ typ: 'file', key: 'org/contracts/1790-msa.pdf', fn: 'msa.pdf', ct: 'application/pdf', d: 'inline' })
  })

  it('reject a tampered, expired or foreign token', async () => {
    const url = await fileLink({ key: 'a/b.pdf', expiresIn: 60 })
    const t = tokenOf(url)
    expect(readFileLink(t.slice(0, -2) + (t.endsWith('A') ? 'BB' : 'AA'))).toBeNull()
    const expired = await fileLink({ key: 'a/b.pdf', expiresIn: -10 })
    expect(readFileLink(tokenOf(expired))).toBeNull()
    // Signed with the login secret itself: not a file link.
    expect(readFileLink(jwt.sign({ typ: 'file', key: 'a/b.pdf' }, process.env.JWT_SECRET!))).toBeNull()
  })

  it('a login token is not a file link, and a file link is not a login token', async () => {
    expect(readFileLink(signAccessToken({ sub: 'u', orgId: 'o', roles: ['ADMIN'] }))).toBeNull()
    const { verifyToken } = await import('./jwt.js')
    const link = tokenOf(await fileLink({ key: 'a/b.pdf' }))
    expect(() => verifyToken(link)).toThrow()
  })

  it('headers name the file safely, including non-ASCII and quotes', () => {
    expect(contentDisposition('inline', 'MSA "final".pdf')).toBe(`inline; filename="MSA final.pdf"; filename*=UTF-8''MSA%20%22final%22.pdf`)
    expect(contentDisposition('attachment', 'Vertrag-Müller.pdf')).toContain(`filename="Vertrag-M_ller.pdf"`)
    expect(contentDisposition('attachment', 'Vertrag-Müller.pdf')).toContain(`filename*=UTF-8''Vertrag-M%C3%BCller.pdf`)
  })
})
