import type { ReactNode } from 'react'
import { create } from 'zustand'

/**
 * Page-supplied breadcrumbs. Most pages get theirs derived from the URL; a
 * page that knows better (a project's name, a review's title) sets them here,
 * and may add actions to the right of the bar. Cleared when the page unmounts.
 */
export interface Crumb {
  label: string
  to?: string
}

interface CrumbState {
  crumbs: Crumb[] | null
  actions: ReactNode | null
  setCrumbs: (crumbs: Crumb[] | null) => void
  setActions: (actions: ReactNode | null) => void
}

export const useCrumbStore = create<CrumbState>((set) => ({
  crumbs: null,
  actions: null,
  setCrumbs: (crumbs) => set({ crumbs }),
  setActions: (actions) => set({ actions }),
}))
