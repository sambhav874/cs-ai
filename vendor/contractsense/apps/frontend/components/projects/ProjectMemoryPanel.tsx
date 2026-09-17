"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Brain, GitBranch, History, Table2, Trash2 } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { ProjectTablesTab } from "@/components/projects/ProjectTablesTab";
import { ProjectLineagesTab } from "@/components/projects/ProjectLineagesTab";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDate } from "@/components/dashboard/utils";

interface FactSource {
  contract_id: string;
  quote?: string;
}

interface ProjectFact {
  fact_id: string;
  text: string;
  sources: FactSource[];
  tags: string[];
  origin: "contract" | "user";
  learned_at: string | null;
  needs_review: boolean;
}

interface ProjectEvent {
  event_id: string;
  event_type: string;
  summary: string;
  severity: "info" | "warning" | "critical";
  contract_id: string | null;
  ts: string | null;
}

interface ProjectMemoryPanelProps {
  projectId: string;
  /** Bump this (e.g. from a parent's counter state) to force a refetch —
   * used when a Timeline card edit changes a document's overview. */
  refreshSignal?: number;
}

export function ProjectMemoryPanel({ projectId, refreshSignal }: ProjectMemoryPanelProps) {
  const { isAuthenticated, authenticatedFetch } = useAuth();
  const apiUrl = process.env.NEXT_PUBLIC_EXTRACTOR_API_URL;

  const [facts, setFacts] = useState<ProjectFact[]>([]);
  const [events, setEvents] = useState<ProjectEvent[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const fetchAll = useCallback(async () => {
    if (!isAuthenticated || !apiUrl || !projectId) return;
    setIsLoading(true);
    const base = `${apiUrl}/projects/${projectId}/memory`;
    const [factsRes, eventsRes] = await Promise.all([
      authenticatedFetch(`${base}/facts`),
      authenticatedFetch(`${base}/events?limit=50`),
    ]);
    if (factsRes.data) setFacts(((factsRes.data as { facts?: ProjectFact[] }).facts) || []);
    if (eventsRes.data) setEvents(((eventsRes.data as { events?: ProjectEvent[] }).events) || []);
    setIsLoading(false);
  }, [isAuthenticated, apiUrl, projectId, authenticatedFetch]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll, refreshSignal]);

  const handleRetireFact = async (factId: string) => {
    if (!apiUrl) return;
    const { error } = await authenticatedFetch(
      `${apiUrl}/projects/${projectId}/memory/facts/${factId}`,
      { method: "DELETE" },
    );
    if (!error) setFacts((current) => current.filter((fact) => fact.fact_id !== factId));
  };

  if (isLoading) {
    return <Skeleton className="h-40 w-full rounded-lg" />;
  }

  const reviewCount = facts.filter((fact) => fact.needs_review).length;

  return (
    <div className="rounded-lg border border-border bg-card shadow-sm">
      <Tabs defaultValue="facts">
        <div className="flex items-center justify-between gap-2 border-b border-border p-3">
          <div className="flex items-center gap-2">
            <Brain className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium text-foreground">Project Memory</span>
          </div>
          <TabsList className="h-8">
            <TabsTrigger value="facts" className="gap-1.5 text-xs">
              Facts
              {facts.length > 0 && (
                <Badge variant="secondary" className="ml-1 h-4 px-1 text-[10px]">{facts.length}</Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="tables" className="gap-1.5 text-xs">
              <Table2 className="h-3.5 w-3.5" /> Tables
            </TabsTrigger>
            <TabsTrigger value="lineages" className="gap-1.5 text-xs">
              <GitBranch className="h-3.5 w-3.5" /> Schedules
            </TabsTrigger>
            <TabsTrigger value="events" className="gap-1.5 text-xs">
              <History className="h-3.5 w-3.5" /> Events
            </TabsTrigger>
          </TabsList>
        </div>

        {/* Facts — editable only by retiring; a correction is a new fact. */}
        <TabsContent value="facts" className="m-0 p-4">
          {reviewCount > 0 && (
            <div className="mb-3 flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-2.5">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
              <p className="text-[11px] text-muted-foreground">
                {reviewCount} fact{reviewCount === 1 ? "" : "s"} came from a document that has since been
                amended. Re-check {reviewCount === 1 ? "it" : "them"} against the source before relying on
                {reviewCount === 1 ? " it" : " them"}.
              </p>
            </div>
          )}
          {facts.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No facts recorded. The assistant records these only when you explicitly ask it to
              remember something, and each one needs your approval first.
            </p>
          ) : (
            <div className="flex max-h-[420px] flex-col gap-2 overflow-y-auto">
              {facts.map((fact) => (
                <div
                  key={fact.fact_id}
                  className={[
                    "rounded-md border p-2.5",
                    fact.needs_review ? "border-amber-500/40 bg-amber-500/5" : "border-border",
                  ].join(" ")}
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-xs text-foreground">{fact.text}</p>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 shrink-0"
                      title="Retire this fact"
                      onClick={() => handleRetireFact(fact.fact_id)}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <Badge variant={fact.origin === "user" ? "outline" : "secondary"} className="text-[10px] font-normal">
                      {fact.origin === "user" ? "Told by the team" : "From a document"}
                    </Badge>
                    {fact.needs_review && (
                      <Badge variant="outline" className="border-amber-500/50 text-[10px] font-normal text-amber-700">
                        Needs review
                      </Badge>
                    )}
                    {fact.tags.map((tag) => (
                      <Badge key={tag} variant="outline" className="text-[10px] font-normal">{tag}</Badge>
                    ))}
                    {fact.learned_at && (
                      <span className="text-[10px] text-muted-foreground">{formatDate(fact.learned_at)}</span>
                    )}
                  </div>
                  {fact.sources?.[0]?.quote && (
                    <p className="mt-1.5 border-l-2 border-border pl-2 text-[11px] italic text-muted-foreground">
                      “{fact.sources[0].quote}”
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        {/* Tables — read-only view of what ingestion actually extracted. */}
        <TabsContent value="tables" className="m-0 p-4">
          <ProjectTablesTab projectId={projectId} />
        </TabsContent>

        {/* Schedules — each rate card and how it changed between contracts. */}
        <TabsContent value="lineages" className="m-0 p-4">
          <ProjectLineagesTab projectId={projectId} />
        </TabsContent>

        {/* Events — append-only, so there is deliberately nothing to edit here. */}
        <TabsContent value="events" className="m-0 p-4">
          {events.length === 0 ? (
            <p className="text-xs text-muted-foreground">Nothing has happened in this project yet.</p>
          ) : (
            <div className="flex max-h-[420px] flex-col gap-1.5 overflow-y-auto">
              {events.map((event) => (
                <div key={event.event_id} className="flex items-start gap-2 border-b border-border/50 pb-1.5 last:border-0">
                  <span
                    className={[
                      "mt-1 h-1.5 w-1.5 shrink-0 rounded-full",
                      event.severity === "critical" ? "bg-destructive"
                        : event.severity === "warning" ? "bg-amber-500"
                        : "bg-muted-foreground/40",
                    ].join(" ")}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-foreground">{event.summary || event.event_type}</p>
                    <span className="text-[10px] text-muted-foreground">
                      {event.event_type}{event.ts ? ` · ${formatDate(event.ts)}` : ""}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
          <p className="mt-3 text-[10px] text-muted-foreground">
            This history is append-only and is not edited — a correction is recorded as a later event.
          </p>
        </TabsContent>
      </Tabs>
    </div>
  );
}
