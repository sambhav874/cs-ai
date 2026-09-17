/**
 * Wipe demo data (R.1 of the audit plan)
 *
 * Deletes every transactional row in the org while preserving:
 *   • the Organization
 *   • the admin@demo.com user
 *   • their UserRole mapping
 *   • Role catalog
 *   • OrgAiKey / OrgAiSettings / OrgUsageDaily
 *
 * Order respects foreign-key constraints — children before parents,
 * and self-refs (Contract.parentContractId, Contract.currentVersionId)
 * NULLed out before delete so DELETE cascades aren't needed.
 *
 * Idempotent: running on an already-empty DB is a no-op.
 *
 * Run:  pnpm --filter api tsx scripts/wipe-demo-data.ts
 */
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  const admin = await prisma.user.findFirst({
    where: { email: 'admin@demo.com' },
    select: { id: true, orgId: true },
  })
  if (!admin) {
    console.error('admin@demo.com not found — abort.')
    process.exit(1)
  }
  const { orgId, id: adminId } = admin
  console.log(`[wipe] target org=${orgId}, preserving admin=${adminId}`)

  // The deletion sequence. Each call is per-table because Prisma's
  // deleteMany respects only the table-level FKs, not transitive ones.
  const steps: Array<[string, () => Promise<{ count: number }>]> = [
    // ── Agent stack ───────────────────────────────────────────────────
    // SkillInvocation refs Skill, User, Org. Delete first.
    ['skillInvocation', () => prisma.skillInvocation.deleteMany({ where: { orgId } })],
    // AgentThread cascades to AgentMessage + ToolCall.
    ['agentThread',     () => prisma.agentThread.deleteMany({ where: { orgId } })],
    // Skill: org-owned only. System skills (orgId=null) survive.
    ['skill (org)',     () => prisma.skill.deleteMany({ where: { orgId } })],

    // ── Notifications ─────────────────────────────────────────────────
    ['notification',    () => prisma.notification.deleteMany({ where: { orgId } })],

    // ── Approvals ─────────────────────────────────────────────────────
    ['approvalStep',     () => prisma.approvalStep.deleteMany({ where: { orgId } })],
    ['approvalInstance', () => prisma.approvalInstance.deleteMany({ where: { orgId } })],

    // ── Contract dependents ───────────────────────────────────────────
    ['contractComment',   () => prisma.contractComment.deleteMany({ where: { orgId } })],
    ['contractShareLink', () => prisma.contractShareLink.deleteMany({ where: { orgId } })],
    ['versionDiffCache',  () => prisma.versionDiffCache.deleteMany({ where: { orgId } })],
  ]

  for (const [name, fn] of steps) {
    try {
      const r = await fn()
      console.log(`  ✓ ${name.padEnd(20)} deleted ${r.count}`)
    } catch (err) {
      console.error(`  ✗ ${name}: ${(err as Error).message.slice(0, 200)}`)
    }
  }

  // ── Contracts: clear self-refs, then delete clauses → versions → contracts
  console.log('  · clearing contract self-refs (currentVersionId, parentContractId)…')
  try {
    await prisma.$executeRaw`UPDATE contracts SET "currentVersionId" = NULL, "parentContractId" = NULL WHERE "orgId" = ${orgId}`
  } catch (err) {
    console.error(`  ✗ self-ref nullify: ${(err as Error).message.slice(0, 200)}`)
  }

  const post: Array<[string, () => Promise<{ count: number }>]> = [
    ['contractClause',  async () => prisma.contractClause.deleteMany({
      where: { version: { contract: { orgId } } } as never,
    })],
    ['contractVersion', async () => prisma.contractVersion.deleteMany({
      where: { contract: { orgId } } as never,
    })],
    ['contractRequest', () => prisma.contractRequest.deleteMany({ where: { orgId } })],
    ['contract',        () => prisma.contract.deleteMany({ where: { orgId } })],

    // ── Top-level dependents of org but no children ───────────────────
    ['matter',                   () => prisma.matter.deleteMany({ where: { orgId } })],
    ['counterparty',             () => prisma.counterparty.deleteMany({ where: { orgId } })],
    ['contractFieldDefinition',  () => prisma.contractFieldDefinition.deleteMany({ where: { orgId } })],

    // Workflow + AuditEvent + library
    ['workflowDefinition', () => prisma.workflowDefinition.deleteMany({ where: { orgId } })],
    ['auditEvent',         () => prisma.auditEvent.deleteMany({ where: { orgId } })],

    // Template (cascades TemplateSection)
    ['template',            () => prisma.template.deleteMany({ where: { orgId } })],
    ['clauseLibraryItem',   () => prisma.clauseLibraryItem.deleteMany({ where: { orgId } })],
    ['playbookPosition',    () => prisma.playbookPosition.deleteMany({ where: { orgId } })],
    ['clauseCategory',      () => prisma.clauseCategory.deleteMany({ where: { orgId } })],
  ]

  for (const [name, fn] of post) {
    try {
      const r = await fn()
      console.log(`  ✓ ${name.padEnd(25)} deleted ${r.count}`)
    } catch (err) {
      console.error(`  ✗ ${name}: ${(err as Error).message.slice(0, 200)}`)
    }
  }

  // ── Other org users — keep admin only.
  // Drop UserRole rows + Users that are NOT the admin.
  try {
    const otherUsers = await prisma.user.findMany({
      where: { orgId, NOT: { id: adminId } },
      select: { id: true, email: true },
    })
    console.log(`  · removing ${otherUsers.length} other user(s) from org…`)
    if (otherUsers.length > 0) {
      const otherIds = otherUsers.map(u => u.id)
      await prisma.userRole.deleteMany({ where: { userId: { in: otherIds } } })
      await prisma.user.deleteMany({ where: { id: { in: otherIds } } })
    }
  } catch (err) {
    console.error(`  ✗ other users: ${(err as Error).message.slice(0, 200)}`)
  }

  // Sanity report
  const stats = await prisma.organization.findUnique({
    where: { id: orgId },
    select: {
      _count: {
        select: {
          contracts: true, requests: true, counterparties: true,
          matters: true, notifications: true, agentThreads: true,
        },
      },
    },
  })
  console.log('\n[wipe] post-wipe counts:')
  console.log(JSON.stringify(stats?._count ?? {}, null, 2))

  await prisma.$disconnect()
}

main().catch(async (e) => {
  console.error(e)
  await prisma.$disconnect()
  process.exit(1)
})
