import { useState } from "react";
import { apiFetch } from "@/lib/apiClient";
import type { AgentMessage, AgentStoredMessage } from "@/lib/agentMessageFormatting";
import { storedMessageToAgentMessage } from "@/lib/agentMessageFormatting";

export type AgentSession = {
  session_id: string;
  title?: string;
  message_count?: number;
  updated_at?: string;
};

export function useAgentSession({
  agentBasePath,
  token,
  setMessages,
  setSessionId,
  setDraft,
  clearStreamText,
  sessionId,
}: {
  agentBasePath: string | null | undefined;
  token: string | null | undefined;
  setMessages: (messages: AgentMessage[]) => void;
  setSessionId: (sessionId: string | null) => void;
  setDraft: (draft: string) => void;
  clearStreamText: () => void;
  sessionId: string | null;
}) {
  const [sessions, setSessions] = useState<AgentSession[]>([]);

  const loadSessionMessages = async (nextSessionId: string) => {
    if (!agentBasePath || !token || !nextSessionId) return;
    const response = await apiFetch(`${agentBasePath}/sessions/${nextSessionId}/messages`);
    if (!response.ok) return;
    const payload = await response.json();
    const storedMessages = Array.isArray(payload.messages) ? payload.messages as AgentStoredMessage[] : [];
    setMessages(storedMessages.map(storedMessageToAgentMessage));
    setSessionId(nextSessionId);
  };

  const refreshSessions = async (options: { loadLatest?: boolean } = {}) => {
    if (!agentBasePath || !token) return;
    const response = await apiFetch(`${agentBasePath}/sessions`);
    if (!response.ok) return;
    const payload = await response.json();
    const nextSessions = Array.isArray(payload.sessions) ? payload.sessions as AgentSession[] : [];
    setSessions(nextSessions);
    if (options.loadLatest && nextSessions[0]?.session_id) {
      await loadSessionMessages(nextSessions[0].session_id);
    }
  };

  const startNewSession = () => {
    clearStreamText();
    setSessionId(null);
    setMessages([]);
    setDraft("");
  };

  const clearCurrentSession = async () => {
    if (!sessionId || !agentBasePath || !token) {
      startNewSession();
      return;
    }
    await apiFetch(`${agentBasePath}/sessions/${sessionId}`, {
      method: "DELETE",
    });
    startNewSession();
    await refreshSessions();
  };

  return {
    sessions,
    setSessions,
    loadSessionMessages,
    refreshSessions,
    startNewSession,
    clearCurrentSession,
  };
}
