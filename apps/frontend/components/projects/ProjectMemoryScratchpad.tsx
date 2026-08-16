"use client";

import { useCallback, useEffect, useState } from "react";
import { NotebookPen, Pencil, Loader2, Save, X } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useAuth } from "@/hooks/useAuth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDate } from "@/components/dashboard/utils";

interface ScratchpadState {
  content: string;
  updated_at: string | null;
  edited_manually: boolean;
}

// Backend wraps each auto-synced document's section in `<!-- pm:section:id -->`
// markers so it can find-and-replace just that section later. They're
// bookkeeping, not content — strip them for the read-only rendered view (the
// raw edit textarea keeps them, so saving an edit still preserves anchoring
// for every section the user didn't touch).
function stripSectionMarkers(content: string): string {
  return content.replace(/<!--\s*\/?pm:section:[^>]*-->/g, "").trim();
}

interface ProjectMemoryScratchpadProps {
  projectId: string;
  /** Bump this (e.g. from a parent's counter state) to force a refetch —
   * used when a Timeline card edit changes this document's section. */
  refreshSignal?: number;
}

export function ProjectMemoryScratchpad({ projectId, refreshSignal }: ProjectMemoryScratchpadProps) {
  const { isAuthenticated, authenticatedFetch } = useAuth();
  const apiUrl = process.env.NEXT_PUBLIC_EXTRACTOR_API_URL;

  const [state, setState] = useState<ScratchpadState | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const fetchScratchpad = useCallback(async () => {
    if (!isAuthenticated || !apiUrl || !projectId) return;
    setIsLoading(true);
    const { data } = await authenticatedFetch(`${apiUrl}/projects/${projectId}/memory`);
    if (data) setState(data as ScratchpadState);
    setIsLoading(false);
  }, [isAuthenticated, apiUrl, projectId, authenticatedFetch]);

  useEffect(() => {
    fetchScratchpad();
  }, [fetchScratchpad, refreshSignal]);

  const startEditing = () => {
    setDraft(state?.content || "");
    setSaveError(null);
    setIsEditing(true);
  };

  const handleSave = async () => {
    if (!apiUrl) return;
    setIsSaving(true);
    setSaveError(null);
    const { data, error } = await authenticatedFetch(`${apiUrl}/projects/${projectId}/memory`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: draft }),
    });
    setIsSaving(false);
    if (error) {
      setSaveError("Failed to save. Try again.");
      return;
    }
    if (data) setState(data as ScratchpadState);
    setIsEditing(false);
  };

  if (isLoading) {
    return <Skeleton className="h-40 w-full rounded-lg" />;
  }

  const hasContent = Boolean(state?.content?.trim());

  return (
    <div className="rounded-lg border border-border bg-card shadow-sm">
      <div className="flex items-center justify-between gap-2 border-b border-border p-3">
        <div className="flex items-center gap-2">
          <NotebookPen className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium text-foreground">Project Memory</span>
          <Badge variant={state?.edited_manually ? "outline" : "secondary"} className="text-[10px] font-normal">
            {state?.edited_manually ? "Manually edited" : "Auto-generated"}
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          {state?.updated_at && (
            <span className="text-[11px] text-muted-foreground">Updated {formatDate(state.updated_at)}</span>
          )}
          {!isEditing && (
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={startEditing}>
              <Pencil className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>

      <div className="p-4">
        {isEditing ? (
          <div className="flex flex-col gap-3">
            <p className="text-[11px] text-muted-foreground">
              This replaces the whole memory as freeform text. New documents will still append their
              own section here as they're ingested — your edits elsewhere in the text are preserved.
            </p>
            <Textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              className="min-h-[320px] font-mono text-xs"
              placeholder="# Project memory&#10;&#10;Write or paste project notes here..."
            />
            {saveError && <p className="text-xs text-destructive">{saveError}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setIsEditing(false)} disabled={isSaving} className="gap-1.5">
                <X className="h-3.5 w-3.5" /> Cancel
              </Button>
              <Button size="sm" onClick={handleSave} disabled={isSaving} className="gap-1.5">
                {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                Save
              </Button>
            </div>
          </div>
        ) : hasContent ? (
          <div className="max-h-[420px] overflow-y-auto text-xs leading-relaxed text-foreground">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                h2: ({ children }) => <h4 className="mb-1 mt-4 text-xs font-semibold text-foreground first:mt-0">{children}</h4>,
                p: ({ children }) => <p className="mb-1.5 text-muted-foreground last:mb-0">{children}</p>,
                strong: ({ children }) => <strong className="font-medium text-foreground">{children}</strong>,
                ul: ({ children }) => <ul className="mb-1.5 list-disc space-y-0.5 pl-4 text-muted-foreground">{children}</ul>,
                li: ({ children }) => <li>{children}</li>,
                hr: () => <hr className="my-3 border-border" />,
              }}
            >
              {stripSectionMarkers(state?.content || "")}
            </ReactMarkdown>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            No project memory yet. It builds automatically as documents finish indexing, or write your
            own with the edit button above.
          </p>
        )}
      </div>
    </div>
  );
}
