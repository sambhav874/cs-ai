/**
 * Shared agent store (D.2.3)
 *
 * Both the dashboard hero (`<HeroAgent />`) and the always-on side rail
 * (`<SideAgentRail />`) read + write the same agent state. Today that's
 * just the "which thread is active right now" signal so the hero can
 * show a "Continue: <title>" affordance instead of "Ask AI" when the
 * user has a live conversation on the rail.
 *
 * Why a dedicated store rather than lifting state into AppShell:
 *   - The rail and hero are siblings, not parent/child — lifting would
 *     drag thread state up to AppShell and make it leak into every page
 *   - Zustand lets either component subscribe selectively (hero only
 *     reads `activeThread`; rail reads + writes it) without prop drilling
 *   - Future D.2.4 ("Open in side panel" on long threads) and D4
 *     (skill-invocation chips) will add more shared fields — this is the
 *     right anchor point
 *
 * Kept intentionally minimal for D.2.3 — no threads[] list here (each
 * surface fetches on open), no contextChips. Add as later waves need.
 */
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface ActiveThread {
  id:    string
  title: string
}

interface AgentStore {
  activeThread: ActiveThread | null
  setActiveThread: (t: ActiveThread | null) => void
  clearActiveThread: () => void
}

// Persisted so "Continue last thread" works across page reloads + next-day
// sessions. Storage key is namespaced (clm-agent) to match the auth store
// convention (clm-auth).
export const useAgentStore = create<AgentStore>()(
  persist(
    (set) => ({
      activeThread: null,
      setActiveThread: (t) => set({ activeThread: t }),
      clearActiveThread: () => set({ activeThread: null }),
    }),
    { name: 'clm-agent' }
  )
)
