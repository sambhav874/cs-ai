import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import {
  Check,
  History,
  Info,
  Plus,
  Sparkles,
  Trash2,
} from "lucide-react";
import { useAgentMessages } from "@cs/hooks/useAgentMessages";
import { useAgentStream } from "@cs/hooks/useAgentStream";
import { useAgentSession, type AgentSession } from "@cs/hooks/useAgentSession";
import { Button } from "@cs/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@cs/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@cs/components/ui/tooltip";
import {
  approveAgentWorkflow,
  rejectAgentWorkflow,
  updateAgentWorkflowProposal,
  type AgentResponse as DeepAgentResponse,
  type Suggestion,
  type TabularReviewProposal,
} from "@cs/lib/agent";
import { resolveDemoQuickAction } from "@cs/lib/demoResponses";
import { apiDownload, apiFetch } from "@cs/lib/apiClient";
import { cn } from "@cs/lib/utils";

import {
  citationAnnotationsFromDetails,
  cleanDisplayText,
  isAIProvider,
  isConfidence,
  isReferenceDocumentReady,
  normalizeAgentTraceData,
  normalizeCitationMarkerText,
  normalizeCitationPayload,
  quickActions,
  type AgentArtifact,
  type AgentEditAnnotation,
  type AgentWorkflowState,
  type AIProvider,
  type CitationDetails,
  type CitedSegment,
  type ReferenceDocument,
} from "@cs/lib/agentMessageFormatting";
import { MessageList } from "@cs/components/agent/MessageList";
import { Composer } from "@cs/components/agent/Composer";
import { ApprovalCard } from "@cs/components/agent/ApprovalCard";

interface ContractAgentPanelProps {
  contractId?: string;
  contractName: string;
  projectId?: string | null;
  scope?: "contract" | "project";
  roleLabel: string;
  userName?: string;
  canEdit: boolean;
  canApprove: boolean;
  canRequestReEdit: boolean;
  apiUrl?: string;
  token?: string | null;
  aiProvider?: string;
  initialSessionId?: string | null;
  referenceDocuments?: ReferenceDocument[];
  onAiProviderChange?: (provider: AIProvider) => void;
  onArtifactCreated?: (artifact: AgentArtifact) => void;
  onCitationClick?: (
    citationText: string,
    confidence: "high" | "medium" | "low",
    citedSegments?: CitedSegment[],
    targetContractId?: string | null,
    targetFilename?: string | null,
  ) => void;
  initialDraft?: string;
}

