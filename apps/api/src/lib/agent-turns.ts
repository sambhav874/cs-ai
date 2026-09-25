/**
 * Server-side persistence of assistant turns (plan P2).
 *
 * The chat used to POST each finished turn back to /agent/threads/:id/turns
 * from the browser, so a closed tab or a crash mid-stream lost the turn, and
 * the assistant's memory of the conversation lived in a separate Redis
 * session the thread never saw. Now the chat proxy (routes/agents.ts) reads
 * the stream as it forwards it, persists the turn when it ends — even if the
 * client left — and sends the thread's earlier turns to the assistant as its
 * history. The thread is the one record of the conversation.
 *
 * `TurnCollector` is pure (bytes in, a turn out) and unit-tested; the rest is
 * a handful of Prisma calls.
 */
import { prisma } from './prisma.js'

// Tools a following turn refers to by ordinal ("the second one"): their
// results are kept longer so the listing survives replay.
const LISTING_TOOLS = new Set([
  'contract_search', 'contract_filter', 'portfolio_search', 'counterparty_list', 'clause_search',
  'contract_validate', 'request_list', 'custom_field_list',
])
const PERSIST_CHARS = 2_000
const PERSIST_LISTING_CHARS = 8_000
export const HISTORY_TURNS = 10

export interface CollectedToolCall {
  id: string
  name: string
  args: Record<string, unknown>
  result?: string
  ok?: boolean
  /** An Apply card: proposed, not executed. */
  proposal?: { preview: Record<string, unknown> | null; reversible: boolean; source: string }
}

export interface CollectedTurn {
  text: string
  /** The answer's verified citations (the citations frame). */
  citations: unknown[]
  toolCalls: CollectedToolCall[]
  error: string | null
  done: {
    provider?: string; model?: string; tier?: string; source?: string
    usage?: { inputTokens?: number; outputTokens?: number; modelCalls?: number }
  } | null
}

/** Reads the assistant's SSE stream frame by frame, as it is forwarded. */
export class TurnCollector {
  private decoder = new TextDecoder()
  private buffer = ''
  private calls = new Map<string, CollectedToolCall>()
  private text = ''
  private final: string | null = null
  private citations: unknown[] = []
  private error: string | null = null
  private done: CollectedTurn['done'] = null

  feed(bytes: Uint8Array): void {
    this.buffer += this.decoder.decode(bytes, { stream: true })
    let at: number
    while ((at = this.buffer.indexOf('\n\n')) !== -1) {
      const frame = this.buffer.slice(0, at)
      this.buffer = this.buffer.slice(at + 2)
      for (const line of frame.split('\n')) {
        if (!line.startsWith('data: ')) continue
        const data = line.slice(6)
        if (data === '[DONE]') continue
        try { this.frame(JSON.parse(data) as Record<string, unknown>) } catch { /* one bad frame is not the turn */ }
      }
    }
  }

  private call(id: string, name: string): CollectedToolCall {
    let c = this.calls.get(id)
    if (!c) { c = { id, name, args: {} }; this.calls.set(id, c) }
    return c
  }

  private frame(f: Record<string, unknown>): void {
    const id = String(f.id ?? '')
    switch (f.type) {
      case 'token':
        if (typeof f.delta === 'string') this.text += f.delta
        break
      case 'citations':
        if (Array.isArray(f.citations)) this.citations = f.citations
        break
      case 'final':
        if (typeof f.answer === 'string') this.final = f.answer
        break
      case 'tool_call_start': {
        const c = this.call(id, String(f.name ?? 'unknown'))
        if (f.args && typeof f.args === 'object') c.args = f.args as Record<string, unknown>
        break
      }
      case 'tool_call_result': {
        const c = this.call(id, String(f.name ?? 'unknown'))
        c.result = typeof f.result === 'string' ? f.result : JSON.stringify(f.result ?? '')
        c.ok = f.ok !== false
        break
      }
      case 'tool_call_awaiting_confirmation': {
        const c = this.call(id, String(f.name ?? 'unknown'))
        if (f.args && typeof f.args === 'object') c.args = f.args as Record<string, unknown>
        c.proposal = {
          preview: (f.preview && typeof f.preview === 'object') ? f.preview as Record<string, unknown> : null,
          reversible: Boolean(f.reversible),
          source: String(f.source ?? 'lifecycle'),
        }
        break
      }
      case 'error':
        this.error = String(f.error ?? 'agent error')
        break
      case 'done':
        this.done = f as CollectedTurn['done']
        break
    }
  }

  turn(): CollectedTurn {
    return {
      // The validated answer when the citation pipeline rewrote it.
      text: this.final ?? this.text,
      citations: this.citations,
      toolCalls: [...this.calls.values()],
      error: this.error,
      done: this.done,
    }
  }
}

/**
 * The thread this turn belongs to, created on first use. False when the id
 * belongs to someone else: that turn is not persisted and gets no history.
 */
