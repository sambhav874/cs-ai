"use client";

import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Coins,
  Eye,
  GitBranch,
  Route,
  ShieldCheck,
  Wrench,
} from "lucide-react";
import type { AgentTokenUsage, AgentTraceEvent } from "@/lib/agent";
import { cn } from "@/lib/utils";

type LegacyAgentTrace = Record<string, unknown>;
type AgentTraceInput = AgentTraceEvent[] | LegacyAgentTrace | null | undefined;

interface AgentTraceViewProps {
  trace?: AgentTraceInput;
  tokenUsage?: AgentTokenUsage | null;
  costUsd?: number | null;
  className?: string;
}

function text(value: unknown) {
  return String(value ?? "").trim();
}

function numberText(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? String(value) : text(value);
}

function toTraceEvents(trace: AgentTraceInput): AgentTraceEvent[] {
  if (!trace) return [];
  if (Array.isArray(trace)) return trace.filter((event) => event && event.event);

  const detail = trace;
  const events: AgentTraceEvent[] = [];
  const taskType = text(detail.task_type);
  const provider = text(detail.provider);
  const fallbackReason = text(detail.fallback_reason);

  if (taskType || provider || detail.iterations || detail.retrieval_count || detail.citation_count) {
    events.push({
      event: "legacy_agent_trace",
      detail: {
        task_type: taskType,
        provider,
        iterations: detail.iterations,
        retrieval_count: detail.retrieval_count,
        citation_count: detail.citation_count,
        duration_ms: detail.duration_ms,
      },
    });
  }

  const tools = Array.isArray(detail.tools) ? detail.tools.map(text).filter(Boolean) : [];
  tools.forEach((tool, index) => {
    events.push({
      event: "react_tool_observation",
      detail: {
        iteration: index + 1,
        tool,
        status: "done",
        summary: "Tool participated in the evidence run.",
      },
    });
  });

  if (fallbackReason) {
    events.push({
      event: "middleware:VerifierFallback",
      detail: {
        decision: "note",
        reason: fallbackReason,
      },
    });
  }

  return events;
}

function eventTitle(event: AgentTraceEvent) {
  const name = text(event.event) || "agent_event";
  const detail = event.detail ?? {};
  if (name === "react_model_step") {
    const action = text(detail.action) || "next step";
    const tool = text(detail.tool);
    return action === "final" ? "Model finalized answer" : `Model chose ${action}${tool ? `: ${tool}` : ""}`;
  }
  if (name === "react_tool_observation") {
    return `Observed ${text(detail.tool) || "tool result"}`;
  }
  if (name === "legacy_agent_trace") {
    return "Evidence run summary";
  }
  if (name.startsWith("middleware:")) {
    return name.replace("middleware:", "Safety: ");
  }
  return name.replaceAll("_", " ");
}

function eventSummary(event: AgentTraceEvent) {
  const detail = event.detail ?? {};
  const summary = text(detail.summary);
  const reason = text(detail.reason);
  const action = text(detail.action);
  const workflow = text(detail.workflow);
  const issueCount = text(detail.issue_count);

  if (summary) return summary;
  if (reason) return reason;
  if (action) return `Action: ${action}`;
  if (workflow) return `Workflow: ${workflow}`;
  if (issueCount) return `${issueCount} verifier issue${issueCount === "1" ? "" : "s"}`;
  return "";
}

function eventTone(eventName: string, status?: string) {
  if (status === "error" || eventName.toLowerCase().includes("fallback")) return "border-amber-200 bg-amber-50 text-amber-700";
  if (eventName === "react_model_step") return "border-blue-200 bg-blue-50 text-blue-700";
  if (eventName === "react_tool_observation") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (eventName.includes("guard") || eventName.includes("middleware")) return "border-amber-200 bg-amber-50 text-amber-700";
  return "border-gray-200 bg-white text-gray-600";
}

function eventIcon(eventName: string) {
  if (eventName === "react_tool_observation") return <Wrench className="h-3.5 w-3.5" />;
  if (eventName === "react_model_step") return <Route className="h-3.5 w-3.5" />;
  if (eventName === "legacy_agent_trace") return <GitBranch className="h-3.5 w-3.5" />;
  if (eventName.includes("guard")) return <ShieldCheck className="h-3.5 w-3.5" />;
  if (eventName.toLowerCase().includes("fallback")) return <AlertTriangle className="h-3.5 w-3.5" />;
  return <Eye className="h-3.5 w-3.5" />;
}

function detailPills(event: AgentTraceEvent) {
  const detail = event.detail ?? {};
  return [
    detail.iteration ? `step ${numberText(detail.iteration)}` : null,
    detail.status ? text(detail.status) : null,
    detail.decision ? text(detail.decision) : null,
    detail.tool ? text(detail.tool) : null,
    detail.task_type ? text(detail.task_type).replaceAll("_", " ") : null,
    detail.provider ? text(detail.provider) : null,
  ].filter((item): item is string => Boolean(item));
}

function detailRows(event: AgentTraceEvent) {
  const detail = event.detail ?? {};
  const keys = [
    "action",
    "tool",
    "status",
    "decision",
    "iteration",
    "task_type",
    "provider",
    "retrieval_count",
    "citation_count",
    "duration_ms",
    "workflow",
  ];
  return keys
    .map((key) => [key, detail[key]] as const)
    .filter(([, value]) => text(value));
}

function formatDetailKey(key: string) {
  return key.replaceAll("_", " ");
}

