"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, ChevronDown, ChevronRight, GitBranch, TrendingDown, TrendingUp } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

interface RowChange {
  change: "changed" | "added" | "removed";
  row: string;
  old: string;
  new: string;
}

interface LineageVersion {
  contract_id: string;
  contract_name: string;
  effective_date: string | null;
  rows: number;
  status: "new" | "revised" | "unchanged" | "possible_match";
  summary: string | null;
  severity: "info" | "warning" | "critical";
  observed_pct: number | null;
  added_rows: number | null;
  removed_rows: number | null;
  changes: RowChange[];
  changes_truncated: number;
  header_similarity: number | null;
}

interface Lineage {
  signature: string;
  caption: string;
  table_type: string | null;
  version_count: number;
  has_changes: boolean;
  needs_review: boolean;
  /** Compounded across every version, so successive uplifts multiply. */
  total_pct: number | null;
  versions: LineageVersion[];
}

interface LineagesResponse {
  lineages: Lineage[];
  totals: { schedules: number; tracked: number; needs_review: number };
}

function Pct({ value }: { value: number }) {
  const up = value > 0;
  const flat = Math.abs(value) < 0.005;
  return (
    <span
      className={[
        "inline-flex items-center gap-0.5 font-mono text-[10px]",
        flat ? "text-muted-foreground" : up ? "text-amber-600" : "text-emerald-600",
      ].join(" ")}
    >
      {!flat && (up ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />)}
      {value > 0 ? "+" : ""}{value.toFixed(2)}%
    </span>
  );
}

function LineageCard({ lineage, defaultOpen = false }: { lineage: Lineage; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  // A single-version schedule has no history to walk through yet.
  const expandable = lineage.version_count > 1 || lineage.needs_review;

  return (
    <div className={[
      "rounded-md border",
      lineage.needs_review ? "border-amber-500/40" : "border-border",
    ].join(" ")}>
      <button
        type="button"
        disabled={!expandable}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1.5 px-2.5 py-2 text-left disabled:cursor-default"
      >
        {expandable
          ? (open ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />)
          : <span className="w-3.5 shrink-0" />}
        <span className="truncate text-[11px] font-medium text-foreground">{lineage.caption}</span>
        {lineage.table_type && (
          <Badge variant="secondary" className="h-4 shrink-0 px-1 text-[10px] font-normal">
            {lineage.table_type}
          </Badge>
        )}
        <Badge variant="outline" className="h-4 shrink-0 px-1 text-[10px] font-normal">
          {lineage.version_count} version{lineage.version_count === 1 ? "" : "s"}
        </Badge>
        {lineage.needs_review && (
          <AlertTriangle className="h-3 w-3 shrink-0 text-amber-600" />
        )}
        <span className="ml-auto shrink-0">
          {lineage.total_pct !== null && <Pct value={lineage.total_pct} />}
        </span>
      </button>

      {open && (
        <div className="border-t border-border/50 px-2.5 py-2">
          <ol className="flex flex-col gap-2">
            {lineage.versions.map((v, i) => (
              <li key={`${v.contract_id}-${i}`} className="flex gap-2">
                <div className="flex flex-col items-center pt-1">
                  <span className={[
                    "h-1.5 w-1.5 rounded-full",
                    v.severity === "warning" ? "bg-amber-500" : "bg-muted-foreground/40",
                  ].join(" ")} />
                  {i < lineage.versions.length - 1 && (
                    <span className="mt-0.5 w-px flex-1 bg-border" />
                  )}
                </div>
                <div className="min-w-0 flex-1 pb-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-mono text-[10px] text-muted-foreground">
                      {v.effective_date || "date unknown"}
                    </span>
                    <span className="truncate text-[10px] text-foreground">{v.contract_name}</span>
                    {v.observed_pct !== null && <Pct value={v.observed_pct} />}
                  </div>
                  {v.summary && (
                    <p className="mt-0.5 text-[10px] text-muted-foreground">{v.summary}</p>
                  )}
                  {v.changes.length > 0 && (
                    <div className="mt-1 overflow-x-auto">
                      <table className="w-full border-collapse text-[10px]">
                        <tbody>
                          {v.changes.map((c, ci) => (
                            <tr key={ci} className="border-b border-border/30 last:border-0">
                              <td className="py-0.5 pr-2 align-top text-muted-foreground">{c.row}</td>
                              <td className="py-0.5 pr-1 text-right align-top font-mono text-muted-foreground/70">
                                {c.old}
                              </td>
                              <td className="py-0.5 pr-1 align-top text-muted-foreground/50">→</td>
                              <td className="py-0.5 align-top font-mono text-foreground">{c.new}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {v.changes_truncated > 0 && (
                        <p className="mt-0.5 text-[10px] text-muted-foreground">
                          … {v.changes_truncated} more row{v.changes_truncated === 1 ? "" : "s"}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}

export function ProjectLineagesTab({ projectId }: { projectId: string }) {
  const { isAuthenticated, authenticatedFetch } = useAuth();
  const apiUrl = process.env.NEXT_PUBLIC_EXTRACTOR_API_URL;
  const [data, setData] = useState<LineagesResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const fetchLineages = useCallback(async () => {
    if (!isAuthenticated || !apiUrl || !projectId) return;
    setIsLoading(true);
    const { data: payload } = await authenticatedFetch(
      `${apiUrl}/projects/${projectId}/table-lineages`,
    );
    if (payload) setData(payload as LineagesResponse);
    setIsLoading(false);
  }, [isAuthenticated, apiUrl, projectId, authenticatedFetch]);

  useEffect(() => {
    fetchLineages();
  }, [fetchLineages]);

  if (isLoading) return <Skeleton className="h-40 w-full rounded-lg" />;

  const totals = data?.totals;
  if (!totals || totals.schedules === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        No schedules yet. Upload a second version of a contract and its rate schedules are matched
        against the first, so changes between them show up here.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[11px] text-muted-foreground">
        {totals.schedules} schedule{totals.schedules === 1 ? "" : "s"} ·{" "}
        {totals.tracked} with more than one version
        {totals.needs_review > 0 && ` · ${totals.needs_review} needing review`}.
        Percentages are compounded across versions.
      </p>
      <div className="flex max-h-[520px] flex-col gap-2 overflow-y-auto">
        {data!.lineages.map((lineage) => (
          <LineageCard key={lineage.signature} lineage={lineage} />
        ))}
      </div>
    </div>
  );
}
