/**
 * Verify P8 Step 6 — daily scan worker.
 *
 *   1. Confirm repeatable jobs are registered in Redis (obligation + renewal)
 *   2. Manually queue an obligation-scan-daily job
 *   3. Wait for worker to process; confirm via job state
 */
import { scanQueue } from '../src/lib/queue.js'

let pass = 0, fail = 0
const r = (msg: string, ok: boolean, detail = '') => {
  if (ok) { pass++; console.log(`  ✓ ${msg}`) }
  else    { fail++; console.log(`  ✗ ${msg}${detail ? ' · ' + detail : ''}`) }
}

console.log('▶ 1. Inspect repeatable jobs in scans queue')
const repeatables = await scanQueue.getRepeatableJobs()
console.log(`  · ${repeatables.length} repeatable jobs registered`)
for (const rj of repeatables) {
  const next = rj.next ? new Date(rj.next).toISOString() : 'never'
  console.log(`    · ${rj.name} · pattern="${rj.pattern}" · next=${next}`)
}
const obligationRJ = repeatables.find(rj => rj.name === 'obligation-scan-daily')
const renewalRJ    = repeatables.find(rj => rj.name === 'renewal-scan-daily')
r(`obligation-scan-daily registered`, !!obligationRJ, obligationRJ?.pattern)
r(`renewal-scan-daily registered`,    !!renewalRJ,    renewalRJ?.pattern)
r(`obligation pattern is "0 9 * * *"`,  obligationRJ?.pattern === '0 9 * * *')
r(`renewal pattern is "15 9 * * *"`,    renewalRJ?.pattern    === '15 9 * * *')

console.log('\n▶ 2. Manually trigger an obligation-scan-daily job')
const job = await scanQueue.add('obligation-scan-daily', {}, { jobId: `manual-test-${Date.now()}` })
console.log(`  · queued job ${job.id}`)

console.log('\n▶ 3. Poll for completion (5s window)')
let completedJob: typeof job | undefined
for (let i = 0; i < 25; i++) {
  await new Promise(r => setTimeout(r, 200))
  const fresh = await scanQueue.getJob(job.id!)
  if (fresh && (await fresh.getState()) === 'completed') {
    completedJob = fresh
    break
  }
}
if (completedJob) {
  const result = completedJob.returnvalue as Record<string, unknown> | null
  r(`manual obligation-scan completed`, true, `returnvalue keys: ${Object.keys(result ?? {}).join(',')}`)
  console.log(`  · result: ${JSON.stringify(result)}`)
} else {
  const fresh = await scanQueue.getJob(job.id!)
  const state = fresh ? await fresh.getState() : 'gone'
  r(`manual obligation-scan completed`, false, `state=${state}`)
}

console.log(`\nP8 step 6: ${pass}/${pass + fail} passed`)
process.exit(fail > 0 ? 1 : 0)
