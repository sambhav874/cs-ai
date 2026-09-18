import { useState, useMemo } from "react";
import {
  BarChart3,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  DollarSign,
  ExternalLink,
  FileText,
  Layers,
  Loader2,
  Play,
  RefreshCw,
  Search,
  ShieldAlert,
} from "lucide-react";
import { Button } from "@cs/components/ui/button";
import {
  cx,
  formatKpiType,
  isProjectKpiTracked,
  isProjectKpiRecommended,
  formatKpiValue,
  formatKpiConsequence,
  truncateMiddle,
  getKpiCategory,
} from "./utils";
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
  const [activeTab, setActiveTab] = useState<"all" | "supplier" | "client" | "mutual" | "sla" | "penalty" | "deadline" | "tracked" | "review">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedKpiId, setExpandedKpiId] = useState<string | null>(null);

  // Executive Metric Counts
  const approvedCount = kpis.filter((kpi) => kpi.status === "approved").length;
  const reviewCount = kpis.filter((kpi) => kpi.status !== "approved" && kpi.status !== "ignored").length;
  const acceptAllCount = kpis.filter((kpi) => kpi.status !== "approved" && kpi.status !== "ignored").length;
  const recommendedTrackCount = kpis.filter((kpi) => isProjectKpiRecommended(kpi) && !isProjectKpiTracked(kpi) && kpi.status !== "ignored").length;
  const trackedCount = kpis.filter((kpi) => isProjectKpiTracked(kpi)).length;

  const slaCount = useMemo(() => kpis.filter((kpi) => getKpiCategory(kpi) === "sla").length, [kpis]);
  const penaltyCount = useMemo(() => kpis.filter((kpi) => getKpiCategory(kpi) === "penalty").length, [kpis]);
  const deadlineCount = useMemo(() => kpis.filter((kpi) => getKpiCategory(kpi) === "deadline").length, [kpis]);
  const partyCount = (role: "supplier" | "client" | "mutual") => kpis.filter((kpi) => String((kpi as any).party_role || (kpi as any).obligation_type || "").toLowerCase() === role).length;

  // Financial Risk Exposure Calculation
  const totalFinancialExposure = useMemo(() => {
    let exposure = 0;
    for (const kpi of kpis) {
      if (kpi.consequence_value != null && (kpi.consequence_unit === "$" || kpi.consequence_unit === "USD" || kpi.consequence_unit === "currency")) {
        exposure += Math.abs(kpi.consequence_value);
      }
    }
    return exposure;
  }, [kpis]);

  const indexedDocuments = documents.filter((document) => document.index?.status === "success" || document.status === "Indexed");
  const indexedCount = indexedDocuments.length;
  const selectedDocument = indexedDocuments.find((document) => document._id === selectedContractId) || null;

  // Filtered KPIs list based on tab & search
  const filteredKpis = useMemo(() => {
    return kpis.filter((kpi) => {
      // Tab filter
      if (activeTab === "supplier" && String((kpi as any).party_role || (kpi as any).obligation_type || "").toLowerCase() !== "supplier") return false;
      if (activeTab === "client" && String((kpi as any).party_role || (kpi as any).obligation_type || "").toLowerCase() !== "client") return false;
      if (activeTab === "mutual" && String((kpi as any).party_role || (kpi as any).obligation_type || "").toLowerCase() !== "mutual") return false;
      if (activeTab === "sla" && getKpiCategory(kpi) !== "sla") return false;
      if (activeTab === "penalty" && getKpiCategory(kpi) !== "penalty") return false;
      if (activeTab === "deadline" && getKpiCategory(kpi) !== "deadline") return false;
      if (activeTab === "tracked" && !isProjectKpiTracked(kpi)) return false;
      if (activeTab === "review" && (kpi.status === "approved" || kpi.status === "ignored")) return false;

      // Search filter
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        const nameMatch = (kpi.name || "").toLowerCase().includes(query);
        const idMatch = (kpi.kpi_id || "").toLowerCase().includes(query);
        const sectionMatch = (kpi.section || kpi.section_path || kpi.structural_path || "").toLowerCase().includes(query);
        const partyMatch = (kpi.party || "").toLowerCase().includes(query);
        const quoteMatch = (kpi.quote || kpi.source_quote || "").toLowerCase().includes(query);
        return nameMatch || idMatch || sectionMatch || partyMatch || quoteMatch;
      }
      return true;
    });
  }, [kpis, activeTab, searchQuery]);

  const toggleExpand = (kpiId: string) => {
    setExpandedKpiId((prev) => (prev === kpiId ? null : kpiId));
  };

  return (
    <div className="p-6 md:p-8 space-y-6">
      {/* --- HEADER BAR --- */}
      <div className="flex flex-col gap-4 border-b border-border pb-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <BarChart3 className="h-6 w-6 text-primary" />
            <h2 className="text-title text-foreground">Trackable Operational Obligations</h2>
          </div>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Agreement-derived obligations, supporting measurements, evidence duties, and consequences. Monitoring activates only when the record is ready for evidence.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={selectedContractId}
            onChange={(event) => onSelectedContractChange(event.target.value)}
            className="h-9 max-w-[320px] rounded-md border border-border bg-background px-3 text-xs font-medium text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary"
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

          <Button type="button" variant="outline" size="sm" className="h-9 gap-1.5" onClick={onAcceptAll} disabled={isLoading || isExtracting || acceptAllCount === 0}>
            <CheckCircle2 className="h-4 w-4 text-success-700" />
            Accept All ({acceptAllCount})
          </Button>
          <Button type="button" variant="outline" size="sm" className="h-9 gap-1.5" onClick={onTrackRecommended} disabled={isLoading || isExtracting || recommendedTrackCount === 0}>
            <Play className="h-4 w-4 text-primary-700" />
            Track Recommended ({recommendedTrackCount})
          </Button>
          <Button type="button" variant="outline" size="sm" className="h-9 gap-1.5" onClick={onRefresh} disabled={isLoading || isExtracting}>
            <RefreshCw className={cx("h-4 w-4", isLoading && "animate-spin")} />
            Refresh
          </Button>
          <Button type="button" size="sm" className="h-9 gap-1.5 shadow-e1" onClick={onExtract} disabled={isExtracting || !selectedContractId}>
            {isExtracting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            Extract Selected Contract
          </Button>
        </div>
      </div>

      {/* --- EXECUTIVE SUMMARY METRIC CARDS --- */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div className="rounded-lg border border-border bg-card p-4 shadow-e1">
          <div className="flex items-center justify-between text-muted-foreground">
            <span className="text-xs font-medium uppercase tracking-wider">Total Register</span>
            <Layers className="h-4 w-4 text-primary" />
          </div>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="text-title text-foreground">{kpis.length}</span>
            <span className="text-xs text-muted-foreground">{approvedCount} Approved</span>
          </div>
        </div>

        <div className="rounded-lg border border-success-200 bg-success-50/50 p-4 shadow-e1">
          <div className="flex items-center justify-between text-success-800">
            <span className="text-xs font-semibold uppercase tracking-wider">Tracked & Active</span>
            <CheckCircle2 className="h-4 w-4 text-success-700" />
          </div>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="text-title text-success-800">{trackedCount}</span>
            <span className="text-xs font-medium text-success-700">{slaCount} Operational SLAs</span>
          </div>
        </div>

        <div className="rounded-lg border border-attention-200 bg-attention-50/50 p-4 shadow-e1">
          <div className="flex items-center justify-between text-attention-700">
            <span className="text-xs font-semibold uppercase tracking-wider">Needs Review</span>
            <ShieldAlert className="h-4 w-4 text-attention-600" />
          </div>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="text-title text-attention-700">{reviewCount}</span>
            <span className="text-xs font-medium text-attention-700">{deadlineCount} Deadlines</span>
          </div>
        </div>

        <div className="rounded-lg border border-info-200 bg-info-50/50 p-4 shadow-e1">
          <div className="flex items-center justify-between text-info-700">
            <span className="text-xs font-semibold uppercase tracking-wider">Direct Exposure</span>
            <DollarSign className="h-4 w-4 text-info-600" />
          </div>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="text-title text-info-700">
              {totalFinancialExposure > 0 ? `$${totalFinancialExposure.toLocaleString()}` : "Fee Credit Tiers"}
            </span>
            <span className="text-xs font-medium text-info-700">{penaltyCount} Penalty Clauses</span>
          </div>
        </div>
      </div>

      {/* --- FILTERS & SEARCH BAR --- */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-border pb-3">
        {/* Category Tabs */}
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setActiveTab("all")}
            className={cx(
              "rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
              activeTab === "all" ? "bg-primary text-primary-foreground shadow-e1" : "bg-muted/60 text-muted-foreground hover:bg-muted"
            )}
          >
            All Items ({kpis.length})
          </button>
          <button type="button" onClick={() => setActiveTab("supplier")} className={cx("rounded-lg px-3 py-1.5 text-xs font-medium transition-colors", activeTab === "supplier" ? "bg-primary text-primary-foreground shadow-e1" : "bg-muted/60 text-muted-foreground hover:bg-muted")}>Supplier ({partyCount("supplier")})</button>
          <button type="button" onClick={() => setActiveTab("client")} className={cx("rounded-lg px-3 py-1.5 text-xs font-medium transition-colors", activeTab === "client" ? "bg-primary text-primary-foreground shadow-e1" : "bg-muted/60 text-muted-foreground hover:bg-muted")}>Client ({partyCount("client")})</button>
          <button type="button" onClick={() => setActiveTab("mutual")} className={cx("rounded-lg px-3 py-1.5 text-xs font-medium transition-colors", activeTab === "mutual" ? "bg-primary text-primary-foreground shadow-e1" : "bg-muted/60 text-muted-foreground hover:bg-muted")}>Mutual ({partyCount("mutual")})</button>
          <button
            type="button"
            onClick={() => setActiveTab("sla")}
            className={cx(
              "rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
              activeTab === "sla" ? "bg-primary text-primary-foreground shadow-e1" : "bg-muted/60 text-muted-foreground hover:bg-muted"
            )}
          >
            Core SLAs ({slaCount})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("penalty")}
            className={cx(
              "rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
              activeTab === "penalty" ? "bg-primary text-primary-foreground shadow-e1" : "bg-muted/60 text-muted-foreground hover:bg-muted"
            )}
          >
            Penalties & Fees ({penaltyCount})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("deadline")}
            className={cx(
              "rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
              activeTab === "deadline" ? "bg-primary text-primary-foreground shadow-e1" : "bg-muted/60 text-muted-foreground hover:bg-muted"
            )}
          >
            Deadlines ({deadlineCount})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("tracked")}
            className={cx(
              "rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
              activeTab === "tracked" ? "bg-success-solid text-white shadow-e1" : "bg-muted/60 text-muted-foreground hover:bg-muted"
            )}
          >
            Tracked ({trackedCount})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("review")}
            className={cx(
              "rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
              activeTab === "review" ? "bg-attention-solid text-white shadow-e1" : "bg-muted/60 text-muted-foreground hover:bg-muted"
            )}
          >
            To Review ({reviewCount})
          </button>
        </div>

        {/* Real-Time Search Bar */}
        <div className="relative min-w-[240px]">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search obligation, section, quote..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-9 w-full rounded-md border border-border bg-background pl-9 pr-3 text-xs text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary"
          />
        </div>
      </div>

      {selectedDocument && (
        <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-xs leading-5 text-muted-foreground flex items-center justify-between">
          <span>
            Selected Contract: <span className="font-semibold text-foreground">{selectedDocument.contract_name}</span>
          </span>
          <span>Showing {filteredKpis.length} of {kpis.length} items</span>
        </div>
      )}

      {/* --- KPI LIST WORKSPACE --- */}
      {isLoading && kpis.length === 0 ? (
        <div className="space-y-3">
          {[1, 2, 3, 4].map((item) => (
            <div key={item} className="h-16 rounded-lg bg-muted/60 animate-pulse border border-border" />
          ))}
        </div>
      ) : filteredKpis.length === 0 ? (
        <div className="flex h-64 flex-col items-center justify-center rounded-lg border border-dashed border-border text-center bg-card/50">
          <BarChart3 className="h-10 w-10 text-muted-foreground/40" />
          <p className="mt-3 text-sm font-semibold text-foreground">No matching KPIs found</p>
          <p className="mt-1 max-w-md text-xs text-muted-foreground">
            {searchQuery || activeTab !== "all"
              ? "Try adjusting your search query or switching active filter tabs."
              : "Select an ingested contract and extract its KPI register."}
          </p>
          {kpis.length === 0 && (
            <Button type="button" className="mt-4 h-8 gap-1.5 shadow-e1" onClick={onExtract} disabled={isExtracting || !selectedContractId}>
              {isExtracting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
              Extract Selected Contract
            </Button>
          )}
        </div>
      ) : (
        <div className="space-y-2.5">
          {filteredKpis.map((kpi) => {
            const tracked = isProjectKpiTracked(kpi);
            const recommended = isProjectKpiRecommended(kpi);
            const isExpanded = expandedKpiId === kpi.kpi_id;
            const ruleType = String(kpi.rule_type || kpi.rule?.rule_type || "").toLowerCase();
            const spec = kpi.rule?.spec || {};
            const tiers = spec.tiers || kpi.target_schedule || [];
            const hasTiers = ruleType === "tiered" || (Array.isArray(tiers) && tiers.length > 0);

            return (
              <div
                key={kpi.kpi_id}
                className={cx(
                  "rounded-lg border transition-all bg-card shadow-e1",
                  isExpanded ? "border-primary ring-1 ring-primary/20" : "border-border hover:border-border/80"
                )}
              >
                {/* --- COMPACT ROW VIEW --- */}
                <div className="grid gap-3 p-3.5 text-sm lg:grid-cols-[minmax(240px,1.5fr)_120px_140px_130px_160px] lg:items-center">
                  {/* Column 1: Name & Section */}
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-foreground hover:text-primary cursor-pointer truncate" onClick={() => toggleExpand(kpi.kpi_id)}>
                        {kpi.name}
                      </span>
                      {tracked ? (
                        <span className="rounded-full border border-success-200 bg-success-50 px-2 py-0.5 text-[10px] font-semibold text-success-700">
                          Tracked
                        </span>
                      ) : recommended ? (
                        <span className="rounded-full border border-primary-200 bg-primary-50 px-2 py-0.5 text-[10px] font-semibold text-primary-700">
                          Recommended
                        </span>
                      ) : null}
                      {kpi.needs_review ? (
                        <span className="rounded-full border border-attention-200 bg-attention-50 px-2 py-0.5 text-[10px] font-semibold text-attention-700">
                          Review
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                      <span className="font-mono text-[11px] text-muted-foreground/80">{kpi.kpi_id}</span>
                      <span>·</span>
                      <span className="truncate">{kpi.section || kpi.section_path || kpi.structural_path || kpi.contract_name || truncateMiddle(kpi.contract_id, 18)}</span>
                    </div>
                  </div>

                  {/* Column 2: Type Pill */}
                  <div>
                    <span className="inline-flex rounded-md border border-border bg-muted/50 px-2.5 py-1 text-xs font-medium text-foreground/80">
                      {formatKpiType(kpi.kpi_type)}
                    </span>
                  </div>

                  {/* Column 3: Target Value */}
                  <div className="text-xs">
                    <div className="font-semibold text-foreground">{formatKpiValue(kpi)}</div>
                    {kpi.unit && kpi.unit !== "number" && <div className="text-[11px] text-muted-foreground">{kpi.unit}</div>}
                  </div>

                  {/* Column 4: Consequence / Penalty */}
                  <div className="text-xs font-semibold text-destructive">
                    {formatKpiConsequence(kpi)}
                  </div>

                  {/* Column 5: Actions & Expand Toggle */}
                  <div className="flex items-center justify-end gap-1.5">
                    {!tracked && kpi.status !== "ignored" && (
                      <Button type="button" variant="outline" size="sm" className="h-7 gap-1 px-2 text-xs text-success-700 hover:text-success-800 hover:bg-success-50" onClick={() => onTrackKpi(kpi)}>
                        <Play className="h-3 w-3" />
                        Track
                      </Button>
                    )}

                    {kpi.status === "approved" ? (
                      <span className="inline-flex items-center gap-1 rounded-full border border-success-200 bg-success-50 px-2 py-0.5 text-xs font-medium text-success-700">
                        <CheckCircle2 className="h-3 w-3" />
                        Approved
                      </span>
                    ) : kpi.status === "ignored" ? (
                      <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                        Ignored
                      </span>
                    ) : (
                      <div className="flex items-center gap-1">
                        <Button type="button" variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={() => onStatusChange(kpi, "approved")}>
                          Approve
                        </Button>
                        <Button type="button" variant="ghost" size="sm" className="h-7 px-1.5 text-xs text-muted-foreground" onClick={() => onStatusChange(kpi, "ignored")}>
                          Ignore
                        </Button>
                      </div>
                    )}

                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
                      onClick={() => toggleExpand(kpi.kpi_id)}
                      aria-label="Toggle details"
                    >
                      {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    </Button>
                  </div>
                </div>

                {/* --- EXPANDABLE INLINE DETAIL CARD --- */}
                {isExpanded && (
                  <div className="border-t border-border bg-muted/20 p-4 space-y-4 rounded-b-xl">
                    {/* VISUAL MULTI-TIER PENALTY TABLE (If Tiered) */}
                    {hasTiers && (
                      <div className="rounded-lg border border-primary/20 bg-background p-3.5 shadow-e1 space-y-2">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-1.5 text-xs font-bold text-primary uppercase tracking-wider">
                            <Layers className="h-3.5 w-3.5" />
                            Multi-Tier Performance & Service Credit Schedule
                          </div>
                          <span className="text-[11px] text-muted-foreground">Interpolation: Step</span>
                        </div>
                        <div className="overflow-x-auto">
                          <table className="w-full text-left text-xs">
                            <thead>
                              <tr className="border-b border-border bg-muted/40 text-muted-foreground">
                                <th className="py-1.5 px-2.5 font-semibold">Tier Level</th>
                                <th className="py-1.5 px-2.5 font-semibold">Performance Target Band</th>
                                <th className="py-1.5 px-2.5 font-semibold">Financial Credit / Penalty</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-border">
                              {tiers.map((tier: any, idx: number) => {
                                const levelName = tier.tier || tier.level || `Tier ${idx + 1}`;
                                const minVal = tier.min_value != null ? `${tier.min_value}%` : (tier.min ?? '0%');
                                const maxVal = tier.max_value != null ? `${tier.max_value}%` : (tier.max ?? '< Target');
                                const credit = tier.credit_pct ? `${tier.credit_pct}% Fee Credit` : (tier.value ? `${tier.value}` : 'Penalty');
                                return (
                                  <tr key={idx} className="hover:bg-muted/20">
                                    <td className="py-2 px-2.5 font-medium text-foreground">{levelName}</td>
                                    <td className="py-2 px-2.5 text-muted-foreground font-mono">{minVal} – {maxVal}</td>
                                    <td className="py-2 px-2.5 font-semibold text-destructive">{credit}</td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}

                    {/* Detailed Metadata Grid */}
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 text-xs">
                      <div className="rounded-md border border-border bg-background p-2.5">
                        <span className="text-[10px] font-semibold text-muted-foreground uppercase">Responsible Party</span>
                        <p className="mt-0.5 font-medium text-foreground">{kpi.party_role || "Needs review"} · {kpi.party || kpi.responsible_party || "Unassigned"}</p>
                      </div>
                      <div className="rounded-md border border-border bg-background p-2.5">
                        <span className="text-[10px] font-semibold text-muted-foreground uppercase">Remediation SLA</span>
                        <p className="mt-0.5 font-medium text-foreground">{kpi.remediation_sla || "Not specified"}</p>
                      </div>
                      <div className="rounded-md border border-border bg-background p-2.5">
                        <span className="text-[10px] font-semibold text-muted-foreground uppercase">Evaluation Window</span>
                        <p className="mt-0.5 font-medium text-foreground">{kpi.evaluation_window || kpi.period_type || "Monthly"}</p>
                      </div>
                      <div className="rounded-md border border-border bg-background p-2.5">
                        <span className="text-[10px] font-semibold text-muted-foreground uppercase">Structural Section</span>
                        <p className="mt-0.5 font-medium text-foreground truncate">{kpi.section || kpi.section_path || "Section 4.01"}</p>
                      </div>
                    </div>

                    {/* Remediation Plan */}
                    {kpi.remediation && (
                      <div className="rounded-md border border-border bg-background p-3 text-xs">
                        <span className="text-[10px] font-semibold text-muted-foreground uppercase">Remediation Action Plan</span>
                        <p className="mt-1 text-foreground/90 leading-relaxed">{kpi.remediation}</p>
                      </div>
                    )}

                    {/* Verbatim Source Quote */}
                    <div className="rounded-lg border border-border bg-background p-3 space-y-1.5">
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                          <FileText className="h-3.5 w-3.5" />
                          Verbatim Contract Evidence
                        </span>
                        {kpi.page_start && (
                          <span className="text-muted-foreground font-mono">Page {kpi.page_start}</span>
                        )}
                      </div>
                      <blockquote className="text-xs italic leading-relaxed text-foreground/85 border-l-2 border-primary/40 pl-2.5 py-0.5">
                        "{kpi.quote || kpi.source_quote || kpi.clause_text || "Verbatim quote anchored in contract text."}"
                      </blockquote>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
