"use client";

import { ChevronDown, ChevronRight, FileSearch, Quote, Sparkles, Wrench } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

type ReActStep = {
  iteration: number;
  type: "thought" | "tool_call" | "tool_result" | "answer";
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  toolResult?: ReActToolResult;
  answerText?: string;
};

type ReActToolResult = {
  summary?: string;
  matches?: EvidenceMatch[];
  snippet?: string;
  error?: string;
};

type EvidenceMatch = {
  evidence_id?: string;
  segment_id?: string;
  document_id?: string;
  filename?: string;
  page?: number | string;
  quote?: string;
  snippet?: string;
  context?: string;
  score?: number;
  section?: string;
};

interface ReActThinkingStreamProps {
  steps: ReActStep[];
  className?: string;
  documentNamesById?: Record<string, string>;
}

function truncate(text: string, limit = 160) {
  return text.length > limit ? text.slice(0, limit) + "\u2026" : text;
}

function formatToolArg(value: unknown): string {
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "object" && value !== null) return JSON.stringify(value);
  return String(value ?? "");
}

function renderToolArgs(args: Record<string, unknown>) {
  const entries = Object.entries(args).filter(
    ([, v]) => v !== undefined && v !== null && v !== ""
  );
  if (!entries.length) return null;
  return (
    <div className="mt-1 flex flex-wrap gap-1 text-[10px] text-gray-500">
      {entries.slice(0, 4).map(([key, value]) => (
        <span key={key} className="inline-flex items-center rounded bg-gray-100 px-1.5 py-0.5">
          <span className="mr-1 font-medium text-gray-400">{key}:</span>
          {truncate(formatToolArg(value), 80)}
        </span>
      ))}
    </div>
  );
}

