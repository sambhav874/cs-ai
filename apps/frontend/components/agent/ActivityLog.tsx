"use client";

import { ChevronDown } from "lucide-react";
import { traceEventsFromData, type AgentMessage } from "@/lib/agentMessageFormatting";

export interface ActivityLogProps {
  message: AgentMessage;
  isRunning?: boolean;
  traceExpanded: boolean;
  onToggleTraceExpanded: () => void;
}

export function ActivityLog({
  message,
  isRunning = false,
  traceExpanded,
  onToggleTraceExpanded,
}: ActivityLogProps) {
  const events = traceEventsFromData(message.agentTrace);
  const visibleEvents = events.filter((event) => {
    const name = event.event || "";
    if (["input_guard", "context_resolver", "persist_run", "final_response", "tool_result", "tool_start", "verify_answer"].includes(name)) return false;
    const detail = event.detail as any;
    if (name.startsWith("middleware:") && String(detail?.decision) !== "deny" && String(detail?.decision) !== "reject") return false;
    return true;
  });
  if (!visibleEvents.length && !isRunning) return null;

  const isExpanded = traceExpanded || isRunning;
  const tokenUsage = message.tokenUsage as any;

  return (
    <div className="flex flex-col gap-0 select-none">
      <button
        type="button"
        onClick={onToggleTraceExpanded}
        className="flex items-center gap-1.5 text-[11px] text-black/40 hover:text-black/60 transition-colors w-fit"
      >
        <span className="italic">Steps</span>
        {tokenUsage && (
          <span className="ml-1 inline-flex items-center gap-1 rounded-full bg-black/5 px-1.5 py-0.5 text-[9px] text-black/35 font-normal not-italic">
            {(tokenUsage.total_tokens || (tokenUsage.input_tokens + tokenUsage.output_tokens)).toLocaleString()} tok
            {tokenUsage.reasoning_tokens
              ? ` · ${tokenUsage.reasoning_tokens.toLocaleString()} reasoning`
              : ""}
            {message.costUsd && message.costUsd > 0
              ? ` · $${message.costUsd < 0.001 ? "<0.001" : message.costUsd.toFixed(4)}`
              : ""}
          </span>
        )}
        <ChevronDown
          className={`h-3 w-3 transition-transform duration-200 ${isExpanded ? "rotate-180" : ""}`}
        />
      </button>

      {isExpanded && visibleEvents.length > 0 && (
        <div className="mt-2 rounded-xl bg-black/[0.015] overflow-hidden animate-content-in">
          <div
            className="px-3 py-2 space-y-2 font-mono text-[11px] text-black/60 max-h-52 overflow-y-auto"
            style={{ scrollbarWidth: "none" }}
          >
            {visibleEvents.map((event, eventIdx) => {
              const detail = event.detail as any;
              if (event.event === "react_model_step" && detail?.action === "tool") {
                const name = detail?.tool || "tool";
                const args = detail?.args ?? detail;
                const query = typeof args?.query === "string" ? args.query : null;
                return (
                  <div key={eventIdx} className="flex items-start gap-2">
                    <span className="mt-0.5 text-[9px] font-bold uppercase tracking-wider bg-black/8 text-black/50 px-1.5 py-0.5 rounded">
                      call
                    </span>
                    <div className="flex flex-col gap-0.5 min-w-0">
                      <span className="font-semibold text-black/75">{name}</span>
                      {query && (
                        <span className="text-black/45 truncate max-w-xs">{query}</span>
                      )}
                    </div>
                  </div>
                );
              }
              if (event.event === "react_tool_observation") {
                const summary = detail?.summary || null;
                return summary ? (
                  <div key={eventIdx} className="flex items-start gap-2 pl-2">
                    <span className="text-black/30 font-bold mt-0.5">↳</span>
                    <span className="text-black/40 italic truncate max-w-xs">{summary}</span>
                  </div>
                ) : null;
              }
              if (event.event === "react_thought") {
                const thought = detail?.thought || "";
                return thought ? (
                  <div key={eventIdx} className="text-black/30 italic truncate max-w-xs pl-2">
                    Thinking: {thought}
                  </div>
                ) : null;
              }
              if (event.event === "react_memory_recalled") {
                const blocks = Array.isArray(detail?.blocks) ? detail.blocks : [];
                if (!blocks.length) return null;
                return (
                  <div key={eventIdx} className="flex items-start gap-2">
                    <span className="mt-0.5 text-[9px] font-bold uppercase tracking-wider bg-black/8 text-black/50 px-1.5 py-0.5 rounded">
                      memory
                    </span>
                    <div className="flex flex-col gap-1 min-w-0">
                      <span className="text-black/45">
                        Recalled {blocks.length} {blocks.length === 1 ? "item" : "items"}
                        {typeof detail?.total_chars === "number" && typeof detail?.budget_chars === "number"
                          ? ` · ${detail.total_chars.toLocaleString()}/${detail.budget_chars.toLocaleString()} chars`
                          : ""}
                      </span>
                      {blocks.map((block: any) => (
                        <div key={block.name} className="flex items-start gap-1.5 pl-2">
                          <span className="text-black/30 font-bold mt-0.5">↳</span>
                          <div className="min-w-0">
                            <span className="text-black/50">
                              <span className="uppercase text-[9px] font-semibold text-black/40">{block.tier}</span>{" "}
                              {block.heading}
                              {block.truncated ? <span className="text-amber-600"> (truncated)</span> : null}
                            </span>
                          </div>
                        </div>
                      ))}
                      {Array.isArray(detail?.dropped) && detail.dropped.length ? (
                        <span className="pl-2 text-black/30 truncate max-w-xs">
                          Dropped for budget: {detail.dropped.join(", ")}
                        </span>
                      ) : null}
                    </div>
                  </div>
                );
              }
              return null;
            })}
          </div>
        </div>
      )}
    </div>
  );
}
