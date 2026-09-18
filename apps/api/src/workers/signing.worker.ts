/**
 * Signing Worker — seals executed contracts into their signed PDF.
 *
 * 'seal-signed-pdf' — generates the certified/PAdES-sealed PDF for a COMPLETED
 * SignatureRequest and stores it as the contract's new canonical version.
 *
 * This exists as a queue job specifically so the work is RETRYABLE. It used to
 * run inline in the signing route as a fire-and-forget IIFE with swallowed
 * errors, so any transient S3 / Gotenberg / signing-cert failure left the
 * contract EXECUTED with no signed document and no path to recover.
 */
import { Worker } from 'bullmq'
import { redis } from '../lib/redis.js'
import { sealSignedContract } from '../lib/seal-contract.js'
import type { SealSignedPdfJob } from '../lib/queue.js'

export const signingWorker = new Worker(
  'signing',
  async (job) => {
    if (job.name !== 'seal-signed-pdf') return
    const { signatureRequestId } = job.data as SealSignedPdfJob

    const outcome = await sealSignedContract(signatureRequestId)

    if (outcome.status === 'skipped') {
      // Not retryable — these conditions can never succeed. But a skip still
      // means an executed contract has no sealed PDF, which is the exact
      // failure this job exists to prevent, and the job itself completes green.
      // Log at warn so it is greppable rather than buried in info.
      console.warn(
        '[signing-worker] seal SKIPPED sr=%s — contract may be executed without a sealed PDF: %s',
        signatureRequestId, outcome.reason,
      )
    } else if (outcome.status === 'already_sealed') {
      console.info('[signing-worker] seal already present sr=%s version=%s', signatureRequestId, outcome.versionId)
    } else {
      console.info('[signing-worker] sealed sr=%s version=%s key=%s',
        signatureRequestId, outcome.versionId, outcome.signedKey)
    }
    return outcome
  },
  { connection: redis, concurrency: 3 },
)

signingWorker.on('failed', (job, err) => {
  // Surfaced loudly: a contract sitting EXECUTED without its sealed PDF is a
  // missing legal artefact, not a cosmetic problem. BullMQ retries per the
  // job's backoff; this fires on each attempt and on final exhaustion.
  console.error(
    '[signing-worker] seal FAILED sr=%s attempt=%s/%s: %s',
    (job?.data as SealSignedPdfJob | undefined)?.signatureRequestId,
    job?.attemptsMade,
    job?.opts?.attempts,
    err.message,
  )
})
