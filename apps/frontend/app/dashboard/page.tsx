"use client";

import { Suspense, memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  AlertCircle,
  BarChart3,
  BookOpen,
  ChevronDown,
  CheckCircle2,
  CreditCard,
  Download,
  FileText,
  FolderOpen,
  FolderPlus,
  Loader2,
  Play,
  Plus,
  RefreshCw,
  Search,
  Settings,
  UploadCloud,
  X,
  Table2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import LoadingScreen from "@/components/loader";
import { toast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { useAccountContext } from "../context/AccountContext";
import { apiDownload, apiFetch } from "@/lib/apiClient";
import { listPlaybooks, type Playbook } from "@/lib/playbooks";

const FileUploadModal = dynamic(
  () => import("@/components/new/file-upload-area").then((mod) => mod.FileUploadModal),
  { ssr: false, loading: () => null }
);

const RoleReassignmentModal = dynamic(
  () => import("@/components/new/RoleReassignmentModal").then((mod) => mod.RoleReassignmentModal),
  { ssr: false, loading: () => null }
);

const ContractAgentPanel = dynamic(
  () => import("@/components/ContractAgentPanel"),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full items-center justify-center text-sm text-gray-500">
        Loading assistant...
      </div>
    ),
  }
);

function preloadFileUploadModal() {
  void import("@/components/new/file-upload-area");
}

function preloadRoleReassignmentModal() {
  void import("@/components/new/RoleReassignmentModal");
}

interface WorkflowRoles {
  editorUserId: string | null;
  approverUserId: string | null;
  editor_name?: string | null;
  approver_name?: string | null;
}

