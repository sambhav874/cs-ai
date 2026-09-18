
    import { prisma } from '../src/lib/prisma.js'
    const evs = await prisma.auditEvent.findMany({
      where: { resourceType: 'contract', resourceId: 'cmodtj9gz000svopsfu00q258', action: 'EMAIL_REDLINE_RECEIVED' },
      orderBy: { createdAt: 'desc' },
      take: 1,
    })
    console.log('AUDIT_COUNT', evs.length)
    if (evs[0]) console.log('AUDIT_FILENAME', evs[0].metadata.filename)
    if (evs[0]) console.log('AUDIT_SENDER', evs[0].metadata.sender)
    await prisma.$disconnect()
  