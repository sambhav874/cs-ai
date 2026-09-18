/**
 * D.0.6 smoke — exercise every admin-ai mutation and verify an AuditEvent
 * row is written for each, with:
 *   • correct actor + resourceType + resourceId
 *   • a meaningful before/after diff in metadata (for settings)
 *   • NEVER the plaintext key anywhere in the audit trail
 *   • GET /admin/ai/audit returns them in reverse-chronological order
 */
import { PrismaClient } from '@prisma/client'
import { buildApp } from '../src/app.js'
import { signAccessToken } from '../src/lib/jwt.js'
import { redis } from '../src/lib/redis.js'

const p = new PrismaClient()
let fail = 0
function check(cond: boolean, msg: string) {
  if (cond) console.log(`  ✓ ${msg}`)
  else { console.log(`  ✗ ${msg}`); fail++ }
}

async function main() {
  const user = await p.user.findFirst({
    where: { email: 'admin@demo.com' },
    include: { userRoles: { include: { role: true } } },
  })
  if (!user) throw new Error('seed missing: expected admin@demo.com')
  const orgId = user.orgId
  const userId = user.id
  const roles = user.userRoles.map(ur => ur.role.name)

  // Pre-clean so re-runs start from a known state.
  await p.auditEvent.deleteMany({ where: { orgId, resourceType: { in: ['ai_settings', 'ai_key'] } } })
  await p.orgAiKey.deleteMany({ where: { orgId } })
  await p.orgAiSettings.deleteMany({ where: { orgId } })

  const app = await buildApp()
  const token = signAccessToken({ sub: userId, orgId, roles })
  const auth = { authorization: `Bearer ${token}`, 'user-agent': 'smoke-d06/1.0' }

  try {
    // ── A. PUT /settings creates an AI_SETTINGS_UPDATED row with diff ────────
    const putSettings = await app.inject({
      method: 'PUT',
      url: '/api/v1/admin/ai/settings',
      headers: { ...auth, 'content-type': 'application/json' },
      payload: { dailyCostCapUsd: 123.45, capPolicy: 'warn' },
    })
    check(putSettings.statusCode === 200, `(A) PUT /settings returns 200 (got ${putSettings.statusCode})`)

    const settingsEvents = await p.auditEvent.findMany({
      where: { orgId, action: 'AI_SETTINGS_UPDATED' },
      orderBy: { createdAt: 'desc' },
    })
    check(settingsEvents.length === 1, `(A) exactly one AI_SETTINGS_UPDATED row (got ${settingsEvents.length})`)
    const settingsMeta = settingsEvents[0]?.metadata as { changed?: Record<string, { from: unknown; to: unknown }> } | null
    check(
      !!settingsMeta?.changed?.dailyCostCapUsd && settingsMeta.changed.dailyCostCapUsd.to === 123.45,
      `(A) diff metadata captures dailyCostCapUsd.to = 123.45`,
    )
    check(
      !!settingsMeta?.changed?.capPolicy && settingsMeta.changed.capPolicy.to === 'warn',
      `(A) diff metadata captures capPolicy.to = 'warn'`,
    )
    check(settingsEvents[0]?.userId === userId, `(A) actor matches caller userId`)
    check(settingsEvents[0]?.userAgent === 'smoke-d06/1.0', `(A) userAgent is stamped onto the row`)

    // ── B. No-op PUT does NOT log a redundant event ──────────────────────────
    const putSettingsNoop = await app.inject({
      method: 'PUT',
      url: '/api/v1/admin/ai/settings',
      headers: { ...auth, 'content-type': 'application/json' },
      payload: { dailyCostCapUsd: 123.45, capPolicy: 'warn' },
    })
    check(putSettingsNoop.statusCode === 200, `(B) no-op PUT /settings returns 200`)
    const settingsEventsAfterNoop = await p.auditEvent.count({
      where: { orgId, action: 'AI_SETTINGS_UPDATED' },
    })
    check(settingsEventsAfterNoop === 1, `(B) no-op PUT does NOT create a second audit row (count=${settingsEventsAfterNoop})`)

    // ── C. PUT /keys creates AI_KEY_CREATED, never leaks plaintext ───────────
    // Use distinguishable first-8-char prefixes so the rotation diff in (D)
    // actually shows a change. keyPrefix() truncates to 8 chars.
    const plaintextKey = 'sk-aaaa-smoke-d06-original-abcdefghij'
    const putKey = await app.inject({
      method: 'PUT',
      url: '/api/v1/admin/ai/keys/openai',
      headers: { ...auth, 'content-type': 'application/json' },
      payload: { apiKey: plaintextKey },
    })
    check(putKey.statusCode === 200, `(C) PUT /keys/openai returns 200 (got ${putKey.statusCode})`)

    const keyCreatedEvents = await p.auditEvent.findMany({
      where: { orgId, action: 'AI_KEY_CREATED', resourceId: 'openai' },
    })
    check(keyCreatedEvents.length === 1, `(C) exactly one AI_KEY_CREATED row for openai`)
    const keyCreatedMeta = keyCreatedEvents[0]?.metadata as { provider?: string; keyPrefix?: string }
    check(keyCreatedMeta?.provider === 'openai', `(C) metadata.provider = 'openai'`)
    check(
      typeof keyCreatedMeta?.keyPrefix === 'string' && keyCreatedMeta.keyPrefix.length > 0,
      `(C) metadata.keyPrefix is a non-empty string (got '${keyCreatedMeta?.keyPrefix}')`,
    )
    const metaJson = JSON.stringify(keyCreatedMeta)
    check(!metaJson.includes(plaintextKey), `(C) plaintext key is NOT in metadata`)

    // ── D. PUT /keys with prior row logs AI_KEY_UPDATED (rotation) ───────────
    const rotatedKey = 'sk-bbbb-smoke-d06-rotated-zzzzzzzz'
    const putKey2 = await app.inject({
      method: 'PUT',
      url: '/api/v1/admin/ai/keys/openai',
      headers: { ...auth, 'content-type': 'application/json' },
      payload: { apiKey: rotatedKey },
    })
    check(putKey2.statusCode === 200, `(D) rotation PUT returns 200`)
    const keyUpdatedEvents = await p.auditEvent.findMany({
      where: { orgId, action: 'AI_KEY_UPDATED', resourceId: 'openai' },
    })
    check(keyUpdatedEvents.length === 1, `(D) exactly one AI_KEY_UPDATED row`)
    const rotMeta = keyUpdatedEvents[0]?.metadata as { keyPrefix?: { from: string; to: string } }
    check(
      !!rotMeta?.keyPrefix?.from && !!rotMeta?.keyPrefix?.to && rotMeta.keyPrefix.from !== rotMeta.keyPrefix.to,
      `(D) metadata carries { from, to } prefix diff`,
    )
    check(
      !JSON.stringify(rotMeta).includes(rotatedKey) && !JSON.stringify(rotMeta).includes(plaintextKey),
      `(D) neither old nor new plaintext appears in rotation metadata`,
    )

    // ── E. DELETE /keys logs AI_KEY_DELETED with the prefix that went away ───
    const delKey = await app.inject({
      method: 'DELETE',
      url: '/api/v1/admin/ai/keys/openai',
      headers: { ...auth },
    })
    check(delKey.statusCode === 200, `(E) DELETE /keys/openai returns 200`)
    const delEvents = await p.auditEvent.findMany({
      where: { orgId, action: 'AI_KEY_DELETED', resourceId: 'openai' },
    })
    check(delEvents.length === 1, `(E) exactly one AI_KEY_DELETED row`)
    const delMeta = delEvents[0]?.metadata as { keyPrefix?: string }
    check(typeof delMeta?.keyPrefix === 'string', `(E) deleted key's prefix is preserved in metadata`)

    // Second DELETE on missing key should be 200 but NOT create a row.
    const delKey2 = await app.inject({
      method: 'DELETE',
      url: '/api/v1/admin/ai/keys/openai',
      headers: { ...auth },
    })
    check(delKey2.statusCode === 200, `(E) second DELETE (no-op) still returns 200`)
    const delCount = await p.auditEvent.count({
      where: { orgId, action: 'AI_KEY_DELETED', resourceId: 'openai' },
    })
    check(delCount === 1, `(E) second DELETE does NOT create a duplicate row (count=${delCount})`)

    // ── F. GET /audit returns all four events, newest first ──────────────────
    const getAudit = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/ai/audit',
      headers: { ...auth },
    })
    check(getAudit.statusCode === 200, `(F) GET /audit returns 200`)
    const auditBody = getAudit.json() as { events: Array<{ action: string; actor: { email: string } | null }> }
    check(auditBody.events.length === 4, `(F) GET /audit returns 4 events (got ${auditBody.events.length})`)
    check(
      auditBody.events[0]?.action === 'AI_KEY_DELETED' &&
      auditBody.events[auditBody.events.length - 1]?.action === 'AI_SETTINGS_UPDATED',
      `(F) events are ordered newest-first (DELETE at head, SETTINGS_UPDATED at tail)`,
    )
    check(
      auditBody.events.every(e => e.actor?.email === 'admin@demo.com'),
      `(F) every row is denormalized with actor.email for the UI`,
    )

    // ── G. action= filter narrows results ────────────────────────────────────
    const filteredAudit = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/ai/audit?action=AI_KEY_CREATED,AI_KEY_UPDATED',
      headers: { ...auth },
    })
    const filtered = filteredAudit.json() as { events: Array<{ action: string }> }
    check(
      filtered.events.length === 2 &&
      filtered.events.every(e => e.action === 'AI_KEY_CREATED' || e.action === 'AI_KEY_UPDATED'),
      `(G) action= filter returns exactly the requested actions (got ${filtered.events.map(e => e.action).join(',')})`,
    )

    // ── H. Unknown action= name returns empty, not an error ──────────────────
    const emptyFilter = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/ai/audit?action=NOT_AN_AI_ACTION',
      headers: { ...auth },
    })
    const emptyBody = emptyFilter.json() as { events: unknown[] }
    check(emptyFilter.statusCode === 200 && emptyBody.events.length === 0, `(H) unknown action filter returns 200 + empty events`)
  } finally {
    // Cleanup: leave the DB exactly as we found it.
    await p.auditEvent.deleteMany({ where: { orgId, resourceType: { in: ['ai_settings', 'ai_key'] } } })
    await p.orgAiKey.deleteMany({ where: { orgId } })
    await p.orgAiSettings.deleteMany({ where: { orgId } })
    await app.close()
  }

  console.log()
  if (fail) {
    console.log(`✗ ${fail} check(s) failed`)
    await p.$disconnect()
    await redis.quit()
    process.exit(1)
  }
  console.log('✓ All D.0.6 audit-log checks pass')
  await p.$disconnect()
  await redis.quit()
}

main().catch(async (e) => {
  console.error(e)
  await p.$disconnect()
  await redis.quit()
  process.exit(1)
})
