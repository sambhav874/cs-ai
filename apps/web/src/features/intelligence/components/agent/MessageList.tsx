import type { RefObject } from "react";
import { ArrowRight, Sparkles } from "lucide-react";
import { AgentMessageRow } from "@cs/components/agent/AgentMessageRow";
import {
  quickActions,
  type AgentArtifact,
  type AgentEditAnnotation,
  type AgentMessage,
  type CitedSegment,
} from "@cs/lib/agentMessageFormatting";

export interface MessageListProps {
  messages: AgentMessage[];
  userName?: string;
  isThinking: boolean;
  handleQuickAction: (action: string) => void;
  messagesEndRef: RefObject<HTMLDivElement>;
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

export function MessageList({
  messages,
  userName,
  isThinking,
  handleQuickAction,
  messagesEndRef,
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
}: MessageListProps) {
  const lastAgentMessageId = messages.filter((m) => m.role === "agent").slice(-1)[0]?.id;

  return (
    <div
      className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-3 py-4 scroll-pb-32 sm:px-4"
      role="log"
      aria-live="polite"
      aria-relevant="additions text"
    >
      {messages.length === 0 ? (
        <div className="flex min-h-full flex-col justify-center pb-6">
          <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-card text-fg-950">
            <Sparkles className="h-7 w-7" />
          </div>
          <h2 className="mt-4 text-center font-serif text-2xl font-light text-fg-950">
            Hi, {userName || "there"}
          </h2>

          <div className="mt-6 grid gap-2">
            {quickActions.map((action) => (
              <button
                key={action}
                type="button"
                onClick={() => handleQuickAction(action)}
                disabled={isThinking}
                className="group flex min-h-12 items-center justify-between rounded-lg border border-surface-200 bg-card px-3 py-2 text-left text-sm text-fg-700 transition-colors hover:bg-surface-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <span className="min-w-0 pr-3">{action}</span>
                <ArrowRight className="h-4 w-4 shrink-0 text-fg-400 group-hover:text-fg-700" />
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 overflow-x-hidden pb-28">
          {messages.map((message) => {
            const isLastAgentMessage = message.id === lastAgentMessageId;
            const isRunning = isThinking && isLastAgentMessage;

            return (
              <AgentMessageRow
                key={message.id}
                message={message}
                isRunning={isRunning}
                isLastAgentMessage={isLastAgentMessage}
                isThinking={isThinking}
                traceExpanded={traceExpanded}
                onToggleTraceExpanded={onToggleTraceExpanded}
                onCitationClick={onCitationClick}
                retryLastQuestion={retryLastQuestion}
                resolvingEditIds={resolvingEditIds}
                onArtifactCreated={onArtifactCreated}
                downloadAgentArtifact={downloadAgentArtifact}
                resolveArtifactEdit={resolveArtifactEdit}
                resolveArtifactEditsBulk={resolveArtifactEditsBulk}
                onCorrectFact={onCorrectFact}
              />
            );
          })}
          <div ref={messagesEndRef} />
        </div>
      )}
    </div>
  );
}
