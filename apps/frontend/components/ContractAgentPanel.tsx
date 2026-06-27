"use client";

import { Children, cloneElement, isValidElement, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, ReactElement, ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  ArrowRight,
  Check,
  ChevronDown,
  ChevronRight,
  Download,
  FileText,
  History,
  Info,
  Link2,
  PencilLine,
  Plus,
  ShieldCheck,
  Sparkles,
  Trash2,
} from "lucide-react";
import { CitationHoverCard } from "@/components/agent/CitationHoverCard";
import { ReActThinkingStream } from "@/components/agent/ReActThinkingStream";
import { ToolUsageCard } from "@/components/agent/ToolUsageCard";
import { ApprovalInput } from "@/components/agent/ApprovalInput";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  approveAgentWorkflow,
  rejectAgentWorkflow,
  updateAgentWorkflowProposal,
  type AgentApprovalRequest,
  type AgentResponse as DeepAgentResponse,
  type AgentTokenUsage,
  type AgentTraceEvent,
  type AgentWorkflowStatus,
  type Suggestion,
  type TabularReviewProposal,
} from "@/lib/agent";
import { apiDownload, apiFetch } from "@/lib/apiClient";
import { cn } from "@/lib/utils";

type AgentWorkflowState = {
  workflowId: string;
  status: AgentWorkflowStatus;
  approval?: AgentApprovalRequest | null;
  proposal?: TabularReviewProposal | null;
  busy?: boolean;
  createdReviewId?: string | null;
};

type AgentMessage = {
  id: string;
  role: "agent" | "user";
  content: string;
  activity?: AgentActivity[];
  artifacts?: AgentArtifact[];
  citation?: string;
  confidence?: "high" | "medium" | "low";
  citationDetails?: CitationDetails;
  citationAnnotations?: CitationAnnotation[];
  workflow?: AgentWorkflowState;
  agentTrace?: AgentTraceData;
  tokenUsage?: AgentTokenUsage | null;
  costUsd?: number | null;
  currentThinking?: string;
};

type AgentTraceData = AgentTraceEvent[] | Record<string, unknown>;

type AgentSession = {
  session_id: string;
  title?: string;
  message_count?: number;
  updated_at?: string;
};

const SAFE_MARKDOWN_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

function safeMarkdownHref(href?: string): string | undefined {
  if (!href) return undefined;

  try {
    const parsed = new URL(href, "https://contractsense.local");
    return SAFE_MARKDOWN_PROTOCOLS.has(parsed.protocol) ? href : undefined;
  } catch {
    return undefined;
  }
}

type AgentStoredMessage = {
  message_id?: string;
  role: "user" | "assistant";
  content: string;
  created_at?: string;
  metadata?: {
    confidence?: "high" | "medium" | "low";
    citation?: string;
    citation_details?: CitationDetails;
    citation_annotations?: CitationAnnotation[];
    artifacts?: AgentArtifact[];
    agent_trace?: AgentTraceData;
    token_usage?: AgentTokenUsage;
    cost_usd?: number;
  };
};

type RedlineChangePreview = {
  finding_id?: string;
  rule_name?: string;
  matched_text?: string;
  suggested_revision?: string;
  rationale?: string;
  reason?: string;
};

type AgentEditAnnotation = {
  edit_id: string;
  document_id?: string;
  version_id?: string;
  version_number?: number;
  deleted_text?: string;
  inserted_text?: string;
  reason?: string;
  status?: "pending" | "accepted" | "rejected" | string;
};

type AgentArtifact = {
  artifact_id: string;
  document_id?: string;
  version_id?: string;
  version_number?: number | null;
  filename: string;
  content_type?: string;
  byte_count?: number;
  download_url?: string;
  artifact_kind?: string;
  type?: string;
  editable?: boolean;
  contract_id?: string;
  kpi_count?: number;
  new_or_updated_count?: number;
  candidate_count?: number;
  extraction_method?: string;
  contract_name?: string;
  run_id?: string;
  llm_error?: string | null;
  summary?: Record<string, unknown>;
  // Retained for rendering historical responses from removed tools
  redline_changes?: RedlineChangePreview[];
  applied_redline_changes?: RedlineChangePreview[];
  unmatched_redline_changes?: RedlineChangePreview[];
  edit_annotations?: AgentEditAnnotation[];
};

type AIProvider = "groq" | "gemini" | "openai" | "claude";

type AgentActivity = {
  id: string;
  label: string;
  detail?: string;
  status: "running" | "done" | "error";
};

type AgentReasoningItem = {
  id: string;
  label: string;
  detail?: string;
  status: "running" | "done" | "error";
  tone?: "attention" | "neutral" | "success";
};

type CitedSegment = {
  id: string;
  text: string;
  page_number?: number | null;
  page?: number | string | null;
  page_start?: number | null;
  page_end?: number | null;
  type: string;
  contract_id?: string | null;
  contract_name?: string | null;
  verified?: boolean;
};

type CitationAnnotation = {
  type?: "citation_data";
  ref: number;
  source_ref?: number;
  id?: string;
  evidence_id?: string;
  source_id?: string;
  doc_id?: string;
  document_id?: string | null;
  contract_id?: string | null;
  filename?: string;
  page?: number | string | null;
  page_start?: number | null;
  page_end?: number | null;
  quote: string;
  segment_id?: string;
  verified?: boolean;
};

type CitationDetails = {
  cited_segments?: CitedSegment[];
  annotations?: CitationAnnotation[];
  source_pages_display?: string;
  justification?: string;
  citation_style?: string;
};

type ReferenceDocument = {
  id: string;
  name: string;
  status?: string;
  isCurrent?: boolean;
};

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
}

const quickActions = [
  "Review obligations and deadlines",
  "Find payment and termination terms",
  "Create a tabular risk review",
  "Draft an approval note",
  "Prepare edit suggestions",
];

const modelOptions: Array<{ value: AIProvider; label: string; description: string }> = [
  { value: "groq", label: "Groq", description: "Fast contract Q&A" },
  { value: "gemini", label: "Gemini", description: "Google Gemini models" },
  { value: "openai", label: "OpenAI", description: "OpenAI chat models" },
  { value: "claude", label: "Claude", description: "Anthropic Claude models" },
];

function isAIProvider(value: string | null | undefined): value is AIProvider {
  return modelOptions.some((option) => option.value === value);
}

function isConfidence(value: string | null | undefined): value is "high" | "medium" | "low" {
  return value === "high" || value === "medium" || value === "low";
}

function providerLabel(provider: AIProvider) {
  return modelOptions.find((option) => option.value === provider)?.label ?? "Groq";
}

function confidenceLabel(confidence?: "high" | "medium" | "low") {
  if (!confidence) return "";
  return `${confidence.charAt(0).toUpperCase()}${confidence.slice(1)} confidence`;
}

