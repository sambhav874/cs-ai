/**
 * collab.ts (P10C client) — useCollabProvider hook.
 *
 * Returns a Yjs document + Hocuspocus WebSocket provider scoped to a
 * specific contract. The provider streams ops to the server at
 * <origin>/collab (or VITE_COLLAB_URL); auth is the user's JWT, sent
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
import { useAuthStore } from '@/store/auth'

// Same origin, /collab: nginx (and the Vite dev proxy) forward it to the API's
// Hocuspocus port. The old default, ws://localhost:3030, was the developer's
// machine — in production every browser dialled its own localhost and the
// badge read "Offline" on every contract.
function collabUrl(): string {
  const configured = (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_COLLAB_URL
  if (configured) return configured
  return `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/collab`
}

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
    // The session lives in the auth store (persisted as `clm-auth`); there is
    // no `accessToken` key in localStorage, so the server always saw no token.
    const token = useAuthStore.getState().accessToken ?? ''
    const provider = new HocuspocusProvider({
      url:      collabUrl(),
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
