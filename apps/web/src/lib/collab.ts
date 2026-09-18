/**
 * collab.ts (P10C client) — useCollabProvider hook.
 *
 * Returns a Yjs document + Hocuspocus WebSocket provider scoped to a
 * specific contract. The provider streams ops to the server at
 * ws://localhost:3030 (or COLLAB_URL); auth is the user's JWT, sent
 * as the Hocuspocus token param.
 *
 * Usage in DocumentCanvas (or a future CollaborativeEditor):
 *
 *   const { ydoc, provider } = useCollabProvider(contractId)
 *   useEditor({ extensions: [
 *     ...,
 *     Collaboration.configure({ document: ydoc }),
 *     CollaborationCaret.configure({ provider, user: { name, color } }),
 *   ]})
 *
 * The provider auto-reconnects on disconnect. Component unmount tears
 * it down; reusing a provider across mount cycles requires lifting it
 * into a context above the editor.
 */
import { useEffect, useState } from 'react'
import * as Y from 'yjs'
import { HocuspocusProvider } from '@hocuspocus/provider'

const COLLAB_URL = ((import.meta as unknown as { env?: Record<string, string> }).env?.VITE_COLLAB_URL) ?? 'ws://localhost:3030'

export interface CollabContext {
  ydoc:     Y.Doc
  provider: HocuspocusProvider
  status:   'connecting' | 'connected' | 'disconnected'
}

export function useCollabProvider(contractId: string | null): CollabContext | null {
  const [ctx, setCtx] = useState<CollabContext | null>(null)

  useEffect(() => {
    if (!contractId) { setCtx(null); return }
    const ydoc = new Y.Doc()
    const token = localStorage.getItem('accessToken') ?? ''
    const provider = new HocuspocusProvider({
      url:      COLLAB_URL,
      name:     `contract:${contractId}`,
      document: ydoc,
      token,
      onStatus: ({ status: s }) => {
        const next = s === 'connected' ? 'connected' : s === 'disconnected' ? 'disconnected' : 'connecting'
        setCtx(prev => prev ? { ...prev, status: next } : { ydoc, provider, status: next })
      },
    })
    setCtx({ ydoc, provider, status: 'connecting' })
    return () => {
      provider.destroy()
      ydoc.destroy()
    }
  }, [contractId])

  return ctx
}