interface Document {
  _id: string;
  status: string;
  contract_name: string;
  projectId?: string | null;
  index?: { status: string; job_id?: string };
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

interface DocumentWithProgress extends Document {
  isProcessing: boolean;
  progress: number;
  currentStep: string | null;
  activeJobId?: string | null;
}

interface UserCredits {
  page_credits: number;
  updated_at: string;
  user_id: string;
}

interface UserInDB {
  _id: string;
  username: string;
  email: string;
  ownedAccountId?: string | null;
  teamIds?: string[];
}

interface JobStatusResponse {
  job_id: string;
  status: string;
  job_type?: string;
  contract_id?: string;
  progress?: number;
  current_step?: string;
  error?: string;
  timestamp?: string;
}

interface ContractStatusResponse {
  contract_id: string;
  status: string;
  index_status?: string;
  summarize_status?: string;
  process_status?: string;
  jobs: JobStatusResponse[];
}

interface ProjectStats {
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

interface Project {
  _id: string;
  name: string;
  description?: string | null;
  ownerId: string;
  ownerType: "user" | "team";
  createdAt: string;
  updatedAt: string;
  stats?: ProjectStats;
}

interface AgentArtifact {
  artifact_id: string;
  document_id?: string;
  version_id?: string;
  version_number?: number | null;
  filename: string;
  download_url?: string;
}

interface AgentDocumentSummary {
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

interface AgentDocumentPreview {
  document_id?: string;
  version_id: string;
  version_number?: number;
  filename?: string;
  title?: string;
  body_text?: string;
  download_url?: string;
  document?: AgentDocumentSummary;
}

interface ContractKPI {
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

type AIProvider = "groq" | "openai" | "claude" | "gemini";
type ProjectTab = "overview" | "contracts" | "kpis" | "assistant" | "reviews" | "playbooks";
type ContractView = "all" | "mine" | "needs-action";

const PROJECT_SELECTION_KEY = "dashboardSelectedProject";

const emptyStats: ProjectStats = {
  total_documents: 0,
  uploaded_count: 0,
  processing_count: 0,
  ready_to_edit_count: 0,
  editing_count: 0,
  pending_approval_count: 0,
  rejected_count: 0,
  completed_count: 0,
  error_count: 0,
};

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function formatDate(dateString?: string) {
  if (!dateString) return "Unknown";
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function truncateMiddle(value: string, maxLength = 42) {
  if (!value || value.length <= maxLength) return value;
  const head = Math.ceil((maxLength - 3) / 2);
  const tail = Math.floor((maxLength - 3) / 2);
  return `${value.slice(0, head)}...${value.slice(value.length - tail)}`;
}

function isActiveJobStatus(status?: string) {
  return status === "IN_PROGRESS" || status === "PENDING" || status === "QUEUED";
}

function completedStatusForJob(jobType?: string) {
  switch (jobType) {
    case "indexing":
      return "Indexed";
    case "summarizing":
      return "Summarized";
    case "processing":
      return "Ready to Edit";
    default:
      return "Completed";
  }
}

function getProcessingLabel(doc: DocumentWithProgress) {
  if (doc.error) return `Error: ${doc.error.message}`;
  if (doc.status === "Ready to Edit") return "Ready to edit";
  if (doc.status === "queued") return "Queued — waiting for service";
  if (doc.status === "pending") return "Waiting";
  if (doc.status === "Summarized") return "Summarized";
  if (doc.status === "Indexed") return "Ingested";
  if (doc.status === "Syncronizing") return "Indexing";

  switch (doc.currentStep) {
    case "indexing":
      return `Indexing ${Math.round(doc.progress)}%`;
    case "summarizing":
      return `Analyzing ${Math.round(doc.progress)}%`;
    case "processing":
      return `Processing ${Math.round(doc.progress)}%`;
    default:
      return `Processing ${Math.round(doc.progress)}%`;
  }
}

function statusClass(status: string) {
  switch (status) {
    case "Uploaded":
      return "bg-gray-100 text-gray-700 border-gray-200";
    case "Indexing":
    case "Summarizing":
    case "Processing":
    case "processing":
    case "pending":
    case "queued":
      return "bg-amber-50 text-amber-700 border-amber-200";
    case "Ready to Edit":
    case "Ready":
    case "Indexed":
    case "Ingested":
      return "bg-sky-50 text-sky-700 border-sky-200";
    case "Editing":
      return "bg-indigo-50 text-indigo-700 border-indigo-200";
    case "Pending Approval":
    case "Pending Your Approval":
      return "bg-purple-50 text-purple-700 border-purple-200";
    case "Submitted":
      return "bg-gray-100 text-gray-600 border-gray-200";
    case "Rejected":
    case "Error":
    case "error":
      return "bg-red-50 text-red-700 border-red-200";
    case "Completed":
      return "bg-emerald-50 text-emerald-700 border-emerald-200";
    default:
      return "bg-gray-100 text-gray-600 border-gray-200";
  }
}

const ProcessingPill = memo(function ProcessingPill({ doc }: { doc: DocumentWithProgress }) {
  const isActive = doc.isProcessing || ["pending", "queued", "processing"].includes(doc.status);
  return (
    <div className="min-w-[150px]">
      <span className={cx("inline-flex items-center rounded-full border px-2 py-1 text-xs font-medium", statusClass(doc.error ? "error" : doc.status))}>
        {doc.error ? (
          <AlertCircle className="mr-1 h-3 w-3" />
        ) : isActive ? (
          <RefreshCw className="mr-1 h-3 w-3 animate-spin" />
        ) : (
          <FileText className="mr-1 h-3 w-3" />
        )}
        {getProcessingLabel(doc)}
      </span>
      {isActive && (
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
          <div
            className="h-full rounded-full bg-gray-900 transition-[width] duration-150"
            style={{ width: `${Math.min(doc.progress || 8, 100)}%` }}
          />
        </div>
      )}
    </div>
  );
});

export default function Dashboard() {
  return (
    <Suspense fallback={<LoadingScreen />}>
      <DashboardContent />
    </Suspense>
  );
}

function DashboardContent() {
  const searchParams = useSearchParams();
  const requestedProjectId = searchParams.get("project_id");
  const requestedTab = searchParams.get("tab");
  const requestedUpload = searchParams.get("upload") === "1";
  const requestedSessionId = searchParams.get("session_id");
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectIdState] = useState<string | null>(null);
  const [projectStats, setProjectStats] = useState<ProjectStats>(emptyStats);
  const [projectSearch, setProjectSearch] = useState("");
  const [projectTab, setProjectTab] = useState<ProjectTab>("overview");
  const [documents, setDocuments] = useState<DocumentWithProgress[]>([]);
  const [projectPlaybooks, setProjectPlaybooks] = useState<Playbook[]>([]);
  const [isProjectPlaybooksLoading, setIsProjectPlaybooksLoading] = useState(false);
  const [projectAgentDocuments, setProjectAgentDocuments] = useState<AgentDocumentSummary[]>([]);
  const [selectedProjectAgentDocument, setSelectedProjectAgentDocument] = useState<{ documentId: string; versionId: string } | null>(null);
  const [projectAgentPreview, setProjectAgentPreview] = useState<AgentDocumentPreview | null>(null);
  const [projectKpis, setProjectKpis] = useState<ContractKPI[]>([]);
  const [selectedKpiContractId, setSelectedKpiContractId] = useState<string>("");
  const [isProjectKpisLoading, setIsProjectKpisLoading] = useState(false);
  const [isExtractingProjectKpis, setIsExtractingProjectKpis] = useState(false);
  const [isProjectAgentDocumentsLoading, setIsProjectAgentDocumentsLoading] = useState(false);
  const [isProjectAgentPreviewLoading, setIsProjectAgentPreviewLoading] = useState(false);
  const [currentlyProcessing, setCurrentlyProcessing] = useState<string | null>(null);
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isProjectLoading, setIsProjectLoading] = useState(false);
  const [userCredits, setUserCredits] = useState<UserCredits | null>(null);
  const [currentUserInfo, setCurrentUserInfo] = useState<UserInDB | null>(null);
  const [loadingUser, setLoadingUser] = useState(true);
  const [isCreditLoading, setIsCreditLoading] = useState(false);
  const [creditError, setCreditError] = useState<string | null>(null);
  const [pagination, setPagination] = useState({
    currentPage: 1,
    totalPages: 1,
    totalItems: 0,
    itemsPerPage: 10,
  });
  const [contractSearch, setContractSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [contractView, setContractView] = useState<ContractView>("all");
  const [sortConfig, setSortConfig] = useState<{ field: string; direction: "asc" | "desc" }>({
    field: "uploaded_at",
    direction: "desc",
  });
  const [needsDocumentRefresh, setNeedsDocumentRefresh] = useState(false);
  const [useLocalMarker, setUseLocalMarker] = useState(false);
  const [hasInitialized, setHasInitialized] = useState(false);
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [isProjectDialogOpen, setIsProjectDialogOpen] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [newProjectDescription, setNewProjectDescription] = useState("");
  const [isCreatingProject, setIsCreatingProject] = useState(false);
  const [contractToReassign, setContractToReassign] = useState<{
    _id: string;
    contract_name: string;
    editorUserId: string | null;
    approverUserId: string | null;
  } | null>(null);
  const [isReassignModalOpen, setIsReassignModalOpen] = useState(false);

  const { selectedAccountId, isInitialized: accountInitialized } = useAccountContext();
  const apiUrl = process.env.NEXT_PUBLIC_EXTRACTOR_API_URL;
  const initialFetchCompleted = useRef(false);

  const {
    token,
    isAuthenticated,
    authChecked,
    authenticatedFetch,
    logout,
  } = useAuth();

  const selectedProject = useMemo(
    () => projects.find((project) => project._id === selectedProjectId) || null,
    [projects, selectedProjectId],
  );

  const setSelectedProjectId = useCallback((projectId: string | null) => {
    setSelectedProjectIdState(projectId);
    if (typeof window !== "undefined") {
      if (projectId) localStorage.setItem(`${PROJECT_SELECTION_KEY}_${selectedAccountId}`, projectId);
      else localStorage.removeItem(`${PROJECT_SELECTION_KEY}_${selectedAccountId}`);
    }
    setProjectTab(projectId ? "contracts" : "overview");
    setPagination((prev) => ({ ...prev, currentPage: 1 }));
  }, [selectedAccountId]);

  useEffect(() => {
    if ((requestedTab === "assistant" || requestedTab === "reviews" || requestedTab === "playbooks") && requestedProjectId) {
      setProjectTab(requestedTab);
    }
  }, [requestedProjectId, requestedTab]);

  useEffect(() => {
    if (!requestedUpload || !selectedProjectId) return;
    if (requestedProjectId && requestedProjectId !== selectedProjectId) return;
    setProjectTab("contracts");
    setIsUploadModalOpen(true);
  }, [requestedProjectId, requestedUpload, selectedProjectId]);

  useEffect(() => {
    if (selectedProjectId && projectTab === "overview") {
      setProjectTab("contracts");
    }
  }, [selectedProjectId, projectTab]);

  const handleSessionTimeout = useCallback(() => {
    toast({
      title: "Session expired",
      description: "Please sign in again.",
      variant: "destructive",
    });
    logout();
  }, [logout]);

  const handleApiError = useCallback((error: string) => {
    if (error.includes("Authentication failed") || error.includes("401") || error.includes("403")) {
      handleSessionTimeout();
      return true;
    }
    return false;
  }, [handleSessionTimeout]);

  const fetchCurrentUser = useCallback(async () => {
    if (!isAuthenticated || !token) {
      setLoadingUser(false);
      return;
    }

    try {
      setLoadingUser(true);
      const { data, error } = await authenticatedFetch(`${apiUrl}/users/me/`);
      if (error) {
        if (handleApiError(error)) return;
        throw new Error(error);
      }
      setCurrentUserInfo(data as UserInDB);
    } catch (err) {
      console.error("Failed to fetch current user:", err);
      setCurrentUserInfo(null);
    } finally {
      setLoadingUser(false);
    }
  }, [apiUrl, isAuthenticated, token, authenticatedFetch, handleApiError]);

  const fetchUserCredits = useCallback(async () => {
    if (!isAuthenticated) return;
    let url = `${apiUrl}/account/balance`;
    if (selectedAccountId) url += `?context_id=${selectedAccountId}`;

    try {
      setIsCreditLoading(true);
      setCreditError(null);
      const { data, error } = await authenticatedFetch(url);
      if (error) {
        if (handleApiError(error)) return;
        throw new Error(error);
      }
      setUserCredits(data as UserCredits);
    } catch (error) {
      console.error("Error fetching account details:", error);
      setCreditError(error instanceof Error ? error.message : "Failed to load credits");
    } finally {
      setIsCreditLoading(false);
    }
  }, [isAuthenticated, apiUrl, selectedAccountId, authenticatedFetch, handleApiError]);

  const fetchProjects = useCallback(async () => {
    if (!isAuthenticated || !accountInitialized || !apiUrl) return;
    setIsProjectLoading(true);
    try {
      const params = new URLSearchParams();
      if (selectedAccountId) params.set("context_id", selectedAccountId);
      const { data, error } = await authenticatedFetch(`${apiUrl}/projects/?${params.toString()}`);
      if (error) {
        if (handleApiError(error)) return;
        throw new Error(error);
      }

      const loadedProjects = (data || []) as Project[];
      setProjects(loadedProjects);
      setSelectedProjectIdState((current) => {
        const stored = typeof window !== "undefined"
          ? localStorage.getItem(`${PROJECT_SELECTION_KEY}_${selectedAccountId}`)
          : null;
        const preferred = current || requestedProjectId || stored;
        if (preferred && loadedProjects.some((project) => project._id === preferred)) {
          return preferred;
        }
        return loadedProjects[0]?._id || null;
      });
    } catch (error) {
      console.error("Failed to fetch projects:", error);
      toast({
        title: "Projects unavailable",
        description: error instanceof Error ? error.message : "Could not load projects.",
        variant: "destructive",
      });
    } finally {
      setIsProjectLoading(false);
    }
  }, [isAuthenticated, accountInitialized, apiUrl, selectedAccountId, requestedProjectId, authenticatedFetch, handleApiError]);

  const fetchProjectStats = useCallback(async (projectId: string | null) => {
    if (!isAuthenticated || !apiUrl || !projectId) {
      setProjectStats(emptyStats);
      return;
    }

    try {
      const { data, error } = await authenticatedFetch(`${apiUrl}/projects/${projectId}/stats`);
      if (error) {
        if (handleApiError(error)) return;
        throw new Error(error);
      }
      setProjectStats({ ...emptyStats, ...(data as ProjectStats) });
    } catch (error) {
      console.error("Failed to fetch project stats:", error);
      setProjectStats(emptyStats);
    }
  }, [isAuthenticated, apiUrl, authenticatedFetch, handleApiError]);

  const fetchContractStatus = useCallback(async (contractId: string) => {
    try {
      const { data, error } = await authenticatedFetch(`${apiUrl}/contract-status/${contractId}`);
      if (error) {
        if (handleApiError(error)) return null;
        throw new Error(error);
      }
      return data as ContractStatusResponse;
    } catch (err) {
      console.error(`Error fetching status for contract ${contractId}:`, err);
      return null;
    }
  }, [apiUrl, authenticatedFetch, handleApiError]);

  const fetchDocuments = useCallback(async (
    page = pagination.currentPage,
    perPage = pagination.itemsPerPage,
    search = contractSearch,
    currentStatusFilter = statusFilter,
    sortBy = sortConfig.field,
    sortOrder: "asc" | "desc" = sortConfig.direction,
  ) => {
    if (!isAuthenticated || !hasInitialized || !selectedProjectId) {
      setDocuments([]);
      return;
    }

    try {
      setIsRefreshing(true);
      const params = new URLSearchParams({
        page: page.toString(),
        per_page: perPage.toString(),
        sort_by: sortBy,
        sort_order: sortOrder,
        project_id: selectedProjectId,
      });
      if (selectedAccountId) params.set("context_id", selectedAccountId);
      if (search.trim()) params.set("search", search.trim());
      if (currentStatusFilter !== "all") params.set("status", currentStatusFilter);

      const { data, error } = await authenticatedFetch(`${apiUrl}/documents/?${params.toString()}`);
      if (error) {
        if (handleApiError(error)) return;
        throw new Error(error);
      }

      const newDocs = await Promise.all(
        ((data as any)?.documents || []).map(async (doc: Document) => {
          let progress = 0;
          let currentStep: string | null = null;
          let isProcessing = ["processing", "pending", "queued", "Syncronizing", "Indexing", "Summarizing", "Processing"].includes(doc.status);
          let activeJobId: string | null = null;
          let status = doc.status;
          let error = doc.error;
          let statusData: ContractStatusResponse | null = null;

          if (isProcessing) {
            statusData = doc.latest_job ? null : await fetchContractStatus(doc._id);
            const latestJob = doc.latest_job || statusData?.jobs.sort((a, b) =>
              new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime(),
            )[0];
            if (latestJob) {
              isProcessing = isActiveJobStatus(latestJob.status);
              progress = latestJob.progress || 0;
              currentStep = latestJob.current_step || null;
              activeJobId = latestJob.job_id;
              status = latestJob.status === "COMPLETED"
                ? completedStatusForJob(latestJob.job_type)
                : latestJob.status === "FAILED"
                  ? "error"
                  : isProcessing
                    ? "processing"
                    : latestJob.status.toLowerCase();
              if (latestJob.status === "FAILED") {
                error = {
                  step: latestJob.current_step || "unknown",
                  message: latestJob.error || "Job failed",
                  timestamp: latestJob.timestamp || new Date().toISOString(),
                };
              }
            }
          }

          return {
            ...doc,
            isProcessing,
            progress,
            currentStep,
            activeJobId,
            status,
            error,
            index_status: doc.index?.status || statusData?.index_status,
            summarize_status: doc.summarize?.status || statusData?.summarize_status,
            process_status: doc.process?.status || statusData?.process_status,
          };
        }),
      );

      setDocuments(newDocs);
      const activeProcessId = newDocs.find((doc) => doc.isProcessing)?._id;
      if (!activeProcessId && currentlyProcessing) {
        setCurrentlyProcessing(null);
      } else if (activeProcessId && !currentlyProcessing) {
        setCurrentlyProcessing(activeProcessId);
      }

      setPagination({
        currentPage: (data as any).pagination.current_page,
        totalPages: (data as any).pagination.pages,
        totalItems: (data as any).pagination.total,
        itemsPerPage: (data as any).pagination.per_page,
      });
    } catch (err) {
      console.error("Error fetching documents:", err);
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "Failed to load contracts",
        variant: "destructive",
      });
    } finally {
      setIsRefreshing(false);
    }
  }, [
    isAuthenticated,
    hasInitialized,
    selectedProjectId,
    selectedAccountId,
    pagination.currentPage,
    pagination.itemsPerPage,
    contractSearch,
    statusFilter,
    sortConfig,
    authenticatedFetch,
    apiUrl,
    handleApiError,
    fetchContractStatus,
    currentlyProcessing,
  ]);

  const fetchProjectPlaybooks = useCallback(async () => {
    if (!apiUrl || !isAuthenticated || !selectedProjectId) {
      setProjectPlaybooks([]);
      return;
    }

    try {
      setIsProjectPlaybooksLoading(true);
      const nextPlaybooks = await listPlaybooks(apiUrl, authenticatedFetch, selectedProjectId);
      setProjectPlaybooks(nextPlaybooks);
    } catch (error) {
      console.error("Failed to fetch project playbooks:", error);
      toast({
        title: "Playbooks unavailable",
        description: error instanceof Error ? error.message : "Could not load playbooks.",
        variant: "destructive",
      });
      setProjectPlaybooks([]);
    } finally {
      setIsProjectPlaybooksLoading(false);
    }
  }, [apiUrl, authenticatedFetch, isAuthenticated, selectedProjectId]);

