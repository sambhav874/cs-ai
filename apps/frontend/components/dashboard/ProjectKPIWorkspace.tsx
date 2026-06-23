import { BarChart3, CheckCircle2, Loader2, Play, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cx, formatKpiType, isProjectKpiTracked, isProjectKpiRecommended, formatKpiValue, formatKpiConsequence, truncateMiddle } from "./utils";
import type { ContractKPI, DocumentWithProgress } from "./types";

export function ProjectKPIWorkspace({
  kpis,
  documents,
  selectedContractId,
  isLoading,
  isExtracting,
  onSelectedContractChange,
  onExtract,
  onRefresh,
  onStatusChange,
  onAcceptAll,
  onTrackRecommended,
  onTrackKpi,
}: {
  kpis: ContractKPI[];
  documents: DocumentWithProgress[];
  selectedContractId: string;
  isLoading: boolean;
  isExtracting: boolean;
  onSelectedContractChange: (contractId: string) => void;
  onExtract: () => void | Promise<void>;
  onRefresh: () => void | Promise<void>;
  onStatusChange: (kpi: ContractKPI, status: "approved" | "ignored" | "draft") => void | Promise<void>;
  onAcceptAll: () => void | Promise<void>;
  onTrackRecommended: () => void | Promise<void>;
  onTrackKpi: (kpi: ContractKPI) => void | Promise<void>;
}) {
  const approvedCount = kpis.filter((kpi) => kpi.status === "approved").length;
  const reviewCount = kpis.filter((kpi) => kpi.status !== "approved" && kpi.status !== "ignored").length;
  const acceptAllCount = kpis.filter((kpi) => kpi.status !== "approved" && kpi.status !== "ignored").length;
  const recommendedTrackCount = kpis.filter((kpi) => isProjectKpiRecommended(kpi) && !isProjectKpiTracked(kpi) && kpi.status !== "ignored").length;
  const trackedCount = kpis.filter((kpi) => isProjectKpiTracked(kpi)).length;
  const indexedDocuments = documents.filter((document) => document.index?.status === "success" || document.status === "Indexed");
  const indexedCount = indexedDocuments.length;
  const selectedDocument = indexedDocuments.find((document) => document._id === selectedContractId) || null;

  return (
    <div className="p-6 md:p-8">
      <div className="mb-4 flex flex-col gap-3 border-b border-border pb-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <BarChart3 className="h-6 w-6 text-muted-foreground" />
            <h2 className="text-3xl font-bold text-foreground">KPI Register</h2>
          </div>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Reviewable obligations extracted from ingested contract clauses. Tracked rows become the operational source for monitoring and breach checks.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={selectedContractId}
            onChange={(event) => onSelectedContractChange(event.target.value)}
            className="h-8 max-w-[320px] rounded-md border border-border bg-background px-2 text-xs text-foreground outline-none focus:border-primary"
            aria-label="Select contract for KPI extraction"
            disabled={isExtracting || indexedCount === 0}
          >
            {indexedCount === 0 ? (
              <option value="">No ingested contracts</option>
            ) : (
              indexedDocuments.map((document) => (
                <option key={document._id} value={document._id}>
                  {document.contract_name}
                </option>
              ))
            )}
          </select>
          <span className="rounded-full border border-border bg-muted/50 px-2.5 py-1 text-xs text-muted-foreground">
            {reviewCount} to review
          </span>
          <span className="rounded-full border border-border bg-muted/50 px-2.5 py-1 text-xs text-muted-foreground">
            {approvedCount} approved
          </span>
          <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs text-emerald-700">
            {trackedCount} tracked
          </span>
          <Button type="button" variant="outline" size="sm" className="h-8 gap-1.5" onClick={onAcceptAll} disabled={isLoading || isExtracting || acceptAllCount === 0}>
            <CheckCircle2 className="h-3.5 w-3.5" />
            Accept All KPIs
          </Button>
          <Button type="button" variant="outline" size="sm" className="h-8 gap-1.5" onClick={onTrackRecommended} disabled={isLoading || isExtracting || recommendedTrackCount === 0}>
            <Play className="h-3.5 w-3.5" />
            Track Recommended
          </Button>
          <Button type="button" variant="outline" size="sm" className="h-8 gap-1.5" onClick={onRefresh} disabled={isLoading || isExtracting}>
            <RefreshCw className={cx("h-3.5 w-3.5", isLoading && "animate-spin")} />
            Refresh
          </Button>
          <Button type="button" size="sm" className="h-8 gap-1.5" onClick={onExtract} disabled={isExtracting || !selectedContractId}>
            {isExtracting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
            Extract selected contract
          </Button>
        </div>
      </div>
      {selectedDocument && (
        <div className="mb-4 rounded-md border border-border bg-muted/50 px-3 py-2 text-xs leading-5 text-muted-foreground">
          KPI extraction is intentionally one contract at a time. Selected: <span className="font-medium text-foreground">{selectedDocument.contract_name}</span>.
        </div>
      )}

      {isLoading && kpis.length === 0 ? (
        <div className="space-y-2">
          {[1, 2, 3].map((item) => <div key={item} className="h-16 rounded-md bg-muted animate-pulse" />)}
        </div>
      ) : kpis.length === 0 ? (
        <div className="flex h-72 flex-col items-center justify-center rounded-md border border-dashed border-border text-center">
          <BarChart3 className="h-10 w-10 text-muted-foreground/50" />
          <p className="mt-3 text-sm font-medium text-foreground/80">No KPI register yet</p>
          <p className="mt-1 max-w-md text-sm text-muted-foreground">
            Select one ingested contract and extract its KPI register for payments, SLAs, milestones, penalties, notices, and deadlines.
          </p>
          <Button type="button" className="mt-4 h-8 gap-1.5" onClick={onExtract} disabled={isExtracting || !selectedContractId}>
            {isExtracting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
            Extract selected contract
          </Button>
        </div>
      ) : (
        <div className="divide-y divide-border border-y border-border">
          {kpis.map((kpi) => {
            const tracked = isProjectKpiTracked(kpi);
            const recommended = isProjectKpiRecommended(kpi);
            return (
              <div key={kpi.kpi_id} className="grid gap-3 py-3 text-sm lg:grid-cols-[minmax(220px,1.4fr)_110px_140px_120px_120px_minmax(190px,1fr)_190px] lg:items-start">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate font-medium text-foreground">{kpi.name}</span>
                    {tracked ? (
                      <span className="rounded-full border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[11px] font-medium text-emerald-700">
                        Tracked
                      </span>
                    ) : recommended ? (
                      <span className="rounded-full border border-blue-200 bg-blue-50 px-1.5 py-0.5 text-[11px] font-medium text-blue-700">
                        Recommended
                      </span>
                    ) : null}
                    {kpi.needs_review ? (
                      <span className="rounded-full border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-700">
                        Review
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-1 truncate text-xs text-muted-foreground">
                    {kpi.kpi_id} · {kpi.section || kpi.section_path || kpi.structural_path || kpi.contract_name || truncateMiddle(kpi.contract_id, 18)}
                  </div>
                </div>
                <div>
                  <span className="inline-flex rounded-full border border-border bg-muted/50 px-2 py-1 text-xs font-medium text-foreground/80">
                    {formatKpiType(kpi.kpi_type)}
                  </span>
                </div>
                <div className="text-foreground/80">
                  <div className="font-medium">{formatKpiValue(kpi)}</div>
                </div>
                <div className="font-medium text-destructive">{formatKpiConsequence(kpi)}</div>
                <div className="truncate text-foreground/80">{kpi.party || "—"}</div>
                <div className="min-w-0 text-xs leading-5 text-foreground/80">
                  <p className="line-clamp-2">{kpi.remediation || "Not defined"}</p>
                  {kpi.remediation_sla ? <p className="mt-0.5 font-semibold uppercase text-muted-foreground/70">SLA: {kpi.remediation_sla}</p> : null}
                </div>
                <div className="flex flex-wrap items-center justify-start gap-1.5 lg:justify-end">
                  {!tracked && kpi.status !== "ignored" ? (
                    <Button type="button" variant="outline" size="sm" className="h-7 gap-1 px-2 text-xs text-emerald-700 hover:text-emerald-800" onClick={() => onTrackKpi(kpi)}>
                      <Play className="h-3 w-3" />
                      Track KPI
                    </Button>
                  ) : null}
                  {kpi.status === "approved" ? (
                    <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700">
                      <CheckCircle2 className="h-3 w-3" />
                      Approved
                    </span>
                  ) : kpi.status === "ignored" ? (
                    <span className="rounded-full border border-border bg-muted/50 px-2 py-1 text-xs font-medium text-muted-foreground">
                      Ignored
                    </span>
                  ) : (
                    <>
                      <Button type="button" variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={() => onStatusChange(kpi, "approved")}>
                        Approve
                      </Button>
                      <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs text-muted-foreground" onClick={() => onStatusChange(kpi, "ignored")}>
                        Ignore
                      </Button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
