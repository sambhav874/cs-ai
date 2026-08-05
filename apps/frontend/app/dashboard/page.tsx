"use client";

import { Suspense, memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { CreditCard, FileUp, Filter, Info, LayoutGrid, List, Loader2, Play, RefreshCw, Settings, Search, X, CheckCircle, Clock, FileText, Bot, Building2, User, ChevronDown, ChevronRight, BarChart3, BookOpen, CheckCircle2, Download, FolderOpen, FolderPlus, Table2, Plus, AlertCircle, UploadCloud } from "lucide-react";
import { useBreadcrumbs } from "@/app/context/BreadcrumbContext";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
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
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
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

import type {
  WorkflowRoles, Document, DocumentWithProgress, UserCredits, UserInDB,
  JobStatusResponse, ContractStatusResponse, ProjectStats, Project,
  AgentArtifact, AgentDocumentSummary, AgentDocumentPreview, ContractKPI,
  ProjectKpiPortfolio, AIProvider, ProjectTab, ContractView
} from "@/components/dashboard/types";
import {
  emptyStats, cx, formatDate, isProjectKpiRecommended, isProjectKpiTracked, truncateMiddle, isActiveJobStatus,
  completedStatusForJob, getProcessingLabel, statusClass
} from "@/components/dashboard/utils";
import { ContractExplorer } from "@/components/dashboard/ContractExplorer";
import { ProjectOverview } from "@/components/dashboard/ProjectOverview";
import { ProjectAssistantWorkspace } from "@/components/dashboard/ProjectAssistantWorkspace";
import { ProjectKPIWorkspace } from "@/components/dashboard/ProjectKPIWorkspace";
import ProjectDashboard from "@/components/dashboard/ProjectDashboard";

const PROJECT_SELECTION_KEY = "dashboardSelectedProject";

export default function Dashboard() {
  return (
    <Suspense fallback={<LoadingScreen />}>
      <DashboardContent />
    </Suspense>
  );
}

function DashboardContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedProjectId = searchParams.get("project_id");
  const requestedTab = searchParams.get("tab");
  const requestedUpload = searchParams.get("upload") === "1";
  const requestedSessionId = searchParams.get("session_id");
  const requestedView = searchParams.get("view");
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
  const [projectPortfolio, setProjectPortfolio] = useState<ProjectKpiPortfolio | null>(null);
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
  const { setBreadcrumbs } = useBreadcrumbs();
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
  const paginationRef = useRef(pagination);

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
    if ((requestedTab === "dashboard" || requestedTab === "contracts" || requestedTab === "assistant" || requestedTab === "reviews" || requestedTab === "playbooks" || requestedTab === "kpis") && requestedProjectId) {
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

  useEffect(() => {
    if (requestedView === "all") {
      setSelectedProjectIdState(null);
      if (typeof window !== "undefined") {
        localStorage.removeItem(`${PROJECT_SELECTION_KEY}_${selectedAccountId}`);
      }
    }
  }, [requestedView, selectedAccountId]);

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
        if (requestedView === "all") return null;
        const stored = typeof window !== "undefined"
          ? localStorage.getItem(`${PROJECT_SELECTION_KEY}_${selectedAccountId}`)
          : null;
        const preferred = current || requestedProjectId || stored;
        if (preferred && loadedProjects.some((project) => project._id === preferred)) {
          return preferred;
        }
        return null;
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
  }, [isAuthenticated, accountInitialized, apiUrl, selectedAccountId, requestedProjectId, requestedView, authenticatedFetch, handleApiError]);

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

  useEffect(() => {
    paginationRef.current = pagination;
  }, [pagination]);

  const fetchDocuments = useCallback(async (
    page = paginationRef.current.currentPage,
    perPage = paginationRef.current.itemsPerPage,
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
      setCurrentlyProcessing((current) => {
        if (!activeProcessId && current) return null;
        if (activeProcessId && !current) return activeProcessId;
        return current;
      });

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
    contractSearch,
    statusFilter,
    sortConfig,
    authenticatedFetch,
    apiUrl,
    handleApiError,
    fetchContractStatus,
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

  const fetchProjectPortfolio = useCallback(async () => {
    if (!apiUrl || !token || !selectedProjectId) {
      setProjectPortfolio(null);
      return null;
    }
    try {
      const response = await apiFetch(`${apiUrl}/projects/${selectedProjectId}/kpis/portfolio`);
      if (!response.ok) throw new Error("Could not load project dashboard data.");
      const payload = await response.json() as ProjectKpiPortfolio;
      setProjectPortfolio(payload);
      return payload;
    } catch (error) {
      console.error("Failed to fetch project dashboard data:", error);
      setProjectPortfolio(null);
      return null;
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
      await fetchProjectPortfolio();
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
  }, [apiUrl, token, selectedProjectId, selectedKpiContractId, fetchProjectKpis, fetchProjectPortfolio]);

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
    await fetchProjectPortfolio();
    toast({
      title: "All KPI candidates accepted",
      description: `${candidates.length} KPI${candidates.length === 1 ? "" : "s"} approved for this project.`,
    });
  }, [projectKpis, updateProjectKpi, fetchProjectKpis, fetchProjectPortfolio]);

  const trackRecommendedProjectKpis = useCallback(async () => {
    const candidates = projectKpis.filter((kpi) => isProjectKpiRecommended(kpi) && !isProjectKpiTracked(kpi) && kpi.status !== "ignored");
    if (!candidates.length) return;
    await Promise.all(candidates.map((kpi) => updateProjectKpi(kpi, {
      status: "approved",
      tracking_status: "tracked",
      is_tracked: true,
    })));
    await fetchProjectKpis();
    await fetchProjectPortfolio();
    toast({
      title: "Recommended KPIs tracked",
      description: `${candidates.length} KPI${candidates.length === 1 ? "" : "s"} will now be monitored for breaches.`,
    });
  }, [projectKpis, updateProjectKpi, fetchProjectKpis, fetchProjectPortfolio]);

  const trackProjectKpi = useCallback(async (kpi: ContractKPI) => {
    await updateProjectKpi(kpi, {
      status: "approved",
      tracking_status: "tracked",
      is_tracked: true,
    });
    await fetchProjectPortfolio();
    toast({
      title: "KPI tracking enabled",
      description: `${kpi.name} will now participate in breach checks.`,
    });
  }, [updateProjectKpi, fetchProjectPortfolio]);

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
            void fetchProjectPortfolio();
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
    fetchProjectPortfolio,
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
      fetchProjectPortfolio(),
    ];
    if (projectTab === "kpis") refreshes.push(fetchProjectKpis());
    await Promise.all(refreshes);
  }, [fetchProjects, fetchDocuments, fetchUserCredits, fetchProjectKpis, fetchProjectPortfolio, projectTab, pagination.currentPage]);

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
    void fetchProjectPortfolio();
  }, [fetchProjects, fetchDocuments, fetchUserCredits, fetchProjectPortfolio]);

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
      setProjectPortfolio(null);
      setProjectPlaybooks([]);
      setSelectedKpiContractId("");
      return;
    }
    setProjectStats({ ...emptyStats, ...(selectedProject?.stats || {}) });
    fetchDocuments(1);
  }, [selectedProjectId, selectedProject, contractSearch, statusFilter, sortConfig, fetchDocuments]);

  // Set breadcrumbs globally
  useEffect(() => {
    if (!selectedProjectId) {
      setBreadcrumbs([{ label: "Projects" }]);
    } else {
      setBreadcrumbs([
        { label: "Projects", href: "/dashboard?view=all" },
        { label: selectedProject?.name || "Project" },
      ]);
    }
  }, [selectedProjectId, selectedProject, setBreadcrumbs]);

  useEffect(() => {
    if (!selectedProjectId || projectTab !== "assistant") return;
    void fetchProjectAgentDocuments();
  }, [projectTab, selectedProjectId, fetchProjectAgentDocuments]);

  useEffect(() => {
    if (!selectedProjectId || projectTab !== "kpis") return;
    void fetchProjectKpis();
  }, [projectTab, selectedProjectId, fetchProjectKpis]);

  useEffect(() => {
    if (!selectedProjectId || projectTab !== "dashboard") return;
    void Promise.all([fetchProjectPortfolio(), fetchProjectKpis()]);
  }, [projectTab, selectedProjectId, fetchProjectPortfolio, fetchProjectKpis]);

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

  const displayStatusForDoc = useCallback((doc: DocumentWithProgress) => {
    const rawStatus = doc.status || "Unknown";
    if (doc.error || rawStatus === "Error" || rawStatus === "failed" || doc.index?.status === "blocked" || doc.index?.error) {
      return "Error";
    }
    if (
      rawStatus === "Indexing" ||
      rawStatus === "Summarizing" ||
      rawStatus === "Processing" ||
      rawStatus === "Uploaded" ||
      rawStatus === "Queued" ||
      rawStatus === "queued" ||
      rawStatus === "pending" ||
      doc.isProcessing
    ) {
      return "Processing";
    }
    return "Ingested";
  }, []);

  if (isInitialLoading) {
    return <LoadingScreen />;
  }

  return (
    <div className="min-h-screen bg-background font-InterVar text-foreground">
      <div className="min-h-screen pt-20 md:pt-0">
        <main className="flex min-w-0 flex-col">
          {creditError && (
            <div className="px-6 md:px-8 py-2">
              <button onClick={fetchUserCredits} className="text-xs text-red-600 hover:text-red-700">
                Credit load failed. Retry.
              </button>
            </div>
          )}

          {selectedProjectId && (
            <>
              <div className="px-6 md:px-8 pt-5 pb-2">
                <div className="flex items-center gap-2.5">
                  <FolderOpen className="h-5 w-5 text-muted-foreground/70" />
                  <h1 className="text-2xl font-bold text-foreground tracking-tight">{selectedProject?.name || "Project"}</h1>
                  {selectedProject && (
                    <span className="ml-2 inline-flex items-center rounded-full border border-border bg-muted/30 px-2.5 py-0.5 text-xs font-semibold text-muted-foreground">
                      {selectedProject.ownerType === "team" ? "Team Project" : "Personal Project"}
                    </span>
                  )}
                </div>
                {selectedProject?.description && (
                  <p className="mt-1 text-sm text-muted-foreground pl-[30px]">{selectedProject.description}</p>
                )}
              </div>
              <div className="flex h-10 items-center border-b border-border px-6 md:px-8">
                <div className="flex flex-1 items-center gap-5 h-full">
                {[
                  { id: "dashboard", label: "Dashboard" },
                  { id: "contracts", label: "Contracts" },
                  { id: "kpis", label: "KPIs" },
                  { id: "reviews", label: "Reviews" },
                  { id: "playbooks", label: "Playbooks" },
                  { id: "assistant", label: "Assistant" },
                ].map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => {
                      if (tab.id === "reviews") {
                        router.push(`/tabular-reviews?project_id=${encodeURIComponent(selectedProject?._id || selectedProjectId || "")}`);
                      } else {
                        setProjectTab(tab.id as ProjectTab);
                      }
                    }}
                    className={cx(
                      "text-xs transition-colors h-full px-1 border-b-2",
                      projectTab === tab.id ? "font-bold text-foreground border-[#015CA9]" : "border-transparent text-muted-foreground hover:text-foreground/80 hover:border-border",
                    )}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
              {selectedProject && (
                <span className="text-xs text-muted-foreground">Updated {formatDate(selectedProject.updatedAt)}</span>
              )}
              </div>
            </>
          )}

          <section className={cx("min-h-0 flex-1 bg-background", projectTab === "assistant" ? "overflow-hidden" : "overflow-y-auto")}>
            {!selectedProjectId ? (
              <ProjectOverview
                projects={filteredProjects}
                selectedProject={selectedProject}
                onSelectProject={setSelectedProjectId}
                projectSearch={projectSearch}
                isProjectLoading={isProjectLoading}
                isProjectDialogOpen={isProjectDialogOpen}
                newProjectName={newProjectName}
                newProjectDescription={newProjectDescription}
                isCreatingProject={isCreatingProject}
                onProjectSearchChange={setProjectSearch}
                onProjectDialogChange={setIsProjectDialogOpen}
                onProjectNameChange={setNewProjectName}
                onProjectDescriptionChange={setNewProjectDescription}
                onCreateProject={handleCreateProject}
                onRefresh={handleManualRefresh}
                isRefreshing={isRefreshing || isCreditLoading}
                useLocalMarker={useLocalMarker}
                onToggleLocalMarker={handleToggleLocalMarker}
              />
            ) : projectTab === "dashboard" && selectedProject ? (
              <div className="p-6 md:p-8">
                <ProjectDashboard 
                  portfolio={projectPortfolio} 
                  kpis={projectKpis} 
                  isEmpty={(selectedProject?.stats?.total_documents ?? 0) === 0} 
                />
              </div>
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
              <div className="p-6 md:p-8">
                <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h2 className="text-3xl font-bold text-foreground">Playbooks</h2>
                    <p className="mt-1 text-sm text-muted-foreground">Project rule sets for clause review, fallback positions, and redline-style guidance.</p>
                  </div>
                  <Button asChild className="rounded-lg bg-cs-primary text-white hover:bg-cs-primary/90">
                    <Link href={`/playbooks?project_id=${encodeURIComponent(selectedProject?._id || selectedProjectId || "")}`}>
                      <Plus className="h-4 w-4" />
                      New Playbook
                    </Link>
                  </Button>
                </div>

                {isProjectPlaybooksLoading ? (
                  <div className="flex min-h-[320px] items-center justify-center rounded-lg border border-border bg-muted/50 text-sm text-muted-foreground">
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Loading playbooks...
                  </div>
                ) : projectPlaybooks.length ? (
                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                    {projectPlaybooks.map((playbook) => (
                      <Link
                        key={playbook.id}
                        href={`/playbooks/${playbook.id}`}
                        className="flex min-h-40 flex-col rounded-lg border border-border bg-background p-4 transition-colors hover:border-gray-300 hover:bg-muted/50"
                      >
                        <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg border border-border bg-muted/50 text-foreground/70">
                          <BookOpen className="h-5 w-5" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <h3 className="truncate text-sm font-semibold text-foreground">{playbook.title}</h3>
                          <p className="mt-1 line-clamp-2 text-sm leading-6 text-muted-foreground">
                            {playbook.description || playbook.reference_document_name || playbook.contract_type || "Playbook"}
                          </p>
                        </div>
                        <div className="mt-4 flex items-center justify-between border-t border-border/50 pt-3 text-xs text-muted-foreground">
                          <span>Playbook · {playbook.rule_count} rules</span>
                          <span>{playbook.visibility === "project" ? "Project" : "Private"}</span>
                        </div>
                      </Link>
                    ))}
                  </div>
                ) : (
                  <div className="flex min-h-[360px] flex-col items-start justify-center rounded-lg border border-border bg-muted/50 px-6 py-10">
                    <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-lg border border-border bg-background text-foreground/70">
                      <BookOpen className="h-5 w-5" />
                    </div>
                    <h2 className="text-3xl font-bold text-foreground">No playbooks yet</h2>
                    <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
                      Create a reusable rule set from a reference document or template.
                    </p>
                    <Button asChild className="mt-5 rounded-lg bg-cs-primary text-white hover:bg-cs-primary/90">
                      <Link href={`/playbooks?project_id=${encodeURIComponent(selectedProject._id)}`}>
                        <BookOpen className="h-4 w-4" />
                        Create Playbook
                      </Link>
                    </Button>
                  </div>
                )}
              </div>
            ) : projectTab === "reviews" && selectedProject ? (
              <div className="p-6 md:p-8">
                <div className="flex min-h-[360px] flex-col items-start justify-center rounded-lg border border-border bg-muted/50 px-6 py-10">
                  <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-lg border border-border bg-background text-foreground/70">
                    <Table2 className="h-5 w-5" />
                  </div>
                  <h2 className="text-3xl font-bold text-foreground">Tabular Reviews</h2>
                  <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
                    Extract comparable terms from this project&apos;s indexed contracts into Mike-style review tables.
                  </p>
                  <div className="mt-5 flex flex-wrap gap-2">
                    <Button asChild className="rounded-lg bg-cs-primary text-white hover:bg-cs-primary/90">
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
            ) : projectTab === "contracts" && selectedProject ? (
              <div className="p-6 md:p-8 flex flex-col gap-8">
                <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden animate-slide-up">
                  <div className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row sm:items-center sm:justify-between bg-muted/50">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="flex items-center gap-1 rounded-lg bg-background shadow-sm border border-border p-1">
                        {[
                          { id: "all", label: "All" },
                          { id: "mine", label: "Mine" },
                          { id: "needs-action", label: "Needs action" },
                        ].map((view) => (
                          <button
                            key={view.id}
                            onClick={() => setContractView(view.id as ContractView)}
                            className={cx(
                              "rounded-md px-3 py-1.5 text-xs font-medium transition-all",
                              contractView === view.id ? "bg-card text-foreground shadow-sm border border-border" : "text-muted-foreground hover:text-foreground hover:bg-card/50",
                            )}
                          >
                            {view.label}
                          </button>
                        ))}
                      </div>

                      <div className="relative">
                        <select
                          value={statusFilter}
                          onChange={(event) => {
                            setStatusFilter(event.target.value);
                            setPagination((prev) => ({ ...prev, currentPage: 1 }));
                          }}
                          className="h-8 appearance-none rounded-md border border-border bg-background pl-3 pr-8 text-xs font-medium text-foreground/80 outline-none transition-colors hover:bg-muted/30"
                        >
                          <option value="all">All statuses</option>
                          <option value="processing">Processing</option>
                          <option value="ingested">Ingested</option>
                          <option value="error">Error</option>
                        </select>
                        <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-foreground/80" />
                      </div>

                      <button
                        onClick={() => setSortConfig((prev) => ({
                          field: "uploaded_at",
                          direction: prev.direction === "desc" ? "asc" : "desc",
                        }))}
                        className="flex h-8 items-center gap-2 rounded-md border border-border bg-background px-3 text-xs font-medium text-foreground/80 transition-colors hover:bg-muted/30"
                      >
                        Date
                        <ChevronDown className={cx("h-4 w-4 transition-transform text-foreground/80", sortConfig.direction === "asc" && "rotate-180")} />
                      </button>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        onClick={handleManualRefresh}
                        variant="outline"
                        size="sm"
                        className="h-8 gap-2 bg-card hover:bg-muted border-border"
                        disabled={isRefreshing || isCreditLoading}
                      >
                        <RefreshCw className={cx("h-3.5 w-3.5", (isRefreshing || isCreditLoading) && "animate-spin")} />
                        Refresh
                      </Button>
                      <div className="relative">
                        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                        <Input
                          value={contractSearch}
                          onChange={(event) => {
                            setContractSearch(event.target.value);
                            setPagination((prev) => ({ ...prev, currentPage: 1 }));
                          }}
                          placeholder="Search contracts..."
                          className="h-8 w-56 rounded-md border border-border bg-card pl-8 pr-3 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-border"
                        />
                        {contractSearch && (
                          <button
                            onClick={() => setContractSearch("")}
                            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground/70"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>

                      <Button
                        size="sm"
                        onFocus={preloadFileUploadModal}
                        onClick={() => setIsUploadModalOpen(true)}
                        onMouseEnter={preloadFileUploadModal}
                        className="flex h-8 items-center gap-2 rounded-md bg-cs-primary px-3 text-xs font-medium text-white shadow-sm transition-colors hover:bg-cs-primary/90 disabled:opacity-40"
                        disabled={!selectedProjectId}
                      >
                        <UploadCloud className="h-4 w-4" />
                        Upload
                      </Button>
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
                  <div className="flex items-center justify-between border-t border-border/50 p-4">
                    <p className="text-sm text-muted-foreground">
                      Showing {visibleDocuments.length} of {pagination.totalItems} contracts
                    </p>
                    <div className="flex items-center gap-2">
                      <Button variant="outline" size="sm" className="h-8" onClick={() => handlePageChange(Math.max(1, pagination.currentPage - 1))} disabled={pagination.currentPage === 1 || isRefreshing}>
                        Previous
                      </Button>
                      <span className="text-sm font-medium text-foreground">
                        Page {pagination.currentPage} of {Math.max(pagination.totalPages, 1)}
                      </span>
                      <Button variant="outline" size="sm" className="h-8" onClick={() => handlePageChange(Math.min(pagination.totalPages, pagination.currentPage + 1))} disabled={pagination.currentPage === pagination.totalPages || isRefreshing}>
                        Next
                      </Button>
                    </div>
                  </div>
                )}
                </div>
              </div>
            ) : null}
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