  const fetchProjectAgentDocuments = useCallback(async () => {
    if (!apiUrl || !token || !selectedProjectId) {
      setProjectAgentDocuments([]);
      return [];
    }
    try {
      setIsProjectAgentDocumentsLoading(true);
      const response = await apiFetch(`${apiUrl}/projects/${selectedProjectId}/agent/documents`);
      if (!response.ok) return [];
      const payload = await response.json();
      const nextDocuments = Array.isArray(payload.documents) ? payload.documents as AgentDocumentSummary[] : [];
      setProjectAgentDocuments(nextDocuments);
      return nextDocuments;
    } finally {
      setIsProjectAgentDocumentsLoading(false);
    }
  }, [apiUrl, token, selectedProjectId]);

  const fetchProjectKpis = useCallback(async () => {
    if (!apiUrl || !token || !selectedProjectId) {
      setProjectKpis([]);
      return [];
    }
    try {
      setIsProjectKpisLoading(true);
      const response = await apiFetch(`${apiUrl}/projects/${selectedProjectId}/kpis`);
      if (!response.ok) {
        const detail = await response.text();
        throw new Error(detail || "Could not load KPI register.");
      }
      const payload = await response.json();
      const nextKpis = Array.isArray(payload.kpis) ? payload.kpis as ContractKPI[] : [];
      setProjectKpis(nextKpis);
      return nextKpis;
    } catch (error) {
      console.error("Failed to fetch project KPIs:", error);
      toast({
        title: "KPI register unavailable",
        description: error instanceof Error ? error.message : "Could not load KPIs.",
        variant: "destructive",
      });
      return [];
    } finally {
      setIsProjectKpisLoading(false);
    }
  }, [apiUrl, token, selectedProjectId]);

  const extractProjectKpis = useCallback(async () => {
    if (!apiUrl || !token || !selectedProjectId) return;
    if (!selectedKpiContractId) {
      toast({
        title: "Choose one contract",
        description: "KPI extraction runs one contract at a time. Select an ingested contract first.",
        variant: "destructive",
      });
      return;
    }
    try {
      setIsExtractingProjectKpis(true);
      const selectedProvider = (localStorage.getItem("aiProvider") as AIProvider) || "groq";
      const response = await apiFetch(`${apiUrl}/contracts/${selectedKpiContractId}/kpis/extract`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ replace_drafts: true, ai_provider: selectedProvider }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.detail || "Could not extract KPIs.");
      }
      const payload = await response.json();
      await fetchProjectKpis();
      toast({
        title: "Contract KPIs extracted",
        description: `${payload.kpi_count ?? payload.kpis?.length ?? 0} KPI candidates extracted for the selected contract.`,
      });
    } catch (error) {
      console.error("Failed to extract KPIs:", error);
      toast({
        title: "KPI extraction failed",
        description: error instanceof Error ? error.message : "Could not extract KPIs.",
        variant: "destructive",
      });
    } finally {
      setIsExtractingProjectKpis(false);
    }
  }, [apiUrl, token, selectedProjectId, selectedKpiContractId, fetchProjectKpis]);

