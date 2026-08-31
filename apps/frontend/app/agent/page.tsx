"use client";

import React, {
  useState,
  useEffect,
  useMemo,
  useRef,
  Children,
  isValidElement,
  cloneElement,
  ReactNode,
  ReactElement,
} from "react";
import { useAuth } from "@/hooks/useAuth";
import { apiFetch, apiJson } from "@/lib/apiClient";
import ParticlesBackground from "@/components/ParticlesBackground";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";

import {
  Sparkles,
  ChevronDown,
  ArrowRight,
  Link2,
  FolderOpen,
  Check,
  Loader2,
  Undo2,
  X,
  FileText,
  History,
  MessageSquare,
  Copy,
  Maximize2,
} from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { useAccountContext } from "@/app/context/AccountContext";
import dynamic from "next/dynamic";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ThinkingDisplay } from "@/components/ThinkingDisplay";

const PDFViewerDynamic = dynamic(
  () => import("@/components/PDFViewer/Sample"),
  { ssr: false, loading: () => <div className="flex items-center justify-center h-full"><Loader2 className="h-5 w-5 animate-spin text-black/30" /></div> }
);

interface Project {
  _id: string;
  name: string;
  description?: string | null;
}

interface Contract {
  _id: string;
  contract_name: string;
  status?: string;
}

interface AgentSession {
  session_id: string;
  title?: string;
  message_count?: number;
  created_at?: string;
  updated_at?: string;
  contract_name?: string;
  is_project_session?: boolean;
}

type AIProvider = "groq" | "gemini" | "openai" | "claude";

const modelOptions = [
  { value: "groq" as const, label: "Groq", description: "Llama 3.3 70B · Ultra-fast" },
  { value: "gemini" as const, label: "Gemini", description: "Gemini 2.0 Flash · Creative" },
  { value: "openai" as const, label: "OpenAI", description: "GPT-4o Mini · Reasoning" },
  { value: "claude" as const, label: "Claude", description: "Claude Sonnet 4.6 · Deep analysis" },
];

interface AgentTraceEvent {
  event: string;
  detail?: any;
}

interface CitationAnnotation {
  ref: number;
  source_ref?: number;
  doc_id?: string;
  document_id?: string;
  filename?: string;
  page?: number | string;
  page_start?: number;
  page_end?: number;
  quote?: string;
  segment_id?: string;
  evidence_id?: string;
  source_id?: string;
  id?: string;
  verified?: boolean;
}

interface AgentMessage {
  id: string;
  role: "user" | "agent";
  content: string;
  currentThinking?: string;
  _hasRedactedThinking?: boolean;
  agentTrace?: AgentTraceEvent[];
  citationAnnotations?: CitationAnnotation[];
  citation?: string;
  startedAt?: number;
  isValidating?: boolean;
  durationMs?: number;
  tokenUsage?: {
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
    cache_read_tokens?: number;
    reasoning_tokens?: number;
  };
  costUsd?: number;
}

interface CitationSidebarState {
  open: boolean;
  contractId: string;
  contractName: string;
  page: number | null;
  quote: string;
  filename: string;
}

function formatDuration(durationMs?: number) {
  if (!durationMs) return "0.0 sec";
  const totalSeconds = Math.round((durationMs / 1000) * 10) / 10;
  if (totalSeconds < 60) {
    return `${totalSeconds} sec`;
  }
  const mins = Math.floor(totalSeconds / 60);
  const secs = Math.round((totalSeconds % 60) * 10) / 10;
  return secs > 0 ? `${mins} min ${secs} sec` : `${mins} min`;
}

function formatTokens(usage?: AgentMessage["tokenUsage"]): string | null {
  if (!usage) return null;
  const total = usage.total_tokens || (usage.input_tokens + usage.output_tokens);
  if (!total) return null;
  const parts: string[] = [`${total.toLocaleString()} tok`];
  if (usage.reasoning_tokens) parts.push(`${usage.reasoning_tokens.toLocaleString()} reasoning`);
  if (usage.cache_read_tokens) parts.push(`${usage.cache_read_tokens.toLocaleString()} cached`);
  return parts.join(" · ");
}

function formatCost(costUsd?: number): string | null {
  if (!costUsd || costUsd <= 0) return null;
  if (costUsd < 0.001) return `<$0.001`;
  return `$${costUsd.toFixed(4)}`;
}

