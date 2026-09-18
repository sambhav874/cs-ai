/**
 * Routes for the screens ported from ContractSense. Each is code-split, so the
 * lifecycle screens don't pay for them. Paths are the SPA's; ContractSense's
 * own links are rewritten to these by shims/href.ts.
 */
import { lazy, Suspense } from 'react'
import { Outlet, Route, useParams } from 'react-router-dom'
import { IntelligenceProviders } from './IntelligenceProviders'

const ProjectsPage = lazy(() => import('@cs/app/dashboard/page'))
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

function ProjectRoute() {
  const { projectId = '' } = useParams()
  return <ProjectContractsScreen projectId={projectId} />
}

/** Mount inside the authenticated AppShell route. */
export const intelligenceRoutes = (
  <Route element={<Layout />}>
    <Route path="projects" element={<ProjectsPage />} />
    <Route path="projects/:projectId" element={<ProjectRoute />} />
  </Route>
)
