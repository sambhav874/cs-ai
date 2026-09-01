"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronDown, FolderOpen, History, RefreshCw, Search, X, UploadCloud } from "lucide-react";
import { useBreadcrumbs } from "@/app/context/BreadcrumbContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { useAccountContext } from "@/app/context/AccountContext";
import LoadingScreen from "@/components/loader";

const FileUploadModal = dynamic(
  () => import("@/components/new/file-upload-area").then((mod) => mod.FileUploadModal),
  { ssr: false, loading: () => null }
);

const RoleReassignmentModal = dynamic(
  () => import("@/components/new/RoleReassignmentModal").then((mod) => mod.RoleReassignmentModal),
  { ssr: false, loading: () => null }
);

function preloadFileUploadModal() {
  void import("@/components/new/file-upload-area");
}

function preloadRoleReassignmentModal() {
  void import("@/components/new/RoleReassignmentModal");
}

import type {
  Document, DocumentWithProgress, UserCredits, UserInDB,
  ContractStatusResponse, Project, ContractView
} from "@/components/dashboard/types";
import { cx, formatDate, isActiveJobStatus, completedStatusForJob } from "@/components/dashboard/utils";
import { ContractExplorer } from "@/components/dashboard/ContractExplorer";
import { ProjectTimeline } from "./ProjectTimeline";
import { ProjectMemoryPanel } from "./ProjectMemoryPanel";

interface ProjectContractsScreenProps {
  projectId: string;
}

