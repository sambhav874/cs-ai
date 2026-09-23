/**
 * Signature routes (P7.6.1).
 *
 * Endpoints:
 *   POST /api/v1/contracts/:id/send-for-signature
 *     Body: { signers: [{name, email, role?, signOrder?}], message?,
 *             signOrder: 'ANY'|'SEQUENTIAL', expiresInDays? }
 *     Creates a SignatureRequest + Signer rows + per-signer tokens.
 *     Sets contract.status = PENDING_SIGNATURE.
 *
 *   GET /api/v1/sign/:token
 *     Public — no auth. Returns the contract + signature request envelope
 *     for the signer at this token. Records a VIEWED event.
 *
 *   POST /api/v1/sign/:token/sign
 *     Public. Body: { signedName }. Records the signature, emits a
 *     SIGNED event, advances the request. When all signers are done,
 *     marks the contract EXECUTED + emits COMPLETED.
 *
 *   POST /api/v1/sign/:token/decline
 *     Public. Body: { reason? }. Marks signer as DECLINED + voids
 *     the request.
 *
 *   GET /api/v1/contracts/:id/signature-requests
 *     Auth. Returns all SignatureRequests for a contract (admin view).
 *
 * No PDF signing yet (X.509 + pdf-lib lands in V1.5). For now the
 * digital trail is: typed name + IP + UA + timestamp, anchored in the
 * audit log + persisted on the Signer row.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify'
import crypto from 'node:crypto'
import { z } from 'zod'
import { prisma } from '../lib/prisma.js'
import { requirePermission, requireContractPermission } from '../middleware/permissions.js'
import { createAuditEvent } from '../lib/audit.js'
import { AuditAction } from '@clm/types'
import { sendSigningEmailForSigner } from '../lib/signing-email.js'
import { queueSigningReminder, queueSealSignedPdf } from '../lib/queue.js'
import { fireWebhook } from '../lib/webhook-events.js'

const SignersSchema = z.object({
  signers: z.array(z.object({
    name: z.string().min(1),
    email: z.string().email(),
    role: z.string().optional(),
    signOrder: z.number().int().min(1).optional(),
    userId: z.string().optional(),
  })).min(1).max(20),
  message: z.string().max(2000).optional(),
  signOrder: z.enum(['ANY', 'SEQUENTIAL']).default('ANY'),
  expiresInDays: z.number().int().min(1).max(180).default(14),
})

const SignBodySchema = z.object({
  signedName: z.string().min(1).max(200),
  // ESIGN/UETA affirmative consent to conduct business electronically. A
  // signature without it is not one this product will stand behind, so it is
  // required rather than merely recorded when present.
  consent: z.literal(true, { errorMap: () => ({ message: 'Consent to sign electronically is required' }) }),
})

const DeclineBodySchema = z.object({
  reason: z.string().max(500).optional(),
})

function newToken(): string {
  return crypto.randomBytes(32).toString('hex')
}

/**
 * A signer's token IS their signature authority: whoever holds it can sign as
 * them. It goes out once, in the signer's own email, and never in an API
 * response — an org member listing requests must not be able to sign as the
 * counterparty.
 */
function withoutTokens<T extends { signers?: Array<{ token?: unknown }> }>(sr: T): T {
  if (!sr.signers) return sr
  return { ...sr, signers: sr.signers.map(({ token: _token, ...rest }) => rest) } as T
}

// A contract in these states cannot be sent: it is done, gone, or still
// waiting on its approvers.
const UNSENDABLE = new Set(['EXECUTED', 'TERMINATED', 'ARCHIVED', 'EXPIRED', 'PENDING_APPROVAL'])

/** The status to return a contract to when its signature request ends unsigned. */
async function statusBeforeSending(signatureRequestId: string): Promise<string> {
  const sent = await prisma.signatureEvent.findFirst({
    where:  { signatureRequestId, kind: 'SENT' },
    select: { metadata: true },
  })
  const prev = (sent?.metadata as { previousContractStatus?: string } | null)?.previousContractStatus
  return prev && prev !== 'PENDING_SIGNATURE' ? prev : 'APPROVED'
}

