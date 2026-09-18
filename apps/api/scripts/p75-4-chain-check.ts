/**
 * P7.5.4 chain self-test (run via tsx).
 *
 * Writes 3 audit events, verifies the chain, tampers with one, then
 * re-verifies. Logs progress as KEY=value lines that the parent
 * verify script greps for.
 */
import { prisma } from '../src/lib/prisma.js'
import { createAuditEvent, verifyAuditChain } from '../src/lib/audit.js'
import { AuditAction } from '@clm/types'

const org = await prisma.organization.findFirst()
if (!org) {
  console.error('NO_ORG')
  process.exit(1)
}

for (let i = 0; i < 3; i++) {
  await createAuditEvent({
    orgId: org.id,
    userId: undefined,
    action: AuditAction.AGENT_ACTION,
    resourceType: 'verify',
    resourceId: `p75-4-${Date.now()}-${i}`,
    metadata: { iter: i, source: 'p75-4-verify' },
  })
}

const ours = await prisma.auditEvent.findMany({
  where: { orgId: org.id, resourceType: 'verify' },
  orderBy: { createdAt: 'desc' },
  take: 3,
})

console.log('WROTE', ours.length)
console.log('HAS_HASHES', ours.every((e: { hash: string | null }) => !!e.hash))
console.log(
  'CHAIN_LINKS',
  ours[0].prevHash === ours[1].hash && ours[1].prevHash === ours[2].hash,
)

const r1 = await verifyAuditChain(org.id)
console.log('VERIFY_OK', r1.ok)

// Tamper with the middle one
const originalMeta = ours[1].metadata
await prisma.auditEvent.update({
  where: { id: ours[1].id },
  data: { metadata: { tampered: true } },
})

const r2 = await verifyAuditChain(org.id)
console.log('AFTER_TAMPER_OK', r2.ok)
console.log('AFTER_TAMPER_BREAK_REASON', r2.firstBreak ? r2.firstBreak.reason : 'none')

// Restore so we don't leave the chain broken
await prisma.auditEvent.update({
  where: { id: ours[1].id },
  data: { metadata: originalMeta as object },
})

await prisma.$disconnect()
