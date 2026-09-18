/**
 * error-handler.test.ts — regression guard for the 2026-06-10 fix.
 *
 * setErrorHandler MUST be registered BEFORE route plugins (Fastify
 * snapshots the active handler into each encapsulated plugin context at
 * registration time). When it was registered after the routes, this
 * handler never ran: ZodErrors surfaced as Fastify's default raw 500
 * with the issues JSON in `message` instead of the structured 422.
 *
 * These unit tests pin the handler's mapping contract; the integration
 * half (handler actually attached to routes) is covered by the smoke
 * suite's POST /search bad-body check.
 */
import { describe, it, expect, vi } from 'vitest'
import { z, ZodError } from 'zod'
import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify'
import { errorHandler } from './error-handler.js'

function mockReqReply() {
  const sent: { status?: number; body?: any } = {}
  const reply = {
    status(code: number) { sent.status = code; return this },
    send(body: any) { sent.body = body; return this },
  } as unknown as FastifyReply
  const req = {
    id: 'req-test',
    method: 'POST',
    url: '/api/v1/test',
    ip: '127.0.0.1',
    routeOptions: { url: '/api/v1/test' },
    log: { warn: vi.fn(), error: vi.fn() },
  } as unknown as FastifyRequest
  return { req, reply, sent }
}

describe('errorHandler', () => {
  it('maps ZodError to a structured 422 (not a raw 500)', () => {
    const { req, reply, sent } = mockReqReply()
    let zerr: ZodError
    try { z.object({ q: z.string() }).parse({}); throw new Error('unreachable') }
    catch (e) { zerr = e as ZodError }
    errorHandler(zerr! as unknown as FastifyError, req, reply)
    expect(sent.status).toBe(422)
    expect(sent.body.title).toBe('Validation Error')
    expect(sent.body.errors?.[0]?.path).toEqual(['q'])
  })

  it('honors error.statusCode from plugins (e.g. rate-limit 429)', () => {
    const { req, reply, sent } = mockReqReply()
    const err = Object.assign(new Error('Rate limit exceeded'), { statusCode: 429, name: 'TooManyRequests' })
    errorHandler(err as FastifyError, req, reply)
    expect(sent.status).toBe(429)
    expect(sent.body.detail).toBe('Rate limit exceeded')
  })

  it('never leaks internals on 500', () => {
    const { req, reply, sent } = mockReqReply()
    const err = new Error('prisma exploded: SELECT * FROM secrets')
    errorHandler(err as FastifyError, req, reply)
    expect(sent.status).toBe(500)
    expect(JSON.stringify(sent.body)).not.toContain('secrets')
  })
})
