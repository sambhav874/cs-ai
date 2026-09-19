import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarClock, FileText, Link2, RefreshCw, Pencil, Plus, Trash2, Loader2 } from "lucide-react";
import { useAuth } from "@cs/hooks/useAuth";
import { Badge } from "@cs/components/ui/badge";
import { Button } from "@cs/components/ui/button";
import { Skeleton } from "@cs/components/ui/skeleton";
import { Input } from "@cs/components/ui/input";
import { Textarea } from "@cs/components/ui/textarea";
import { Label } from "@cs/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@cs/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@cs/components/ui/dialog";
import { formatDate } from "@cs/components/dashboard/utils";

interface RelatedDocument {
  contract_id: string | null;
  filename: string;
  relation_type: string;
  evidence_quote: string;
}

interface TimelineDoc {
  memory_id: string;
  contract_id: string;
  filename: string;
  uploaded_at: string;
  // A "failed" record (RAG extraction couldn't parse a JSON overview, e.g.
  // thin evidence on a short document) has none of these — only the fields
  // above plus status/raw_answer_snippet.
  doc_type?: string;
  parties?: string[];
  effective_date?: string | null;
  purpose_summary?: string;
  key_topics?: string[];
  related_documents?: RelatedDocument[];
  status: "success" | "failed";
  edited_at?: string | null;
  related_uploads: TimelineDoc[];
}

interface ProjectTimelineProps {
  projectId: string;
  /** Called after a card edit saves — the edit re-renders that document's
   * memory concept, so the parent can refetch the memory panel. */
  onMemoryChanged?: () => void;
}

const DOC_TYPE_LABEL: Record<string, string> = {
  main_agreement: "Main Agreement",
  schedule: "Schedule",
  annex: "Annex",
  amendment: "Amendment",
  exhibit: "Exhibit",
  sow: "SOW",
  other: "Other",
};

const DOC_TYPE_OPTIONS = Object.keys(DOC_TYPE_LABEL);

