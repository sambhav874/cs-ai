/**
 * Who may sign up. Self-host runs REGISTRATION_MODE=first-user: the first
 * account becomes the admin, then sign-up closes. A refused sign-up must not
 * leave an organisation behind.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { randomUUID } from 'node:crypto'
import { prisma } from '../lib/prisma.js'
import { getApp, closeApp, makeOrg, makeUser, cleanupAll, type TestApp } from '../test-support/helpers.js'

let app: TestApp
const registeredOrgs: string[] = []

const register = (over: Record<string, unknown> = {}) => app.inject({
  method: 'POST', url: '/api/v1/auth/register',
  payload: { email: `reg-${randomUUID()}@test.local`, password: 'correct-horse-battery', name: 'Reg', orgName: `Reg ${randomUUID().slice(0, 8)}`, ...over },
})

beforeAll(async () => {
  app = await getApp()
  await makeOrg('Existing Org') // the instance already has an organisation
})

afterEach(() => { delete process.env.REGISTRATION_MODE })

afterAll(async () => {
  // Sign-up seeds the new org's playbook, clauses and templates in the background.
  await new Promise(r => setTimeout(r, 1500))
  for (const orgId of registeredOrgs) {
    await prisma.playbookPosition.deleteMany({ where: { orgId } }).catch(() => {})
    await prisma.clauseLibraryItem.deleteMany({ where: { orgId } }).catch(() => {})
    await prisma.template.deleteMany({ where: { orgId } }).catch(() => {})
    await prisma.clauseCategory.deleteMany({ where: { orgId } }).catch(() => {})
    await prisma.userRole.deleteMany({ where: { user: { orgId } } }).catch(() => {})
    await prisma.user.deleteMany({ where: { orgId } }).catch(() => {})
    await prisma.role.deleteMany({ where: { orgId } }).catch(() => {})
    await prisma.auditEvent.deleteMany({ where: { orgId } }).catch(() => {})
    await prisma.organization.delete({ where: { id: orgId } }).catch(() => {})
  }
  await cleanupAll()
  await closeApp()
})

describe('registration mode', () => {
  it('open (the default) lets anyone create an organisation', async () => {
    const status = await app.inject({ method: 'GET', url: '/api/v1/auth/registration' })
    expect(status.json()).toEqual({ mode: 'open', open: true })
    const res = await register()
    expect(res.statusCode).toBe(201)
    registeredOrgs.push(res.json().user.orgId)
  })

  it('first-user refuses once any organisation exists', async () => {
    process.env.REGISTRATION_MODE = 'first-user'
    const status = await app.inject({ method: 'GET', url: '/api/v1/auth/registration' })
    expect(status.json()).toEqual({ mode: 'first-user', open: false })
    const before = await prisma.organization.count()
    const res = await register()
    expect(res.statusCode).toBe(403)
    expect(res.json().code).toBe('REGISTRATION_CLOSED')
    expect(await prisma.organization.count()).toBe(before)
  })

  it('closed refuses everyone', async () => {
    process.env.REGISTRATION_MODE = 'closed'
    expect((await register()).statusCode).toBe(403)
  })

  it('an unknown value reads as open, not as a silent lock-out', async () => {
    process.env.REGISTRATION_MODE = 'sometimes'
    const status = await app.inject({ method: 'GET', url: '/api/v1/auth/registration' })
    expect(status.json().mode).toBe('open')
  })
})

describe('refused sign-ups leave nothing behind', () => {
  it('an email already in use creates no organisation', async () => {
    const org = await makeOrg('Email Owner Org')
    const userId = await makeUser(org)
    const { email } = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { email: true } })
    const before = await prisma.organization.count()
    const res = await register({ email })
    expect(res.statusCode).toBe(409)
    expect(await prisma.organization.count()).toBe(before)
  })
})
