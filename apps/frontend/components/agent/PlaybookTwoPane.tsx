"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  FileText,
  Scale,
  Search,
  XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";

type PlaybookRule = {
  rule_id: string;
  name: string;
  clause_type: string;
  description?: string | null;
  standard_position?: string | null;
  guidance?: string | null;
  severity: "low" | "medium" | "high" | "critical";
  required_clause?: boolean;
};

type PlaybookFinding = {
  id: string;
  rule_id: string;
  rule_name: string;
  clause_type: string;
  status: "acceptable" | "needs_review" | "not_acceptable" | "not_applicable";
  severity: "low" | "medium" | "high" | "critical";
  confidence?: number | null;
  matched_text?: string | null;
  matched_position?: string | null;
  clause_summary?: string | null;
  reasoning?: string | null;
  suggested_revision?: string | null;
  reviewer_notes?: string | null;
};

type ContractSection = {
  heading: string;
  text: string;
  startOffset: number;
  endOffset: number;
};

interface PlaybookTwoPaneProps {
  rules: PlaybookRule[];
  findings: PlaybookFinding[];
  contractText: string;
  contractName: string;
  contractSections?: ContractSection[];
  className?: string;
  onFindingClick?: (finding: PlaybookFinding) => void;
}

const STATUS_META: Record<PlaybookFinding["status"], { label: string; color: string; bgColor: string; icon: typeof CheckCircle2 }> = {
  acceptable: { label: "Acceptable", color: "text-emerald-700", bgColor: "bg-emerald-50 border-emerald-200", icon: CheckCircle2 },
  needs_review: { label: "Needs review", color: "text-amber-700", bgColor: "bg-amber-50 border-amber-200", icon: AlertTriangle },
  not_acceptable: { label: "Not acceptable", color: "text-red-700", bgColor: "bg-red-50 border-red-200", icon: XCircle },
  not_applicable: { label: "Not applicable", color: "text-gray-500", bgColor: "bg-gray-50 border-gray-200", icon: Scale },
};

const SEVERITY_ORDER = ["critical", "high", "medium", "low"];

function confidenceText(value?: number | null) {
  if (value === null || value === undefined || Number.isNaN(value)) return "";
  const normalized = value > 1 ? value : value * 100;
  return `${Math.round(normalized)}%`;
}

