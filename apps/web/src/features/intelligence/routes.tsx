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

const TabularReviewsPage = lazy(() => import('@cs/app/tabular-reviews/page'))
const TabularReviewPage = lazy(() => import('@cs/app/tabular-reviews/[review_id]/page'))
const PlaybooksPage = lazy(() => import('@cs/app/playbooks/page'))
const PlaybookPage = lazy(() => import('@cs/app/playbooks/[playbook_id]/page'))
const EvaluationsPage = lazy(() => import('@cs/app/evaluations/page'))
const EvaluationRunPage = lazy(() => import('@cs/app/evaluations/[run_id]/page'))

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
    {/* Tabular review: questions × documents, a cited answer per cell. */}
    <Route path="tabular-reviews" element={<TabularReviewsPage />} />
    <Route path="tabular-reviews/:review_id" element={<TabularReviewPage />} />
    {/* Review playbooks (named, run against contracts). The lifecycle's
        per-clause negotiation positions stay at /playbook. */}
    <Route path="playbooks" element={<PlaybooksPage />} />
    <Route path="playbooks/:playbook_id" element={<PlaybookPage />} />
    {/* Extraction evaluations: runs, datasets, CSV export (internal). */}
    <Route path="evaluations" element={<EvaluationsPage />} />
    <Route path="evaluations/:run_id" element={<EvaluationRunPage />} />
  </Route>
)
