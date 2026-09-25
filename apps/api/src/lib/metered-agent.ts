/**
 * Calls from the editor into the agents service, behind the cost cap and
 * metered (agent merge P5).
 *
 * Rewrite, streamed rewrite, autocomplete, margin clause labels, playbook
 * compare and drafting called the model with no cap check and no usage row,
 * so an org's editor spend was invisible in Admin → AI Usage and could run
 * past its daily cap. Each now checks the cap before the call and records
 * usage after it. The agents service does not report token counts for these
 * routes, so usage is estimated from the characters in and out — the same
 * estimate the background jobs use — under the model the reply names, when
 * it names one.
 */
import { assertCostCapNotExceeded, CostCapExceededError, estimateCostUsd, recordUsage } from './costCap.js'

const AGENTS_URL = process.env.AGENTS_URL ?? 'http://localhost:8000/agents'
const INTERNAL_SECRET = process.env.INTERNAL_SERVICE_SECRET ?? ''

export type MeteredResult =
  | { kind: 'capped'; usedUsd: number; capUsd: number }
  | { kind: 'unavailable' }
  | { kind: 'response'; response: Response; requestChars: number }

export async function meteredAgentCall(
  path: string,
  payload: unknown,
  meta: { orgId: string; toolName: string },
): Promise<MeteredResult> {
  try {
    await assertCostCapNotExceeded(meta.orgId)
  } catch (e) {
    if (e instanceof CostCapExceededError) return { kind: 'capped', usedUsd: e.usedUsd, capUsd: e.capUsd }
    throw e
  }
  const body = JSON.stringify(payload)
  const response = await fetch(`${AGENTS_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-internal-secret': INTERNAL_SECRET },
    body,
  }).catch(() => null)
  if (!response) return { kind: 'unavailable' }
  return { kind: 'response', response, requestChars: body.length }
}

/** Record usage for a finished call. Never throws: metering must not fail a reply. */
export function meter(
  meta: { orgId: string; toolName: string },
  requestChars: number,
  responseChars: number,
  reported?: { model?: unknown; provider?: unknown },
): void {
  const model = typeof reported?.model === 'string' && reported.model ? reported.model : 'agents-service'
  const provider = typeof reported?.provider === 'string' && reported.provider ? reported.provider : 'agents-service'
  recordUsage(meta.orgId, estimateCostUsd(requestChars + responseChars), {
    provider, model, tier: 'default', toolName: meta.toolName,
    inputChars: requestChars, outputChars: responseChars,
  }).catch(() => { /* accounting never fails the call */ })
}

/** A JSON reply, metered. Null when the call did not succeed. */
export async function meteredJson<T = Record<string, unknown>>(
  path: string,
  payload: unknown,
  meta: { orgId: string; toolName: string },
): Promise<{ status: 'capped'; usedUsd: number; capUsd: number } | { status: 'failed' } | { status: 'ok'; data: T }> {
  const result = await meteredAgentCall(path, payload, meta)
  if (result.kind === 'capped') return { status: 'capped', usedUsd: result.usedUsd, capUsd: result.capUsd }
  if (result.kind === 'unavailable') return { status: 'failed' }
  const text = await result.response.text().catch(() => '')
  // A failed generation still spent tokens upstream.
  meter(meta, result.requestChars, text.length)
  if (!result.response.ok) return { status: 'failed' }
  try {
    const data = JSON.parse(text) as T
    return { status: 'ok', data }
  } catch {
    return { status: 'failed' }
  }
}

export function capBody(used: number, cap: number) {
  return {
    error: 'cost_cap_exceeded',
    detail: 'Daily AI spend cap reached for this organization. Contact your admin to raise the cap or wait for the daily reset (UTC midnight).',
    usedUsd: Number(used.toFixed(4)),
    capUsd: Number(cap.toFixed(2)),
  }
}
