export interface WorkflowRoles {
  editorUserId: string | null;
  approverUserId: string | null;
  editor_name?: string | null;
  approver_name?: string | null;
}

export interface JobStatusResponse {
  job_id: string;
  status: string;
  job_type?: string;
  contract_id?: string;
  progress?: number;
  current_step?: string;
  error?: string;
  timestamp?: string;
}

export interface Document {
  _id: string;
  status: string;
  contract_name: string;
  projectId?: string | null;
  index?: { status: string; job_id?: string; error?: string };
  summarize?: { status: string; job_id?: string };
  process?: { status: string; job_id?: string };
  upload?: { status: string; job_id?: string };
  uploaded_by: string;
  uploader_name?: string | null;
  uploaded_at: string;
  page_count: number;
  ownerType: "user" | "team";
  ownerId: string;
  workflowRoles?: WorkflowRoles | null;
  rejectedReason?: string | null;
  error?: { step: string; message: string; timestamp: string };
  latest_job?: JobStatusResponse | null;
}

export interface DocumentWithProgress extends Document {
  isProcessing: boolean;
  progress: number;
  currentStep: string | null;
  activeJobId?: string | null;
}

export interface UserCredits {
  page_credits: number;
  updated_at: string;
  user_id: string;
}

export interface UserInDB {
  _id: string;
  username: string;
  email: string;
  ownedAccountId?: string | null;
  teamIds?: string[];
}

export interface ContractStatusResponse {
  contract_id: string;
  status: string;
  index_status?: string;
  summarize_status?: string;
  process_status?: string;
  jobs: JobStatusResponse[];
}

export interface ProjectStats {
  total_documents: number;
  uploaded_count?: number;
  processing_count?: number;
  process_status_count?: number;
  ready_to_edit_count: number;
  editing_count: number;
  pending_approval_count: number;
  rejected_count: number;
  completed_count: number;
  error_count: number;
}

export interface Project {
  _id: string;
  name: string;
  description?: string | null;
  ownerId: string;
  ownerType: "user" | "team";
  createdAt: string;
  updatedAt: string;
  stats?: ProjectStats;
}

export interface AgentArtifact {
  artifact_id: string;
  document_id?: string;
  version_id?: string;
  version_number?: number | null;
  filename: string;
  download_url?: string;
}

export interface AgentDocumentSummary {
  document_id: string;
  filename: string;
  title?: string;
  draft_type?: string;
  artifact_kind?: string;
  current_version_id?: string;
  current_version_number?: number;
  created_at?: string;
  updated_at?: string;
  versions?: Array<{
    version_id: string;
    version_number?: number;
    filename?: string;
    created_at?: string;
  }>;
}

export interface AgentDocumentPreview {
  document_id?: string;
  version_id: string;
  version_number?: number;
  filename?: string;
  title?: string;
  body_text?: string;
  download_url?: string;
  document?: AgentDocumentSummary;
}

export interface ContractKPI {
  kpi_id: string;
  contract_id: string;
  contract_name?: string;
  project_id?: string | null;
  name: string;
  description?: string;
  kpi_type?: string;
  party?: string | null;
  operator?: string;
  value?: string | number | null;
  unit?: string | null;
  value_min?: number | null;
  value_max?: number | null;
  consequence_value?: number | null;
  consequence_unit?: string | null;
  trigger_condition?: string | null;
  status?: string;
  is_recommended?: boolean;
  recommendation_reason?: string | null;
  tracking_status?: string | null;
  is_tracked?: boolean;
  tracked_at?: string | null;
  tracked_by?: string | null;
  confidence?: number;
  needs_review?: boolean;
  section?: string | null;
  section_path?: string;
  structural_path?: string | null;
  quote?: string;
  page_start?: number | null;
  page_end?: number | null;
  remediation?: string | null;
  remediation_sla?: string | null;
  updated_at?: string;
}

export type AIProvider = "groq" | "openai" | "claude" | "gemini";
export type ProjectTab = "overview" | "contracts" | "kpis" | "assistant" | "reviews" | "playbooks";
export type ContractView = "all" | "mine" | "needs-action";
