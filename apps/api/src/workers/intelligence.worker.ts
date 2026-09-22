/**
 * Intelligence Worker — links stored contract files to their analysis copy in
 * apps/intelligence (runbook step 6). See lib/intelligence-link.ts.
 */
import { GetObjectCommand } from '@aws-sdk/client-s3'
import { UnrecoverableError, Worker } from 'bullmq'
import { redis } from '../lib/redis.js'
import { s3, S3_BUCKET } from '../lib/storage.js'
import { convertOfficeToPdf } from '../lib/gotenberg.js'
import {
  linkContractToIntelligence,
  PermanentLinkError,
  type LinkContractJob,
} from '../lib/intelligence-link.js'

async function readObject(key: string): Promise<Buffer> {
  const obj = await s3.send(new GetObjectCommand({ Bucket: S3_BUCKET, Key: key }))
  return Buffer.from(await obj.Body!.transformToByteArray())
}

export const intelligenceWorker = new Worker(
  'intelligence',
  async (job) => {
    if (job.name !== 'link-contract') return
    const data = job.data as LinkContractJob
    try {
      const outcome = await linkContractToIntelligence(data, {
        readObject,
        toPdf: convertOfficeToPdf,
        fetch,
        intelligenceUrl: process.env.INTELLIGENCE_URL ?? 'http://localhost:8000',
        internalSecret: process.env.INTERNAL_SERVICE_SECRET ?? '',
      })
      console.info('[intelligence-worker] contract=%s %s', data.contractId,
        outcome.status === 'linked' ? `${outcome.result} → ${outcome.intelligenceContractId}` : `skipped: ${outcome.reason}`)
      return outcome
    } catch (err) {
      // Stop retrying what cannot succeed; let BullMQ back off on the rest.
      if (err instanceof PermanentLinkError) throw new UnrecoverableError(err.message)
      throw err
    }
  },
  { connection: redis, concurrency: 2 },
)
