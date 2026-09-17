import { PrismaClient } from '@prisma/client'
async function main() {
  const p = new PrismaClient()
  const user = await p.user.findFirst({ where: { email: 'admin@demo.com' } })
  if (!user) return
  // Only create demo data if there are no requests yet
  const existing = await p.contractRequest.count({ where: { orgId: user.orgId, deletedAt: null } })
  if (existing > 0) { console.log(`Already have ${existing} request(s). Skipping.`); return }
  await p.contractRequest.create({
    data: {
      orgId: user.orgId,
      requestedById: user.id,
      title: 'NDA for Acme Corp — ML pilot',
      type: 'NDA',
      description: 'Need a mutual NDA for exploratory ML pilot with Acme. Standard 3-year term.',
      status: 'SUBMITTED',
      priority: 'MEDIUM',
      counterpartyName: 'Acme Corporation',
    },
  })
  await p.contractRequest.create({
    data: {
      orgId: user.orgId,
      requestedById: user.id,
      title: 'MSA for Massive Dynamic — annual renewal',
      type: 'MSA',
      description: 'Renewal of our existing MSA with Massive Dynamic. Wants to increase scope.',
      status: 'IN_REVIEW',
      priority: 'HIGH',
      counterpartyName: 'Massive Dynamic',
    },
  })
  await p.contractRequest.create({
    data: {
      orgId: user.orgId,
      requestedById: user.id,
      title: 'SOW for Pied Piper — Q2 engagement',
      type: 'SOW',
      description: 'Statement of work for Pied Piper Q2 engagement.',
      status: 'MORE_INFO_NEEDED',
      priority: 'URGENT',
      counterpartyName: 'Pied Piper Inc.',
    },
  })
  console.log('Created 3 demo requests.')
  await p.$disconnect()
}
main()
