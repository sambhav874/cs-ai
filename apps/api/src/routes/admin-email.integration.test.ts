/**
 * Admin → Email: provider status, the outbox, and a test send.
 *
 * With no provider configured every email used to vanish into a console log,
 * so nobody could tell whether a signing request or reminder had gone out.
 * Each attempt now lands in the outbox, marked not_configured when that is why.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { prisma } from '../lib/prisma.js'
import { sendEmail } from '../lib/mailer.js'
import { getApp, closeApp, makeOrg, makeUser, auth, cleanupAll, type TestApp } from '../test-support/helpers.js'

let app: TestApp
let org: string, other: string, admin: string

beforeAll(async () => {
  delete process.env.SENDGRID_API_KEY
  delete process.env.SMTP_HOST
  app = await getApp()
  org = await makeOrg('Email Org')
  other = await makeOrg('Email Other Org')
  admin = await makeUser(org)
})

afterAll(async () => {
  await prisma.emailLog.deleteMany({ where: { orgId: { in: [org, other] } } })
  await cleanupAll(); await closeApp()
})

describe('admin email', () => {
  it('reports no provider without exposing any credential', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/admin/email/status', headers: auth(org, ['ADMIN'], admin) })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ configured: false, via: null })
  })

  it('records every attempt in the org\'s outbox, and only that org sees it', async () => {
    await sendEmail({ orgId: org, kind: 'signing', to: 'signer@example.com', subject: 'Signature requested: MSA', text: 'x' })
    await sendEmail({ orgId: other, kind: 'share', to: 'cp@example.com', subject: 'Review: NDA', text: 'x' })

    const res = await app.inject({ method: 'GET', url: '/api/v1/admin/email/outbox', headers: auth(org, ['ADMIN'], admin) })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.data).toHaveLength(1)
    expect(body.data[0]).toMatchObject({ kind: 'signing', to: 'signer@example.com', status: 'not_configured' })
    expect(body.last7Days.not_configured).toBe(1)
  })

  it('sends a test only to the signed-in admin and audits it', async () => {
    const me = await prisma.user.findUniqueOrThrow({ where: { id: admin }, select: { email: true } })
    const res = await app.inject({ method: 'POST', url: '/api/v1/admin/email/test', headers: auth(org, ['ADMIN'], admin), payload: { to: 'someone-else@example.com' } })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ to: me.email, sent: false })
    const audit = await prisma.auditEvent.findFirst({ where: { orgId: org, action: 'EMAIL_TEST_SENT' } })
    expect(audit).not.toBeNull()
    const logged = await prisma.emailLog.findFirst({ where: { orgId: org, kind: 'test' } })
    expect(logged?.to).toBe(me.email)
  })

  it('is admin-only', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/admin/email/outbox', headers: auth(org, ['VIEWER']) })
    expect(res.statusCode).toBe(403)
  })
})
