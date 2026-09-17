// Start all BullMQ workers — imported from index.ts so they run with the API process
export { parseWorker } from './parse.worker.js'
export { agentWorker } from './agent.worker.js'
export { notificationWorker } from './notification.worker.js'
// P8 Step 6 — daily obligation + renewal scans
export { scanWorker } from './scan.worker.js'
// P10A — webhook delivery
export { webhookWorker } from './webhook.worker.js'
// Retryable sealing of executed contracts into their signed PDF
export { signingWorker } from './signing.worker.js'

// ─── Stuck-contract recovery ─────────────────────────────────────────────────
// Contracts stuck in an in-progress status (e.g. agents service restarted
// mid-flight) are reset to FAILED so users can retry.

import { prisma } from '../lib/prisma.js'

const IN_PROGRESS_STATUSES = ['PARSING', 'SPLITTING', 'CLASSIFYING', 'EXTRACTING', 'INDEXING', 'ANALYZING']
const STUCK_THRESHOLD_MS = 5 * 60 * 1000 // 5 minutes

async function recoverStuckContracts(): Promise<void> {
  const cutoff = new Date(Date.now() - STUCK_THRESHOLD_MS)
  const result = await prisma.contract.updateMany({
    where: {
      analysisStatus: { in: IN_PROGRESS_STATUSES },
      updatedAt: { lt: cutoff },
    },
    data: { analysisStatus: 'FAILED', analysisError: 'Processing timed out — the job may have crashed mid-flight. Click Re-analyze to retry.' },
  })
  if (result.count > 0) {
    console.warn(`[recovery] reset ${result.count} stuck contract(s) to FAILED`)
  }
}

// Run once on startup to catch any from a previous crash, then every 5 min
recoverStuckContracts().catch(err => console.error('[recovery] startup scan failed:', err))
setInterval(() => recoverStuckContracts().catch(err => console.error('[recovery] scan failed:', err)), STUCK_THRESHOLD_MS)