function cleanDisplayText(text: string | null | undefined) {
  if (!text) return "";
  return String(text)
    .replace(/\r\n?/g, "\n")
    .replace(/\b(?:document|contract|kpi|source|session|run|breach)\s+id\s*[:#]?\s*[a-z0-9_-]{8,}/gi, "")
    .replace(/\((?:id|ID)\s+[a-f0-9]{16,}\)/g, "")
    .replace(/\b[a-f0-9]{24}\b/gi, "")
    .replace(/\bDocument ID\b/gi, "Document")
    .trim();
}

function shouldShowSources(message: AgentMessage) {
  return /\[\d+(?:\s*,\s*\d+)*\]/.test(message.content);
}

function citationRefs(rawRefs: string) {
  return rawRefs
    .split(",")
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isInteger(value) && value > 0);
}

function MarkdownTable({ children }: { children: ReactNode }) {
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    if (!isFullscreen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setIsFullscreen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isFullscreen]);

  return (
    <>
      <div className="relative group my-3">
        <button
          onClick={() => setIsFullscreen(true)}
          className="absolute top-2 right-2 p-1.5 rounded-lg border border-gray-200 bg-white/95 text-gray-500 hover:text-gray-900 shadow-md opacity-0 group-hover:opacity-100 transition-all duration-200 z-10 flex items-center justify-center cursor-pointer hover:bg-gray-50 active:scale-95"
          title="Open in fullscreen"
        >
          <Maximize2 className="h-3.5 w-3.5" />
        </button>
        <div className="max-w-full overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <table className="min-w-[540px] table-auto divide-y divide-gray-200 text-left text-[10px] sm:text-[11px]">
            {children}
          </table>
        </div>
      </div>

      {isFullscreen && (
        <div 
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[9999] flex items-center justify-center p-4 sm:p-10"
          style={{ animation: "fadeIn 0.2s ease-out forwards" }}
          onClick={() => setIsFullscreen(false)}
        >
          <style>{`
            @keyframes fadeIn {
              from { opacity: 0; }
              to { opacity: 1; }
            }
            @keyframes scaleIn {
              from { transform: scale(0.95); opacity: 0; }
              to { transform: scale(1); opacity: 1; }
            }
          `}</style>
          <div 
            className="bg-white rounded-xl shadow-2xl border border-gray-200 w-full max-w-6xl max-h-[85vh] flex flex-col p-6 overflow-hidden"
            style={{ animation: "scaleIn 0.25s cubic-bezier(0.16, 1, 0.3, 1) forwards" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-center mb-4 pb-3 border-b border-gray-100 shrink-0">
              <h3 className="font-semibold text-gray-900 text-sm">Table Preview</h3>
              <button 
                onClick={() => setIsFullscreen(false)}
                className="p-1 rounded-md hover:bg-gray-100 text-gray-500 hover:text-gray-700 transition-colors flex items-center justify-center cursor-pointer active:scale-95"
                title="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex-1 overflow-auto rounded-lg border border-gray-200 bg-white p-2">
              <table className="min-w-full table-auto divide-y divide-gray-200 text-left text-xs sm:text-sm">
                {children}
              </table>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function citationAnnotationsFromDetails(citationDetails: any, rawAnnotations: unknown): CitationAnnotation[] {
  if (Array.isArray(rawAnnotations)) return rawAnnotations as CitationAnnotation[];
  if (!citationDetails) return [];
  if (Array.isArray(citationDetails.annotations)) return citationDetails.annotations as CitationAnnotation[];
  if (Array.isArray(citationDetails.citations)) return citationDetails.citations as CitationAnnotation[];
  if (!Array.isArray(citationDetails.cited_segments)) return [];

  return citationDetails.cited_segments.map((segment: any, index: number) => ({
    ref: index + 1,
    doc_id: segment.contract_id,
    document_id: segment.contract_id,
    filename: segment.contract_name,
    page: segment.page_number ?? segment.page,
    page_start: segment.page_start ?? segment.page_number,
    page_end: segment.page_end,
    quote: segment.text ?? "",
    segment_id: segment.id,
  }));
}

function normalizeCitationPayload(rawAnnotations: CitationAnnotation[]) {
  const refMap = new Map<number, number>();
  const markerMap = new Map<string, number>();
  const annotations = rawAnnotations.map((annotation, index) => {
    const displayRef = Number(annotation.ref);
    const sourceRef = Number(annotation.source_ref ?? annotation.ref);
    const safeDisplayRef = Number.isInteger(displayRef) && displayRef > 0 ? displayRef : index + 1;

    return {
      ...annotation,
      source_ref: Number.isInteger(sourceRef) && sourceRef > 0 ? sourceRef : safeDisplayRef,
      ref: safeDisplayRef,
    };
  });

  annotations.forEach((annotation) => {
    const displayRef = Number(annotation.ref);
    if (Number.isInteger(displayRef) && displayRef > 0) {
      refMap.set(displayRef, displayRef);
    }
  });
  annotations.forEach((annotation) => {
    const sourceRef = Number(annotation.source_ref);
    const displayRef = Number(annotation.ref);
    if (Number.isInteger(sourceRef) && sourceRef > 0 && !refMap.has(sourceRef)) {
      refMap.set(sourceRef, displayRef);
    }
  });
  annotations.forEach((annotation) => {
    const displayRef = Number(annotation.ref);
    if (!displayRef || displayRef <= 0) return;
    [
      annotation.segment_id,
      annotation.evidence_id,
      annotation.source_id,
      annotation.id,
    ].forEach((marker) => {
      const markerText = cleanDisplayText(marker || "");
      if (markerText && !markerMap.has(markerText)) {
        markerMap.set(markerText, displayRef);
      }
    });
  });

  return { annotations, refMap, markerMap };
}

function normalizeCitationMarkerText(text: string, refMap: Map<number, number>, markerMap: Map<string, number> = new Map()) {
  if (!text || (refMap.size === 0 && markerMap.size === 0)) return text;

  return text.replace(/\[([^\]\n]{1,160})\]/g, (marker, rawRefs: string) => {
    const trimmedRefs = rawRefs.trim();
    const isNumericMarker = /^\d+(?:\s*,\s*\d+)*$/.test(trimmedRefs);
    const displayRefs = isNumericMarker
      ? citationRefs(trimmedRefs)
        .map((ref) => refMap.get(ref))
        .filter((ref): ref is number => Boolean(ref))
      : [markerMap.get(trimmedRefs)].filter((ref): ref is number => Boolean(ref));

    if (!displayRefs.length) return marker;

    const uniqueDisplayRefs = Array.from(new Set(displayRefs));
    return `[${uniqueDisplayRefs.join(", ")}]`;
  });
}

function MessageActions({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy text: ", err);
    }
  };

  return (
    <div className="flex items-center gap-1.5 mt-2 px-1 text-black/35">
      <button
        type="button"
        onClick={handleCopy}
        className="flex items-center gap-1 rounded px-2 py-1 text-xs hover:bg-black/5 hover:text-black/70 transition-colors"
        title="Copy message"
      >
        {copied ? (
          <>
            <Check className="h-3.5 w-3.5 text-green-600 animate-in fade-in zoom-in duration-200" />
            <span className="text-[10px] text-green-600 font-medium">Copied</span>
          </>
        ) : (
          <>
            <Copy className="h-3.5 w-3.5" />
            <span className="text-[10px] font-medium">Copy</span>
          </>
        )}
      </button>
    </div>
  );
}

export default function StandaloneAgentPage() {
  const { isAuthenticated, authChecked, token } = useAuth();
  const apiUrl = process.env.NEXT_PUBLIC_EXTRACTOR_API_URL;
  const { selectedAccountId, isInitialized: accountInitialized } = useAccountContext();

  // Projects & Contracts state
  const [projects, setProjects] = useState<Project[]>([]);
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [isProjectsLoading, setIsProjectsLoading] = useState(false);
  const [isContractsLoading, setIsContractsLoading] = useState(false);

  // Selection states
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [selectedContractIds, setSelectedContractIds] = useState<string[]>([]);
  const [selectedProvider, setSelectedProvider] = useState<AIProvider>("groq");

  // Chat conversation state
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [isThinking, setIsThinking] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [inputText, setInputText] = useState("");
  const [expandedMessageIds, setExpandedMessageIds] = useState<Record<string, boolean>>({});
  const [citationSidebar, setCitationSidebar] = useState<CitationSidebarState>({
    open: false,
    contractId: "",
    contractName: "",
    page: null,
    quote: "",
    filename: "",
  });

  // Session management state
  const [sessions, setSessions] = useState<AgentSession[]>([]);
  const [isSessionsLoading, setIsSessionsLoading] = useState(false);
  const [sessionDialogOpen, setSessionDialogOpen] = useState(false);

  const openCitationSidebar = (annotation: CitationAnnotation) => {
    // Try to resolve a contractId from doc_id / document_id or filename match
    const rawId = annotation.doc_id || annotation.document_id || annotation.id || annotation.source_id || "";
    // Try to find a matching contract by _id
    const matchById = contracts.find((c) => c._id === rawId);
    // Try to find by filename (fuzzy: contract_name contains filename)
    const matchByName = !matchById
      ? contracts.find((c) =>
        annotation.filename
          ? c.contract_name.toLowerCase().includes((annotation.filename).replace(/\.[^.]+$/, "").toLowerCase())
          : false
      )
      : null;
    const resolvedContract = matchById || matchByName || null;
    const contractId = resolvedContract?._id || rawId;
    const contractName = resolvedContract?.contract_name || annotation.filename || "Document";
    const page = typeof annotation.page === "number" ? annotation.page
      : typeof annotation.page === "string" ? parseInt(annotation.page, 10) || null
        : annotation.page_start ?? null;
    setCitationSidebar({
      open: true,
      contractId,
      contractName,
      page,
      quote: annotation.quote || "",
      filename: annotation.filename || "",
    });
  };

  const closeCitationSidebar = () => setCitationSidebar((s) => ({ ...s, open: false }));

  const toggleMessageTrace = (messageId: string) => {
    setExpandedMessageIds((prev) => ({
      ...prev,
      [messageId]: !prev[messageId],
    }));
  };

  const streamTextRef = useRef<Map<string, string>>(new Map());
  const thinkingRef = useRef<Map<string, string>>(new Map());
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Load projects on mount or when account workspace changes
  useEffect(() => {
    if (!isAuthenticated || !token || !apiUrl || !accountInitialized) return;

    const fetchProjects = async () => {
      setIsProjectsLoading(true);
      try {
        const queryParams = new URLSearchParams();
        if (selectedAccountId) {
          queryParams.set("context_id", selectedAccountId);
        }
        const qs = queryParams.toString();
        const url = `${apiUrl}/projects/all${qs ? `?${qs}` : ""}`;
        const { data, error, response } = await apiJson(url);
        if (error || !response?.ok) {
          console.error("Failed to load projects details:", error);
          throw new Error(error || "Failed to load projects");
        }
        setProjects((data as any) || []);

        // Reset selected project if it's no longer in the loaded list for this workspace context
        setSelectedProject((current) => {
          if (!current) return null;
          const stillExists = ((data as any[]) || []).some((p: Project) => p._id === current._id);
          return stillExists ? current : null;
        });
      } catch (error) {
        console.error("Error loading projects:", error);
        toast({
          title: "Projects unavailable",
          description: "Could not load projects. Please try again.",
          variant: "destructive",
        });
      } finally {
        setIsProjectsLoading(false);
      }
    };

    void fetchProjects();
  }, [isAuthenticated, token, apiUrl, selectedAccountId, accountInitialized]);

  // Load contracts when selected project changes
  useEffect(() => {
    if (!apiUrl || !selectedProject) {
      setContracts([]);
      setSelectedContractIds([]);
      return;
    }

    const fetchContracts = async () => {
      setIsContractsLoading(true);
      try {
        const response = await apiFetch(`${apiUrl}/projects/${selectedProject._id}/contracts`);
        if (!response.ok) throw new Error("Failed to load project contracts");
        const data = await response.json();
        setContracts(data?.documents || []);
        setSelectedContractIds([]);
      } catch (error) {
        console.error("Error loading project contracts:", error);
        toast({
          title: "Contracts unavailable",
          description: "Could not load contracts for the selected project.",
          variant: "destructive",
        });
      } finally {
        setIsContractsLoading(false);
      }
    };

    void fetchContracts();
  }, [selectedProject, apiUrl]);

  // Preload sessions when project changes, and refresh when popover opens
  useEffect(() => {
    if (!apiUrl || !selectedProject) return;

    const fetchSessions = async () => {
      setIsSessionsLoading(true);
      try {
        const response = await apiFetch(`${apiUrl}/projects/${selectedProject._id}/agent/sessions`);
        if (!response.ok) throw new Error("Failed to load sessions");
        const data = await response.json();
        setSessions(data?.sessions || []);
      } catch (error) {
        console.error("Error loading sessions:", error);
        setSessions([]);
      } finally {
        setIsSessionsLoading(false);
      }
    };

    void fetchSessions();
  }, [selectedProject, apiUrl, sessionDialogOpen]);

  // Scroll to bottom when new messages come
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleProviderChange = (provider: AIProvider) => {
    setSelectedProvider(provider);
  };

  const toggleContractSelection = (contractId: string) => {
    setSelectedContractIds((current) => {
      if (current.includes(contractId)) {
        return current.filter((id) => id !== contractId);
      } else {
        return [...current, contractId];
      }
    });
  };

  const selectAllContracts = () => {
    setSelectedContractIds([]);
  };

  const selectedProviderLabel = useMemo(() => {
    return modelOptions.find((opt) => opt.value === selectedProvider)?.label || selectedProvider;
  }, [selectedProvider]);

  const enqueueStreamText = (messageId: string, text: string) => {
    const streamDelta = String(text).replace(/\r\n?/g, "\n");
    if (!streamDelta) return;

    const nextRawText = `${streamTextRef.current.get(messageId) ?? ""}${streamDelta}`;
    streamTextRef.current.set(messageId, nextRawText);

    // Strip <CITATIONS> block progressively — once the opening tag appears,
    // hide everything from there onward until the block closes (or stream ends).
    const displayText = cleanDisplayText(
      nextRawText
        .replace(/<CITATIONS?>[\s\S]*?<\/CITATIONS?>/gi, "")  // complete block
        .replace(/<CITATIONS?>[\s\S]*/gi, "")                 // partial block still streaming
        .trimEnd()
    );

    // Clear thinking when answer starts streaming
    thinkingRef.current.delete(messageId);

    setMessages((current) =>
      current.map((msg) =>
        msg.id === messageId
          ? { ...msg, content: displayText, currentThinking: undefined }
          : msg
      )
    );
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

    if (eventName === "status" || eventName === "thinking" || eventName === "tool_call" || eventName === "tool_result") {
      const message = typeof data.message === "string" ? data.message : "";
      const iteration = typeof data.iteration === "number" ? data.iteration : 1;

      setMessages((current) =>
        current.map((msg) => {
          if (msg.id !== agentMessageId) return msg;
          const currentTrace = Array.isArray(msg.agentTrace) ? [...msg.agentTrace] : [];

          if (eventName === "thinking") {
            const isRedacted = message === "<thinking redacted>";

            currentTrace.push({
              event: "react_thought",
              detail: { iteration, thought: isRedacted ? "[redacted]" : message },
            });

            // Append rather than overwrite — Claude may emit multiple thinking blocks
            const prevThinking = msg.currentThinking ?? "";
            const nextThinking = isRedacted
              ? prevThinking  // don't append the sentinel string
              : prevThinking
                ? `${prevThinking}\n\n${message}`
                : message;

            return {
              ...msg,
              agentTrace: currentTrace,
              currentThinking: nextThinking || undefined,
              _hasRedactedThinking: isRedacted || (msg._hasRedactedThinking ?? false),
            };
          }

          // status / tool_call / tool_result — unchanged from original
          let traceDetail = data;
          if (eventName === "status") {
            traceDetail = { iteration, action: "status", reason: message || data.reason };
          }
          currentTrace.push({
            event:
              eventName === "status" ? "react_model_step" : eventName,
            detail: traceDetail,
          });
          return { ...msg, agentTrace: currentTrace };
        })
      );
      return;
    }

    if (eventName === "citations" || eventName === "citation") {
      const citationDetails = (data.citation_details ?? {}) as any;
      const citationAnnotations = citationAnnotationsFromDetails(citationDetails, data.citation_annotations || data.citations);
      const normalizedCitations = normalizeCitationPayload(citationAnnotations);

      setMessages((current) =>
        current.map((msg) => {
          if (msg.id !== agentMessageId) return msg;
          return {
            ...msg,
            content: normalizeCitationMarkerText(
              cleanDisplayText(msg.content),
              normalizedCitations.refMap,
              normalizedCitations.markerMap
            ),
            citationAnnotations: normalizedCitations.annotations,
            citation: cleanDisplayText(data.citation),
          };
        })
      );
      return;
    }

    if (eventName === "delta") {
      const deltaText = typeof data.text === "string" ? data.text : (typeof data === "string" ? data : "");
      if (!deltaText) return;
      enqueueStreamText(agentMessageId, deltaText);
      return;
    }

    if (eventName === "final") {
      streamTextRef.current.delete(agentMessageId);
      thinkingRef.current.delete(agentMessageId);
      // Final content has arrived; the network stream may still be sending
      // citation metadata, but the response must no longer look active.
      setIsThinking(false);
      const finalAnswer = typeof data.answer === "string" ? cleanDisplayText(data.answer) : "";

      const citationDetails = (data.citation_details ?? {}) as any;
      const citationAnnotations = citationAnnotationsFromDetails(citationDetails, data.citation_annotations || data.citations);
      const normalizedCitations = normalizeCitationPayload(citationAnnotations);

      setMessages((current) =>
        current.map((msg) =>
          msg.id === agentMessageId
            ? {
              ...msg,
              content: normalizeCitationMarkerText(
                finalAnswer || msg.content || "I could not find an answer in the indexed contract text.",
                normalizedCitations.refMap,
                normalizedCitations.markerMap
              ),
              isValidating: false,
              citationAnnotations: normalizedCitations.annotations,
              citation: cleanDisplayText(data.citation),
              currentThinking: msg.currentThinking,  // keep so ThinkingDisplay can render completed state
              _hasRedactedThinking: msg._hasRedactedThinking,
              durationMs: msg.startedAt ? Date.now() - msg.startedAt : undefined,
              tokenUsage: data.token_usage ?? undefined,
              costUsd: typeof data.cost_usd === "number" ? data.cost_usd : undefined,
            }
            : msg
        )
      );
      return;
    }

    if (eventName === "content_done") {
      // Mark the message as visually complete the moment text streaming ends.
      // Citations and final metadata arrive after this but don't affect display.
      setMessages((current) =>
        current.map((msg) =>
          msg.id === agentMessageId
            ? {
              ...msg,
              currentThinking: undefined,
              isValidating: true,
              durationMs: msg.startedAt ? Date.now() - msg.startedAt : undefined,
            }
            : msg
        )
      );
      return;
    }

    if (eventName === "done") {
      streamTextRef.current.delete(agentMessageId);
      thinkingRef.current.delete(agentMessageId);
      setIsThinking(false);
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

  const handleSend = async () => {
    const value = inputText.trim();
    if (!value || isThinking) return;

    // Auto-select first project if none selected — account-wide usage
    const activeProject = selectedProject || (projects.length > 0 ? projects[0] : null);
    if (!activeProject) {
      toast({ title: "No project available", description: "Create a project to start chatting.", variant: "destructive" });
      return;
    }
    // Sync UI if auto-selected
    if (!selectedProject && projects.length > 0) {
      setSelectedProject(projects[0]);
    }

    const agentMessageId = `agent-${Date.now()}`;
    const agentStartedAt = Date.now();
    setMessages((current) => [
      ...current,
      { id: `user-${Date.now()}`, role: "user", content: value },
      { id: agentMessageId, role: "agent", content: "", agentTrace: [], startedAt: agentStartedAt },
    ]);
    setInputText("");
    setIsThinking(true);

    try {
      const agentBasePath = `${apiUrl}/projects/${activeProject._id}/agent`;
      const requestBody = {
        message: value,
        session_id: sessionId,
        ai_provider: selectedProvider,
        reference_contract_ids: selectedContractIds.length ? selectedContractIds : undefined,
      };

      const response = await apiFetch(`${agentBasePath}/query/stream`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText || "Agent query failed.");
      }

      await readAgentStream(response, agentMessageId);
    } catch (error) {
      console.error("Agent query failed:", error);
      setMessages((current) =>
        current.map((msg) =>
          msg.id === agentMessageId
            ? {
              ...msg,
              content: `Error: ${error instanceof Error ? error.message : "Agent query failed."}`,
            }
            : msg
        )
      );
    } finally {
      setIsThinking(false);
    }
  };

  const handleReset = () => {
    setMessages([]);
    setSessionId(null);
    setInputText("");
    setExpandedMessageIds({});
    streamTextRef.current.clear();
    thinkingRef.current.clear();
  };

  const switchToSession = async (targetSessionId: string) => {
    if (!apiUrl || !selectedProject) return;
    setSessionDialogOpen(false);
    setIsThinking(true);

    try {
      const response = await apiFetch(
        `${apiUrl}/projects/${selectedProject._id}/agent/sessions/${targetSessionId}/messages`
      );
      if (!response.ok) throw new Error("Failed to load session messages");
      const data = await response.json();
      const rawMessages = data?.messages || [];

      const loadedMessages: AgentMessage[] = rawMessages.map((m: any) => ({
        id: m.message_id || `msg-${Date.now()}-${Math.random()}`,
        role: m.role === "user" ? "user" : "agent",
        content: m.content || "",
        citationAnnotations: m.metadata?.citation_annotations || undefined,
        citation: m.metadata?.citation || undefined,
        agentTrace: m.metadata?.agent_trace || undefined,
        startedAt: m.created_at ? new Date(m.created_at).getTime() : undefined,
        durationMs: m.metadata?.duration_ms || undefined,
      }));

      setMessages(loadedMessages);
      setSessionId(targetSessionId);
    } catch (error) {
      console.error("Error loading session:", error);
      toast({ title: "Failed to load session", variant: "destructive" });
    } finally {
      setIsThinking(false);
    }
  };

  const deleteSession = async (targetSessionId: string) => {
    if (!apiUrl || !selectedProject) return;
    try {
      const response = await apiFetch(
        `${apiUrl}/projects/${selectedProject._id}/agent/sessions/${targetSessionId}`,
        { method: "DELETE" }
      );
      if (!response.ok) throw new Error("Failed to delete session");
      setSessions((prev) => prev.filter((s) => s.session_id !== targetSessionId));
      // If we deleted the active session, reset
      if (sessionId === targetSessionId) {
        handleReset();
      }
      toast({ title: "Session archived" });
    } catch (error) {
      console.error("Error deleting session:", error);
      toast({ title: "Failed to archive session", variant: "destructive" });
    }
  };

  const renderCitationButton = (
    message: AgentMessage,
    annotation: CitationAnnotation,
    keySuffix: string | number
  ) => {
    return (
      <button
        key={`${message.id}-citation-${keySuffix}`}
        type="button"
        onClick={() => openCitationSidebar(annotation)}
        className="mx-0.5 inline-flex h-3.5 min-w-[14px] items-center justify-center rounded border border-black/15 bg-black/5 px-1 align-super text-[9px] font-bold leading-none text-black hover:bg-black/15 hover:border-black/30 transition-colors cursor-pointer"
      >
        {annotation.ref}
      </button>
    );
  };

  const renderCitationAwareText = (
    message: AgentMessage,
    text: string,
    keyPrefix: string,
  ): React.ReactNode[] => {
    const annotations = message.citationAnnotations ?? [];
    const annotationsByRef = new Map(annotations.map((annotation) => [Number(annotation.ref), annotation]));
    const markerRegex = /\[(\d+(?:\s*,\s*\d+)*)\]/g;
    const parts: React.ReactNode[] = [];
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = markerRegex.exec(text)) !== null) {
      const markerStart = match.index;
      if (match.index > lastIndex) {
        parts.push(text.slice(lastIndex, match.index));
      }

      const annotationsForThisMarker = citationRefs(match[1])
        .map((ref) => annotationsByRef.get(ref))
        .filter((annotation): annotation is CitationAnnotation => Boolean(annotation));

      if (annotationsForThisMarker.length) {
        annotationsForThisMarker.forEach((annotation, annotationIndex) => {
          parts.push(renderCitationButton(message, annotation, `${keyPrefix}-${markerStart}-${annotationIndex}`));
        });
      } else {
        // ref exists in answer but has no annotation — render as muted badge
        citationRefs(match[1]).forEach((ref, i) => {
          parts.push(
            <span
              key={`${keyPrefix}-${markerStart}-unresolved-${i}`}
              className="mx-0.5 inline-flex h-3.5 min-w-[14px] items-center justify-center rounded border border-black/10 bg-black/[0.03] px-1 align-super text-[9px] font-bold leading-none text-black/30"
            >
              {ref}
            </span>
          );
        });
      }

      lastIndex = markerRegex.lastIndex;
    }

    if (lastIndex < text.length) {
      parts.push(text.slice(lastIndex));
    }

    return parts;
  };

  const renderCitationAwareChildren = (
    message: AgentMessage,
    children: React.ReactNode,
    keyPrefix: string,
  ): React.ReactNode => {
    return Children.map(children, (child, childIndex) => {
      const childKey = `${keyPrefix}-${childIndex}`;
      if (typeof child === "string") {
        return renderCitationAwareText(message, child, childKey);
      }

      if (isValidElement<{ children?: React.ReactNode }>(child) && child.props.children) {
        return cloneElement(
          child as ReactElement<{ children?: React.ReactNode }>,
          undefined,
          renderCitationAwareChildren(message, child.props.children, childKey),
        );
      }

      return child;
    });
  };

  // If still checking auth or initializing account context
  if (authChecked === false || isAuthenticated === null || !accountInitialized) {
    return (
      <div className="flex h-[80vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return null;
  }

  return (
    <div
      className="relative min-h-screen w-full flex flex-col font-sans select-none overflow-y-auto bg-white scrollbar-none [&::-webkit-scrollbar]:hidden"
      style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
    >
      {/* Elegant monochrome particles background */}
      <ParticlesBackground
        particleCount={1200}
        particleSpread={15}
        speed={0.04}
        particleColors={["#000000", "#1a1a1a", "#333333", "#4a4a4a"]}
        moveParticlesOnHover={true}
        particleHoverFactor={0.25}
        particleBaseSize={100}
        sizeRandomness={1.5}
        cameraDistance={18}
      />

      <div className="relative z-10 flex-1 flex flex-col w-full max-w-4xl mx-auto px-4 py-8 sm:px-6">

        {/* Top bar — always visible when a project is selected */}
        {selectedProject && (
          <div className="flex items-center justify-between mb-6 animate-fade-in">
            <div className="flex items-center gap-2">
              {/* Sessions selector — always visible */}
              <Popover open={sessionDialogOpen} onOpenChange={setSessionDialogOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-2 rounded-full border-black/10 bg-black/5 text-black/70 shadow-sm hover:bg-black/10 hover:text-black hover:border-black/20 transition-all"
                  >
                    <History className="h-4 w-4" />
                    Sessions
                    {sessions.length > 0 && (
                      <span className="ml-0.5 text-[10px] text-black/40 font-normal">({sessions.length})</span>
                    )}
                    <ChevronDown className="h-2.5 w-2.5 text-black/40" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent
                  align="start"
                  className="w-80 bg-white border-black/10 text-black p-2 shadow-2xl z-50"
                >
                  <div className="space-y-1">
                    <div className="px-2 py-1.5 text-[10px] font-semibold text-black/40 uppercase tracking-wider">
                      {isSessionsLoading ? (
                        <span className="flex items-center gap-2">
                          <Loader2 className="h-3 w-3 animate-spin" /> Loading sessions...
                        </span>
                      ) : (
                        `Past Sessions (${sessions.length})`
                      )}
                    </div>

                    {!isSessionsLoading && sessions.length === 0 && (
                      <div className="px-2 py-4 text-center text-xs text-black/40">
                        <MessageSquare className="h-5 w-5 mx-auto mb-2 opacity-30" />
                        <p>No past sessions</p>
                        <p className="text-[10px] text-black/30 mt-0.5">Start chatting to create one</p>
                      </div>
                    )}

                    {sessions.map((session) => {
                      const updatedDate = session.updated_at
                        ? (() => {
                          const d = new Date(session.updated_at);
                          const now = new Date();
                          const diffMs = now.getTime() - d.getTime();
                          const diffMins = Math.floor(diffMs / 60000);
                          const diffHours = Math.floor(diffMins / 60);
                          const diffDays = Math.floor(diffHours / 24);
                          if (diffMins < 1) return "Just now";
                          if (diffMins < 60) return `${diffMins}m ago`;
                          if (diffHours < 24) return `${diffHours}h ago`;
                          if (diffDays < 7) return `${diffDays}d ago`;
                          return d.toLocaleDateString();
                        })()
                        : "";
                      const isActive = session.session_id === sessionId;

                      return (
                        <button
                          key={session.session_id}
                          type="button"
                          onClick={() => switchToSession(session.session_id)}
                          className={`w-full flex items-center gap-2.5 rounded-lg px-3 py-2 text-xs transition-all text-left ${isActive
                            ? "bg-black/8 ring-1 ring-black/10"
                            : "hover:bg-black/[0.04]"
                            }`}
                        >
                          <MessageSquare className="h-3.5 w-3.5 flex-shrink-0 text-black/30" />
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-black/80 truncate">
                              {session.title || "Untitled session"}
                            </p>
                            <p className="text-[10px] text-black/40 mt-0.5">
                              {session.message_count ?? 0} messages · {updatedDate}
                              {isActive && <> · <span className="font-semibold text-black/50">Active</span></>}
                            </p>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </PopoverContent>
              </Popover>

              {/* Reset session — only when there are messages */}
              {messages.length > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleReset}
                  className="gap-2 rounded-full border-black/10 bg-black/5 hover-w-full text-black/70 shadow-sm hover:bg-black/10 hover:text-black hover:border-black/20 transition-all"
                >
                  <Undo2 className="h-4 w-4" />
                  Reset Session
                </Button>
              )}
            </div>

          </div>
        )}

        {/* Outer scrolling content wrapper */}
        <div className="flex-1 flex flex-col justify-between min-h-0">

          {/* Main Feed Container */}
          <div className="flex-1 flex flex-col justify-center">
            {messages.length === 0 ? (
              <div className="py-12 text-center">


                {/* Heading */}
                <h1
                  className="text-5xl md:text-6xl lg:text-7xl font-light italic tracking-tight text-black/30 mb-8 leading-[1.05]"
                  style={{ letterSpacing: "-0.02em" }}
                >
                  contract review,{" "}
                  <span className="text-black font-bold not-italic">reimagined.</span>
                </h1>

                {/* Thinking indicator in empty state */}
                {isThinking && (
                  <div className="flex items-center justify-center gap-4 animate-message-up">
                    <div className="flex flex-col gap-0.5 text-left">
                      <span className="text-sm font-medium text-black/60">Thinking</span>
                      <span className="text-xs text-black/30">Analyzing contracts and preparing response</span>
                    </div>
                    <div className="h-5 w-5 rounded-full border-2 border-black/10 border-t-black/40 animate-spin flex-shrink-0" />
                  </div>
                )}

                {/* Sessions shortcut — sits in top bar above */}
              </div>
            ) : (
              <div
                className="space-y-8 mb-8 overflow-y-auto max-h-[60vh] pr-2 scrollbar-none [&::-webkit-scrollbar]:hidden"
                style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
              >
                {messages.map((msg, idx) => (
                  <div
                    key={msg.id}
                    className={msg.role === "user" ? "animate-message-in" : "animate-message-up"}
                    style={{ animationDelay: `${idx * 0.06}s` }}
                  >
                    {msg.role === "user" ? (
                      <div className="flex justify-end">
                        <div className="max-w-[80%] rounded-2xl bg-black/5 text-black px-4 py-3 text-sm shadow-sm font-medium">
                          {msg.content}
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-col gap-3">
                        {/* Collapsible Agent Trace */}
                        {/* Boolean(), not the raw length. `agentTrace?.length`
                            is 0 for a message whose run produced no trace, and
                            React renders 0 as the text "0" — a bare digit
                            appeared in the transcript where the answer belongs. */}
                        {Boolean(msg.currentThinking || msg._hasRedactedThinking || msg.agentTrace?.length) && (
                          <div className="flex flex-col gap-2 select-none">

                            {/* ── Thinking panel — uses the new component ── */}
                            <ThinkingDisplay
                              thinking={msg.currentThinking}
                              isStreaming={isThinking && !msg.content}
                              hasRedacted={msg._hasRedactedThinking}
                              durationMs={msg.durationMs}
                              defaultExpanded={false}
                            />

                            {/* ── Tool call trace — collapsible, shown only after thinking is done ── */}
                            {msg.agentTrace?.some(e => e.event === "tool_call" || e.event === "react_thought") && (
                              <div className="flex flex-col gap-0">
                                <button
                                  type="button"
                                  onClick={() => toggleMessageTrace(msg.id)}
                                  className="flex items-center gap-1.5 text-[11px] text-black/40 hover:text-black/60 transition-colors w-fit"
                                >
                                  <span className="italic">Steps</span>
                                  {msg.tokenUsage && (
                                    <span className="ml-1 inline-flex items-center gap-1 rounded-full bg-black/5 px-1.5 py-0.5 text-[9px] text-black/35 font-normal not-italic">
                                      {(msg.tokenUsage.total_tokens || (msg.tokenUsage.input_tokens + msg.tokenUsage.output_tokens)).toLocaleString()} tok
                                      {msg.tokenUsage.reasoning_tokens
                                        ? ` · ${msg.tokenUsage.reasoning_tokens.toLocaleString()} reasoning`
                                        : ""}
                                      {msg.costUsd && msg.costUsd > 0
                                        ? ` · $${msg.costUsd < 0.001 ? "<0.001" : msg.costUsd.toFixed(4)}`
                                        : ""}
                                    </span>
                                  )}
                                  <ChevronDown
                                    className={`h-3 w-3 transition-transform duration-200 ${expandedMessageIds[msg.id] ? "rotate-180" : ""
                                      }`}
                                  />
                                </button>

                                {expandedMessageIds[msg.id] && (
                                  <div className="mt-2 rounded-xl bg-black/[0.015] overflow-hidden animate-content-in">
                                    <div
                                      className="px-3 py-2 space-y-2 font-mono text-[11px] text-black/60 max-h-52 overflow-y-auto"
                                      style={{ scrollbarWidth: "none" }}
                                    >
                                      {msg.agentTrace.map((event, eventIdx) => {
                                        if (event.event === "tool_call") {
                                          const name = event.detail?.name || "tool";
                                          const args = event.detail?.args ?? event.detail?.input ?? event.detail;
                                          const query =
                                            typeof args?.query === "string"
                                              ? args.query
                                              : typeof args?.document_ids !== "undefined"
                                                ? `${(args.document_ids as any[]).length} doc(s)`
                                                : null;
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
                                        if (event.event === "tool_result") {
                                          const summary = event.detail?.summary || event.detail?.result_summary || null;
                                          return summary ? (
                                            <div key={eventIdx} className="flex items-start gap-2 pl-2">
                                              <span className="text-black/30 font-bold mt-0.5">↳</span>
                                              <span className="text-black/40 italic truncate max-w-xs">{summary}</span>
                                            </div>
                                          ) : null;
                                        }
                                        return null;
                                      })}
                                    </div>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        )}


                        {/* Markdown Output Text */}
                        <div className="prose prose-neutral prose-p:my-1 max-w-none text-black/85 leading-relaxed text-left text-sm bg-white/40 p-4 rounded-xl  animate-content-in hover:bg-white/60 hover:border-black/10 transition-all duration-300">
                          <ReactMarkdown
                            remarkPlugins={[remarkGfm]}
                            components={{
                              p: ({ children }) => <p className="mb-1 last:mb-0">{renderCitationAwareChildren(msg, children, "p")}</p>,
                              li: ({ children }) => <li>{renderCitationAwareChildren(msg, children, "li")}</li>,
                              strong: ({ children }) => <strong className="font-semibold text-black">{renderCitationAwareChildren(msg, children, "strong")}</strong>,
                              em: ({ children }) => <em className="italic">{renderCitationAwareChildren(msg, children, "em")}</em>,
                              h1: ({ children }) => <h1 className="text-xl font-bold mt-4 mb-2">{renderCitationAwareChildren(msg, children, "h1")}</h1>,
                              h2: ({ children }) => <h2 className="text-lg font-bold mt-3 mb-2">{renderCitationAwareChildren(msg, children, "h2")}</h2>,
                              h3: ({ children }) => <h3 className="text-base font-bold mt-2.5 mb-1.5">{renderCitationAwareChildren(msg, children, "h3")}</h3>,
                              table: ({ children }) => <MarkdownTable>{children}</MarkdownTable>,
                            }}
                          >
                            {msg.content}
                          </ReactMarkdown>
                        </div>
                        {msg.content && <MessageActions text={msg.content} />}
                        {msg.isValidating && (
                          <p className="text-[11px] text-black/30 italic mt-1 animate-pulse">
                            Validating citations…
                          </p>
                        )}

                        {/* Sources Footer */}
                        {shouldShowSources(msg) && msg.citationAnnotations && msg.citationAnnotations.length > 0 && (
                          <div className="mt-2 text-[11px] text-black/50 border-t border-black/5 pt-2 text-left">
                            <span className="font-semibold uppercase tracking-wider text-black/40 text-[9px]">Sources</span>
                            <div className="mt-1 flex flex-col gap-1.5">
                              {msg.citationAnnotations.map((annotation) => {
                                const docName = annotation.filename || "Document";
                                const pageStr = annotation.page ? `Page ${annotation.page}` : "Source document";
                                return (
                                  <div key={annotation.ref} className="flex items-center gap-1.5">
                                    <Popover>
                                      <PopoverTrigger asChild>
                                        <button
                                          type="button"
                                          className="h-4 min-w-[16px] rounded border border-black/15 bg-white px-1 text-[9px] font-bold text-black hover:bg-black/5 transition-colors"
                                        >
                                          {annotation.ref}
                                        </button>
                                      </PopoverTrigger>
                                      <PopoverContent align="start" className="w-72 bg-white border-black/10 text-black p-3 shadow-xl z-50 rounded-xl">
                                        <div className="space-y-1.5 text-left text-xs">
                                          <div className="font-semibold text-black/90 truncate">{docName}</div>
                                          <div className="text-[10px] font-semibold text-black/50">{pageStr}</div>
                                          {annotation.quote && (
                                            <div className="max-h-20 overflow-y-auto text-[11px] leading-relaxed text-black/70 border-t border-black/5 pt-1.5 whitespace-pre-wrap font-sans italic">
                                              "{annotation.quote}"
                                            </div>
                                          )}
                                        </div>
                                      </PopoverContent>
                                    </Popover>
                                    <span className="truncate font-medium text-black/70 max-w-xs">{docName}</span>
                                    <span className="text-black/30">·</span>
                                    <span className="text-black/50">{pageStr}</span>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}

                      </div>
                    )}
                  </div>
                ))}


                <div ref={messagesEndRef} />
              </div>
            )}
          </div>

          {/* Control Panel / Input Form Card */}
          <div className="w-full rounded-2xl border border-black/10 bg-white/70 backdrop-blur-2xl p-5 shadow-[0_4px_40px_rgba(0,0,0,0.08)] transition-all duration-300 focus-within:border-black/25 focus-within:shadow-[0_4px_60px_rgba(0,0,0,0.12)]">

            {/* Text input textarea */}
            <div className="flex flex-col gap-3 min-h-[96px] text-left">
              <textarea
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
                disabled={isThinking}
                placeholder={
                  selectedProject
                    ? `Ask anything about "${selectedProject.name}"...`
                    : "Ask anything across your workspace..."
                }
                className="w-full bg-transparent border-0 p-0 text-sm text-black placeholder-black/30 outline-none focus:ring-0 focus:outline-none resize-none min-h-[80px] leading-relaxed"
              />

              {/* Bottom Accessory Row with all 3 dropdown selectors side-by-side */}
              <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-black/8">
                <div className="flex flex-wrap items-center gap-1.5">

                  {/* 1. Project Dropdown Selector */}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={isThinking}
                        className="h-8 gap-2 rounded-lg border-black/10 bg-white px-3 text-xs font-medium text-black/70 shadow-sm hover:bg-black/[0.02] hover:border-black/20 hover:text-black transition-all disabled:opacity-25"
                      >
                        <FolderOpen className="h-3.5 w-3.5 text-black/40" />
                        <span className="max-w-[120px] truncate">{selectedProject ? selectedProject.name : "Choose Project..."}</span>
                        <ChevronDown className="h-3 w-3 text-black/30" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="w-64 max-h-60 overflow-y-auto rounded-xl border-black/10 bg-white p-1.5 text-black shadow-xl z-50">
                      <DropdownMenuLabel className="px-2.5 py-1.5 text-[10px] font-semibold text-black/40 uppercase tracking-wider">Your Workspaces</DropdownMenuLabel>
                      <DropdownMenuSeparator className="bg-black/5 mx-1" />
                      {isProjectsLoading ? (
                        <div className="p-3 text-xs text-black/40 flex items-center justify-center gap-2">
                          <Loader2 className="h-3 w-3 animate-spin" /> Loading...
                        </div>
                      ) : projects.length === 0 ? (
                        <div className="p-3 text-xs text-black/40 text-center">No projects found</div>
                      ) : (
                        projects.map((proj) => (
                          <DropdownMenuItem
                            key={proj._id}
                            onSelect={() => {
                              setSelectedProject(proj);
                              setSelectedContractIds([]);
                            }}
                            className="flex items-center justify-between rounded-lg hover:bg-black/[0.04] cursor-pointer text-xs py-2 px-2.5"
                          >
                            <span className="text-black/80">{proj.name}</span>
                            {selectedProject?._id === proj._id && <Check className="h-3.5 w-3.5 text-black/40" />}
                          </DropdownMenuItem>
                        ))
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>

                  {/* 2. Model Selector */}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={isThinking}
                        className="h-8 gap-2 rounded-lg border-black/10 bg-white px-3 text-xs font-medium shadow-sm hover:bg-black/[0.02] hover:border-black/20 transition-all disabled:opacity-25"
                        style={{
                          color: selectedProvider === "claude" ? "#6b4fa0" : selectedProvider === "openai" ? "#10a37f" : selectedProvider === "gemini" ? "#4285f4" : "#333"
                        }}
                      >
                        <Sparkles className="h-3.5 w-3.5" style={{ opacity: 0.7 }} />
                        <span>{selectedProviderLabel}</span>
                        <ChevronDown className="h-3 w-3 text-black/30" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="w-52 rounded-xl border-black/10 bg-white p-1.5 text-black shadow-xl z-50">
                      {modelOptions.map((option) => (
                        <DropdownMenuItem
                          key={option.value}
                          onClick={() => handleProviderChange(option.value)}
                          className="flex flex-col items-start gap-0.5 rounded-lg hover:bg-black/[0.04] cursor-pointer px-2.5 py-2 text-xs"
                        >
                          <div className="flex items-center gap-1.5 w-full font-medium text-black/80">
                            {option.label}
                            {selectedProvider === option.value && <Check className="h-3.5 w-3.5 ml-auto text-black/40" />}
                          </div>
                          <span className="text-[10px] text-black/35">{option.description}</span>
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>

                  {/* 3. Contract context / Doc selector */}
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={!selectedProject || contracts.length === 0 || isThinking}
                        className="h-8 gap-2 rounded-lg border-black/10 bg-white px-3 text-xs font-medium text-black/70 shadow-sm hover:bg-black/[0.02] hover:border-black/20 hover:text-black transition-all disabled:opacity-25"
                      >
                        <Link2 className="h-3.5 w-3.5 text-black/40" />
                        <span>
                          {selectedContractIds.length === 0
                            ? "All docs"
                            : `${selectedContractIds.length} selected`}
                        </span>
                        <ChevronDown className="h-3 w-3 text-black/30" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent align="start" className="w-80 rounded-xl border-black/10 bg-white text-black p-3 shadow-xl z-50">
                      <div className="flex items-center justify-between pb-2 mb-2 border-b border-black/8">
                        <span className="text-[10px] font-semibold text-black/40 uppercase tracking-wider">Reference Context</span>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={selectAllContracts}
                          className="h-6 px-2 text-[10px] text-black/50 hover:text-black hover:bg-black/5"
                        >
                          Reset to All
                        </Button>
                      </div>
                      <div className="max-h-60 overflow-y-auto space-y-1">
                        {isContractsLoading ? (
                          <div className="py-4 text-center text-xs text-black/40 flex items-center justify-center gap-2">
                            <Loader2 className="h-3 w-3 animate-spin" /> Loading contracts...
                          </div>
                        ) : contracts.length === 0 ? (
                          <div className="py-4 text-center text-xs text-black/40">No contracts in this project</div>
                        ) : (
                          contracts.map((contract) => (
                            <div
                              key={contract._id}
                              onClick={() => toggleContractSelection(contract._id)}
                              className="flex items-start gap-2.5 p-2 rounded-lg hover:bg-black/5 cursor-pointer text-xs transition-colors"
                            >
                              <Checkbox
                                checked={selectedContractIds.length === 0 || selectedContractIds.includes(contract._id)}
                                onCheckedChange={() => toggleContractSelection(contract._id)}
                                className="mt-0.5 border-black/20 data-[state=checked]:bg-black data-[state=checked]:border-black data-[state=checked]:text-white"
                              />
                              <div className="flex-1 min-w-0">
                                <p className="font-medium truncate text-black/80">{contract.contract_name}</p>
                                <p className="text-[10px] text-black/40 truncate">{contract.status || "indexed"}</p>
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    </PopoverContent>
                  </Popover>

                </div>

                {/* Send button */}
                <Button
                  onClick={handleSend}
                  disabled={!inputText.trim() || isThinking}
                  className="h-8 w-8 rounded-lg bg-black hover:bg-black/85 text-white transition-all duration-200 shadow-sm disabled:bg-black/8 disabled:text-black/20 disabled:shadow-none"
                >
                  {isThinking ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <ArrowRight className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </div>
          </div>

          <p className="text-black/30 text-[11px] mt-5 tracking-wide text-center">
            AI · Not legal advice
          </p>
        </div>

      </div>

      {/* ── Citation PDF Sidebar ── */}
      {/* Backdrop */}
      {citationSidebar.open && (
        <div
          className="fixed inset-0 z-40 bg-black/20 backdrop-blur-[2px]"
          onClick={closeCitationSidebar}
        />
      )}

      {/* Slide-in panel */}
      <div
        className={`fixed inset-y-0 right-0 z-50 flex flex-col bg-white shadow-2xl transition-transform duration-300 ease-out ${citationSidebar.open ? "translate-x-0" : "translate-x-full"
          }`}
        style={{ width: "min(560px, 95vw)" }}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-black/8 flex-shrink-0">
          <FileText className="h-4 w-4 text-black/40 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-sm text-black/90 truncate">
              {citationSidebar.contractName}
            </p>
            {citationSidebar.page && (
              <p className="text-[11px] text-black/40 mt-0.5">
                Page {citationSidebar.page}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={closeCitationSidebar}
            className="flex-shrink-0 rounded-full p-1.5 hover:bg-black/5 transition-colors"
          >
            <X className="h-4 w-4 text-black/50" />
          </button>
        </div>

        {/* Citation quote strip */}
        {citationSidebar.quote && (
          <div className="flex-shrink-0 px-5 py-3 bg-amber-50/70 border-b border-amber-100 text-[12px] leading-relaxed text-amber-900/80 italic">
            <span className="not-italic font-semibold text-amber-700/80 mr-1.5">Cited:</span>
            &ldquo;{citationSidebar.quote}&rdquo;
          </div>
        )}

        {/* PDF Viewer */}
        <div className="flex-1 min-h-0 overflow-hidden">
          {citationSidebar.open && citationSidebar.contractId ? (
            <PDFViewerDynamic
              key={`${citationSidebar.contractId}-${citationSidebar.page}`}
              contractId={citationSidebar.contractId}
              searchKey=""
              searchValue={
                citationSidebar.quote
                  ? JSON.stringify([{
                    page: citationSidebar.page,
                    quote: citationSidebar.quote,
                  }])
                  : ""
              }
              token={token || ""}
            />
          ) : citationSidebar.open ? (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-black/30">
              <FileText className="h-10 w-10 opacity-30" />
              <p className="text-sm">No contract document found for this citation.</p>
              <p className="text-xs text-black/20 max-w-xs text-center">
                {citationSidebar.filename || "The source document could not be located."}
              </p>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
