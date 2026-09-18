/**
 * D.0.1 smoke — verify each new table is present + insertable + queryable.
 */
import { PrismaClient } from '@prisma/client'

async function main() {
  const p = new PrismaClient()
  const org = await p.organization.findFirst({ where: { slug: 'demo-corp' } })
  const user = await p.user.findFirst({ where: { email: 'admin@demo.com' } })
  if (!org || !user) {
    console.error('seed missing — run db:seed first')
    process.exit(1)
  }

  // 1. AgentThread + AgentMessage + ToolCall
  const thread = await p.agentThread.create({
    data: {
      orgId: org.id,
      userId: user.id,
      title: '[d01-smoke] hello',
    },
  })
  const message = await p.agentMessage.create({
    data: {
      threadId: thread.id,
      role: 'user',
      content: [{ type: 'text', text: 'hello' }],
    },
  })
  const toolCall = await p.toolCall.create({
    data: {
      threadId: thread.id,
      messageId: message.id,
      toolName: 'contract_search',
      input: { query: 'test' },
      dryRun: true,
      status: 'success',
      output: { count: 0 },
    },
  })
  console.log('  ✓ AgentThread + AgentMessage + ToolCall round-trip')

  // 2. Skill + SkillInvocation
  const skill = await p.skill.create({
    data: {
      orgId: org.id,
      name: '[d01-smoke] Test',
      slug: '@d01-smoke',
      description: 'smoke test',
      ownerType: 'org',
      contextScope: 'any',
      systemPrompt: 'You are a helpful assistant',
      allowedTools: ['contract_search'],
      modelTier: 'default',
      triggerTypes: ['mention'],
    },
  })
  await p.skillInvocation.create({
    data: {
      skillId: skill.id,
      skillVersion: skill.version,
      threadId: thread.id,
      userId: user.id,
      orgId: org.id,
      inputMessage: 'try this',
    },
  })
  console.log('  ✓ Skill + SkillInvocation round-trip')

  // 3. OrgAiKey
  await p.orgAiKey.upsert({
    where: { orgId_provider: { orgId: org.id, provider: 'openai' } },
    create: {
      orgId: org.id,
      provider: 'openai',
      encryptedKey: 'test-ciphertext',
      keyPrefix: 'sk-proj-',
      createdById: user.id,
    },
    update: {},
  })
  console.log('  ✓ OrgAiKey upsert')

  // 4. OrgAiSettings
  await p.orgAiSettings.upsert({
    where: { orgId: org.id },
    create: {
      orgId: org.id,
      defaultModel: 'openai/gpt-4.1',
      dailyCostCapUsd: 50,
    },
    update: {},
  })
  console.log('  ✓ OrgAiSettings upsert')

  // 5. OrgUsageDaily — upsert pattern
  const today = new Date().toISOString().slice(0, 10)
  await p.orgUsageDaily.upsert({
    where: {
      orgId_date_provider_model_tier_toolName_isByok: {
        orgId: org.id,
        date: today,
        provider: 'openai',
        model: 'gpt-4.1',
        tier: 'default',
        toolName: 'contract_search',
        isByok: false,
      },
    },
    create: {
      orgId: org.id,
      date: today,
      provider: 'openai',
      model: 'gpt-4.1',
      tier: 'default',
      toolName: 'contract_search',
      inputTokens: 100,
      outputTokens: 200,
      costUsd: 0.001,
      callCount: 1,
      isByok: false,
    },
    update: {
      callCount: { increment: 1 },
      inputTokens: { increment: 100 },
      outputTokens: { increment: 200 },
      costUsd: { increment: 0.001 },
    },
  })
  console.log('  ✓ OrgUsageDaily upsert (atomic increment)')

  // 6. Cleanup
  await p.toolCall.delete({ where: { id: toolCall.id } })
  await p.agentMessage.delete({ where: { id: message.id } })
  await p.skillInvocation.deleteMany({ where: { skillId: skill.id } })
  await p.skill.delete({ where: { id: skill.id } })
  await p.agentThread.delete({ where: { id: thread.id } })
  console.log('  ✓ cleanup')

  await p.$disconnect()
  console.log('\n✓ All D.0.1 tables verified')
}
main().catch((e) => { console.error(e); process.exit(1) })