function EvidenceCard({ match, documentNamesById }: { match: EvidenceMatch; documentNamesById?: Record<string, string> }) {
  const [expanded, setExpanded] = useState(false);
  const quote = match.quote || match.snippet || match.context || "";
  const docName = match.filename || (match.document_id && documentNamesById?.[match.document_id]) || match.document_id || "Document";
  const page = match.page ? `p. ${match.page}` : "";
  const score = typeof match.score === "number" ? match.score : null;

  return (
    <div className="rounded-md border border-emerald-100 bg-emerald-50/50 px-2.5 py-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-[11px] font-medium text-emerald-700">
            <Quote className="h-3 w-3 shrink-0" />
            <span className="truncate">{docName}</span>
            {page ? <span className="shrink-0 text-emerald-400">{page}</span> : null}
            {score !== null ? (
              <span className="shrink-0 rounded bg-emerald-100 px-1 py-0 text-[10px] text-emerald-600">
                {score.toFixed(1)}
              </span>
            ) : null}
          </div>
          <p className="mt-1 text-[11px] leading-5 text-gray-700 line-clamp-2">
            {quote}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded text-gray-400 hover:bg-emerald-100 hover:text-emerald-600"
        >
          {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        </button>
      </div>
      {expanded ? (
        <div className="mt-2 border-t border-emerald-100 pt-2">
          <p className="text-[11px] leading-5 text-gray-600 whitespace-pre-wrap">{quote}</p>
          {match.evidence_id ? (
            <code className="mt-1.5 block text-[10px] text-gray-400">{match.evidence_id}</code>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function StepIcon({ type }: { type: ReActStep["type"] }) {
  if (type === "thought") return <Sparkles className="h-4 w-4 text-violet-500" />;
  if (type === "tool_call") return <Wrench className="h-4 w-4 text-blue-500" />;
  if (type === "tool_result") return <FileSearch className="h-4 w-4 text-emerald-500" />;
  if (type === "answer") return <Sparkles className="h-4 w-4 text-amber-500" />;
  return <Sparkles className="h-4 w-4 text-gray-400" />;
}

function StepLabel({ step }: { step: ReActStep }) {
  if (step.type === "thought") return "Thinking\u2026";
  if (step.type === "tool_call") return `Calling ${step.toolName || "tool"}`;
  if (step.type === "tool_result") {
    if (step.toolResult?.error) return "Tool error";
    const matchCount = step.toolResult?.matches?.length;
    return matchCount ? `Found ${matchCount} evidence match${matchCount > 1 ? "es" : ""}` : "Tool returned results";
  }
  if (step.type === "answer") return "Answer";
  return "";
}

function StepBadge({ step }: { step: ReActStep }) {
  const colors: Record<ReActStep["type"], string> = {
    thought: "border-violet-100 bg-violet-50 text-violet-600",
    tool_call: "border-blue-100 bg-blue-50 text-blue-600",
    tool_result: "border-emerald-100 bg-emerald-50 text-emerald-600",
    answer: "border-amber-100 bg-amber-50 text-amber-600",
  };

  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium", colors[step.type])}>
      {step.iteration ? `Step ${step.iteration}` : null}
      {step.toolName ? ` \u00b7 ${step.toolName}` : null}
    </span>
  );
}

function ThinkingStreamSkeleton() {
  return (
    <div className="space-y-3 px-3 py-3">
      {[1, 2, 3].map((i) => (
        <div key={i} className="flex items-center gap-3 animate-pulse">
          <div className="h-6 w-6 rounded-full bg-gray-100" />
          <div className="h-3 w-32 rounded bg-gray-100" />
          <div className="ml-auto h-4 w-4 rounded-full bg-gray-100" />
        </div>
      ))}
    </div>
  );
}

export function ReActThinkingStream({ steps, className, documentNamesById }: ReActThinkingStreamProps) {
  const [expanded, setExpanded] = useState(true);

  if (!steps.length) {
    return (
      <div className={cn("rounded-lg border border-gray-200 bg-white", className)}>
        <div className="px-3 py-2 text-xs font-medium text-gray-500">Waiting for agent\u2026</div>
        <ThinkingStreamSkeleton />
      </div>
    );
  }

  return (
    <div className={cn("rounded-lg border border-gray-200 bg-white overflow-hidden", className)}>
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-2 px-3 py-2 text-xs font-medium text-gray-600 hover:bg-gray-50 transition-colors"
      >
        <Sparkles className="h-3.5 w-3.5 text-violet-500" />
        <span>Agent reasoning</span>
        <span className="text-gray-400">{steps.length} step{steps.length > 1 ? "s" : ""}</span>
        <span className="ml-auto">{expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}</span>
      </button>

      {expanded ? (
        <div className="border-t border-gray-100">
          <div className="space-y-0 divide-y divide-gray-50">
            {steps.map((step, index) => (
              <div key={`${step.type}-${step.iteration || index}`} className="px-3 py-2.5">
                <div className="flex items-start gap-2.5">
                  <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gray-50 border border-gray-100">
                    <StepIcon type={step.type} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-medium text-gray-800">{StepLabel({ step })}</span>
                      <StepBadge step={step} />
                    </div>
                    {step.type === "tool_call" && step.toolArgs ? (
                      renderToolArgs(step.toolArgs)
                    ) : null}
                    {step.type === "tool_result" && step.toolResult?.summary ? (
                      <p className="mt-1 text-[11px] leading-4 text-gray-500">{truncate(step.toolResult.summary, 200)}</p>
                    ) : null}
                    {step.type === "tool_result" && step.toolResult?.error ? (
                      <p className="mt-1 text-[11px] leading-4 text-red-500">{step.toolResult.error}</p>
                    ) : null}
                    {step.type === "tool_result" && step.toolResult?.matches?.length ? (
                      <div className="mt-2 space-y-1.5">
                        {step.toolResult.matches.slice(0, 4).map((match, mIndex) => (
                          <EvidenceCard
                            key={match.evidence_id || match.segment_id || mIndex}
                            match={match}
                            documentNamesById={documentNamesById}
                          />
                        ))}
                        {(step.toolResult.matches?.length || 0) > 4 ? (
                          <p className="text-[10px] text-gray-400 pl-1">
                            +{step.toolResult.matches.length - 4} more matches
                          </p>
                        ) : null}
                      </div>
                    ) : null}
                    {step.type === "answer" && step.answerText ? (
                      <p className="mt-1 text-[11px] leading-4 text-gray-700 italic">{truncate(step.answerText, 120)}</p>
                    ) : null}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
