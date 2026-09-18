/**
 * Hand-written replacement for ContractSense's BreadcrumbContext: ported pages
 * set their crumbs and header actions exactly as before, and they render in the
 * SPA's own breadcrumb bar (components/layout/Breadcrumbs) via store/crumbs.
 */
import React, { useCallback, useEffect, useMemo } from 'react'
import { useLocation } from 'react-router-dom'
import { useCrumbStore } from '@/store/crumbs'
import { mapHref } from '@cs/shims/href'

export interface Breadcrumb {
  label: string
  href?: string
}

export function BreadcrumbProvider({ children }: { children: React.ReactNode }) {
  const { pathname } = useLocation()
  const setCrumbs = useCrumbStore((s) => s.setCrumbs)
  const setActions = useCrumbStore((s) => s.setActions)
  // A page's crumbs belong to that page: clear them on navigation.
  useEffect(() => () => {
    setCrumbs(null)
    setActions(null)
  }, [pathname, setCrumbs, setActions])
  return <>{children}</>
}

export function useBreadcrumbs() {
  const crumbs = useCrumbStore((s) => s.crumbs)
  const actions = useCrumbStore((s) => s.actions)
  const setCrumbs = useCrumbStore((s) => s.setCrumbs)
  const setActions = useCrumbStore((s) => s.setActions)
  // Stable setters: ported pages list them as effect dependencies, so a new
  // function per render would re-run the effect, update the store, re-render,
  // and loop.
  const setBreadcrumbs = useCallback(
    (b: Breadcrumb[]) => setCrumbs(b.map((c) => ({ label: c.label, to: c.href ? mapHref(c.href) : undefined }))),
    [setCrumbs],
  )
  const breadcrumbs = useMemo(() => (crumbs ?? []).map((c) => ({ label: c.label, href: c.to })), [crumbs])
  return { breadcrumbs, setBreadcrumbs, headerActions: actions, setHeaderActions: setActions }
}
