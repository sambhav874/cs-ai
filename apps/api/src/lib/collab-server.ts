/**
 * collab-server.ts (Phase 10C — real-time collab).
 *
 * Runs a Hocuspocus (Yjs-backed) WebSocket server on a dedicated port
 * (default 3030). Clients connect at ws://localhost:3030 with the
 * document name `contract:<id>` and a JWT token in the connection
 * params for tenant isolation + cursor presence.
 *
 * Wave 2.4 (2026-07): the live Y.Doc is now PERSISTED via the Hocuspocus
 * Database extension into the `collab_states` table — concurrent edits survive
 * a server restart instead of evaporating from memory. The canonical HTML
 * version still saves via the editor's existing /html-version flow; this server
 * carries + durably stores the live collaborative ops.
 *
 * Auto-starts on import via startCollabServer().
 */
import { Server } from '@hocuspocus/server'
import * as Y from 'yjs'
import { verifyToken } from './jwt.js'
import { prisma } from './prisma.js'

const PORT = Number(process.env.COLLAB_PORT ?? 3030)

let server: Server | null = null

export function startCollabServer(): Server {
  if (server) return server
  server = new Server({
    port: PORT,
    name: 'clm-collab',

    // Wave 2.4 — persist the Y.Doc to `collab_states` via v4's document hooks
    // (yjs binary encode/decode). onStoreDocument is debounced by Hocuspocus.
    // (The extension-database package isn't v4-compatible, so we use the hooks
    // directly.)
    async onLoadDocument({ documentName, document }) {
      const row = await prisma.collabState.findUnique({ where: { documentName } })
      if (row?.state) Y.applyUpdate(document, new Uint8Array(row.state))
      return document
    },
    async onStoreDocument({ documentName, document }) {
      const state = Buffer.from(Y.encodeStateAsUpdate(document))
      await prisma.collabState.upsert({
        where: { documentName },
        create: { documentName, state },
        update: { state },
      })
    },

    async onAuthenticate({ token, documentName }) {
      if (!token) throw new Error('Missing token')
      let payload
      try { payload = verifyToken(token) }
      catch { throw new Error('Invalid token') }
      if (payload.type !== 'access') throw new Error('Wrong token type')

      const contractId = documentName.startsWith('contract:')
        ? documentName.slice('contract:'.length)
        : null
      if (!contractId) throw new Error('Bad document name')

      // Tenant check: the contract must live in the user's org.
      const c = await prisma.contract.findFirst({
        where: { id: contractId, orgId: payload.orgId, deletedAt: null },
        select: { id: true },
      })
      if (!c) throw new Error('Contract not found in your org')

      return { user: { id: payload.sub, orgId: payload.orgId } }
    },
  })

  server.listen()
    .then(() => console.info('[collab] Hocuspocus listening on :%d', PORT))
    .catch(err => console.error('[collab] failed to start:', err))

  return server
}
