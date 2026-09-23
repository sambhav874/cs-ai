import { buildApp } from './app.js'
import { startCollabServer } from './lib/collab-server.js'
import { reportSigningCertAtBoot } from './lib/signing-cert.js'
import { isEmailConfigured } from './lib/mailer.js'

const PORT = Number(process.env.PORT ?? 3001)
const HOST = process.env.HOST ?? '0.0.0.0'

// Wave 4 — workers run in-process by default (dev + single-process deploys). In
// prod a dedicated always-on worker service (worker-entrypoint.ts) runs them
// and the scale-to-zero API sets WORKERS_ENABLED=false, so time-based jobs
// (escalation, signature reminders, renewal scans) actually fire and jobs
// aren't double-consumed.
if (process.env.WORKERS_ENABLED !== 'false') {
  await import('./workers/index.js')
}

const app = await buildApp()
reportSigningCertAtBoot()
if (process.env.NODE_ENV === 'production' && !isEmailConfigured()) {
  // Signers get their link by email and obligation reminders go by email.
  // Without a mailer both only exist in-app (senders can still copy a link).
  console.error('[mailer] No SMTP/SendGrid configured: signing links and reminders will NOT be emailed.')
}

// P10C — start the Hocuspocus WebSocket server on its own port (3002 by
// default). Disabled if COLLAB_DISABLED=1 (e.g. for tests).
if (process.env.COLLAB_DISABLED !== '1') {
  startCollabServer()
}

try {
  await app.listen({ port: PORT, host: HOST })
  app.log.info(`API listening on http://${HOST}:${PORT}`)
} catch (err) {
  app.log.error(err)
  process.exit(1)
}
