/**
 * Dump status of a single ApprovalInstance by id. Used by scripts/d56-
 * verify.mjs (top-level await limits in `tsx -e`).
 */
import { PrismaClient } from '@prisma/client'

const id = process.argv[2]
if (!id) { console.error('usage: _approval-instance-status.ts <id>'); process.exit(1) }

const p = new PrismaClient()
const inst = await p.approvalInstance.findUnique({
  where: { id },
  select: { id: true, status: true, decidedAt: true },
})
console.log(JSON.stringify(inst))
await p.$disconnect()
