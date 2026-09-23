import type { FastifyInstance } from 'fastify'
import type { Prisma } from '@prisma/client'
import { PutObjectCommand } from '@aws-sdk/client-s3'
import { prisma } from '../lib/prisma.js'
import { requirePermission } from '../middleware/permissions.js'
import { createAuditEvent } from '../lib/audit.js'
import { s3, S3_BUCKET } from '../lib/storage.js'
import { CreateRequestSchema, UpdateRequestSchema, AuditAction } from '@clm/types'
import { queueClassifyRequest, queueParseDocument, queueDraftContract, queueLinkIntelligence } from '../lib/queue.js'
import { generateDocument } from '../lib/template-engine.js'
import { requestTemplateVariables } from '../lib/request-template.js'
import { z } from 'zod'
import { indexContract } from '../lib/elasticsearch.js'

const ALLOWED_MIME = new Set(['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'])

export async function requestRoutes(app: FastifyInstance) {
  // GET /api/v1/requests
  app.get('/', { preHandler: requirePermission('view', 'request') }, async (req, reply) => {
    const query = req.query as { status?: string; cursor?: string; limit?: string; search?: string }
    const { orgId } = req.user
    const limit = Number(query.limit ?? 25)

    const where = {
      orgId,
      deletedAt: null,
      ...(query.status && { status: query.status }),
      ...(query.search && {
        OR: [
          { title: { contains: query.search, mode: 'insensitive' as const } },
          { counterpartyName: { contains: query.search, mode: 'insensitive' as const } },
          { requestNumber: { contains: query.search, mode: 'insensitive' as const } },
        ],
      }),
    }

    // Scope enforcement: restrict to own requests for users with 'own' scope
    if (req.permissionScope === 'own') {
      (where as any).requestedById = req.user.sub
    }

    const [requests, total] = await Promise.all([
      prisma.contractRequest.findMany({
        where,
        take: limit + 1,
        ...(query.cursor && { cursor: { id: query.cursor }, skip: 1 }),
        orderBy: { createdAt: 'desc' },
      }),
      prisma.contractRequest.count({ where }),
    ])

    const hasMore = requests.length > limit
    const data = hasMore ? requests.slice(0, limit) : requests

    return reply.send({ data, cursor: hasMore ? data[data.length - 1].id : undefined, hasMore, total })
  })

  // GET /api/v1/requests/counts — { SUBMITTED: 3, IN_REVIEW: 2, … }
  //
  // B.6.16 — the Requests page uses this to render counts inline on
  // each tab so users know which queue has work before clicking. One
  // groupBy aggregate; no correlated subqueries.
  app.get('/counts', { preHandler: requirePermission('view', 'request') }, async (req, reply) => {
    const { orgId } = req.user
    const where: { orgId: string; deletedAt: null; requestedById?: string } = {
      orgId,
      deletedAt: null,
    }
    if (req.permissionScope === 'own') where.requestedById = req.user.sub
    const rows = await prisma.contractRequest.groupBy({
      by: ['status'],
      where,
      _count: { _all: true },
    })
    const counts: Record<string, number> = {}
    let total = 0
    for (const r of rows) {
      counts[r.status] = r._count._all
      total += r._count._all
    }
    return reply.send({ counts, total })
  })

  // POST /api/v1/requests — accepts multipart (optional file attachment) or JSON
  app.post('/', { preHandler: requirePermission('create', 'request') }, async (req, reply) => {
    const { sub: requestedById, orgId } = req.user

    let body: ReturnType<typeof CreateRequestSchema.parse>
    const attachments: Array<{ filename: string; s3Key: string; mimeType: string; size: number }> = []

    const contentType = req.headers['content-type'] ?? ''
    if (contentType.includes('multipart/form-data')) {
      // Parse multipart — fields first, then optional file
      const parts = req.parts()
      const fields: Record<string, string> = {}
      let fileBuffer: Buffer | null = null
      let filename = ''
      let mimeType = ''

      for await (const part of parts) {
        if (part.type === 'field') {
          fields[part.fieldname] = part.value as string
        } else if (part.type === 'file') {
          if (!ALLOWED_MIME.has(part.mimetype)) {
            await part.toBuffer() // drain
            return reply.status(400).send({ detail: 'Only PDF and DOCX files are supported' })
          }
          fileBuffer = await part.toBuffer()
          filename = part.filename
          mimeType = part.mimetype
        }
      }

      // Parse JSON body field if sent as JSON string
      let rawBody: unknown
      if (fields.body) {
        try {
          rawBody = JSON.parse(fields.body)
        } catch {
          return reply.status(400).send({ detail: 'Invalid JSON in body field' })
        }
      } else {
        rawBody = fields
      }
      body = CreateRequestSchema.parse(rawBody)

      // Upload file to S3 if provided
      if (fileBuffer && filename) {
        const tempId = Date.now()
        const s3Key = `${orgId}/requests/${tempId}-${filename}`
        await s3.send(new PutObjectCommand({
          Bucket: S3_BUCKET,
          Key: s3Key,
          Body: fileBuffer,
          ContentType: mimeType,
        }))
        attachments.push({ filename, s3Key, mimeType, size: fileBuffer.length })
      }
    } else {
      body = CreateRequestSchema.parse(req.body)
    }

    // Auto-generate request number: REQ-YYYYMMDD-NNN
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '')
    const countToday = await prisma.contractRequest.count({
      where: { orgId, createdAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) } },
    })
    const requestNumber = `REQ-${today}-${String(countToday + 1).padStart(3, '0')}`

    // P7.4.14 / F-56 — counterpartyId comes off the typeahead. Strip it
    // off `body` because ContractRequest has no column for it yet, and
    // stash it under metadata so the rest of the system can read it.
    const { counterpartyId, ...bodyForDb } = body as typeof body & { counterpartyId?: string }
    const metadata: Record<string, unknown> = {
      ...((body.metadata ?? {}) as Record<string, unknown>),
      ...(counterpartyId ? { counterpartyId } : {}),
    }

    const request = await prisma.contractRequest.create({
      data: {
        ...bodyForDb,
        orgId,
        requestedById,
        requestNumber,
        metadata: metadata as Prisma.InputJsonValue,
        attachments: attachments.length > 0 ? attachments : undefined,
      } as Prisma.ContractRequestUncheckedCreateInput,
    })

    // Rename S3 key to use real request ID (for clean paths)
    if (attachments.length > 0) {
      const updated: typeof attachments = []
      for (const att of attachments) {
        const newKey = `${orgId}/requests/${request.id}/${att.filename}`
        // Fire-and-forget copy + delete would require GetObject+Put; simpler: just store tempKey as-is
        updated.push({ ...att })
      }
      await prisma.contractRequest.update({
        where: { id: request.id },
        data: { attachments: updated },
      })
    }

    await createAuditEvent({
      orgId,
      userId: requestedById,
      action: AuditAction.REQUEST_CREATED,
      resourceType: 'contract_request',
      resourceId: request.id,
    })

    // Queue AI classification in background
    queueClassifyRequest({ requestId: request.id, orgId })

    return reply.status(201).send(request)
  })

  // GET /api/v1/requests/:id
  app.get('/:id', { preHandler: requirePermission('view', 'request') }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const { orgId } = req.user

    const request = await prisma.contractRequest.findFirst({
      where: { id, orgId, deletedAt: null },
    })

    if (!request) return reply.status(404).send({ detail: 'Request not found' })
    return reply.send(request)
  })

  // PATCH /api/v1/requests/:id
  app.patch('/:id', { preHandler: requirePermission('edit', 'request') }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const { orgId, sub: userId } = req.user
    const body = UpdateRequestSchema.parse(req.body)

    const existing = await prisma.contractRequest.findFirst({
      where: { id, orgId, deletedAt: null },
    })

    if (!existing) return reply.status(404).send({ detail: 'Request not found' })

    const updated = await prisma.contractRequest.update({
      where: { id },
      data: body,
    })

    await createAuditEvent({
      orgId,
      userId,
      action: body.status
        ? AuditAction.REQUEST_STATUS_CHANGED
        : AuditAction.REQUEST_ASSIGNED,
      resourceType: 'contract_request',
      resourceId: id,
      metadata: { changes: body },
    })

    return reply.send(updated)
  })

  // POST /api/v1/requests/:id/convert — accept request and create a Contract
  // POST /api/v1/requests/:id/convert
  //
  // Turns a request into a contract without anyone re-typing it:
  //   • with an attachment → that document becomes version 1 and is parsed
  //     and linked for analysis (the third-party-paper path)
  //   • else with a template → the org's published template for the type (or
  //     the one named) is generated with variables filled from the request —
  //     deterministic, and works on a self-hosted install with no model key
  //   • else → the AI drafting agent, as before
  app.post('/:id/convert', { preHandler: requirePermission('edit', 'request') }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const { orgId, sub: userId } = req.user
    const parsed = ConvertSchema.safeParse(req.body ?? {})
    if (!parsed.success) return reply.status(400).send({ detail: 'Invalid request', issues: parsed.error.issues })
    const body = parsed.data

    const request = await prisma.contractRequest.findFirst({
      where: { id, orgId, deletedAt: null },
    })
    if (!request) return reply.status(404).send({ detail: 'Request not found' })
    if (request.status === 'ACCEPTED' || request.status === 'COMPLETED') {
      return reply.status(400).send({ detail: 'Request already converted' })
    }

    const attachments = (request.attachments as Array<{ filename: string; s3Key: string; mimeType: string; size: number }>) ?? []
    const hasAttachments = attachments.length > 0
    const reqMeta = (request.metadata ?? {}) as Record<string, unknown>

    // Resolve the template before claiming, so a bad templateId is a clean 404.
    let template: Awaited<ReturnType<typeof loadTemplate>> = null
    if (!hasAttachments && body.draftWith !== 'ai') {
      template = await loadTemplate(orgId, request.type, body.templateId)
      if (body.templateId && !template) return reply.status(404).send({ detail: 'Template not found' })
    }

    // Claim the request: two converts racing must create one contract.
    const claimed = await prisma.contractRequest.updateMany({
      where: { id, orgId, deletedAt: null, status: { notIn: ['ACCEPTED', 'COMPLETED'] } },
      data:  { status: 'ACCEPTED' },
    })
    if (claimed.count === 0) return reply.status(400).send({ detail: 'Request already converted' })

    let contractId: string
    let mode: 'attachment' | 'template' | 'ai'
    try {
      const base = {
        orgId,
        title:            request.title,
        type:             request.type,
        status:           'DRAFT',
        counterpartyName: request.counterpartyName ?? undefined,
        value:            request.estimatedValue ?? undefined,
        ownerId:          userId,
        spaceId:          request.spaceId ?? undefined,
      }

      if (hasAttachments) {
        mode = 'attachment'
        const att = attachments[0]
        const contract = await prisma.contract.create({
          data: {
            ...base,
            analysisStatus: 'PENDING',
            metadata: { fromRequestId: id },
            versions: { create: { versionNumber: 1, s3Key: att.s3Key, mimeType: att.mimeType, fileSize: att.size, createdById: userId } },
          },
          include: { versions: true },
        })
        await prisma.contract.update({ where: { id: contract.id }, data: { currentVersionId: contract.versions[0].id } })
        contractId = contract.id
        queueParseDocument({
          contractId, versionId: contract.versions[0].id,
          s3Key: att.s3Key, mimeType: att.mimeType, filename: att.filename, orgId,
        })
        // The upload route links every stored file for analysis; a document
        // arriving through intake is the same third-party paper.
        queueLinkIntelligence({ contractId, orgId, userId, s3Key: att.s3Key, mimeType: att.mimeType, filename: att.filename })
      } else if (template) {
        mode = 'template'
        const requester = await prisma.user.findFirst({ where: { id: request.requestedById, orgId }, select: { name: true } })
        const variableDefs = Array.isArray(template.variables) ? (template.variables as Array<{ key: string }>) : []
        const variables = requestTemplateVariables({
          title: request.title, type: request.type, description: request.description,
          counterpartyName: request.counterpartyName, estimatedValue: request.estimatedValue,
          requesterName: requester?.name ?? null, metadata: reqMeta,
        }, variableDefs)
        const clauseRefs = template.sections.flatMap(sec => Array.isArray(sec.clauseRefs) ? (sec.clauseRefs as string[]) : [])
        const clauseItems = clauseRefs.length
          ? await prisma.clauseLibraryItem.findMany({ where: { id: { in: clauseRefs }, orgId, deletedAt: null } })
          : []
        const doc = generateDocument({ template, variables, clauseMap: new Map(clauseItems.map(c => [c.id, c])) })

        const contract = await prisma.contract.create({
          data: {
            ...base,
            analysisStatus: 'DONE',
            metadata: {
              fromRequestId: id,
              fromTemplate: { id: template.id, name: template.name, version: template.version, unfilledVariables: doc.unfilledVariables },
            },
            versions: {
              create: {
                versionNumber: 1,
                htmlContent:   doc.html,
                plainText:     doc.html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
                mimeType:      'text/html',
                fileSize:      Buffer.byteLength(doc.html),
                changeNote:    `Generated from template "${template.name}" v${template.version}`,
                createdById:   userId,
              },
            },
          },
          include: { versions: true },
        })
        await prisma.contract.update({ where: { id: contract.id }, data: { currentVersionId: contract.versions[0].id } })
        await prisma.template.update({ where: { id: template.id }, data: { usageCount: { increment: 1 } } })
        contractId = contract.id
      } else {
        mode = 'ai'
        // Draft context — stored in metadata so retry can re-queue without the original request
        const draftContext = {
          requestTitle:       request.title,
          requestDescription: request.description ?? (reqMeta.description as string) ?? request.title,
          contractType:       request.type,
          counterpartyName:   request.counterpartyName ?? undefined,
          estimatedValue:     request.estimatedValue != null ? Number(request.estimatedValue) : undefined,
        }
        const contract = await prisma.contract.create({
          data: { ...base, analysisStatus: 'DRAFTING', metadata: { fromRequestId: id, _draftContext: draftContext } },
        })
        contractId = contract.id
        queueDraftContract({ contractId, orgId, userId, ...draftContext })
      }
    } catch (err) {
      // Nothing was created that the request points at; let it be converted again.
      await prisma.contractRequest.updateMany({ where: { id, status: 'ACCEPTED' }, data: { status: request.status } })
      throw err
    }

    // Index into ES so the new contract is searchable immediately.
    // Fire-and-forget — never block the response.
    indexContract(contractId, {
      orgId,
      title:            request.title,
      type:             request.type,
      status:           'DRAFT',
      counterpartyName: request.counterpartyName ?? undefined,
      plainText:        '',
      tags:             [],
      createdAt:        new Date().toISOString(),
    }).catch(err => req.log.warn({ err }, 'ES index on request-convert failed'))

    await createAuditEvent({
      orgId, userId,
      action: AuditAction.CONTRACT_CREATED,
      resourceType: 'contract',
      resourceId: contractId,
      metadata: { fromRequestId: id, mode, ...(template && { templateId: template.id, templateVersion: template.version }) },
    })
    await createAuditEvent({
      orgId, userId,
      action: AuditAction.REQUEST_STATUS_CHANGED,
      resourceType: 'contract_request',
      resourceId: id,
      metadata: { status: 'ACCEPTED', contractId },
    })

    return reply.status(201).send({ contractId, mode })
  })
}

const ConvertSchema = z.object({
  /** A specific template; otherwise the org's most-used published one for the type. */
  templateId: z.string().trim().min(1).max(64).optional(),
  /** Force AI drafting even when a template exists. */
  draftWith:  z.enum(['template', 'ai']).optional(),
})

/** The template a conversion drafts from, with its sections. */
async function loadTemplate(orgId: string, contractType: string, templateId?: string) {
  const include = { sections: { orderBy: { sortOrder: 'asc' as const } } }
  if (templateId) {
    return prisma.template.findFirst({ where: { id: templateId, orgId, deletedAt: null }, include })
  }
  return prisma.template.findFirst({
    where:   { orgId, deletedAt: null, isPublished: true, contractType },
    orderBy: [{ usageCount: 'desc' }, { updatedAt: 'desc' }],
    include,
  })
}