export async function signatureRoutes(app: FastifyInstance) {

  // ── POST /contracts/:id/send-for-signature ────────────────────────────
  app.post<{ Params: { id: string } }>(
    '/contracts/:id/send-for-signature',
    { preHandler: requireContractPermission('sign') },
    async (req, reply) => {
      const { id } = req.params
      const { orgId, sub: userId } = req.user
      const body = SignersSchema.parse(req.body)

      const contract = await prisma.contract.findFirst({
        where: { id, orgId, deletedAt: null },
        select: { id: true, currentVersionId: true, status: true, title: true, type: true },
      })
      if (!contract) return reply.status(404).send({ detail: 'Contract not found' })
      if (!contract.currentVersionId) {
        return reply.status(400).send({ detail: 'Contract has no version to sign' })
      }
      if (contract.status === 'EXECUTED') {
        return reply.status(409).send({ detail: 'Contract already executed' })
      }
      if (UNSENDABLE.has(contract.status)) {
        return reply.status(409).send({ detail: `A ${contract.status.toLowerCase().replace(/_/g, ' ')} contract cannot be sent for signature` })
      }
      // Signing is what approval gates. An approval still in flight means the
      // approvers have not decided, whatever the contract status says.
      const approvalInFlight = await prisma.approvalInstance.findFirst({
        where:  { contractId: id, orgId, status: 'PENDING' },
        select: { id: true },
      })
      if (approvalInFlight) {
        return reply.status(409).send({ detail: 'Approval is still in progress for this contract' })
      }
      // One live request per contract: two would let the same document be
      // executed twice, by different signer sets.
      const live = await prisma.signatureRequest.findFirst({
        where:  { contractId: id, orgId, status: 'PENDING' },
        select: { id: true },
      })
      if (live) {
        return reply.status(409).send({ detail: 'This contract already has an active signature request. Void it before sending a new one.' })
      }

      const expiresAt = new Date(Date.now() + body.expiresInDays * 86_400_000)

      // Wrap creation so a partial signers insert doesn't leave a half-built request.
      const created = await prisma.$transaction(async (tx) => {
        const sr = await tx.signatureRequest.create({
          data: {
            orgId,
            contractId: id,
            versionId: contract.currentVersionId!,
            status: 'PENDING',
            signOrder: body.signOrder,
            expiresAt,
            message: body.message,
            createdById: userId,
          },
        })
        for (const s of body.signers) {
          await tx.signer.create({
            data: {
              signatureRequestId: sr.id,
              email: s.email,
              name: s.name,
              role: s.role,
              signOrder: s.signOrder ?? 1,
              userId: s.userId,
              token: newToken(),
              status: 'PENDING',
            },
          })
        }
        await tx.signatureEvent.create({
          data: {
            signatureRequestId: sr.id,
            kind: 'SENT',
            metadata: { signerCount: body.signers.length, previousContractStatus: contract.status },
            ipAddress: req.ip,
            userAgent: req.headers['user-agent'] ?? null,
          },
        })
        // Move the contract into PENDING_SIGNATURE so the dashboard reflects it.
        await tx.contract.update({
          where: { id },
          data: { status: 'PENDING_SIGNATURE' },
        })
        return sr
      })

      const fresh = await prisma.signatureRequest.findUnique({
        where: { id: created.id },
        include: { signers: true },
      })

      // Send the signing link email to each signer. For SEQUENTIAL flows
      // we only email the first-bucket signer initially — later buckets get
      // notified as their predecessors finish, in the /sign/:token/sign
      // completion handler (Wave 3.7).
      if (fresh) {
        const orgRow = await prisma.organization.findUnique({
          where: { id: orgId }, select: { name: true },
        })
        const sender = await prisma.user.findUnique({
          where: { id: userId }, select: { name: true },
        })
        const baseUrl = process.env.WEB_BASE_URL ?? 'http://localhost:5173'
        const minSignOrder = body.signOrder === 'SEQUENTIAL'
          ? Math.min(...fresh.signers.map(s => s.signOrder))
          : Infinity   // ANY → email everyone
        for (const s of fresh.signers) {
          const shouldEmail = body.signOrder === 'ANY' || s.signOrder === minSignOrder
          if (!shouldEmail) continue
          sendSigningEmailForSigner({
            signer: s,
            baseUrl,
            senderName: sender?.name ?? null,
            orgName: orgRow?.name ?? 'draftLegal',
            contractTitle: contract.title,
            contractType: contract.type,
            message: fresh.message,
            expiresAt: fresh.expiresAt,
          })
        }
      }

      // P10A — fire webhook for signature.sent
      fireWebhook(orgId, 'signature.sent', {
        contractId: id,
        signatureRequestId: created.id,
        signerCount: body.signers.length,
        signOrder: body.signOrder,
        expiresAt: created.expiresAt?.toISOString() ?? null,
      })

      await createAuditEvent({
        orgId, userId,
        action: AuditAction.SIGNATURE_SENT,
        resourceType: 'contract',
        resourceId: id,
        metadata: {
          signatureRequestId: created.id,
          signerCount: body.signers.length,
          signers: body.signers.map(s => ({ name: s.name, email: s.email, role: s.role })),
          signOrder: body.signOrder,
        },
        ipAddress: req.ip,
      })

      // Phase 07 Step 8 — schedule reminder nudges. We fire two:
      //   T-3d before expiry → "first" reminder
      //   T-1d before expiry → "final" reminder
      // The worker rechecks status at fire time, so a request that's
      // already COMPLETED/VOIDED before the reminder fires is a no-op.
      // Both jobs use deterministic ids — re-sending the same request
      // (e.g. user clicks "Resend for signature") would replace them.
      if (created.expiresAt) {
        const now = Date.now()
        const exp = created.expiresAt.getTime()
        const firstDelay = exp - now - 3 * 24 * 60 * 60 * 1000   // T-3d
        const finalDelay = exp - now - 1 * 24 * 60 * 60 * 1000   // T-1d
        if (firstDelay > 60_000) {  // skip if already in the past
          queueSigningReminder({ signatureRequestId: created.id, kind: 'first' }, firstDelay)
            .catch(err => app.log.warn({ err }, 'failed to enqueue first signing reminder'))
        }
        if (finalDelay > 60_000) {
          queueSigningReminder({ signatureRequestId: created.id, kind: 'final' }, finalDelay)
            .catch(err => app.log.warn({ err }, 'failed to enqueue final signing reminder'))
        }
      }

      return reply.status(201).send(fresh ? withoutTokens(fresh) : fresh)
    },
  )

  // ── GET /signature-requests (org-wide) ─────────────────────────────────
  // Powers the /signatures admin page: list every signature request in the
  // org, with the contract title + signer summary needed to render the table.
  // Filterable by status. Authenticated users see their own org only.
  app.get<{ Querystring: { status?: string; limit?: string; offset?: string } }>(
    '/signature-requests',
    { preHandler: requirePermission('view', 'contract') },
    async (req, reply) => {
      const { orgId } = req.user
      const limit = Math.min(100, parseInt(req.query.limit ?? '50', 10) || 50)
      const offset = Math.max(0, parseInt(req.query.offset ?? '0', 10) || 0)
      const where: Record<string, unknown> = { orgId }
      if (req.query.status && ['PENDING', 'COMPLETED', 'VOIDED', 'EXPIRED'].includes(req.query.status)) {
        where.status = req.query.status
      }
      const [items, total] = await Promise.all([
        prisma.signatureRequest.findMany({
          where: where as never,
          orderBy: { createdAt: 'desc' },
          take: limit,
          skip: offset,
          include: {
            signers: { select: { id: true, name: true, email: true, role: true, status: true, signedAt: true, signOrder: true } },
          },
        }),
        prisma.signatureRequest.count({ where: where as never }),
      ])
      // Hydrate contract title + type via a single batch query.
      const contractIds = [...new Set(items.map(i => i.contractId))]
      const contracts = contractIds.length === 0 ? [] : await prisma.contract.findMany({
        where: { id: { in: contractIds }, orgId },
        select: { id: true, title: true, type: true, counterpartyName: true },
      })
      const contractById = new Map(contracts.map(c => [c.id, c]))
      const data = items.map(it => ({
        id: it.id,
        status: it.status,
        signOrder: it.signOrder,
        createdAt: it.createdAt,
        completedAt: it.completedAt,
        voidedAt: it.voidedAt,
        expiresAt: it.expiresAt,
        signedCount: it.signers.filter(s => s.status === 'SIGNED').length,
        totalSigners: it.signers.length,
        signers: it.signers,
        contract: contractById.get(it.contractId) ?? null,
      }))
      return reply.send({ data, total, limit, offset })
    },
  )

  // ── GET /contracts/:id/signature-requests ─────────────────────────────
  app.get<{ Params: { id: string } }>(
    '/contracts/:id/signature-requests',
    { preHandler: requireContractPermission('view') },
    async (req, reply) => {
      const { id } = req.params
      const { orgId } = req.user
      const requests = await prisma.signatureRequest.findMany({
        where: { contractId: id, orgId },
        orderBy: { createdAt: 'desc' },
        include: { signers: true, events: { orderBy: { createdAt: 'desc' }, take: 20 } },
      })
      return reply.send({ data: requests.map(withoutTokens) })
    },
  )

  // ── GET /sign/:token (public) ─────────────────────────────────────────
  app.get<{ Params: { token: string } }>(
    '/sign/:token',
    async (req: FastifyRequest, reply) => {
      const { token } = req.params as { token: string }
      const signer = await prisma.signer.findUnique({
        where: { token },
        include: {
          signatureRequest: {
            include: {
              signers: { select: { id: true, name: true, role: true, status: true, signOrder: true } },
            },
          },
        },
      })
      if (!signer) return reply.status(404).send({ detail: 'Invalid signing link' })
      const sr = signer.signatureRequest
      if (sr.status !== 'PENDING') return reply.status(410).send({ detail: 'This signing request is no longer active' })
      if (sr.expiresAt && sr.expiresAt < new Date()) {
        // Lazy-expire the request the first time someone hits a stale link.
        await prisma.signatureRequest.update({
          where: { id: sr.id },
          data: { status: 'EXPIRED' },
        })
        return reply.status(410).send({ detail: 'This signing link has expired' })
      }

      // Record a VIEWED event the first time this signer opens the link.
      const alreadyViewed = await prisma.signatureEvent.findFirst({
        where: { signatureRequestId: sr.id, signerId: signer.id, kind: 'VIEWED' },
      })
      if (!alreadyViewed) {
        await prisma.signatureEvent.create({
          data: {
            signatureRequestId: sr.id,
            signerId: signer.id,
            kind: 'VIEWED',
            ipAddress: req.ip,
            userAgent: req.headers['user-agent'] ?? null,
          },
        })
      }

      // Pull the contract + version htmlContent
      const version = await prisma.contractVersion.findUnique({
        where: { id: sr.versionId },
        select: { id: true, versionNumber: true, htmlContent: true },
      })
      const contract = await prisma.contract.findUnique({
        where: { id: sr.contractId },
        select: {
          id: true, title: true, type: true, status: true, counterpartyName: true,
          org: { select: { name: true, brandColor: true, logoUrl: true } },
        },
      })

      return reply.send({
        signer: {
          id: signer.id,
          name: signer.name,
          email: signer.email,
          role: signer.role,
          status: signer.status,
          signedAt: signer.signedAt,
        },
        signatureRequest: {
          id: sr.id,
          status: sr.status,
          message: sr.message,
          expiresAt: sr.expiresAt,
          signOrder: sr.signOrder,
          totalSigners: sr.signers.length,
          signedCount: sr.signers.filter(s => s.status === 'SIGNED').length,
        },
        contract,
        version,
      })
    },
  )

  // ── POST /sign/:token/sign (public) ───────────────────────────────────
  app.post<{ Params: { token: string } }>(
    '/sign/:token/sign',
    async (req, reply) => {
      const body = SignBodySchema.parse(req.body)
      const { token } = req.params

      const signer = await prisma.signer.findUnique({
        where: { token },
        include: { signatureRequest: { include: { signers: true } } },
      })
      if (!signer) return reply.status(404).send({ detail: 'Invalid signing link' })
      const sr = signer.signatureRequest
      if (sr.status !== 'PENDING') return reply.status(410).send({ detail: 'Signing request is no longer active' })
      // The GET lazily expires a stale link, but a signer can POST without it.
      if (sr.expiresAt && sr.expiresAt < new Date()) {
        return reply.status(410).send({ detail: 'This signing link has expired' })
      }
      if (signer.status === 'SIGNED')  return reply.status(409).send({ detail: 'Already signed' })
      if (signer.status === 'DECLINED') return reply.status(409).send({ detail: 'Already declined' })

      // Sequential gating: a signer can only sign if every earlier
      // signOrder bucket has finished.
      if (sr.signOrder === 'SEQUENTIAL') {
        const earlier = sr.signers.filter(s => s.signOrder < signer.signOrder)
        const allEarlierSigned = earlier.every(s => s.status === 'SIGNED')
        if (!allEarlierSigned) {
          return reply.status(403).send({
            detail: 'Earlier signers have not yet signed. You will be notified when it is your turn.',
          })
        }
      }

      const now = new Date()
      // Conditional on PENDING so a double-submit signs once, not twice.
      const claimed = await prisma.signer.updateMany({
        where: { id: signer.id, status: 'PENDING' },
        data: {
          status: 'SIGNED',
          signedAt: now,
          signedName: body.signedName,
          signedIp: req.ip,
          signedUserAgent: req.headers['user-agent'] ?? null,
        },
      })
      if (claimed.count === 0) return reply.status(409).send({ detail: 'Already responded' })
      const updated = await prisma.signer.findUniqueOrThrow({ where: { id: signer.id } })
      await prisma.signatureEvent.create({
        data: {
          signatureRequestId: sr.id,
          signerId: signer.id,
          kind: 'SIGNED',
          metadata: {
            signedName: body.signedName,
            // ESIGN/UETA affirmative consent (Wave 2.7).
            consentGiven: body.consent === true,
            consentText: 'Signer agreed to conduct business and sign electronically.',
          },
          ipAddress: req.ip,
          userAgent: req.headers['user-agent'] ?? null,
        },
      })
      // Each signature is anchored in the org's tamper-evident chain, not only
      // in the request's own event list.
      await createAuditEvent({
        orgId: sr.orgId,
        action: AuditAction.SIGNATURE_SIGNED,
        resourceType: 'contract',
        resourceId: sr.contractId,
        metadata: {
          signatureRequestId: sr.id, signerId: signer.id,
          signerEmail: signer.email, signedName: body.signedName, consentGiven: true,
        },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'] ?? undefined,
      })

      // Check if everyone has signed → flip request COMPLETED + contract EXECUTED.
      const fresh = await prisma.signatureRequest.findUnique({
        where: { id: sr.id },
        include: { signers: true },
      })
      const allSigned = fresh!.signers.every(s => s.status === 'SIGNED')
      // Two last signatures landing together would both see allSigned. Only
      // the one that flips the request from PENDING completes it; the other
      // skips the completion side effects (audit, webhooks, seal).
      const completedAt = new Date()
      const won = allSigned
        ? (await prisma.signatureRequest.updateMany({
            where: { id: sr.id, status: 'PENDING' },
            data:  { status: 'COMPLETED', completedAt },
          })).count === 1
        : false
      if (won) {
        await prisma.$transaction([
          prisma.contract.update({
            where: { id: sr.contractId },
            data: { status: 'EXECUTED' },
          }),
          prisma.signatureEvent.create({
            data: {
              signatureRequestId: sr.id,
              kind: 'COMPLETED',
              metadata: { signerCount: fresh!.signers.length },
            },
          }),
        ])
        await createAuditEvent({
          orgId: sr.orgId,
          userId: sr.createdById,
          action: AuditAction.SIGNATURE_COMPLETED,
          resourceType: 'contract',
          resourceId: sr.contractId,
          metadata: { signatureRequestId: sr.id, signerCount: fresh!.signers.length },
        })

        // P10A — fire signature.completed + contract.executed webhooks
        fireWebhook(sr.orgId, 'signature.completed', {
          contractId: sr.contractId,
          signatureRequestId: sr.id,
          signerCount: fresh!.signers.length,
          completedAt: completedAt.toISOString(),
        })
        fireWebhook(sr.orgId, 'contract.executed', {
          contractId: sr.contractId,
          executedAt: completedAt.toISOString(),
        })

        // ── PDF binding (Step 6) ───────────────────────────────────
        // Queue the seal rather than doing it inline. The signed PDF is a
        // legally significant artefact, so it must survive a transient S3 /
        // Gotenberg / signing-cert failure: this used to be a fire-and-forget
        // IIFE with swallowed errors, which could leave the contract EXECUTED
        // with no sealed document and no way to recover. The worker re-reads
        // state and is idempotent, so retries are safe.
        queueSealSignedPdf({ signatureRequestId: sr.id })

        // Obligations: the seal job links the sealed PDF to the intelligence
        // tier, whose ingestion extracts from the executed document and syncs
        // the register back (signing.worker → /api/internal/obligations/sync).
      } else if (sr.signOrder === 'SEQUENTIAL') {
        // Wave 3.7 — sequential flow, not everyone has signed yet. If this
        // signature just unblocked a later signOrder bucket, email those signers
        // now instead of making them wait for a T-3d/T-1d reminder job. Mirrors
        // the initial-send loop and the reminder worker's bucket selection.
        const pending = fresh!.signers.filter(s => s.status === 'PENDING')
        if (pending.length > 0) {
          const minOrder = Math.min(...pending.map(s => s.signOrder))
          // Only notify when this sign advanced the sequence to a NEW bucket —
          // guards against re-emailing parallel siblings still pending in the
          // current signer's own bucket (they were emailed when that bucket
          // opened).
          if (minOrder > signer.signOrder) {
            const nextBucket = pending.filter(s => s.signOrder === minOrder)
            const cMeta = await prisma.contract.findUnique({
              where: { id: sr.contractId },
              select: { title: true, type: true, org: { select: { name: true } } },
            })
            const sender = await prisma.user.findUnique({
              where: { id: sr.createdById }, select: { name: true },
            })
            const baseUrl = process.env.WEB_BASE_URL ?? 'http://localhost:5173'
            for (const s of nextBucket) {
              sendSigningEmailForSigner({
                signer: s,
                baseUrl,
                senderName: sender?.name ?? null,
                orgName: cMeta?.org?.name ?? 'draftLegal',
                contractTitle: cMeta?.title ?? 'Contract',
                contractType: cMeta?.type ?? '',
                message: sr.message,
                expiresAt: sr.expiresAt,
              })
            }
            await prisma.signatureEvent.create({
              data: {
                signatureRequestId: sr.id,
                kind: 'SENT',
                metadata: { sequentialAdvance: true, notified: nextBucket.length, signOrder: minOrder },
              },
            }).catch(() => { /* audit best-effort */ })
          }
        }
      }

      return reply.send({
        ok: true,
        signedAt: updated.signedAt,
        allSigned,
      })
    },
  )

  // ── POST /sign/:token/decline (public) ────────────────────────────────
  app.post<{ Params: { token: string } }>(
    '/sign/:token/decline',
    async (req, reply) => {
      const body = DeclineBodySchema.parse(req.body)
      const { token } = req.params

      const signer = await prisma.signer.findUnique({
        where: { token },
        include: { signatureRequest: true },
      })
      if (!signer) return reply.status(404).send({ detail: 'Invalid signing link' })
      const sr = signer.signatureRequest
      if (sr.status !== 'PENDING') return reply.status(410).send({ detail: 'Signing request is no longer active' })
      if (sr.expiresAt && sr.expiresAt < new Date()) {
        return reply.status(410).send({ detail: 'This signing link has expired' })
      }
      if (signer.status !== 'PENDING') return reply.status(409).send({ detail: 'Signer already responded' })

      // Claim the request first, so a decline racing a final signature cannot
      // void a request that just completed.
      const claimed = await prisma.signatureRequest.updateMany({
        where: { id: sr.id, status: 'PENDING' },
        data:  { status: 'VOIDED', voidedAt: new Date(), voidedReason: `${signer.name} declined: ${body.reason ?? '(no reason given)'}` },
      })
      if (claimed.count === 0) return reply.status(410).send({ detail: 'Signing request is no longer active' })
      const restoreTo = await statusBeforeSending(sr.id)

      await prisma.$transaction([
        prisma.signer.update({
          where: { id: signer.id },
          data: { status: 'DECLINED', declinedAt: new Date(), declinedReason: body.reason },
        }),
        prisma.signatureEvent.create({
          data: {
            signatureRequestId: sr.id,
            signerId: signer.id,
            kind: 'DECLINED',
            metadata: { reason: body.reason },
            ipAddress: req.ip,
            userAgent: req.headers['user-agent'] ?? null,
          },
        }),
        // Back to where it was before sending, so it can be revised and re-sent.
        prisma.contract.updateMany({
          where: { id: sr.contractId, status: 'PENDING_SIGNATURE' },
          data:  { status: restoreTo },
        }),
      ])

      await createAuditEvent({
        orgId: sr.orgId,
        action: AuditAction.SIGNATURE_DECLINED,
        resourceType: 'contract',
        resourceId: sr.contractId,
        metadata: { signatureRequestId: sr.id, signerId: signer.id, declinedBy: signer.email, reason: body.reason ?? null },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'] ?? undefined,
      })

      return reply.send({ ok: true })
    },
  )

  // ── POST /contracts/:id/signature-requests/:srId/remind ───────────────
  // Manual nudge — sender can fire a reminder email at any time. Idempotent
  // by virtue of the worker's status-recheck. No effect on a non-PENDING SR.
  app.post<{ Params: { id: string; srId: string } }>(
    '/contracts/:id/signature-requests/:srId/remind',
    { preHandler: requireContractPermission('sign') },
    async (req, reply) => {
      const { id, srId } = req.params
      const { orgId } = req.user
      const sr = await prisma.signatureRequest.findFirst({
        where: { id: srId, contractId: id, orgId },
        include: { signers: true },
      })
      if (!sr) return reply.status(404).send({ detail: 'Signature request not found' })
      if (sr.status !== 'PENDING') {
        return reply.status(409).send({ detail: `Request is ${sr.status} — cannot send reminder` })
      }
      const pending = sr.signers.filter(s => s.status === 'PENDING')
      if (pending.length === 0) {
        return reply.status(409).send({ detail: 'All signers have already responded' })
      }
      // Mirror the worker's nudge logic so the response count is honest:
      // SEQUENTIAL → only the lowest-signOrder bucket of pending is emailed.
      const nudgeCount = sr.signOrder === 'SEQUENTIAL'
        ? (() => {
            const minOrder = Math.min(...pending.map(s => s.signOrder))
            return pending.filter(s => s.signOrder === minOrder).length
          })()
        : pending.length
      // Fire immediately (delay=0). Worker handles the rest.
      await queueSigningReminder({ signatureRequestId: srId, kind: 'manual' }, 0)
        .catch(err => req.log.warn({ err }, 'failed to enqueue manual reminder'))
      return reply.send({ ok: true, signersNotified: nudgeCount })
    },
  )

  // ── POST /contracts/:id/signature-requests/:srId/signers/:signerId/link ─
  // The sender's "copy signing link", for when email is not configured or a
  // signer lost the message. The link carries the signer's authority to sign,
  // so it is handed out only to someone who may send for signature, only for
  // a signer still pending, and every hand-out is in the audit chain.
  app.post<{ Params: { id: string; srId: string; signerId: string } }>(
    '/contracts/:id/signature-requests/:srId/signers/:signerId/link',
    { preHandler: requireContractPermission('sign') },
    async (req, reply) => {
      const { id, srId, signerId } = req.params
      const { orgId, sub: userId } = req.user
      const signer = await prisma.signer.findFirst({
        where:  { id: signerId, signatureRequest: { is: { id: srId, contractId: id, orgId } } },
        select: { id: true, email: true, token: true, status: true, signatureRequest: { select: { status: true } } },
      })
      if (!signer) return reply.status(404).send({ detail: 'Signer not found' })
      if (signer.signatureRequest.status !== 'PENDING' || signer.status !== 'PENDING') {
        return reply.status(409).send({ detail: 'This signer has no active signing link' })
      }
      await createAuditEvent({
        orgId, userId,
        action: AuditAction.SIGNATURE_SENT,
        resourceType: 'contract',
        resourceId: id,
        metadata: { event: 'signing_link_shared', signatureRequestId: srId, signerId, signerEmail: signer.email },
        ipAddress: req.ip,
      })
      const baseUrl = (process.env.WEB_BASE_URL ?? 'http://localhost:5173').replace(/\/+$/, '')
      return reply.send({ url: `${baseUrl}/sign/${signer.token}` })
    },
  )

  // ── POST /contracts/:id/signature-requests/:srId/void ─────────────────
  app.post<{ Params: { id: string; srId: string } }>(
    '/contracts/:id/signature-requests/:srId/void',
    { preHandler: requireContractPermission('sign') },
    async (req, reply) => {
      const { id, srId } = req.params
      const { orgId, sub: userId } = req.user
      const sr = await prisma.signatureRequest.findFirst({
        where: { id: srId, contractId: id, orgId },
      })
      if (!sr) return reply.status(404).send({ detail: 'Signature request not found' })
      if (sr.status !== 'PENDING') return reply.status(409).send({ detail: 'Already terminated' })

      const claimed = await prisma.signatureRequest.updateMany({
        where: { id: srId, status: 'PENDING' },
        data:  { status: 'VOIDED', voidedAt: new Date(), voidedReason: 'Voided by sender' },
      })
      if (claimed.count === 0) return reply.status(409).send({ detail: 'Already terminated' })
      const restoreTo = await statusBeforeSending(srId)

      await prisma.$transaction([
        prisma.signatureEvent.create({
          data: { signatureRequestId: srId, kind: 'VOIDED', metadata: { actor: userId } },
        }),
        prisma.contract.updateMany({
          where: { id, status: 'PENDING_SIGNATURE' },
          data:  { status: restoreTo },
        }),
      ])

      await createAuditEvent({
        orgId, userId,
        action: AuditAction.SIGNATURE_VOIDED,
        resourceType: 'contract',
        resourceId: id,
        metadata: { signatureRequestId: srId },
      })

      return reply.send({ ok: true })
    },
  )
}
