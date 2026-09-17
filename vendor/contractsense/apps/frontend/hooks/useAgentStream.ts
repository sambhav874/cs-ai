import { useRef } from "react";
import type { AgentResponse as DeepAgentResponse, AgentTokenUsage } from "@/lib/agent";
import {
  citationAnnotationsFromDetails,
  cleanDisplayText,
  normalizeAgentTraceData,
  normalizeCitationMarkerText,
  normalizeCitationPayload,
  type AgentActivity,
  type AgentArtifact,
  type AgentMessage,
  type CitationDetails,
} from "@/lib/agentMessageFormatting";

type UpdateAgentMessage = (
  messageId: string,
  updater: (message: AgentMessage) => AgentMessage,
) => void;
type UpsertAgentActivity = (messageId: string, activity: AgentActivity) => void;
type CompleteAgentActivity = (
  messageId: string,
  activityId: string,
  updates?: Partial<AgentActivity>,
) => void;
type FinishAgentActivities = (messageId: string) => void;

export interface MemoryDisclosureBlock {
  name: string;
  tier: string;
  heading: string;
  body: string;
  provenance: string;
  truncated: boolean;
}

export interface MemoryDisclosure {
  blocks: MemoryDisclosureBlock[];
  dropped: string[];
  total_chars: number;
  budget_chars: number;
}

