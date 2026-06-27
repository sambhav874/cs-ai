"use client";

import { ChevronDown, ChevronRight, FileText, Quote, Search, Wrench } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

type ToolUsageCardProps = {
  toolName: string;
  status: "running" | "done" | "error" | "planned";
  summary?: string;
  matches?: EvidenceMatch[];
  snippet?: string;
  duration?: string;
  className?: string;
};

type EvidenceMatch = {
  evidence_id?: string;
  filename?: string;
  page?: number | string;
  quote?: string;
  score?: number;
};

const TOOL_ICONS: Record<string, typeof Search> = {
  search_evidence: Search,
  find_in_document: Search,
  read_document: FileText,
  outline_document: FileText,
  list_documents: FileText,
  fetch_documents: FileText,
  get_kpi_context: FileText,
  calculate_from_evidence: FileText,
};

const TOOL_LABELS: Record<string, string> = {
  search_evidence: "Searching evidence",
  find_in_document: "Finding in document",
  read_document: "Reading document",
  outline_document: "Outlining document",
  list_documents: "Listing documents",
  fetch_documents: "Fetching documents",
  get_kpi_context: "Loading KPI context",
  calculate_from_evidence: "Calculating",
  create_tabular_review: "Creating review",
  generate_tabular_review: "Generating review",
  replicate_document: "Replicating document",
  extract_kpis: "Extracting KPIs",
  suggest_tabular_review: "Proposing review",
};

const STATUS_COLORS: Record<ToolUsageCardProps["status"], string> = {
  running: "border-blue-200 bg-blue-50 text-blue-700",
  done: "border-emerald-200 bg-emerald-50 text-emerald-700",
  error: "border-red-200 bg-red-50 text-red-700",
  planned: "border-amber-200 bg-amber-50 text-amber-700",
};

export function ToolUsageCard({
  toolName,
  status,
  summary,
  matches,
  snippet,
  duration,
  className,
}: ToolUsageCardProps) {
  const [expanded, setExpanded] = useState(false);
  const Icon = TOOL_ICONS[toolName] || Wrench;
  const label = TOOL_LABELS[toolName] || toolName;

  return (
    <div
      className={cn(
        "rounded-lg border bg-white overflow-hidden transition-all",
        STATUS_COLORS[status] || STATUS_COLORS.done,
        className
      )}
    >
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-2.5 px-3 py-2 text-left"
      >
        <span className={cn(
          "flex h-6 w-6 shrink-0 items-center justify-center rounded-md",
          status === "running" ? "bg-blue-100" :
          status === "error" ? "bg-red-100" :
          status === "planned" ? "bg-amber-100" :
          "bg-emerald-100"
        )}>
          <Icon className="h-3.5 w-3.5" />
        </span>
        <span className="min-w-0 flex-1 text-[11px] font-medium">{label}</span>
        <span className="inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] border border-current/20">
          {status === "running" ? (
            <span className="flex items-center gap-1">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />
              Running
            </span>
          ) : status === "planned" ? (
            "Planned"
          ) : status === "error" ? (
            "Error"
          ) : (
            "Done"
          )}
        </span>
        {duration ? <span className="shrink-0 text-[9px] opacity-60">{duration}</span> : null}
        {expanded ? <ChevronDown className="h-3 w-3 shrink-0" /> : <ChevronRight className="h-3 w-3 shrink-0" />}
      </button>

      {expanded ? (
        <div className="border-t border-current/10 px-3 py-2 space-y-2">
          {summary ? (
            <p className="text-[11px] leading-4 opacity-80">{summary}</p>
          ) : null}
          {snippet ? (
            <div className="rounded border border-current/10 bg-white/50 p-2">
              <p className="text-[10px] leading-4 text-gray-600 whitespace-pre-wrap line-clamp-3">{snippet}</p>
            </div>
          ) : null}
          {matches && matches.length > 0 ? (
            <div className="space-y-1">
              {matches.slice(0, 3).map((match, index) => (
                <div key={match.evidence_id || index} className="rounded border border-emerald-100 bg-white p-1.5">
                  <div className="flex items-center gap-1 text-[10px] font-medium text-emerald-700">
                    <Quote className="h-2.5 w-2.5" />
                    <span className="truncate">{match.filename || "Document"}</span>
                    {match.page ? <span className="shrink-0 opacity-60">p. {match.page}</span> : null}
                    {match.score ? <span className="shrink-0 opacity-60">{match.score.toFixed(1)}</span> : null}
                  </div>
                  {match.quote ? (
                    <p className="mt-1 text-[10px] leading-4 text-gray-600 line-clamp-2">{match.quote}</p>
                  ) : null}
                </div>
              ))}
              {matches.length > 3 ? (
                <p className="text-[10px] text-gray-400 px-1">+{matches.length - 3} more</p>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
