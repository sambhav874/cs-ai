import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requireAuth } from '../middleware/auth.js'
// Wave 1.7 — AI-consuming endpoints are gated on view:contract so a scopeless
// public-API key (or a non-contract principal) can't burn the org's LLM
// budget. Per-turn cost enforcement is tightened separately in Wave 3.
import { requirePermission } from '../middleware/permissions.js'
import { getPermissionsForRoles, evaluatePermission } from '../lib/permissions.js'
import { createAuditEvent } from '../lib/audit.js'
import { ChatMessageSchema, AuditAction } from '@clm/types'
import { prisma } from '../lib/prisma.js'
import { queueClassifyDocument } from '../lib/queue.js'
import { assertCostCapNotExceeded, recordCost, CostCapExceededError, recordUsage } from '../lib/costCap.js'
import { costForTokens } from '../lib/model-pricing.js'
import { randomUUID } from 'node:crypto'
import { capBody, meter, meteredAgentCall, meteredJson } from '../lib/metered-agent.js'
import { TurnCollector, ensureThread, loadHistory, persistTurn } from '../lib/agent-turns.js'

const AGENTS_URL = process.env.AGENTS_URL ?? 'http://localhost:8000/agents'
const INTERNAL_SECRET = process.env.INTERNAL_SERVICE_SECRET ?? ''

const AssistSchema = z.object({
  selectedText: z.string().min(1),
  action: z.enum(['rewrite', 'simplify', 'expand', 'check_compliance', 'suggest_alternative', 'fix_layout', 'rewrite_document']),
  contractType: z.string().optional().default('general commercial'),
  governingLaw: z.string().optional().default('Delaware'),
  provider: z.string().optional(),
  modelId: z.string().optional(),
})