const mojibakeDisplayReplacements: Array<[RegExp, string]> = [
  // Bullets
  [/â€¢/g, "\u2022"],
  // Dashes
  [/â€"/g, "\u2013"],
  [/â€"/g, "\u2014"],
  [/â€•/g, "\u2014"],
  // Quotes
  [/â€˜/g, "'"],
  [/â€™/g, "'"],
  [/â€š/g, ","],
  [/â€œ/g, "\""],
  [/â€\u009d/g, "\""],
  // Ellipsis and angle quotes
  [/â€¦/g, "..."],
  [/â€º/g, ">"],
  [/â€¹/g, "<"],
  // Mathematical / comparison operators
  [/â‰¤/g, "\u2264"],
  [/â‰¥/g, "\u2265"],
  [/â‰ /g, "\u2260"],
  [/â‰ˆ/g, "\u2248"],
  [/Ã—/g, "\u00d7"],
  [/Ã·/g, "\u00f7"],
  // Spaces (narrow no-break space, figure space, etc.)
  [/â¯/g, " "],
  [/â€‰/g, " "],
  [/â€¯/g, " "],
  [/â€ƒ/g, " "],
  [/â€‚/g, " "],
  // Symbols
  [/â„¢/g, "\u2122"],
  [/â€/g, "\u2014"],
  // Accented Latin characters
  [/Ã©/g, "\u00e9"],
  [/Ã¨/g, "\u00e8"],
  [/Ã¡/g, "\u00e1"],
  [/Ã\u00a0/g, "\u00e0"],
  [/Ã¶/g, "\u00f6"],
  [/Ã¼/g, "\u00fc"],
  [/Ã±/g, "\u00f1"],
  [/Ã§/g, "\u00e7"],
  [/Ãª/g, "\u00ea"],
  [/Ã®/g, "\u00ee"],
  [/Ã¢/g, "\u00e2"],
  [/Ã´/g, "\u00f4"],
  [/Ã»/g, "\u00fb"],
  [/Ã¤/g, "\u00e4"],
  // Â-prefixed Latin-1 symbols
  [/Â®/g, "\u00ae"],
  [/Â©/g, "\u00a9"],
  [/Â·/g, "\u00b7"],
  [/Â£/g, "\u00a3"],
  [/Â¥/g, "\u00a5"],
  [/Â§/g, "\u00a7"],
  [/Â¶/g, "\u00b6"],
  [/Â°/g, "\u00b0"],
  [/Â½/g, "\u00bd"],
  [/Â¼/g, "\u00bc"],
  [/Â¾/g, "\u00be"],
  [/Â±/g, "\u00b1"],
  [/Â¯/g, " "],
  [/Â\u00a0/g, " "],
  // Bare Â — strip last
  [/Â/g, ""],
  // Orphaned continuation bytes (â followed by whitespace + Latin-1 char)
  [/â\s*[¡¢£¤¥¦§¨©ª«¬®¯°±²³´µ¶·¸¹º»¼½¾¿]/g, " "],
  // Residual isolated â before whitespace or digits
  [/â(?=[\s\d])/g, " "],
];

const monthNames: Record<string, string> = {
  jan: "January",
  january: "January",
  feb: "February",
  february: "February",
  mar: "March",
  march: "March",
  apr: "April",
  april: "April",
  may: "May",
  jun: "June",
  june: "June",
  jul: "July",
  july: "July",
  aug: "August",
  august: "August",
  sep: "September",
  sept: "September",
  september: "September",
  oct: "October",
  october: "October",
  nov: "November",
  november: "November",
  dec: "December",
  december: "December",
};

function cleanDisplayText(text: string | null | undefined, options: { trim?: boolean } = {}) {
  if (!text) return "";

  let cleaned = String(text)
    .replace(/\r\n?/g, "\n")
    .replace(/&lt;\s*br\s*\/?\s*&gt;|<\s*br\s*\/?\s*>/gi, "\n")
    .replace(/&nbsp;/gi, " ");

  mojibakeDisplayReplacements.forEach(([bad, good]) => {
    cleaned = cleaned.replace(bad, good);
  });

  cleaned = cleaned
    .replace(/([A-Za-z])â€\s*s\b/g, "$1's")
    .replace(/([A-Za-z])â€\s*t\b/g, "$1't")
    .replace(/\b([Ee]arn)â€\s*out\b/g, "$1-out")
    .replace(/\b([Cc]law)â€\s*back\b/g, "$1back")
    .replace(/â€(?=\s)/g, " ")
    .replace(/(^|\s)â€(?=\S)/g, "$1 ")
    .replace(/â€/g, "-")
    .replace(
      /\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t|tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)[- ]?(\d{1,2})\b/gi,
      (_, month: string, day: string) => `${monthNames[month.toLowerCase()] ?? month} ${day}`,
    )
    .replace(/[\u2000-\u200a\u2028-\u202f\u205f\u3000]/g, " ")
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/(\d)\s+['"]-?(?=[A-Za-z])/g, "$1 ")
    .replace(/(?:(?:\s*[—-]\s*)?\d+\s+quote[—-]?)+(?=\s*[.,;:])/gi, "")
    .replace(/\s+([.,;:])/g, "$1")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n");

  return options.trim === false ? cleaned : cleaned.trim();
}

function citationRefs(rawRefs: string) {
  return rawRefs
    .split(",")
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isInteger(value) && value > 0);
}

function citationAnnotationsFromDetails(citationDetails: CitationDetails, rawAnnotations: unknown): CitationAnnotation[] {
  if (Array.isArray(rawAnnotations)) return rawAnnotations as CitationAnnotation[];
  if (Array.isArray(citationDetails.annotations)) return citationDetails.annotations as CitationAnnotation[];
  if (Array.isArray((citationDetails as any).citations)) return (citationDetails as any).citations as CitationAnnotation[];
  if (!Array.isArray(citationDetails.cited_segments)) return [];

  return citationDetails.cited_segments.map((segment, index) => ({
    type: "citation_data",
    ref: index + 1,
    doc_id: segment.contract_id ?? undefined,
    document_id: segment.contract_id ?? undefined,
    filename: segment.contract_name ?? undefined,
    page: segment.page_number ?? segment.page ?? undefined,
    page_start: segment.page_start ?? segment.page_number ?? undefined,
    page_end: segment.page_end ?? undefined,
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
    if (!Number.isInteger(displayRef) || displayRef <= 0) return;
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

function getUsedAndSortedAnnotations(message: AgentMessage) {
  const annotations = message.citationAnnotations ?? [];
  if (!annotations.length) return [];

  const content = message.content || "";
  const markerRegex = /\[(\d+(?:\s*,\s*\d+)*)\]/g;
  const usedRefs = new Set<number>();
  let match;
  while ((match = markerRegex.exec(content)) !== null) {
    citationRefs(match[1]).forEach((ref) => usedRefs.add(ref));
  }

  const filtered = annotations.filter((annotation) => usedRefs.has(Number(annotation.ref)));
  const toDisplay = filtered.length > 0 ? filtered : annotations;

  return toDisplay.slice().sort((a, b) => Number(a.ref) - Number(b.ref));
}


function citationQuote(annotation: CitationAnnotation) {
  return cleanDisplayText(annotation.quote || "").replace(/\[\[PAGE_BREAK\]\]/g, " ").replace(/\s+/g, " ").trim();
}

function citationDocumentName(annotation: CitationAnnotation) {
  return cleanDisplayText(annotation.filename || annotation.document_id || annotation.contract_id || "Referenced document");
}

function citedSegmentsForAnnotation(message: AgentMessage, annotation: CitationAnnotation) {
  const segments = message.citationDetails?.cited_segments ?? [];
  if (!segments.length) return [];

  if (annotation.segment_id) {
    const exactSegment = segments.find((segment) => segment.id === annotation.segment_id);
    if (exactSegment) return [exactSegment];
  }

  const quote = citationQuote(annotation).toLowerCase();
  if (quote) {
    const matchingSegment = segments.find((segment) => {
      const segmentText = cleanDisplayText(segment.text).toLowerCase();
      return segmentText.includes(quote) || quote.includes(segmentText.slice(0, 80).toLowerCase());
    });
    if (matchingSegment) return [matchingSegment];
  }

  return [];
}

function isReferenceDocumentReady(document: ReferenceDocument) {
  const normalizedStatus = (document.status || "").toLowerCase();
  return (
    document.isCurrent ||
    normalizedStatus === "indexed" ||
    normalizedStatus === "success" ||
    normalizedStatus.includes("indexed")
  );
}

function reactNodeToPlainText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") {
    return String(node);
  }

  if (Array.isArray(node)) {
    return node.map(reactNodeToPlainText).join("");
  }

  if (isValidElement<{ children?: ReactNode }>(node)) {
    return reactNodeToPlainText(node.props.children);
  }

  return "";
}

function stripHiddenCitationBlock(text: string) {
  return text
    .replace(/<\s*CITATIONS\s*>[\s\S]*?<\s*\/\s*CITATIONS\s*>/gi, "")
    .replace(/<\s*CITATIONS\b[\s\S]*$/i, "")
    .trim();
}

function visibleAnswerText(text: string | null | undefined) {
  let cleaned = stripHiddenCitationBlock(cleanDisplayText(text));
  cleaned = cleaned
    .replace(
      /(?:^|\n)\s*(?:\*\*)?Sources?(?:\*\*)?:[\s\S]*?(?=(?:\n\s*(?:\*\*)?Confidence(?:\*\*)?:)|\n{2,}|$)/gi,
      "\n",
    )
    .replace(
      /(?:^|\n)\s*(?:\*\*)?Confidence(?:\*\*)?:\s*(?:\*\*)?\s*(?:high|medium|low)\.?\s*(?=\n|$)/gi,
      "\n",
    )
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return cleaned;
}

function normalizeAgentTraceData(value: unknown): AgentTraceData | undefined {
  if (Array.isArray(value)) {
    const events = value.filter((event): event is AgentTraceEvent => (
      Boolean(event) &&
      typeof event === "object" &&
      "event" in event &&
      typeof (event as AgentTraceEvent).event === "string"
    ));
    return events.length ? events : undefined;
  }

  if (value && typeof value === "object") {
    return value as Record<string, unknown>;
  }

  return undefined;
}

function traceEventsFromData(trace?: AgentTraceData): AgentTraceEvent[] {
  if (!trace) return [];
  if (Array.isArray(trace)) return trace.filter((event) => event && event.event);

  const events: AgentTraceEvent[] = [];
  const detail = trace;
  const tools = Array.isArray(detail.tools)
    ? detail.tools.map((tool) => cleanDisplayText(String(tool))).filter(Boolean)
    : [];

  if (detail.iterations || detail.retrieval_count || detail.citation_count || detail.task_type || detail.provider) {
    events.push({
      event: "legacy_agent_trace",
      detail: {
        task_type: detail.task_type,
        provider: detail.provider,
        iterations: detail.iterations,
        retrieval_count: detail.retrieval_count,
        citation_count: detail.citation_count,
      },
    });
  }

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

  if (detail.fallback_reason) {
    events.push({
      event: "middleware:VerifierFallback",
      detail: {
        reason: detail.fallback_reason,
      },
    });
  }

  return events;
}

function compactStepDetail(...parts: Array<string | number | null | undefined>) {
  return parts
    .map((part) => cleanDisplayText(part == null ? "" : String(part)))
    .filter(Boolean)
    .join(" · ");
}

function traceText(value: unknown) {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return cleanDisplayText(String(value));
  }

  if (Array.isArray(value)) {
    return value.map(traceText).filter(Boolean).join(" ");
  }

  if (value && typeof value === "object") {
    const detail = value as Record<string, unknown>;
    return firstTraceText(detail, ["summary", "summary_text", "content", "text", "message"]);
  }

  return "";
}

function firstTraceText(detail: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = traceText(detail[key]);
    if (value) return value;
  }
  return "";
}

function isSummarizationTrace(event: AgentTraceEvent) {
  return cleanDisplayText(event.event || "").toLowerCase() === "middleware:summarizationmiddleware";
}

function summarizationTraceText(event: AgentTraceEvent) {
  if (!isSummarizationTrace(event)) return "";

  const detail = event.detail ?? {};
  const summary = firstTraceText(detail, [
    "summary",
    "summary_text",
    "conversation_summary",
    "new_summary",
    "content",
    "text",
    "message",
  ]);
  if (summary) return summary;

  const reason = firstTraceText(detail, ["reason"]);
  const isDisabled = detail.enabled === false || detail.enforced === false;
  if (isDisabled || /not configured|disabled|not enabled|no conversation summarizer/i.test(reason)) {
    return "";
  }

  return reason;
}

function toolActionLabel(tool: string) {
  const normalized = cleanDisplayText(tool).toLowerCase();
  if (!normalized) return "";
  if (normalized.includes("search")) return "searched evidence";
  if (normalized.includes("read")) return "read evidence";
  if (normalized.includes("citation")) return "checked citations";
  if (normalized.includes("document")) return "reviewed documents";
  return normalized.replace(/_/g, " ");
}

function joinShortList(items: string[]) {
  if (items.length <= 1) return items[0] || "";
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

function traceEventText(event: AgentTraceEvent) {
  const detail = event.detail ?? {};
  return compactStepDetail(
    firstTraceText(detail, ["summary", "reason", "message"]),
    firstTraceText(detail, ["action"]),
  );
}

function buildAgentReasoningItems(message: AgentMessage): AgentReasoningItem[] {
  const events = traceEventsFromData(message.agentTrace);
  const items: AgentReasoningItem[] = [];
  const seen = new Set<string>();
  const addItem = (item: AgentReasoningItem | null | undefined) => {
    if (!item) return;
    const key = `${item.label}:${item.detail || ""}`;
    if (seen.has(key)) return;
    seen.add(key);
    items.push(item);
  };

  const activeActivity = (message.activity ?? []).findLast((activity) => activity.status === "running");
  if (activeActivity) {
    addItem({
      id: `activity-${activeActivity.id}`,
      label: cleanDisplayText(activeActivity.label) || "Working",
      detail: cleanDisplayText(activeActivity.detail || ""),
      status: "running",
      tone: "neutral",
    });
  }

  const failedActivity = (message.activity ?? []).find((activity) => activity.status === "error");
  if (failedActivity) {
    addItem({
      id: `activity-error-${failedActivity.id}`,
      label: "Needs attention",
      detail: compactStepDetail(failedActivity.label, failedActivity.detail),
      status: "error",
      tone: "attention",
    });
  }

  const summaryEvent = events.find((event) => summarizationTraceText(event));
  const summaryText = summaryEvent ? summarizationTraceText(summaryEvent) : "";
  if (summaryText) {
    addItem({
      id: "summary-middleware",
      label: "Used summary",
      detail: summaryText,
      status: "done",
      tone: "neutral",
    });
  }

  const blockedMiddleware = events.find((event) => {
    const eventName = cleanDisplayText(event.event || "");
    const decision = cleanDisplayText(String(event.detail?.decision ?? "")).toLowerCase();
    return eventName.startsWith("middleware:") && (decision === "deny" || decision === "reject");
  });
  if (blockedMiddleware) {
    addItem({
      id: "middleware-blocked",
      label: "Guardrail reviewed",
      detail: traceEventText(blockedMiddleware) || cleanDisplayText(blockedMiddleware.event || "").replace("middleware:", ""),
      status: "error",
      tone: "attention",
    });
  }

  const toolActions = Array.from(new Set(
    events
      .filter((event) => event.event === "react_tool_observation" && event.detail?.status !== "error")
      .map((event) => toolActionLabel(String(event.detail?.tool ?? "")))
      .filter(Boolean),
  ));
  if (toolActions.length) {
    const displayed = toolActions.slice(0, 3);
    addItem({
      id: "evidence-tools",
      label: "Checked evidence",
      detail: `${joinShortList(displayed)}${toolActions.length > displayed.length ? `, plus ${toolActions.length - displayed.length} more` : ""}`,
      status: "done",
      tone: "success",
    });
  } else {
    const legacyTrace = events.find((event) => event.event === "legacy_agent_trace");
    const retrievalCount = legacyTrace?.detail?.retrieval_count;
    if (retrievalCount) {
      addItem({
        id: "legacy-evidence",
        label: "Checked evidence",
        detail: `${retrievalCount} evidence snippet${String(retrievalCount) === "1" ? "" : "s"} reviewed`,
        status: "done",
        tone: "success",
      });
    }
  }

  const sourceCount = message.citationAnnotations?.length ?? 0;
  if (sourceCount || message.citation) {
    addItem({
      id: "sources",
      label: "Prepared sources",
      detail: sourceCount ? `${sourceCount} source${sourceCount === 1 ? "" : "s"}` : "Source note ready",
      status: "done",
      tone: "success",
    });
  }

  if (message.workflow?.status === "waiting_approval") {
    addItem({
      id: "approval",
      label: "Needs approval",
      detail: message.workflow.approval?.title || "Human review needed before taking action",
      status: "done",
      tone: "attention",
    });
  }

  const hasAnswer = Boolean(visibleAnswerText(message.content));
  if (hasAnswer) {
    addItem({
      id: "answer",
      label: "Drafted answer",
      detail: sourceCount ? "Answer is ready with citations." : "Answer is ready.",
      status: "done",
      tone: "neutral",
    });
  }

  return items.slice(0, 5);
}

function reasoningSubtitle(items: AgentReasoningItem[]) {
  const runningItem = items.find((item) => item.status === "running");
  if (runningItem) return cleanDisplayText(runningItem.detail || runningItem.label);
  if (items.some((item) => item.id === "summary-middleware")) return "used the conversation summary";
  if (items.some((item) => item.id === "evidence-tools" || item.id === "legacy-evidence")) return "checked evidence and sources";
  if (items.some((item) => item.id === "approval")) return "approval needed";
  return "reviewed the steps";
}

function storedMessageToAgentMessage(message: AgentStoredMessage, index: number): AgentMessage {
  const metadata = message.metadata ?? {};
  const citationDetails = metadata.citation_details ?? {};
  const citationAnnotations = citationAnnotationsFromDetails(citationDetails, metadata.citation_annotations || (metadata as any).citations);
  const normalizedCitations = normalizeCitationPayload(citationAnnotations);
  return {
    id: message.message_id || `${message.role}-${index}-${message.created_at || Date.now()}`,
    role: message.role === "assistant" ? "agent" : "user",
    content: normalizeCitationMarkerText(
      cleanDisplayText(message.content),
      normalizedCitations.refMap,
      normalizedCitations.markerMap,
    ),
    artifacts: metadata.artifacts,
    citation: metadata.citation,
    confidence: metadata.confidence,
    citationDetails,
    citationAnnotations: normalizedCitations.annotations,
    agentTrace: normalizeAgentTraceData(metadata.agent_trace),
    tokenUsage: metadata.token_usage,
    costUsd: metadata.cost_usd,
  };
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
}: ContractAgentPanelProps) {
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [isThinking, setIsThinking] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<AgentSession[]>([]);
  const [selectedReferenceIds, setSelectedReferenceIds] = useState<string[]>([]);
  const [selectedProvider, setSelectedProvider] = useState<AIProvider>(
    isAIProvider(aiProvider) ? aiProvider : "groq",
  );
  const [resolvingEditIds, setResolvingEditIds] = useState<Set<string>>(() => new Set());
  const [traceExpanded, setTraceExpanded] = useState(false);
  const [pendingSuggestion, setPendingSuggestion] = useState<Suggestion | null>(null);
  const [pendingWorkflowId, setPendingWorkflowId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const streamTextRef = useRef<Map<string, string>>(new Map());
  const thinkingRef = useRef<Map<string, string>>(new Map());
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
  const documentNameById = useMemo(() => {
    const names: Record<string, string> = {};
    availableReferenceDocuments.forEach((document) => {
      names[document.id] = document.name;
    });
    if (contractId) {
      names[contractId] = contractName;
    }
    return names;
  }, [availableReferenceDocuments, contractId, contractName]);
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

  const roleSummary = useMemo(() => {
    if (isProjectScope) return "Project workspace";
    const normalizedRole = roleLabel.toLowerCase();
    if (normalizedRole.includes("approver") || canApprove) return "Approval review";
    if (normalizedRole.includes("editor") || canEdit) return "Draft editing";
    if (canRequestReEdit) return "Re-edit review";
    return "Document review";
  }, [isProjectScope, roleLabel, canApprove, canEdit, canRequestReEdit]);

  const agentFetcher = async (url: string, options: RequestInit = {}) => {
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
  };

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => () => {
    streamTextRef.current.clear();
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

  const handleProviderChange = (provider: AIProvider) => {
    setSelectedProvider(provider);
    localStorage.setItem("aiProvider", provider);
    onAiProviderChange?.(provider);
  };

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
    streamTextRef.current.clear();
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

  const toggleReferenceDocument = (documentId: string) => {
    setSelectedReferenceIds((currentIds) => {
      const cleanIds = currentIds.filter((id) => id !== "all");
      return cleanIds.includes(documentId)
        ? cleanIds.filter((id) => id !== documentId)
        : [...cleanIds, documentId];
    });
  };

  const updateAgentMessage = (
    messageId: string,
    updater: (message: AgentMessage) => AgentMessage,
  ) => {
    setMessages((current) =>
      current.map((message) => (message.id === messageId ? updater(message) : message)),
    );
  };

  const upsertAgentActivity = (messageId: string, activity: AgentActivity) => {
    updateAgentMessage(messageId, (message) => {
      const currentActivities = message.activity ?? [];
      const existingIndex = currentActivities.findIndex((item) => item.id === activity.id);
      const nextActivities = [...currentActivities];
      if (existingIndex >= 0) {
        nextActivities[existingIndex] = { ...nextActivities[existingIndex], ...activity };
      } else {
        nextActivities.push(activity);
      }
      return { ...message, activity: nextActivities };
    });
  };

  const completeAgentActivity = (
    messageId: string,
    activityId: string,
    updates: Partial<AgentActivity> = {},
  ) => {
    updateAgentMessage(messageId, (message) => ({
      ...message,
      activity: (message.activity ?? []).map((activity) =>
        activity.id === activityId
          ? { ...activity, ...updates, status: "done" }
          : activity,
      ),
    }));
  };

  const finishAgentActivities = (messageId: string) => {
    updateAgentMessage(messageId, (message) => ({
      ...message,
      activity: (message.activity ?? []).map((activity) => ({ ...activity, status: "done" })),
    }));
  };

  const workflowLinkText = (reviewId?: string | null) => (
    reviewId ? `\n\n[Open tabular review](/tabular-reviews/${reviewId})` : ""
  );

  const applyDeepAgentResponse = (messageId: string, response: DeepAgentResponse) => {
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
  };

  const updateWorkflowProposal = (messageId: string, proposal: TabularReviewProposal) => {
    updateAgentMessage(messageId, (message) => (
      message.workflow
        ? { ...message, workflow: { ...message.workflow, proposal } }
        : message
    ));
  };

  const setWorkflowBusy = (messageId: string, busy: boolean) => {
    updateAgentMessage(messageId, (message) => (
      message.workflow
        ? { ...message, workflow: { ...message.workflow, busy } }
        : message
    ));
  };

  const approveWorkflow = async (messageId: string, workflow: AgentWorkflowState) => {
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
    } finally {
      setWorkflowBusy(messageId, false);
    }
  };

  const rejectWorkflow = async (messageId: string, workflow: AgentWorkflowState) => {
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
    } finally {
      setWorkflowBusy(messageId, false);
    }
  };

  const enqueueStreamText = (messageId: string, text: string) => {
    const streamDelta = String(text).replace(/\r\n?/g, "\n");
    if (!streamDelta) return;

    const nextRawText = `${streamTextRef.current.get(messageId) ?? ""}${streamDelta}`;
    streamTextRef.current.set(messageId, nextRawText);
    const displayText = cleanDisplayText(nextRawText, { trim: false });
    // Clear thinking when answer starts streaming
    thinkingRef.current.delete(messageId);
    updateAgentMessage(messageId, (message) => ({
      ...message,
      content: displayText,
      currentThinking: undefined,
    }));
  };

  const stopStreamText = (messageId: string) => {
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

  const handleSubmit = async (event?: FormEvent) => {
    event?.preventDefault();
    const value = draft.trim();
    if (!value || isThinking) return;
    const agentMessageId = `agent-${Date.now()}`;

    setMessages((current) => [
      ...current,
      { id: `user-${Date.now()}`, role: "user", content: value },
      { id: agentMessageId, role: "agent", content: "" },
    ]);
    setDraft("");
    setIsThinking(true);
    setPendingSuggestion(null);
    setPendingWorkflowId(null);

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
    } finally {
      setIsThinking(false);
      void refreshSessions();
    }
  };

  const handleQuickAction = (action: string) => {
    setDraft(action);
  };

  const downloadAgentArtifact = async (artifact: AgentArtifact) => {
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
  };

  const resolveArtifactEdit = async (
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
  };

  const resolveArtifactEditsBulk = async (
    artifact: AgentArtifact,
    edits: AgentEditAnnotation[],
    mode: "accept" | "reject",
  ) => {
    for (const edit of edits) {
      await resolveArtifactEdit(artifact, edit, mode);
    }
  };

  const handleCitationClick = (message: AgentMessage, annotation: CitationAnnotation) => {
    const confidence = message.confidence ?? "medium";
    const citedSegments = citedSegmentsForAnnotation(message, annotation);
    const citationText = citationQuote(annotation) || cleanDisplayText(citedSegments[0]?.text) || cleanDisplayText(message.citation) || "";
    const targetContractId = annotation.document_id || annotation.contract_id || annotation.doc_id || citedSegments[0]?.contract_id || null;
    const targetFilename = annotation.filename || citedSegments[0]?.contract_name || null;
    const parsedPage = typeof annotation.page === "number"
      ? annotation.page
      : typeof annotation.page === "string"
        ? Number.parseInt(annotation.page, 10)
        : null;
    const fallbackSegment: CitedSegment | null = citationText
      ? {
          id: annotation.segment_id || `citation-${annotation.ref}`,
          text: citationText,
          page: annotation.page ?? null,
          page_number: Number.isFinite(parsedPage) ? parsedPage : null,
          page_start: annotation.page_start ?? (Number.isFinite(parsedPage) ? parsedPage : null),
          page_end: annotation.page_end ?? null,
          type: "citation",
          contract_id: targetContractId,
          contract_name: targetFilename,
        }
      : null;
    const segmentsForViewer = citedSegments.length ? citedSegments : fallbackSegment ? [fallbackSegment] : undefined;
    onCitationClick?.(
      citationText,
      confidence,
      segmentsForViewer,
      targetContractId,
      targetFilename,
    );
  };

  const renderCitationButton = (
    message: AgentMessage,
    annotation: CitationAnnotation,
    keySuffix: string | number = annotation.ref,
    variant: "inline" | "source" = "inline",
  ) => {
    const quote = citationQuote(annotation);
    const page = annotation.page_start != null && annotation.page_end != null && annotation.page_end !== annotation.page_start
      ? `Page ${annotation.page_start}-${annotation.page_end}`
      : annotation.page
        ? `Page ${annotation.page}`
        : "Page not identified";
    const documentName = citationDocumentName(annotation);
    const isSourceVariant = variant === "source";
    const isUnverified = annotation.verified === false;
    const hasNoActionableData = !annotation.page && !citationQuote(annotation);

    if (hasNoActionableData) {
      return (
        <span
          key={`${message.id}-citation-${keySuffix}`}
          className={cn(
            "inline-flex items-center justify-center border font-medium cursor-default",
            isSourceVariant
              ? "h-5 min-w-5 rounded-md border-gray-100 bg-gray-100 px-1.5 text-[10px] leading-none text-gray-500"
              : "mx-0.5 h-4 min-w-4 rounded border-gray-100 bg-gray-100 px-1 align-super text-[9px] leading-none text-gray-500",
          )}
        >
          {annotation.ref}
        </span>
      );
    }

    return (
      <Tooltip key={`${message.id}-citation-${keySuffix}`}>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={() => handleCitationClick(message, annotation)}
            className={cn(
              "inline-flex items-center justify-center border font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-300",
              isUnverified
                ? isSourceVariant
                  ? "h-5 min-w-5 rounded-md border-amber-200 bg-amber-50 px-1.5 text-[10px] leading-none text-amber-700 hover:border-amber-300 hover:bg-amber-100"
                  : "mx-0.5 h-4 min-w-4 rounded border-amber-200 bg-amber-50 px-1 align-super text-[9px] leading-none text-amber-700 hover:border-amber-300 hover:bg-amber-100"
                : isSourceVariant
                  ? "h-5 min-w-5 rounded-md border-gray-200 bg-white px-1.5 text-[10px] leading-none text-gray-600 hover:border-gray-300 hover:bg-gray-50"
                  : "mx-0.5 h-4 min-w-4 rounded border-gray-200 bg-white px-1 align-super text-[9px] leading-none text-gray-600 hover:border-gray-300 hover:bg-gray-50",
            )}
            aria-label={`Open citation ${annotation.ref}`}
          >
            {annotation.ref}
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" align="center" className="max-w-[280px] rounded-md border bg-white p-3 text-left text-gray-800 shadow-lg">
          <div className="space-y-1.5">
            <div className="text-xs font-semibold text-gray-900">{documentName}</div>
            <div className="text-[11px] font-medium text-blue-700">{page}</div>
            {isUnverified && (
              <div className="text-[10px] text-amber-700 font-semibold bg-amber-50 rounded px-1.5 py-0.5 border border-amber-100 flex items-center gap-1">
                <span>⚠️</span>
                <span>Unverified source text</span>
              </div>
            )}
            {quote ? (
              <div className="max-h-24 overflow-hidden text-xs leading-5 text-gray-600">{quote}</div>
            ) : (
              <div className="text-xs text-gray-500">No quote preview available.</div>
            )}
            <div className="pt-1 text-[11px] text-gray-400">Click to open this source in the PDF.</div>
          </div>
        </TooltipContent>
      </Tooltip>
    );
  };

  const renderCitationAwareText = (
    message: AgentMessage,
    text: string,
    keyPrefix: string,
  ): ReactNode[] => {
    const annotations = message.citationAnnotations ?? [];
    const annotationsByRef = new Map(annotations.map((annotation) => [Number(annotation.ref), annotation]));
    const markerRegex = /\[(\d+(?:\s*,\s*\d+)*)\]/g;
    const parts: ReactNode[] = [];
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
        parts.push(match[0]);
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
    children: ReactNode,
    keyPrefix: string,
  ): ReactNode => Children.map(children, (child, childIndex) => {
    const childKey = `${keyPrefix}-${childIndex}`;
    if (typeof child === "string") {
      return renderCitationAwareText(message, child, childKey);
    }

    if (isValidElement<{ children?: ReactNode }>(child) && child.props.children) {
      return cloneElement(
        child as ReactElement<{ children?: ReactNode }>,
        undefined,
        renderCitationAwareChildren(message, child.props.children, childKey),
      );
    }

    return child;
  });

  const renderMarkdownMessage = (message: AgentMessage) => {
    const content = visibleAnswerText(message.content);
    if (!content) return null;

    return (
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => (
            <h3 className="mt-3 text-sm font-semibold leading-5 text-gray-950 first:mt-0">
              {renderCitationAwareChildren(message, children, "h1")}
            </h3>
          ),
          h2: ({ children }) => (
            <h3 className="mt-3 text-sm font-semibold leading-5 text-gray-950 first:mt-0">
              {renderCitationAwareChildren(message, children, "h2")}
            </h3>
          ),
          h3: ({ children }) => (
            <h4 className="mt-2.5 text-[13px] font-semibold leading-5 text-gray-950 first:mt-0">
              {renderCitationAwareChildren(message, children, "h3")}
            </h4>
          ),
          p: ({ children }) => (
            <p className="mb-2 max-w-full break-words leading-[1.65] last:mb-0">
              {renderCitationAwareChildren(message, children, "p")}
            </p>
          ),
          table: ({ children }) => (
            <div className="my-3 max-w-full overflow-x-auto rounded-md border border-gray-200 bg-white">
              <table className="min-w-[540px] table-auto divide-y divide-gray-200 text-left text-[10px] sm:text-[11px]">
                {children}
              </table>
            </div>
          ),
          thead: ({ children }) => <thead className="bg-gray-50">{children}</thead>,
          tbody: ({ children }) => <tbody className="divide-y divide-gray-100 bg-white">{children}</tbody>,
          th: ({ children }) => (
            <th scope="col" className="min-w-[120px] px-2 py-2 align-top font-semibold leading-4 text-gray-700 [overflow-wrap:anywhere] sm:px-3">
              {renderCitationAwareChildren(message, children, "th")}
            </th>
          ),
          td: ({ children }) => (
            <td className="min-w-[120px] px-2 py-2 align-top leading-5 text-gray-700 [overflow-wrap:anywhere] sm:px-3">
              {renderCitationAwareChildren(message, children, "td")}
            </td>
          ),
          ul: ({ children }) => <ul className="mb-2.5 list-disc space-y-1 pl-3.5 leading-5 last:mb-0">{children}</ul>,
          ol: ({ children }) => <ol className="mb-2.5 list-decimal space-y-1 pl-3.5 leading-5 last:mb-0">{children}</ol>,
          li: ({ children }) => {
            const checklistMatch = reactNodeToPlainText(children).match(/^\s*\[( |x|X)\]\s+(.+)$/);
            if (checklistMatch) {
              const isChecked = checklistMatch[1].toLowerCase() === "x";
              return (
                <li className="flex list-none items-start gap-1.5 pl-0">
                  <span className={cn(
                    "mt-1 flex h-4 w-4 shrink-0 items-center justify-center rounded border text-white",
                    isChecked ? "border-blue-600 bg-blue-600" : "border-gray-300 bg-white",
                  )}>
                    {isChecked ? <Check className="h-3 w-3" /> : null}
                  </span>
                  <span className="min-w-0">{renderCitationAwareText(message, checklistMatch[2], "li-check")}</span>
                </li>
              );
            }

            return (
              <li className="pl-0">
                {renderCitationAwareChildren(message, children, "li")}
              </li>
            );
          },
          input: ({ checked, type }) => (
            type === "checkbox" ? (
              <span className={cn(
                "mr-2 inline-flex h-4 w-4 translate-y-0.5 items-center justify-center rounded border text-white",
                checked ? "border-blue-600 bg-blue-600" : "border-gray-300 bg-white",
              )}>
                {checked ? <Check className="h-3 w-3" /> : null}
              </span>
            ) : null
          ),
          strong: ({ children }) => (
            <strong className="break-words font-semibold text-gray-950">
              {renderCitationAwareChildren(message, children, "strong")}
            </strong>
          ),
          em: ({ children }) => (
            <em className="text-gray-700">
              {renderCitationAwareChildren(message, children, "em")}
            </em>
          ),
          blockquote: ({ children }) => (
            <blockquote className="my-3 border-l-2 border-gray-300 pl-3 text-gray-600">
              {renderCitationAwareChildren(message, children, "quote")}
            </blockquote>
          ),
          code: ({ children }) => (
            <code className="break-words rounded bg-gray-100 px-1 py-0.5 text-[12px] text-gray-900">
              {children}
            </code>
          ),
          pre: ({ children }) => (
            <pre className="my-3 max-w-full overflow-hidden whitespace-pre-wrap break-words rounded-md bg-gray-950 p-3 text-xs leading-5 text-gray-50">
              {children}
            </pre>
          ),
          a: ({ children, href }) => {
            const safeHref = safeMarkdownHref(href);
            const renderedChildren = renderCitationAwareChildren(message, children, "a");

            return safeHref ? (
              <a
                href={safeHref}
                target="_blank"
                rel="noopener noreferrer"
                className="break-words font-medium text-blue-700 underline decoration-blue-200 underline-offset-2 hover:text-blue-900"
              >
                {renderedChildren}
              </a>
            ) : (
              <span className="break-words font-medium text-gray-800">{renderedChildren}</span>
            );
          },
        }}
      >
        {content}
      </ReactMarkdown>
    );
  };

  const renderAgentReasoning = (message: AgentMessage) => {
    const items = buildAgentReasoningItems(message);
    if (!items.length) return null;

    const hasAttention = items.some((item) => item.tone === "attention" || item.status === "error");

    if (hasAttention) {
      return (
        <div className="mb-1 flex items-center gap-1.5 text-[10px] text-amber-500">
          <span className="inline-block h-1 w-1 rounded-full bg-amber-500" />
          <span>Needs attention</span>
        </div>
      );
    }

    return null;
  };

  const renderAgentReActSteps = (message: AgentMessage, isRunning = false) => {
    const events = traceEventsFromData(message.agentTrace);
    const visibleEvents = events.filter((event) => {
      const name = event.event || "";
      if (["input_guard", "context_resolver", "persist_run", "final_response", "tool_result", "tool_start", "verify_answer"].includes(name)) return false;
      if (name.startsWith("middleware:") && String(event.detail?.decision) !== "deny" && String(event.detail?.decision) !== "reject") return false;
      return true;
    });
    if (!visibleEvents.length && !isRunning) return null;

    const steps: Array<{ iteration: number; type: "thought" | "tool_call" | "tool_result" | "answer"; toolName?: string; toolArgs?: Record<string, any>; toolResult?: { summary?: string; matches?: Array<Record<string, unknown>>; error?: string }; answerText?: string }> = [];
    visibleEvents.forEach((event) => {
      const name = event.event || "";
      if (name === "react_thought") {
        steps.push({
          iteration: steps.length + 1,
          type: "thought",
          answerText: String(event.detail?.thought || ""),
        });
      } else if (name === "react_model_step" && event.detail?.action === "tool") {
        steps.push({ iteration: steps.length + 1, type: "tool_call", toolName: String(event.detail?.tool || ""), toolArgs: event.detail as Record<string, any> });
      } else if (name === "react_tool_observation") {
        steps.push({ iteration: steps.length + 1, type: "tool_result", toolName: String(event.detail?.tool || ""), toolResult: { summary: String(event.detail?.summary || ""), matches: undefined } });
      } else if (name === "react_model_step" && event.detail?.action === "final") {
        steps.push({ iteration: steps.length + 1, type: "answer", answerText: String(event.detail?.reason || "").slice(0, 120) });
      }
    });

    const toolSteps = steps.filter((s) => s.type === "tool_call" || s.type === "tool_result");

    if (!toolSteps.length && !isRunning) return null;

    const isExpanded = traceExpanded || isRunning;

    return (
      <div className="mb-2 rounded-lg border border-gray-100 bg-gray-50/50 p-2">
        {/* Minimal inline tool indicator */}
        <div className="flex items-center justify-between text-[10px] text-gray-400">
          {isRunning ? (
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-blue-500" />
              <span className="font-medium text-gray-500">Agent executing pipeline...</span>
            </span>
          ) : (
            <span>{toolSteps.length} tool call{toolSteps.length !== 1 ? "s" : ""}</span>
          )}
          {steps.length > 0 ? (
            <button
              type="button"
              onClick={() => setTraceExpanded(!traceExpanded)}
              className="inline-flex items-center gap-0.5 text-gray-400 hover:text-gray-600 transition-colors"
            >
              {isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            </button>
          ) : null}
        </div>

        {/* Expanded detail — clean list, no badges */}
        {isExpanded && steps.length > 0 ? (
          <div className="mt-2 space-y-1.5 pl-0">
            {steps.map((step, idx) => (
              <div
                key={idx}
                className="flex items-start gap-2 text-[10px] leading-4 text-gray-500"
              >
                <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-gray-300" />
                <span className="min-w-0 flex-1 font-mono">
                  {step.type === "thought" && step.answerText && (
                    <span className="text-gray-400 italic">Thinking: {step.answerText.slice(0, 150)}...</span>
                  )}
                  {step.type === "tool_call" && (
                    <span className="text-blue-600 font-semibold flex items-center gap-1">
                      <span className="h-1.5 w-1.5 rounded-full bg-blue-500 animate-ping inline-block shrink-0" />
                      <span>Calling {step.toolName}{step.toolArgs?.args?.query ? ` (query: "${step.toolArgs.args.query}")` : ""}...</span>
                    </span>
                  )}
                  {step.type === "tool_result" && (
                    <span className="text-emerald-600 font-medium">
                      {step.toolResult?.error ? (
                        <span className="text-red-500">Error: {step.toolResult.error.slice(0, 100)}</span>
                      ) : (
                        `Observed: ${step.toolResult?.summary?.slice(0, 120) || "Executed successfully."}`
                      )}
                    </span>
                  )}
                  {step.type === "answer" && step.answerText && (
                    <span className="text-gray-400">Answer synthesis: {step.answerText.slice(0, 100)}</span>
                  )}
                </span>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    );
  };

  const renderArtifactCard = (artifact: AgentArtifact) => {
    const isKpiExtraction = artifact.artifact_kind === "kpi_extraction" || artifact.type === "kpi_extraction";
    const isRedline = Boolean(artifact.artifact_kind?.includes("redline") || artifact.applied_redline_changes?.length);
    const changeCount = artifact.applied_redline_changes?.length ?? artifact.redline_changes?.length ?? 0;
    const unmatchedCount = artifact.unmatched_redline_changes?.length ?? 0;
    const editAnnotations = artifact.edit_annotations ?? [];
    const pendingEditAnnotations = editAnnotations.filter((edit) => !edit.status || edit.status === "pending");
    const isBulkResolving = pendingEditAnnotations.some((edit) => resolvingEditIds.has(edit.edit_id));
    const artifactTitle = isKpiExtraction ? artifact.contract_name || artifact.filename : artifact.filename;
    const subtitle = isKpiExtraction
      ? `${artifact.kpi_count ?? 0} KPI rows · ${artifact.new_or_updated_count ?? 0} new/updated${artifact.extraction_method ? ` · ${artifact.extraction_method}` : ""}`
      : isRedline
      ? `Redline copy${changeCount ? ` · ${changeCount} applied` : ""}${unmatchedCount ? ` · ${unmatchedCount} unmatched` : ""}${artifact.version_number ? ` · Version ${artifact.version_number}` : ""}`
      : editAnnotations.length
        ? `Tracked edits · ${editAnnotations.filter((edit) => edit.status === "pending").length} pending${artifact.version_number ? ` · Version ${artifact.version_number}` : ""}`
      : artifact.editable || artifact.artifact_kind?.includes("contract_copy")
        ? `Editable copy${artifact.version_number ? ` · Version ${artifact.version_number}` : ""}`
        : "Generated Word document";

    return (
      <div
        key={artifact.artifact_id}
        className="mt-2 max-w-full rounded-lg border border-blue-100 bg-blue-50/60 p-2.5"
      >
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-white text-blue-700 shadow-sm">
            {isKpiExtraction ? <ShieldCheck className="h-4 w-4" /> : <FileText className="h-4 w-4" />}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-xs font-semibold text-gray-900">{artifactTitle}</div>
            <div className="text-[11px] leading-4 text-gray-500">{subtitle}</div>
          </div>
          {artifact.document_id && artifact.version_id && onArtifactCreated ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8 shrink-0 gap-1 rounded-md border-blue-200 bg-white px-2 text-xs text-blue-700 hover:bg-blue-50"
              onClick={() => onArtifactCreated(artifact)}
            >
              <PencilLine className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Open</span>
            </Button>
          ) : null}
          {artifact.download_url ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8 shrink-0 gap-1 rounded-md border-blue-200 bg-white px-2 text-xs text-blue-700 hover:bg-blue-50"
              onClick={() => downloadAgentArtifact(artifact)}
            >
              <Download className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Download</span>
            </Button>
          ) : null}
        </div>
        {isKpiExtraction ? (
          <div className="mt-2 flex flex-wrap gap-1.5 pl-10 text-[10px] font-medium text-gray-500">
            {artifact.run_id ? (
              <span className="rounded-full border border-blue-100 bg-white px-2 py-0.5">
                Run {artifact.run_id}
              </span>
            ) : null}
            {artifact.candidate_count != null ? (
              <span className="rounded-full border border-blue-100 bg-white px-2 py-0.5">
                {artifact.candidate_count} candidates checked
              </span>
            ) : null}
            {artifact.llm_error ? (
              <span className="rounded-full border border-amber-100 bg-amber-50 px-2 py-0.5 text-amber-700">
                Rule fallback used
              </span>
            ) : null}
          </div>
        ) : null}
        {isRedline && artifact.redline_changes?.length ? (
          <div className="mt-2 space-y-1.5">
            {artifact.redline_changes.slice(0, 3).map((change, index) => (
              <div key={change.finding_id || index} className="rounded-md border border-blue-100 bg-white px-2 py-1.5 text-[11px] leading-4 text-gray-600">
                <div className="font-medium text-gray-800">{change.rule_name || `Change ${index + 1}`}</div>
                <div className="mt-0.5 line-clamp-2">
                  <span className="text-red-700">{change.matched_text}</span>
                  <span className="px-1 text-gray-400">→</span>
                  <span className="text-emerald-700">{change.suggested_revision || "[delete]"}</span>
                </div>
              </div>
            ))}
          </div>
        ) : null}
        {editAnnotations.length ? (
          <div className="mt-2 space-y-1.5">
            {pendingEditAnnotations.length > 1 ? (
              <div className="flex flex-wrap items-center gap-1.5">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-7 gap-1 rounded-md px-2 text-[11px] text-emerald-700"
                  onClick={() => resolveArtifactEditsBulk(artifact, pendingEditAnnotations, "accept")}
                  disabled={isBulkResolving}
                >
                  <Check className="h-3.5 w-3.5" />
                  Accept all
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-7 gap-1 rounded-md px-2 text-[11px] text-red-700"
                  onClick={() => resolveArtifactEditsBulk(artifact, pendingEditAnnotations, "reject")}
                  disabled={isBulkResolving}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Reject all
                </Button>
              </div>
            ) : null}
            {editAnnotations.slice(0, 4).map((edit) => {
              const isPending = !edit.status || edit.status === "pending";
              const isResolving = resolvingEditIds.has(edit.edit_id);
              return (
                <div key={edit.edit_id} className="rounded-md border border-blue-100 bg-white p-2 text-[11px] leading-4 text-gray-600">
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <div className="min-w-0 truncate font-medium text-gray-800">{edit.reason || "Tracked edit"}</div>
                    <span className={cn(
                      "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize",
                      edit.status === "accepted"
                        ? "bg-emerald-50 text-emerald-700"
                        : edit.status === "rejected"
                          ? "bg-red-50 text-red-700"
                          : "bg-amber-50 text-amber-700",
                    )}>
                      {edit.status || "pending"}
                    </span>
                  </div>
                  <div className="grid gap-1.5 sm:grid-cols-2">
                    <div className="rounded border border-red-100 bg-red-50 px-2 py-1 text-red-800">
                      <div className="text-[10px] font-semibold uppercase text-red-500">Original</div>
                      <div className="line-clamp-2">{edit.deleted_text || "[empty]"}</div>
                    </div>
                    <div className="rounded border border-emerald-100 bg-emerald-50 px-2 py-1 text-emerald-800">
                      <div className="text-[10px] font-semibold uppercase text-emerald-600">Replacement</div>
                      <div className="line-clamp-2">{edit.inserted_text || "[delete]"}</div>
                    </div>
                  </div>
                  <div className="mt-2 flex items-center gap-1.5">
                    {artifact.document_id && artifact.version_id && onArtifactCreated ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-7 gap-1 rounded-md px-2 text-[11px]"
                        onClick={() => onArtifactCreated(artifact)}
                      >
                        <PencilLine className="h-3.5 w-3.5" />
                        View
                      </Button>
                    ) : null}
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-7 gap-1 rounded-md px-2 text-[11px] text-emerald-700"
                      onClick={() => resolveArtifactEdit(artifact, edit, "accept")}
                      disabled={!isPending || isResolving}
                    >
                      <Check className="h-3.5 w-3.5" />
                      Accept
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-7 gap-1 rounded-md px-2 text-[11px] text-red-700"
                      onClick={() => resolveArtifactEdit(artifact, edit, "reject")}
                      disabled={!isPending || isResolving}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Reject
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <TooltipProvider delayDuration={150}>
    <div className="relative flex h-full min-h-0 flex-col overflow-hidden bg-white">
      <div className="flex h-12 shrink-0 items-center border-b border-gray-200 bg-white px-3 sm:px-4">
        <div className="flex min-w-0 items-center gap-2">
          <Sparkles className="h-4 w-4 shrink-0 text-gray-700" />
          <div className="truncate text-sm font-semibold text-gray-800">
            {isProjectScope ? "Project Assistant" : "Contract Assistant"}
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <Info className="h-4 w-4 shrink-0 cursor-help text-gray-400 hover:text-gray-600" />
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
                className="h-8 w-8 text-gray-500 hover:text-gray-900"
                disabled={isThinking || sessions.length === 0}
                title="Chat history"
                aria-label="Chat history"
              >
                <History className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="max-h-80 w-72 overflow-y-auto">
              <DropdownMenuLabel className="text-xs text-gray-500">Chat history</DropdownMenuLabel>
              {sessions.map((session) => (
                <DropdownMenuItem
                  key={session.session_id}
                  onClick={() => loadSessionMessages(session.session_id)}
                  className="items-start gap-2"
                >
                  <Check className={cn("mt-0.5 h-4 w-4", sessionId === session.session_id ? "opacity-100" : "opacity-0")} />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{session.title || "Contract assistant chat"}</span>
                    <span className="block text-xs text-gray-500">
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
            className="h-8 w-8 text-gray-500 hover:text-gray-900"
            disabled={isThinking}
            title="New assistant chat"
            onClick={startNewSession}
          >
            <Plus className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-gray-500 hover:text-gray-900"
            disabled={isThinking || (!sessionId && messages.length === 0)}
            title="Clear assistant chat"
            onClick={clearCurrentSession}
          >
            <Trash2 className="h-4 w-4" />
          </Button>

        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-3 py-4 scroll-pb-32 sm:px-4">
        {messages.length === 0 ? (
          <div className="flex min-h-full flex-col justify-center pb-6">
            <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-white text-gray-900">
              <Sparkles className="h-7 w-7" />
            </div>
            <h2 className="mt-4 text-center font-serif text-2xl font-light text-gray-900">
              Hi, {userName || "there"}
            </h2>

            <div className="mt-6 grid gap-2">
              {quickActions.map((action) => (
                <button
                  key={action}
                  type="button"
                  onClick={() => handleQuickAction(action)}
                  className="group flex min-h-12 items-center justify-between rounded-xl border border-gray-200 bg-white px-3 py-2 text-left text-sm text-gray-700 transition-colors hover:bg-gray-50"
                >
                  <span className="min-w-0 pr-3">{action}</span>
                  <ArrowRight className="h-4 w-4 shrink-0 text-gray-400 group-hover:text-gray-700" />
                </button>
              ))}
            </div>

          </div>
        ) : (
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 overflow-x-hidden pb-28">
            {messages.map((message) => {
              const isLastAgentMessage = messages.filter((m) => m.role === "agent").slice(-1)[0]?.id === message.id;
              const isRunning = isThinking && isLastAgentMessage;

              return (
                <div
                  key={message.id}
                  className={cn(
                    "flex w-full",
                    message.role === "user" ? "justify-end" : "justify-start"
                  )}
                >
                  {message.role === "agent" ? (
                    <div className="flex min-w-0 max-w-full flex-1 items-start gap-2.5">
                      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-gray-200 bg-white shadow-sm">
                        <Sparkles className="h-3.5 w-3.5 text-gray-700" />
                      </div>
                      <div className="min-w-0 flex-1 space-y-2 text-xs leading-5 text-gray-800 sm:text-[13px]">
                        {renderAgentReasoning(message)}
                        {renderAgentReActSteps(message, isRunning)}
                        {/* Real-time thinking display */}
                        {isRunning && message.currentThinking && !visibleAnswerText(message.content) ? (
                          <div className="text-[11px] leading-5 text-gray-400 italic">
                            {message.currentThinking}
                          </div>
                        ) : null}
                        {visibleAnswerText(message.content) ? (
                          <div className={cn(
                            "contract-agent-markdown min-w-0 max-w-full overflow-hidden break-words rounded-lg bg-white",
                            isRunning && "streaming-cursor"
                          )}>
                            {renderMarkdownMessage(message)}
                          </div>
                        ) : null}
                      {message.artifacts?.length ? (
                        <div className="space-y-2">
                          {message.artifacts.map(renderArtifactCard)}
                        </div>
                      ) : null}
                      {message.citationAnnotations?.length || message.citation ? (
                        <div className="mt-2 flex min-w-0 flex-col gap-1 border-t border-gray-100 pt-2 text-[10px] text-gray-500">
                          {message.citationAnnotations?.length ? (
                            <>
                              <span className="font-semibold uppercase tracking-wider text-gray-400">Sources</span>
                              <div className="mt-1 flex min-w-0 flex-col gap-1.5">
                                {getUsedAndSortedAnnotations(message).map((annotation) => {
                                  const docName = citationDocumentName(annotation);
                                  const page = annotation.page ? `Page ${annotation.page}` : "Page not identified";
                                  return (
                                    <div key={annotation.ref} className="flex min-w-0 items-center gap-1.5">
                                      <button
                                        type="button"
                                        onClick={() => handleCitationClick(message, annotation)}
                                        className="h-4 min-w-4 shrink-0 rounded border border-gray-200 bg-white px-1 text-[9px] font-medium text-gray-600 hover:border-gray-300 hover:bg-gray-50"
                                      >
                                        {annotation.ref}
                                      </button>
                                      <span className="truncate font-medium text-gray-700" title={docName}>{docName}</span>
                                      <span className="shrink-0 text-gray-400">·</span>
                                      <span className="shrink-0 text-blue-600">{page}</span>
                                    </div>
                                  );
                                })}
                              </div>
                            </>
                          ) : message.citation ? (
                            <span className="min-w-0 break-words text-gray-400">Source: {cleanDisplayText(message.citation)}</span>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  </div>
                ) : (
                  <div className="min-w-0 max-w-[82%] break-words rounded-2xl bg-gray-100 px-4 py-3 text-sm leading-6 text-gray-900 shadow-sm">
                    {message.content}
                  </div>
                )}
              </div>
            );
          })}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-gray-100 bg-white px-3 pb-2 pt-2">
        {pendingSuggestion ? (
          <div>
            <ApprovalInput
              suggestion={pendingSuggestion}
              busy={isThinking}
              onApprove={() => {
                // Find the last agent message with a matching workflow
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
                  // No workflow found — likely a non-workflow suggestion, just dismiss
                  setPendingSuggestion(null);
                  setPendingWorkflowId(null);
                }
              }}
              onCustom={(instruction) => {
                // Reset the input, then submit the custom instruction as a new query
                setPendingSuggestion(null);
                setPendingWorkflowId(null);

                // Build the request body the same way handleSubmit does
                const followUp = `Regarding your suggestion: ${instruction}`;

                // Add user message, then trigger the stream
                const agentMessageId = `agent-${Date.now()}`;
                setMessages((current) => [
                  ...current,
                  { id: `user-${Date.now()}`, role: "user", content: followUp },
                  { id: agentMessageId, role: "agent", content: "" },
                ]);
                setIsThinking(true);

                (async () => {
                  try {
                    if (!agentBasePath || !token) {
                      throw new Error("Agent is not connected to the backend.");
                    }
                    const requestBody = {
                      message: followUp,
                      session_id: sessionId,
                      ai_provider: selectedProvider,
                      reference_contract_ids: explicitReferenceIds,
                      displayed_document: !isProjectScope && contractId
                        ? { document_id: contractId, filename: contractName }
                        : undefined,
                      attached_documents: attachedDocumentsPayload.length ? attachedDocumentsPayload : undefined,
                    };
                    const response = await apiFetch(`${agentBasePath}/query/stream`, {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify(requestBody),
                    });
                    if (!response.ok) {
                      const errorText = await response.text();
                      let detail = errorText || "Agent query failed.";
                      try { detail = JSON.parse(errorText)?.detail || detail; } catch { /* ignore */ }
                      throw new Error(detail);
                    }
                    await readAgentStream(response, agentMessageId);
                  } catch (error) {
                    updateAgentMessage(agentMessageId, (message) => ({
                      ...message,
                      content: error instanceof Error ? error.message : "Agent query failed.",
                    }));
                  } finally {
                    setIsThinking(false);
                    void refreshSessions();
                  }
                })();
              }}
            />
            <p className="pt-1.5 text-center text-[11px] leading-4 text-gray-500">AI can make mistakes. Answers are not legal advice.</p>
          </div>
        ) : (
          <>
        <form onSubmit={handleSubmit} className="rounded-2xl border border-gray-300 bg-white shadow-lg transition-all focus-within:border-gray-400 focus-within:ring-2 focus-within:ring-gray-100 focus-within:shadow-xl">
          <div className="flex items-end gap-2 px-4 pt-2.5 pb-2">
            <textarea
              rows={1}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  handleSubmit();
                }
              }}
              placeholder={isProjectScope ? "Ask a question about this project..." : "Ask a question about this contract..."}
              className="max-h-28 min-h-8 w-full resize-none overflow-hidden bg-transparent p-0 text-sm leading-6 text-gray-900 outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0 placeholder:text-gray-400"
            />
            <Button
              type="submit"
              size="icon"
              disabled={!draft.trim() || isThinking}
              className="mb-0.5 h-8 w-8 shrink-0 rounded-[10px] bg-cs-primary text-white hover:bg-cs-primary/90"
            >
              <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5 px-3 pb-2 pt-0">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 min-w-0 max-w-[170px] gap-1 rounded-full border-transparent bg-cs-primary/10 px-2 text-xs text-cs-primary shadow-none hover:bg-cs-primary/20 hover:text-cs-primary"
                    disabled={isThinking || (isProjectScope ? availableReferenceDocuments.length === 0 : availableReferenceDocuments.length <= 1)}
                    aria-label="Choose documents to refer to"
                    title="Choose documents to refer to"
                  >
                    <Link2 className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">{selectedReferenceLabel}</span>
                    <ChevronDown className="h-3 w-3 shrink-0 text-gray-400" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent side="top" align="start" className="max-h-80 w-72 overflow-y-auto">
                  <DropdownMenuLabel className="text-xs text-gray-500">Refer to</DropdownMenuLabel>
                  <DropdownMenuItem
                    onSelect={(event) => {
                      event.preventDefault();
                      setSelectedReferenceIds([]);
                    }}
                    className="items-start gap-2"
                  >
                    <Check className={cn("mt-0.5 h-4 w-4", selectedReferenceIds.length === 0 ? "opacity-100" : "opacity-0")} />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">
                        {isProjectScope ? "All project docs" : "Current contract only"}
                      </span>
                    </span>
                  </DropdownMenuItem>
                  {!isProjectScope && (
                    <DropdownMenuItem
                      onSelect={(event) => {
                        event.preventDefault();
                        setSelectedReferenceIds(["all"]);
                      }}
                      className="items-start gap-2"
                    >
                      <Check className={cn("mt-0.5 h-4 w-4", selectedReferenceIds.includes("all") ? "opacity-100" : "opacity-0")} />
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium">All project docs</span>
                      </span>
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuSeparator />
                  {availableReferenceDocuments.map((document) => {
                    const isReady = isReferenceDocumentReady(document);
                    return (
                      <DropdownMenuCheckboxItem
                        key={document.id}
                        checked={(!isProjectScope && document.isCurrent) || selectedReferenceSet.has(document.id)}
                        disabled={(!isProjectScope && document.isCurrent) || !isReady}
                        onSelect={(event) => {
                          event.preventDefault();
                          if ((isProjectScope || !document.isCurrent) && isReady) {
                            toggleReferenceDocument(document.id);
                          }
                        }}
                        className="items-start"
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-sm">{document.name}</span>
                          <span className="block text-xs text-gray-500">
                            {!isProjectScope && document.isCurrent ? "Current" : isReady ? "Indexed" : document.status || "Not indexed"}
                          </span>
                        </span>
                      </DropdownMenuCheckboxItem>
                    );
                  })}
                </DropdownMenuContent>
              </DropdownMenu>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 min-w-0 max-w-[148px] gap-1 rounded-full border-transparent bg-cs-primary/10 px-2 text-xs text-cs-primary shadow-none hover:bg-cs-primary/20 hover:text-cs-primary"
                    disabled={isThinking}
                    title="Choose model"
                    aria-label={`Choose model, currently ${providerLabel(selectedProvider)}`}
                  >
                    <Sparkles className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">Model: {providerLabel(selectedProvider)}</span>
                    <ChevronDown className="h-3 w-3 shrink-0 text-gray-400" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent side="top" align="start" className="w-56">
                  {modelOptions.map((option) => (
                    <DropdownMenuItem
                      key={option.value}
                      onClick={() => handleProviderChange(option.value)}
                      className="items-start gap-2"
                    >
                      <Check className={cn("mt-0.5 h-4 w-4", selectedProvider === option.value ? "opacity-100" : "opacity-0")} />
                      <span className="min-w-0">
                        <span className="block text-sm font-medium">{option.label}</span>
                        <span className="block text-xs text-gray-500">{option.description}</span>
                      </span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
          </div>
        </form>
        <p className="pt-1.5 text-center text-[11px] leading-4 text-gray-500">AI can make mistakes. Answers are not legal advice.</p>
        </>
        )}
      </div>
    </div>
    </TooltipProvider>
  );
}