export async function ensureThread(
  id: string,
  owner: { orgId: string; userId: string },
  seed: { title: string; scopeType?: string; scopeId?: string },
): Promise<boolean> {
  const existing = await prisma.agentThread.findUnique({ where: { id }, select: { orgId: true, userId: true } })
  if (existing) return existing.orgId === owner.orgId && existing.userId === owner.userId
  await prisma.agentThread.create({
    data: {
      id, orgId: owner.orgId, userId: owner.userId,
      title: seed.title.length <= 60 ? seed.title : seed.title.slice(0, 57) + '…',
      scopeType: seed.scopeType, scopeId: seed.scopeId,
    },
  }).catch(() => { /* created by a concurrent request */ })
  return true
}

export interface HistoryTurn {
  role: 'user' | 'assistant'
  content: string
  toolCalls: Array<{ id: string; name: string; args: Record<string, unknown>; result?: string }>
}

function textOf(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map(b => (b && typeof b === 'object' && (b as { type?: string }).type === 'text' ? String((b as { text?: unknown }).text ?? '') : ''))
    .filter(Boolean).join('\n\n')
}

/** The thread's last turns, oldest first, with each assistant turn's tool calls. */
export async function loadHistory(threadId: string, turns = HISTORY_TURNS): Promise<HistoryTurn[]> {
  const messages = await prisma.agentMessage.findMany({
    where: { threadId, role: { in: ['user', 'assistant'] } },
    orderBy: { createdAt: 'desc' },
    take: turns * 2,
    select: { id: true, role: true, content: true },
  })
  messages.reverse()
  const ids = messages.filter(m => m.role === 'assistant').map(m => m.id)
  const calls = ids.length
    ? await prisma.toolCall.findMany({
        where: { threadId, messageId: { in: ids }, status: { in: ['success', 'error', 'awaiting_confirmation', 'applied'] } },
        orderBy: { createdAt: 'asc' },
        select: { id: true, messageId: true, toolName: true, input: true, output: true, status: true },
      })
    : []
  const byMessage = new Map<string, HistoryTurn['toolCalls']>()
  for (const c of calls) {
    const output = (c.output ?? {}) as { preview?: unknown }
    const list = byMessage.get(c.messageId) ?? []
    list.push({
      id: c.id,
      name: c.toolName,
      args: (c.input && typeof c.input === 'object' ? c.input : {}) as Record<string, unknown>,
      // A proposal replays as what became of it: still waiting, or applied by
      // the user (routes/agent-threads.ts resolveProposal), so the model does
      // not offer the same change again or claim it is still pending.
      result: c.status === 'awaiting_confirmation' || c.status === 'applied'
        ? JSON.stringify({
            status: c.status === 'applied' ? 'applied_by_user' : 'awaiting_user_confirmation',
            summary: (output.preview as { summary?: string } | undefined)?.summary ?? '',
          })
        : typeof output.preview === 'string' ? output.preview : JSON.stringify(output.preview ?? ''),
    })
    byMessage.set(c.messageId, list)
  }
  return messages.map(m => ({
    role: m.role as 'user' | 'assistant',
    content: textOf(m.content),
    toolCalls: m.role === 'assistant' ? byMessage.get(m.id) ?? [] : [],
  }))
}

/** Write the turn: user message, assistant message, its tool calls. One transaction. */
export async function persistTurn(threadId: string, userMessage: string, turn: CollectedTurn): Promise<string> {
  const text = turn.error && !turn.text.trim() ? `⚠ ${turn.error}` : turn.text
  return prisma.$transaction(async (tx) => {
    await tx.agentMessage.create({ data: { threadId, role: 'user', content: [{ type: 'text', text: userMessage }] } })
    const assistant = await tx.agentMessage.create({
      data: {
        threadId, role: 'assistant',
        // Citations ride as their own block: the chat renders them as sources,
        // and history replay reads text blocks only.
        content: [{ type: 'text', text }, ...(turn.citations.length ? [{ type: 'citations', citations: turn.citations }] : [])] as never,
        provider:     turn.done?.provider,
        model:        turn.done?.model,
        tier:         turn.done?.tier,
        inputTokens:  turn.done?.usage?.inputTokens,
        outputTokens: turn.done?.usage?.outputTokens,
        isByok:       turn.done?.source === 'byok',
      },
    })
    for (const c of turn.toolCalls) {
      const cap = LISTING_TOOLS.has(c.name) ? PERSIST_LISTING_CHARS : PERSIST_CHARS
      await tx.toolCall.create({
        data: {
          threadId, messageId: assistant.id, toolName: c.name,
          input: c.args as never,
          status: c.proposal ? 'awaiting_confirmation' : c.ok === false ? 'error' : 'success',
          output: c.proposal
            ? { preview: c.proposal.preview, source: c.proposal.source } as never
            : c.result !== undefined ? { preview: c.result.slice(0, cap) } : undefined,
          reversible: c.proposal?.reversible ?? false,
        },
      })
    }
    await tx.agentThread.update({ where: { id: threadId }, data: { updatedAt: new Date() } })
    return assistant.id
  }, { timeout: 20_000 })
}
