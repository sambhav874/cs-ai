import { ChevronDown } from "lucide-react";
import { traceEventsFromData, type AgentMessage } from "@cs/lib/agentMessageFormatting";

export interface ActivityLogProps {
  message: AgentMessage;
  isRunning?: boolean;
  traceExpanded: boolean;
  onToggleTraceExpanded: () => void;
}

// Arguments that tell one call apart from another, in the order they space.
// `read_schedules(view=values)` and `read_schedules(view=history)` are the same
// line without these, and so are the four views of project_memory.
const DISTINGUISHING_ARGS = [
  "view",
  "mode",
  "schedule",
  "as_of",
  "document_id",
  "section_ref",
  "target_project_id",
];

// Rendered on their own line rather than as a chip: these carry the user's own
// words and are worth reading in full.
const PROSE_ARGS = ["query", "exact", "text", "instructions"];

function argChips(args: Record<string, unknown> | undefined): string[] {
  if (!args) return [];
  const chips: string[] = [];
  for (const key of DISTINGUISHING_ARGS) {
    const value = args[key];
    if (value === undefined || value === null || value === "") continue;
    const text = String(value);
    chips.push(`${key}=${text.length > 40 ? `${text.slice(0, 39)}…` : text}`);
  }
  return chips;
}

// The same run reaches this component under three different event names.
// The project panel stores the raw SSE names, the contract panel's stream hook
// synthesizes its own, and a reloaded conversation carries what the backend
// persisted. Normalising here rather than at each call site is what stopped
// the two panels from needing two renderers — and drifting once they had them.
type Step =
  | { kind: "call"; tool: string; args: Record<string, unknown> }
  | { kind: "observation"; tool: string; summary: string; failed: boolean }
  | { kind: "thought"; thought: string }
  | { kind: "memory"; detail: Record<string, unknown> };

const FAILED_STATUSES = new Set(["error", "failed", "rejected", "denied"]);

function toStep(event: { event?: string; detail?: any }): Step | null {
  const name = event.event || "";
  const detail = (event.detail ?? {}) as Record<string, any>;

  const isCall =
    (name === "react_model_step" && detail.action === "tool") ||
    (name === "model_step" && detail.action === "tool_call") ||
    name === "tool_call";
  if (isCall) {
    return {
      kind: "call",
      tool: String(detail.tool || detail.name || "tool"),
      args: (detail.args ?? detail.input ?? {}) as Record<string, unknown>,
    };
  }

  if (name === "react_tool_observation" || name === "tool_result") {
    const summary = String(detail.summary || detail.result_summary || "").trim();
    if (!summary) return null;
    return {
      kind: "observation",
      tool: String(detail.tool || detail.name || ""),
      summary,
      // A failed call that renders like a successful one is how a user comes to
      // believe an answer rests on evidence the agent never actually got.
      failed: FAILED_STATUSES.has(String(detail.status || "").toLowerCase()),
    };
  }

  if (name === "react_thought") {
    const thought = String(detail.thought || "").trim();
    return thought ? { kind: "thought", thought } : null;
  }

  if (name === "react_memory_recalled") {
    return { kind: "memory", detail };
  }

  return null;
}

