export type PlaybookStatus = "acceptable" | "needs_review" | "not_acceptable" | "not_applicable";
export type PlaybookSeverity = "low" | "medium" | "high" | "critical";

export interface PlaybookRule {
  rule_id?: string;
  index?: number;
  name: string;
  clause_type: string;
  description?: string | null;
  standard_position?: string | null;
  fallback_positions: string[];
  unacceptable_deviations: string[];
  guidance?: string | null;
  required_clause: boolean;
  suggested_language?: string | null;
  severity: PlaybookSeverity;
  tags: string[];
}

export interface Playbook {
  id: string;
  user_id: string;
  title: string;
  description?: string | null;
  contract_type?: string | null;
  project_id?: string | null;
  visibility: "private" | "project";
  reference_document_id?: string | null;
  reference_document_name?: string | null;
  rules: PlaybookRule[];
  rule_count: number;
  run_count: number;
  source?: string;
  is_owner?: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface PlaybookTemplate {
  id: string;
  title: string;
  description?: string;
  contract_type?: string;
  rules: PlaybookRule[];
}

export interface PlaybookRun {
  id: string;
  playbook_id: string;
  user_id: string;
  project_id?: string | null;
  contract_ids: string[];
  rule_ids: string[];
  status: "pending" | "running" | "completed" | "error";
  summary: {
    total?: number;
    action_count?: number;
    by_status?: Record<PlaybookStatus, number>;
    by_severity?: Record<PlaybookSeverity, number>;
  };
  options?: Record<string, any>;
  error?: string | null;
  created_at?: string;
  updated_at?: string;
  completed_at?: string | null;
}

export interface PlaybookFinding {
  id: string;
  run_id: string;
  playbook_id: string;
  document_id: string;
  document_name?: string | null;
  rule_id: string;
  rule_name: string;
  clause_type: string;
  status: PlaybookStatus;
  reviewer_status?: PlaybookStatus | null;
  matched_position?: string | null;
  clause_summary?: string | null;
  matched_text?: string | null;
  reasoning?: string | null;
  guidance?: string | null;
  suggested_revision?: string | null;
  severity: PlaybookSeverity;
  confidence?: number | null;
  citations?: Array<{ page?: string; quote?: string }>;
  reviewer_notes?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface PlaybookDetail {
  playbook: Playbook;
  latest_run?: PlaybookRun | null;
}

export interface PlaybookRunDetail {
  run: PlaybookRun;
  findings: PlaybookFinding[];
}

export interface PlaybookRedlineArtifact {
  redline_id: string;
  playbook_id: string;
  run_id: string;
  document_id: string;
  document_name?: string | null;
  filename: string;
  content_type: string;
  byte_count: number;
  applied_count: number;
  unmatched_count: number;
  download_url: string;
  created_at?: string;
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

export function emptyPlaybookRule(): PlaybookRule {
  return {
    name: "",
    clause_type: "",
    standard_position: "",
    fallback_positions: [],
    unacceptable_deviations: [],
    guidance: "",
    required_clause: false,
    suggested_language: "",
    severity: "medium",
    tags: [],
  };
}

export async function listPlaybooks(
  apiUrl: string,
  fetcher: AuthenticatedFetch,
  projectId?: string | null,
) {
  const params = new URLSearchParams();
  if (projectId) params.set("project_id", projectId);
  const suffix = params.toString() ? `?${params.toString()}` : "";
  return assertOk<Playbook[]>(await fetcher(`${apiUrl}/playbooks/${suffix}`));
}

export async function listPlaybookTemplates(apiUrl: string, fetcher: AuthenticatedFetch) {
  return assertOk<PlaybookTemplate[]>(await fetcher(`${apiUrl}/playbooks/templates`));
}

export async function createPlaybook(
  apiUrl: string,
  fetcher: AuthenticatedFetch,
  payload: {
    title: string;
    description?: string | null;
    contract_type?: string | null;
    project_id?: string | null;
    visibility?: "private" | "project";
    reference_document_id?: string | null;
    reference_document_name?: string | null;
    rules: PlaybookRule[];
  },
) {
  return assertOk<Playbook>(
    await fetcher(`${apiUrl}/playbooks/`, {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify(payload),
    }),
  );
}

export async function generatePlaybookFromContracts(
  apiUrl: string,
  fetcher: AuthenticatedFetch,
  payload: {
    title: string;
    description?: string | null;
    contract_type?: string | null;
    project_id?: string | null;
    standard_contract_id?: string | null;
    example_contract_ids: string[];
    visibility?: "private" | "project";
    risk_tolerance?: string | null;
  },
) {
  return assertOk<Playbook>(
    await fetcher(`${apiUrl}/playbooks/generate-from-contracts`, {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify(payload),
    }),
  );
}

export async function getPlaybook(apiUrl: string, fetcher: AuthenticatedFetch, playbookId: string) {
  return assertOk<PlaybookDetail>(await fetcher(`${apiUrl}/playbooks/${playbookId}`));
}

export async function updatePlaybook(
  apiUrl: string,
  fetcher: AuthenticatedFetch,
  playbookId: string,
  payload: Partial<{
    title: string;
    description: string | null;
    contract_type: string | null;
    visibility: "private" | "project";
    reference_document_id: string | null;
    reference_document_name: string | null;
    rules: PlaybookRule[];
  }>,
) {
  return assertOk<Playbook>(
    await fetcher(`${apiUrl}/playbooks/${playbookId}`, {
      method: "PATCH",
      headers: jsonHeaders(),
      body: JSON.stringify(payload),
    }),
  );
}

export async function deletePlaybook(apiUrl: string, fetcher: AuthenticatedFetch, playbookId: string) {
  assertOk<void>(await fetcher(`${apiUrl}/playbooks/${playbookId}`, { method: "DELETE" }));
}

export async function runPlaybook(
  apiUrl: string,
  fetcher: AuthenticatedFetch,
  playbookId: string,
  payload: {
    contract_ids: string[];
    rule_ids?: string[];
    representing_party?: string | null;
    paper_type?: string | null;
    additional_context?: string | null;
    force?: boolean;
  },
) {
  return assertOk<PlaybookRunDetail>(
    await fetcher(`${apiUrl}/playbooks/${playbookId}/runs`, {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify(payload),
    }),
  );
}

export async function createPlaybookRedlines(
  apiUrl: string,
  fetcher: AuthenticatedFetch,
  playbookId: string,
  runId: string,
  payload: {
    document_ids?: string[];
    finding_ids?: string[];
  } = {},
) {
  return assertOk<PlaybookRedlineArtifact[]>(
    await fetcher(`${apiUrl}/playbooks/${playbookId}/runs/${runId}/redlines`, {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify(payload),
    }),
  );
}

export async function listPlaybookRuns(apiUrl: string, fetcher: AuthenticatedFetch, playbookId: string) {
  return assertOk<PlaybookRun[]>(await fetcher(`${apiUrl}/playbooks/${playbookId}/runs`));
}

export async function getPlaybookRun(
  apiUrl: string,
  fetcher: AuthenticatedFetch,
  playbookId: string,
  runId: string,
) {
  return assertOk<PlaybookRunDetail>(await fetcher(`${apiUrl}/playbooks/${playbookId}/runs/${runId}`));
}

export async function updatePlaybookFinding(
  apiUrl: string,
  fetcher: AuthenticatedFetch,
  playbookId: string,
  findingId: string,
  payload: Partial<{
    reviewer_status: PlaybookStatus;
    reviewer_notes: string | null;
    suggested_revision: string | null;
  }>,
) {
  return assertOk<PlaybookFinding>(
    await fetcher(`${apiUrl}/playbooks/${playbookId}/findings/${findingId}`, {
      method: "PATCH",
      headers: jsonHeaders(),
      body: JSON.stringify(payload),
    }),
  );
}
