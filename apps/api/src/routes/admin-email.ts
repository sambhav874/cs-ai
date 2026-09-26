import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { AuditAction } from '@clm/types'
import { prisma } from '../lib/prisma.js'
import { requirePermission } from '../middleware/permissions.js'
import { createAuditEvent } from '../lib/audit.js'
import { emailProvider, emailSender, isEmailConfigured, sendEmail } from '../lib/mailer.js'

// Admin → Email: whether a provider is configured, the outbox of every email
// the platform tried to send, and a test send to the admin's own address.
// No endpoint here reads or returns a credential.

const OutboxQuery = z.object({
  kind:   z.enum(['signing', 'share', 'notification', 'invite', 'test', 'other']).optional(),
  status: z.enum(['sent', 'failed', 'not_configured']).optional(),
  limit:  z.coerce.number().int().min(1).max(200).default(100),
})

export async function adminEmailRoutes(app: FastifyInstance): Promise<void> {
  const guard = { preHandler: requirePermission('configure', 'organization') }

  // ── GET /admin/email/status ─────────────────────────────────────────────
  app.get('/status', guard, async (_req, reply) => {
    const { via, host, port } = emailProvider()
    return reply.send({ configured: isEmailConfigured(), via, host, port, from: emailSender() })
  })

  // ── GET /admin/email/outbox — newest first ──────────────────────────────
  app.get('/outbox', guard, async (req, reply) => {
    const parsed = OutboxQuery.safeParse(req.query)
    if (!parsed.success) return reply.status(400).send({ detail: 'Invalid query', issues: parsed.error.issues })
    const { kind, status, limit } = parsed.data
    const where = { orgId: req.user.orgId, ...(kind && { kind }), ...(status && { status }) }
    const [rows, counts] = await Promise.all([
      prisma.emailLog.findMany({ where, orderBy: { createdAt: 'desc' }, take: limit }),
      prisma.emailLog.findMany({
        where: { orgId: req.user.orgId, createdAt: { gte: new Date(Date.now() - 7 * 86_400_000) } },
        select: { status: true },
      }),
    ])
    const last7Days = { sent: 0, failed: 0, not_configured: 0 } as Record<string, number>
    for (const c of counts) last7Days[c.status] = (last7Days[c.status] ?? 0) + 1
    return reply.send({ data: rows, last7Days })
  })

  // ── POST /admin/email/test — send to the signed-in admin ────────────────
  // Only to the caller's own address, so this can't be used to mail anyone.
  app.post('/test', guard, async (req, reply) => {
    const { orgId, sub } = req.user
    const me = await prisma.user.findFirst({ where: { id: sub, orgId }, select: { email: true, name: true } })
    if (!me) return reply.status(404).send({ detail: 'User not found' })
    const result = await sendEmail({
      orgId,
      kind: 'test',
      to: me.email,
      subject: 'Test email from your contract platform',
      text: `Hi ${me.name},\n\nThis is a test email. If you can read it, email delivery is working.\n`,
    })
    await createAuditEvent({
      orgId, userId: sub, action: AuditAction.EMAIL_TEST_SENT, resourceType: 'email', resourceId: 'test',
      metadata: { to: me.email, sent: result.sent, via: result.via, ...(result.sent ? {} : { reason: result.reason.slice(0, 200) }) },
      ipAddress: req.ip,
    })
    return reply.send({ to: me.email, ...result })
  })
}
