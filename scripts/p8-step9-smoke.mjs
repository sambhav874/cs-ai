#!/usr/bin/env node
/**
 * p8-step9-smoke.mjs — verify invoice creation + auto-match + reconcile flow.
 *
 *   1. Login admin
 *   2. Find a contract with an OPEN payment obligation, note vendor + amount
 *   3. POST /invoices with that vendor name and amount in the obligation window
 *   4. Verify auto-match found the obligation
 *   5. POST /:id/reconcile — verify obligation closes too
 *   6. Verify a non-matching invoice (random vendor, far date) lands in PENDING
 *   7. Verify /stats counts shifted
 */
const API = 'http://localhost:3001'
let pass = 0, fail = 0
const record = (msg, ok, detail = '') => {
  if (ok) { pass++; console.log(`  ✓ ${msg}`) }
  else    { fail++; console.log(`  ✗ ${msg}${detail ? ' · ' + detail : ''}`) }
}

console.log('▶ 1. Login admin')
const tok = await (await fetch(`${API}/api/v1/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'admin@demo.com', password: 'password123' }),
})).json()
const accessToken = tok.accessToken

console.log('\n▶ 2. Find an OPEN payment obligation')
const obs = await (await fetch(`${API}/api/v1/obligations?bucket=open&type=payment&limit=10`, {
  headers: { Authorization: `Bearer ${accessToken}` },
})).json()
let target = obs.data?.find(o => o.type === 'payment' && o.contract?.counterpartyName)
record(`found OPEN payment obligation`, !!target,
  target ? `${target.id.slice(-8)} · ${target.contract.counterpartyName} · ${target.dueDate?.slice(0, 10)}` : 'none')
if (!target) process.exit(1)

console.log('\n▶ 3. Create matching invoice')
const invoiceDate = target.dueDate ?? new Date().toISOString()
const create = await fetch(`${API}/api/v1/invoices`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
  body: JSON.stringify({
    vendorName:    target.contract.counterpartyName,
    invoiceNumber: `INV-SMOKE-${Date.now()}`,
    amount:        12500.00,
    currency:      'USD',
    invoiceDate,
    description:   `Payment per ${target.description.slice(0, 80)}`,
  }),
})
const createBody = await create.json()
record(`POST /invoices returns 201 (got ${create.status})`, create.status === 201)
const invoice = createBody.invoice
record(`invoice status = MATCHED`, invoice?.status === 'MATCHED', `status=${invoice?.status}`)
record(`matchedObligationId equals our target`,
  invoice?.matchedObligationId === target.id,
  `matchedObligationId=${invoice?.matchedObligationId}`)
record(`matchScore >= 0.4`, (invoice?.matchScore ?? 0) >= 0.4, `score=${invoice?.matchScore}`)
record(`match reason includes "counterparty"`,
  /counterparty/i.test(createBody.matchReason ?? ''),
  `reason=${createBody.matchReason}`)

console.log('\n▶ 4. POST /invoices/:id/reconcile — should close the obligation too')
const reconcileRes = await fetch(`${API}/api/v1/invoices/${invoice.id}/reconcile`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
  body: JSON.stringify({ notes: 'Smoke test reconcile' }),
})
record(`reconcile returns 200 (got ${reconcileRes.status})`, reconcileRes.status === 200)

const afterInv = await (await fetch(`${API}/api/v1/invoices/${invoice.id}`, {
  headers: { Authorization: `Bearer ${accessToken}` },
})).json()
record(`invoice now RECONCILED`, afterInv.status === 'RECONCILED')
record(`reconciledAt set`, !!afterInv.reconciledAt)

const afterOb = await (await fetch(`${API}/api/v1/obligations/${target.id}`, {
  headers: { Authorization: `Bearer ${accessToken}` },
})).json()
record(`obligation auto-closed via reconcile`, afterOb.status === 'COMPLETED',
  `status=${afterOb.status}`)
record(`obligation completionNote references invoice`,
  /invoice/i.test(afterOb.completionNote ?? ''),
  `note=${afterOb.completionNote}`)

console.log('\n▶ 5. Create a NON-matching invoice (random vendor, weird date)')
const badInv = await fetch(`${API}/api/v1/invoices`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
  body: JSON.stringify({
    vendorName:    'Acme Random Co. (no match expected)',
    amount:        99.99,
    currency:      'USD',
    invoiceDate:   '2030-01-15',
    description:   'one-off random expense',
  }),
})
const bad = (await badInv.json()).invoice
record(`non-matching invoice → status = PENDING`, bad?.status === 'PENDING',
  `status=${bad?.status}, score=${bad?.matchScore}`)
record(`non-matching invoice has no matchedObligationId`,
  bad?.matchedObligationId == null)

console.log('\n▶ 6. POST /:id/rematch on the bad invoice')
const rematch = await fetch(`${API}/api/v1/invoices/${bad.id}/rematch`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${accessToken}` },
})
record(`rematch returns 200`, rematch.status === 200)

console.log('\n▶ 7. Stats')
const stats = await (await fetch(`${API}/api/v1/invoices/stats`, {
  headers: { Authorization: `Bearer ${accessToken}` },
})).json()
console.log(`  · pending=${stats.pending}, matched=${stats.matched}, reconciled=${stats.reconciled}, disputed=${stats.disputed}, openTotal=$${stats.openTotal}`)
record(`stats.reconciled >= 1`, (stats.reconciled ?? 0) >= 1)
record(`stats.pending >= 1`,    (stats.pending ?? 0) >= 1)

console.log(`\nP8 step 9: ${pass}/${pass + fail} passed`)
if (fail > 0) process.exit(1)
