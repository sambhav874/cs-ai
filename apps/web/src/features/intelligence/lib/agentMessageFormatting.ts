import { isValidElement } from "react";
import type { ReactNode } from "react";
import type {
  AgentApprovalRequest,
  AgentTokenUsage,
  AgentTraceEvent,
  AgentWorkflowStatus,
  CitationAnnotation,
  TabularReviewProposal,
} from "@cs/lib/agent";

export type AIProvider = "groq" | "gemini" | "openai" | "claude";

export type AgentWorkflowState = {
  workflowId: string;
  status: AgentWorkflowStatus;
  approval?: AgentApprovalRequest | null;
  proposal?: TabularReviewProposal | null;
  busy?: boolean;
  createdReviewId?: string | null;
};

export type AgentActivity = {
  id: string;
  label: string;
  detail?: string;
  status: "running" | "done" | "error";
};

export type AgentReasoningItem = {
  id: string;
  label: string;
  detail?: string;
  status: "running" | "done" | "error";
  tone?: "attention" | "neutral" | "success";
};

export type CitedSegment = {
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

export type CitationDetails = {
  cited_segments?: CitedSegment[];
  annotations?: CitationAnnotation[];
  source_pages_display?: string;
  justification?: string;
  citation_style?: string;
};

export type ReferenceDocument = {
  id: string;
  name: string;
  status?: string;
  isCurrent?: boolean;
};

export type RedlineChangePreview = {
  finding_id?: string;
  rule_name?: string;
  matched_text?: string;
  suggested_revision?: string;
  rationale?: string;
  reason?: string;
};

export type AgentEditAnnotation = {
  edit_id: string;
  document_id?: string;
  version_id?: string;
  version_number?: number;
  deleted_text?: string;
  inserted_text?: string;
  reason?: string;
  status?: "pending" | "accepted" | "rejected" | string;
};

export type AgentArtifact = {
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

export type AgentTraceData = AgentTraceEvent[] | Record<string, unknown>;

export type AgentMessage = {
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
  /** Latest progress line the run reported, e.g. "Reading rate schedules…". */
  currentStatus?: string;
  durationMs?: number;
  /** Canned demo content, not model output. Renders a badge; never claims verification. */
  isDemo?: boolean;
};

export type AgentStoredMessage = {
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

export const quickActions = [
  "Review this contract's obligations: who must do what, by when, what evidence is required, and what happens if an obligation is missed.",
  "What are the key financial and payment obligations in this agreement?",
  "What operational obligations and compliance requirements should we track?",
];

export const modelOptions: Array<{ value: AIProvider; label: string; description: string }> = [
  { value: "groq", label: "Groq", description: "Fast contract Q&A" },
  { value: "gemini", label: "Gemini", description: "Google Gemini models" },
  { value: "openai", label: "OpenAI", description: "OpenAI chat models" },
  { value: "claude", label: "Claude", description: "Anthropic Claude models" },
];

const SAFE_MARKDOWN_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

export function safeMarkdownHref(href?: string): string | undefined {
  if (!href) return undefined;

  try {
    const parsed = new URL(href, "https://contractsense.local");
    return SAFE_MARKDOWN_PROTOCOLS.has(parsed.protocol) ? href : undefined;
  } catch {
    return undefined;
  }
}

export function isAIProvider(value: string | null | undefined): value is AIProvider {
  return modelOptions.some((option) => option.value === value);
}

export function isConfidence(value: string | null | undefined): value is "high" | "medium" | "low" {
  return value === "high" || value === "medium" || value === "low";
}

export function providerLabel(provider: AIProvider) {
  return modelOptions.find((option) => option.value === provider)?.label ?? "Groq";
}

export function confidenceLabel(confidence?: "high" | "medium" | "low") {
  if (!confidence) return "";
  return `${confidence.charAt(0).toUpperCase()}${confidence.slice(1)} confidence`;
}

export const mojibakeDisplayReplacements: Array<[RegExp, string]> = [
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

export function cleanDisplayText(text: string | null | undefined, options: { trim?: boolean } = {}) {
  if (!text) return "";

  let cleaned = String(text)
    .replace(/\r\n?/g, "\n")
    .replace(/&lt;\s*br\s*\/?\s*&gt;|<\s*br\s*\/?\s*>/gi, "\n")
    .replace(/&nbsp;/gi, " ");

  mojibakeDisplayReplacements.forEach(([bad, good]) => {
    cleaned = cleaned.replace(bad, good);
  });

  cleaned = cleaned
    .replace(/\b(?:document|contract|kpi|source|session|run|breach)\s+id\s*[:#]?\s*[a-z0-9_-]{8,}/gi, "")
    .replace(/\((?:id|ID)\s+[a-f0-9]{16,}\)/g, "")
    .replace(/\b[a-f0-9]{24}\b/gi, "")
    .replace(/\bDocument ID\b/gi, "Document")
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

export function shouldShowSources(message: AgentMessage) {
  return /\[\d+(?:\s*,\s*\d+)*\]/.test(message.content);
}

export function citationRefs(rawRefs: string) {
  return rawRefs
    .split(",")
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isInteger(value) && value > 0);
}

export function citationAnnotationsFromDetails(citationDetails: CitationDetails, rawAnnotations: unknown): CitationAnnotation[] {
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

export function normalizeCitationPayload(rawAnnotations: CitationAnnotation[]) {
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

export function normalizeCitationMarkerText(text: string, refMap: Map<number, number>, markerMap: Map<string, number> = new Map()) {
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

export function getUsedAndSortedAnnotations(message: AgentMessage) {
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

export function citationQuote(annotation: CitationAnnotation) {
  return cleanDisplayText(annotation.quote || "").replace(/\[\[PAGE_BREAK\]\]/g, " ").replace(/\s+/g, " ").trim();
}

export function citationDocumentName(annotation: CitationAnnotation) {
  return cleanDisplayText(annotation.filename || "Referenced document");
}

export function citedSegmentsForAnnotation(message: AgentMessage, annotation: CitationAnnotation) {
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

export function isReferenceDocumentReady(document: ReferenceDocument) {
  const normalizedStatus = (document.status || "").toLowerCase();
  return (
    document.isCurrent ||
    normalizedStatus === "indexed" ||
    normalizedStatus === "success" ||
    normalizedStatus.includes("indexed")
  );
}

export function reactNodeToPlainText(node: ReactNode): string {
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

export function stripHiddenCitationBlock(text: string) {
  return text
    .replace(/<\s*CITATIONS\s*>[\s\S]*?<\s*\/\s*CITATIONS\s*>/gi, "")
    .replace(/<\s*CITATIONS\b[\s\S]*$/i, "")
    .trim();
}

export function visibleAnswerText(text: string | null | undefined) {
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

export function normalizeAgentTraceData(value: unknown): AgentTraceData | undefined {
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

export function traceEventsFromData(trace?: AgentTraceData): AgentTraceEvent[] {
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

export function compactStepDetail(...parts: Array<string | number | null | undefined>) {
  return parts
    .map((part) => cleanDisplayText(part == null ? "" : String(part)))
    .filter(Boolean)
    .join(" · ");
}

export function traceText(value: unknown): string {
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

export function firstTraceText(detail: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = traceText(detail[key]);
    if (value) return value;
  }
  return "";
}

export function isSummarizationTrace(event: AgentTraceEvent) {
  return cleanDisplayText(event.event || "").toLowerCase() === "middleware:summarizationmiddleware";
}

export function summarizationTraceText(event: AgentTraceEvent) {
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

export function toolActionLabel(tool: string) {
  const normalized = cleanDisplayText(tool).toLowerCase();
  if (!normalized) return "";
  if (normalized.includes("search")) return "searched evidence";
  if (normalized.includes("read")) return "read evidence";
  if (normalized.includes("citation")) return "checked citations";
  if (normalized.includes("document")) return "reviewed documents";
  return normalized.replace(/_/g, " ");
}

export function joinShortList(items: string[]) {
  if (items.length <= 1) return items[0] || "";
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

export function traceEventText(event: AgentTraceEvent) {
  const detail = event.detail ?? {};
  return compactStepDetail(
    firstTraceText(detail, ["summary", "reason", "message"]),
    firstTraceText(detail, ["action"]),
  );
}

export function buildAgentReasoningItems(message: AgentMessage): AgentReasoningItem[] {
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

export function reasoningSubtitle(items: AgentReasoningItem[]) {
  const runningItem = items.find((item) => item.status === "running");
  if (runningItem) return cleanDisplayText(runningItem.detail || runningItem.label);
  if (items.some((item) => item.id === "summary-middleware")) return "used the conversation summary";
  if (items.some((item) => item.id === "evidence-tools" || item.id === "legacy-evidence")) return "checked evidence and sources";
  if (items.some((item) => item.id === "approval")) return "approval needed";
  return "reviewed the steps";
}

export function storedMessageToAgentMessage(message: AgentStoredMessage, index: number): AgentMessage {
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
