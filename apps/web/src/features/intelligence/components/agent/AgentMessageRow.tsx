import { memo } from "react";
import {
  AlertTriangle,
  Loader2,
  PencilLine,
  RotateCcw,
} from "lucide-react";
import { cn } from "@cs/lib/utils";
import { ThinkingDisplay } from "@cs/components/ThinkingDisplay";
import { MessageActions } from "@cs/components/agent/MessageActions";
import { ActivityLog } from "@cs/components/agent/ActivityLog";
import { ArtifactCard } from "@cs/components/agent/ArtifactCard";
import { MessageMarkdown } from "@cs/components/agent/MessageMarkdown";
import type { CitationAnnotation } from "@cs/lib/agent";
import {
  citationDocumentName,
  citationQuote,
  cleanDisplayText,
  getUsedAndSortedAnnotations,
  shouldShowSources,
  visibleAnswerText,
  type AgentArtifact,
  type AgentEditAnnotation,
  type AgentMessage,
  type CitedSegment,
} from "@cs/lib/agentMessageFormatting";

export interface AgentMessageRowProps {
  message: AgentMessage;
  isRunning: boolean;
  isLastAgentMessage: boolean;
  isThinking: boolean;
  traceExpanded: boolean;
  onToggleTraceExpanded: () => void;
  onCitationClick?: (
    citationText: string,
    confidence: "high" | "medium" | "low",
    citedSegments?: CitedSegment[],
    targetContractId?: string | null,
    targetFilename?: string | null,
  ) => void;
  retryLastQuestion: () => void;
  resolvingEditIds: Set<string>;
  onArtifactCreated?: (artifact: AgentArtifact) => void;
  downloadAgentArtifact: (artifact: AgentArtifact) => void;
  resolveArtifactEdit: (
    artifact: AgentArtifact,
    edit: AgentEditAnnotation,
    mode: "accept" | "reject",
  ) => void;
  resolveArtifactEditsBulk: (
    artifact: AgentArtifact,
    edits: AgentEditAnnotation[],
    mode: "accept" | "reject",
  ) => void;
  onCorrectFact?: (factText?: string) => void;
}