export default function ContractAgentPanel({
  contractId,
  contractName,
  projectId,
  scope = "contract",
  roleLabel,
  userName,
  canEdit,
  canApprove,
  canRequestReEdit,
  apiUrl,
  token,
  aiProvider,
  initialSessionId,
  referenceDocuments = [],
  onAiProviderChange,
  onArtifactCreated,
  onCitationClick,
  initialDraft = "",
}: ContractAgentPanelProps) {
  const [draft, setDraft] = useState(initialDraft);
  const {
    messages,
    setMessages,
    updateAgentMessage,
    upsertAgentActivity,
    completeAgentActivity,
    finishAgentActivities,
  } = useAgentMessages();
  const [isThinking, setIsThinking] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [selectedReferenceIds, setSelectedReferenceIds] = useState<string[]>([]);
  const [selectedProvider, setSelectedProvider] = useState<AIProvider>(
    isAIProvider(aiProvider) ? aiProvider : "groq",
  );
  const [resolvingEditIds, setResolvingEditIds] = useState<Set<string>>(() => new Set());
  const [traceExpanded, setTraceExpanded] = useState(false);
  const [pendingSuggestion, setPendingSuggestion] = useState<Suggestion | null>(null);
  const [pendingWorkflowId, setPendingWorkflowId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const lastQuestionRef = useRef<string>("");
  const isProjectScope = scope === "project" || (!contractId && Boolean(projectId));
  const agentScopeId = isProjectScope ? projectId || "" : contractId || "";
  const agentBasePath = apiUrl && agentScopeId
    ? isProjectScope
      ? `${apiUrl}/projects/${agentScopeId}/agent`
      : `${apiUrl}/contracts/${agentScopeId}/agent`
    : "";

  const availableReferenceDocuments = useMemo(() => {
    const seenIds = new Set<string>();
    const normalizedDocuments = referenceDocuments
      .map((document) => ({
        ...document,
        isCurrent: !isProjectScope && (document.isCurrent || document.id === contractId),
      }))
      .filter((document) => {
        if (!document.id || seenIds.has(document.id)) return false;
        seenIds.add(document.id);
        return true;
      });

    return normalizedDocuments.sort((a, b) => {
      if (a.isCurrent) return -1;
      if (b.isCurrent) return 1;
      return a.name.localeCompare(b.name);
    });
  }, [contractId, isProjectScope, referenceDocuments]);

  const selectedReferenceSet = useMemo(() => new Set(selectedReferenceIds), [selectedReferenceIds]);
  const referenceDocumentById = useMemo(
    () => new Map(availableReferenceDocuments.map((document) => [document.id, document])),
    [availableReferenceDocuments],
  );
  const attachedDocumentsPayload = useMemo(
    () => selectedReferenceIds
      .flatMap((documentId) => {
        const document = referenceDocumentById.get(documentId);
        return document
          ? [{ document_id: document.id, filename: document.name }]
          : [];
      }),
    [referenceDocumentById, selectedReferenceIds],
  );
  const explicitReferenceIds = useMemo(() => {
    if (isProjectScope) {
      if (selectedReferenceIds.includes("all") || !selectedReferenceIds.length) return undefined;
      return Array.from(new Set(selectedReferenceIds.filter((id) => id !== "all")));
    }
    if (!contractId) return undefined;
    if (selectedReferenceIds.includes("all")) {
      const allDocumentIds = availableReferenceDocuments
        .filter(isReferenceDocumentReady)
        .map((document) => document.id);
      return Array.from(new Set([contractId, ...allDocumentIds]));
    }
    if (!selectedReferenceIds.length) return [contractId];
    return Array.from(new Set([contractId, ...selectedReferenceIds.filter((id) => id !== "all")]));
  }, [availableReferenceDocuments, contractId, isProjectScope, selectedReferenceIds]);

  const selectedReferenceLabel = useMemo(() => {
    if (isProjectScope) {
      if (selectedReferenceIds.includes("all") || !selectedReferenceIds.length) return "All project docs";
      return `Refer to ${selectedReferenceIds.length}`;
    }
    if (selectedReferenceIds.includes("all")) return "All project docs";
    if (!selectedReferenceIds.length) return "Current contract";
    return `Refer to ${selectedReferenceIds.length + 1}`;
  }, [isProjectScope, selectedReferenceIds]);

  const agentFetcher = useCallback(async (url: string, options: RequestInit = {}) => {
    const response = await apiFetch(url, options);
    const text = await response.text();
    let payload: unknown = undefined;
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = text;
      }
    }
    if (!response.ok) {
      const detail = typeof payload === "object" && payload && "detail" in payload
        ? String((payload as { detail?: unknown }).detail)
        : text || "Agent request failed.";
      return { error: detail };
    }
    return { data: payload };
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => () => {
    clearStreamText();
    abortControllerRef.current?.abort();
  }, []);

  useEffect(() => {
    const storedProvider = localStorage.getItem("aiProvider");
    const nextProvider = isAIProvider(storedProvider)
      ? storedProvider
      : isAIProvider(aiProvider)
        ? aiProvider
        : "groq";

    setSelectedProvider(nextProvider);
    localStorage.setItem("aiProvider", nextProvider);
    onAiProviderChange?.(nextProvider);
  }, []);

  useEffect(() => {
    if (isAIProvider(aiProvider) && aiProvider !== selectedProvider) {
      setSelectedProvider(aiProvider);
    }
  }, [aiProvider, selectedProvider]);

  useEffect(() => {
    let cancelled = false;
    const loadInitialSession = async () => {
      if (!agentBasePath || !token) return;
      const response = await apiFetch(`${agentBasePath}/sessions`);
      if (!response.ok || cancelled) return;
      const payload = await response.json();
      const nextSessions = Array.isArray(payload.sessions) ? payload.sessions as AgentSession[] : [];
      setSessions(nextSessions);
      const requestedSession = initialSessionId
        ? nextSessions.find((session) => session.session_id === initialSessionId)
        : null;
      const nextSessionId = requestedSession?.session_id || nextSessions[0]?.session_id;
      if (!cancelled && nextSessionId) {
        await loadSessionMessages(nextSessionId);
      }
    };
    loadInitialSession();
    return () => {
      cancelled = true;
    };
  }, [agentBasePath, token, initialSessionId]);

  useEffect(() => {
    const selectableDocumentIds = new Set(
      availableReferenceDocuments
        .filter((document) => !document.isCurrent && isReferenceDocumentReady(document))
        .map((document) => document.id),
    );
    setSelectedReferenceIds((currentIds) =>
      currentIds.includes("all")
        ? ["all"]
        : currentIds.filter((documentId) => selectableDocumentIds.has(documentId)),
    );
  }, [availableReferenceDocuments]);

  const handleProviderChange = useCallback((provider: AIProvider) => {
    setSelectedProvider(provider);
    localStorage.setItem("aiProvider", provider);
    onAiProviderChange?.(provider);
  }, [onAiProviderChange]);

  const toggleReferenceDocument = useCallback((documentId: string) => {
    setSelectedReferenceIds((currentIds) => {
      const cleanIds = currentIds.filter((id) => id !== "all");
      return cleanIds.includes(documentId)
        ? cleanIds.filter((id) => id !== documentId)
        : [...cleanIds, documentId];
    });
  }, []);

  const onSelectReferenceIds = useCallback((ids: string[]) => {
    setSelectedReferenceIds(ids);
  }, []);

  const onToggleTraceExpanded = useCallback(() => {
    setTraceExpanded((expanded) => !expanded);
  }, []);

  const workflowLinkText = (reviewId?: string | null) => (
    reviewId ? `\n\n[Open tabular review](/tabular-reviews/${reviewId})` : ""
  );

  const applyDeepAgentResponse = useCallback((messageId: string, response: DeepAgentResponse) => {
    const approval = response.requires_approval ? response.approval_request ?? null : null;
    const proposal = approval?.tabular_review ?? null;
    const citationDetails = (response.citation_details ?? {}) as CitationDetails;
    const citationAnnotations = citationAnnotationsFromDetails(citationDetails, response.citation_annotations || (response as any).citations);
    const normalizedCitations = normalizeCitationPayload(citationAnnotations);

    // Build suggestions from the approval request, or use explicit suggestions from backend
    const builtSuggestions: Suggestion[] = response.suggestions?.length
      ? response.suggestions
      : approval
        ? [{
          id: `${response.workflow_id}-${approval.approval_id}`,
          action: approval.action,
          label: approval.title || approval.description || "Approve this action",
          preview: approval.description || null,
          payload: approval.payload || undefined,
          confidence: "medium" as const,
        }]
        : [];

    // Set or clear pending suggestion for the input area
    if (builtSuggestions.length) {
      setPendingSuggestion(builtSuggestions[0]);
      setPendingWorkflowId(response.workflow_id);
    } else {
      setPendingSuggestion(null);
      setPendingWorkflowId(null);
    }

    updateAgentMessage(messageId, (message) => ({
      ...message,
      content: `${normalizeCitationMarkerText(
        cleanDisplayText(response.answer),
        normalizedCitations.refMap,
        normalizedCitations.markerMap,
      )}${workflowLinkText(response.created_review_id)}`,
      confidence: isConfidence(response.confidence) ? response.confidence : message.confidence,
      citationDetails,
      citationAnnotations: normalizedCitations.annotations,
      artifacts: Array.isArray(response.artifacts) && response.artifacts.length
        ? response.artifacts as AgentArtifact[]
        : message.artifacts,
      activity: [
        ...(message.activity ?? []).filter((activity) => activity.id !== "deep-agent"),
        {
          id: "deep-agent",
          label: builtSuggestions.length ? "Awaiting your decision" : "Workflow completed",
          detail: response.created_review_id ? "Tabular review created" : undefined,
          status: "done",
        },
      ],
      workflow: {
        workflowId: response.workflow_id,
        status: response.workflow_status,
        approval,
        proposal,
        createdReviewId: response.created_review_id ?? null,
      },
      agentTrace: normalizeAgentTraceData(response.agent_trace),
      tokenUsage: response.token_usage ?? null,
      costUsd: typeof response.cost_usd === "number" ? response.cost_usd : null,
    }));
  }, [updateAgentMessage]);

  const { readAgentStream, clearStreamText } = useAgentStream({
    updateAgentMessage,
    upsertAgentActivity,
    completeAgentActivity,
    finishAgentActivities,
    setSessionId,
    setIsThinking,
    applyDeepAgentResponse,
    onArtifactCreated,
  });

  const { sessions, setSessions, loadSessionMessages, refreshSessions, startNewSession, clearCurrentSession } =
    useAgentSession({
      agentBasePath,
      token,
      setMessages,
      setSessionId,
      setDraft,
      clearStreamText,
      sessionId,
    });

  const setWorkflowBusy = useCallback((messageId: string, busy: boolean) => {
    updateAgentMessage(messageId, (message) => (
      message.workflow
        ? { ...message, workflow: { ...message.workflow, busy } }
        : message
    ));
  }, [updateAgentMessage]);

  const approveWorkflow = useCallback(async (messageId: string, workflow: AgentWorkflowState) => {
    if (!apiUrl || !token) return;
    setWorkflowBusy(messageId, true);
    try {
      if (workflow.proposal) {
        await updateAgentWorkflowProposal(apiUrl, agentFetcher, workflow.workflowId, workflow.proposal);
      }
      const response = await approveAgentWorkflow(apiUrl, agentFetcher, workflow.workflowId, {
        edited_tabular_review: workflow.proposal || undefined,
        generate: true,
      });
      applyDeepAgentResponse(messageId, response);
    } catch (error) {
      updateAgentMessage(messageId, (message) => ({
        ...message,
        content: `${message.content}\n\n${error instanceof Error ? error.message : "Workflow approval failed."}`,
      }));
      setPendingSuggestion(null);
      setPendingWorkflowId(null);
    } finally {
      setWorkflowBusy(messageId, false);
    }
  }, [apiUrl, token, setWorkflowBusy, agentFetcher, applyDeepAgentResponse, updateAgentMessage]);

  const rejectWorkflow = useCallback(async (messageId: string, workflow: AgentWorkflowState) => {
    if (!apiUrl || !token) return;
    setWorkflowBusy(messageId, true);
    try {
      const response = await rejectAgentWorkflow(apiUrl, agentFetcher, workflow.workflowId, "Rejected from contract chat.");
      applyDeepAgentResponse(messageId, response);
    } catch (error) {
      updateAgentMessage(messageId, (message) => ({
        ...message,
        content: `${message.content}\n\n${error instanceof Error ? error.message : "Workflow rejection failed."}`,
      }));
      setPendingSuggestion(null);
      setPendingWorkflowId(null);
    } finally {
      setWorkflowBusy(messageId, false);
    }
  }, [apiUrl, token, setWorkflowBusy, agentFetcher, applyDeepAgentResponse, updateAgentMessage]);

  const handleSubmit = useCallback(async (event?: FormEvent, submittedDraft?: string) => {
    event?.preventDefault();
    const value = (submittedDraft ?? draft).trim();
    if (!value || isThinking) return;
    const agentMessageId = `agent-${Date.now()}`;
    lastQuestionRef.current = value;

    setMessages((current) => [
      ...current,
      { id: `user-${Date.now()}`, role: "user", content: value },
      { id: agentMessageId, role: "agent", content: "" },
    ]);
    setDraft("");
    setIsThinking(true);
    setPendingSuggestion(null);
    setPendingWorkflowId(null);

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    try {
      if (!agentBasePath || !token) {
        throw new Error("Agent is not connected to the backend.");
      }

      const requestBody = {
        message: value,
        session_id: sessionId,
        ai_provider: selectedProvider,
        reference_contract_ids: explicitReferenceIds,
        displayed_document: !isProjectScope && contractId
          ? {
            document_id: contractId,
            filename: contractName,
          }
          : undefined,
        attached_documents: attachedDocumentsPayload.length ? attachedDocumentsPayload : undefined,
      };

      const response = await apiFetch(`${agentBasePath}/query/stream`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
        signal: abortController.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        let detail = errorText || "Agent query failed.";
        try {
          detail = JSON.parse(errorText)?.detail || detail;
        } catch {
          // Keep the plain response body.
        }
        throw new Error(detail);
      }

      await readAgentStream(response, agentMessageId);
    } catch (error) {
      const wasAborted = error instanceof DOMException && error.name === "AbortError";
      if (!wasAborted) {
        upsertAgentActivity(agentMessageId, {
          id: "stream-error",
          label: error instanceof Error ? error.message : "Agent query failed.",
          status: "error",
        });
        updateAgentMessage(agentMessageId, (message) => ({
          ...message,
          content: message.content
            ? `${message.content}\n\n${error instanceof Error ? error.message : "Agent query failed."}`
            : error instanceof Error ? error.message : "Agent query failed.",
        }));
      }
    } finally {
      abortControllerRef.current = null;
      setIsThinking(false);
      void refreshSessions();
    }
  }, [
    draft,
    isThinking,
    setMessages,
    agentBasePath,
    token,
    sessionId,
    selectedProvider,
    explicitReferenceIds,
    isProjectScope,
    contractId,
    contractName,
    attachedDocumentsPayload,
    readAgentStream,
    upsertAgentActivity,
    updateAgentMessage,
    refreshSessions,
  ]);

  const stopStreaming = useCallback(() => {
    abortControllerRef.current?.abort();
  }, []);

  const retryLastQuestion = useCallback(() => {
    if (!lastQuestionRef.current || isThinking) return;
    void handleSubmit(undefined, lastQuestionRef.current);
  }, [handleSubmit, isThinking]);

  const handleQuickAction = useCallback((action: string) => {
    if (isThinking) return;

    const demo = resolveDemoQuickAction(action, quickActions, contractId, contractName);
    if (!demo) {
      void handleSubmit(undefined, action);
      return;
    }

    const agentMessageId = `demo-agent-${Date.now()}`;
    const startedAt = Date.now();
    setMessages((current) => [
      ...current,
      { id: `demo-user-${Date.now()}`, role: "user", content: action },
      {
        id: agentMessageId,
        role: "agent",
        content: "",
        isDemo: true,
        currentThinking: "Reviewing obligations, deadlines, and financial exposure\u2026",
      },
    ]);
    setDraft("");
    setIsThinking(true);

    window.setTimeout(() => {
      let streamedLength = 0;
      const streamTimer = window.setInterval(() => {
        streamedLength = Math.min(demo.answer.length, streamedLength + 42);
        const isComplete = streamedLength >= demo.answer.length;
        updateAgentMessage(agentMessageId, (message) => ({
          ...message,
          content: demo.answer.slice(0, streamedLength),
          currentThinking: undefined,
          confidence: "high",
          isDemo: true,
          citationAnnotations: demo.annotations,
          citationDetails: { annotations: demo.annotations },
          durationMs: isComplete ? Date.now() - startedAt : message.durationMs,
        }));
        if (isComplete) {
          window.clearInterval(streamTimer);
          setIsThinking(false);
        }
      }, 35);
    }, 12000);
  }, [isThinking, contractId, contractName, handleSubmit, setMessages, updateAgentMessage]);

  const downloadAgentArtifact = useCallback(async (artifact: AgentArtifact) => {
    if (!apiUrl || !token) return;
    const artifactPath = artifact.download_url || (!isProjectScope && contractId
      ? `/contracts/${contractId}/agent/artifacts/${artifact.artifact_id}/download`
      : "");
    if (!artifactPath) return;
    const blob = await apiDownload(`${apiUrl}${artifactPath}`);
    const objectUrl = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = artifact.filename || "Contract Work Product.docx";
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(objectUrl);
  }, [apiUrl, token, isProjectScope, contractId]);

  const resolveArtifactEdit = useCallback(async (
    artifact: AgentArtifact,
    edit: AgentEditAnnotation,
    mode: "accept" | "reject",
  ) => {
    if (!apiUrl || !token || !artifact.document_id || !edit.edit_id) return;
    const scopePath = isProjectScope && projectId
      ? `/projects/${projectId}/agent`
      : contractId
        ? `/contracts/${contractId}/agent`
        : "";
    if (!scopePath) return;

    setResolvingEditIds((current) => new Set([...current, edit.edit_id]));
    try {
      const response = await apiFetch(
        `${apiUrl}${scopePath}/documents/${artifact.document_id}/edits/${edit.edit_id}/${mode}`,
        {
          method: "POST",
        },
      );
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.detail || `Unable to ${mode} edit.`);
      const nextStatus = String(payload?.status || (mode === "accept" ? "accepted" : "rejected"));
      setMessages((currentMessages) => currentMessages.map((message) => ({
        ...message,
        artifacts: message.artifacts?.map((item) => {
          if (item.document_id !== artifact.document_id) return item;
          return {
            ...item,
            version_id: String(payload?.version_id || item.version_id || ""),
            download_url: String(payload?.download_url || item.download_url || ""),
            edit_annotations: item.edit_annotations?.map((annotation) => (
              annotation.edit_id === edit.edit_id
                ? { ...annotation, status: nextStatus }
                : annotation
            )),
          };
        }),
      })));
      onArtifactCreated?.({
        ...artifact,
        version_id: String(payload?.version_id || artifact.version_id || ""),
        download_url: String(payload?.download_url || artifact.download_url || ""),
      });
    } catch (error) {
      console.error(`Failed to ${mode} tracked edit:`, error);
    } finally {
      setResolvingEditIds((current) => {
        const next = new Set(current);
        next.delete(edit.edit_id);
        return next;
      });
    }
  }, [apiUrl, token, isProjectScope, projectId, contractId, setMessages, onArtifactCreated]);

  const resolveArtifactEditsBulk = useCallback(async (
    artifact: AgentArtifact,
    edits: AgentEditAnnotation[],
    mode: "accept" | "reject",
  ) => {
    for (const edit of edits) {
      await resolveArtifactEdit(artifact, edit, mode);
    }
  }, [resolveArtifactEdit]);

  const onCorrectFact = useCallback((factText?: string) => {
    if (factText) {
      setDraft(`Actually, that fact is incorrect. The correct detail is: `);
    } else {
      setDraft(`I would like to correct a stated fact: `);
    }
  }, []);

  return (
    <TooltipProvider delayDuration={150}>
      <div className="relative flex h-full min-h-0 flex-col overflow-hidden bg-card">
        <div className="flex h-12 shrink-0 items-center border-b border-surface-200 bg-card px-3 sm:px-4">
          <div className="flex min-w-0 items-center gap-2">
            <Sparkles className="h-4 w-4 shrink-0 text-fg-700" />
            <div className="truncate text-sm font-semibold text-fg-950">
              {isProjectScope ? "Project Assistant" : "Contract Assistant"}
            </div>
            <Tooltip>
              <TooltipTrigger asChild>
                <Info className="h-4 w-4 shrink-0 cursor-help text-fg-400 hover:text-fg-700" />
              </TooltipTrigger>
              <TooltipContent side="bottom" align="start" className="max-w-[200px] text-center">
                <p>Search, cite, and decide from the attached contract in one agent thread.</p>
              </TooltipContent>
            </Tooltip>
          </div>
          <div className="ml-auto flex items-center gap-1.5">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-fg-500 hover:text-fg-950"
                  disabled={isThinking || sessions.length === 0}
                  title="Chat history"
                  aria-label="Chat history"
                >
                  <History className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="max-h-80 w-72 overflow-y-auto">
                <DropdownMenuLabel className="text-xs text-fg-500">Chat history</DropdownMenuLabel>
                {sessions.map((session) => (
                  <DropdownMenuItem
                    key={session.session_id}
                    onClick={() => loadSessionMessages(session.session_id)}
                    className="items-start gap-2"
                  >
                    <Check className={cn("mt-0.5 h-4 w-4", sessionId === session.session_id ? "opacity-100" : "opacity-0")} />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{session.title || "Contract assistant chat"}</span>
                      <span className="block text-xs text-fg-500">
                        {session.message_count || 0} messages
                      </span>
                    </span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-fg-500 hover:text-fg-950"
              disabled={isThinking}
              title="New assistant chat"
              aria-label="New assistant chat"
              onClick={() => {
                startNewSession();
              }}
            >
              <Plus className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-fg-500 hover:text-fg-950"
              disabled={isThinking || (!sessionId && messages.length === 0)}
              title="Clear assistant chat"
              aria-label="Clear assistant chat"
              onClick={clearCurrentSession}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <MessageList
          messages={messages}
          userName={userName}
          isThinking={isThinking}
          handleQuickAction={handleQuickAction}
          messagesEndRef={messagesEndRef}
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

        <div className="shrink-0 border-t border-surface-100 bg-card px-3 pb-2 pt-2">
          {pendingSuggestion ? (
            <ApprovalCard
              suggestion={pendingSuggestion}
              busy={isThinking}
              onApprove={() => {
                const workflowMsg = messages.find((m) => m.role === "agent" && m.workflow?.workflowId === pendingWorkflowId);
                if (workflowMsg?.workflow) {
                  approveWorkflow(workflowMsg.id, workflowMsg.workflow);
                }
              }}
              onReject={() => {
                const workflowMsg = messages.find((m) => m.role === "agent" && m.workflow?.workflowId === pendingWorkflowId);
                if (workflowMsg?.workflow) {
                  rejectWorkflow(workflowMsg.id, workflowMsg.workflow);
                } else {
                  setPendingSuggestion(null);
                  setPendingWorkflowId(null);
                }
              }}
              onCustom={(instruction) => {
                void handleSubmit(undefined, `Regarding your suggestion: ${instruction}`);
              }}
            />
          ) : (
            <Composer
              draft={draft}
              setDraft={setDraft}
              onSubmit={handleSubmit}
              onStop={stopStreaming}
              isThinking={isThinking}
              isProjectScope={isProjectScope}
              availableReferenceDocuments={availableReferenceDocuments}
              selectedReferenceIds={selectedReferenceIds}
              selectedReferenceLabel={selectedReferenceLabel}
              selectedReferenceSet={selectedReferenceSet}
              onSelectReferenceIds={onSelectReferenceIds}
              onToggleReferenceDocument={toggleReferenceDocument}
              selectedProvider={selectedProvider}
              onProviderChange={handleProviderChange}
            />
          )}
        </div>
      </div>
    </TooltipProvider>
  );
}
