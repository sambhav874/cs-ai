
    import { prisma } from '../src/lib/prisma.js'
    const evs = await prisma.auditEvent.findMany({
      where: { resourceType: 'contract', resourceId: 'cmodtj9gz000svopsfu00q258', action: 'PORTAL_UPLOADED_VERSION' },
      orderBy: { createdAt: 'desc' },
      take: 1,
    })
    console.log('AUDIT_COUNT', evs.length)
    if (evs[0]) console.log('LATEST_FILENAME', evs[0].metadata.filename)
    await prisma.$disconnect()
  