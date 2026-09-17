"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  AlertCircle,
  Check,
  ChevronDown,
  Download,
  FileText,
  FolderOpen,
  Loader2,
  MessageSquare,
  MoreHorizontal,
  Play,
  Plus,
  RefreshCw,
  Save,
  Table2,
  Upload,
} from "lucide-react";

import LoadingScreen from "@/components/loader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";
import { useAccountContext } from "@/app/context/AccountContext";
import { useBreadcrumbs } from "@/app/context/BreadcrumbContext";
import { useAuth } from "@/hooks/useAuth";
import { downloadCsv } from "@/lib/exportCsv";
import {
  generateTabularReview,
  getTabularReview,
  listDocuments,
  regenerateTabularCell,
  updateTabularCell,
  updateTabularReview,
  type DocumentSummary,
  type TabularCell,
  type TabularColumnConfig,
  type TabularDocument,
  type TabularReview,
} from "@/lib/tabularReviews";

const CHECK_W = "w-8 shrink-0";
const DOC_COL_W = "w-[300px] shrink-0";
const DATA_COL_W = "w-[300px] shrink-0";
const CHECK_W_PX = 32;
const DOC_COL_W_PX = 300;
const DATA_COL_W_PX = 300;

function sanitizeFilename(value: string) {
  return (value || "Tabular Review").replace(/[\\/:*?"<>|]+/g, "-").slice(0, 90);
}

function normalizeColumns(columns: TabularColumnConfig[]) {
  return columns
    .map((column, index) => ({
      ...column,
      index,
      name: column.name.trim(),
      prompt: column.prompt.trim(),
      tags: column.tags?.filter((tag) => tag.trim()),
    }))
    .filter((column) => column.name && column.prompt);
}

function documentLabel(document: { contract_name?: string; title?: string }) {
  return document.contract_name || document.title || "Untitled document";
}

function isIndexedDocument(document: DocumentSummary) {
  return document.index?.status === "success" || ["Indexed", "Completed", "Ready to Edit"].includes(document.status);
}

function getDocumentId(document: TabularDocument | DocumentSummary) {
  return "id" in document ? document.id : document._id;
}

function cellText(cell?: TabularCell) {
  if (!cell?.summary) return "";
  return cell.summary.split("\n").find((line) => line.trim())?.replace(/^[-*•]\s+/, "") || cell.summary;
}

function emptyColumnDraft(): Pick<TabularColumnConfig, "name" | "prompt" | "format" | "tags"> {
  return {
    name: "",
    prompt: "",
    format: "text",
    tags: [],
  };
}

export default function TabularReviewDetailPage() {
  const params = useParams<{ review_id: string }>();
  const router = useRouter();
  const reviewId = params.review_id;
  const apiUrl = process.env.NEXT_PUBLIC_EXTRACTOR_API_URL ?? "";
  const { isAuthenticated, authenticatedFetch } = useAuth();
  const { selectedAccountId } = useAccountContext();
  const { setBreadcrumbs } = useBreadcrumbs();

  const [review, setReview] = useState<TabularReview | null>(null);
  const [documents, setDocuments] = useState<TabularDocument[]>([]);
  const [availableDocuments, setAvailableDocuments] = useState<DocumentSummary[]>([]);
  const [cells, setCells] = useState<TabularCell[]>([]);
  const [title, setTitle] = useState("");
  const [projectName, setProjectName] = useState<string | null>(null);
  const [columns, setColumns] = useState<TabularColumnConfig[]>([]);
  const [selectedDocumentIds, setSelectedDocumentIds] = useState<string[]>([]);
  const [selectedRowDocumentIds, setSelectedRowDocumentIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [regeneratingKey, setRegeneratingKey] = useState<string | null>(null);

  const [documentsDialogOpen, setDocumentsDialogOpen] = useState(false);
  const [draftDocumentIds, setDraftDocumentIds] = useState<string[]>([]);
  const [columnDialogOpen, setColumnDialogOpen] = useState(false);
  const [editingColumnPosition, setEditingColumnPosition] = useState<number | null>(null);
  const [columnDraft, setColumnDraft] = useState(emptyColumnDraft());

  const [editingCell, setEditingCell] = useState<TabularCell | null>(null);
  const [editSummary, setEditSummary] = useState("");
  const [editReasoning, setEditReasoning] = useState("");

  const loadAvailableDocuments = useCallback(
    async (projectId?: string | null) => {
      if (!apiUrl || !isAuthenticated) return;
      try {
        const nextDocuments = await listDocuments(apiUrl, authenticatedFetch, {
          contextId: projectId ? selectedAccountId : null,
          projectId: projectId || null,
        });
        setAvailableDocuments(nextDocuments.filter(isIndexedDocument));
      } catch (error) {
        console.error("Failed to load available tabular documents", error);
        setAvailableDocuments([]);
      }
    },
    [apiUrl, authenticatedFetch, isAuthenticated, selectedAccountId],
  );

  const loadReview = useCallback(async () => {
    if (!apiUrl || !isAuthenticated || !reviewId) return;
    setLoading(true);
    try {
      const detail = await getTabularReview(apiUrl, authenticatedFetch, reviewId);
      setReview(detail.review);
      setDocuments(detail.documents);
      setCells(detail.cells);
      setTitle(detail.review.title || "Untitled Review");
      setColumns(detail.review.columns_config || []);
      setSelectedDocumentIds(detail.review.document_ids || []);
      setSelectedRowDocumentIds([]);
      
      if (detail.review.project_id) {
        authenticatedFetch(`${apiUrl}/projects/${detail.review.project_id}`)
          .then((res: any) => {
            if (res.error) throw new Error(res.error);
            return res.data;
          })
          .then((data: any) => {
            if (data && data.name) setProjectName(data.name);
          })
          .catch((error) => console.error("Could not fetch project name:", error));
      } else {
        setProjectName(null);
      }

      await loadAvailableDocuments(detail.review.project_id || null);
    } catch (error) {
      toast({
        title: "Could not load review",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [apiUrl, authenticatedFetch, isAuthenticated, loadAvailableDocuments, reviewId]);

  useEffect(() => {
    if (review) {
      setBreadcrumbs([
        { label: "Reviews", href: "/tabular-reviews" },
        { label: review.title || "Untitled Review" }
      ]);
    } else {
      setBreadcrumbs([{ label: "Reviews", href: "/tabular-reviews" }]);
    }
  }, [review, setBreadcrumbs]);

  useEffect(() => {
    void loadReview();
  }, [loadReview]);

  const normalizedColumns = useMemo(() => normalizeColumns(columns), [columns]);

  const cellMap = useMemo(() => {
    const map = new Map<string, TabularCell>();
    cells.forEach((cell) => {
      map.set(`${cell.document_id}:${cell.column_index}`, cell);
    });
    return map;
  }, [cells]);

  const documentsById = useMemo(() => {
    const map = new Map<string, TabularDocument | DocumentSummary>();
    documents.forEach((document) => map.set(document.id, document));
    availableDocuments.forEach((document) => map.set(document._id, document));
    return map;
  }, [availableDocuments, documents]);

  const tableDocuments = useMemo(
    () =>
      selectedDocumentIds
        .map((documentId) => documentsById.get(documentId))
        .filter((document): document is TabularDocument | DocumentSummary => Boolean(document)),
    [documentsById, selectedDocumentIds],
  );

  const layoutDirty = Boolean(
    review &&
      (title.trim() !== review.title ||
        JSON.stringify(selectedDocumentIds) !== JSON.stringify(review.document_ids) ||
        JSON.stringify(normalizedColumns) !== JSON.stringify(review.columns_config)),
  );

  const totalContentWidth = CHECK_W_PX + DOC_COL_W_PX + normalizedColumns.length * DATA_COL_W_PX + 32;
  const allRowsSelected = tableDocuments.length > 0 && tableDocuments.every((document) => selectedRowDocumentIds.includes(getDocumentId(document)));
  const someRowsSelected = !allRowsSelected && tableDocuments.some((document) => selectedRowDocumentIds.includes(getDocumentId(document)));

  function getCell(documentId: string, columnIndex: number) {
    return cellMap.get(`${documentId}:${columnIndex}`);
  }

  async function persistLayout(
    showToast = true,
    overrides: {
      nextTitle?: string;
      nextDocumentIds?: string[];
      nextColumns?: TabularColumnConfig[];
    } = {},
  ) {
    if (!review) return null;
    const nextTitle = (overrides.nextTitle ?? title).trim();
    const nextDocumentIds = overrides.nextDocumentIds ?? selectedDocumentIds;
    const nextColumns = normalizeColumns(overrides.nextColumns ?? columns);

    if (!nextTitle) {
      toast({ title: "Review title is required", variant: "destructive" });
      return null;
    }

    setSaving(true);
    try {
      const updatedReview = await updateTabularReview(apiUrl, authenticatedFetch, review.id, {
        title: nextTitle,
        document_ids: nextDocumentIds,
        columns_config: nextColumns,
      });
      const detail = await getTabularReview(apiUrl, authenticatedFetch, review.id);
      setReview(updatedReview);
      setDocuments(detail.documents);
      setCells(detail.cells);
      setColumns(detail.review.columns_config || nextColumns);
      setSelectedDocumentIds(detail.review.document_ids || nextDocumentIds);
      setSelectedRowDocumentIds([]);
      setTitle(detail.review.title || nextTitle);
      if (showToast) toast({ title: "Tabular review saved" });
      return detail;
    } catch (error) {
      toast({
        title: "Could not save review",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
      return null;
    } finally {
      setSaving(false);
    }
  }

  async function handleGenerate(force = false) {
    if (!review) return;
    if (!selectedDocumentIds.length || !normalizedColumns.length) {
      toast({ title: "Add documents and columns before running", variant: "destructive" });
      return;
    }

    setGenerating(true);
    try {
      if (layoutDirty) {
        const saved = await persistLayout(false);
        if (!saved) return;
      }
      const result = await generateTabularReview(apiUrl, authenticatedFetch, review.id, force);
      setCells(result.cells);
      toast({
        title: result.generated_count ? "Tabular review generated" : "Table already up to date",
        description: result.generated_count ? `${result.generated_count} cells updated.` : undefined,
      });
    } catch (error) {
      toast({
        title: "Generation failed",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setGenerating(false);
    }
  }

  async function handleRegenerateCell(documentId: string, columnIndex: number) {
    if (!review) return;
    const key = `${documentId}:${columnIndex}`;
    setRegeneratingKey(key);
    try {
      if (layoutDirty) {
        const saved = await persistLayout(false);
        if (!saved) return;
      }
      const nextCell = await regenerateTabularCell(apiUrl, authenticatedFetch, review.id, documentId, columnIndex);
      setCells((current) => {
        const rest = current.filter((cell) => cell.id !== nextCell.id);
        return [...rest, nextCell];
      });
      setEditingCell((current) => {
        if (!current || current.document_id !== documentId || current.column_index !== columnIndex) return current;
        setEditSummary(nextCell.summary || "");
        setEditReasoning(nextCell.reasoning || "");
        return nextCell;
      });
    } catch (error) {
      toast({
        title: "Could not regenerate cell",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setRegeneratingKey(null);
    }
  }

  async function handleExport() {
    const rows = tableDocuments.map((document) => {
      const documentId = getDocumentId(document);
      const row: Record<string, string> = { Document: documentLabel(document) };
      normalizedColumns.forEach((column) => {
        row[column.name] = getCell(documentId, column.index)?.summary || "";
      });
      return row;
    });
    downloadCsv(`${sanitizeFilename(title)}.csv`, rows);
  }

  function openCellEditor(cell: TabularCell | undefined) {
    if (!cell?.id) return;
    setEditingCell(cell);
    setEditSummary(cell.summary || "");
    setEditReasoning(cell.reasoning || "");
  }

  async function handleSaveCell() {
    if (!review || !editingCell) return;
    try {
      const nextCell = await updateTabularCell(apiUrl, authenticatedFetch, review.id, editingCell.id, {
        summary: editSummary,
        reasoning: editReasoning,
        status: "done",
      });
      setCells((current) => current.map((cell) => (cell.id === nextCell.id ? nextCell : cell)));
      setEditingCell(null);
      toast({ title: "Cell updated" });
    } catch (error) {
      toast({
        title: "Could not update cell",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    }
  }

  function toggleAllRows() {
    setSelectedRowDocumentIds(allRowsSelected ? [] : tableDocuments.map(getDocumentId));
  }

  function toggleRow(documentId: string) {
    setSelectedRowDocumentIds((current) =>
      current.includes(documentId) ? current.filter((id) => id !== documentId) : [...current, documentId],
    );
  }

  function openDocumentsDialog() {
    setDraftDocumentIds(selectedDocumentIds);
    setDocumentsDialogOpen(true);
  }

  function toggleDraftDocument(documentId: string) {
    setDraftDocumentIds((current) =>
      current.includes(documentId) ? current.filter((id) => id !== documentId) : [...current, documentId],
    );
  }

  async function handleSaveDocuments() {
    setDocumentsDialogOpen(false);
    await persistLayout(false, { nextDocumentIds: draftDocumentIds });
  }

  async function handleDeleteSelectedDocuments() {
    if (!selectedRowDocumentIds.length) return;
    const nextDocumentIds = selectedDocumentIds.filter((documentId) => !selectedRowDocumentIds.includes(documentId));
    await persistLayout(false, { nextDocumentIds });
  }

  function openColumnDialog(position?: number) {
    if (typeof position === "number") {
      const column = normalizedColumns[position];
      setEditingColumnPosition(position);
      setColumnDraft({
        name: column?.name || "",
        prompt: column?.prompt || "",
        format: column?.format || "text",
        tags: column?.tags || [],
      });
    } else {
      setEditingColumnPosition(null);
      setColumnDraft(emptyColumnDraft());
    }
    setColumnDialogOpen(true);
  }

  async function handleSaveColumn() {
    const name = columnDraft.name.trim();
    const prompt = columnDraft.prompt.trim();
    if (!name || !prompt) {
      toast({ title: "Column name and prompt are required", variant: "destructive" });
      return;
    }

    const nextColumn: TabularColumnConfig = {
      index: editingColumnPosition ?? normalizedColumns.length,
      name,
      prompt,
      format: columnDraft.format || "text",
      tags: columnDraft.tags?.filter((tag) => tag.trim()),
    };
    const nextColumns =
      editingColumnPosition === null
        ? [...normalizedColumns, nextColumn]
        : normalizedColumns.map((column, index) => (index === editingColumnPosition ? { ...nextColumn, index } : column));

    setColumnDialogOpen(false);
    await persistLayout(false, { nextColumns });
  }

  async function handleDeleteColumn(position: number) {
    const nextColumns = normalizedColumns
      .filter((_, index) => index !== position)
      .map((column, index) => ({ ...column, index }));
    await persistLayout(false, { nextColumns });
  }

  function renderCell(cell: TabularCell | undefined, column: TabularColumnConfig, documentId: string) {
    const key = `${documentId}:${column.index}`;
    if (cell?.status === "running" || regeneratingKey === key) {
      return (
        <div className="flex h-10 items-center px-2">
          <div className="h-4 w-full animate-pulse rounded bg-gray-100" />
        </div>
      );
    }

    if (cell?.status === "error") {
      return (
        <button
          type="button"
          onClick={() => openCellEditor(cell)}
          className="flex h-10 w-full items-center justify-center text-red-300 transition-colors hover:bg-gray-50"
          title={cell.error || "Generation failed"}
        >
          <AlertCircle className="h-4 w-4" />
        </button>
      );
    }

    if (!cell?.summary) return <div className="h-10" />;

    return (
      <button
        type="button"
        onClick={() => openCellEditor(cell)}
        className="group relative flex h-10 w-full items-center px-2 text-left text-xs leading-relaxed text-gray-800 transition-colors hover:bg-gray-50"
      >
        <span className="line-clamp-1 w-full min-w-0">{cellText(cell)}</span>
      </button>
    );
  }

  if (!isAuthenticated || loading) {
    return <LoadingScreen />;
  }

  if (!review) {
    return (
      <main className="flex min-h-[calc(100vh-4rem)] items-center justify-center bg-background px-6 text-center">
        <div>
          <Table2 className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
          <h1 className="text-lg font-semibold text-foreground">Review not found</h1>
          <Button asChild className="mt-4">
            <Link href="/tabular-reviews">Back to reviews</Link>
          </Button>
        </div>
      </main>
    );
  }

  return (
    <main className="flex flex-col h-[calc(100vh-4rem)] min-h-0 bg-background text-foreground">
      <div className="flex shrink-0 flex-col gap-4 border-b border-border bg-background px-6 py-4 md:px-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              onBlur={() => {
                if (layoutDirty) void persistLayout(false);
              }}
              placeholder="Review title"
              className="text-3xl font-bold tracking-tight text-foreground bg-transparent border-none outline-none focus:ring-0 p-0 m-0 w-full placeholder:text-muted-foreground/50"
            />
            {projectName && (
              <div className="flex items-center gap-1.5 text-sm text-muted-foreground ml-0.5">
                <FolderOpen className="h-4 w-4 shrink-0" />
                <span className="font-medium text-foreground/80">Project:</span>
                <span className="truncate">{projectName}</span>
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {saving && (
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground mr-2">
                <Loader2 className="h-3 w-3 animate-spin" />
                Saving
              </span>
            )}

            {selectedRowDocumentIds.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="h-8 gap-1.5 bg-card">
                    Actions
                    <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-36">
                  <DropdownMenuItem
                    onClick={() => void handleDeleteSelectedDocuments()}
                    className="text-destructive focus:bg-destructive/10 focus:text-destructive cursor-pointer"
                  >
                    Delete Selected
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}

            <Button
              variant="outline"
              size="sm"
              onClick={openDocumentsDialog}
              disabled={saving}
              className="h-8 gap-1.5 bg-card"
            >
              <Upload className="h-3.5 w-3.5" />
              Documents
            </Button>

            <Button
              variant="outline"
              size="sm"
              onClick={() => openColumnDialog()}
              disabled={saving}
              className="h-8 gap-1.5 bg-card"
            >
              <Plus className="h-3.5 w-3.5" />
              Columns
            </Button>

            <Button
              variant="outline"
              size="sm"
              onClick={handleExport}
              disabled={normalizedColumns.length === 0 || tableDocuments.length === 0}
              className="h-8 gap-1.5 bg-card"
              title="Export to CSV"
            >
              <Download className="h-3.5 w-3.5" />
              Export
            </Button>

            <Button
              size="sm"
              onClick={() => void handleGenerate(false)}
              disabled={generating || normalizedColumns.length === 0 || tableDocuments.length === 0 || saving}
              className="h-8 gap-1.5"
            >
              {generating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
              {generating ? "Starting..." : "Start Review"}
            </Button>
          </div>
        </div>
      </div>

        <div className="flex min-h-0 flex-1 overflow-hidden">
          {normalizedColumns.length === 0 && tableDocuments.length === 0 ? (
            <div className="flex flex-1 flex-col overflow-hidden">
              <div className="flex items-center border-b border-border bg-muted/30 h-12">
                <div className={`${CHECK_W} border-r border-border h-full`} />
                <div className={`${DOC_COL_W} border-r border-border p-4 text-xs uppercase tracking-wider font-bold text-muted-foreground select-none h-full flex items-center`}>
                  Document
                </div>
                <div className="flex-1" />
              </div>
              <div className="mx-auto flex w-full max-w-sm flex-1 flex-col items-center justify-center text-center">
                <Table2 className="mb-4 h-12 w-12 text-muted-foreground/50" />
                <h2 className="text-xl font-semibold text-foreground">Tabular Review</h2>
                <p className="mt-2 text-sm text-muted-foreground">Add columns and documents to get started with your review.</p>
                <div className="mt-6 flex flex-wrap justify-center gap-3">
                  <Button
                    onClick={() => openColumnDialog()}
                  >
                    <Plus className="h-4 w-4 mr-2" />
                    Add Columns
                  </Button>
                  <Button
                    variant="outline"
                    onClick={openDocumentsDialog}
                  >
                    <Upload className="h-4 w-4 mr-2" />
                    Add Documents
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex flex-1 flex-col overflow-auto">
              <div className="sticky top-0 z-20 flex h-12 bg-muted border-b border-border text-xs uppercase tracking-wider font-bold text-foreground" style={{ minWidth: totalContentWidth }}>
                <div className={`sticky left-0 z-30 ${CHECK_W} flex items-center justify-center border-r border-border bg-muted select-none`}>
                  <input
                    type="checkbox"
                    checked={allRowsSelected}
                    ref={(element) => {
                      if (element) element.indeterminate = someRowsSelected;
                    }}
                    onChange={toggleAllRows}
                    className="h-2.5 w-2.5 cursor-pointer rounded border-gray-200 accent-black"
                  />
                </div>
                <div className={`sticky left-8 z-30 ${DOC_COL_W} border-r border-border bg-muted p-4 text-left select-none hover:text-foreground hover:underline transition-all duration-300 cursor-pointer`}>
                  Document
                </div>
                {normalizedColumns.map((column, position) => (
                  <div
                    key={column.index}
                    className={`${DATA_COL_W} border-r border-border p-4 text-left select-none`}
                  >
                    <div className="flex items-center justify-between gap-3 hover:text-foreground hover:underline transition-all duration-300 cursor-pointer">
                      <span className="truncate">{column.name}</span>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button
                            type="button"
                            className="flex h-5 w-5 items-center justify-center rounded text-gray-300 transition-colors hover:bg-gray-100 hover:text-gray-700"
                            aria-label={`Column actions for ${column.name}`}
                          >
                            <MoreHorizontal className="h-3.5 w-3.5" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-32 rounded-lg border-gray-100 bg-white p-0 shadow-lg">
                          <DropdownMenuItem
                            onClick={() => openColumnDialog(position)}
                            className="cursor-pointer px-3 py-1.5 text-xs text-gray-700 focus:bg-gray-50"
                          >
                            Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => void handleDeleteColumn(position)}
                            className="cursor-pointer px-3 py-1.5 text-xs text-red-600 focus:bg-red-50 focus:text-red-600"
                          >
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                ))}
                <div className="flex min-w-8 flex-1 items-center justify-start p-4">
                  <button
                    type="button"
                    onClick={() => openColumnDialog()}
                    disabled={saving}
                    className="flex items-center justify-center text-gray-400 transition-colors hover:text-gray-700 disabled:text-gray-200"
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                </div>
              </div>

              <div className="relative min-h-0 flex-1">
                {tableDocuments.map((document, documentIndex) => {
                  const documentId = getDocumentId(document);
                  const baseRowBg = "bg-card transition-colors hover:bg-muted";
                  const rowBg = selectedRowDocumentIds.includes(documentId) ? "bg-muted" : baseRowBg;

                  return (
                    <div key={documentId} className={`group flex min-h-[48px] items-stretch border-b border-border text-sm ${rowBg}`} style={{ minWidth: totalContentWidth }}>
                      <div className={`sticky left-0 z-30 ${CHECK_W} flex items-center justify-center border-r border-border p-2 ${selectedRowDocumentIds.includes(documentId) ? "bg-muted" : "bg-card group-hover:bg-muted transition-colors"}`}>
                        <input
                          type="checkbox"
                          checked={selectedRowDocumentIds.includes(documentId)}
                          onChange={() => toggleRow(documentId)}
                          className="h-2.5 w-2.5 shrink-0 cursor-pointer rounded border-gray-200 accent-black"
                        />
                      </div>
                      <div className={`sticky left-8 z-30 ${DOC_COL_W} flex items-center border-r border-border p-4 font-medium text-foreground ${selectedRowDocumentIds.includes(documentId) ? "bg-muted" : "bg-card group-hover:bg-muted transition-colors"}`}>
                        <span className="line-clamp-1" title={documentLabel(document)}>
                          {documentLabel(document)}
                        </span>
                      </div>
                      {normalizedColumns.map((column) => (
                        <div key={column.index} className={`${DATA_COL_W} border-r border-border`}>
                          {renderCell(getCell(documentId, column.index), column, documentId)}
                        </div>
                      ))}
                      <div className="min-h-8 min-w-8 flex-1" />
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

      <Dialog open={documentsDialogOpen} onOpenChange={setDocumentsDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="text-xl font-semibold">Add Documents</DialogTitle>
          </DialogHeader>
          <div className="max-h-96 overflow-y-auto rounded-xl border border-border">
            {availableDocuments.length > 0 ? (
              availableDocuments.map((document) => {
                const checked = draftDocumentIds.includes(document._id);
                return (
                  <button
                    key={document._id}
                    type="button"
                    onClick={() => toggleDraftDocument(document._id)}
                    className="flex w-full items-start gap-3 border-b border-border/50 px-3 py-2 text-left transition-colors last:border-0 hover:bg-muted/30"
                  >
                    <span className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                      checked ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background"
                    }`}>
                      {checked && <Check className="h-3 w-3" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-foreground">{document.contract_name}</span>
                      <span className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                        <FileText className="h-3.5 w-3.5" />
                        {document.status}
                      </span>
                    </span>
                  </button>
                );
              })
            ) : (
              <div className="px-3 py-8 text-center text-sm text-muted-foreground">No indexed documents found</div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDocumentsDialogOpen(false)}>Cancel</Button>
            <Button onClick={() => void handleSaveDocuments()}>
              Add Documents
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={columnDialogOpen} onOpenChange={setColumnDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="text-xl font-semibold">
              {editingColumnPosition === null ? "New column" : "Edit column"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <Input
              value={columnDraft.name}
              onChange={(event) => setColumnDraft((current) => ({ ...current, name: event.target.value }))}
              placeholder="Column name"
            />
            <Textarea
              value={columnDraft.prompt}
              onChange={(event) => setColumnDraft((current) => ({ ...current, prompt: event.target.value }))}
              placeholder="Extraction prompt"
              className="min-h-40"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setColumnDialogOpen(false)}>Cancel</Button>
            <Button onClick={() => void handleSaveColumn()}>
              {editingColumnPosition === null ? <Plus className="h-4 w-4 mr-2" /> : <Save className="h-4 w-4 mr-2" />}
              {editingColumnPosition === null ? "Add Column" : "Save Column"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(editingCell)} onOpenChange={(open) => !open && setEditingCell(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="text-xl font-semibold">Cell details</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-foreground">Summary</label>
              <Textarea value={editSummary} onChange={(event) => setEditSummary(event.target.value)} className="min-h-32" />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-foreground">Reasoning and citations</label>
              <Textarea value={editReasoning} onChange={(event) => setEditReasoning(event.target.value)} className="min-h-36" />
            </div>
            {editingCell?.citations?.length ? (
              <div className="flex flex-wrap gap-1">
                {editingCell.citations.slice(0, 6).map((citation, citationIndex) => (
                  <Badge key={`${citation.page}-${citationIndex}`} variant="outline" className="rounded-full px-2 py-0 text-[10px] text-muted-foreground">
                    Page {citation.page || "?"}
                  </Badge>
                ))}
              </div>
            ) : null}
          </div>
          <DialogFooter className="items-center justify-between sm:justify-between">
            <Button
              variant="outline"
              onClick={() => {
                if (editingCell) void handleRegenerateCell(editingCell.document_id, editingCell.column_index);
              }}
              disabled={!editingCell || regeneratingKey === `${editingCell.document_id}:${editingCell.column_index}`}
            >
              {editingCell && regeneratingKey === `${editingCell.document_id}:${editingCell.column_index}` ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <RefreshCw className="h-4 w-4 mr-2" />
              )}
              Regenerate
            </Button>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setEditingCell(null)}>Cancel</Button>
              <Button onClick={handleSaveCell}>
                <Save className="h-4 w-4 mr-2" />
                Save Cell
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}
