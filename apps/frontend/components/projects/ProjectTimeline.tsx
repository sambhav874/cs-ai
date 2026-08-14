"use client";

import { useCallback, useEffect, useState } from "react";
import { CalendarClock, FileText, Link2, RefreshCw } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDate } from "@/components/dashboard/utils";

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
  doc_type: string;
  parties: string[];
  effective_date: string | null;
  purpose_summary: string;
  key_topics: string[];
  related_documents: RelatedDocument[];
  status: "success" | "failed";
  related_uploads: TimelineDoc[];
}

interface ProjectTimelineProps {
  projectId: string;
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

function docTypeLabel(value: string): string {
  return DOC_TYPE_LABEL[value] || value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function TimelineEntry({ doc, isChild = false }: { doc: TimelineDoc; isChild?: boolean }) {
  return (
    <div className={isChild ? "ml-8 mt-3 border-l-2 border-border pl-4" : ""}>
      <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="text-sm font-medium text-foreground">{doc.filename}</span>
            <Badge variant="secondary" className="text-[10px]">{docTypeLabel(doc.doc_type)}</Badge>
            {doc.status === "failed" && (
              <Badge variant="destructive" className="text-[10px]">Overview unavailable</Badge>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
            <CalendarClock className="h-3.5 w-3.5" />
            {formatDate(doc.uploaded_at)}
          </div>
        </div>

        {doc.purpose_summary && (
          <p className="mt-2 text-sm text-muted-foreground">{doc.purpose_summary}</p>
        )}

        {(doc.parties?.length > 0 || doc.effective_date) && (
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            {doc.parties?.length > 0 && <span>Parties: {doc.parties.join(", ")}</span>}
            {doc.effective_date && <span>· Effective: {doc.effective_date}</span>}
          </div>
        )}

        {doc.key_topics?.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {doc.key_topics.map((topic) => (
              <Badge key={topic} variant="outline" className="text-[10px] font-normal">{topic}</Badge>
            ))}
          </div>
        )}

        {doc.related_documents?.length > 0 && (
          <div className="mt-3 flex flex-col gap-1 border-t border-border pt-2">
            {doc.related_documents.map((rel, i) => (
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
        <TimelineEntry key={child.memory_id} doc={child} isChild />
      ))}
    </div>
  );
}

export function ProjectTimeline({ projectId }: ProjectTimelineProps) {
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
      <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border bg-muted/30 p-10 text-center">
        <p className="text-sm text-muted-foreground">Failed to load project history: {error}</p>
        <Button variant="outline" size="sm" onClick={fetchTimeline} className="gap-2">
          <RefreshCw className="h-3.5 w-3.5" /> Retry
        </Button>
      </div>
    );
  }

  if (timeline.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-muted/30 p-10 text-center">
        <CalendarClock className="h-8 w-8 text-muted-foreground/60" />
        <h3 className="text-sm font-semibold text-foreground">No project history yet</h3>
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
        <TimelineEntry key={doc.memory_id} doc={doc} />
      ))}
    </div>
  );
}
