/** Dump the last tool_call row of a given toolName. */
import { PrismaClient } from '@prisma/client'
const toolName = process.argv[2]
if (!toolName) { console.error('usage: _last-tool-call.ts <toolName>'); process.exit(1) }
const p = new PrismaClient()
const tc = await p.toolCall.findFirst({
  where: { toolName },
  orderBy: { createdAt: 'desc' },
  select: { id: true, toolName: true, input: true, status: true, error: true, output: true, createdAt: true },
})
console.log(JSON.stringify(tc, null, 2))
await p.$disconnect()
