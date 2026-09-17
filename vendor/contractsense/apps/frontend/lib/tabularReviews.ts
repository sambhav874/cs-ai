export interface TabularColumnConfig {
  index: number;
  name: string;
  prompt: string;
  format?: string | null;
  tags?: string[];
}

export interface TabularReview {
  id: string;
  user_id: string;
  title: string;
  project_id?: string | null;
  document_ids: string[];
  columns_config: TabularColumnConfig[];
  document_count?: number;
  is_owner?: boolean;
  created_at: string;
  updated_at: string;
}

export interface TabularDocument {
  id: string;
  contract_id: string;
  contract_name: string;
  title: string;
  project_id?: string | null;
  page_count?: number;
  uploaded_at?: string;
  index_status?: string;
}

export interface TabularCell {
  id: string;
  review_id: string;
  document_id: string;
  column_index: number;
  status: "pending" | "running" | "done" | "error";
  summary?: string | null;
  reasoning?: string | null;
  citations?: Array<{ page?: string; quote?: string }>;
  error?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface TabularReviewDetail {
  review: TabularReview;
  documents: TabularDocument[];
  cells: TabularCell[];
}

export interface ProjectSummary {
  _id: string;
  name: string;
  description?: string | null;
}

export interface DocumentSummary {
  _id: string;
  contract_name: string;
  status: string;
  projectId?: string | null;
  page_count?: number;
  uploaded_at?: string;
  index?: { status?: string; job_id?: string };
}

type ApiResult = { data?: any; error?: string };
export type AuthenticatedFetch = (url: string, options?: RequestInit) => Promise<ApiResult>;

function assertOk<T>(result: ApiResult): T {
  if (result.error) throw new Error(result.error);
  return result.data as T;
}

function jsonHeaders() {
  return { "Content-Type": "application/json" };
}

export async function listTabularReviews(
  apiUrl: string,
  fetcher: AuthenticatedFetch,
  projectId?: string | null,
) {
  const params = new URLSearchParams();
  if (projectId) params.set("project_id", projectId);
  const suffix = params.toString() ? `?${params.toString()}` : "";
  return assertOk<TabularReview[]>(
    await fetcher(`${apiUrl}/tabular-reviews/${suffix}`),
  );
}

export async function createTabularReview(
  apiUrl: string,
  fetcher: AuthenticatedFetch,
  payload: {
    title?: string;
    project_id?: string | null;
    document_ids: string[];
    columns_config: TabularColumnConfig[];
  },
) {
  return assertOk<TabularReview>(
    await fetcher(`${apiUrl}/tabular-reviews/`, {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify(payload),
    }),
  );
}

export async function getTabularReview(
  apiUrl: string,
  fetcher: AuthenticatedFetch,
  reviewId: string,
) {
  return assertOk<TabularReviewDetail>(
    await fetcher(`${apiUrl}/tabular-reviews/${reviewId}`),
  );
}

export async function updateTabularReview(
  apiUrl: string,
  fetcher: AuthenticatedFetch,
  reviewId: string,
  payload: Partial<{
    title: string;
    document_ids: string[];
    columns_config: TabularColumnConfig[];
  }>,
) {
  return assertOk<TabularReview>(
    await fetcher(`${apiUrl}/tabular-reviews/${reviewId}`, {
      method: "PATCH",
      headers: jsonHeaders(),
      body: JSON.stringify(payload),
    }),
  );
}

export async function deleteTabularReview(
  apiUrl: string,
  fetcher: AuthenticatedFetch,
  reviewId: string,
) {
  assertOk<void>(await fetcher(`${apiUrl}/tabular-reviews/${reviewId}`, { method: "DELETE" }));
}

export async function generateTabularReview(
  apiUrl: string,
  fetcher: AuthenticatedFetch,
  reviewId: string,
  force = false,
) {
  return assertOk<{ generated_count: number; cells: TabularCell[] }>(
    await fetcher(`${apiUrl}/tabular-reviews/${reviewId}/generate`, {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ force }),
    }),
  );
}

export async function regenerateTabularCell(
  apiUrl: string,
  fetcher: AuthenticatedFetch,
  reviewId: string,
  documentId: string,
  columnIndex: number,
) {
  return assertOk<TabularCell>(
    await fetcher(`${apiUrl}/tabular-reviews/${reviewId}/regenerate-cell`, {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ document_id: documentId, column_index: columnIndex }),
    }),
  );
}

export async function updateTabularCell(
  apiUrl: string,
  fetcher: AuthenticatedFetch,
  reviewId: string,
  cellId: string,
  payload: Partial<Pick<TabularCell, "summary" | "reasoning" | "status">>,
) {
  return assertOk<TabularCell>(
    await fetcher(`${apiUrl}/tabular-reviews/${reviewId}/cells/${cellId}`, {
      method: "PATCH",
      headers: jsonHeaders(),
      body: JSON.stringify(payload),
    }),
  );
}

export async function listProjects(
  apiUrl: string,
  fetcher: AuthenticatedFetch,
  contextId?: string | null,
) {
  const params = new URLSearchParams();
  if (contextId) params.set("context_id", contextId);
  const suffix = params.toString() ? `?${params.toString()}` : "";
  const data = assertOk<ProjectSummary[] | { items?: ProjectSummary[] }>(
    await fetcher(`${apiUrl}/projects/${suffix}`),
  );
  return Array.isArray(data) ? data : data?.items ?? [];
}

export async function listDocuments(
  apiUrl: string,
  fetcher: AuthenticatedFetch,
  params: { contextId?: string | null; projectId?: string | null } = {},
) {
  const query = new URLSearchParams({
    page: "1",
    per_page: "100",
    sort_by: "uploaded_at",
    sort_order: "desc",
  });
  if (params.contextId) query.set("context_id", params.contextId);
  if (params.projectId) query.set("project_id", params.projectId);
  const result = assertOk<{ documents: DocumentSummary[] }>(
    await fetcher(`${apiUrl}/documents/${query.toString() ? `?${query.toString()}` : ""}`),
  );
  return result.documents ?? [];
}
