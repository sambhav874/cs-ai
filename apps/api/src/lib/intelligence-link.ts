/**
 * Push a stored contract file to the intelligence tier, so it has exactly one
 * analysis copy keyed by this contract's id (runbook step 6).
 *
 * The intelligence tier upserts on `platformContractId` and treats identical
 * bytes as a no-op, so this is safe to retry and to re-run for every new
 * version. After the first link, its contract watcher keeps the copy's Space
 * in step with this contract — nothing here needs to run on a Space move.
 *
 * I/O is injected so the decision logic (what to send, what is retryable) is
 * unit-tested without S3, Gotenberg or a network.
 */

export interface LinkContractJob {
  contractId: string
  orgId:      string
  userId:     string
  s3Key:      string
  mimeType:   string
  filename:   string
}

export type LinkOutcome =
  | { status: 'linked'; intelligenceContractId: string; result: string }
  | { status: 'skipped'; reason: string }

/** A failure no retry can fix (bad input, wrong org). The job should stop. */
export class PermanentLinkError extends Error {}

export interface LinkDeps {
  readObject: (key: string) => Promise<Buffer>
  toPdf: (buffer: Buffer, filename: string) => Promise<Buffer>
  fetch: typeof fetch
  intelligenceUrl: string
  internalSecret: string
}

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

export async function linkContractToIntelligence(job: LinkContractJob, deps: LinkDeps): Promise<LinkOutcome> {
  if (!deps.internalSecret) {
    // Fail closed rather than calling without auth; retrying cannot help.
    throw new PermanentLinkError('INTERNAL_SERVICE_SECRET is not set')
  }
  if (job.mimeType !== 'application/pdf' && job.mimeType !== DOCX) {
    // Plain text has no page structure for the pipeline to cite into.
    return { status: 'skipped', reason: `unsupported type ${job.mimeType}` }
  }

  let bytes = await deps.readObject(job.s3Key)
  let filename = job.filename
  if (job.mimeType === DOCX) {
    bytes = await deps.toPdf(bytes, job.filename)
    filename = job.filename.replace(/\.docx$/i, '') + '.pdf'
  }

  const form = new FormData()
  form.append('file', new Blob([new Uint8Array(bytes)], { type: 'application/pdf' }), filename)
  form.append('platform_contract_id', job.contractId)
  form.append('org_id', job.orgId)
  form.append('user_id', job.userId)

  const res = await deps.fetch(`${deps.intelligenceUrl.replace(/\/+$/, '')}/internal/contracts/link`, {
    method:  'POST',
    headers: { 'X-Internal-Secret': deps.internalSecret },
    body:    form,
  })

  if (res.ok) {
    const body = await res.json() as { contract_id: string; status: string }
    return { status: 'linked', intelligenceContractId: body.contract_id, result: body.status }
  }
  const detail = (await res.text().catch(() => '')).slice(0, 300)
  // 4xx other than 408/429 means the request itself is wrong (wrong org,
  // unknown user, not a PDF, bad secret): retrying repeats the same answer.
  if (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429) {
    throw new PermanentLinkError(`intelligence refused the link (${res.status}): ${detail}`)
  }
  throw new Error(`intelligence link failed (${res.status}): ${detail}`)
}