export async function agentRoutes(app: FastifyInstance) {
  // GET /api/v1/agent/models — list supported providers + models
  app.get('/models', { preHandler: requireAuth }, async (_req: unknown, reply) => {
    const upstream = await fetch(`${AGENTS_URL}/agent/models`, {
      headers: { 'x-internal-secret': INTERNAL_SECRET },
    }).catch(() => null)
    if (!upstream?.ok) {
      return reply.status(502).send({ detail: 'Agent service unavailable' })
    }
    return reply.send(await upstream.json())
  })

  // POST /api/v1/agent/chat — the assistant, streamed.
  //
  // The assistant runs on the intelligence tier (services/assistant). This
  // route decides who may ask what, hands over the thread's earlier turns,
  // forwards the stream byte for byte, and persists the turn when the stream
  // ends — whether or not the browser is still there. The thread is the one
  // record of the conversation (lib/agent-turns.ts).
  app.post('/chat', { preHandler: requirePermission('view', 'contract') }, async (req, reply) => {
    const body = ChatMessageSchema.parse(req.body)
    const { sub: userId, orgId } = req.user

    // P23 production audit (2026-04-29). Block before we proxy so a
    // cap-busted org doesn't burn another LLM round-trip. This gate reads the
    // same Redis counter that recordCost() writes. Wave 3.6 — the chat path now
    // records its own spend after the stream completes (see the finally block
    // below); previously it read the counter but never wrote it, so chat could
    // blow past the daily cap indefinitely.
    try {
      await assertCostCapNotExceeded(orgId)
    } catch (e) {
      if (e instanceof CostCapExceededError) {
        return reply.status(429).send({
          error:  'cost_cap_exceeded',
          detail: 'Daily AI spend cap reached for this organization. Contact your admin to raise the cap or wait for the daily reset (UTC midnight).',
          usedUsd: Number(e.usedUsd.toFixed(4)),
          capUsd:  Number(e.capUsd.toFixed(2)),
        })
      }
      throw e
    }

    // Tools this caller may not use. Drafting is a proposal now, and Apply
    // checks create:contract, but a caller who can never create one should
    // not be offered a draft they cannot keep.
    const callerPermissions = req.user.apiPermissions ?? await getPermissionsForRoles(orgId, req.user.roles)
    const deniedTools: string[] = []
    if (!evaluatePermission(callerPermissions, 'create', 'contract').granted) {
      deniedTools.push('contract_create_from_template')
    }

    let skillPromptOverride: string | undefined
    let skillAllowedTools: string[] | undefined
    if (body.skillSlug) {
      const skill = await prisma.skill.findFirst({
        where: {
          slug: body.skillSlug,
          deletedAt: null,
          isPublished: true,
          OR: [
            { orgId },
            { orgId: null, ownerType: 'built_in' },
          ],
        },
        // Prefer org-owned over built-in on a tie.
        orderBy: [{ orgId: 'desc' }, { updatedAt: 'desc' }],
      })
      if (skill) {
        skillPromptOverride = skill.systemPrompt
        skillAllowedTools = skill.allowedTools
        // Record invocation for telemetry + audit. Skill-version freezes
        // behaviour: an edit mid-run can't change this row's effective prompt.
        await prisma.skillInvocation.create({
          data: {
            skillId: skill.id,
            skillVersion: skill.version,
            threadId: body.sessionId ?? 'new-thread', // rail uses sessionId == threadId
            userId,
            orgId,
            contextType: body.pageContext?.type,
            contextId: body.pageContext?.id,
            inputMessage: body.message.slice(0, 5_000),
          },
        }).catch(err => {
          // Don't fail the chat if telemetry write fails.
          app.log.warn({ err, skillSlug: body.skillSlug }, 'skill invocation write failed')
        })
      } else {
        app.log.info({ skillSlug: body.skillSlug, orgId }, 'skill slug not found — falling through')
      }
    }

    // The page scopes the assistant to a contract's or a Space's documents,
    // so it is checked here, where the caller's access is known: another
    // org's contract, or one outside an own-scoped role, is not in scope.
    let pageContext = body.pageContext ?? null
    if (pageContext?.id && pageContext.type === 'contract') {
      const c = await prisma.contract.findFirst({
        where: { id: pageContext.id, orgId, deletedAt: null }, select: { ownerId: true },
      })
      if (!c || (req.permissionScope === 'own' && c.ownerId !== userId)) pageContext = null
    } else if (pageContext?.id && pageContext.type === 'space') {
      const sp = await prisma.space.findFirst({ where: { id: pageContext.id, orgId }, select: { id: true } })
      if (!sp) pageContext = null
    }

    // The client's session id is the thread id. One that belongs to someone
    // else gets a fresh thread rather than their history.
    let threadId = body.sessionId ?? randomUUID()
    let persist = await ensureThread(threadId, { orgId, userId }, {
      title: body.message.trim().replace(/\s+/g, ' '),
      scopeType: pageContext?.id && (pageContext.type === 'contract' || pageContext.type === 'space') ? pageContext.type : undefined,
      scopeId: pageContext?.id,
    }).catch(() => false)
    if (!persist) {
      threadId = randomUUID()
      persist = await ensureThread(threadId, { orgId, userId }, { title: body.message.trim() }).catch(() => false)
    }
    const history = persist ? await loadHistory(threadId).catch(() => []) : []

    let upstream: Response
    try {
      upstream = await fetch(`${AGENTS_URL}/agent/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-internal-secret': process.env.INTERNAL_SERVICE_SECRET ?? '' },
        body: JSON.stringify({
          message: body.message,
          session_id: threadId,
          user_id: userId,
          org_id: orgId,
          page_context: pageContext,
          skill_system_prompt: skillPromptOverride ?? null,
          skill_allowed_tools: skillAllowedTools ?? null,
          // An authorization boundary: tools this caller may not use.
          denied_tools: deniedTools.length ? deniedTools : null,
          skill_slug: body.skillSlug ?? null,
          mentions: body.mentions ?? null,
          history,
        }),
      })
    } catch (err) {
      app.log.warn({ err }, 'agent-chat: intelligence tier unreachable')
      return reply.status(502).send({ detail: 'Agent service unavailable' })
    }
    if (!upstream.ok) {
      const err = await upstream.text()
      return reply.status(upstream.status === 400 ? 400 : 502).send({ detail: err || 'Agent service unavailable' })
    }

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      // Behind nginx the whole stream could otherwise be buffered into one
      // write, and token streaming would be invisible.
      'X-Accel-Buffering': 'no',
    })
    reply.hijack()

    const reader = upstream.body?.getReader()
    if (!reader) { try { reply.raw.end() } catch { /* */ } return }

    // Stop and a closed tab look the same from here. Either way the run is
    // cancelled (reading stops, the intelligence tier sees the disconnect)
    // and what the turn produced so far is still persisted and metered below.
    let clientGone = false
    reply.raw.on('close', () => {
      clientGone = true
      try { reader.cancel() } catch { /* */ }
    })
    const collector = new TurnCollector()
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        collector.feed(value)
        if (!clientGone && !reply.raw.writableEnded) {
          // Bytes are forwarded undecoded: decoding per chunk broke characters
          // that straddle a chunk boundary.
          try { reply.raw.write(Buffer.from(value)) } catch { clientGone = true }
        }
      }
    } catch (err) {
      app.log.warn({ err }, 'agent-chat upstream read failed')
    }

    // Persisted before the stream closes, so a client that reloads the thread
    // the moment the answer ends finds it, and the next turn cannot race it.
    const turn = collector.turn()
    if (persist) {
      await persistTurn(threadId, body.message, turn)
        .catch(err => app.log.warn({ err, threadId }, 'agent-chat: turn not persisted'))
    }
    if (!reply.raw.writableEnded) {
      try { reply.raw.end() } catch { /* */ }
    }
    // Metered from the tokens the provider reported for this turn; before,
    // it was estimated from the stream's size and labelled "requested-default".
    const usage = turn.done?.usage
    const inputTokens = usage?.inputTokens ?? Math.ceil(body.message.length / 4)
    const outputTokens = usage?.outputTokens ?? Math.ceil(turn.text.length / 4)
    recordUsage(orgId, costForTokens(turn.done?.model, inputTokens, outputTokens), {
      provider: turn.done?.provider ?? 'unknown',
      model:    turn.done?.model ?? 'unknown',
      tier:     turn.done?.tier ?? 'default',
      toolName: 'agent_chat',
      isByok:   turn.done?.source === 'byok',
      inputChars:  inputTokens * 4,
      outputChars: outputTokens * 4,
    }).catch(e => app.log.warn({ err: e }, '[costCap] recordUsage(agent_chat) failed'))
  })

  // POST /api/v1/agent/draft — AI draft generation → saves as ContractVersion
  app.post('/draft', { preHandler: requirePermission('view', 'contract') }, async (req, reply) => {
    const { orgId, sub: userId } = req.user
    const body = req.body as {
      userMessage: string
      // P61 audit (2026-05-02). Accept an explicit templateId from
      // the UI's NewContractFlow → forward to the Python agent so it
      // skips template-matching and uses the user's selection. Without
      // this the agent re-does the selection from scratch and often
      // returns NO_TEMPLATE_MATCH for org-authored templates without
      // a contractType.
      templateId?: string
      context?: Record<string, unknown>
      saveAs?: { contractId?: string; title?: string }
    }

    if (!body.userMessage?.trim()) {
      return reply.status(400).send({ detail: 'userMessage is required' })
    }

    // `saveAs.contractId` arrives from an unvalidated request body and was used
    // directly in `contractVersion.create` below with no ownership check, so any
    // authenticated user could append an attacker-controlled version to ANY
    // contract in ANY organisation. Every sibling write scopes by org —
    // internal-ai.ts:2388 and clause-apply.ts:242,477 all filter
    // `{ id, orgId, deletedAt: null }`; this route was the exception.
    //
    // Checked here, before the agent call, so a request that will be refused
    // does not also cost a paid LLM run. 404 rather than 403: a caller outside
    // the org should not learn whether the id exists.
    // Saving is a WRITE, and this route is gated only on `view:contract`
    // because drafting without saving is a read-shaped operation. Evaluate the
    // write permission here rather than tightening the preHandler, which would
    // also block a viewer from previewing a draft they never persist.
    //
    // Without this a VIEWER — who POST /api/v1/contracts refuses outright —
    // could create contracts through this route. Reproduced: 200, row created.
    if (body.saveAs?.contractId || body.saveAs?.title) {
      const permissions = req.user.apiPermissions ?? await getPermissionsForRoles(orgId, req.user.roles)
      const action = body.saveAs.contractId ? 'edit' : 'create'
      if (!evaluatePermission(permissions, action, 'contract').granted) {
        return reply.status(403).send({
          type:   'https://httpstatuses.com/403',
          title:  'Forbidden',
          status: 403,
          detail: `Missing permission: ${action}:contract`,
        })
      }
    }

    if (body.saveAs?.contractId) {
      const target = await prisma.contract.findFirst({
        where:  { id: body.saveAs.contractId, orgId, deletedAt: null },
        select: { id: true },
      })
      if (!target) return reply.status(404).send({ detail: 'Contract not found' })
    }

    const ctx: Record<string, unknown> = { ...(body.context ?? {}) }
    if (body.templateId) ctx.template_id = body.templateId

    const drafted = await meteredJson<any>('/draft', {
      user_message: body.userMessage,
      org_id: orgId,
      user_id: userId,
      context: ctx,
    }, { orgId, toolName: 'draft' })
    if (drafted.status === 'capped') return reply.status(429).send(capBody(drafted.usedUsd, drafted.capUsd))
    if (drafted.status === 'failed') return reply.status(502).send({ detail: 'Agent service unavailable' })
    const result = drafted.data

    // A.1 — if the agent returned a typed error (e.g. NO_TEMPLATE_MATCH),
    // reject the request instead of saving garbage. See
    // docs/25-CONTRACT-FLOW-FIX-PLAN.md §Phase A.
    if (result.error || !result.html?.trim()) {
      const code = result.error ?? 'DRAFT_FAILED'
      const detail =
        code === 'NO_TEMPLATE_MATCH'
          ? 'No template matches this contract type. Create a template for this type first, then retry.'
          : `Draft generation failed: ${result.error ?? 'agent returned no HTML'}`
      return reply.status(422).send({ error: code, detail })
    }

    // Optionally save the draft as a ContractVersion
    if (body.saveAs && result.html) {
      try {
        const { contractId, title } = body.saveAs

        if (contractId) {
          // Add a new version to existing contract
          const existing = await prisma.contractVersion.findFirst({
            where: { contractId },
            orderBy: { versionNumber: 'desc' },
          })
          const nextVersion = (existing?.versionNumber ?? 0) + 1

          const version = await prisma.contractVersion.create({
            data: {
              contractId,
              versionNumber: nextVersion,
              htmlContent: result.html,
              plainText: result.html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
              changeNote: `AI-generated draft (${result.usedTemplateName ?? 'no template'})`,
              createdById: userId,
            },
          })
          result.versionId = version.id
        } else if (title) {
          // Create a new contract with this draft.
          //
          // Owned by the CALLER. This used to be
          // prisma.user.findFirst({ where: { orgId } }) -- whichever user the
          // org happened to list first -- so an agent-drafted contract showed
          // up in a stranger's 'my contracts' and the person who asked for it
          // could not find their own draft.
          const owner = { id: userId }
          if (owner) {
            const plainText = result.html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
            const contract = await prisma.contract.create({
              data: {
                orgId,
                ownerId: owner.id,
                title,
                type: result.contractType ?? 'OTHER',
                status: 'DRAFT',
                createdBy: userId,
                analysisStatus: plainText ? 'CLASSIFYING' : 'DONE',
                versions: {
                  create: {
                    versionNumber: 1,
                    htmlContent: result.html,
                    plainText,
                    changeNote: `AI-generated draft (${result.usedTemplateName ?? 'no template'})`,
                    createdById: userId,
                  },
                },
              },
              include: { versions: true },
            })
            result.contractId = contract.id
            // An AI-drafted contract is a real contract and must be traceable
            // to whoever asked for it. The manual REST create audits
            // (contracts.ts); this path did not, so an agent-created contract
            // appeared in the org with no record of who caused it.
            createAuditEvent({
              orgId,
              userId,
              action:       AuditAction.CONTRACT_CREATED,
              resourceType: 'contract',
              resourceId:   contract.id,
              metadata:     { source: 'agent_draft', template: result.usedTemplateName ?? null },
            }).catch(err => app.log.warn({ err }, 'audit on agent draft create failed'))
            if (plainText && contract.versions[0]) {
              queueClassifyDocument({ contractId: contract.id, versionId: contract.versions[0].id, orgId })
            }
          }
        }
      } catch (err) {
        app.log.warn({ err }, 'Failed to save draft as ContractVersion')
      }
    }

    return reply.send(result)
  })

  // POST /api/v1/agent/assist-stream — P6.3 streaming bubble-menu AI.
  // Pipes the Python NDJSON stream straight through to the browser so
  // the bubble popover can render tokens as they arrive. No buffering,
  // no JSON-parse — just raw bytes forwarded.
  app.post('/assist-stream', { preHandler: requirePermission('view', 'contract') }, async (req, reply) => {
    const body = (req.body ?? {}) as {
      selectedText?: string
      action?:       string
      contractType?: string
      governingLaw?: string
    }
    if (typeof body.selectedText !== 'string' || body.selectedText.trim().length === 0) {
      return reply.status(400).send({ detail: 'selectedText is required' })
    }
    const meta = { orgId: req.user.orgId, toolName: 'assist_stream' }
    const call = await meteredAgentCall('/assist_stream', {
      selected_text: body.selectedText,
      action:        body.action ?? 'rewrite',
      contract_type: body.contractType ?? 'general commercial',
      governing_law: body.governingLaw ?? 'Delaware',
      orgId:         req.user.orgId,   // per-org BYOK key + Langfuse tracing
    }, meta)
    if (call.kind === 'capped') return reply.status(429).send(capBody(call.usedUsd, call.capUsd))
    const upstream = call.kind === 'response' ? call.response : null
    if (!upstream || !upstream.ok || !upstream.body) {
      return reply.status(502).send({ detail: 'Agent service unavailable' })
    }
    // Fastify-friendly: send the web Response body directly (node 18+).
    reply.raw.setHeader('Content-Type', 'application/x-ndjson')
    reply.raw.setHeader('Cache-Control', 'no-cache')
    reply.raw.setHeader('X-Accel-Buffering', 'no')  // nginx: disable buffering
    const reader = upstream.body.getReader()
    let streamed = 0
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      // Bytes forwarded undecoded, so a character split across chunks survives.
      if (value) { streamed += value.byteLength; reply.raw.write(Buffer.from(value)) }
    }
    reply.raw.end()
    meter(meta, call.kind === 'response' ? call.requestChars : 0, streamed)
    return reply
  })

  // POST /api/v1/agent/classify-clause — P6.2 background classifier.
  // Fires per-paragraph from the editor. Low-latency fast-tier upstream.
  // Rate-limited by the per-paragraph hash cache on the client.
  app.post('/classify-clause', { preHandler: requirePermission('view', 'contract') }, async (req, reply) => {
    const body = (req.body ?? {}) as {
      clauseText?:   string
      contractType?: string
      sectionHint?:  string
    }
    if (typeof body.clauseText !== 'string' || body.clauseText.trim().length < 30) {
      return reply.send({ category: 'skip', position: 'skip', reasoning: '' })
    }
    const labelled = await meteredJson('/classify_clause', {
      clauseText:   body.clauseText.slice(0, 2400),
      contractType: body.contractType ?? 'general commercial',
      sectionHint:  body.sectionHint ?? null,
      orgId:        req.user.orgId, // team model settings + own key
    }, { orgId: req.user.orgId, toolName: 'classify_clause' })
    // Margin labels are background work: over the cap, the editor just
    // shows none, rather than an error on every paragraph.
    if (labelled.status !== 'ok') {
      return reply.send({ category: 'skip', position: 'skip', reasoning: '', error: labelled.status === 'capped' ? 'cost_cap_exceeded' : 'upstream_unavailable' })
    }
    return reply.send(labelled.data)
  })

  // POST /api/v1/agent/complete — P6.1 ghost-text completion.
  // Called by the editor when the user pauses mid-sentence. Proxies
  // straight to the Python fast-tier /complete. Abort-friendly — the
  // client cancels in-flight requests on new keystrokes so we must
  // not do any heavy work here beyond the upstream fetch.
  app.post('/complete', { preHandler: requirePermission('view', 'contract') }, async (req, reply) => {
    const body = (req.body ?? {}) as {
      contextBefore?: string
      contextAfter?:  string
      contractType?:  string
      maxChars?:      number
    }
    if (typeof body.contextBefore !== 'string' || body.contextBefore.length < 10) {
      return reply.send({ completion: '', reason: 'too_short' })
    }
    const completed = await meteredJson('/complete', {
      contextBefore: body.contextBefore.slice(-1400),
      contextAfter:  (body.contextAfter ?? '').slice(0, 400),
      contractType:  body.contractType ?? 'general commercial',
      maxChars:      Math.max(40, Math.min(body.maxChars ?? 160, 320)),
      orgId:         req.user.orgId, // team model settings + own key
    }, { orgId: req.user.orgId, toolName: 'autocomplete' })
    if (completed.status !== 'ok') {
      return reply.send({ completion: '', error: completed.status === 'capped' ? 'cost_cap_exceeded' : 'upstream_unavailable' })
    }
    return reply.send(completed.data)
  })

  // POST /api/v1/agent/assist — inline AI text improvement for editor
  app.post('/assist', { preHandler: requirePermission('view', 'contract') }, async (req, reply) => {
    const body = AssistSchema.parse(req.body)

    const assisted = await meteredJson('/assist', {
      selected_text: body.selectedText,
      action: body.action,
      contract_type: body.contractType,
      governing_law: body.governingLaw,
      provider: body.provider,
      model_id: body.modelId,
      orgId: req.user.orgId,   // per-org BYOK key + Langfuse tracing
    }, { orgId: req.user.orgId, toolName: 'assist' })
    if (assisted.status === 'capped') return reply.status(429).send(capBody(assisted.usedUsd, assisted.capUsd))
    if (assisted.status === 'failed') return reply.status(502).send({ detail: 'Agent service unavailable' })
    return reply.send(assisted.data)
  })

  // POST /api/v1/agent/compare — compare clause text to playbook positions
  app.post('/compare', { preHandler: requirePermission('view', 'contract') }, async (req, reply) => {
    const { orgId } = req.user
    const { clauseText, clauseCategoryId, contractType } = req.body as {
      clauseText: string
      clauseCategoryId: string
      contractType?: string
    }

    if (!clauseText?.trim() || !clauseCategoryId) {
      return reply.status(400).send({ detail: 'clauseText and clauseCategoryId are required' })
    }

    // Fetch playbook positions from DB
    const positions = await prisma.playbookPosition.findMany({
      where: {
        orgId,
        clauseCategoryId,
        ...(contractType ? {
          OR: [
            { contractTypes: { isEmpty: true } },
            { contractTypes: { has: contractType } },
          ],
        } : {}),
      },
      orderBy: { sortOrder: 'asc' },
    })

    if (!positions.length) {
      return reply.status(404).send({ detail: 'No playbook positions found for this category' })
    }

    // orgId selects the team's model settings and its own key (BYOK).
    const compared = await meteredJson('/compare', { clauseText, positions, orgId: req.user.orgId },
      { orgId, toolName: 'playbook_compare' })
    if (compared.status === 'capped') return reply.status(429).send(capBody(compared.usedUsd, compared.capUsd))
    if (compared.status === 'failed') return reply.status(502).send({ detail: 'Agent service unavailable' })
    return reply.send(compared.data)
  })
}
