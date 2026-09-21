/**
 * Routes for the screens ported from ContractSense. Each is code-split, so the
 * lifecycle screens don't pay for them. Paths are the SPA's; ContractSense's
 * own links are rewritten to these by shims/href.ts.
 *
 * A project and a space are one thing in this product, called a Space, so
 * these live at /spaces.
 */
import { lazy, Suspense } from 'react'
import { Navigate, Outlet, Route, useParams } from 'react-router-dom'
import { IntelligenceProviders } from './IntelligenceProviders'

const ProjectContractsScreen = lazy(() =>
  import('@cs/components/projects/ProjectContractsScreen').then((m) => ({ default: m.ProjectContractsScreen })),
)

function PageFallback() {
  return (
    <div className="p-6 space-y-3" aria-busy="true" aria-label="Loading">
      <div className="h-6 w-48 rounded-md bg-surface-100 animate-pulse" />
      <div className="h-4 w-80 rounded-md bg-surface-100 animate-pulse" />
      <div className="h-64 rounded-card bg-surface-100 animate-pulse" />
    </div>
  )
}

function Layout() {
  return (
    <IntelligenceProviders>
      <Suspense fallback={<PageFallback />}>
        <Outlet />
      </Suspense>
    </IntelligenceProviders>
  )
}

function SpaceRoute() {
  const { projectId = '' } = useParams()
  return <ProjectContractsScreen projectId={projectId} />
}

/** Mount inside the authenticated AppShell route. */
export const intelligenceRoutes = (
  <Route element={<Layout />}>
    {/* The Space page owns this now; these keep ContractSense's own links,
        and direct links to a project, working. */}
    <Route path="projects" element={<Navigate to="/spaces" replace />} />
    <Route path="projects/:projectId" element={<SpaceRoute />} />
  </Route>
)
