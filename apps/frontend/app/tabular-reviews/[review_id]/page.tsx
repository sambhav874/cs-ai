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

import LoadingScreen from "@/components/animation/LoadingScreen";
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

  const [review, setReview] = useState<TabularReview | null>(null);
  const [documents, setDocuments] = useState<TabularDocument[]>([]);
  const [availableDocuments, setAvailableDocuments] = useState<DocumentSummary[]>([]);
  const [cells, setCells] = useState<TabularCell[]>([]);
  const [title, setTitle] = useState("");
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
    return <LoadingScreen message="Loading tabular review..." />;
  }

  if (!review) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-gray-50 px-6 text-center">
        <div>
          <Table2 className="mx-auto mb-3 h-8 w-8 text-gray-300" />
          <h1 className="text-lg font-semibold text-gray-950">Review not found</h1>
          <Button asChild className="mt-4 rounded-lg">
            <Link href="/tabular-reviews">Back to reviews</Link>
          </Button>
        </div>
      </main>
    );
  }

  return (
    <main className="flex h-[calc(100vh-56px)] min-h-0 overflow-hidden bg-white text-gray-950">
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden bg-white">
        <div className="mb-1 flex shrink-0 items-start justify-between gap-4 bg-white px-4 py-3 md:px-10">
          <div className="flex min-w-0 items-center gap-1.5 font-serif text-2xl font-medium">
            <button
              type="button"
              onClick={() => router.push("/tabular-reviews")}
              className="shrink-0 text-gray-500 transition-colors hover:text-gray-700"
            >
              Tabular Reviews
            </button>
            <span className="shrink-0 text-gray-300">›</span>
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              onBlur={() => {
                if (layoutDirty) void persistLayout(false);
              }}
              className="min-w-0 flex-1 bg-transparent text-gray-900 outline-none"
            />
            {review.project_id && (
              <Badge variant="outline" className="ml-2 shrink-0 rounded-full border-gray-200 bg-white px-2.5 py-0.5 text-xs font-sans text-gray-500">
                Project
              </Badge>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={handleExport}
              disabled={normalizedColumns.length === 0 || tableDocuments.length === 0}
              className={`flex h-8 items-center justify-center gap-1.5 px-3 text-sm transition-colors ${
                normalizedColumns.length === 0 || tableDocuments.length === 0
                  ? "cursor-default text-gray-300"
                  : "cursor-pointer text-gray-700 hover:text-gray-900"
              }`}
              title="Export to CSV"
            >
              <Download className="h-4 w-4" />
              Export
            </button>
          </div>
        </div>

        <div className="flex h-10 shrink-0 items-center gap-4 border-b border-gray-200 px-4 md:px-10">
          <button
            type="button"
            disabled
            className="flex cursor-default items-center gap-1 text-xs font-medium text-gray-300"
            title="Tabular assistant is not wired in ContractSense yet"
          >
            <MessageSquare className="h-3.5 w-3.5" />
            Assistant in Tabular Review
          </button>

          <div className="ml-auto flex items-center gap-5">
            {selectedRowDocumentIds.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="flex items-center gap-1 text-xs font-medium text-gray-600 transition-colors hover:text-gray-900"
                  >
                    Actions
                    <ChevronDown className="h-3.5 w-3.5" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-36 rounded-lg border-gray-100 bg-white p-0 shadow-lg">
                  <DropdownMenuItem
                    onClick={() => void handleDeleteSelectedDocuments()}
                    className="cursor-pointer px-3 py-1.5 text-xs text-red-600 focus:bg-red-50 focus:text-red-600"
                  >
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            {saving && (
              <span className="flex items-center gap-1 text-xs text-gray-300">
                <Loader2 className="h-3 w-3 animate-spin" />
                Saving
              </span>
            )}
            <button
              type="button"
              onClick={() => void handleGenerate(false)}
              disabled={generating || normalizedColumns.length === 0 || tableDocuments.length === 0 || saving}
              className={`inline-flex h-7 items-center justify-center gap-1.5 rounded-md px-3 text-xs font-semibold shadow-sm transition-colors ${
                generating || normalizedColumns.length === 0 || tableDocuments.length === 0 || saving
                  ? "cursor-default bg-gray-200 text-gray-400 shadow-none"
                  : "bg-gray-950 text-white hover:bg-gray-800"
              }`}
              title="Start tabular review"
            >
              {generating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
              {generating ? "Starting..." : "Start"}
            </button>
            <button
              type="button"
              onClick={openDocumentsDialog}
              disabled={saving}
              className={`flex items-center gap-1 text-xs font-medium transition-colors ${
                saving ? "cursor-default text-gray-300" : "text-gray-700 hover:text-gray-900"
              }`}
            >
              <Upload className="h-3.5 w-3.5" />
              Add Documents
            </button>
            <button
              type="button"
              onClick={() => openColumnDialog()}
              disabled={saving}
              className={`flex items-center gap-1 text-xs font-medium transition-colors ${
                saving ? "cursor-default text-gray-300" : "text-gray-700 hover:text-gray-900"
              }`}
            >
              <Plus className="h-3.5 w-3.5" />
              Add Columns
            </button>
          </div>
        </div>

        <div className="flex min-h-0 flex-1 overflow-hidden">
          {normalizedColumns.length === 0 && tableDocuments.length === 0 ? (
            <div className="flex flex-1 flex-col overflow-hidden">
              <div className="flex items-center border-b border-gray-200">
                <div className={`${CHECK_W} border-r border-gray-200`} />
                <div className={`${DOC_COL_W} border-r border-gray-200 p-2 text-xs font-medium text-gray-500 select-none`}>
                  Document
                </div>
                <div className="flex-1" />
              </div>
              <div className="mx-auto flex w-full max-w-xs flex-1 flex-col items-start justify-center">
                <Table2 className="mb-4 h-8 w-8 text-gray-300" />
                <p className="font-serif text-2xl font-medium text-gray-900">Tabular Review</p>
                <p className="mt-1 text-left text-xs text-gray-400">Add columns and documents to get started.</p>
                <div className="mt-4 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => openColumnDialog()}
                    className="inline-flex items-center gap-1 rounded-full bg-gray-900 px-3 py-1 text-xs font-medium text-white shadow-md transition-colors hover:bg-gray-700"
                  >
                    + Add Columns
                  </button>
                  <button
                    type="button"
                    onClick={openDocumentsDialog}
                    className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-white px-3 py-1 text-xs font-medium text-gray-600 shadow-sm transition-colors hover:bg-gray-50"
                  >
                    <Upload className="h-3.5 w-3.5" />
                    Add Documents
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex flex-1 flex-col overflow-auto">
              <div className="sticky top-0 z-20 flex h-8 bg-white" style={{ minWidth: totalContentWidth }}>
                <div className={`sticky left-0 z-30 ${CHECK_W} flex items-center justify-center border-b border-r border-gray-200 bg-white select-none`}>
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
                <div className={`sticky left-8 z-30 ${DOC_COL_W} border-b border-r border-gray-200 bg-white p-2 text-left text-xs font-medium text-gray-500 select-none`}>
                  Document
                </div>
                {normalizedColumns.map((column, position) => (
                  <div
                    key={column.index}
                    className={`${DATA_COL_W} border-b border-r border-gray-200 p-2 text-left text-xs font-medium text-gray-500 select-none`}
                  >
                    <div className="flex items-center justify-between gap-3">
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
                <div className="flex min-w-8 flex-1 items-center justify-start border-b border-gray-200 p-2">
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
                  const baseRowBg = documentIndex % 2 === 0 ? "bg-white" : "bg-gray-50";
                  const rowBg = selectedRowDocumentIds.includes(documentId) ? "bg-gray-100" : baseRowBg;

                  return (
                    <div key={documentId} className={`flex ${rowBg}`} style={{ minWidth: totalContentWidth }}>
                      <div className={`sticky left-0 z-[60] ${CHECK_W} flex items-center justify-center border-b border-r border-gray-200 p-2 ${rowBg}`}>
                        <input
                          type="checkbox"
                          checked={selectedRowDocumentIds.includes(documentId)}
                          onChange={() => toggleRow(documentId)}
                          className="h-2.5 w-2.5 shrink-0 cursor-pointer rounded border-gray-200 accent-black"
                        />
                      </div>
                      <div className={`sticky left-8 z-[60] ${DOC_COL_W} flex items-center border-b border-r border-gray-200 p-2 text-xs text-gray-800 ${baseRowBg}`}>
                        <span className="line-clamp-1" title={documentLabel(document)}>
                          {documentLabel(document)}
                        </span>
                      </div>
                      {normalizedColumns.map((column) => (
                        <div key={column.index} className={`${DATA_COL_W} border-b border-r border-gray-200`}>
                          {renderCell(getCell(documentId, column.index), column, documentId)}
                        </div>
                      ))}
                      <div className="min-h-8 min-w-8 flex-1 border-b border-gray-200" />
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      <Dialog open={documentsDialogOpen} onOpenChange={setDocumentsDialogOpen}>
        <DialogContent className="max-w-2xl rounded-2xl">
          <DialogHeader>
            <DialogTitle className="font-serif text-2xl font-medium">Add Documents</DialogTitle>
          </DialogHeader>
          <div className="max-h-96 overflow-y-auto rounded-xl border border-gray-100">
            {availableDocuments.length > 0 ? (
              availableDocuments.map((document) => {
                const checked = draftDocumentIds.includes(document._id);
                return (
                  <button
                    key={document._id}
                    type="button"
                    onClick={() => toggleDraftDocument(document._id)}
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
          <DialogFooter>
            <Button variant="outline" onClick={() => setDocumentsDialogOpen(false)} className="rounded-lg">Cancel</Button>
            <Button onClick={() => void handleSaveDocuments()} className="rounded-lg bg-gray-950 text-white hover:bg-gray-800">
              Add Documents
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={columnDialogOpen} onOpenChange={setColumnDialogOpen}>
        <DialogContent className="max-w-2xl rounded-2xl">
          <DialogHeader>
            <DialogTitle className="font-serif text-2xl font-medium">
              {editingColumnPosition === null ? "New column" : "Edit column"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <Input
              value={columnDraft.name}
              onChange={(event) => setColumnDraft((current) => ({ ...current, name: event.target.value }))}
              placeholder="Column name"
              className="h-11 rounded-lg text-base"
            />
            <Textarea
              value={columnDraft.prompt}
              onChange={(event) => setColumnDraft((current) => ({ ...current, prompt: event.target.value }))}
              placeholder="Extraction prompt"
              className="min-h-40 rounded-lg text-sm leading-6"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setColumnDialogOpen(false)} className="rounded-lg">Cancel</Button>
            <Button onClick={() => void handleSaveColumn()} className="rounded-lg bg-gray-950 text-white hover:bg-gray-800">
              {editingColumnPosition === null ? <Plus className="h-4 w-4" /> : <Save className="h-4 w-4" />}
              {editingColumnPosition === null ? "Add Column" : "Save Column"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(editingCell)} onOpenChange={(open) => !open && setEditingCell(null)}>
        <DialogContent className="max-w-3xl rounded-2xl">
          <DialogHeader>
            <DialogTitle className="font-serif text-2xl font-medium">Cell details</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700">Summary</label>
              <Textarea value={editSummary} onChange={(event) => setEditSummary(event.target.value)} className="min-h-32 rounded-lg" />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700">Reasoning and citations</label>
              <Textarea value={editReasoning} onChange={(event) => setEditReasoning(event.target.value)} className="min-h-36 rounded-lg" />
            </div>
            {editingCell?.citations?.length ? (
              <div className="flex flex-wrap gap-1">
                {editingCell.citations.slice(0, 6).map((citation, citationIndex) => (
                  <Badge key={`${citation.page}-${citationIndex}`} variant="outline" className="rounded-full px-2 py-0 text-[10px] text-gray-500">
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
              className="rounded-lg"
            >
              {editingCell && regeneratingKey === `${editingCell.document_id}:${editingCell.column_index}` ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              Regenerate
            </Button>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setEditingCell(null)} className="rounded-lg">Cancel</Button>
              <Button onClick={handleSaveCell} className="rounded-lg bg-gray-950 text-white hover:bg-gray-800">
                <Save className="h-4 w-4" />
                Save Cell
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}