  const updateProjectKpi = useCallback(async (kpi: ContractKPI, updates: Partial<ContractKPI>) => {
    if (!apiUrl || !token || !kpi.contract_id) return;
    const previous = projectKpis;
    setProjectKpis((current) => current.map((item) => item.kpi_id === kpi.kpi_id ? { ...item, ...updates } : item));
    try {
      const response = await apiFetch(`${apiUrl}/contracts/${kpi.contract_id}/kpis/${kpi.kpi_id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(updates),
      });
      const updated = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(updated?.detail || "Could not update KPI.");
      }
      if (updated) {
        setProjectKpis((current) => current.map((item) => item.kpi_id === kpi.kpi_id ? updated : item));
      }
    } catch (error) {
      setProjectKpis(previous);
      toast({
        title: "KPI update failed",
        description: error instanceof Error ? error.message : "Could not update the KPI.",
        variant: "destructive",
      });
    }
  }, [apiUrl, token, projectKpis]);

  const updateProjectKpiStatus = useCallback(async (kpi: ContractKPI, status: "approved" | "ignored" | "draft") => {
    await updateProjectKpi(kpi, { status });
  }, [updateProjectKpi]);

  const acceptAllProjectKpis = useCallback(async () => {
    const candidates = projectKpis.filter((kpi) => kpi.status !== "approved" && kpi.status !== "ignored");
    if (!candidates.length) return;
    await Promise.all(candidates.map((kpi) => updateProjectKpi(kpi, { status: "approved" })));
    await fetchProjectKpis();
    toast({
      title: "All KPI candidates accepted",
      description: `${candidates.length} KPI${candidates.length === 1 ? "" : "s"} approved for this project.`,
    });
  }, [projectKpis, updateProjectKpi, fetchProjectKpis]);

  const trackRecommendedProjectKpis = useCallback(async () => {
    const candidates = projectKpis.filter((kpi) => isProjectKpiRecommended(kpi) && !isProjectKpiTracked(kpi) && kpi.status !== "ignored");
    if (!candidates.length) return;
    await Promise.all(candidates.map((kpi) => updateProjectKpi(kpi, {
      status: "approved",
      tracking_status: "tracked",
      is_tracked: true,
    })));
    await fetchProjectKpis();
    toast({
      title: "Recommended KPIs tracked",
      description: `${candidates.length} KPI${candidates.length === 1 ? "" : "s"} will now be monitored for breaches.`,
    });
  }, [projectKpis, updateProjectKpi, fetchProjectKpis]);

  const trackProjectKpi = useCallback(async (kpi: ContractKPI) => {
    await updateProjectKpi(kpi, {
      status: "approved",
      tracking_status: "tracked",
      is_tracked: true,
    });
    toast({
      title: "KPI tracking enabled",
      description: `${kpi.name} will now participate in breach checks.`,
    });
  }, [updateProjectKpi]);

  const openProjectAgentDocument = useCallback(async (documentId: string, versionId?: string) => {
    if (!apiUrl || !token || !selectedProjectId) return;
    const document = projectAgentDocuments.find((item) => item.document_id === documentId);
    const resolvedVersionId = versionId || document?.current_version_id || document?.versions?.[0]?.version_id;
    if (!resolvedVersionId) return;
    setSelectedProjectAgentDocument({ documentId, versionId: resolvedVersionId });
    setIsProjectAgentPreviewLoading(true);
    try {
      const response = await apiFetch(`${apiUrl}/projects/${selectedProjectId}/agent/documents/${documentId}/versions/${resolvedVersionId}`);
      if (!response.ok) return;
      const payload = await response.json();
      setProjectAgentPreview(payload as AgentDocumentPreview);
    } finally {
      setIsProjectAgentPreviewLoading(false);
    }
  }, [apiUrl, token, selectedProjectId, projectAgentDocuments]);

  const handleProjectArtifactCreated = useCallback(async (artifact: AgentArtifact) => {
    const nextDocuments = await fetchProjectAgentDocuments();
    if (artifact.document_id && artifact.version_id) {
      const exists = nextDocuments.some((document) => document.document_id === artifact.document_id);
      if (exists) {
        await openProjectAgentDocument(artifact.document_id, artifact.version_id);
      }
    }
  }, [fetchProjectAgentDocuments, openProjectAgentDocument]);

  const downloadProjectAgentPreview = useCallback(async () => {
    if (!apiUrl || !token || !projectAgentPreview?.download_url) return;
    const blob = await apiDownload(`${apiUrl}${projectAgentPreview.download_url}`);
    const objectUrl = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = projectAgentPreview.filename || "Project Work Product.docx";
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(objectUrl);
  }, [apiUrl, token, projectAgentPreview]);

  useEffect(() => {
    if (!isAuthenticated || !hasInitialized || !token) return;

    const processingDocs = documents.filter((doc) =>
      doc.isProcessing ||
      ["pending", "queued", "Syncronizing", "Indexing", "Summarizing", "processing"].includes(doc.status),
    );
    if (processingDocs.length === 0) return;

    const wsBase = (process.env.NEXT_PUBLIC_EXTRACTOR_API_URL ?? "http://localhost:8000/api/v1").replace(/^http/, "ws");
    const sockets: WebSocket[] = [];

    processingDocs.forEach((doc) => {
      const clientId = `${doc._id}-${Date.now()}`;
      const ws = new WebSocket(`${wsBase}/ws/job-status/${clientId}`);

      ws.onopen = () => {
        ws.send(JSON.stringify({ type: "subscribe", contract_id: doc._id }));
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data as string);
          if (msg.type !== "job_update") return;

          const latestJob = [...(msg.jobs ?? [])].sort((a, b) => (b.progress ?? 0) - (a.progress ?? 0))[0];
          if (!latestJob) return;

          const isNowComplete = latestJob.status === "COMPLETED";
          const isNowFailed = latestJob.status === "FAILED";
          const isStillActive = isActiveJobStatus(latestJob.status);
          const completedStatus = completedStatusForJob(latestJob.job_type);

          setDocuments((prevDocs) =>
            prevDocs.map((current) => {
              if (current._id !== doc._id) return current;
              return {
                ...current,
                isProcessing: isStillActive,
                progress: latestJob.progress ?? current.progress,
                currentStep: latestJob.current_step ?? current.currentStep,
                activeJobId: latestJob.job_id,
                status: isNowComplete ? completedStatus : isNowFailed ? "error" : isStillActive ? "processing" : current.status,
                error: isNowFailed
                  ? {
                    step: latestJob.current_step ?? "unknown",
                    message: latestJob.error ?? "Job failed",
                    timestamp: new Date().toISOString(),
                  }
                  : current.error,
              };
            }),
          );

          if (isNowComplete) {
            toast({
              title: latestJob.job_type === "indexing" ? "Contract ingested" : "Processing complete",
              description: latestJob.job_type === "indexing"
                ? "The contract is indexed and ready for the agent."
                : "All steps completed successfully.",
            });
            setCurrentlyProcessing(null);
            setNeedsDocumentRefresh(true);
            fetchUserCredits();
            fetchProjectStats(selectedProjectId);
            ws.close(1000, "complete");
          } else if (isNowFailed) {
            toast({
              title: "Processing failed",
              description: latestJob.error || "The processing job failed.",
              variant: "destructive",
            });
            setCurrentlyProcessing(null);
            setNeedsDocumentRefresh(true);
            ws.close(1000, "failed");
          }
        } catch {
          // Ignore malformed websocket payloads.
        }
      };

      sockets.push(ws);
    });

    return () => sockets.forEach((ws) => ws.close(1000, "unmount"));
  }, [
    documents
      .filter((doc) => doc.isProcessing || ["pending", "queued", "Syncronizing", "Indexing", "Summarizing", "processing"].includes(doc.status))
      .map((doc) => doc._id)
      .join(","),
    isAuthenticated,
    hasInitialized,
    token,
    fetchUserCredits,
    fetchProjectStats,
    selectedProjectId,
  ]);

  const startProcessing = useCallback(async (contractId: string) => {
    if (!isAuthenticated || !token) {
      toast({ title: "Error", description: "Authentication required", variant: "destructive" });
      return;
    }

    const docToProcess = documents.find((doc) => doc._id === contractId);
    if (!docToProcess) {
      toast({ title: "Error", description: "Contract data not found", variant: "destructive" });
      return;
    }

    try {
      setCurrentlyProcessing(contractId);
      setDocuments((prevDocs) =>
        prevDocs.map((doc) =>
          doc._id === contractId
            ? { ...doc, error: undefined, isProcessing: true, progress: 5, currentStep: "indexing", status: "processing" }
            : doc,
        ),
      );

      const requestBody = {
        contract_id: contractId,
        use_local_marker: useLocalMarker,
      };

      const { data, error } = await authenticatedFetch(`${apiUrl}/index/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });
      if (error) {
        if (handleApiError(error)) return;
        throw new Error(error);
      }

      const jobId = (data as any)?.job_id;
      const responseStatus = (data as any)?.status;

      if (jobId) {
        setDocuments((prevDocs) =>
          prevDocs.map((doc) => doc._id === contractId ? { ...doc, activeJobId: jobId } : doc),
        );
        toast({ title: "Ingestion started", description: "The contract is being indexed for the agent." });
      } else {
        setDocuments((prevDocs) =>
          prevDocs.map((doc) =>
            doc._id === contractId
              ? { ...doc, isProcessing: false, progress: 0, currentStep: null, status: "queued" }
              : doc,
          ),
        );
        toast({
          title: "Ingestion queued",
          description: "The processing service is temporarily unavailable. Ingestion will resume automatically.",
        });
      }
    } catch (err) {
      console.error(`Error starting processing for contract ${contractId}:`, err);
      setDocuments((prevDocs) =>
        prevDocs.map((doc) =>
          doc._id === contractId
            ? {
              ...doc,
              isProcessing: false,
              progress: 0,
              currentStep: null,
              status: "error",
              error: {
                step: "initialization",
                message: err instanceof Error ? err.message : "Unknown error",
                timestamp: new Date().toISOString(),
              },
            }
            : doc,
        ),
      );
      toast({
        title: "Processing error",
        description: err instanceof Error ? err.message : "Failed to start processing",
        variant: "destructive",
      });
      setCurrentlyProcessing(null);
    }
  }, [
    isAuthenticated,
    token,
    documents,
    useLocalMarker,
    selectedAccountId,
    authenticatedFetch,
    apiUrl,
    handleApiError,
  ]);

  const handleManualRefresh = useCallback(async () => {
    const refreshes: Array<Promise<unknown>> = [
      fetchProjects(),
      fetchDocuments(pagination.currentPage),
      fetchUserCredits(),
    ];
    if (projectTab === "kpis") refreshes.push(fetchProjectKpis());
    await Promise.all(refreshes);
  }, [fetchProjects, fetchDocuments, fetchUserCredits, fetchProjectKpis, projectTab, pagination.currentPage]);

  const handlePageChange = useCallback((page: number) => {
    fetchDocuments(page);
  }, [fetchDocuments]);

  const handleProcess = useCallback((contractId: string) => {
    void startProcessing(contractId);
  }, [startProcessing]);

  const handleUploadSuccess = useCallback(() => {
    setIsUploadModalOpen(false);
    fetchProjects();
    fetchDocuments(1);
    fetchUserCredits();
  }, [fetchProjects, fetchDocuments, fetchUserCredits]);

  const handleToggleLocalMarker = useCallback((checked: boolean) => {
    setUseLocalMarker(checked);
    localStorage.setItem("useLocalMarker", JSON.stringify(checked));
    toast({
      title: checked ? "Local marking enabled" : "Local marking disabled",
      description: checked ? "Contracts will use local marking." : "Contracts will use the standard pipeline.",
    });
  }, []);

  const handleCreateProject = useCallback(async () => {
    const name = newProjectName.trim();
    if (!name || !apiUrl) return;

    try {
      setIsCreatingProject(true);
      const { data, error } = await authenticatedFetch(`${apiUrl}/projects/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          description: newProjectDescription.trim() || undefined,
          ownerId: selectedAccountId !== "personal" ? selectedAccountId : undefined,
        }),
      });
      if (error) {
        if (handleApiError(error)) return;
        throw new Error(error);
      }
      const created = data as Project;
      setProjects((prev) => [created, ...prev]);
      setSelectedProjectId(created._id);
      setNewProjectName("");
      setNewProjectDescription("");
      setIsProjectDialogOpen(false);
      toast({ title: "Project created", description: created.name });
    } catch (error) {
      toast({
        title: "Could not create project",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsCreatingProject(false);
    }
  }, [
    newProjectName,
    newProjectDescription,
    apiUrl,
    authenticatedFetch,
    selectedAccountId,
    handleApiError,
    setSelectedProjectId,
  ]);

  const handleOpenReassignModal = useCallback((doc: Document) => {
    if (doc.ownerType === "user") {
      toast({ title: "Personal contract", description: "Role assignment is only for account contracts." });
      return;
    }
    setContractToReassign({
      _id: doc._id,
      contract_name: doc.contract_name,
      editorUserId: doc.workflowRoles?.editorUserId || null,
      approverUserId: doc.workflowRoles?.approverUserId || null,
    });
    setIsReassignModalOpen(true);
  }, []);

  const handleReassignSuccess = useCallback(() => {
    setIsReassignModalOpen(false);
    setContractToReassign(null);
    fetchDocuments(pagination.currentPage);
  }, [fetchDocuments, pagination.currentPage]);

  useEffect(() => {
    const initialize = async () => {
      if (!authChecked || !accountInitialized) return;
      if (!isAuthenticated) {
        setIsInitialLoading(false);
        return;
      }

      try {
        await Promise.all([fetchCurrentUser(), fetchProjects(), fetchUserCredits()]);
        initialFetchCompleted.current = true;
      } catch (error) {
        console.error("Initialization error:", error);
      } finally {
        setIsInitialLoading(false);
      }
    };
    initialize();
  }, [authChecked, accountInitialized, isAuthenticated, fetchCurrentUser, fetchProjects, fetchUserCredits]);

  useEffect(() => {
    if (initialFetchCompleted.current && isAuthenticated && accountInitialized) {
      fetchProjects();
      fetchUserCredits();
    }
  }, [selectedAccountId, fetchProjects, fetchUserCredits, isAuthenticated, accountInitialized]);

  useEffect(() => {
    if (!isAuthenticated || !selectedProjectId) return;
    const scheduleIdle = window.requestIdleCallback ?? ((callback: IdleRequestCallback) => window.setTimeout(callback, 1000));
    const cancelIdle = window.cancelIdleCallback ?? window.clearTimeout;
    const uploadIdleId = scheduleIdle(() => preloadFileUploadModal());
    const rolesIdleId = scheduleIdle(() => preloadRoleReassignmentModal());
    return () => {
      cancelIdle(uploadIdleId as number);
      cancelIdle(rolesIdleId as number);
    };
  }, [isAuthenticated, selectedProjectId]);

  useEffect(() => {
    if (!selectedProjectId) {
      setDocuments([]);
      setProjectStats(emptyStats);
      setProjectAgentDocuments([]);
      setProjectAgentPreview(null);
      setSelectedProjectAgentDocument(null);
      setProjectKpis([]);
      setProjectPlaybooks([]);
      setSelectedKpiContractId("");
      return;
    }
    setProjectStats({ ...emptyStats, ...(selectedProject?.stats || {}) });
    fetchDocuments(1);
  }, [selectedProjectId, selectedProject, contractSearch, statusFilter, sortConfig, fetchDocuments]);

  useEffect(() => {
    if (!selectedProjectId || projectTab !== "assistant") return;
    void fetchProjectAgentDocuments();
  }, [projectTab, selectedProjectId, fetchProjectAgentDocuments]);

  useEffect(() => {
    if (!selectedProjectId || projectTab !== "kpis") return;
    void fetchProjectKpis();
  }, [projectTab, selectedProjectId, fetchProjectKpis]);

  useEffect(() => {
    if (!selectedProjectId || projectTab !== "playbooks") return;
    void fetchProjectPlaybooks();
  }, [projectTab, selectedProjectId, fetchProjectPlaybooks]);

  useEffect(() => {
    if (!selectedProjectId) return;
    const indexedDocuments = documents.filter((document) => (
      document.index?.status === "success" || document.status === "Indexed"
    ));
    if (!indexedDocuments.length) {
      setSelectedKpiContractId("");
      return;
    }
    if (!selectedKpiContractId || !indexedDocuments.some((document) => document._id === selectedKpiContractId)) {
      setSelectedKpiContractId(indexedDocuments[0]._id);
    }
  }, [documents, selectedProjectId, selectedKpiContractId]);

  useEffect(() => {
    const storedMarker = localStorage.getItem("useLocalMarker");
    setUseLocalMarker(storedMarker ? JSON.parse(storedMarker) : false);
    setHasInitialized(true);
  }, []);

  useEffect(() => {
    if (needsDocumentRefresh && !isRefreshing) {
      fetchDocuments(pagination.currentPage);
      fetchProjectStats(selectedProjectId);
      setNeedsDocumentRefresh(false);
    }
  }, [needsDocumentRefresh, isRefreshing, fetchDocuments, fetchProjectStats, selectedProjectId, pagination.currentPage]);

  useEffect(() => {
    if (!isAuthenticated) return;
    const tokenCheckInterval = setInterval(() => {
      if (!token) handleSessionTimeout();
    }, 5 * 60 * 1000);
    return () => clearInterval(tokenCheckInterval);
  }, [isAuthenticated, token, handleSessionTimeout]);

  const filteredProjects = useMemo(() => {
    const query = projectSearch.toLowerCase().trim();
    if (!query) return projects;
    return projects.filter((project) =>
      project.name.toLowerCase().includes(query) ||
      (project.description || "").toLowerCase().includes(query),
    );
  }, [projects, projectSearch]);

  const visibleDocuments = useMemo(() => {
    if (!currentUserInfo) return documents;
    if (contractView === "all") return documents;
    return documents.filter((doc) => {
      const isEditor = doc.workflowRoles?.editorUserId === currentUserInfo._id;
      const isApprover = doc.workflowRoles?.approverUserId === currentUserInfo._id;
      const isUploader = doc.uploaded_by === currentUserInfo._id;
      if (contractView === "mine") return isEditor || isApprover || isUploader;
      if (contractView === "needs-action") {
        return (isApprover && doc.status === "Pending Approval") ||
          (isEditor && ["Ready to Edit", "Editing", "Rejected"].includes(doc.status)) ||
          (isUploader && doc.status === "Uploaded");
      }
      return true;
    });
  }, [documents, contractView, currentUserInfo]);

  const displayStatusForDoc = useCallback((doc: Document) => {
    const rawStatus = doc.status || "Unknown";
    if (rawStatus === "Indexed") return "Ingested";
    const isPersonalDoc = doc.ownerType === "user";
    const currentUserId = currentUserInfo?._id;
    const isAssignedApprover = !!(currentUserId && doc.workflowRoles?.approverUserId === currentUserId);
    const isAssignedEditor = !!(currentUserId && doc.workflowRoles?.editorUserId === currentUserId);
    const isAccountOwner = !!(
      currentUserInfo?.ownedAccountId &&
      doc.ownerType === "team" &&
      doc.ownerId === currentUserInfo.ownedAccountId
    );

    if (isPersonalDoc) return rawStatus;
    if (rawStatus === "Pending Approval") {
      if (isAssignedApprover) return "Pending Your Approval";
      if (isAssignedEditor) return "Submitted";
      if (isAccountOwner) return "Pending Your Approval";
    }
    return rawStatus;
  }, [currentUserInfo]);

  return (
    <div className="min-h-screen bg-white font-InterVar text-gray-900">
      {isInitialLoading && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-white">
          <LoadingScreen />
        </div>
      )}

      <div className="min-h-screen pt-20 md:pt-0">
        <main className="flex min-w-0 flex-col">
          <ProjectSwitcher
            projects={filteredProjects}
            selectedProjectId={selectedProjectId}
            projectSearch={projectSearch}
            isProjectLoading={isProjectLoading}
            isProjectDialogOpen={isProjectDialogOpen}
            newProjectName={newProjectName}
            newProjectDescription={newProjectDescription}
            isCreatingProject={isCreatingProject}
            onSelectProject={setSelectedProjectId}
            onProjectSearchChange={setProjectSearch}
            onProjectDialogChange={setIsProjectDialogOpen}
            onProjectNameChange={setNewProjectName}
            onProjectDescriptionChange={setNewProjectDescription}
            onCreateProject={handleCreateProject}
          />

          <header className="border-b border-gray-200 px-4 py-3 md:px-10">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-xs font-medium text-gray-500">
                  <span>{selectedAccountId === "personal" ? "Personal workspace" : "Account workspace"}</span>
                  {selectedProject && <span>/</span>}
                  {selectedProject && <span className="truncate">{selectedProject.ownerType}</span>}
                </div>
                <h1 className="mt-1 truncate font-serif text-3xl font-light text-gray-900">
                  {selectedProject ? selectedProject.name : "Projects"}
                </h1>
                <p className="mt-1 max-w-2xl truncate text-sm text-gray-500">
                  {selectedProject?.description || "Project-centered contracts, roles, ingestion, and readiness."}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <div className="flex h-9 items-center gap-2 rounded-full border border-gray-200 bg-gray-50 px-3 text-sm">
                  <CreditCard className="h-4 w-4 text-gray-500" />
                  {isCreditLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <span>{userCredits?.page_credits ?? 0}</span>}
                </div>

                <Button
                  onClick={handleManualRefresh}
                  variant="outline"
                  size="sm"
                  className="h-9 gap-2"
                  disabled={isRefreshing || isCreditLoading}
                >
                  <RefreshCw className={cx("h-4 w-4", (isRefreshing || isCreditLoading) && "animate-spin")} />
                  Refresh
                </Button>

                {process.env.NEXT_PUBLIC_BRANCH_ENV === "development" && (
                  <Dialog>
                    <DialogTrigger asChild>
                      <Button variant="outline" size="sm" className="h-9 gap-2">
                        <Settings className="h-4 w-4" />
                        Settings
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>Processing Settings</DialogTitle>
                      </DialogHeader>
                      <div className="space-y-4 py-4">
                        <div className="flex items-center gap-2">
                          <Checkbox id="use-local-marker" checked={useLocalMarker} onCheckedChange={handleToggleLocalMarker} />
                          <Label htmlFor="use-local-marker">Use local marker for processing</Label>
                        </div>
                        <p className="text-sm text-gray-500">Local marking can be faster but may differ from the standard pipeline.</p>
                      </div>
                    </DialogContent>
                  </Dialog>
                )}

                <Button
                  size="sm"
                  onFocus={preloadFileUploadModal}
                  onClick={() => setIsUploadModalOpen(true)}
                  onMouseEnter={preloadFileUploadModal}
                  className="h-9 gap-2 bg-gray-900 text-white hover:bg-gray-800"
                  disabled={!selectedProjectId}
                >
                  <UploadCloud className="h-4 w-4" />
                  Upload
                </Button>
              </div>
            </div>
            {creditError && (
              <button onClick={fetchUserCredits} className="mt-2 text-xs text-red-600 hover:text-red-700">
                Credit load failed. Retry.
              </button>
            )}
          </header>

          <div className="flex h-10 items-center border-b border-gray-200 px-4 md:px-10">
            <div className="flex flex-1 items-center gap-5">
              {(selectedProjectId
                ? [
                    { id: "contracts", label: "Contracts" },
                    { id: "kpis", label: "KPIs" },
                    { id: "reviews", label: "Reviews" },
                    { id: "playbooks", label: "Playbooks" },
                    { id: "assistant", label: "Assistant" },
                  ]
                : [{ id: "overview", label: "Overview" }]
              ).map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setProjectTab(tab.id as ProjectTab)}
                  className={cx(
                    "text-xs transition-colors",
                    projectTab === tab.id ? "font-medium text-gray-800" : "text-gray-500 hover:text-gray-800",
                  )}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            {selectedProject && (
              <span className="text-xs text-gray-500">Updated {formatDate(selectedProject.updatedAt)}</span>
            )}
          </div>

          <section className={cx("min-h-0 flex-1 bg-white", projectTab === "assistant" ? "overflow-hidden" : "overflow-y-auto")}>
            {!selectedProjectId ? (
              <ProjectOverview
                projects={filteredProjects}
                selectedProject={selectedProject}
                onSelectProject={setSelectedProjectId}
              />
            ) : projectTab === "kpis" && selectedProject ? (
              <ProjectKPIWorkspace
                kpis={projectKpis}
                documents={documents}
                selectedContractId={selectedKpiContractId}
                isLoading={isProjectKpisLoading}
                isExtracting={isExtractingProjectKpis}
                onSelectedContractChange={setSelectedKpiContractId}
                onExtract={extractProjectKpis}
                onRefresh={() => { void fetchProjectKpis(); }}
                onStatusChange={updateProjectKpiStatus}
                onAcceptAll={acceptAllProjectKpis}
                onTrackRecommended={trackRecommendedProjectKpis}
                onTrackKpi={trackProjectKpi}
              />
            ) : projectTab === "assistant" && selectedProject ? (
              <ProjectAssistantWorkspace
                documents={documents}
                agentDocuments={projectAgentDocuments}
                selectedAgentDocument={selectedProjectAgentDocument}
                preview={projectAgentPreview}
                isAgentDocumentsLoading={isProjectAgentDocumentsLoading}
                isPreviewLoading={isProjectAgentPreviewLoading}
                onOpenAgentDocument={openProjectAgentDocument}
                onDownloadPreview={downloadProjectAgentPreview}
                chat={
                  <ContractAgentPanel
                    projectId={selectedProjectId}
                    contractName={selectedProject.name}
                    scope="project"
                    roleLabel="Project"
                    userName={currentUserInfo?.username}
                    canEdit
                    canApprove={false}
                    canRequestReEdit={false}
                    apiUrl={apiUrl}
                    token={token}
                    initialSessionId={requestedSessionId}
                    referenceDocuments={documents.map((document) => ({
                      id: document._id,
                      name: document.contract_name,
                      status: document.index?.status || document.status,
                    }))}
                    onArtifactCreated={handleProjectArtifactCreated}
                  />
                }
              />
            ) : projectTab === "playbooks" && selectedProject ? (
              <div className="px-4 py-6 md:px-10">
                <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h2 className="text-xl font-semibold text-gray-950">Playbooks</h2>
                    <p className="mt-1 text-sm text-gray-500">Project rule sets for clause review, fallback positions, and redline-style guidance.</p>
                  </div>
                  <Button asChild className="rounded-lg bg-gray-950 text-white hover:bg-gray-800">
                    <Link href={`/playbooks?project_id=${encodeURIComponent(selectedProject._id)}`}>
                      <Plus className="h-4 w-4" />
                      New Playbook
                    </Link>
                  </Button>
                </div>

                {isProjectPlaybooksLoading ? (
                  <div className="flex min-h-[320px] items-center justify-center rounded-lg border border-gray-200 bg-gray-50 text-sm text-gray-500">
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Loading playbooks...
                  </div>
                ) : projectPlaybooks.length ? (
                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                    {projectPlaybooks.map((playbook) => (
                      <Link
                        key={playbook.id}
                        href={`/playbooks/${playbook.id}`}
                        className="flex min-h-40 flex-col rounded-lg border border-gray-200 bg-white p-4 transition-colors hover:border-gray-300 hover:bg-gray-50"
                      >
                        <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg border border-gray-200 bg-gray-50 text-gray-700">
                          <BookOpen className="h-5 w-5" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <h3 className="truncate text-sm font-semibold text-gray-950">{playbook.title}</h3>
                          <p className="mt-1 line-clamp-2 text-sm leading-6 text-gray-500">
                            {playbook.description || playbook.reference_document_name || playbook.contract_type || "Playbook"}
                          </p>
                        </div>
                        <div className="mt-4 flex items-center justify-between border-t border-gray-100 pt-3 text-xs text-gray-500">
                          <span>Playbook · {playbook.rule_count} rules</span>
                          <span>{playbook.visibility === "project" ? "Project" : "Private"}</span>
                        </div>
                      </Link>
                    ))}
                  </div>
                ) : (
                  <div className="flex min-h-[360px] flex-col items-start justify-center rounded-lg border border-gray-200 bg-gray-50 px-6 py-10">
                    <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-700">
                      <BookOpen className="h-5 w-5" />
                    </div>
                    <h2 className="text-xl font-semibold text-gray-950">No playbooks yet</h2>
                    <p className="mt-2 max-w-xl text-sm leading-6 text-gray-500">
                      Create a reusable rule set from a reference document or template.
                    </p>
                    <Button asChild className="mt-5 rounded-lg bg-gray-950 text-white hover:bg-gray-800">
                      <Link href={`/playbooks?project_id=${encodeURIComponent(selectedProject._id)}`}>
                        <BookOpen className="h-4 w-4" />
                        Create Playbook
                      </Link>
                    </Button>
                  </div>
                )}
              </div>
            ) : projectTab === "reviews" && selectedProject ? (
              <div className="px-4 py-6 md:px-10">
                <div className="flex min-h-[360px] flex-col items-start justify-center rounded-lg border border-gray-200 bg-gray-50 px-6 py-10">
                  <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-700">
                    <Table2 className="h-5 w-5" />
                  </div>
                  <h2 className="text-xl font-semibold text-gray-950">Tabular Reviews</h2>
                  <p className="mt-2 max-w-xl text-sm leading-6 text-gray-500">
                    Extract comparable terms from this project&apos;s indexed contracts into Mike-style review tables.
                  </p>
                  <div className="mt-5 flex flex-wrap gap-2">
                    <Button asChild className="rounded-lg bg-gray-950 text-white hover:bg-gray-800">
                      <Link href={`/tabular-reviews?project_id=${encodeURIComponent(selectedProject._id)}`}>
                        <Table2 className="h-4 w-4" />
                        Open Reviews
                      </Link>
                    </Button>
                    <Button asChild variant="outline" className="rounded-lg">
                      <Link href={`/tabular-reviews?project_id=${encodeURIComponent(selectedProject._id)}&new=1`}>
                        <Plus className="h-4 w-4" />
                        New Review
                      </Link>
                    </Button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="px-4 py-4 md:px-10">
                <div className="flex flex-col gap-3 border-b border-gray-200 pb-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-2">
                    {[
                      { id: "all", label: "All" },
                      { id: "mine", label: "Mine" },
                      { id: "needs-action", label: "Needs action" },
                    ].map((view) => (
                      <button
                        key={view.id}
                        onClick={() => setContractView(view.id as ContractView)}
                        className={cx(
                          "rounded-md px-2.5 py-1.5 text-xs transition-colors",
                          contractView === view.id ? "bg-gray-100 text-gray-900" : "text-gray-500 hover:bg-gray-50 hover:text-gray-800",
                        )}
                      >
                        {view.label}
                      </button>
                    ))}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="relative">
                      <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                      <Input
                        value={contractSearch}
                        onChange={(event) => {
                          setContractSearch(event.target.value);
                          setPagination((prev) => ({ ...prev, currentPage: 1 }));
                        }}
                        placeholder="Search contracts..."
                        className="h-9 w-64 border-gray-200 pl-8"
                      />
                      {contractSearch && (
                        <button
                          onClick={() => setContractSearch("")}
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                    <select
                      value={statusFilter}
                      onChange={(event) => {
                        setStatusFilter(event.target.value);
                        setPagination((prev) => ({ ...prev, currentPage: 1 }));
                      }}
                      className="h-9 rounded-md border border-gray-200 bg-white px-2 text-sm text-gray-700"
                    >
                      <option value="all">All statuses</option>
                      <option value="uploaded">Uploaded</option>
                      <option value="processing">Processing</option>
                      <option value="ready_to_edit">Ready to edit</option>
                      <option value="editing">Editing</option>
                      <option value="pending_approval">Pending approval</option>
                      <option value="rejected">Rejected</option>
                      <option value="completed">Completed</option>
                      <option value="error">Error</option>
                    </select>
                    <button
                      onClick={() => setSortConfig((prev) => ({
                        field: "uploaded_at",
                        direction: prev.direction === "desc" ? "asc" : "desc",
                      }))}
                      className="flex h-9 items-center gap-1 rounded-md border border-gray-200 px-2 text-sm text-gray-600 hover:bg-gray-50"
                    >
                      Date
                      <ChevronDown className={cx("h-4 w-4 transition-transform", sortConfig.direction === "asc" && "rotate-180")} />
                    </button>
                  </div>
                </div>

                <ContractExplorer
                  documents={visibleDocuments}
                  currentUserInfo={currentUserInfo}
                  currentlyProcessing={currentlyProcessing}
                  isLoading={isRefreshing}
                  displayStatusForDoc={displayStatusForDoc}
                  onProcess={handleProcess}
                  onEditRoles={handleOpenReassignModal}
                />

                {pagination.totalItems > 0 && (
                  <div className="flex items-center justify-between border-t border-gray-100 py-3">
                    <p className="text-sm text-gray-500">
                      Showing {visibleDocuments.length} of {pagination.totalItems} contracts
                    </p>
                    <div className="flex items-center gap-2">
                      <Button variant="outline" size="sm" onClick={() => handlePageChange(Math.max(1, pagination.currentPage - 1))} disabled={pagination.currentPage === 1 || isRefreshing}>
                        Previous
                      </Button>
                      <span className="text-sm text-gray-500">
                        Page {pagination.currentPage} of {Math.max(pagination.totalPages, 1)}
                      </span>
                      <Button variant="outline" size="sm" onClick={() => handlePageChange(Math.min(pagination.totalPages, pagination.currentPage + 1))} disabled={pagination.currentPage === pagination.totalPages || isRefreshing}>
                        Next
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </section>
        </main>
      </div>

      {isUploadModalOpen && (
        <FileUploadModal
          isOpen={isUploadModalOpen}
          onClose={() => setIsUploadModalOpen(false)}
          onUploadSuccess={handleUploadSuccess}
          userCredits={userCredits?.page_credits || 0}
          projectId={selectedProjectId}
        />
      )}

      {contractToReassign && selectedAccountId && (
        <RoleReassignmentModal
          isOpen={isReassignModalOpen}
          onClose={() => setIsReassignModalOpen(false)}
          onReassignSuccess={handleReassignSuccess}
          contractId={contractToReassign._id}
          contractName={contractToReassign.contract_name}
          currentEditorId={contractToReassign.editorUserId}
          currentApproverId={contractToReassign.approverUserId}
          accountId={selectedAccountId}
        />
      )}
    </div>
  );
}

function ProjectSwitcher({
  projects,
  selectedProjectId,
  projectSearch,
  isProjectLoading,
  isProjectDialogOpen,
  newProjectName,
  newProjectDescription,
  isCreatingProject,
  onSelectProject,
  onProjectSearchChange,
  onProjectDialogChange,
  onProjectNameChange,
  onProjectDescriptionChange,
  onCreateProject,
}: {
  projects: Project[];
  selectedProjectId: string | null;
  projectSearch: string;
  isProjectLoading: boolean;
  isProjectDialogOpen: boolean;
  newProjectName: string;
  newProjectDescription: string;
  isCreatingProject: boolean;
  onSelectProject: (id: string | null) => void;
  onProjectSearchChange: (value: string) => void;
  onProjectDialogChange: (open: boolean) => void;
  onProjectNameChange: (value: string) => void;
  onProjectDescriptionChange: (value: string) => void;
  onCreateProject: () => void;
}) {
  return (
    <section className="border-b border-gray-200 bg-gray-50/70 px-4 py-3 md:px-10">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex min-w-0 items-center gap-2">
          <FolderOpen className="h-4 w-4 shrink-0 text-gray-700" />
          <span className="font-serif text-2xl font-light text-gray-900">Projects</span>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative sm:w-72">
            <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <Input
              value={projectSearch}
              onChange={(event) => onProjectSearchChange(event.target.value)}
              placeholder="Search projects..."
              className="h-9 border-gray-200 bg-white pl-8 text-sm"
            />
          </div>

          <Dialog open={isProjectDialogOpen} onOpenChange={onProjectDialogChange}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm" className="h-9 gap-2">
                <FolderPlus className="h-4 w-4" />
                New project
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>New Project</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 py-2">
                <div className="space-y-2">
                  <Label htmlFor="project-name">Name</Label>
                  <Input id="project-name" value={newProjectName} onChange={(event) => onProjectNameChange(event.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="project-description">Description</Label>
                  <Input
                    id="project-description"
                    value={newProjectDescription}
                    onChange={(event) => onProjectDescriptionChange(event.target.value)}
                    placeholder="Optional"
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => onProjectDialogChange(false)}>Cancel</Button>
                <Button onClick={onCreateProject} disabled={!newProjectName.trim() || isCreatingProject}>
                  {isCreatingProject && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Create
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="mt-3 overflow-x-auto">
        <div className="flex min-w-max gap-2 pb-1">
          <button
            onClick={() => onSelectProject(null)}
            className={cx(
              "flex h-10 items-center rounded-md border px-3 text-sm transition-colors",
              !selectedProjectId
                ? "border-gray-300 bg-white text-gray-900 shadow-sm"
                : "border-gray-200 bg-white/70 text-gray-600 hover:bg-white hover:text-gray-900",
            )}
          >
            All projects
          </button>

          {isProjectLoading ? (
            [1, 2, 3].map((item) => (
              <div key={item} className="h-10 w-40 rounded-md border border-gray-200 bg-white/80 animate-pulse" />
            ))
          ) : projects.length === 0 ? (
            <div className="flex h-10 items-center rounded-md border border-dashed border-gray-300 bg-white/70 px-3 text-sm text-gray-500">
              No projects found
            </div>
          ) : (
            projects.map((project) => (
              <button
                key={project._id}
                onClick={() => onSelectProject(project._id)}
                title={project.name}
                className={cx(
                  "flex h-10 max-w-[220px] items-center gap-2 rounded-md border px-3 text-left text-sm transition-colors",
                  selectedProjectId === project._id
                    ? "border-gray-300 bg-white text-gray-900 shadow-sm"
                    : "border-gray-200 bg-white/70 text-gray-600 hover:bg-white hover:text-gray-900",
                )}
              >
                <span className="truncate font-medium">{project.name}</span>
                <span className="shrink-0 text-xs text-gray-500">{project.stats?.total_documents || 0}</span>
              </button>
            ))
          )}
        </div>
      </div>
    </section>
  );
}

function ProjectOverview({
  projects,
  onSelectProject,
}: {
  projects: Project[];
  selectedProject?: Project | null;
  onSelectProject: (id: string | null) => void;
}) {
  return (
    <div className="px-4 py-4 md:px-10">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-medium text-gray-900">All projects</h2>
          <p className="text-sm text-gray-500">Select a project to work with its contracts and workflow roles.</p>
        </div>
      </div>
      <div className="overflow-x-auto">
        <div className="min-w-[760px]">
          <div className="flex h-8 items-center border-b border-gray-200 text-xs font-medium text-gray-500">
            <div className="w-[320px] shrink-0 pl-2">Name</div>
            <div className="w-24 shrink-0">Contracts</div>
            <div className="w-28 shrink-0">Processing</div>
            <div className="w-32 shrink-0">Pending</div>
            <div className="w-28 shrink-0">Completed</div>
            <div className="w-32 shrink-0">Updated</div>
          </div>
          {projects.length === 0 ? (
            <div className="flex h-32 items-center justify-center text-sm text-gray-500">No projects yet.</div>
          ) : (
            projects.map((project) => (
              <button
                key={project._id}
                onClick={() => onSelectProject(project._id)}
                className="flex h-12 w-full items-center border-b border-gray-50 text-left text-sm transition-colors hover:bg-gray-50"
              >
                <div className="flex w-[320px] shrink-0 items-center gap-2 pl-2">
                  <FolderOpen className="h-4 w-4 text-gray-500" />
                  <span className="truncate font-medium text-gray-800">{project.name}</span>
                </div>
                <div className="w-24 shrink-0 text-gray-600">{project.stats?.total_documents || 0}</div>
                <div className="w-28 shrink-0 text-gray-600">{project.stats?.processing_count || 0}</div>
                <div className="w-32 shrink-0 text-gray-600">{project.stats?.pending_approval_count || 0}</div>
                <div className="w-28 shrink-0 text-gray-600">{project.stats?.completed_count || 0}</div>
                <div className="w-32 shrink-0 text-gray-500">{formatDate(project.updatedAt)}</div>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function ProjectAssistantWorkspace({
  documents,
  agentDocuments,
  selectedAgentDocument,
  preview,
  isAgentDocumentsLoading,
  isPreviewLoading,
  onOpenAgentDocument,
  onDownloadPreview,
  chat,
}: {
  documents: DocumentWithProgress[];
  agentDocuments: AgentDocumentSummary[];
  selectedAgentDocument: { documentId: string; versionId: string } | null;
  preview: AgentDocumentPreview | null;
  isAgentDocumentsLoading: boolean;
  isPreviewLoading: boolean;
  onOpenAgentDocument: (documentId: string, versionId?: string) => void | Promise<void>;
  onDownloadPreview: () => void | Promise<void>;
  chat: ReactNode;
}) {
  return (
    <div className="grid h-[calc(100dvh-9.5rem)] min-h-0 grid-cols-1 overflow-hidden bg-white xl:grid-cols-[260px_minmax(0,1fr)_420px]">
      <aside className="hidden min-h-0 min-w-0 border-r border-gray-200 bg-gray-50/60 xl:flex xl:flex-col">
        <div className="flex h-12 items-center justify-between border-b border-gray-200 px-4">
          <div className="text-sm font-semibold text-gray-900">Explorer</div>
          {isAgentDocumentsLoading ? <Loader2 className="h-4 w-4 animate-spin text-gray-400" /> : null}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          <div className="mb-5">
            <div className="mb-2 flex items-center gap-2 px-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
              <FolderOpen className="h-3.5 w-3.5" />
              Project Documents
            </div>
            {documents.length === 0 ? (
              <div className="rounded-md border border-dashed border-gray-200 bg-white px-3 py-4 text-xs text-gray-500">
                No contracts uploaded yet.
              </div>
            ) : (
              <div className="space-y-1">
                {documents.map((document) => (
                  <Link
                    key={document._id}
                    href={`/contracts/${document._id}`}
                    className="flex min-w-0 items-center gap-2 rounded-md px-2 py-2 text-sm text-gray-700 hover:bg-white hover:text-gray-950"
                    title={document.contract_name}
                  >
                    <FileText className="h-4 w-4 shrink-0 text-rose-500" />
                    <span className="truncate">{document.contract_name}</span>
                  </Link>
                ))}
              </div>
            )}
          </div>

          <div>
            <div className="mb-2 flex items-center gap-2 px-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
              <FileText className="h-3.5 w-3.5" />
              Generated DOCX
            </div>
            {agentDocuments.length === 0 ? (
              <div className="rounded-md border border-dashed border-gray-200 bg-white px-3 py-4 text-xs leading-5 text-gray-500">
                Ask the assistant to create a checklist, template, amendment, memo, or copies.
              </div>
            ) : (
              <div className="space-y-1">
                {agentDocuments.map((document) => {
                  const versionId = document.current_version_id || document.versions?.[0]?.version_id;
                  const isSelected = selectedAgentDocument?.documentId === document.document_id;
                  return (
                    <button
                      key={document.document_id}
                      type="button"
                      onClick={() => versionId && onOpenAgentDocument(document.document_id, versionId)}
                      className={cx(
                        "flex w-full min-w-0 items-start gap-2 rounded-md px-2 py-2 text-left text-sm transition-colors",
                        isSelected ? "bg-white text-gray-950 shadow-sm ring-1 ring-gray-200" : "text-gray-700 hover:bg-white hover:text-gray-950",
                      )}
                      title={document.filename}
                    >
                      <FileText className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{document.title || document.filename}</span>
                        <span className="mt-0.5 block text-xs text-gray-500">
                          V{document.current_version_number || 1}
                          {document.versions?.length ? ` · ${document.versions.length} version${document.versions.length === 1 ? "" : "s"}` : ""}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </aside>

      <section className="hidden min-h-0 min-w-0 flex-col border-r border-gray-200 bg-gray-100 xl:flex">
        <div className="flex h-12 shrink-0 items-center justify-between border-b border-gray-200 bg-white px-4">
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-gray-900">
              {preview?.filename || "Generated document preview"}
            </div>
            {preview?.version_number ? (
              <div className="text-xs text-gray-500">Version {preview.version_number}</div>
            ) : null}
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 gap-1.5"
            disabled={!preview || isPreviewLoading}
            onClick={onDownloadPreview}
          >
            <Download className="h-4 w-4" />
            Download
          </Button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto overscroll-contain px-5 py-6">
          {isPreviewLoading ? (
            <div className="flex h-full items-center justify-center text-sm text-gray-500">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Opening document...
            </div>
          ) : preview ? (
            <div
              className="mx-auto min-h-[960px] max-w-[816px] bg-white px-14 py-12 text-[15px] leading-7 text-gray-950 shadow-sm ring-1 ring-gray-200"
              style={{ fontFamily: `"Times New Roman", Times, serif` }}
            >
              <h1 className="mb-7 text-center text-lg font-bold uppercase leading-7">
                {(preview.title || preview.filename || "Generated Document").replace(/\.docx$/i, "")}
              </h1>
              <div className="docx-preview-markdown">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={{
                    h1: ({ children }) => <h1 className="mb-5 mt-7 text-center text-lg font-bold uppercase">{children}</h1>,
                    h2: ({ children }) => <h2 className="mb-3 mt-6 text-base font-bold">{children}</h2>,
                    h3: ({ children }) => <h3 className="mb-2 mt-5 text-[15px] font-bold">{children}</h3>,
                    p: ({ children }) => <p className="mb-3 text-justify">{children}</p>,
                    ul: ({ children }) => <ul className="mb-4 list-disc space-y-1 pl-6">{children}</ul>,
                    ol: ({ children }) => <ol className="mb-4 list-decimal space-y-1 pl-6">{children}</ol>,
                    li: ({ children }) => <li className="pl-1">{children}</li>,
                    table: ({ children }) => (
                      <div className="my-4 overflow-x-auto">
                        <table className="w-full border-collapse text-left text-[13px] leading-5">{children}</table>
                      </div>
                    ),
                    th: ({ children }) => <th className="border border-gray-400 bg-gray-100 px-2 py-1.5 font-bold">{children}</th>,
                    td: ({ children }) => <td className="border border-gray-300 px-2 py-1.5 align-top">{children}</td>,
                    blockquote: ({ children }) => (
                      <blockquote className="my-4 border-l-2 border-gray-300 pl-4 italic text-gray-700">{children}</blockquote>
                    ),
                  }}
                >
                  {preview.body_text || ""}
                </ReactMarkdown>
              </div>
            </div>
          ) : (
            <div className="flex h-full flex-col items-center justify-center text-center text-sm text-gray-500">
              <FileText className="mb-3 h-10 w-10 text-gray-300" />
              <p className="font-medium text-gray-700">Generated DOCX files open here.</p>
              <p className="mt-1 max-w-sm">
                Ask for a checklist, template, amended copy, or document copies, then open it from the explorer.
              </p>
            </div>
          )}
        </div>
      </section>

      <section className="min-h-0 min-w-0 overflow-hidden">{chat}</section>
    </div>
  );
}

function formatKpiType(value?: string) {
  if (!value) return "Obligation";
  return value.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function isProjectKpiTracked(kpi?: ContractKPI | null) {
  const trackingStatus = String(kpi?.tracking_status || "").toLowerCase();
  return Boolean(kpi?.is_tracked || trackingStatus === "tracked" || trackingStatus === "active");
}

function isProjectKpiRecommended(kpi?: ContractKPI | null) {
  const trackingStatus = String(kpi?.tracking_status || "").toLowerCase();
  return Boolean(kpi?.is_recommended || trackingStatus === "recommended");
}

function formatKpiValue(kpi: ContractKPI) {
  const bits = [
    kpi.operator && kpi.operator !== "specified" ? kpi.operator.replace(/_/g, " ") : null,
    kpi.value_min != null || kpi.value_max != null
      ? `${kpi.value_min ?? "?"}${kpi.value_max != null ? ` - ${kpi.value_max}` : ""}`
      : kpi.value,
    kpi.unit && kpi.unit !== "number" ? kpi.unit : null,
  ].filter((item) => item !== null && item !== undefined && `${item}`.trim() !== "");
  return bits.length ? bits.join(" ") : "Structured value pending review";
}

function formatKpiConsequence(kpi: ContractKPI) {
  const bits = [
    kpi.consequence_value != null ? String(kpi.consequence_value) : null,
    kpi.consequence_unit || null,
  ].filter((item) => item !== null && item !== undefined && `${item}`.trim() !== "");
  return bits.length ? bits.join(" ") : "None";
}

function ProjectKPIWorkspace({
  kpis,
  documents,
  selectedContractId,
  isLoading,
  isExtracting,
  onSelectedContractChange,
  onExtract,
  onRefresh,
  onStatusChange,
  onAcceptAll,
  onTrackRecommended,
  onTrackKpi,
}: {
  kpis: ContractKPI[];
  documents: DocumentWithProgress[];
  selectedContractId: string;
  isLoading: boolean;
  isExtracting: boolean;
  onSelectedContractChange: (contractId: string) => void;
  onExtract: () => void | Promise<void>;
  onRefresh: () => void | Promise<void>;
  onStatusChange: (kpi: ContractKPI, status: "approved" | "ignored" | "draft") => void | Promise<void>;
  onAcceptAll: () => void | Promise<void>;
  onTrackRecommended: () => void | Promise<void>;
  onTrackKpi: (kpi: ContractKPI) => void | Promise<void>;
}) {
  const approvedCount = kpis.filter((kpi) => kpi.status === "approved").length;
  const reviewCount = kpis.filter((kpi) => kpi.status !== "approved" && kpi.status !== "ignored").length;
  const acceptAllCount = kpis.filter((kpi) => kpi.status !== "approved" && kpi.status !== "ignored").length;
  const recommendedTrackCount = kpis.filter((kpi) => isProjectKpiRecommended(kpi) && !isProjectKpiTracked(kpi) && kpi.status !== "ignored").length;
  const trackedCount = kpis.filter((kpi) => isProjectKpiTracked(kpi)).length;
  const indexedDocuments = documents.filter((document) => document.index?.status === "success" || document.status === "Indexed");
  const indexedCount = indexedDocuments.length;
  const selectedDocument = indexedDocuments.find((document) => document._id === selectedContractId) || null;

  return (
    <div className="px-4 py-4 md:px-10">
      <div className="mb-4 flex flex-col gap-3 border-b border-gray-200 pb-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-gray-700" />
            <h2 className="text-sm font-semibold text-gray-950">KPI Register</h2>
          </div>
          <p className="mt-1 max-w-2xl text-sm text-gray-500">
            Reviewable obligations extracted from ingested contract clauses. Tracked rows become the operational source for monitoring and breach checks.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={selectedContractId}
            onChange={(event) => onSelectedContractChange(event.target.value)}
            className="h-8 max-w-[320px] rounded-md border border-gray-200 bg-white px-2 text-xs text-gray-700 outline-none focus:border-gray-400"
            aria-label="Select contract for KPI extraction"
            disabled={isExtracting || indexedCount === 0}
          >
            {indexedCount === 0 ? (
              <option value="">No ingested contracts</option>
            ) : (
              indexedDocuments.map((document) => (
                <option key={document._id} value={document._id}>
                  {document.contract_name}
                </option>
              ))
            )}
          </select>
          <span className="rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 text-xs text-gray-600">
            {reviewCount} to review
          </span>
          <span className="rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 text-xs text-gray-600">
            {approvedCount} approved
          </span>
          <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs text-emerald-700">
            {trackedCount} tracked
          </span>
          <Button type="button" variant="outline" size="sm" className="h-8 gap-1.5" onClick={onAcceptAll} disabled={isLoading || isExtracting || acceptAllCount === 0}>
            <CheckCircle2 className="h-3.5 w-3.5" />
            Accept All KPIs
          </Button>
          <Button type="button" variant="outline" size="sm" className="h-8 gap-1.5" onClick={onTrackRecommended} disabled={isLoading || isExtracting || recommendedTrackCount === 0}>
            <Play className="h-3.5 w-3.5" />
            Track Recommended
          </Button>
          <Button type="button" variant="outline" size="sm" className="h-8 gap-1.5" onClick={onRefresh} disabled={isLoading || isExtracting}>
            <RefreshCw className={cx("h-3.5 w-3.5", isLoading && "animate-spin")} />
            Refresh
          </Button>
          <Button type="button" size="sm" className="h-8 gap-1.5 bg-gray-900 text-white hover:bg-gray-800" onClick={onExtract} disabled={isExtracting || !selectedContractId}>
            {isExtracting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
            Extract selected contract
          </Button>
        </div>
      </div>
      {selectedDocument && (
        <div className="mb-4 rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-xs leading-5 text-gray-600">
          KPI extraction is intentionally one contract at a time. Selected: <span className="font-medium text-gray-900">{selectedDocument.contract_name}</span>.
        </div>
      )}

      {isLoading && kpis.length === 0 ? (
        <div className="space-y-2">
          {[1, 2, 3].map((item) => <div key={item} className="h-16 rounded-md bg-gray-100 animate-pulse" />)}
        </div>
      ) : kpis.length === 0 ? (
        <div className="flex h-72 flex-col items-center justify-center rounded-md border border-dashed border-gray-200 text-center">
          <BarChart3 className="h-10 w-10 text-gray-300" />
          <p className="mt-3 text-sm font-medium text-gray-800">No KPI register yet</p>
          <p className="mt-1 max-w-md text-sm text-gray-500">
            Select one ingested contract and extract its KPI register for payments, SLAs, milestones, penalties, notices, and deadlines.
          </p>
          <Button type="button" className="mt-4 h-8 gap-1.5 bg-gray-900 text-white hover:bg-gray-800" onClick={onExtract} disabled={isExtracting || !selectedContractId}>
            {isExtracting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
            Extract selected contract
          </Button>
        </div>
      ) : (
        <div className="divide-y divide-gray-100 border-y border-gray-200">
          {kpis.map((kpi) => {
            const tracked = isProjectKpiTracked(kpi);
            const recommended = isProjectKpiRecommended(kpi);
            return (
              <div key={kpi.kpi_id} className="grid gap-3 py-3 text-sm lg:grid-cols-[minmax(220px,1.4fr)_110px_140px_120px_120px_minmax(190px,1fr)_190px] lg:items-start">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate font-medium text-gray-950">{kpi.name}</span>
                    {tracked ? (
                      <span className="rounded-full border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[11px] font-medium text-emerald-700">
                        Tracked
                      </span>
                    ) : recommended ? (
                      <span className="rounded-full border border-blue-200 bg-blue-50 px-1.5 py-0.5 text-[11px] font-medium text-blue-700">
                        Recommended
                      </span>
                    ) : null}
                    {kpi.needs_review ? (
                      <span className="rounded-full border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-700">
                        Review
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-1 truncate text-xs text-gray-500">
                    {kpi.kpi_id} · {kpi.section || kpi.section_path || kpi.structural_path || kpi.contract_name || truncateMiddle(kpi.contract_id, 18)}
                  </div>
                </div>
                <div>
                  <span className="inline-flex rounded-full border border-gray-200 bg-gray-50 px-2 py-1 text-xs font-medium text-gray-700">
                    {formatKpiType(kpi.kpi_type)}
                  </span>
                </div>
                <div className="text-gray-700">
                  <div className="font-medium">{formatKpiValue(kpi)}</div>
                </div>
                <div className="font-medium text-red-600">{formatKpiConsequence(kpi)}</div>
                <div className="truncate text-gray-700">{kpi.party || "—"}</div>
                <div className="min-w-0 text-xs leading-5 text-gray-700">
                  <p className="line-clamp-2">{kpi.remediation || "Not defined"}</p>
                  {kpi.remediation_sla ? <p className="mt-0.5 font-semibold uppercase text-gray-400">SLA: {kpi.remediation_sla}</p> : null}
                </div>
                <div className="flex flex-wrap items-center justify-start gap-1.5 lg:justify-end">
                  {!tracked && kpi.status !== "ignored" ? (
                    <Button type="button" variant="outline" size="sm" className="h-7 gap-1 px-2 text-xs text-emerald-700" onClick={() => onTrackKpi(kpi)}>
                      <Play className="h-3 w-3" />
                      Track KPI
                    </Button>
                  ) : null}
                  {kpi.status === "approved" ? (
                    <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700">
                      <CheckCircle2 className="h-3 w-3" />
                      Approved
                    </span>
                  ) : kpi.status === "ignored" ? (
                    <span className="rounded-full border border-gray-200 bg-gray-50 px-2 py-1 text-xs font-medium text-gray-500">
                      Ignored
                    </span>
                  ) : (
                    <>
                      <Button type="button" variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={() => onStatusChange(kpi, "approved")}>
                        Approve
                      </Button>
                      <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs text-gray-500" onClick={() => onStatusChange(kpi, "ignored")}>
                        Ignore
                      </Button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

const ContractExplorer = memo(function ContractExplorer({
  documents,
  currentUserInfo,
  currentlyProcessing,
  isLoading,
  displayStatusForDoc,
  onProcess,
  onEditRoles,
}: {
  documents: DocumentWithProgress[];
  currentUserInfo: UserInDB | null;
  currentlyProcessing: string | null;
  isLoading: boolean;
  displayStatusForDoc: (doc: Document) => string;
  onProcess: (contractId: string) => void;
  onEditRoles: (doc: Document) => void;
}) {
  if (isLoading && documents.length === 0) {
    return (
      <div className="py-3">
        {[1, 2, 3].map((item) => (
          <div key={item} className="mb-2 h-12 rounded-md bg-gray-100 animate-pulse" />
        ))}
      </div>
    );
  }

  if (documents.length === 0) {
    return (
      <div className="flex h-64 flex-col items-center justify-center text-center">
        <FileText className="h-10 w-10 text-gray-300" />
        <p className="mt-3 text-sm font-medium text-gray-700">No contracts found</p>
        <p className="mt-1 text-sm text-gray-500">Upload a contract or adjust the current filters.</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[980px]">
        <div className="flex h-8 items-center border-b border-gray-200 text-xs font-medium text-gray-500">
          <div className="w-[340px] shrink-0 pl-2">Name</div>
          <div className="w-44 shrink-0">Status</div>
          <div className="w-64 shrink-0">Roles</div>
          <div className="w-20 shrink-0">Pages</div>
          <div className="w-32 shrink-0">Uploaded</div>
          <div className="ml-auto w-48 shrink-0 pr-2 text-right">Actions</div>
        </div>
        {documents.map((doc) => {
          const displayStatus = displayStatusForDoc(doc);
          const currentUserId = currentUserInfo?._id;
          const isUploader = currentUserId === doc.uploaded_by;
          const isEditor = currentUserId === doc.workflowRoles?.editorUserId;
          const isApprover = currentUserId === doc.workflowRoles?.approverUserId;
          const isAccountOwner = !!(
            currentUserInfo?.ownedAccountId &&
            doc.ownerType === "team" &&
            doc.ownerId === currentUserInfo.ownedAccountId
          );
          const canEditRoles = doc.ownerType === "team" && (isUploader || isAccountOwner);
          const isActive = doc.isProcessing || currentlyProcessing === doc._id;
          const canProcess = doc.status === "Uploaded" || doc.status === "error" || doc.error;

          return (
            <div key={doc._id} className="group flex min-h-14 items-center border-b border-gray-50 text-sm transition-colors hover:bg-gray-50">
              <div className="flex w-[340px] shrink-0 items-center gap-2 pl-2 pr-4">
                <FileText className="h-4 w-4 shrink-0 text-gray-500" />
                <div className="min-w-0">
                  <Link href={`/contracts/${doc._id}`} className="block truncate font-medium text-gray-900 hover:text-sky-700">
                    {truncateMiddle(doc.contract_name)}
                  </Link>
                  <div className="truncate text-xs text-gray-500">
                    Uploaded by {doc.uploader_name || truncateMiddle(doc.uploaded_by, 12)}
                  </div>
                </div>
              </div>
              <div className="w-44 shrink-0">
                {isActive ? (
                  <ProcessingPill doc={doc} />
                ) : (
                  <span className={cx("inline-flex items-center rounded-full border px-2 py-1 text-xs font-medium", statusClass(displayStatus))}>
                    {displayStatus}
                  </span>
                )}
              </div>
              <div className="flex w-64 shrink-0 flex-wrap gap-1 pr-4">
                {isUploader && <RolePill label="Uploader" />}
                {isEditor && <RolePill label="Editor" />}
                {isApprover && <RolePill label="Approver" />}
                {!isUploader && !isEditor && !isApprover && doc.ownerType === "team" && (
                  <span className="text-xs text-gray-400">Team contract</span>
                )}
                {doc.ownerType === "user" && <span className="text-xs text-gray-400">Personal</span>}
              </div>
              <div className="w-20 shrink-0 text-gray-600">{doc.page_count || 0}</div>
              <div className="w-32 shrink-0 text-gray-500">{formatDate(doc.uploaded_at)}</div>
              <div className="ml-auto flex w-48 shrink-0 justify-end gap-2 pr-2">
                {canEditRoles && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 px-2 text-xs"
                    onFocus={preloadRoleReassignmentModal}
                    onClick={() => onEditRoles(doc)}
                    onMouseEnter={preloadRoleReassignmentModal}
                  >
                    Roles
                  </Button>
                )}
                {canProcess ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 gap-1 px-2 text-xs"
                    onClick={() => onProcess(doc._id)}
                    disabled={!!currentlyProcessing}
                  >
                    {doc.error ? <RefreshCw className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                    {doc.error ? "Retry" : "Process"}
                  </Button>
                ) : (
                  <Button asChild variant="outline" size="sm" className="h-8 px-2 text-xs">
                    <Link href={`/contracts/${doc._id}`}>View</Link>
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
});

function RolePill({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center rounded-full border border-gray-200 bg-white px-2 py-0.5 text-[11px] font-medium text-gray-600">
      {label}
    </span>
  );
}
