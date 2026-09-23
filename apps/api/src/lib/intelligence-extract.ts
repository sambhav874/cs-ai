/**
 * Ask the intelligence tier to (re-)extract a contract's obligations.
 *
 * Extraction runs there — ContractSense's engine reads the whole document and
 * verifies every quote — and the records come back through
 * POST /api/internal/obligations/sync when the run finishes. This call only
 * starts it, so it answers in milliseconds whatever the contract's length.
 *
 * I/O is injected so the status mapping is unit-tested without a network.
 */

export type ExtractionRequestOutcome =
  | { status: 'queued' }
  /** No analysis copy yet: the contract has to be linked first. */
  | { status: 'not_linked' }
  /** Linked but still being parsed, or a run is already in flight. */
  | { status: 'busy'; detail: string }
  | { status: 'unavailable'; detail: string }

export interface ExtractDeps {
  fetch: typeof fetch
  intelligenceUrl: string
  internalSecret: string
}

export async function requestObligationExtraction(
  { contractId, orgId, userId }: { contractId: string; orgId: string; userId: string },
  deps: ExtractDeps,
): Promise<ExtractionRequestOutcome> {
  if (!deps.internalSecret) return { status: 'unavailable', detail: 'INTERNAL_SERVICE_SECRET is not set' }
  let res: Response
  try {
    res = await deps.fetch(
      `${deps.intelligenceUrl.replace(/\/+$/, '')}/internal/contracts/${encodeURIComponent(contractId)}/extract-obligations`,
      {
        method:  'POST',
        headers: { 'content-type': 'application/json', 'X-Internal-Secret': deps.internalSecret },
        body:    JSON.stringify({ org_id: orgId, user_id: userId }),
      },
    )
  } catch (err) {
    return { status: 'unavailable', detail: (err as Error).message }
  }
  if (res.ok) return { status: 'queued' }
  const detail = await res.json().then((b: { detail?: unknown }) => String(b?.detail ?? ''), () => '')
  if (res.status === 404) return { status: 'not_linked' }
  if (res.status === 409) return { status: 'busy', detail }
  return { status: 'unavailable', detail: detail || `intelligence answered ${res.status}` }
}

export function defaultExtractDeps(): ExtractDeps {
  return {
    fetch,
    intelligenceUrl: process.env.INTELLIGENCE_URL ?? 'http://localhost:8000',
    internalSecret:  process.env.INTERNAL_SERVICE_SECRET ?? '',
  }
}