export function useAgentStream({
  updateAgentMessage,
  upsertAgentActivity,
  completeAgentActivity,
  finishAgentActivities,
  setSessionId,
  setIsThinking,
  applyDeepAgentResponse,
  onArtifactCreated,
}: {
  updateAgentMessage: UpdateAgentMessage;
  upsertAgentActivity: UpsertAgentActivity;
  completeAgentActivity: CompleteAgentActivity;
  finishAgentActivities: FinishAgentActivities;
  setSessionId: (sessionId: string) => void;
  setIsThinking: (thinking: boolean) => void;
  applyDeepAgentResponse: (messageId: string, response: DeepAgentResponse) => void;
  onArtifactCreated?: (artifact: AgentArtifact) => void;
}) {
  const streamTextRef = useRef<Map<string, string>>(new Map());
  const thinkingRef = useRef<Map<string, string>>(new Map());
  const pendingFlushRef = useRef<Set<string>>(new Set());
  const rafIdRef = useRef<number | null>(null);

  const flushPendingStreamText = () => {
    rafIdRef.current = null;
    const messageIds = Array.from(pendingFlushRef.current);
    pendingFlushRef.current.clear();
    for (const messageId of messageIds) {
      const rawText = streamTextRef.current.get(messageId);
      if (rawText === undefined) continue;
      const displayText = cleanDisplayText(rawText, { trim: false });
      updateAgentMessage(messageId, (message) => ({
        ...message,
        content: displayText,
        currentThinking: undefined,
      }));
    }
  };

  // Deltas can arrive many times a second; batching to one render per
  // animation frame keeps a long answer from re-rendering (and re-parsing
  // markdown) on every network chunk.
  const enqueueStreamText = (messageId: string, text: string) => {
    const streamDelta = String(text).replace(/\r\n?/g, "\n");
    if (!streamDelta) return;

    const nextRawText = `${streamTextRef.current.get(messageId) ?? ""}${streamDelta}`;
    streamTextRef.current.set(messageId, nextRawText);
    thinkingRef.current.delete(messageId);
    pendingFlushRef.current.add(messageId);

    if (rafIdRef.current === null) {
      rafIdRef.current = requestAnimationFrame(flushPendingStreamText);
    }
  };

  const stopStreamText = (messageId: string) => {
    if (rafIdRef.current !== null && pendingFlushRef.current.has(messageId)) {
      pendingFlushRef.current.delete(messageId);
      const rawText = streamTextRef.current.get(messageId);
      if (rawText !== undefined) {
        updateAgentMessage(messageId, (message) => ({
          ...message,
          content: cleanDisplayText(rawText, { trim: false }),
          currentThinking: undefined,
        }));
      }
    }
    streamTextRef.current.delete(messageId);
    thinkingRef.current.delete(messageId);
  };

  const applyStreamEvent = (
    eventName: string,
    rawData: string,
    agentMessageId: string,
  ) => {
    if (!rawData.trim()) return;
    const data = JSON.parse(rawData);

    if (eventName === "session") {
      if (typeof data.session_id === "string" && data.session_id) {
        setSessionId(data.session_id);
      }
      return;
    }

    if (eventName === "memory") {
      const disclosure = data as MemoryDisclosure;
      if (disclosure.blocks?.length) {
        updateAgentMessage(agentMessageId, (msg) => {
          const currentTrace = Array.isArray(msg.agentTrace) ? [...msg.agentTrace] : [];
          currentTrace.push({
            event: "react_memory_recalled",
            detail: { ...disclosure },
          });
          return { ...msg, agentTrace: currentTrace };
        });
      }
      return;
    }

    if (eventName === "approval_required") {
      applyDeepAgentResponse(agentMessageId, data as DeepAgentResponse);
      return;
    }

    if (eventName === "status") {
      const message = typeof data.message === "string" ? data.message : "";
      const iteration = typeof data.iteration === "number" ? data.iteration : 1;
      updateAgentMessage(agentMessageId, (msg) => {
        const currentTrace = Array.isArray(msg.agentTrace) ? [...msg.agentTrace] : [];
        currentTrace.push({
          event: "react_model_step",
          detail: { iteration, action: "status", reason: message },
        });
        return { ...msg, agentTrace: currentTrace };
      });
      return;
    }

    if (eventName === "thinking") {
      const message = typeof data.message === "string" ? data.message : "";
      const iteration = typeof data.iteration === "number" ? data.iteration : 1;
      // Store latest thinking for real-time display
      thinkingRef.current.set(agentMessageId, message);
      updateAgentMessage(agentMessageId, (msg) => {
        const currentTrace = Array.isArray(msg.agentTrace) ? [...msg.agentTrace] : [];
        currentTrace.push({
          event: "react_thought",
          detail: { iteration, thought: message },
        });
        return { ...msg, agentTrace: currentTrace, currentThinking: message };
      });
      return;
    }

    if (eventName === "tool_call") {
      const tool = typeof data.name === "string" ? data.name : "";
      const args = data.args ?? {};
      const iteration = typeof data.iteration === "number" ? data.iteration : 1;
      updateAgentMessage(agentMessageId, (msg) => {
        const currentTrace = Array.isArray(msg.agentTrace) ? [...msg.agentTrace] : [];
        currentTrace.push({
          event: "react_model_step",
          detail: { iteration, action: "tool", tool, args },
        });
        return { ...msg, agentTrace: currentTrace };
      });
      return;
    }

    if (eventName === "tool_result") {
      const tool = typeof data.name === "string" ? data.name : "";
      const summary = typeof data.summary === "string" ? data.summary : "";
      const status = typeof data.status === "string" ? data.status : "done";
      const iteration = typeof data.iteration === "number" ? data.iteration : 1;
      updateAgentMessage(agentMessageId, (msg) => {
        const currentTrace = Array.isArray(msg.agentTrace) ? [...msg.agentTrace] : [];
        currentTrace.push({
          event: "react_tool_observation",
          detail: { iteration, tool, summary, status },
        });
        return { ...msg, agentTrace: currentTrace };
      });
      return;
    }

    if (eventName === "doc_read_start") {
      updateAgentMessage(agentMessageId, (msg) => {
        const currentTrace = Array.isArray(msg.agentTrace) ? [...msg.agentTrace] : [];
        currentTrace.push({
          event: "react_model_step",
          detail: { iteration: 1, action: "status", reason: `Reading ${cleanDisplayText(data.filename || "document")}` },
        });
        return { ...msg, agentTrace: currentTrace };
      });
      return;
    }

    if (eventName === "doc_read" || eventName === "doc_search" || eventName === "doc_search_start") {
      return;
    }

    if (eventName === "content_done") {
      return;
    }

    if (eventName === "citations" || eventName === "citation") {
      const citationDetails = (data.citation_details ?? {}) as CitationDetails;
      const citationAnnotations = citationAnnotationsFromDetails(citationDetails, data.citation_annotations || data.citations);
      const normalizedCitations = normalizeCitationPayload(citationAnnotations);

      upsertAgentActivity(agentMessageId, {
        id: "citations",
        label: "Citations ready",
        detail: normalizedCitations.annotations.length ? `${normalizedCitations.annotations.length} sources` : "No source citations",
        status: "done",
      });
      updateAgentMessage(agentMessageId, (message) => ({
        ...message,
        content: normalizeCitationMarkerText(
          cleanDisplayText(message.content, { trim: false }),
          normalizedCitations.refMap,
          normalizedCitations.markerMap,
        ),
        citation: cleanDisplayText(data.citation),
        citationDetails,
        citationAnnotations: normalizedCitations.annotations,
      }));
      return;
    }

    if (eventName === "doc_created") {
      const artifact = data as AgentArtifact;
      if (!artifact.artifact_id || !artifact.filename) return;
      completeAgentActivity(agentMessageId, "doc-created-start", {
        label: `Created ${cleanDisplayText(artifact.filename)}`,
        detail: artifact.version_number ? `Version ${artifact.version_number}` : "Word document",
      });
      upsertAgentActivity(agentMessageId, {
        id: `doc-created-${artifact.artifact_id}`,
        label: `Generated ${cleanDisplayText(artifact.filename)}`,
        detail: "Word document",
        status: "done",
      });
      updateAgentMessage(agentMessageId, (message) => {
        const existingArtifacts = message.artifacts ?? [];
        const dedupedArtifacts = existingArtifacts.filter((item) => item.artifact_id !== artifact.artifact_id);
        return { ...message, artifacts: [...dedupedArtifacts, artifact] };
      });
      onArtifactCreated?.(artifact);
      return;
    }

    if (eventName === "doc_created_start") {
      upsertAgentActivity(agentMessageId, {
        id: "doc-created-start",
        label: `Creating ${cleanDisplayText(data.filename || "Word document")}`,
        status: "running",
      });
      return;
    }

    if (eventName === "doc_edited_start") {
      upsertAgentActivity(agentMessageId, {
        id: "doc-edited-start",
        label: `Editing ${cleanDisplayText(data.filename || "document copy")}`,
        status: "running",
      });
      return;
    }

    if (eventName === "doc_edited") {
      const artifact = data as AgentArtifact;
      if (!artifact.artifact_id || !artifact.filename) return;
      completeAgentActivity(agentMessageId, "doc-edited-start", {
        label: `Edited ${cleanDisplayText(artifact.filename)}`,
        detail: artifact.version_number ? `Version ${artifact.version_number}` : "Word document",
      });
      updateAgentMessage(agentMessageId, (message) => {
        const existingArtifacts = message.artifacts ?? [];
        const dedupedArtifacts = existingArtifacts.filter((item) => item.artifact_id !== artifact.artifact_id);
        return { ...message, artifacts: [...dedupedArtifacts, artifact] };
      });
      onArtifactCreated?.(artifact);
      return;
    }

    if (eventName === "delta" || eventName === "text") {
      const deltaText = typeof data.text === "string" ? data.text : (typeof data === "string" ? data : "");
      if (!deltaText) return;
      enqueueStreamText(agentMessageId, deltaText);
      return;
    }

    if (eventName === "final") {
      stopStreamText(agentMessageId);
      // The answer is complete at the final event. Do not keep the streaming
      // cursor visible while the transport finishes sending metadata.
      setIsThinking(false);
      const finalAnswer = typeof data.answer === "string" ? cleanDisplayText(data.answer) : "";
      const citationDetails = (data.citation_details ?? {}) as CitationDetails;
      const citationAnnotations = citationAnnotationsFromDetails(citationDetails, data.citation_annotations || data.citations);
      const normalizedCitations = normalizeCitationPayload(citationAnnotations);

      updateAgentMessage(agentMessageId, (message) => ({
        ...message,
        content: normalizeCitationMarkerText(
          finalAnswer || message.content || "I could not find an answer in the indexed contract text.",
          normalizedCitations.refMap,
          normalizedCitations.markerMap,
        ),
        citation: cleanDisplayText(data.citation),
        confidence: data.confidence || "low",
        citationDetails,
        citationAnnotations: normalizedCitations.annotations,
        agentTrace: normalizeAgentTraceData(data.agent_trace) ?? message.agentTrace,
        tokenUsage: (data.token_usage as AgentTokenUsage | undefined) ?? message.tokenUsage,
        costUsd: typeof data.cost_usd === "number" ? data.cost_usd : message.costUsd,
      }));
      finishAgentActivities(agentMessageId);
      return;
    }

    if (eventName === "done") {
      setIsThinking(false);
      finishAgentActivities(agentMessageId);
      return;
    }

    if (eventName === "error") {
      throw new Error(data?.detail || "Agent stream failed.");
    }
  };

  const readAgentStream = async (response: Response, agentMessageId: string) => {
    if (!response.body) {
      throw new Error("Agent stream did not return a readable response.");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    const dispatchBlock = (block: string) => {
      const lines = block.split("\n");
      let eventName = "message";
      const dataLines: string[] = [];

      for (const line of lines) {
        if (line.startsWith("event:")) {
          eventName = line.slice("event:".length).trim();
        } else if (line.startsWith("data:")) {
          dataLines.push(line.slice("data:".length).trimStart());
        }
      }

      applyStreamEvent(eventName, dataLines.join("\n"), agentMessageId);
    };

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let separatorIndex = buffer.indexOf("\n\n");
      while (separatorIndex !== -1) {
        const block = buffer.slice(0, separatorIndex).trim();
        buffer = buffer.slice(separatorIndex + 2);
        if (block) dispatchBlock(block);
        separatorIndex = buffer.indexOf("\n\n");
      }
    }

    buffer += decoder.decode();
    const remainingBlock = buffer.trim();
    if (remainingBlock) {
      dispatchBlock(remainingBlock);
    }
  };

  const clearStreamText = () => {
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
    pendingFlushRef.current.clear();
    streamTextRef.current.clear();
  };

  return { readAgentStream, applyStreamEvent, clearStreamText };
}
