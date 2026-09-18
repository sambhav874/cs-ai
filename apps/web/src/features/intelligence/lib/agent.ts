import type { AuthenticatedFetch, TabularColumnConfig } from "@cs/lib/tabularReviews";

export type AgentSurface =
  | "dashboard"
  | "project"
  | "contract"
  | "kpi"
  | "tabular_review"
  | "playbook"
  | "report"
  | "history"
  | "account"
  | "unknown";

export type AgentWorkflowStatus =
  | "started"
  | "running"
  | "waiting_approval"
  | "approved"
  | "rejected"
  | "completed"
  | "failed";

export interface AgentContext {
  surface?: AgentSurface;
  project_id?: string | null;
  contract_id?: string | null;
  review_id?: string | null;
  playbook_id?: string | null;
  session_id?: string | null;
  selected_document_ids?: string[];
  reference_contract_ids?: string[];
  displayed_document?: Record<string, string> | null;
  attached_documents?: Array<Record<string, string>>;
  visible_state?: Record<string, unknown>;
}

export interface CitationAnnotation {
  type?: "citation_data";
  ref: number;
  source_ref?: number;
  id?: string;
  evidence_id?: string;
  source_id?: string;
  doc_id?: string;
  document_id?: string | null;
  contract_id?: string | null;
  filename?: string;
  page?: number | string | null;
  page_start?: number | null;
  page_end?: number | null;
  quote: string;
  segment_id?: string;
  verified?: boolean;
}

export interface TabularReviewProposal {
  title: string;
  project_id?: string | null;
  document_ids: string[];
  columns_config: TabularColumnConfig[];
  reason?: string;
  estimated_rows?: number;
  estimated_columns?: number;
  estimated_tokens?: number;
  estimated_cost_usd?: number;
  practice_area?: string | null;
}

export interface AgentApprovalRequest {
  approval_id: string;
  workflow_id: string;
  action: string;
  title: string;
  description: string;
  allowed_decisions: string[];
  tabular_review?: TabularReviewProposal | null;
  payload?: Record<string, unknown>;
  created_at?: string;
}

export interface AgentTraceEvent {
  event?: string;
  detail?: Record<string, unknown>;
  created_at?: string;
}

export interface AgentTokenUsage {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
}

export interface Suggestion {
  id: string;
  action: string;
  label: string;
  preview?: string | null;
  confidence?: 'high' | 'medium' | 'low';
  payload?: Record<string, unknown>;
}

export interface AgentResponse {
  answer: string;
  workflow?: string;
  confidence: string;
  reason?: string;
  citation_details?: Record<string, unknown>;
  citation_annotations?: Array<Record<string, unknown>>;
  artifacts?: Array<Record<string, unknown>>;
  workflow_id: string;
  workflow_status: AgentWorkflowStatus;
  requires_approval: boolean;
  approval_request?: AgentApprovalRequest | null;
  suggestions?: Suggestion[] | null;
  agent_trace?: AgentTraceEvent[];
  token_usage?: AgentTokenUsage;
  cost_usd?: number;
  created_review_id?: string | null;
}

type ApiResult = { data?: unknown; error?: string };

function assertOk<T>(result: ApiResult): T {
  if (result.error) throw new Error(result.error);
  return result.data as T;
}

function jsonHeaders() {
  return { "Content-Type": "application/json" };
}

export async function queryAgent(
  apiUrl: string,
  fetcher: AuthenticatedFetch,
  payload: { message: string; context?: AgentContext; ai_provider?: string | null },
) {
  return assertOk<AgentResponse>(
    await fetcher(`${apiUrl}/agent/query`, {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify(payload),
    }),
  );
}

export async function getAgentWorkflow(apiUrl: string, fetcher: AuthenticatedFetch, workflowId: string) {
  return assertOk<AgentResponse>(await fetcher(`${apiUrl}/agent/workflows/${workflowId}`));
}

export async function updateAgentWorkflowProposal(
  apiUrl: string,
  fetcher: AuthenticatedFetch,
  workflowId: string,
  proposal: Partial<TabularReviewProposal>,
) {
  return assertOk<AgentResponse>(
    await fetcher(`${apiUrl}/agent/workflows/${workflowId}/proposal`, {
      method: "PATCH",
      headers: jsonHeaders(),
      body: JSON.stringify(proposal),
    }),
  );
}

export async function approveAgentWorkflow(
  apiUrl: string,
  fetcher: AuthenticatedFetch,
  workflowId: string,
  payload: { edited_tabular_review?: TabularReviewProposal; generate?: boolean } = {},
) {
  return assertOk<AgentResponse>(
    await fetcher(`${apiUrl}/agent/workflows/${workflowId}/approve`, {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ decision: "approve", generate: true, ...payload }),
    }),
  );
}

export async function rejectAgentWorkflow(
  apiUrl: string,
  fetcher: AuthenticatedFetch,
  workflowId: string,
  feedback?: string,
) {
  return assertOk<AgentResponse>(
    await fetcher(`${apiUrl}/agent/workflows/${workflowId}/reject`, {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ decision: "reject", feedback }),
    }),
  );
}