export function ProjectContractsScreen({ projectId }: ProjectContractsScreenProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { setBreadcrumbs } = useBreadcrumbs();
  const { token, isAuthenticated, authChecked, authenticatedFetch, logout } = useAuth();
  const { selectedAccountId, isInitialized: accountInitialized } = useAccountContext();
  const apiUrl = process.env.NEXT_PUBLIC_EXTRACTOR_API_URL;

  const [project, setProject] = useState<Project | null>(null);
  const [isProjectLoading, setIsProjectLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const [documents, setDocuments] = useState<DocumentWithProgress[]>([]);
  const [currentlyProcessing, setCurrentlyProcessing] = useState<string | null>(null);
  
  const [currentUserInfo, setCurrentUserInfo] = useState<UserInDB | null>(null);
  const [userCredits, setUserCredits] = useState<UserCredits | null>(null);
  const [isCreditLoading, setIsCreditLoading] = useState(false);

  const [pagination, setPagination] = useState({
    currentPage: 1,
    totalPages: 1,
    totalItems: 0,
    itemsPerPage: 10,
  });
  const paginationRef = useRef(pagination);

  const [contractSearch, setContractSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [contractView, setContractView] = useState<ContractView>("all");
  const [sortConfig, setSortConfig] = useState<{ field: string; direction: "asc" | "desc" }>({
    field: "uploaded_at",
    direction: "desc",
  });
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<"contracts" | "timeline">("contracts");
  const [memoryRefreshKey, setMemoryRefreshKey] = useState(0);
  
  useEffect(() => {
    if (searchParams?.get("upload") === "1" || searchParams?.get("upload") === "true") {
      setIsUploadModalOpen(true);
    }
  }, [searchParams]);
  
  const [contractToReassign, setContractToReassign] = useState<{
    _id: string;
    contract_name: string;
    editorUserId: string | null;
    approverUserId: string | null;
  } | null>(null);
  const [isReassignModalOpen, setIsReassignModalOpen] = useState(false);

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

  // Load project details
  useEffect(() => {
    if (!isAuthenticated || !accountInitialized || !apiUrl || !projectId) return;

    let isMounted = true;
    const fetchProject = async () => {
      try {
        setIsProjectLoading(true);
        const params = new URLSearchParams();
        if (selectedAccountId) params.set("context_id", selectedAccountId);
        
        const url = `${apiUrl}/projects/${projectId}${params.toString() ? `?${params.toString()}` : ""}`;
        const { data, error } = await authenticatedFetch(url);
        
        if (error) {
          if (error.includes("403") || error.includes("404")) {
            toast({ title: "Project Unavailable", description: "This project is not available in the current context.", variant: "destructive" });
            router.push("/dashboard");
            return;
          }
          if (handleApiError(error)) return;
          throw new Error(error);
        }
        
        if (isMounted) {
          setProject(data as Project);
          setBreadcrumbs([
            { label: "Projects", href: "/dashboard" },
            { label: (data as Project).name || "Project" },
          ]);
        }
      } catch (err) {
        console.error("Error fetching project:", err);
        if (isMounted) {
          toast({ title: "Error", description: "Failed to load project details", variant: "destructive" });
          router.push("/dashboard");
        }
      } finally {
        if (isMounted) setIsProjectLoading(false);
      }
    };
    
    fetchProject();
    
    return () => { isMounted = false; };
  }, [isAuthenticated, accountInitialized, apiUrl, projectId, selectedAccountId, router, setBreadcrumbs, authenticatedFetch, handleApiError]);

  const fetchCurrentUser = useCallback(async () => {
    if (!isAuthenticated || !apiUrl) return;
    try {
      const { data, error } = await authenticatedFetch(`${apiUrl}/users/me/`);
      if (error) {
        if (handleApiError(error)) return;
        throw new Error(error);
      }
      setCurrentUserInfo(data as UserInDB);
    } catch (err) {
      console.error("Failed to fetch current user:", err);
    }
  }, [apiUrl, isAuthenticated, authenticatedFetch, handleApiError]);

  const fetchUserCredits = useCallback(async () => {
    if (!isAuthenticated || !apiUrl) return;
    let url = `${apiUrl}/account/balance`;
    if (selectedAccountId) url += `?context_id=${selectedAccountId}`;

    try {
      setIsCreditLoading(true);
      const { data, error } = await authenticatedFetch(url);
      if (error) {
        if (handleApiError(error)) return;
        throw new Error(error);
      }
      setUserCredits(data as UserCredits);
    } catch (error) {
      console.error("Error fetching account details:", error);
    } finally {
      setIsCreditLoading(false);
    }
  }, [isAuthenticated, apiUrl, selectedAccountId, authenticatedFetch, handleApiError]);

  useEffect(() => {
    if (isAuthenticated && accountInitialized) {
      fetchCurrentUser();
      fetchUserCredits();
    }
  }, [isAuthenticated, accountInitialized, fetchCurrentUser, fetchUserCredits]);

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
    if (!isAuthenticated || !projectId || !apiUrl || isProjectLoading) return;

    try {
      setIsRefreshing(true);
      const params = new URLSearchParams({
        page: page.toString(),
        per_page: perPage.toString(),
        sort_by: sortBy,
        sort_order: sortOrder,
        project_id: projectId,
      });
      if (selectedAccountId) params.set("context_id", selectedAccountId);
      if (search.trim()) params.set("search", search.trim());
      if (currentStatusFilter !== "all") params.set("status", currentStatusFilter);

      const qs = params.toString();
      const url = `${apiUrl}/documents/${qs ? `?${qs}` : ""}`;
      const { data, error } = await authenticatedFetch(url);
      if (error) {
        if (handleApiError(error)) return;
        throw new Error(error);
      }

      const newDocs = ((data as any)?.documents || []).map((doc: Document) => {
        let progress = 0;
        let currentStep: string | null = null;
        let isProcessing = ["processing", "pending", "queued", "Syncronizing", "Indexing", "Summarizing", "Processing"].includes(doc.status);
        let activeJobId: string | null = null;
        let status = doc.status;
        let errorObj = doc.error;

        if (isProcessing) {
          const latestJob = doc.latest_job;
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
              errorObj = {
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
          error: errorObj,
          index_status: doc.index?.status,
          summarize_status: doc.summarize?.status,
          process_status: doc.process?.status,
        };
      });

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
  }, [isAuthenticated, projectId, selectedAccountId, contractSearch, statusFilter, sortConfig, authenticatedFetch, apiUrl, handleApiError, fetchContractStatus, isProjectLoading]);

  useEffect(() => {
    fetchDocuments(1);
  }, [projectId, contractSearch, statusFilter, sortConfig, fetchDocuments]);

  useEffect(() => {
    const processingDocumentKey = documents
      .filter((doc) =>
        doc.isProcessing ||
        ["pending", "queued", "Syncronizing", "Indexing", "Summarizing", "processing", "Processing", "Uploaded", "uploaded"].includes(doc.status),
      )
      .map((doc) => doc._id)
      .join(",");
    if (!processingDocumentKey) return;

    const pollTimer = window.setInterval(() => {
      void fetchDocuments(paginationRef.current.currentPage);
    }, 2000);

    return () => window.clearInterval(pollTimer);
  }, [
    documents
      .filter((doc) =>
        doc.isProcessing ||
        ["pending", "queued", "Syncronizing", "Indexing", "Summarizing", "processing", "Processing", "Uploaded", "uploaded"].includes(doc.status),
      )
      .map((doc) => doc._id)
      .join(","),
    fetchDocuments,
  ]);

  const startProcessing = useCallback(async (contractId: string) => {
    if (!isAuthenticated || !token || !apiUrl) {
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
  }, [isAuthenticated, token, documents, authenticatedFetch, apiUrl, handleApiError]);

  const handleManualRefresh = useCallback(async () => {
    await Promise.all([
      fetchDocuments(pagination.currentPage),
      fetchUserCredits(),
    ]);
  }, [fetchDocuments, fetchUserCredits, pagination.currentPage]);

  const handlePageChange = useCallback((page: number) => {
    fetchDocuments(page);
  }, [fetchDocuments]);

  const handleProcess = useCallback((contractId: string) => {
    void startProcessing(contractId);
  }, [startProcessing]);

  const handleUploadSuccess = useCallback(() => {
    setIsUploadModalOpen(false);
    fetchDocuments(1);
    fetchUserCredits();
    
    setTimeout(() => {
      fetchDocuments(1);
    }, 2500);
  }, [fetchDocuments, fetchUserCredits]);

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

  if (isProjectLoading) {
    return <LoadingScreen />;
  }

  return (
    <div className="flex flex-col min-h-0 bg-background font-InterVar text-foreground h-full">
      <div className="px-6 md:px-8 pt-5 pb-2 shrink-0">
        <div className="flex items-center gap-2.5">
          <FolderOpen className="h-5 w-5 text-muted-foreground/70" />
          <h1 className="text-2xl font-bold text-foreground tracking-tight">{project?.name || "Project"}</h1>
          {project && (
            <span className="ml-2 inline-flex items-center rounded-full border border-border bg-muted/30 px-2.5 py-0.5 text-xs font-semibold text-muted-foreground">
              {project.ownerType === "team" ? "Team Project" : "Personal Project"}
            </span>
          )}
        </div>
        {project?.description && (
          <p className="mt-1 text-sm text-muted-foreground pl-[30px]">{project.description}</p>
        )}
      </div>
      
      <div className="flex h-10 items-center border-b border-border px-6 md:px-8 shrink-0">
        <div className="flex flex-1 items-center gap-5 h-full">
          <button
            onClick={() => setActiveTab("contracts")}
            className={cx(
              "text-xs transition-colors h-full px-1 border-b-2 font-bold",
              activeTab === "contracts" ? "text-foreground border-[#015CA9]" : "text-muted-foreground border-transparent hover:text-foreground",
            )}
          >
            Contracts
          </button>
          <button
            onClick={() => setActiveTab("timeline")}
            className={cx(
              "flex items-center gap-1.5 text-xs transition-colors h-full px-1 border-b-2 font-bold",
              activeTab === "timeline" ? "text-foreground border-[#015CA9]" : "text-muted-foreground border-transparent hover:text-foreground",
            )}
          >
            <History className="h-3.5 w-3.5" />
            Timeline
          </button>
        </div>
        {project && (
          <span className="text-xs text-muted-foreground">Updated {formatDate(project.updatedAt)}</span>
        )}
      </div>

      {activeTab === "timeline" ? (
        <div className="p-6 md:p-8 flex-1 overflow-y-auto flex flex-col gap-6">
          <ProjectMemoryPanel projectId={projectId} refreshSignal={memoryRefreshKey} />
          <ProjectTimeline projectId={projectId} onMemoryChanged={() => setMemoryRefreshKey((k) => k + 1)} />
        </div>
      ) : (
      <div className="p-6 md:p-8 flex flex-col gap-8 flex-1 overflow-y-auto">
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
      )}

      {isUploadModalOpen && (
        <FileUploadModal
          isOpen={isUploadModalOpen}
          onClose={() => setIsUploadModalOpen(false)}
          onUploadSuccess={handleUploadSuccess}
          userCredits={userCredits?.page_credits || 0}
          projectId={projectId}
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