function argProse(args: Record<string, unknown> | undefined): string | null {
  if (!args) return null;
  for (const key of PROSE_ARGS) {
    const value = args[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  const queries = args["queries"];
  if (Array.isArray(queries) && queries.length) return queries.map(String).join(" · ");
  return null;
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
    // "tool_result" is NOT filtered here any more. It is the project panel's
    // name for an observation, and dropping it left that panel showing calls
    // with no results at all — and, worse, no failures, since a failed call is
    // only ever reported on the result.
    if (["input_guard", "context_resolver", "persist_run", "final_response", "tool_start", "verify_answer"].includes(name)) return false;
    const detail = event.detail as any;
    if (name.startsWith("middleware:") && String(detail?.decision) !== "deny" && String(detail?.decision) !== "reject") return false;
    return true;
  });
  if (!visibleEvents.length && !isRunning) return null;

  const isExpanded = traceExpanded || isRunning;
  const tokenUsage = message.tokenUsage as any;

  // A collapsed panel that says only "Steps" tells the reader nothing about
  // whether the answer came from four tools or from none, so the one fact
  // worth having at a glance is shown without expanding. A failure is named
  // here too — the collapsed state is exactly where a user would otherwise
  // never learn a tool call did not succeed.
  const steps = visibleEvents.map(toStep).filter(Boolean) as Step[];
  const callCount = steps.filter((step) => step.kind === "call").length;
  const failedCount = steps.filter(
    (step) => step.kind === "observation" && step.failed
  ).length;
  const summaryBits: string[] = [];
  if (callCount) summaryBits.push(`${callCount} ${callCount === 1 ? "tool" : "tools"}`);
  if (failedCount) summaryBits.push(`${failedCount} failed`);

  return (
    <div className="flex flex-col gap-0 select-none">
      <button
        type="button"
        onClick={onToggleTraceExpanded}
        className="flex items-center gap-1.5 text-[11px] text-fg-950/40 hover:text-fg-950/60 transition-colors w-fit"
      >
        <span className="italic">Steps</span>
        {summaryBits.length > 0 && (
          <span
            className={`not-italic ${failedCount ? "text-risk-600/70" : "text-fg-950/35"}`}
          >
            {summaryBits.join(" · ")}
          </span>
        )}
        {tokenUsage && (
          <span className="ml-1 inline-flex items-center gap-1 rounded-full bg-fg-950/5 px-1.5 py-0.5 text-[9px] text-fg-950/35 font-normal not-italic">
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
        <div className="mt-2 rounded-lg bg-black/[0.015] overflow-hidden animate-content-in">
          <div
            className="px-3 py-2 space-y-2 font-mono text-[11px] text-fg-950/60 max-h-52 overflow-y-auto"
            style={{ scrollbarWidth: "none" }}
          >
            {steps.map((step, stepIdx) => {
              if (step.kind === "call") {
                const chips = argChips(step.args);
                const prose = argProse(step.args);
                return (
                  <div key={stepIdx} className="flex items-start gap-2">
                    <span className="mt-0.5 text-[9px] font-bold uppercase tracking-wider bg-fg-950/10 text-fg-950/50 px-1.5 py-0.5 rounded">
                      call
                    </span>
                    <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-1.5">
                        <span className="font-semibold text-fg-950/75">{step.tool}</span>
                        {chips.map((chip) => (
                          <span
                            key={chip}
                            className="rounded bg-black/[0.06] px-1 py-px text-[10px] text-fg-950/50"
                          >
                            {chip}
                          </span>
                        ))}
                      </span>
                      {prose && (
                        <span className="text-fg-950/45 break-words line-clamp-2" title={prose}>
                          {prose}
                        </span>
                      )}
                    </div>
                  </div>
                );
              }

              if (step.kind === "observation") {
                return (
                  <div key={stepIdx} className="flex items-start gap-2 pl-2">
                    <span
                      className={`font-bold mt-0.5 ${step.failed ? "text-risk-600/70" : "text-fg-950/30"}`}
                    >
                      {step.failed ? "×" : "↳"}
                    </span>
                    <span
                      className={`italic break-words line-clamp-2 flex-1 ${
                        step.failed ? "text-risk-700/70 not-italic" : "text-fg-950/40"
                      }`}
                      title={step.summary}
                    >
                      {step.failed ? "failed — " : ""}
                      {step.summary}
                    </span>
                  </div>
                );
              }

              if (step.kind === "thought") {
                return (
                  <div
                    key={stepIdx}
                    className="text-fg-950/30 italic break-words line-clamp-2 pl-2"
                    title={step.thought}
                  >
                    Thinking: {step.thought}
                  </div>
                );
              }

              const detail = step.detail as any;
              const blocks = Array.isArray(detail?.blocks) ? detail.blocks : [];
              if (!blocks.length) return null;
              return (
                <div key={stepIdx} className="flex items-start gap-2">
                  <span className="mt-0.5 text-[9px] font-bold uppercase tracking-wider bg-fg-950/10 text-fg-950/50 px-1.5 py-0.5 rounded">
                    memory
                  </span>
                  <div className="flex flex-col gap-1 min-w-0">
                    <span className="text-fg-950/45">
                      Recalled {blocks.length} {blocks.length === 1 ? "item" : "items"}
                      {typeof detail?.total_chars === "number" && typeof detail?.budget_chars === "number"
                        ? ` · ${detail.total_chars.toLocaleString()}/${detail.budget_chars.toLocaleString()} chars`
                        : ""}
                    </span>
                    {blocks.map((block: any) => (
                      <div key={block.name} className="flex items-start gap-1.5 pl-2">
                        <span className="text-fg-950/30 font-bold mt-0.5">↳</span>
                        <div className="min-w-0">
                          <span className="text-fg-950/50">
                            <span className="uppercase text-[9px] font-semibold text-fg-950/40">{block.tier}</span>{" "}
                            {block.heading}
                            {block.truncated ? <span className="text-attention-600"> (truncated)</span> : null}
                          </span>
                        </div>
                      </div>
                    ))}
                    {Array.isArray(detail?.dropped) && detail.dropped.length ? (
                      <span className="pl-2 text-fg-950/30 break-words">
                        Dropped for budget: {detail.dropped.join(", ")}
                      </span>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