function docTypeLabel(value: string): string {
  return DOC_TYPE_LABEL[value] || value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function flattenDocs(docs: TimelineDoc[]): { contract_id: string; filename: string }[] {
  const out: { contract_id: string; filename: string }[] = [];
  for (const doc of docs) {
    out.push({ contract_id: doc.contract_id, filename: doc.filename });
    if (doc.related_uploads?.length) out.push(...flattenDocs(doc.related_uploads));
  }
  return out;
}

interface EditRelation {
  contract_id: string;
  relation_type: string;
}

interface EditFormState {
  doc_type: string;
  parties: string;
  effective_date: string;
  purpose_summary: string;
  key_topics: string;
  related: EditRelation[];
}

function toFormState(doc: TimelineDoc): EditFormState {
  return {
    doc_type: doc.doc_type || "other",
    parties: (doc.parties || []).join(", "),
    effective_date: doc.effective_date || "",
    purpose_summary: doc.purpose_summary || "",
    key_topics: (doc.key_topics || []).join(", "),
    related: (doc.related_documents || [])
      .filter((r) => r.contract_id)
      .map((r) => ({ contract_id: r.contract_id as string, relation_type: r.relation_type || "references" })),
  };
}

function EditMemoryDialog({
  doc,
  siblings,
  open,
  onOpenChange,
  onSave,
}: {
  doc: TimelineDoc;
  siblings: { contract_id: string; filename: string }[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (updates: Record<string, any>) => Promise<boolean>;
}) {
  const [form, setForm] = useState<EditFormState>(() => toFormState(doc));
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setForm(toFormState(doc));
      setSaveError(null);
    }
  }, [open, doc]);

  const otherDocs = siblings.filter((s) => s.contract_id !== doc.contract_id);

  const handleSave = async () => {
    setIsSaving(true);
    setSaveError(null);
    const updates = {
      doc_type: form.doc_type,
      parties: form.parties.split(",").map((p) => p.trim()).filter(Boolean),
      effective_date: form.effective_date.trim() || null,
      purpose_summary: form.purpose_summary.trim(),
      key_topics: form.key_topics.split(",").map((t) => t.trim()).filter(Boolean),
      related_documents: form.related
        .filter((r) => r.contract_id)
        .map((r) => ({ contract_id: r.contract_id, relation_type: r.relation_type.trim() || "references" })),
    };
    const ok = await onSave(updates);
    setIsSaving(false);
    if (ok) onOpenChange(false);
    else setSaveError("Failed to save changes. Try again.");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-sm">Edit memory — {doc.filename}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-2">
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">Document type</Label>
            <Select value={form.doc_type} onValueChange={(v) => setForm((f) => ({ ...f, doc_type: v }))}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DOC_TYPE_OPTIONS.map((opt) => (
                  <SelectItem key={opt} value={opt} className="text-xs">
                    {docTypeLabel(opt)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">Parties (comma-separated)</Label>
            <Input
              value={form.parties}
              onChange={(e) => setForm((f) => ({ ...f, parties: e.target.value }))}
              className="h-8 text-xs"
              placeholder="Party A, Party B"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">Effective date</Label>
            <Input
              value={form.effective_date}
              onChange={(e) => setForm((f) => ({ ...f, effective_date: e.target.value }))}
              className="h-8 text-xs"
              placeholder="e.g. 1 June 2026"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">Purpose summary</Label>
            <Textarea
              value={form.purpose_summary}
              onChange={(e) => setForm((f) => ({ ...f, purpose_summary: e.target.value }))}
              className="min-h-[72px] text-xs"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">Key topics (comma-separated)</Label>
            <Input
              value={form.key_topics}
              onChange={(e) => setForm((f) => ({ ...f, key_topics: e.target.value }))}
              className="h-8 text-xs"
              placeholder="Term, Liability, Governing Law"
            />
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs">Relates to</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-6 gap-1 text-[11px]"
                disabled={otherDocs.length === 0}
                onClick={() =>
                  setForm((f) => ({
                    ...f,
                    related: [...f.related, { contract_id: otherDocs[0]?.contract_id || "", relation_type: "references" }],
                  }))
                }
              >
                <Plus className="h-3 w-3" /> Add relation
              </Button>
            </div>

            {form.related.length === 0 && (
              <p className="text-[11px] text-muted-foreground">No relations set.</p>
            )}

            {form.related.map((rel, i) => (
              <div key={i} className="flex items-center gap-1.5">
                <Select
                  value={rel.contract_id}
                  onValueChange={(v) =>
                    setForm((f) => ({
                      ...f,
                      related: f.related.map((r, idx) => (idx === i ? { ...r, contract_id: v } : r)),
                    }))
                  }
                >
                  <SelectTrigger className="h-8 flex-1 text-xs">
                    <SelectValue placeholder="Select document" />
                  </SelectTrigger>
                  <SelectContent>
                    {otherDocs.map((s) => (
                      <SelectItem key={s.contract_id} value={s.contract_id} className="text-xs">
                        {s.filename}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  value={rel.relation_type}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      related: f.related.map((r, idx) => (idx === i ? { ...r, relation_type: e.target.value } : r)),
                    }))
                  }
                  className="h-8 w-28 text-xs"
                  placeholder="amends"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0"
                  onClick={() => setForm((f) => ({ ...f, related: f.related.filter((_, idx) => idx !== i) }))}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </div>

          {saveError && <p className="text-xs text-destructive">{saveError}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={isSaving}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleSave} disabled={isSaving} className="gap-1.5">
            {isSaving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TimelineEntry({
  doc,
  isChild = false,
  allDocs,
  onSaveEdit,
}: {
  doc: TimelineDoc;
  isChild?: boolean;
  allDocs: { contract_id: string; filename: string }[];
  onSaveEdit: (contractId: string, updates: Record<string, any>) => Promise<boolean>;
}) {
  const [editOpen, setEditOpen] = useState(false);

  return (
    <div className={isChild ? "ml-8 mt-3 border-l-2 border-border pl-4" : ""}>
      <div className="rounded-lg border border-border bg-card p-4 shadow-e1">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="text-sm font-medium text-foreground">{doc.filename}</span>
            {doc.status === "failed" ? (
              <Badge variant="destructive" className="text-[10px]">Overview unavailable</Badge>
            ) : (
              <Badge variant="secondary" className="text-[10px]">{docTypeLabel(doc.doc_type || "other")}</Badge>
            )}
            {doc.edited_at && (
              <Badge variant="outline" className="text-[10px] font-normal">Edited</Badge>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
            <CalendarClock className="h-3.5 w-3.5" />
            {formatDate(doc.uploaded_at)}
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setEditOpen(true)}>
              <Pencil className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        {doc.purpose_summary && (
          <p className="mt-2 text-sm text-muted-foreground">{doc.purpose_summary}</p>
        )}

        {((doc.parties?.length ?? 0) > 0 || doc.effective_date) && (
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            {(doc.parties?.length ?? 0) > 0 && <span>Parties: {doc.parties!.join(", ")}</span>}
            {doc.effective_date && <span>· Effective: {doc.effective_date}</span>}
          </div>
        )}

        {(doc.key_topics?.length ?? 0) > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {doc.key_topics!.map((topic) => (
              <Badge key={topic} variant="outline" className="text-[10px] font-normal">{topic}</Badge>
            ))}
          </div>
        )}

        {(doc.related_documents?.length ?? 0) > 0 && (
          <div className="mt-3 flex flex-col gap-1 border-t border-border pt-2">
            {doc.related_documents!.map((rel, i) => (
              <div key={i} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Link2 className="h-3 w-3 shrink-0" />
                <span>
                  {rel.relation_type} <span className="text-foreground">{rel.filename}</span>
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {doc.related_uploads?.map((child) => (
        <TimelineEntry key={child.memory_id} doc={child} isChild allDocs={allDocs} onSaveEdit={onSaveEdit} />
      ))}

      <EditMemoryDialog
        doc={doc}
        siblings={allDocs}
        open={editOpen}
        onOpenChange={setEditOpen}
        onSave={(updates) => onSaveEdit(doc.contract_id, updates)}
      />
    </div>
  );
}

export function ProjectTimeline({ projectId, onMemoryChanged }: ProjectTimelineProps) {
  const { isAuthenticated, authenticatedFetch } = useAuth();
  const apiUrl = process.env.NEXT_PUBLIC_EXTRACTOR_API_URL;

  const [timeline, setTimeline] = useState<TimelineDoc[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchTimeline = useCallback(async () => {
    if (!isAuthenticated || !apiUrl || !projectId) return;
    setIsLoading(true);
    setError(null);
    const { data, error: fetchError } = await authenticatedFetch(`${apiUrl}/projects/${projectId}/timeline`);
    if (fetchError) {
      setError(fetchError);
      setIsLoading(false);
      return;
    }
    setTimeline(((data as any)?.timeline || []) as TimelineDoc[]);
    setIsLoading(false);
  }, [isAuthenticated, apiUrl, projectId, authenticatedFetch]);

  useEffect(() => {
    fetchTimeline();
  }, [fetchTimeline]);

  const allDocs = useMemo(() => flattenDocs(timeline), [timeline]);

  const handleSaveEdit = useCallback(
    async (contractId: string, updates: Record<string, any>) => {
      if (!apiUrl) return false;
      const { error: saveError } = await authenticatedFetch(
        `${apiUrl}/projects/${projectId}/timeline/${contractId}`,
        { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(updates) }
      );
      if (saveError) return false;
      await fetchTimeline();
      onMemoryChanged?.();
      return true;
    },
    [apiUrl, projectId, authenticatedFetch, fetchTimeline, onMemoryChanged]
  );

  if (isLoading) {
    return (
      <div className="flex flex-col gap-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-24 w-full rounded-lg" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border bg-muted/30 p-10 text-center">
        <p className="text-sm text-muted-foreground">Failed to load project history: {error}</p>
        <Button variant="outline" size="sm" onClick={fetchTimeline} className="gap-2">
          <RefreshCw className="h-3.5 w-3.5" /> Retry
        </Button>
      </div>
    );
  }

  if (timeline.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-muted/30 p-10 text-center">
        <CalendarClock className="h-8 w-8 text-muted-foreground/60" />
        <h3 className="text-sm font-semibold text-foreground">No history in this space yet</h3>
        <p className="max-w-md text-xs text-muted-foreground">
          Once contracts finish indexing, a chronological overview of what was uploaded, when, and
          how documents relate to each other will appear here.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {timeline.map((doc) => (
        <TimelineEntry key={doc.memory_id} doc={doc} allDocs={allDocs} onSaveEdit={handleSaveEdit} />
      ))}
    </div>
  );
}
