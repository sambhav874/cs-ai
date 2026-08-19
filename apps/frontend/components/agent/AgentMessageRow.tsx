"use client";

import { memo } from "react";
import {
  AlertTriangle,
  Loader2,
  PencilLine,
  RotateCcw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ThinkingDisplay } from "@/components/ThinkingDisplay";
import { MessageActions } from "@/components/agent/MessageActions";
import { ActivityLog } from "@/components/agent/ActivityLog";
import { ArtifactCard } from "@/components/agent/ArtifactCard";
import { MessageMarkdown } from "@/components/agent/MessageMarkdown";
import type { CitationAnnotation } from "@/lib/agent";
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
} from "@/lib/agentMessageFormatting";

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
          {(message.currentThinking || message.agentTrace) && (
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
            <div className="flex items-center gap-2 px-4 py-3 text-sm text-black/45">
              <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" />
              <span>Thinking…</span>
            </div>
          )}

          {message.isDemo && visibleAnswerText(message.content) ? (
            <div className="flex items-center gap-1.5 self-start rounded-md border border-[#EE3224]/30 bg-[#EE3224]/[0.06] px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-[#EE3224]">
              <AlertTriangle className="h-3 w-3" />
              <span>Demo response — not retrieved from this contract</span>
            </div>
          ) : null}

          {/* Markdown text in message container */}
          {visibleAnswerText(message.content) ? (
            <div className={cn(
              "prose prose-neutral prose-p:my-1 max-w-none text-black/85 leading-relaxed text-left text-xs sm:text-[13px] bg-black/[0.015] border border-black/5 hover:bg-black/[0.03] hover:border-black/10 p-4 rounded-xl transition-all duration-300 shadow-sm"
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
                  className="inline-flex items-center gap-1 rounded-md border border-black/10 px-2 py-1 text-[11px] font-medium text-black/60 hover:bg-black/[0.03] hover:text-black disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-[#015CA9] focus-visible:outline-none"
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
            <div className="mt-2 flex min-w-0 flex-col gap-1 border-t border-black/5 pt-2 text-[10px] text-black/50">
              {message.citationAnnotations?.length ? (
                <>
                  <div className="flex items-center justify-between">
                    <span className="font-semibold uppercase tracking-wider text-black/40">Sources</span>
                    {onCorrectFact && (
                      <button
                        type="button"
                        onClick={() => onCorrectFact(cleanDisplayText(message.content))}
                        className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium text-black/40 hover:bg-black/5 hover:text-black/70 transition-colors"
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
                            className="h-4 min-w-4 shrink-0 rounded border border-black/15 bg-white px-1 text-[9px] font-bold text-black hover:bg-black/5 transition-colors"
                          >
                            {annotation.ref}
                          </button>
                          <span className="truncate font-medium text-black/70" title={docName}>{docName}</span>
                          <span className="shrink-0 text-black/30">·</span>
                          <span className="shrink-0 text-black/50">{page}</span>
                        </div>
                      );
                    })}
                  </div>
                </>
              ) : message.citation ? (
                <div className="flex items-center justify-between">
                  <span className="min-w-0 break-words text-black/45">Source: {cleanDisplayText(message.citation)}</span>
                  {onCorrectFact && (
                    <button
                      type="button"
                      onClick={() => onCorrectFact(cleanDisplayText(message.content))}
                      className="shrink-0 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium text-black/40 hover:bg-black/5 hover:text-black/70 transition-colors"
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
        <div className="max-w-[80%] rounded-2xl bg-black/5 text-black px-4 py-3 text-sm shadow-sm font-medium break-words">
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