export function PlaybookTwoPane({
  rules,
  findings,
  contractText,
  contractName,
  contractSections,
  className,
  onFindingClick,
}: PlaybookTwoPaneProps) {
  const [activeRuleId, setActiveRuleId] = useState<string | null>(rules[0]?.rule_id || null);
  const [statusFilter, setStatusFilter] = useState<PlaybookFinding["status"] | "all">("all");
  const [findingSearch, setFindingSearch] = useState("");
  const [selectedFindingId, setSelectedFindingId] = useState<string | null>(null);
  const contractPaneRef = useRef<HTMLDivElement>(null);
  const contractTextContainerRef = useRef<HTMLDivElement>(null);

  const ruleMap = useMemo(() => new Map(rules.map((rule) => [rule.rule_id, rule])), [rules]);

  const findingsByRule = useMemo(() => {
    const map = new Map<string, PlaybookFinding[]>();
    findings.forEach((finding) => {
      const list = map.get(finding.rule_id) || [];
      list.push(finding);
      map.set(finding.rule_id, list);
    });
    return map;
  }, [findings]);

  const activeFindings = useMemo(
    () => (activeRuleId ? findingsByRule.get(activeRuleId) || [] : []),
    [activeRuleId, findingsByRule]
  );

  const filteredFindings = useMemo(() => {
    let items = activeFindings;
    if (statusFilter !== "all") {
      items = items.filter((finding) => finding.status === statusFilter);
    }
    if (findingSearch.trim()) {
      const q = findingSearch.toLowerCase();
      items = items.filter((finding) =>
        [finding.rule_name, finding.clause_type, finding.clause_summary || "", finding.reasoning || ""]
          .some((value) => value.toLowerCase().includes(q))
      );
    }
    return items;
  }, [activeFindings, statusFilter, findingSearch]);

  const statusCounts = useMemo(() => {
    return activeFindings.reduce<Record<string, number>>((counts, finding) => {
      counts[finding.status] = (counts[finding.status] || 0) + 1;
      return counts;
    }, {});
  }, [activeFindings]);

  const highlightSections = useMemo(() => {
    const positions = new Set<number>();
    const selectedFinding = filteredFindings.find((finding) => finding.id === selectedFindingId);
    const targets = selectedFinding ? [selectedFinding] : filteredFindings;
    targets.forEach((finding) => {
      if (finding.matched_position) {
        const match = finding.matched_position.match(/(\d+)/);
        if (match) positions.add(parseInt(match[1], 10));
      }
      const searchTerms = finding.matched_text?.slice(0, 40) || finding.clause_type;
      if (searchTerms && contractText.includes(searchTerms)) {
        const idx = contractText.indexOf(searchTerms);
        positions.add(idx);
      }
    });
    return positions;
  }, [filteredFindings, selectedFindingId, contractText]);

  const scrollToHighlight = useCallback(() => {
    if (!contractTextContainerRef.current || highlightSections.size === 0) return;
    const firstOffset = Math.min(...highlightSections);
    const container = contractTextContainerRef.current;
    const totalHeight = container.scrollHeight;
    const viewHeight = container.clientHeight;
    const estimatedLine = contractText.slice(0, firstOffset).split("\n").length;
    const approxScroll = (estimatedLine / (contractText.split("\n").length || 1)) * totalHeight - viewHeight / 2;
    container.scrollTo({ top: Math.max(0, approxScroll), behavior: "smooth" });
  }, [highlightSections, contractText]);

  const handleRuleClick = useCallback((ruleId: string) => {
    setActiveRuleId(ruleId);
    setSelectedFindingId(null);
  }, []);

  const handleFindingClick = useCallback((finding: PlaybookFinding) => {
    setSelectedFindingId((current) => (current === finding.id ? null : finding.id));
    onFindingClick?.(finding);
  }, [onFindingClick]);

  useEffect(() => {
    if (selectedFindingId || filteredFindings.length) {
      scrollToHighlight();
    }
  }, [selectedFindingId, filteredFindings.length, scrollToHighlight]);

  const activeRule = activeRuleId ? ruleMap.get(activeRuleId) : null;

  return (
    <div className={cn("flex h-full min-h-0 border border-gray-200 rounded-xl bg-white overflow-hidden", className)}>
      {/* Left pane: Contract text */}
      <div className="flex w-1/2 min-w-0 flex-col border-r border-gray-200">
        <div className="flex items-center gap-2 border-b border-gray-100 px-4 py-3">
          <FileText className="h-4 w-4 shrink-0 text-gray-400" />
          <span className="truncate text-sm font-semibold text-gray-900">{contractName}</span>
          {highlightSections.size > 0 ? (
            <span className="ml-auto shrink-0 rounded-full bg-emerald-50 border border-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-600">
              {highlightSections.size} highlight{highlightSections.size > 1 ? "s" : ""}
            </span>
          ) : null}
        </div>
        <div ref={contractTextContainerRef} className="flex-1 overflow-y-auto px-4 py-3">
          <pre className="whitespace-pre-wrap font-mono text-[11px] leading-6 text-gray-700">
            {contractText}
          </pre>
        </div>
      </div>

      {/* Right pane: Rules table */}
      <div className="flex w-1/2 min-w-0 flex-col">
        <div className="flex items-center gap-2 border-b border-gray-100 px-4 py-3">
          <BookOpen className="h-4 w-4 shrink-0 text-gray-400" />
          <span className="text-sm font-semibold text-gray-900 truncate">
            {activeRule?.name || "Select a rule"}
          </span>
        </div>

        {/* Rule selector */}
        <div className="border-b border-gray-100 px-3 py-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-gray-400" />
            <select
              value={activeRuleId || ""}
              onChange={(event) => handleRuleClick(event.target.value)}
              className="h-7 w-full appearance-none rounded-md border border-gray-200 bg-white pl-7 pr-6 text-xs text-gray-700 outline-none focus:border-gray-300"
            >
              {rules.map((rule) => (
                <option key={rule.rule_id} value={rule.rule_id}>
                  {rule.name}
                </option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-gray-400" />
          </div>
        </div>

        {/* Rule detail */}
        {activeRule ? (
          <div className="border-b border-gray-100 px-4 py-3 bg-gray-50/50">
            <div className="flex items-center gap-2">
              <span className={cn(
                "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase",
                activeRule.severity === "critical" ? "border-red-200 bg-red-50 text-red-700" :
                activeRule.severity === "high" ? "border-orange-200 bg-orange-50 text-orange-700" :
                activeRule.severity === "medium" ? "border-blue-200 bg-blue-50 text-blue-700" :
                "border-gray-200 bg-gray-50 text-gray-600"
              )}>
                {activeRule.severity}
              </span>
              <span className="text-xs text-gray-500">{activeRule.clause_type}</span>
              {activeRule.required_clause ? (
                <span className="rounded bg-red-50 px-1.5 py-0.5 text-[10px] font-medium text-red-600">Required</span>
              ) : null}
            </div>
            {activeRule.standard_position ? (
              <p className="mt-2 text-[11px] leading-5 text-gray-600">{activeRule.standard_position}</p>
            ) : null}
            {activeRule.guidance ? (
              <p className="mt-1 text-[11px] leading-5 text-gray-500 italic">{activeRule.guidance}</p>
            ) : null}
          </div>
        ) : null}

        {/* Status filter */}
        <div className="flex items-center gap-1 border-b border-gray-100 px-3 py-2">
          {([
            ["all", "All"],
            ["needs_review", "Review"],
            ["not_acceptable", "Fail"],
            ["acceptable", "Pass"],
            ["not_applicable", "N/A"],
          ] as Array<[PlaybookFinding["status"] | "all", string]>).map(([status, label]) => (
            <button
              key={status}
              type="button"
              onClick={() => setStatusFilter(status)}
              className={cn(
                "h-6 rounded-md px-2 text-[10px] font-medium transition-colors",
                statusFilter === status
                  ? "bg-cs-primary text-white"
                  : "border border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
              )}
            >
              {label}
              {status !== "all" && statusCounts[status] ? (
                <span className="ml-1 opacity-70">{statusCounts[status]}</span>
              ) : null}
            </button>
          ))}
          <div className="relative ml-auto w-32">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-gray-400" />
            <input
              value={findingSearch}
              onChange={(event) => setFindingSearch(event.target.value)}
              placeholder="Search findings..."
              className="h-6 w-full rounded-md border border-gray-200 bg-white pl-6 pr-2 text-[10px] outline-none focus:border-gray-300"
            />
          </div>
        </div>

        {/* Findings list */}
        <div className="flex-1 overflow-y-auto">
          {filteredFindings.length ? (
            <div className="divide-y divide-gray-50">
              {filteredFindings.map((finding) => {
                const meta = STATUS_META[finding.status];
                const Icon = meta.icon;
                const isSelected = finding.id === selectedFindingId;
                return (
                  <div
                    key={finding.id}
                    className={cn(
                      "px-4 py-3 transition-colors cursor-pointer",
                      isSelected ? "bg-gray-50 ring-1 ring-inset ring-gray-200" : "hover:bg-gray-50/50"
                    )}
                    onClick={() => handleFindingClick(finding)}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <Icon className={cn("h-3.5 w-3.5 shrink-0", meta.color)} />
                          <span className="text-[11px] font-medium text-gray-900 truncate">{finding.rule_name}</span>
                        </div>
                        <p className="mt-1 text-[11px] leading-4 text-gray-500 line-clamp-2">
                          {finding.clause_summary || finding.reasoning || "No summary"}
                        </p>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        <span className={cn("inline-flex rounded px-1.5 py-0.5 text-[10px] font-medium border", meta.bgColor, meta.color)}>
                          {meta.label}
                        </span>
                        {finding.confidence !== null && finding.confidence !== undefined ? (
                          <span className="text-[9px] text-gray-400">{confidenceText(finding.confidence)}</span>
                        ) : null}
                      </div>
                    </div>
                    {isSelected && (finding.matched_text || finding.suggested_revision) ? (
                      <div className="mt-3 space-y-2 border-t border-gray-100 pt-3">
                        {finding.matched_text ? (
                          <div className="rounded-md border border-gray-200 bg-gray-50 p-2">
                            <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Matched text</p>
                            <p className="mt-1 text-[11px] leading-5 text-gray-700">{finding.matched_text}</p>
                          </div>
                        ) : null}
                        {finding.suggested_revision ? (
                          <div className="rounded-md border border-amber-100 bg-amber-50 p-2">
                            <p className="text-[10px] font-semibold uppercase tracking-wide text-amber-600">Suggested revision</p>
                            <p className="mt-1 text-[11px] leading-5 text-gray-800">{finding.suggested_revision}</p>
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
              <BookOpen className="mb-3 h-6 w-6 text-gray-200" />
              <p className="text-sm font-medium text-gray-400">
                {activeRuleId ? "No findings for this rule" : "Select a rule to view findings"}
              </p>
              <p className="mt-1 text-xs text-gray-400">
                {activeRuleId ? "Try adjusting the status filter or search term." : "Choose a rule from the dropdown above."}
              </p>
            </div>
          )}
        </div>

        {/* Footer with summary */}
        {activeFindings.length > 0 ? (
          <div className="border-t border-gray-100 px-4 py-2">
            <div className="flex items-center gap-3 text-[10px] text-gray-500">
              <span>{activeFindings.length} finding{activeFindings.length > 1 ? "s" : ""}</span>
              {(["acceptable", "needs_review", "not_acceptable", "not_applicable"] as const).map((status) => {
                const count = statusCounts[status] || 0;
                if (!count) return null;
                return (
                  <span key={status} className={cn("", STATUS_META[status].color)}>
                    {count} {STATUS_META[status].label.toLowerCase()}
                  </span>
                );
              })}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