function shouldHideRoutineTraceEvent(event: AgentTraceEvent) {
  const eventName = event.event || "";
  const detail = event.detail ?? {};
  if (
    [
      "model_step",
      "input_guard",
      "context_resolver",
      "tool_start",
      "tool_result",
      "verify_answer",
      "persist_run",
      "final_response",
    ].includes(eventName)
  ) {
    return true;
  }
  if (eventName.startsWith("middleware:")) {
    const decision = text(detail.decision);
    return decision !== "deny" && decision !== "reject";
  }
  return false;
}

export function AgentTraceView({ trace = [], tokenUsage, costUsd, className }: AgentTraceViewProps) {
  const visibleTrace = toTraceEvents(trace).filter((event) => !shouldHideRoutineTraceEvent(event));
  if (!visibleTrace.length && !tokenUsage && !costUsd) return null;

  const modelSteps = visibleTrace.filter((event) => event.event === "react_model_step").length;
  const toolSteps = visibleTrace.filter((event) => event.event === "react_tool_observation").length;
  const observationSteps = visibleTrace.filter((event) => event.event !== "react_model_step").length;

  return (
    <details className={cn("group overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm", className)}>
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-[11px] font-medium text-gray-700 outline-none transition-colors hover:bg-gray-50 focus-visible:ring-2 focus-visible:ring-gray-300">
        <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md border border-gray-200 bg-gray-50 text-gray-600">
          <GitBranch className="h-3.5 w-3.5" />
        </span>
        <span className="min-w-0 flex-1 truncate">Run details</span>
        {modelSteps ? <span className="rounded-full bg-blue-50 px-1.5 py-0.5 text-[10px] text-blue-700">{modelSteps} model</span> : null}
        {toolSteps ? <span className="rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] text-emerald-700">{toolSteps} tools</span> : null}
        {!toolSteps && observationSteps ? <span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-600">{observationSteps} events</span> : null}
        {typeof costUsd === "number" && costUsd > 0 ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-600">
            <Coins className="h-3 w-3" />
            ${costUsd.toFixed(4)}
          </span>
        ) : null}
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-gray-400 transition-transform group-open:rotate-180" />
      </summary>

      <div className="space-y-2 border-t border-gray-200 bg-gray-50/70 p-2.5">
        {tokenUsage ? (
          <div className="grid grid-cols-3 gap-1.5 text-center text-[10px] text-gray-600">
            <div className="rounded-md border border-gray-200 bg-white px-2 py-1.5">
              <div className="font-semibold text-gray-900">{tokenUsage.input_tokens ?? 0}</div>
              <div>input</div>
            </div>
            <div className="rounded-md border border-gray-200 bg-white px-2 py-1.5">
              <div className="font-semibold text-gray-900">{tokenUsage.output_tokens ?? 0}</div>
              <div>output</div>
            </div>
            <div className="rounded-md border border-gray-200 bg-white px-2 py-1.5">
              <div className="font-semibold text-gray-900">{tokenUsage.total_tokens ?? 0}</div>
              <div>total</div>
            </div>
          </div>
        ) : null}

        <div className="space-y-1.5">
          {visibleTrace.map((event, index) => {
            const name = text(event.event);
            const summary = eventSummary(event);
            const status = text(event.detail?.status);
            const pills = detailPills(event);
            const rows = detailRows(event);
            return (
              <details key={`${name}-${index}`} className="group/trace overflow-hidden rounded-md border border-gray-200 bg-white">
                <summary className="flex cursor-pointer list-none items-start gap-2 px-2.5 py-2 outline-none focus-visible:ring-2 focus-visible:ring-gray-300">
                  <span className={cn("mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md border", eventTone(name, status))}>
                    {eventIcon(name)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[11px] font-medium capitalize text-gray-800">{eventTitle(event)}</span>
                    {summary ? <span className="line-clamp-2 text-[10px] leading-4 text-gray-500">{summary}</span> : null}
                    {pills.length ? (
                      <span className="mt-1 flex flex-wrap gap-1">
                        {pills.slice(0, 4).map((pill) => (
                          <span key={pill} className="rounded-full bg-gray-100 px-1.5 py-0.5 text-[9px] leading-none text-gray-500">
                            {pill}
                          </span>
                        ))}
                      </span>
                    ) : null}
                  </span>
                  <ChevronDown className="mt-1 h-3 w-3 shrink-0 text-gray-400 transition-transform group-open/trace:rotate-180" />
                </summary>
                {rows.length ? (
                  <dl className="grid grid-cols-[88px_minmax(0,1fr)] gap-x-2 gap-y-1 border-t border-gray-100 bg-white px-2.5 py-2 text-[10px] leading-4">
                    {rows.map(([key, value]) => (
                      <div key={key} className="contents">
                        <dt className="capitalize text-gray-400">{formatDetailKey(key)}</dt>
                        <dd className="min-w-0 break-words text-gray-700">{numberText(value)}</dd>
                      </div>
                    ))}
                  </dl>
                ) : null}
              </details>
            );
          })}
          {!visibleTrace.length ? (
            <div className="flex items-center gap-2 rounded-md border border-gray-200 bg-white px-2.5 py-2 text-[11px] text-gray-500">
              <CheckCircle2 className="h-3.5 w-3.5 text-gray-400" />
              Token and cost metadata recorded for this run.
            </div>
          ) : null}
        </div>
      </div>
    </details>
  );
}
