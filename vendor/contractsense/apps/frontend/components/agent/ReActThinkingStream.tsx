"use client";

import { ChevronDown, ChevronRight, Terminal, CheckCircle2, AlertCircle, Play } from "lucide-react";
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
  isRunning?: boolean;
}

const TOOL_LABELS: Record<string, string> = {
  search_evidence: "search_evidence",
  find_in_document: "find_in_document",
  read_document: "read_document",
  outline_document: "outline_document",
  list_documents: "list_documents",
  get_kpi_context: "get_kpi_context",
  calculate_from_evidence: "calculate_from_evidence",
  suggest_tabular_review: "suggest_tabular_review",
  create_tabular_review: "create_tabular_review",
  extract_kpis: "extract_kpis",
};

function truncate(text: string, limit = 160) {
  return text.length > limit ? text.slice(0, limit) + "\u2026" : text;
}

function formatToolCall(toolName?: string, args?: Record<string, unknown>): string {
  if (!toolName) return "";
  const name = TOOL_LABELS[toolName] || toolName;
  const argStrings: string[] = [];
  if (args) {
    for (const [key, value] of Object.entries(args)) {
      if (value !== undefined && value !== null && value !== "") {
        const valStr = typeof value === "string" ? `"${truncate(value, 30)}"` : JSON.stringify(value);
        argStrings.push(`${key}=${valStr}`);
      }
    }
  }
  return `${name}(${argStrings.join(", ")})`;
}

export function ReActThinkingStream({ steps, className, isRunning }: ReActThinkingStreamProps) {
  const [expanded, setExpanded] = useState(true);

  if (!steps.length && !isRunning) return null;

  const lastStep = steps[steps.length - 1];
  const isLastThought = lastStep?.type === "thought";
  const isLastToolCall = lastStep?.type === "tool_call";

  return (
    <div className={cn("my-3 w-full rounded-xl border border-slate-200/80 bg-slate-50/50 shadow-sm overflow-hidden", className)}>
      {/* Header Bar */}
      <div 
        onClick={() => setExpanded(!expanded)}
        className="flex items-center justify-between px-3 py-2 cursor-pointer hover:bg-slate-100/60 select-none transition-colors border-b border-slate-100"
      >
        <div className="flex items-center gap-2">
          <Terminal className={cn("h-3.5 w-3.5", isRunning ? "text-blue-500 animate-pulse" : "text-slate-400")} />
          <span className="text-[11px] font-semibold tracking-wider uppercase text-slate-500 font-sans">
            {isRunning ? "Agent Agentic Workflow" : "Agentic Steps Trace"}
          </span>
          {isRunning ? (
            <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[9px] font-medium bg-blue-50 text-blue-600 border border-blue-100 animate-pulse">
              Running
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-[10px] text-emerald-600 font-sans font-medium">
              <CheckCircle2 className="h-3 w-3" />
              Completed
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-slate-400 font-sans font-medium">
            {steps.length} steps
          </span>
          <div className="text-slate-400 hover:text-slate-600 transition-colors">
            {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </div>
        </div>
      </div>

      {/* Console Display */}
      {expanded ? (
        <div className="p-3 bg-slate-950 text-slate-300 font-mono text-[10.5px] leading-relaxed space-y-2.5 max-h-[320px] overflow-y-auto scrollbar-thin scrollbar-thumb-slate-800 scrollbar-track-transparent">
          {steps.map((step, idx) => {
            const isLatestStep = idx === steps.length - 1;
            const showCursor = isLatestStep && isRunning;

            switch (step.type) {
              case "thought":
                return (
                  <div key={idx} className="space-y-1">
                    <div className="text-emerald-400/90 font-bold flex items-center gap-1.5 select-none">
                      <Play className="h-2.5 w-2.5 shrink-0 transform rotate-90 text-emerald-500" />
                      <span>THOUGHT #{step.iteration || idx + 1}</span>
                    </div>
                    <div className="pl-4 text-slate-300/90 whitespace-pre-wrap leading-relaxed">
                      {step.answerText}
                      {showCursor && isLastThought && (
                        <span className="inline-block h-3.5 w-1.5 bg-emerald-400 ml-1 animate-pulse" />
                      )}
                    </div>
                  </div>
                );

              case "tool_call":
                return (
                  <div key={idx} className="space-y-0.5">
                    <div className="text-cyan-400 font-bold flex items-center gap-1.5 select-none">
                      <Play className="h-2.5 w-2.5 shrink-0 text-cyan-400" />
                      <span>CALL_TOOL</span>
                    </div>
                    <div className="pl-4 text-cyan-200/90 whitespace-pre-wrap break-all">
                      {formatToolCall(step.toolName, step.toolArgs)}
                      {showCursor && isLastToolCall && (
                        <span className="inline-block h-3.5 w-1.5 bg-cyan-400 ml-1 animate-pulse" />
                      )}
                    </div>
                  </div>
                );

              case "tool_result":
                return (
                  <div key={idx} className="space-y-0.5 border-l border-slate-800 pl-3 ml-1">
                    <div className="text-amber-400/90 font-semibold flex items-center gap-1.5 select-none">
                      <span>OBSERVATION</span>
                    </div>
                    <div className="text-slate-400 whitespace-pre-wrap">
                      {step.toolResult?.error ? (
                        <span className="text-red-400 flex items-center gap-1">
                          <AlertCircle className="h-3 w-3 shrink-0" />
                          {step.toolResult.error}
                        </span>
                      ) : (
                        step.toolResult?.summary || "Execution completed."
                      )}
                    </div>
                  </div>
                );

              case "answer":
                return (
                  <div key={idx} className="space-y-0.5 pt-1 border-t border-slate-900">
                    <div className="text-indigo-400 font-bold flex items-center gap-1.5 select-none">
                      <CheckCircle2 className="h-3 w-3 text-indigo-400" />
                      <span>FINAL_ANSWER</span>
                    </div>
                    <div className="pl-4 text-indigo-200/90 italic">
                      {step.answerText}
                    </div>
                  </div>
                );

              default:
                return null;
            }
          })}

          {/* Active indicator when waiting for LLM next turn */}
          {isRunning && !isLastThought && !isLastToolCall && (
            <div className="flex items-center gap-2 text-slate-500 italic select-none">
              <span className="h-1.5 w-1.5 rounded-full bg-blue-500 animate-ping" />
              <span>Awaiting model response...</span>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
