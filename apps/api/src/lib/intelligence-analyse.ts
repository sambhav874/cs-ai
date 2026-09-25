/**
 * Ask the intelligence tier for a contract's key-term analysis.
 *
 * Replaces the old POST /agents/review. The analysis runs on ContractSense's
 * extractor (every term with a verified quote, or reported absent) and comes
 * back through POST /api/internal/contracts/:id/analysis/sync. This call only
 * starts it.
 *
 * I/O is injected so the request shape and status mapping are unit-tested
 * without a network.
 */

export interface AnalysisRequest {
  contractId:   string
  orgId:        string
  versionId:    string
  runId:        string
  plainText:    string
  contractType: string | null
  customFields: Array<{ fieldKey: string; fieldLabel: string; fieldType: string; options: string[]; helpText?: string }>
  /** The version has a PDF or DOCX, so an analysis copy is on its way. */
  expectLinked: boolean
}

export interface AnalyseDeps {
  fetch: typeof fetch
  intelligenceUrl: string
  internalSecret: string
}

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

/** Whether a version's file is one the intelligence tier links (PDF, DOCX). */
export function expectsAnalysisCopy(version: { s3Key: string | null; mimeType: string | null }): boolean {
  return !!version.s3Key && (version.mimeType === 'application/pdf' || version.mimeType === DOCX)
}

export class AnalysisRequestError extends Error {
  constructor(message: string, readonly retryable: boolean) { super(message) }
}

export async function requestAnalysis(req: AnalysisRequest, deps: AnalyseDeps): Promise<void> {
  if (!deps.internalSecret) throw new AnalysisRequestError('INTERNAL_SERVICE_SECRET is not set', false)
  let res: Response
  try {
    res = await deps.fetch(
      `${deps.intelligenceUrl.replace(/\/+$/, '')}/internal/contracts/${encodeURIComponent(req.contractId)}/analyse`,
      {
        method:  'POST',
        headers: { 'content-type': 'application/json', 'X-Internal-Secret': deps.internalSecret },
        body:    JSON.stringify({
          org_id:        req.orgId,
          version_id:    req.versionId,
          run_id:        req.runId,
          plain_text:    req.plainText,
          contract_type: req.contractType,
          custom_fields: req.customFields,
          expect_linked: req.expectLinked,
        }),
      },
    )
  } catch (err) {
    throw new AnalysisRequestError(`intelligence unreachable: ${(err as Error).message}`, true)
  }
  if (res.ok) return
  const detail = (await res.text().catch(() => '')).slice(0, 300)
  // 5xx, 408 and 429 are worth another attempt; any other 4xx will answer the
  // same way next time.
  const retryable = res.status >= 500 || res.status === 408 || res.status === 429
  throw new AnalysisRequestError(`intelligence refused the analysis (${res.status}): ${detail}`, retryable)
}

export function defaultAnalyseDeps(): AnalyseDeps {
  return {
    fetch,
    intelligenceUrl: process.env.INTELLIGENCE_URL ?? 'http://localhost:8000',
    internalSecret:  process.env.INTERNAL_SERVICE_SECRET ?? '',
  }
}
