"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Check,
  ChevronDown,
  FileText,
  Loader2,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Table2,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";

import LoadingScreen from "@/components/loader";
import { toast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { useAccountContext } from "@/app/context/AccountContext";
import { TABULAR_REVIEW_TEMPLATES } from "@/lib/tabularReviewTemplates";
import { useBreadcrumbs } from "@/app/context/BreadcrumbContext";
import {
  createTabularReview,
  deleteTabularReview,
  listDocuments,
  listProjects,
  listTabularReviews,
  updateTabularReview,
  type DocumentSummary,
  type ProjectSummary,
  type TabularColumnConfig,
  type TabularReview,
} from "@/lib/tabularReviews";

type ReviewTab = "all" | "in-project" | "standalone";

const CHECK_W = "w-8 shrink-0";
const NAME_COL_W = "w-[300px] shrink-0";
const TABS: { id: ReviewTab; label: string }[] = [
  { id: "all", label: "All" },
  { id: "in-project", label: "In Project" },
  { id: "standalone", label: "Standalone" },
];

function formatDate(value?: string) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function isIndexedDocument(document: DocumentSummary) {
  return document.index?.status === "success" || ["Indexed", "Completed", "Ready to Edit"].includes(document.status);
}

function cloneColumns(columns: TabularColumnConfig[]) {
  return columns.map((column, index) => ({
    ...column,
    index,
    tags: column.tags ? [...column.tags] : undefined,
  }));
}

function ProjectPill({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center rounded-full border border-border bg-background px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
      {label}
    </span>
  );
}

function TabularReviewsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialProjectId = searchParams.get("project_id") || "";
  const shouldOpenNewReview = searchParams.get("new") === "1";
  const apiUrl = process.env.NEXT_PUBLIC_EXTRACTOR_API_URL ?? "";
  const { isAuthenticated, authenticatedFetch } = useAuth();
  const { selectedAccountId, isInitialized: accountInitialized } = useAccountContext();
  const { setBreadcrumbs } = useBreadcrumbs();

  const [reviews, setReviews] = useState<TabularReview[]>([]);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [documents, setDocuments] = useState<DocumentSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<ReviewTab>("all");
  const [projectFilter, setProjectFilter] = useState(initialProjectId);
  const [filterOpen, setFilterOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedReviewIds, setSelectedReviewIds] = useState<string[]>([]);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [rowActionsOpen, setRowActionsOpen] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  
  const [pagination, setPagination] = useState({
    currentPage: 1,
    itemsPerPage: 10,
  });

  const [newTitle, setNewTitle] = useState("");
  const [underProject, setUnderProject] = useState(Boolean(initialProjectId));
  const [newProjectId, setNewProjectId] = useState(initialProjectId);
  const [projectPickerOpen, setProjectPickerOpen] = useState(false);
  const [selectedDocumentIds, setSelectedDocumentIds] = useState<string[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [templateDropdownOpen, setTemplateDropdownOpen] = useState(false);

  const filterRef = useRef<HTMLDivElement>(null);
  const actionsRef = useRef<HTMLDivElement>(null);
  const templateRef = useRef<HTMLDivElement>(null);
  const projectPickerRef = useRef<HTMLDivElement>(null);

  const loadDocumentsForProject = useCallback(
    async (projectId?: string | null) => {
      if (!apiUrl || !isAuthenticated) return [];
      try {
        const nextDocuments = await listDocuments(apiUrl, authenticatedFetch, {
          contextId: projectId ? selectedAccountId : null,
          projectId: projectId || null,
        });
        const indexedDocuments = nextDocuments.filter(isIndexedDocument);
        setDocuments(indexedDocuments);
        return indexedDocuments;
      } catch (error) {
        console.error("Failed to load tabular review documents", error);
        setDocuments([]);
        return [];
      }
    },
    [apiUrl, authenticatedFetch, isAuthenticated, selectedAccountId],
  );

  const loadPage = useCallback(async () => {
    if (!apiUrl || !isAuthenticated || !accountInitialized) return;
    setLoading(true);
    try {
      const [nextReviews, nextProjects] = await Promise.all([
        listTabularReviews(apiUrl, authenticatedFetch),
        listProjects(apiUrl, authenticatedFetch, selectedAccountId),
      ]);
      setReviews(nextReviews);
      setProjects(nextProjects);
      await loadDocumentsForProject(initialProjectId || null);
    } catch (error) {
      console.error("Failed to load tabular reviews", error);
      toast({
        title: "Could not load tabular reviews",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [
    accountInitialized,
    apiUrl,
    authenticatedFetch,
    initialProjectId,
    isAuthenticated,
    loadDocumentsForProject,
    selectedAccountId,
  ]);

  useEffect(() => {
    void loadPage();
  }, [loadPage]);

  useEffect(() => {
    if (!initialProjectId) return;
    setProjectFilter(initialProjectId);
    setActiveTab("in-project");
    setUnderProject(true);
    setNewProjectId(initialProjectId);
    void loadDocumentsForProject(initialProjectId);
  }, [initialProjectId, loadDocumentsForProject]);

  useEffect(() => {
    if (!shouldOpenNewReview) return;
    resetCreateForm();
    setCreateOpen(true);
  }, [shouldOpenNewReview]);

  useEffect(() => {
    const project = projects.find((p) => p._id === projectFilter);
    if (projectFilter && project) {
      setBreadcrumbs([
        { label: project.name, href: `/dashboard/projects/${project._id}` },
        { label: "Reviews" }
      ]);
    } else {
      setBreadcrumbs([
        { label: "Reviews" }
      ]);
    }
  }, [projectFilter, projects, setBreadcrumbs]);

  useEffect(() => {
    setSelectedReviewIds([]);
  }, [activeTab, projectFilter, search]);

  useEffect(() => {
    function handleClick(event: MouseEvent) {
      const target = event.target as Node;
      if (filterRef.current && !filterRef.current.contains(target)) setFilterOpen(false);
      if (actionsRef.current && !actionsRef.current.contains(target)) setActionsOpen(false);
      if (templateRef.current && !templateRef.current.contains(target)) setTemplateDropdownOpen(false);
      if (projectPickerRef.current && !projectPickerRef.current.contains(target)) setProjectPickerOpen(false);
    }

    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const filteredReviews = useMemo(() => {
    const q = search.trim().toLowerCase();
    return reviews
      .filter((review) => {
        if (activeTab === "in-project") return Boolean(review.project_id);
        if (activeTab === "standalone") return !review.project_id;
        return true;
      })
      .filter((review) => !projectFilter || review.project_id === projectFilter)
      .filter((review) => !q || (review.title ?? "").toLowerCase().includes(q));
  }, [activeTab, projectFilter, reviews, search]);

  useEffect(() => {
    setPagination((prev) => ({ ...prev, currentPage: 1 }));
  }, [activeTab, projectFilter, search]);

  const totalPages = Math.max(1, Math.ceil(filteredReviews.length / pagination.itemsPerPage));
  const paginatedReviews = filteredReviews.slice(
    (pagination.currentPage - 1) * pagination.itemsPerPage,
    pagination.currentPage * pagination.itemsPerPage
  );

  const allSelected = paginatedReviews.length > 0 && paginatedReviews.every((review) => selectedReviewIds.includes(review.id));
  const someSelected = !allSelected && paginatedReviews.some((review) => selectedReviewIds.includes(review.id));
  const selectedTemplate = TABULAR_REVIEW_TEMPLATES.find((template) => template.id === selectedTemplateId);
  const selectedProjectFilter = projects.find((project) => project._id === projectFilter);
  const selectedModalProject = projects.find((project) => project._id === newProjectId);

  async function resetCreateForm() {
    const scopedProjectId = projectFilter || initialProjectId || "";
    setNewTitle("");
    setSelectedTemplateId(null);
    setTemplateDropdownOpen(false);
    setProjectPickerOpen(false);
    setUnderProject(Boolean(scopedProjectId));
    setNewProjectId(scopedProjectId);
    setSelectedDocumentIds([]);
    const nextDocuments = await loadDocumentsForProject(scopedProjectId || null);
    if (scopedProjectId) setSelectedDocumentIds(nextDocuments.map((document) => document._id));
  }

  async function handleProjectModeChange(next: boolean) {
    setUnderProject(next);
    setProjectPickerOpen(false);
    setSelectedDocumentIds([]);
    if (!next) {
      setNewProjectId("");
      await loadDocumentsForProject(null);
      return;
    }

    const fallbackProjectId = projectFilter || initialProjectId || "";
    setNewProjectId(fallbackProjectId);
    if (fallbackProjectId) {
      const nextDocuments = await loadDocumentsForProject(fallbackProjectId);
      setSelectedDocumentIds(nextDocuments.map((document) => document._id));
    } else {
      setDocuments([]);
    }
  }

  async function handleProjectChange(projectId: string) {
    setNewProjectId(projectId);
    setProjectPickerOpen(false);
    const nextDocuments = await loadDocumentsForProject(projectId || null);
    setSelectedDocumentIds(nextDocuments.map((document) => document._id));
  }

  function selectTemplate(templateId: string | null) {
    const template = TABULAR_REVIEW_TEMPLATES.find((item) => item.id === templateId);
    setSelectedTemplateId(templateId);
    setTemplateDropdownOpen(false);
    if (template && !newTitle.trim()) setNewTitle(template.title);
  }

  function toggleReview(reviewId: string) {
    setSelectedReviewIds((current) =>
      current.includes(reviewId) ? current.filter((id) => id !== reviewId) : [...current, reviewId],
    );
  }

  function toggleAllReviews() {
    setSelectedReviewIds(allSelected ? [] : paginatedReviews.map((review) => review.id));
  }

  function toggleDocument(documentId: string) {
    setSelectedDocumentIds((current) =>
      current.includes(documentId) ? current.filter((id) => id !== documentId) : [...current, documentId],
    );
  }

  async function handleCreateReview() {
    if (!newTitle.trim()) {
      toast({ title: "Name the review first", variant: "destructive" });
      return;
    }
    if (underProject && !newProjectId) {
      toast({ title: "Select a project or turn off project mode", variant: "destructive" });
      return;
    }

    setCreating(true);
    try {
      const review = await createTabularReview(apiUrl, authenticatedFetch, {
        title: newTitle.trim(),
        project_id: underProject ? newProjectId : null,
        document_ids: selectedDocumentIds,
        columns_config: cloneColumns(selectedTemplate?.columns_config ?? []),
      });
      setCreateOpen(false);
      await resetCreateForm();
      router.push(`/tabular-reviews/${review.id}`);
    } catch (error) {
      toast({
        title: "Could not create review",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setCreating(false);
    }
  }

  async function handleRenameSubmit(reviewId: string) {
    const trimmed = renameValue.trim();
    if (!trimmed) {
      setRenamingId(null);
      return;
    }

    const review = reviews.find((item) => item.id === reviewId);
    if (review?.is_owner === false) {
      setRenamingId(null);
      toast({ title: "Only review owners can rename reviews", variant: "destructive" });
      return;
    }

    setReviews((current) => current.map((item) => (item.id === reviewId ? { ...item, title: trimmed } : item)));
    setRenamingId(null);
    try {
      await updateTabularReview(apiUrl, authenticatedFetch, reviewId, { title: trimmed });
    } catch (error) {
      toast({
        title: "Could not rename review",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
      void loadPage();
    }
  }

  async function handleDeleteReviews(reviewIds: string[]) {
    const ownedIds = reviewIds.filter((reviewId) => {
      const review = reviews.find((item) => item.id === reviewId);
      return review?.is_owner !== false;
    });
    const blocked = reviewIds.length - ownedIds.length;
    setActionsOpen(false);
    setRowActionsOpen(null);

    if (!ownedIds.length) {
      toast({ title: "Only review owners can delete reviews", variant: "destructive" });
      return;
    }

    try {
      await Promise.all(ownedIds.map((reviewId) => deleteTabularReview(apiUrl, authenticatedFetch, reviewId)));
      setReviews((current) => current.filter((review) => !ownedIds.includes(review.id)));
      setSelectedReviewIds((current) => current.filter((reviewId) => !ownedIds.includes(reviewId)));
      toast({
        title: ownedIds.length === 1 ? "Review deleted" : "Reviews deleted",
        description: blocked ? `${blocked} selected review${blocked === 1 ? "" : "s"} could not be deleted because you are not the owner.` : undefined,
      });
    } catch (error) {
      toast({
        title: "Could not delete reviews",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    }
  }

  if (!isAuthenticated || loading) {
    return <LoadingScreen />;
  }

  return (
    <main className="flex min-h-screen flex-col bg-background text-foreground pb-20">
      <div className="p-6 md:p-8">
        <div className="mb-6 flex flex-col gap-1">
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Reviews</h1>
          <p className="text-sm text-muted-foreground">Manage your tabular reviews and extract structured data from contracts.</p>
        </div>
        <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden animate-slide-up">
          <div className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row sm:items-center sm:justify-between bg-muted/50">
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1 rounded-lg bg-background shadow-sm border border-border p-1">
                {TABS.map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`rounded-md px-3 py-1.5 text-xs font-medium transition-all ${
                      activeTab === tab.id
                        ? "bg-card text-foreground shadow-sm border border-border"
                        : "text-muted-foreground hover:text-foreground hover:bg-card/50"
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              <div ref={filterRef} className="relative">
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    setFilterOpen((open) => !open);
                  }}
                  className={`flex h-8 items-center gap-2 rounded-md border border-border px-3 text-xs font-medium transition-colors hover:bg-muted/30 bg-background ${
                    projectFilter ? "text-foreground" : "text-foreground/80"
                  }`}
                >
                  {selectedProjectFilter ? selectedProjectFilter.name : "Filter by project"}
                  <ChevronDown className="h-4 w-4 text-foreground/80" />
                </button>
                {filterOpen && (
                  <div className="absolute right-0 top-full z-[100] mt-1.5 max-h-64 w-52 overflow-y-auto rounded-xl border border-border bg-card shadow-lg">
                    <button
                      type="button"
                      onClick={() => {
                        setProjectFilter("");
                        setFilterOpen(false);
                      }}
                      className="flex w-full items-center justify-between px-3 py-2 text-xs text-foreground/80 transition-colors hover:bg-muted/50 hover:text-foreground"
                    >
                      All Projects
                      {!projectFilter && <Check className="h-3.5 w-3.5 text-foreground/80" />}
                    </button>
                    {projects.length > 0 && <div className="border-t border-border" />}
                    {projects.map((project) => (
                      <button
                        key={project._id}
                        type="button"
                        onClick={() => {
                          setProjectFilter(project._id);
                          setFilterOpen(false);
                        }}
                        className="flex w-full items-center justify-between px-3 py-2 text-xs text-foreground/80 transition-colors hover:bg-muted/50 hover:text-foreground"
                      >
                        <span className="truncate pr-2">{project.name}</span>
                        {projectFilter === project._id && <Check className="h-3.5 w-3.5 shrink-0 text-foreground/80" />}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {selectedReviewIds.length > 0 && (
                <div ref={actionsRef} className="relative">
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      setActionsOpen((open) => !open);
                    }}
                    className="flex h-8 items-center gap-2 text-xs font-medium text-foreground/80 transition-colors hover:text-foreground rounded-md border border-border bg-background px-3"
                  >
                    Actions
                    <ChevronDown className="h-4 w-4 text-foreground/80" />
                  </button>
                  {actionsOpen && (
                    <div className="absolute left-0 top-full z-[100] mt-1 w-36 overflow-hidden rounded-lg border border-border bg-card shadow-lg">
                      <button
                        type="button"
                        onClick={() => void handleDeleteReviews(selectedReviewIds)}
                        className="w-full px-3 py-1.5 text-left text-xs text-destructive transition-colors hover:bg-destructive/10"
                      >
                        Delete
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search reviews..."
                  className="h-8 w-56 rounded-md border border-border bg-card pl-8 pr-3 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-border"
                />
                {search && (
                  <button
                    onClick={() => setSearch("")}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground/70"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>

              <button
                type="button"
                onClick={() => {
                  void resetCreateForm();
                  setCreateOpen(true);
                }}
                disabled={creating}
                className="flex h-8 items-center gap-2 rounded-md bg-cs-primary px-3 text-xs font-medium text-white shadow-sm transition-colors hover:bg-cs-primary/90 disabled:opacity-40"
              >
                {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                New Review
              </button>
            </div>
          </div>
          <div className="w-full overflow-x-auto">
            <div className="min-w-max">
          <div className="flex h-12 items-center border-b border-border bg-muted/30 px-2 pr-3 text-[10px] uppercase tracking-wider font-bold text-muted-foreground select-none md:pr-10">
            <div className={`sticky left-0 z-[60] ${CHECK_W} flex self-stretch bg-muted/30`}>
              <label className="flex h-full w-full items-center justify-center">
                <input
                  type="checkbox"
                  checked={allSelected}
                  ref={(element) => {
                    if (element) element.indeterminate = someSelected;
                  }}
                  onChange={toggleAllReviews}
                  className="h-2.5 w-2.5 cursor-pointer rounded border-gray-200 accent-black"
                  aria-label="Select all reviews"
                />
              </label>
            </div>
            <div className={`sticky left-8 z-[60] ${NAME_COL_W} bg-muted/30 pl-2 text-left transition-all duration-300 hover:text-foreground hover:underline cursor-pointer`}>
              Name
            </div>
            <div className="ml-auto w-24 shrink-0 transition-all duration-300 hover:text-foreground hover:underline cursor-pointer">
              Columns
            </div>
            <div className="w-24 shrink-0 transition-all duration-300 hover:text-foreground hover:underline cursor-pointer">
              Documents
            </div>
            <div className="w-40 shrink-0 transition-all duration-300 hover:text-foreground hover:underline cursor-pointer">
              Project
            </div>
            <div className="w-32 shrink-0 transition-all duration-300 hover:text-foreground hover:underline cursor-pointer">
              Created
            </div>
            <div className="w-8 shrink-0 text-right transition-all duration-300 hover:text-foreground hover:underline cursor-pointer">
              Actions
            </div>
          </div>

          {filteredReviews.length === 0 ? (
            activeTab === "all" && !projectFilter && !search ? (
              <div className="flex h-64 flex-col items-center justify-center text-center">
                <Table2 className="h-10 w-10 text-muted-foreground/50" />
                <p className="mt-3 text-sm font-medium text-foreground/80">No tabular reviews yet</p>
                <p className="mt-1 text-sm text-muted-foreground">Extract data from documents into tables using AI.</p>
                <button
                  type="button"
                  onClick={() => {
                    void resetCreateForm();
                    setCreateOpen(true);
                  }}
                  disabled={creating}
                  className="mt-4 inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:bg-muted disabled:opacity-40"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Create New
                </button>
              </div>
            ) : (
              <div className="flex h-64 flex-col items-center justify-center text-center">
                <Search className="h-10 w-10 text-muted-foreground/50" />
                <p className="mt-3 text-sm font-medium text-foreground/80">No reviews found</p>
                <p className="mt-1 text-sm text-muted-foreground">Try a different search or filter.</p>
              </div>
            )
          ) : (
            <>
            {paginatedReviews.map((review) => {
              const project = projects.find((item) => item._id === review.project_id);
              const selected = selectedReviewIds.includes(review.id);

              return (
                <div
                  key={review.id}
                  onClick={() => {
                    if (renamingId === review.id) return;
                    router.push(`/tabular-reviews/${review.id}`);
                  }}
                  className={`group flex min-h-[48px] cursor-pointer items-center border-b border-border/50 px-2 pr-3 text-sm transition-colors hover:bg-muted/30 md:pr-10 ${
                    selected ? "bg-muted/30" : ""
                  }`}
                >
                  <div
                    className={`sticky left-0 z-[60] ${CHECK_W} flex items-center justify-center p-2 bg-transparent`}
                    onClick={(event) => event.stopPropagation()}
                  >
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={() => toggleReview(review.id)}
                      className="h-2.5 w-2.5 cursor-pointer rounded border-gray-200 accent-black"
                      aria-label={`Select ${review.title || "review"}`}
                    />
                  </div>
                  <div className={`sticky left-8 z-[60] ${NAME_COL_W} flex items-start gap-3 p-2 bg-transparent min-w-0`}>
                    <Table2 className="mt-0.5 h-4 w-4 shrink-0 text-cs-primary/80 transition-transform duration-300 group-hover:scale-110" />
                    <div className="min-w-0 flex-1">
                      {renamingId === review.id ? (
                        <input
                          autoFocus
                          value={renameValue}
                          onChange={(event) => setRenameValue(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") void handleRenameSubmit(review.id);
                            if (event.key === "Escape") setRenamingId(null);
                          }}
                          onBlur={() => void handleRenameSubmit(review.id)}
                          onClick={(event) => event.stopPropagation()}
                          className="w-full bg-transparent text-sm text-foreground outline-none"
                        />
                      ) : (
                        <span className="block truncate font-medium text-foreground transition-colors duration-300 group-hover:text-cs-primary">
                          {review.title || "Untitled Review"}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="ml-auto w-24 shrink-0 truncate text-sm text-muted-foreground">
                    {review.columns_config?.length ?? 0}
                  </div>
                  <div className="w-24 shrink-0 truncate text-sm text-muted-foreground">
                    {review.document_count ?? review.document_ids.length}
                  </div>
                  <div className="w-40 shrink-0 truncate pr-2">
                    {project ? (
                      <ProjectPill label={project.name} />
                    ) : (
                      <span className="text-sm text-muted-foreground/50">—</span>
                    )}
                  </div>
                  <div className="w-32 shrink-0 truncate text-sm text-muted-foreground">{formatDate(review.created_at)}</div>
                  <div
                    className="relative flex w-8 shrink-0 justify-end"
                    onClick={(event) => event.stopPropagation()}
                  >
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        setRowActionsOpen((open) => (open === review.id ? null : review.id));
                      }}
                      className="flex h-8 w-8 items-center justify-center rounded-md border border-transparent text-muted-foreground opacity-0 shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:border-border hover:bg-background hover:text-foreground group-hover:opacity-100"
                      aria-label={`Review actions for ${review.title || "review"}`}
                    >
                      <MoreHorizontal className="h-4 w-4" />
                    </button>
                    {rowActionsOpen === review.id && (
                      <div className="absolute right-0 top-9 z-50 w-32 overflow-hidden rounded-lg border border-border bg-background shadow-lg">
                        <button
                          type="button"
                          onClick={() => {
                            if (review.is_owner === false) {
                              toast({ title: "Only review owners can rename reviews", variant: "destructive" });
                              return;
                            }
                            setRenameValue(review.title || "Untitled Review");
                            setRenamingId(review.id);
                            setRowActionsOpen(null);
                          }}
                          className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:bg-muted/30 hover:text-foreground"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                          Rename
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleDeleteReviews([review.id])}
                          className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-destructive transition-colors hover:bg-destructive/10"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          Delete
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
            
            {filteredReviews.length > 0 && (
              <div className="flex items-center justify-between border-t border-border bg-muted/20 px-4 py-3 sm:px-6">
                <span className="text-sm text-muted-foreground">
                  Showing {paginatedReviews.length} of {filteredReviews.length} reviews
                </span>
                <div className="flex items-center gap-2">
                  <Button 
                    variant="outline" 
                    size="sm" 
                    className="h-8" 
                    onClick={() => setPagination(p => ({ ...p, currentPage: Math.max(1, p.currentPage - 1) }))} 
                    disabled={pagination.currentPage === 1}
                  >
                    Previous
                  </Button>
                  <span className="text-sm font-medium text-foreground">
                    Page {pagination.currentPage} of {Math.max(totalPages, 1)}
                  </span>
                  <Button 
                    variant="outline" 
                    size="sm" 
                    className="h-8" 
                    onClick={() => setPagination(p => ({ ...p, currentPage: Math.min(totalPages, p.currentPage + 1) }))} 
                    disabled={pagination.currentPage === totalPages}
                  >
                    Next
                  </Button>
                </div>
              </div>
            )}
            </>
          )}
            </div>
          </div>
        </div>
      </div>
      {createOpen && (
        <div className="fixed inset-0 z-[101] flex items-center justify-center bg-black/20 px-3 backdrop-blur-[2px]">
          <div className="flex h-[600px] w-full max-w-2xl flex-col rounded-2xl bg-white shadow-2xl">
            <div className="flex shrink-0 items-center justify-between px-6 pb-2 pt-5">
              <div className="flex items-center gap-1.5 text-xs text-gray-400">
                <span>Tabular Reviews</span>
                <span>›</span>
                <span>New review</span>
              </div>
              <button
                type="button"
                onClick={() => setCreateOpen(false)}
                className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 pb-4 pt-3">
              <input
                type="text"
                value={newTitle}
                onChange={(event) => setNewTitle(event.target.value)}
                placeholder="Review name"
                className="w-full bg-transparent font-serif text-2xl text-gray-800 outline-none placeholder:text-gray-400"
                autoFocus
              />

              <div className="space-y-2">
                <p className="text-xs font-medium text-gray-700">Workflow Template</p>
                <div ref={templateRef} className="relative">
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      setTemplateDropdownOpen((open) => !open);
                    }}
                    className="flex w-full items-center justify-between rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm transition-colors hover:border-gray-400 focus:outline-none"
                  >
                    <span className={selectedTemplate ? "truncate text-gray-800" : "truncate text-gray-400"}>
                      {selectedTemplate ? selectedTemplate.title : "No template — start from scratch"}
                    </span>
                    <ChevronDown className="ml-2 h-3.5 w-3.5 shrink-0 text-gray-400" />
                  </button>
                  {templateDropdownOpen && (
                    <div className="absolute left-0 top-full z-20 mt-1 max-h-60 w-full overflow-y-auto rounded-xl border border-gray-100 bg-white shadow-lg">
                      <button
                        type="button"
                        onClick={() => selectTemplate(null)}
                        className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-gray-50 ${
                          !selectedTemplateId ? "bg-gray-50 text-gray-900" : "text-gray-500"
                        }`}
                      >
                        <span className="flex-1">No template — start from scratch</span>
                        {!selectedTemplateId && <Check className="h-3.5 w-3.5 shrink-0 text-gray-500" />}
                      </button>
                      <div className="border-t border-gray-100" />
                      {TABULAR_REVIEW_TEMPLATES.map((template) => (
                        <button
                          key={template.id}
                          type="button"
                          onClick={() => selectTemplate(template.id)}
                          className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-gray-50 ${
                            selectedTemplateId === template.id ? "bg-gray-50 text-gray-900" : "text-gray-700"
                          }`}
                        >
                          <span className="min-w-0 flex-1">
                            <span className="block truncate">{template.title}</span>
                            <span className="block truncate text-[11px] text-gray-400">
                              {template.practice} · {template.columns_config.length} columns
                            </span>
                          </span>
                          {selectedTemplateId === template.id && <Check className="h-3.5 w-3.5 shrink-0 text-gray-500" />}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div className="space-y-3">
                <button
                  type="button"
                  onClick={() => void handleProjectModeChange(!underProject)}
                  className="flex w-fit items-center gap-2.5"
                >
                  <span className={`relative inline-flex h-5 w-9 shrink-0 rounded-full transition-colors duration-200 ${underProject ? "bg-gray-900" : "bg-gray-200"}`}>
                    <span className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-200 ${underProject ? "translate-x-4" : "translate-x-0"}`} />
                  </span>
                  <span className="text-sm text-gray-600">Create under a project</span>
                </button>

                {underProject && (
                  <div ref={projectPickerRef} className="relative">
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        setProjectPickerOpen((open) => !open);
                      }}
                      className="flex w-full items-center justify-between rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm transition-colors hover:border-gray-400 focus:outline-none"
                    >
                      <span className={selectedModalProject ? "truncate text-gray-800" : "truncate text-gray-400"}>
                        {selectedModalProject ? selectedModalProject.name : "Select project..."}
                      </span>
                      <ChevronDown className="h-3.5 w-3.5 shrink-0 text-gray-400" />
                    </button>
                    {projectPickerOpen && (
                      <div className="absolute left-0 top-full z-20 mt-1 max-h-48 w-full overflow-y-auto rounded-xl border border-gray-100 bg-white shadow-lg">
                        {projects.length === 0 ? (
                          <p className="px-3 py-2 text-xs text-gray-400">No projects found</p>
                        ) : (
                          projects.map((project) => (
                            <button
                              key={project._id}
                              type="button"
                              onClick={() => void handleProjectChange(project._id)}
                              className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm transition-colors hover:bg-gray-50 ${
                                newProjectId === project._id ? "bg-gray-50 text-gray-900" : "text-gray-700"
                              }`}
                            >
                              <span className="truncate pr-2">{project.name}</span>
                              {newProjectId === project._id && <Check className="h-3.5 w-3.5 shrink-0 text-gray-500" />}
                            </button>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {(!underProject || newProjectId) && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-medium text-gray-700">Select Documents</p>
                    <span className="text-xs text-gray-400">{selectedDocumentIds.length} selected</span>
                  </div>
                  <div className="max-h-56 overflow-y-auto rounded-xl border border-gray-100 bg-white">
                    {documents.length > 0 ? (
                      documents.map((document) => {
                        const checked = selectedDocumentIds.includes(document._id);
                        return (
                          <button
                            key={document._id}
                            type="button"
                            onClick={() => toggleDocument(document._id)}
                            className="flex w-full items-start gap-3 border-b border-gray-50 px-3 py-2 text-left transition-colors last:border-0 hover:bg-gray-50"
                          >
                            <span className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                              checked ? "border-gray-900 bg-gray-900 text-white" : "border-gray-200 bg-white"
                            }`}>
                              {checked && <Check className="h-3 w-3" />}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm text-gray-800">{document.contract_name}</span>
                              <span className="mt-0.5 flex items-center gap-1 text-xs text-gray-400">
                                <FileText className="h-3.5 w-3.5" />
                                {document.status}
                              </span>
                            </span>
                          </button>
                        );
                      })
                    ) : (
                      <div className="px-3 py-8 text-center text-sm text-gray-400">No indexed documents found</div>
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="flex shrink-0 items-center justify-end gap-2 border-t border-gray-100 px-6 py-4">
              <button
                type="button"
                onClick={() => setCreateOpen(false)}
                className="rounded-lg px-4 py-2 text-sm text-gray-500 transition-colors hover:bg-gray-100"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleCreateReview()}
                disabled={!newTitle.trim() || (underProject && !newProjectId) || creating}
                className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {creating ? "Creating..." : "Create Review"}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

export default function TabularReviewsPage() {
  return (
    <Suspense fallback={<LoadingScreen />}>
      <TabularReviewsContent />
    </Suspense>
  );
}