function AgentMessageRowComponent({
  message,
  isRunning,
  isLastAgentMessage,
  isThinking,
  traceExpanded,
  onToggleTraceExpanded,
  onCitationClick,
  retryLastQuestion,
  resolvingEditIds,
  onArtifactCreated,
  downloadAgentArtifact,
  resolveArtifactEdit,
  resolveArtifactEditsBulk,
  onCorrectFact,
}: AgentMessageRowProps) {
  const handleCitationClick = (annotation: CitationAnnotation) => {
    const confidence = message.confidence ?? "medium";
    const citationText = citationQuote(annotation) || cleanDisplayText(message.citation) || "";
    const targetContractId = annotation.document_id || annotation.contract_id || annotation.doc_id || null;
    const targetFilename = annotation.filename || null;
    onCitationClick?.(
      citationText,
      confidence,
      undefined,
      targetContractId,
      targetFilename,
    );
  };

  return (
    <div
      key={message.id}
      className={cn(
        "flex w-full",
        message.role === "user" ? "justify-end" : "justify-start"
      )}
    >
      {message.role === "agent" ? (
        <div className="flex flex-col gap-3 w-full">
          {/* Collapsible Agent Trace / Thinking */}
          {/* Length, not the array: `agentTrace` is [] for a message with no
              trace, which is truthy, so this rendered an empty panel. Wrapped
              in Boolean() for the same reason line 1232 of the agent page is —
              a bare 0 otherwise reaches the transcript. */}
          {Boolean(message.currentThinking || message.agentTrace?.length) && (
            <div className="flex flex-col gap-2 select-none">
              <ThinkingDisplay
                thinking={message.currentThinking}
                isStreaming={isRunning && !visibleAnswerText(message.content)}
                hasRedacted={false}
                durationMs={undefined}
                defaultExpanded={false}
              />

              {/* ReAct steps if any */}
              <ActivityLog
                message={message}
                isRunning={isRunning}
                traceExpanded={traceExpanded}
                onToggleTraceExpanded={onToggleTraceExpanded}
              />
            </div>
          )}

          {isRunning && !visibleAnswerText(message.content) && !message.currentThinking && !message.agentTrace?.length && (
            <div className="flex items-center gap-2 px-4 py-3 text-sm text-fg-950/45">
              <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" />
              <span>Thinking…</span>
            </div>
          )}

          {message.isDemo && visibleAnswerText(message.content) ? (
            <div className="flex items-center gap-1.5 self-start rounded-md border border-risk-600/30 bg-risk-600/[0.06] px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-risk-600">
              <AlertTriangle className="h-3 w-3" />
              <span>Demo response — not retrieved from this contract</span>
            </div>
          ) : null}

          {/* Markdown text in message container */}
          {visibleAnswerText(message.content) ? (
            <div className={cn(
              "prose prose-neutral prose-p:my-1 max-w-none text-fg-950/85 leading-relaxed text-left text-xs sm:text-[13px] bg-black/[0.015] border border-fg-950/5 hover:bg-black/[0.03] hover:border-fg-950/10 p-4 rounded-lg transition-all duration-300 shadow-e1"
            )}>
              <MessageMarkdown message={message} onCitationClick={onCitationClick} />
            </div>
          ) : null}

          {visibleAnswerText(message.content) && (
            <div className="flex items-center gap-2">
              <MessageActions text={visibleAnswerText(message.content)} />
              {isLastAgentMessage && message.activity?.some((activity) => activity.status === "error") ? (
                <button
                  type="button"
                  onClick={retryLastQuestion}
                  disabled={isThinking}
                  aria-label="Retry last question"
                  className="inline-flex items-center gap-1 rounded-md border border-fg-950/10 px-2 py-1 text-[11px] font-medium text-fg-950/60 hover:bg-black/[0.03] hover:text-fg-950 disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-primary-700 focus-visible:outline-none"
                >
                  <RotateCcw className="h-3 w-3" />
                  Retry
                </button>
              ) : null}
            </div>
          )}

          {message.artifacts?.length ? (
            <div className="space-y-2 mt-1">
              {message.artifacts.map((artifact) => (
                <ArtifactCard
                  key={artifact.artifact_id}
                  artifact={artifact}
                  resolvingEditIds={resolvingEditIds}
                  onArtifactCreated={onArtifactCreated}
                  downloadAgentArtifact={downloadAgentArtifact}
                  resolveArtifactEdit={resolveArtifactEdit}
                  resolveArtifactEditsBulk={resolveArtifactEditsBulk}
                />
              ))}
            </div>
          ) : null}

          {shouldShowSources(message) && (message.citationAnnotations?.length || message.citation) ? (
            <div className="mt-2 flex min-w-0 flex-col gap-1 border-t border-fg-950/5 pt-2 text-[10px] text-fg-950/50">
              {message.citationAnnotations?.length ? (
                <>
                  <div className="flex items-center justify-between">
                    <span className="font-semibold uppercase tracking-wider text-fg-950/40">Sources</span>
                    {onCorrectFact && (
                      <button
                        type="button"
                        onClick={() => onCorrectFact(cleanDisplayText(message.content))}
                        className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium text-fg-950/40 hover:bg-fg-950/5 hover:text-fg-950/70 transition-colors"
                        title="Dispute or correct a stated fact"
                      >
                        <PencilLine className="h-2.5 w-2.5" />
                        <span>Correct fact</span>
                      </button>
                    )}
                  </div>
                  <div className="mt-1 flex min-w-0 flex-col gap-1.5">
                    {getUsedAndSortedAnnotations(message).map((annotation) => {
                      const docName = citationDocumentName(annotation);
                      const page = annotation.page ? `Page ${annotation.page}` : "Source document";
                      return (
                        <div key={annotation.ref} className="flex min-w-0 items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => handleCitationClick(annotation)}
                            className="h-4 min-w-4 shrink-0 rounded border border-fg-950/15 bg-card px-1 text-[9px] font-bold text-fg-950 hover:bg-fg-950/5 transition-colors"
                          >
                            {annotation.ref}
                          </button>
                          <span className="truncate font-medium text-fg-950/70" title={docName}>{docName}</span>
                          <span className="shrink-0 text-fg-950/30">·</span>
                          <span className="shrink-0 text-fg-950/50">{page}</span>
                        </div>
                      );
                    })}
                  </div>
                </>
              ) : message.citation ? (
                <div className="flex items-center justify-between">
                  <span className="min-w-0 break-words text-fg-950/45">Source: {cleanDisplayText(message.citation)}</span>
                  {onCorrectFact && (
                    <button
                      type="button"
                      onClick={() => onCorrectFact(cleanDisplayText(message.content))}
                      className="shrink-0 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium text-fg-950/40 hover:bg-fg-950/5 hover:text-fg-950/70 transition-colors"
                      title="Dispute or correct a stated fact"
                    >
                      <PencilLine className="h-2.5 w-2.5" />
                      <span>Correct fact</span>
                    </button>
                  )}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : (
        <div className="max-w-[80%] rounded-lg bg-fg-950/5 text-fg-950 px-4 py-3 text-sm shadow-e1 font-medium break-words">
          {message.content}
        </div>
      )}
    </div>
  );
}

export const AgentMessageRow = memo(AgentMessageRowComponent, (prev, next) => (
  prev.message.id === next.message.id &&
  prev.message.content === next.message.content &&
  prev.message.currentThinking === next.message.currentThinking &&
  prev.message.agentTrace === next.message.agentTrace &&
  prev.message.artifacts === next.message.artifacts &&
  prev.message.citationAnnotations === next.message.citationAnnotations &&
  prev.isRunning === next.isRunning &&
  prev.isLastAgentMessage === next.isLastAgentMessage &&
  prev.isThinking === next.isThinking &&
  prev.traceExpanded === next.traceExpanded &&
  prev.resolvingEditIds === next.resolvingEditIds
));
