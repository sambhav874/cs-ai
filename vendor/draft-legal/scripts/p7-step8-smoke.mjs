#!/usr/bin/env node
/**
 * p7-step8-smoke.mjs — verify reminder scheduler.
 *
 *   1. Send for signature (creates request + schedules T-3d/T-1d reminders)
 *   2. POST /signature-requests/:srId/remind — manual nudge
 *   3. Worker fires immediately, re-emails pending signers
 *   4. Check API log for [signing] line + verify REMINDED event written
 */
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const API = 'http://localhost:3001'

let pass = 0, fail = 0
const record = (msg, ok, detail = '') => {
  if (ok) { pass++; console.log(`  ✓ ${msg}`) }
  else    { fail++; console.log(`  ✗ ${msg}${detail ? ' · ' + detail : ''}`) }
}

const tok = await (await fetch(`${API}/api/v1/auth/login`, {
  method: 'POST', headers: {'Content-Type':'application/json'},
  body: JSON.stringify({email:'admin@demo.com', password:'password123'}),
})).json()
const accessToken = tok.accessToken

console.log('▶ 1. Pick eligible contract + send for signature')
const cs = await (await fetch(`${API}/api/v1/contracts?limit=100`, {
  headers: { Authorization: `Bearer ${accessToken}` },
})).json()
const eligible = (cs.data ?? cs.contracts ?? [])
  .filter(c => c.currentVersionId && c.status !== 'EXECUTED' && c.status !== 'PENDING_SIGNATURE' && c.status !== 'EXPIRED')
let target = eligible[0]
if (!target) {
  // Generate a fresh draft via the agent draft endpoint so the test can run repeatedly.
  console.log('  · no eligible contract — drafting a fresh NDA via /agent/draft')
  const draft = await (await fetch(`${API}/api/v1/agent/draft`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({
      userMessage: 'Mutual NDA for Reminder Test Co, 2-year term, California governing law.',
      saveAs: { title: 'Reminder Test Co — NDA' },
    }),
  })).json()
  if (draft.contractId) target = { id: draft.contractId, title: 'Reminder Test Co — NDA' }
}
const contractId = target?.id
console.log(`  · target: ${contractId} (${target?.title})`)

const sendRes = await fetch(`${API}/api/v1/contracts/${contractId}/send-for-signature`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
  body: JSON.stringify({
    signers: [
      { name: 'Reminder Test A', email: 'remind-a@example.com', role: 'CFO', signOrder: 1 },
      { name: 'Reminder Test B', email: 'remind-b@example.com', role: 'CEO', signOrder: 2 },
    ],
    signOrder: 'ANY',
    expiresInDays: 14,
    message: 'Step 8 reminder smoke test',
  }),
})
const sent = await sendRes.json()
record('send-for-signature returned 201', sendRes.status === 201)
const srId = sent.id

console.log('\n▶ 2. POST manual /remind — should re-email pending signers')
const remindRes = await fetch(`${API}/api/v1/contracts/${contractId}/signature-requests/${srId}/remind`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
  body: '{}',
})
const remindBody = await remindRes.json()
record(`remind returns 200 (got ${remindRes.status})`, remindRes.status === 200,
  JSON.stringify(remindBody).slice(0, 120))
record('signersNotified count = 2 (both still pending)',
  remindBody.signersNotified === 2,
  `got ${remindBody.signersNotified}`)

console.log('\n▶ 3. Wait 2s for worker, then check audit timeline for REMINDED event')
await new Promise(r => setTimeout(r, 2500))
const srs = await (await fetch(`${API}/api/v1/contracts/${contractId}/signature-requests`, {
  headers: { Authorization: `Bearer ${accessToken}` },
})).json()
const sr = (srs.data ?? srs ?? []).find(r => r.id === srId)
const events = sr?.events ?? []
const hasReminder = events.some(e => e.kind === 'REMINDED')
record('SignatureEvent kind=REMINDED was written',
  hasReminder,
  `events: ${events.map(e => e.kind).join(',') || 'none'}`)

const reminderEvent = events.find(e => e.kind === 'REMINDED')
record('REMINDED event metadata.kind === "manual"',
  reminderEvent?.metadata?.kind === 'manual',
  `metadata=${JSON.stringify(reminderEvent?.metadata)}`)

console.log('\n▶ 4. Verify console-log captured the re-send (grep /tmp/api.log)')
let logFound = false
try {
  const log = fs.readFileSync('/tmp/api.log', 'utf8').split('\n').slice(-200).join('\n')
  logFound = /\[signing\] ✉  remind-a@example\.com/.test(log) || /\[signing\] ✉  remind-b@example\.com/.test(log)
} catch {}
record('[signing] log line for at least one signer',
  logFound, 'check /tmp/api.log if false')

// Sequential variant: only first-bucket signer should be nudged
console.log('\n▶ 5. SEQUENTIAL flow: remind only nudges signOrder=1 bucket')
const target2 = (cs.data ?? cs.contracts ?? [])
  .filter(c => c.currentVersionId && c.status !== 'EXECUTED' && c.status !== 'PENDING_SIGNATURE')[1]
if (target2) {
  const send2 = await fetch(`${API}/api/v1/contracts/${target2.id}/send-for-signature`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({
      signers: [
        { name: 'Seq A', email: 'seq-a@example.com', role: 'A', signOrder: 1 },
        { name: 'Seq B', email: 'seq-b@example.com', role: 'B', signOrder: 2 },
      ],
      signOrder: 'SEQUENTIAL',
      expiresInDays: 14,
    }),
  })
  const sent2 = await send2.json()
  const remind2 = await fetch(`${API}/api/v1/contracts/${target2.id}/signature-requests/${sent2.id}/remind`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: '{}',
  })
  const r2body = await remind2.json()
  record('SEQUENTIAL remind nudges only first bucket (1 signer)',
    r2body.signersNotified === 1,
    `got ${r2body.signersNotified}`)
}

console.log(`\nP7 step 8: ${pass}/${pass + fail} passed`)
if (fail > 0) process.exit(1)
