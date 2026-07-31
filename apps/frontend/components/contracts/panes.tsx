'use client'
import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useRouter, useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import dynamic from "next/dynamic";
import { motion } from "framer-motion";
import ReactMarkdown from "react-markdown";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose, DialogTrigger,
} from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import { TooltipProvider, TooltipTrigger, TooltipContent, Tooltip } from "@/components/ui/tooltip";
import ContractAgentPanel from "@/components/ContractAgentPanel";
import LoadingScreen from "@/components/loader";

const DocumentEditor = dynamic(
  () => import("@/components/editor/DocumentEditor").then((m) => ({ default: m.DocumentEditor })),
  { ssr: false },
);
import KpiSourceFieldMapper from "@/components/kpis/KpiSourceFieldMapper";
import { Badge } from "@/components/ui/badge";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";
import { getDefaultKpiSourceMappings } from "@/lib/kpi-source-fields";
import type { KpiSourceFieldMapping } from "@/lib/kpi-source-fields";
import { apiDownload, apiFetch, apiUploadWithProgress } from "@/lib/apiClient";
import {
  FileText, AlertCircle, Clock, RefreshCw, Check, X, Send, ArrowLeft, Loader2,
  ClipboardEdit, ClipboardCheck, ClipboardX, Search, Upload, ChevronUp, ChevronDown,
  Download,
  Eye,
  FolderOpen,
  Menu,
  Plus,
  Trash2,
  UploadCloud,
  BarChart3,
  CheckCircle2,
  ExternalLink,
  Info,
  BookOpen,
  Play,
  PanelLeftClose,
  PanelLeftOpen,
  Copy,
} from "lucide-react";

import { useAccountContext } from '@/app/context/AccountContext';

import "@/styles/pdf-viewer.css";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

type QuestionAnswerConfidence = 'high' | 'medium' | 'low';
const PROJECT_SELECTION_KEY = "dashboardSelectedProject";
const USER_KPI_SOURCE_TYPES = new Set(["csv", "xlsx", "json", "xml", "manual_attestation"]);

interface QuestionAnswerFromAPI {
  question: string;
  answer: string;
  confidence: 'high' | 'medium' | 'low' | 'hihg';
  citation: string;
  reason: string;
  citation_details: {
    text: string;
    source: string;
    segment_ids: string[];
  } | null;
  is_edited?: boolean;
  edited_by_user_id?: string | null;
  edited_at_timestamp?: string | null;
  edited_by_user_name?: string | null;
  edited_reason?: string | null;
}

interface CitedSegment {
  id: string;
  text: string;
  page_number?: number | null;
  page?: number | string | null;
  type: string;
  contract_id?: string | null;
  contract_name?: string | null;
}

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const searchTermsFromRawValue = (rawSearchValue: string): string[] => {
  try {
    const segments = JSON.parse(rawSearchValue) as CitedSegment[];
    if (Array.isArray(segments)) {
      return segments.map((segment) => segment.text).filter(Boolean);
    }
  } catch {
    return [rawSearchValue];
  }
  return [rawSearchValue];
};

const cleanCitationTerm = (value: string) =>
  value
    .replace(/<[^>]*>/g, " ")
    .replace(/[*_#>`|=-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const buildFlexibleTermRegex = (rawTerm: string): RegExp | null => {
  const words = cleanCitationTerm(rawTerm).split(/\s+/).filter(Boolean).slice(0, 80);
  if (!words.length) return null;
  return new RegExp(words.map(escapeRegExp).join("[\\W_]{0,500}"), "gi");
};

const renderPlainTextWithHighlights = (
  content: string,
  rawSearchValue: string,
  activeHighlightIndex: number | null,
) => {
  const colors = ["bg-yellow-200", "bg-blue-200", "bg-green-200", "bg-purple-200", "bg-pink-200"];
  const ranges: { start: number; end: number; index: number }[] = [];

  searchTermsFromRawValue(rawSearchValue).forEach((term, termIndex) => {
    const regex = buildFlexibleTermRegex(term);
    if (!regex) return;

    let match: RegExpExecArray | null;
    while ((match = regex.exec(content)) !== null) {
      if (match.index < regex.lastIndex) {
        ranges.push({ start: match.index, end: regex.lastIndex, index: termIndex });
      }
      if (regex.lastIndex === match.index) regex.lastIndex++;
    }
  });

  if (!ranges.length) {
    return escapeHtml(content).replace(/\r?\n/g, "<br />");
  }

  const nonOverlappingRanges: typeof ranges = [];
  ranges
    .sort((a, b) => a.start - b.start || b.end - a.end)
    .forEach((range) => {
      const lastAcceptedRange = nonOverlappingRanges[nonOverlappingRanges.length - 1];
      if (!lastAcceptedRange || range.start >= lastAcceptedRange.end) {
        nonOverlappingRanges.push(range);
      }
    });

  let html = "";
  let lastIndex = 0;
  nonOverlappingRanges.forEach((range) => {
    const colorClass = colors[range.index % colors.length];
    const isActive = activeHighlightIndex === range.index || (activeHighlightIndex === null && nonOverlappingRanges.length === 1);
    const highlightClass = isActive
      ? `${colorClass} text-black px-1 py-0.5 rounded-sm border-2 border-red-500 shadow-lg`
      : `${colorClass} text-black px-0.5 rounded-sm border border-${colorClass.replace("bg-", "")}`;

    html += escapeHtml(content.slice(lastIndex, range.start));
    html += `<mark class="${highlightClass}" data-segment-index="${range.index}" data-active="${isActive}">`;
    html += escapeHtml(content.slice(range.start, range.end));
    html += "</mark>";
    lastIndex = range.end;
  });
  html += escapeHtml(content.slice(lastIndex));

  return html.replace(/\r?\n/g, "<br />");
};

interface ContractAnalysisFromAPI {
  version: number | "Last Saved Draft" | "Last Saved";
  createdAt: string;
  results: QuestionAnswerFromAPI[];
  categories?: { name: string; questions: string[]; }[];
  isLastSave?: boolean;
  report_info?: {
    generated_by: string;
    report_content: any;
    is_draft?: boolean;
    generated_at: string;
  };
}

interface WorkflowRoles {
  editorUserId: string | null;
  approverUserId: string | null;
}

interface ReEditRequestInfo {
  requestedByUserId: string;
  reason: string;
  requestedAt: string;
  denialReason?: string;
  reviewedByUserId?: string;
  reviewedAt?: string;
}


interface FullContractData {
  _id: string;
  id?: string;
  contract_name: string;
  projectId?: string | null;
  project_id?: string | null;
  project_name?: string | null;
  project?: { _id?: string; name?: string | null } | null;
  uploaded_by: string;
  uploaded_at: string;
  ownerType: 'user' | 'team';
  ownerId: string;
  status: string;
  workflowRoles?: WorkflowRoles | null;
  uploaded_by_name?: string;
  submittedBy?: string | null;
  approvedOrRejectedBy?: string | null;
  rejectedReason?: string | null;
  reEditRequest?: ReEditRequestInfo | null;
  upload?: { status: string; };
  index?: { status: string; content?: string; html_content?: string; updated_at?: string; contract_name?: string; };
  summarize?: { status: string; summary?: string; updated_at?: string; contract_name?: string; };
  process?: {
    status: string;
    results: ContractAnalysisFromAPI[];
    dynamic_results?: any[];
    lastSave?: {
      savedAt: string;
      data: ContractAnalysisFromAPI;
    } | null;
    updated_at?: string;
  };
  contract_think?: string | null;
  page_count?: number;
  file_id?: string;
  mongodb_save_error?: string | null;
}

interface ProjectSummary {
  _id: string;
  name: string;
  description?: string | null;
}

interface WorkspaceDocumentSummary {
  _id: string;
  contract_name: string;
  status?: string;
  projectId?: string | null;
  uploaded_by?: string;
  uploader_name?: string | null;
  uploaded_at?: string;
  page_count?: number;
}

interface AgentDocumentVersionSummary {
  version_id: string;
  version_number: number;
  filename: string;
  content_type?: string;
  byte_count?: number;
  change_summary?: string;
  created_at?: string;
  download_url?: string;
  redline_changes?: RedlineChangePreview[];
  applied_redline_changes?: RedlineChangePreview[];
  unmatched_redline_changes?: RedlineChangePreview[];
}

interface AgentEditAnnotation {
  edit_id: string;
  document_id?: string;
  version_id?: string;
  version_number?: number;
  deleted_text?: string;
  inserted_text?: string;
  reason?: string;
  status?: "pending" | "accepted" | "rejected" | string;
}

interface AgentDocumentSummary {
  document_id: string;
  title?: string;
  filename: string;
  draft_type?: string;
  artifact_kind?: string;
  current_version_id: string;
  current_version_number: number;
  updated_at?: string;
  versions?: AgentDocumentVersionSummary[];
  redline_changes?: RedlineChangePreview[];
  applied_redline_changes?: RedlineChangePreview[];
  unmatched_redline_changes?: RedlineChangePreview[];
  pending_edit_count?: number;
}

interface AgentDocumentPreview {
  document_id: string;
  version_id: string;
  version_number: number;
  filename: string;
  body_text?: string;
  download_url?: string;
  document?: AgentDocumentSummary;
  redline_changes?: RedlineChangePreview[];
  applied_redline_changes?: RedlineChangePreview[];
  unmatched_redline_changes?: RedlineChangePreview[];
  edit_annotations?: AgentEditAnnotation[];
}

interface RedlineChangePreview {
  finding_id?: string;
  rule_name?: string;
  matched_text?: string;
  suggested_revision?: string;
  rationale?: string;
  reason?: string;
}

interface ContractKPIValueCandidate {
  type?: string;
  raw?: string;
  value?: string | number | null;
  unit?: string | null;
  start?: number;
  end?: number;
}

interface ContractKPICitation {
  doc_id?: string;
  document_id?: string;
  filename?: string;
  page?: number | string | null;
  page_start?: number | null;
  page_end?: number | null;
  quote?: string;
  segment_id?: string;
  chunk_id?: string;
  chunk_level?: string;
  section_path?: string;
  char_start?: number | null;
  char_end?: number | null;
}

interface ContractKPI {
  kpi_id: string;
  schema_version?: number;
  run_id?: string;
  contract_id: string;
  document_id?: string;
  project_id?: string | null;
  contract_name?: string;
  name: string;
  description?: string;
  kpi_type?: string;
  party?: string | null;
  operator?: string;
  value?: string | number | null;
  unit?: string | null;
  value_min?: number | null;
  value_max?: number | null;
  definition?: string | null;
  formula?: string | null;
  rule_type?: string | null;
  target_value?: string | number | null;
  threshold_min?: number | null;
  threshold_max?: number | null;
  direction?: string | null;
  period_type?: string | null;
  evaluation_window?: string | null;
  frequency?: string | null;
  effective_start?: string | null;
  effective_end?: string | null;
  target_schedule?: Array<Record<string, any>>;
  checkpoint_dates?: string[];
  grace_period_days?: number | null;
  lookback_window_days?: number | null;
  business_owner?: string | null;
  technical_owner?: string | null;
  responsible_party?: string | null;
  source_config_id?: string | null;
  source_config_status?: string | null;
  source_requirements?: Record<string, any>;
  field_mappings?: Array<Record<string, any>>;
  evaluation_rule?: Record<string, any>;
  post_extraction_ai_allowed?: boolean;
  value_candidates?: ContractKPIValueCandidate[];
  consequence_value?: number | null;
  consequence_unit?: string | null;
  aggregation_type?: string | null;
  trigger_condition?: string | null;
  section?: string | null;
  section_path?: string | null;
  structural_path?: string | null;
  section_tags?: string[];
  chunk_id?: string | null;
  chunk_level?: string | null;
  clause_text?: string;
  quote?: string;
  source_quote?: string;
  citation?: ContractKPICitation;
  citation_details?: ContractKPICitation;
  page_start?: number | null;
  page_end?: number | null;
  char_start?: number | null;
  char_end?: number | null;
  confidence?: number;
  confidence_reason?: string;
  needs_review?: boolean;
  status?: string;
  is_recommended?: boolean;
  recommendation_reason?: string | null;
  tracking_status?: string | null;
  is_tracked?: boolean;
  last_tracking_backfill?: {
    created_breach_count?: number;
    skipped_count?: number;
    actual_count?: number;
    created_breach_ids?: string[];
    skipped?: Array<Record<string, any>>;
    evaluated_at?: string;
    error?: string;
  } | null;
  tracked_at?: string | null;
  tracked_by?: string | null;
  notes?: string | null;
  remediation?: string | null;
  remediation_sla?: string | null;
  contact_email?: string | null;
  breach_email_template?: string | null;
  extraction_method?: string;
  updated_at?: string;
  custom_attributes?: Record<string, any>;
  rule?: {
    rule_type?: string;
    operator?: string;
    unit?: string;
    period_type?: string;
    evaluation_window?: string;
    aggregation?: string;
    spec?: Record<string, any>;
  };
  consequence?: {
    value?: number | null;
    unit?: string | null;
    trigger_condition?: string | null;
    remediation?: string | null;
    remediation_sla?: string | null;
    contact_email?: string | null;
  };
  identity?: Record<string, any>;
  governance?: Record<string, any>;
  error_budget?: any;
}

interface ContractKPISummary {
  total?: number;
  by_type?: Record<string, number>;
  by_status?: Record<string, number>;
  financial_summary?: Array<Record<string, any>>;
  key_dates?: Array<Record<string, any>>;
  penalties?: Array<Record<string, any>>;
}

interface ContractKPIActual {
  actual_id: string;
  kpi_id: string;
  contract_id: string;
  value?: string | number | null;
  unit?: string | null;
  source?: string | null;
  metadata?: Record<string, any>;
  timestamp?: string;
  created_at?: string;
}

interface ContractKPIBreach {
  breach_id: string;
  kpi_id: string;
  contract_id: string;
  actual_value?: string | number | null;
  actual_unit?: string | null;
  expected_value?: string | number | null;
  operator?: string | null;
  is_breach?: boolean;
  status?: string;
  remediation?: string | null;
  remediation_sla?: string | null;
  send_remediation_email?: boolean;
  breach_email_draft?: string | null;
  breach_email_to?: string | null;
  breach_email_recipient_source?: {
    source?: string | null;
    confidence?: string | null;
    reason?: string | null;
    matched_party?: string | null;
    role?: string | null;
    context?: string | null;
  } | null;
  email_flagged_at?: string | null;
  email_flagged_by?: string | null;
  source_kpi?: {
    name?: string;
    quote?: string;
    page_start?: number | null;
    contract_name?: string;
  };
  created_at?: string;
}

interface KPISourceCatalogItem {
  source_type: string;
  label: string;
  family?: string;
  auth_types?: string[];
  cadences?: string[];
  visibility?: "user" | "platform" | string;
  managed_by?: string;
  runtime_status?: string;
  config_location?: string;
  enabled_for_contract_users?: boolean;
  description?: string;
}

interface KPISourceConfig {
  source_config_id: string;
  contract_id: string;
  project_id?: string | null;
  display_name: string;
  source_type: string;
  connector_family?: string;
  status?: string;
  enabled?: boolean;
  auth_type?: string;
  credential_ref?: string | null;
  auth_header?: string | null;
  webhook_secret_ref?: string | null;
  endpoint?: string | null;
  signed_url?: string | null;
  method?: string;
  headers?: Record<string, any>;
  query_params?: Record<string, any>;
  body?: any;
  timeout_seconds?: number | null;
  schedule?: {
    cadence?: string;
    timezone?: string;
    start_at?: string | null;
  };
  next_run_at?: string | null;
  last_run_at?: string | null;
  last_success_at?: string | null;
  last_error?: string | null;
  schema_fields?: Array<Record<string, any>>;
  sample_payload?: any;
  record_path?: string | null;
  data_path?: string | null;
  file_format?: string | null;
  bucket?: string | null;
  object_key?: string | null;
  prefix?: string | null;
  region?: string | null;
  field_mappings?: Array<Record<string, any>>;
  validation_rules?: Array<Record<string, any>>;
  source_requirements?: Record<string, any>;
  dedupe_key?: string | null;
  watermark_field?: string | null;
  watermark_value?: string | null;
  kpi_ids?: string[];
  kpi_bindings?: KPISourceBinding[];
  last_fetch_status?: Record<string, any>;
  notes?: string | null;
  updated_at?: string;
}

interface KPISourceBinding {
  binding_id?: string;
  kpi_id: string;
  enabled?: boolean;
  match_rule?: Record<string, any> | null;
  field_mappings?: Array<Record<string, any>>;
  aggregation?: string | null;
  unit_override?: string | null;
  dedupe_key_override?: string | null;
  watermark_field_override?: string | null;
  validation_status?: string | Record<string, any> | null;
}

interface KPISourceFetchRun {
  run_id: string;
  source_config_id: string;
  contract_id?: string;
  source_type?: string;
  status?: string;
  trigger_type?: string;
  started_at?: string;
  finished_at?: string;
  records_fetched?: number;
  records_accepted?: number;
  records_skipped?: number;
  created_actual_count?: number;
  created_breach_count?: number;
  deferred_evaluation_count?: number;
  errors?: string[];
  skipped_rows?: Array<Record<string, any>>;
  normalized_preview?: Array<Record<string, any>>;
  watermark_before?: any;
  watermark_after?: any;
  ai_used?: boolean;
}

interface UserInDB {
  _id: string;
  username: string;
  email: string;
  ownedAccountId?: string | null;
  teamIds?: string[];
}

const PDFViewerDynamic = dynamic(() => import('@/components/PDFViewer/Sample'), {
  ssr: false, // This is the key part! It disables server-side rendering for this component.
  loading: () => (
    <div className="flex h-96 w-full items-center justify-center rounded-lg bg-gray-200">
      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      <p className="ml-2 text-gray-600">Loading PDF Viewer...</p>
    </div>
  ), // Optional: Show a loading message while the component loads.
});

const ContractLoadingScreen = () => <LoadingScreen />;

function truncateMiddle(value: string, maxLength = 38) {
  if (!value || value.length <= maxLength) return value;
  const head = Math.ceil((maxLength - 3) / 2);
  const tail = Math.floor((maxLength - 3) / 2);
  return `${value.slice(0, head)}...${value.slice(value.length - tail)}`;
}

function titleCase(value?: string | null) {
  if (!value) return "Not specified";
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function getKpiCitation(kpi: ContractKPI): ContractKPICitation {
  return kpi.citation || kpi.citation_details || {};
}

function getKpiQuote(kpi: ContractKPI) {
  return getKpiCitation(kpi).quote || kpi.source_quote || kpi.quote || kpi.clause_text || "";
}

function isKpiTracked(kpi?: ContractKPI | null) {
  const trackingStatus = String(kpi?.tracking_status || "").toLowerCase();
  return Boolean(kpi?.is_tracked || trackingStatus === "tracked" || trackingStatus === "active");
}

function isKpiRecommended(kpi?: ContractKPI | null) {
  const trackingStatus = String(kpi?.tracking_status || "").toLowerCase();
  return Boolean(kpi?.is_recommended || trackingStatus === "recommended");
}

function formatKpiValue(kpi: ContractKPI) {
  const ruleType = String(kpi.rule_type || kpi.rule?.rule_type || "").toLowerCase();
  const spec = kpi.rule?.spec || {};

  if (ruleType === "qualitative") {
    return "Qualitative (Human Judgment)";
  }
  if (ruleType === "tiered") {
    const tiers = spec.tiers || kpi.target_schedule || [];
    if (tiers.length > 0) {
      return `Tiered (${tiers.length} Slabs: ${tiers.map((t: any) => `${t.level || 'Tier'}: ${t.value ?? '?'}`).slice(0, 2).join(', ')}${tiers.length > 2 ? '...' : ''})`;
    }
    return "Tiered SLA Matrix";
  }
  if (ruleType === "composite") {
    const formula = spec.formula || kpi.formula;
    return formula ? `Formula: ${formula}` : "Composite Metric";
  }
  if (ruleType === "deadline") {
    const grace = spec.grace_days ?? kpi.grace_period_days ?? 0;
    return `Deadline Deliverable${grace > 0 ? ` (+${grace}d grace)` : ''}`;
  }
  if (ruleType === "error_budget") {
    const budget = spec.budget ?? kpi.error_budget;
    return `Error Budget: ${budget ?? 'Specified'} ${kpi.unit || ''}`.trim();
  }

  const parts: string[] = [];
  if (kpi.operator && kpi.operator !== "=" && kpi.operator !== "specified") parts.push(kpi.operator.replace(/_/g, " "));
  if (kpi.value_min != null || kpi.value_max != null || spec.min != null || spec.max != null) {
    parts.push(`${spec.min ?? kpi.value_min ?? "?"}${spec.max != null || kpi.value_max != null ? ` - ${spec.max ?? kpi.value_max}` : ""}`);
  } else if (spec.target != null || kpi.value != null || kpi.target_value != null) {
    parts.push(String(spec.target ?? kpi.value ?? kpi.target_value));
  }
  if (kpi.unit && kpi.unit !== "number") parts.push(kpi.unit);
  return parts.length ? parts.join(" ") : "Not specified";
}

function formatConsequence(kpi: ContractKPI) {
  const parts: string[] = [];
  const val = kpi.consequence_value ?? kpi.consequence?.value;
  const unit = kpi.consequence_unit || kpi.consequence?.unit;
  if (val != null) parts.push(String(val));
  if (unit) parts.push(unit);
  if (kpi.aggregation_type || kpi.rule?.aggregation) parts.push(`(${titleCase(kpi.aggregation_type || kpi.rule?.aggregation || "")})`);
  return parts.length ? parts.join(" ") : "Not specified";
}

function formatConfidence(confidence?: number) {
  if (confidence == null) return "Unknown confidence";
  const normalized = confidence <= 1 ? confidence * 100 : confidence;
  return `${Math.round(normalized)}% confidence`;
}

function buildClientKpiSummary(kpis: ContractKPI[]): ContractKPISummary {
  const byType: Record<string, number> = {};
  const byStatus: Record<string, number> = {};
  const financialSummary: Array<Record<string, any>> = [];
  const keyDates: Array<Record<string, any>> = [];
  const penalties: Array<Record<string, any>> = [];

  kpis.forEach((kpi) => {
    const type = kpi.kpi_type || "obligation";
    const status = kpi.status || "draft";
    byType[type] = (byType[type] || 0) + 1;
    byStatus[status] = (byStatus[status] || 0) + 1;

    const candidates = kpi.value_candidates || [];
    const hasDate = candidates.some((candidate) => candidate.type === "date" || candidate.type === "duration");
    const hasMoney = candidates.some((candidate) => candidate.type === "money" || candidate.type === "percentage");
    if (["timeline", "notice", "termination", "milestone"].includes(type) || hasDate) {
      keyDates.push({ kpi_id: kpi.kpi_id, name: kpi.name, value: kpi.value, unit: kpi.unit, page_start: kpi.page_start });
    }
    if (type === "penalty" || kpi.consequence_value != null) {
      penalties.push({
        kpi_id: kpi.kpi_id,
        name: kpi.name,
        consequence_value: kpi.consequence_value,
        consequence_unit: kpi.consequence_unit,
        aggregation_type: kpi.aggregation_type,
      });
    }
    if (type === "financial" || hasMoney) {
      financialSummary.push({ kpi_id: kpi.kpi_id, name: kpi.name, value: kpi.value, unit: kpi.unit, page_start: kpi.page_start });
    }
  });

  return {
    total: kpis.length,
    by_type: byType,
    by_status: byStatus,
    financial_summary: financialSummary,
    key_dates: keyDates,
    penalties,
  };
}

function kpiStatusClass(status?: string) {
  switch (status) {
    case "approved": return "border-green-200 bg-green-50 text-green-700";
    case "ignored": return "border-border bg-muted/30 text-muted-foreground";
    case "needs_review": return "border-amber-200 bg-amber-50 text-amber-700";
    default: return "border-blue-100 bg-blue-50 text-blue-700";
  }
}


type KpiDashboardPanel = "review" | "integrations" | "flags" | "logs";

type ContractPerformanceDashboardPaneProps = {
  kpis: ContractKPI[];
  summary: ContractKPISummary | null;
  actuals: ContractKPIActual[];
  breaches: ContractKPIBreach[];
  sourceCatalog: KPISourceCatalogItem[];
  sourceConfigs: KPISourceConfig[];
  sourceFetchRuns: Record<string, KPISourceFetchRun[]>;
  sourceActionResults: Record<string, any>;
  isLoading: boolean;
  isExtracting: boolean;
  isUploadingActuals: boolean;
  isMonitoringLoading: boolean;
  isSourceLoading: boolean;
  onExtract: () => void;
  onUploadActuals: (file: File) => void | Promise<void>;
  onRefresh: () => void | Promise<void>;
  onStatusChange: (kpi: ContractKPI, status: string) => void;
  onAcceptAll: () => void | Promise<void>;
  onTrackRecommended: () => void | Promise<void>;
  onTrackKpi: (kpi: ContractKPI) => void | Promise<void>;
  onFlagRemediationEmail: (breach: ContractKPIBreach) => ContractKPIBreach | null | void | Promise<ContractKPIBreach | null | void>;
  onUpdateKpi: (kpi: ContractKPI, updates: Partial<ContractKPI>) => Promise<ContractKPI | null | void> | ContractKPI | null | void;
  onCitationClick: (kpi: ContractKPI) => void;
  onCreateSourceConfig: (source: KPISourceCatalogItem) => void | Promise<void>;
  onUpdateSourceConfig: (config: KPISourceConfig, updates: Partial<KPISourceConfig>) => void | Promise<KPISourceConfig | undefined>;
  onMapTrackedKpis: (config: KPISourceConfig) => void | Promise<void>;
  onTestSourceConfig: (config: KPISourceConfig, payload?: any) => void | Promise<void>;
  onFetchSourceConfig: (config: KPISourceConfig, payload?: any) => void | Promise<void>;
  onLoadFetchRuns: (config: KPISourceConfig) => void | Promise<void>;
  onRefreshSources: () => void | Promise<void>;
};

function toNumber(value?: string | number | null) {
  if (value == null || value === "") return null;
  const parsed = Number(String(value).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function dashboardMoney(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(Math.max(0, value));
}

function kpiDisplayCode(kpi: ContractKPI, index: number) {
  const nameCode = kpi.name.match(/\b(?:KPI|SLA|TIM|FIN|PEN)-?\d+[A-Z]?\b/i)?.[0];
  if (nameCode) return nameCode.toUpperCase().replace(/([A-Z]+)(\d)/, "$1-$2");
  return `KPI-${String(index + 1).padStart(3, "0")}`;
}

function sourceBindingId(sourceConfigId: string, kpiId: string, index: number) {
  const seed = `${sourceConfigId}:${kpiId}:${index}`;
  let hash = 0;
  for (let offset = 0; offset < seed.length; offset += 1) {
    hash = ((hash << 5) - hash + seed.charCodeAt(offset)) | 0;
  }
  return `bind_${Math.abs(hash).toString(16)}`;
}

function normalizeKpiSourceMappings(fieldMappings?: Array<Record<string, any>>): KpiSourceFieldMapping[] {
  return (fieldMappings || [])
    .filter((mapping) => mapping && typeof mapping === "object")
    .map((mapping) => ({ ...mapping }));
}

function mappingForKpiField(fieldMappings: Array<Record<string, any>> | undefined, kpiField: string) {
  return (fieldMappings || []).find((mapping) => (
    String(mapping.kpi_field || mapping.target_field || mapping.target || mapping.field || "") === kpiField
  ));
}

function sourceFieldForKpiField(fieldMappings: Array<Record<string, any>> | undefined, kpiField: string) {
  const mapping = mappingForKpiField(fieldMappings, kpiField);
  return String(mapping?.source_field || mapping?.source || "");
}

function setKpiSourceMapping(
  fieldMappings: Array<Record<string, any>> | undefined,
  kpiField: string,
  sourceField: string,
  transform = "string",
) {
  const mappings = normalizeKpiSourceMappings(fieldMappings);
  const index = mappings.findIndex((mapping) => (
    String(mapping.kpi_field || mapping.target_field || mapping.target || mapping.field || "") === kpiField
  ));
  const normalizedSourceField = sourceField.trim();
  if (!normalizedSourceField) {
    if (index >= 0) mappings.splice(index, 1);
    return mappings;
  }
  const next = { kpi_field: kpiField, source_field: normalizedSourceField, transform };
  if (index >= 0) mappings[index] = { ...mappings[index], ...next };
  else mappings.push(next);
  return mappings;
}

export function kpiBindingsForSource(config: KPISourceConfig, kpis: ContractKPI[]) {
  const hasExplicitBindings = Array.isArray(config.kpi_bindings) && config.kpi_bindings.length > 0;
  const bindingByKpiId = new Map<string, KPISourceBinding>();
  (config.kpi_bindings || []).forEach((binding) => {
    if (binding?.kpi_id) bindingByKpiId.set(String(binding.kpi_id), binding);
  });
  const legacyKpiIds = new Set((config.kpi_ids || []).map(String));
  return kpis.map((kpi, index) => {
    const existing = bindingByKpiId.get(kpi.kpi_id);
    return {
      binding_id: existing?.binding_id || sourceBindingId(config.source_config_id, kpi.kpi_id, index + 1),
      kpi_id: kpi.kpi_id,
      enabled: existing ? existing.enabled !== false : !hasExplicitBindings && legacyKpiIds.has(kpi.kpi_id),
      match_rule: existing?.match_rule || {},
      field_mappings: normalizeKpiSourceMappings(existing?.field_mappings),
      aggregation: existing?.aggregation || kpi.aggregation_type || "latest",
      unit_override: existing?.unit_override || null,
      dedupe_key_override: existing?.dedupe_key_override || null,
      watermark_field_override: existing?.watermark_field_override || null,
      validation_status: existing?.validation_status || null,
    } satisfies KPISourceBinding;
  });
}

function enabledKpiIdsForSource(config: KPISourceConfig, kpis?: ContractKPI[]) {
  const bindings = kpis ? kpiBindingsForSource(config, kpis) : (config.kpi_bindings || []);
  const ids = bindings.filter((binding) => binding.enabled !== false).map((binding) => String(binding.kpi_id));
  if (ids.length || (config.kpi_bindings || []).length) return Array.from(new Set(ids));
  return Array.from(new Set((config.kpi_ids || []).map(String).filter(Boolean)));
}

function bindingEffectiveMappings(config: KPISourceConfig, binding?: KPISourceBinding | null) {
  return binding?.field_mappings?.length ? binding.field_mappings : config.field_mappings || [];
}

function kpiBindingStatus(config: KPISourceConfig, binding: KPISourceBinding, enabledCount: number) {
  if (binding.enabled === false) return "disabled";
  const mappings = bindingEffectiveMappings(config, binding);
  if (!sourceFieldForKpiField(mappings, "actual_value") && !sourceFieldForKpiField(mappings, "value")) return "missing_value_field";
  if (!sourceFieldForKpiField(mappings, "timestamp")) return "missing_timestamp";
  if (enabledCount > 1 && !Object.keys(binding.match_rule || {}).length && !binding.field_mappings?.length) return "no_match_rule";
  return "valid";
}

function bindingStatusLabel(status: string) {
  if (status === "missing_value_field") return "Missing value";
  if (status === "missing_timestamp") return "Missing timestamp";
  if (status === "no_match_rule") return "Needs rule";
  return titleCase(status);
}

function dashboardSourceForKpi(kpi: ContractKPI, index: number, sourceConfig?: KPISourceConfig) {
  if (sourceConfig) {
    return {
      name: sourceConfig.display_name || titleCase(sourceConfig.source_type),
      cadence: titleCase(sourceConfig.schedule?.cadence || "manual").toUpperCase(),
      type: `${titleCase(sourceConfig.connector_family || sourceConfig.source_type)} evidence stream`,
      tone: sourceConfig.last_error ? "red" : sourceConfig.enabled ? "emerald" : "amber",
      lastSuccess: sourceConfig.last_success_at,
      status: sourceConfig.status,
    };
  }
  if (!isKpiTracked(kpi) && !isKpiRecommended(kpi)) {
    return { name: "Inactive", cadence: "DEFERRED", type: "Pending source", tone: "gray" };
  }
  const haystack = `${kpi.name} ${kpi.description || ""} ${kpi.kpi_type || ""}`.toLowerCase();
  if (haystack.includes("incident") || haystack.includes("ticket") || haystack.includes("service")) {
    return { name: "ServiceNow Incident Queue", cadence: "REAL TIME", type: "ITSM evidence stream", tone: "blue" };
  }
  if (haystack.includes("flight") || haystack.includes("dispatch") || haystack.includes("delivery") || index % 4 === 0) {
    return { name: "SAP S/4HANA Dispatch", cadence: "HOURLY", type: "ERP evidence stream", tone: "emerald" };
  }
  if (haystack.includes("sensor") || haystack.includes("iot") || haystack.includes("temperature") || index % 4 === 1) {
    return { name: "AIDX / IoT REST Feed", cadence: "HOURLY", type: "REST evidence stream", tone: "cyan" };
  }
  return { name: "SFTP Ops Workbooks", cadence: "ON FILE ARRIVAL", type: "File feed evidence stream", tone: "amber" };
}

function breachSeverity(breach: ContractKPIBreach, kpi?: ContractKPI) {
  if (!breach.is_breach) return "OK";
  const exposure = Math.abs(toNumber(kpi?.consequence_value) || 0);
  if (exposure >= 50000) return "Critical";
  if (exposure >= 10000) return "High";
  if (exposure > 0) return "Medium";
  return "Low";
}

function severityClass(severity: string) {
  switch (severity) {
    case "Critical": return "border-red-200 bg-red-50 text-red-700";
    case "High": return "border-orange-200 bg-orange-50 text-orange-700";
    case "Medium": return "border-amber-200 bg-amber-50 text-amber-700";
    case "Low": return "border-blue-200 bg-blue-50 text-blue-700";
    default: return "border-emerald-200 bg-emerald-50 text-emerald-700";
  }
}

function buildEscalationDraft(breach: ContractKPIBreach, kpi?: ContractKPI) {
  const expected = `${breach.operator || kpi?.operator || ""} ${breach.expected_value ?? kpi?.value_min ?? kpi?.value ?? "contract threshold"} ${kpi?.unit || breach.actual_unit || ""}`.trim();
  const actual = `${breach.actual_value ?? "not reported"} ${breach.actual_unit || kpi?.unit || ""}`.trim();
  return [
    `Breach alert for ${kpi?.name || breach.source_kpi?.name || breach.kpi_id}`,
    "",
    `Expected: ${expected}`,
    `Actual: ${actual}`,
    `Status: ${breach.status || (breach.is_breach ? "open" : "clear")}`,
    `Remediation: ${breach.remediation || kpi?.remediation || "Please provide corrective action and owner update."}`,
  ].join("\n");
}

export function ContractPerformanceDashboardPane({
  kpis,
  summary,
  actuals,
  breaches,
  sourceCatalog,
  sourceConfigs,
  sourceFetchRuns,
  sourceActionResults,
  isLoading,
  isExtracting,
  isUploadingActuals,
  isMonitoringLoading,
  isSourceLoading,
  onExtract,
  onUploadActuals,
  onRefresh,
  onStatusChange,
  onAcceptAll,
  onTrackRecommended,
  onTrackKpi,
  onFlagRemediationEmail,
  onCitationClick,
  onCreateSourceConfig,
  onUpdateSourceConfig,
  onMapTrackedKpis,
  onTestSourceConfig,
  onFetchSourceConfig,
  onLoadFetchRuns,
  onRefreshSources,
}: ContractPerformanceDashboardPaneProps) {
  const [activePanel, setActivePanel] = useState<KpiDashboardPanel>("review");
  const actualsInputRef = useRef<HTMLInputElement | null>(null);
  const effectiveSummary = useMemo(() => summary || buildClientKpiSummary(kpis), [summary, kpis]);
  const sortedKpis = useMemo(() => (
    [...kpis].sort((a, b) => (
      (a.page_start || 9999) - (b.page_start || 9999) ||
      (a.kpi_type || "").localeCompare(b.kpi_type || "") ||
      a.name.localeCompare(b.name)
    ))
  ), [kpis]);
  const kpiById = useMemo(() => new Map(sortedKpis.map((kpi) => [kpi.kpi_id, kpi])), [sortedKpis]);
  const trackedKpis = useMemo(() => sortedKpis.filter(isKpiTracked), [sortedKpis]);
  const visibleBreaches = useMemo(() => (
    breaches.filter((breach) => isKpiTracked(kpiById.get(breach.kpi_id)))
  ), [breaches, kpiById]);
  const activeBreaches = visibleBreaches.filter((breach) => breach.is_breach && breach.status !== "resolved");
  const highCriticalCount = activeBreaches.filter((breach) => ["Critical", "High"].includes(breachSeverity(breach, kpiById.get(breach.kpi_id)))).length;
  const exposure = activeBreaches.reduce((total, breach) => total + Math.abs(toNumber(kpiById.get(breach.kpi_id)?.consequence_value) || 0), 0);
  const approvedCount = sortedKpis.filter((kpi) => kpi.status === "approved").length;
  const pendingCount = sortedKpis.filter((kpi) => !["approved", "ignored"].includes(kpi.status || "")).length;
  const removedCount = sortedKpis.filter((kpi) => kpi.status === "ignored").length;
  const deferredCount = sortedKpis.filter((kpi) => kpi.status !== "ignored" && !isKpiTracked(kpi)).length;
  const acceptAllCount = sortedKpis.filter((kpi) => kpi.status !== "approved" && kpi.status !== "ignored").length;
  const recommendedTrackCount = sortedKpis.filter((kpi) => isKpiRecommended(kpi) && !isKpiTracked(kpi) && kpi.status !== "ignored").length;
  const complianceRate = trackedKpis.length
    ? Math.max(0, Math.round(((trackedKpis.length - activeBreaches.length) / trackedKpis.length) * 1000) / 10)
    : 0;
  const contractName = sortedKpis[0]?.contract_name || visibleBreaches[0]?.source_kpi?.contract_name || "Selected contract";

  const uploadActuals = async (file: File) => {
    try {
      await onUploadActuals(file);
      setActivePanel("logs");
    } finally {
      if (actualsInputRef.current) actualsInputRef.current.value = "";
    }
  };
  const openActualsUpload = () => actualsInputRef.current?.click();

  const exportDashboard = () => {
    const payload = {
      contract_name: contractName,
      summary: effectiveSummary,
      kpis: sortedKpis,
      breaches: visibleBreaches,
      actuals,
      exported_at: new Date().toISOString(),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${contractName.replace(/[^a-z0-9]+/gi, "_").toLowerCase()}_performance_dashboard.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const panelCounts = {
    review: sortedKpis.length,
    integrations: sourceConfigs.length || trackedKpis.length,
    flags: activeBreaches.length,
    logs: actuals.length,
  };

  return (
    <div className="min-h-full bg-neutral-50 text-gray-950">
      <input
        ref={actualsInputRef}
        type="file"
        accept=".csv,.json"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void uploadActuals(file);
        }}
      />

      <div className="sticky top-0 z-20 border-b border-border bg-white/95 backdrop-blur">
        <div className="px-4 py-3">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
            <div className="flex min-w-0 items-start gap-3">
              <button
                type="button"
                onClick={() => window.history.back()}
              className="mt-0.5 rounded-md border border-border bg-white p-2 text-muted-foreground hover:bg-muted/50 hover:text-gray-900"
              title="Back"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-base font-semibold leading-6 text-gray-950">KPI Tracking</h2>
                  <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                    {trackedKpis.length} active
                  </span>
                  {activeBreaches.length > 0 && (
                    <span className="rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-red-700">
                      {activeBreaches.length} open flag{activeBreaches.length === 1 ? "" : "s"}
                    </span>
                  )}
                </div>
                <button type="button" className="mt-1 inline-flex max-w-full items-center gap-1 text-sm font-medium text-gray-600 hover:text-gray-950">
                  <span className="truncate">{contractName}</span>
                  <ChevronDown className="h-3.5 w-3.5 shrink-0" />
                </button>
                <div className="mt-2 grid max-w-xl grid-cols-4 gap-1.5">
                  <MiniStatusTile label="Total" value={sortedKpis.length} />
                  <MiniStatusTile label="Tracked" value={trackedKpis.length} tone="emerald" />
                  <MiniStatusTile label="Deferred" value={deferredCount} tone="amber" />
                  <MiniStatusTile label="Actuals" value={actuals.length} tone="blue" />
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 xl:justify-end">
              <Button type="button" variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={openActualsUpload} disabled={isUploadingActuals || isExtracting || sortedKpis.length === 0}>
                {isUploadingActuals ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                Upload Actuals
              </Button>
              <Button type="button" variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={exportDashboard} disabled={!sortedKpis.length}>
                <Download className="h-3.5 w-3.5" />
                Export
              </Button>
              <Button type="button" variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={onRefresh} disabled={isLoading || isMonitoringLoading}>
                <RefreshCw className={`h-3.5 w-3.5 ${isLoading || isMonitoringLoading ? "animate-spin" : ""}`} />
                Refresh
              </Button>
              <Button type="button" size="sm" className="h-8 gap-1.5 bg-cs-primary text-xs text-white hover:bg-cs-primary/90" onClick={activePanel === "review" ? onExtract : () => setActivePanel("integrations")} disabled={isExtracting || (activePanel !== "review" && !trackedKpis.length)}>
                {isExtracting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : activePanel === "review" ? <BarChart3 className="h-3.5 w-3.5" /> : <FolderOpen className="h-3.5 w-3.5" />}
                {activePanel === "review" ? "Extract KPIs" : "Sources"}
              </Button>
            </div>
          </div>

          <div className="mt-3 grid grid-cols-4 gap-1 rounded-lg bg-gray-100 p-1">
            {[
              { id: "review", label: "Review", icon: <ClipboardCheck className="h-3.5 w-3.5" /> },
              { id: "integrations", label: "Sources", icon: <UploadCloud className="h-3.5 w-3.5" /> },
              { id: "flags", label: "Flags", icon: <AlertCircle className="h-3.5 w-3.5" /> },
              { id: "logs", label: "Logs", icon: <BarChart3 className="h-3.5 w-3.5" /> },
            ].map((item) => (
              <DashboardTabButton
                key={item.id}
                active={activePanel === item.id}
                label={item.label}
                count={panelCounts[item.id as KpiDashboardPanel]}
                icon={item.icon}
                onClick={() => setActivePanel(item.id as KpiDashboardPanel)}
              />
            ))}
          </div>
        </div>
      </div>

      <div className="space-y-4 p-3">
        {activePanel === "review" && (
          <KpiReviewDashboardView
            kpis={sortedKpis}
            isLoading={isLoading}
            isExtracting={isExtracting}
            approvedCount={approvedCount}
            trackedCount={trackedKpis.length}
            deferredCount={deferredCount}
            pendingCount={pendingCount}
            removedCount={removedCount}
            acceptAllCount={acceptAllCount}
            recommendedTrackCount={recommendedTrackCount}
            onExtract={onExtract}
            onAcceptAll={onAcceptAll}
            onTrackRecommended={onTrackRecommended}
            onTrackKpi={onTrackKpi}
            onStatusChange={onStatusChange}
            onCitationClick={onCitationClick}
            sourceConfigs={sourceConfigs}
          />
        )}
        {activePanel === "integrations" && (
          <IntegrationsDashboardView
            kpis={sortedKpis}
            trackedKpis={trackedKpis}
            deferredCount={deferredCount}
            actuals={actuals}
            sourceCatalog={sourceCatalog}
            sourceConfigs={sourceConfigs}
            sourceFetchRuns={sourceFetchRuns}
            sourceActionResults={sourceActionResults}
            isSourceLoading={isSourceLoading}
            isUploadingActuals={isUploadingActuals}
            onOpenActualsUpload={openActualsUpload}
            onCreateSourceConfig={onCreateSourceConfig}
            onUpdateSourceConfig={onUpdateSourceConfig}
            onMapTrackedKpis={onMapTrackedKpis}
            onTestSourceConfig={onTestSourceConfig}
            onFetchSourceConfig={onFetchSourceConfig}
            onLoadFetchRuns={onLoadFetchRuns}
            onRefreshSources={onRefreshSources}
          />
        )}
        {activePanel === "flags" && (
          <ComplianceFlagsDashboardView
            breaches={visibleBreaches}
            kpis={sortedKpis}
            isLoading={isMonitoringLoading}
            onFlagRemediationEmail={onFlagRemediationEmail}
          />
        )}
        {activePanel === "logs" && (
          <PerformanceLogsDashboardView
            kpis={sortedKpis}
            trackedKpis={trackedKpis}
            actuals={actuals}
            breaches={visibleBreaches}
            activeBreaches={activeBreaches}
            complianceRate={complianceRate}
            exposure={exposure}
            highCriticalCount={highCriticalCount}
            isLoading={isMonitoringLoading}
            onNavigate={setActivePanel}
          />
        )}
      </div>
    </div>
  );
}

function MiniStatusTile({ label, value, tone = "gray" }: { label: string; value: number; tone?: "gray" | "emerald" | "amber" | "blue" }) {
  const toneClass = {
    gray: "bg-muted/30 text-gray-700",
    emerald: "bg-emerald-50 text-emerald-700",
    amber: "bg-amber-50 text-amber-700",
    blue: "bg-blue-50 text-blue-700",
  }[tone];
  return (
    <div className={`rounded-md px-2 py-1.5 ${toneClass}`}>
      <p className="text-[10px] font-semibold uppercase text-current/60">{label}</p>
      <p className="text-sm font-semibold">{value.toLocaleString()}</p>
    </div>
  );
}

function DashboardTabButton({ active, label, count, icon, onClick }: { active: boolean; label: string; count: number; icon: React.ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex min-w-0 items-center justify-center gap-1.5 rounded-md px-2 py-2 text-xs font-semibold transition-colors ${
        active ? "bg-white text-gray-950 shadow-sm" : "text-muted-foreground hover:bg-white/60 hover:text-gray-950"
      }`}
    >
      {icon}
      <span className="truncate">{label}</span>
      <span className={`ml-1 rounded-full px-1.5 py-0.5 text-[10px] ${active ? "bg-gray-100 text-gray-600" : "bg-white text-muted-foreground"}`}>
        {count}
      </span>
    </button>
  );
}

function KpiReviewDashboardView({
  kpis,
  sourceConfigs,
  isLoading,
  isExtracting,
  approvedCount,
  trackedCount,
  deferredCount,
  pendingCount,
  removedCount,
  acceptAllCount,
  recommendedTrackCount,
  onExtract,
  onAcceptAll,
  onTrackRecommended,
  onTrackKpi,
  onStatusChange,
  onCitationClick,
}: {
  kpis: ContractKPI[];
  sourceConfigs: KPISourceConfig[];
  isLoading: boolean;
  isExtracting: boolean;
  approvedCount: number;
  trackedCount: number;
  deferredCount: number;
  pendingCount: number;
  removedCount: number;
  acceptAllCount: number;
  recommendedTrackCount: number;
  onExtract: () => void;
  onAcceptAll: () => void | Promise<void>;
  onTrackRecommended: () => void | Promise<void>;
  onTrackKpi: (kpi: ContractKPI) => void | Promise<void>;
  onStatusChange: (kpi: ContractKPI, status: string) => void;
  onCitationClick: (kpi: ContractKPI) => void;
}) {
  const [expandedKpiId, setExpandedKpiId] = useState<string | null>(null);
  const sourceConfigByKpiId = useMemo(() => {
    const mapping = new Map<string, KPISourceConfig>();
    sourceConfigs.forEach((config) => {
      enabledKpiIdsForSource(config, kpis).forEach((kpiId) => mapping.set(kpiId, config));
      kpis
        .filter((kpi) => kpi.source_config_id === config.source_config_id)
        .forEach((kpi) => mapping.set(kpi.kpi_id, config));
    });
    return mapping;
  }, [sourceConfigs, kpis]);

  if (isLoading && !kpis.length) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((item) => (
          <div key={item} className="h-32 animate-pulse rounded-lg border border-border bg-white" />
        ))}
      </div>
    );
  }

  if (!kpis.length) {
    return (
      <div className="flex min-h-[420px] flex-col items-center justify-center rounded-lg border border-border bg-white px-6 text-center">
        <div className="mb-3 rounded-full bg-gray-100 p-3">
          <BarChart3 className="h-6 w-6 text-muted-foreground" />
        </div>
        <h3 className="text-base font-semibold text-gray-950">No KPI review yet</h3>
        <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">
          Extract contract KPIs to populate the review grid, tracking decisions, source setup, and compliance checks.
        </p>
        <Button type="button" className="mt-4 gap-2 bg-cs-primary text-white hover:bg-cs-primary/90" onClick={onExtract} disabled={isExtracting}>
          {isExtracting ? <Loader2 className="h-4 w-4 animate-spin" /> : <BarChart3 className="h-4 w-4" />}
          Extract KPIs
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <section className="rounded-lg border border-border bg-white shadow-sm">
        <div className="flex flex-col gap-3 px-4 py-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-gray-950">Review & Activate</h3>
            <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] font-semibold">
              <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-1 text-emerald-700">{approvedCount} accepted</span>
              <span className="rounded-full border border-blue-200 bg-blue-50 px-2 py-1 text-blue-700">{trackedCount} tracked</span>
              <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-1 text-amber-700">{deferredCount} deferred</span>
              <span className="rounded-full border border-border bg-muted/30 px-2 py-1 text-gray-600">{pendingCount} pending</span>
              {removedCount > 0 && <span className="rounded-full border border-border bg-white px-2 py-1 text-muted-foreground">{removedCount} removed</span>}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={onAcceptAll} disabled={acceptAllCount === 0 || isExtracting}>
              <CheckCircle2 className="h-3.5 w-3.5" />
              {acceptAllCount === 0 ? "Accepted" : "Accept All"}
            </Button>
            <Button type="button" variant="outline" size="sm" className="h-8 gap-1.5 text-xs text-emerald-700" onClick={onTrackRecommended} disabled={recommendedTrackCount === 0 || isExtracting}>
              <Play className="h-3.5 w-3.5" />
              Track Recommended
            </Button>
            <Button type="button" variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={onExtract} disabled={isExtracting}>
              {isExtracting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              Re-extract
            </Button>
          </div>
        </div>
      </section>

      <div className="grid gap-3">
        {kpis.map((kpi, index) => {
          const tracked = isKpiTracked(kpi);
          const recommended = isKpiRecommended(kpi);
          const linkedSourceConfig = sourceConfigByKpiId.get(kpi.kpi_id);
          const source = dashboardSourceForKpi(kpi, index, linkedSourceConfig);
          const expanded = expandedKpiId === kpi.kpi_id;
          const quote = getKpiQuote(kpi);
          const sourceToneClass = source.tone === "emerald"
            ? "border-emerald-200 bg-emerald-50 text-emerald-700"
            : source.tone === "red"
              ? "border-red-200 bg-red-50 text-red-700"
              : source.tone === "blue" || source.tone === "cyan"
                ? "border-blue-200 bg-blue-50 text-blue-700"
                : source.tone === "amber"
                  ? "border-amber-200 bg-amber-50 text-amber-700"
                  : "border-border bg-muted/30 text-gray-600";
          const backfillCount = Number(kpi.last_tracking_backfill?.created_breach_count || 0);

          return (
            <article
              key={kpi.kpi_id || `${kpi.name}-${index}`}
              className={`rounded-lg border bg-white shadow-sm transition-colors ${
                tracked ? "border-emerald-200" : kpi.status === "ignored" ? "border-border opacity-70" : "border-border"
              }`}
            >
              <div className="p-3">
                <div className="flex items-start gap-3">
                  <div className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border ${
                    tracked ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-border bg-muted/30 text-muted-foreground"
                  }`}>
                    {tracked ? <CheckCircle2 className="h-4 w-4" /> : <ClipboardCheck className="h-4 w-4" />}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-mono text-[11px] font-semibold text-muted-foreground">{kpiDisplayCode(kpi, index)}</span>
                      <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${kpiStatusClass(kpi.status)}`}>
                        {titleCase(kpi.status || "review")}
                      </span>
                      <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${tracked ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-amber-200 bg-amber-50 text-amber-700"}`}>
                        {tracked ? "Tracked" : "Not tracked"}
                      </span>
                      {recommended && !tracked && <span className="rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-700">Recommended</span>}
                      {kpi.rule_type === "qualitative" && <span className="rounded-full border border-purple-200 bg-purple-50 px-2 py-0.5 text-[10px] font-semibold text-purple-700">Qualitative</span>}
                      {kpi.rule_type === "tiered" && <span className="rounded-full border border-teal-200 bg-teal-50 px-2 py-0.5 text-[10px] font-semibold text-teal-700">Tiered SLA</span>}
                      {kpi.rule_type === "composite" && <span className="rounded-full border border-cyan-200 bg-cyan-50 px-2 py-0.5 text-[10px] font-semibold text-cyan-700">Composite</span>}
                      {kpi.rule_type === "error_budget" && <span className="rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[10px] font-semibold text-rose-700">Error Budget</span>}
                      {backfillCount > 0 && <span className="rounded-full border border-purple-200 bg-purple-50 px-2 py-0.5 text-[10px] font-semibold text-purple-700">{backfillCount} backfilled</span>}
                    </div>
                    <h4 className="mt-1 line-clamp-2 text-sm font-semibold leading-5 text-gray-950">{kpi.name}</h4>
                    <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{kpi.structural_path || kpi.section_path || kpi.section || "No section captured"}</p>
                  </div>

                  <button type="button" onClick={() => setExpandedKpiId(expanded ? null : kpi.kpi_id)} className="rounded-md p-1.5 text-muted-foreground hover:bg-gray-100 hover:text-gray-700">
                    <ChevronDown className={`h-4 w-4 transition-transform ${expanded ? "rotate-180" : ""}`} />
                  </button>
                </div>

                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  <KpiCardField label={kpi.rule_type === "qualitative" ? "Type" : "Threshold"} value={formatKpiValue(kpi)} />
                  <KpiCardField label="Penalty" value={formatConsequence(kpi)} />
                  <KpiCardField label="Owner" value={kpi.party || kpi.responsible_party || "Not specified"} />
                  <KpiCardField label="Source" value={`${source.name} · ${source.cadence}`} toneClass={sourceToneClass} />
                </div>

                <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap gap-1.5">
                    <button
                      type="button"
                      onClick={() => onStatusChange(kpi, kpi.status === "approved" ? "needs_review" : "approved")}
                      className={`rounded-md border px-2.5 py-1.5 text-[11px] font-semibold ${kpi.status === "approved" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-border bg-white text-gray-700 hover:bg-muted/50"}`}
                    >
                      {kpi.status === "approved" ? "Accepted" : kpi.rule_type === "qualitative" ? "Mark Reviewed" : "Accept"}
                    </button>
                    {!tracked && kpi.status !== "ignored" && (
                      <button type="button" onClick={() => onTrackKpi(kpi)} className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-[11px] font-semibold text-emerald-700 hover:bg-emerald-100">
                        <Play className="h-3 w-3" />
                        Track
                      </button>
                    )}
                    <button type="button" onClick={() => onStatusChange(kpi, "ignored")} className="rounded-md border border-border bg-white px-2.5 py-1.5 text-[11px] font-semibold text-muted-foreground hover:bg-muted/50">
                      Remove
                    </button>
                  </div>
                  <Button type="button" variant="ghost" size="sm" className="h-7 gap-1 px-2 text-[11px] text-muted-foreground" onClick={() => onCitationClick(kpi)}>
                    <ExternalLink className="h-3 w-3" />
                    Clause
                  </Button>
                </div>
              </div>

              {expanded && (
                <div className="grid gap-3 border-t border-border bg-muted/30 p-3 md:grid-cols-2">
                  <KpiDetail label="Source Text" value={quote || "No quote captured."} />
                  <KpiDetail label="Rule Spec" value={kpi.evaluation_rule?.breach_when || kpi.formula || `${kpi.operator || "specified"} ${kpi.value ?? kpi.value_min ?? "target"}`} />
                  <KpiDetail label="Window" value={`${titleCase(kpi.period_type || "per_event")} · ${titleCase(kpi.evaluation_window || "current_record")}`} />
                  <KpiDetail label="Source Mapping" value={linkedSourceConfig ? `${linkedSourceConfig.display_name} · ${titleCase(linkedSourceConfig.status || "ready")}` : "Not configured"} />
                  <KpiDetail label="Remediation" value={kpi.remediation || kpi.remediation_sla || "Not specified"} />
                  <KpiDetail label="Contact" value={kpi.contact_email || "Not specified"} />
                  {kpi.custom_attributes && Object.keys(kpi.custom_attributes).length > 0 && (
                    <div className="md:col-span-2 rounded-md border border-border bg-white p-2">
                      <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">FlexFields (Custom Attributes)</p>
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        {Object.entries(kpi.custom_attributes).map(([key, val]) => (
                          <span key={key} className="rounded-md border border-gray-200 bg-gray-50 px-2 py-0.5 text-xs text-gray-700">
                            <span className="font-semibold text-gray-900">{key}:</span> {String(val)}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </article>
          );
        })}
      </div>
    </div>
  );
}

function KpiCardField({ label, value, toneClass }: { label: string; value: string; toneClass?: string }) {
  return (
    <div className={`min-w-0 rounded-md border px-2.5 py-2 ${toneClass || "border-border bg-muted/30 text-gray-700"}`}>
      <p className="text-[10px] font-bold uppercase tracking-wide opacity-60">{label}</p>
      <p className="mt-1 truncate text-xs font-semibold">{value || "Not specified"}</p>
    </div>
  );
}

function KpiActualSourcesWorkspace({
  kpis,
  sourceCatalog,
  sourceConfigs,
  sourceFetchRuns,
  sourceActionResults,
  isSourceLoading,
  isUploadingActuals,
  onOpenActualsUpload,
  onCreateSourceConfig,
  onUpdateSourceConfig,
  onMapTrackedKpis,
  onTestSourceConfig,
  onFetchSourceConfig,
  onLoadFetchRuns,
  onRefreshSources,
}: {
  kpis: ContractKPI[];
  sourceCatalog: KPISourceCatalogItem[];
  sourceConfigs: KPISourceConfig[];
  sourceFetchRuns: Record<string, KPISourceFetchRun[]>;
  sourceActionResults: Record<string, any>;
  isSourceLoading: boolean;
  isUploadingActuals: boolean;
  onOpenActualsUpload: () => void;
  onCreateSourceConfig: (source: KPISourceCatalogItem) => void | Promise<void>;
  onUpdateSourceConfig: (config: KPISourceConfig, updates: Partial<KPISourceConfig>) => void | Promise<KPISourceConfig | undefined>;
  onMapTrackedKpis: (config: KPISourceConfig) => void | Promise<void>;
  onTestSourceConfig: (config: KPISourceConfig, payload?: any) => void | Promise<void>;
  onFetchSourceConfig: (config: KPISourceConfig, payload?: any) => void | Promise<void>;
  onLoadFetchRuns: (config: KPISourceConfig) => void | Promise<void>;
  onRefreshSources: () => void | Promise<void>;
}) {
  const [selectedSourceConfigId, setSelectedSourceConfigId] = useState<string | null>(null);
  const [sourceSetupTab, setSourceSetupTab] = useState<"upload" | "mapping" | "validation" | "fetch">("upload");
  const [samplePayloadDraft, setSamplePayloadDraft] = useState("");
  const trackedCount = kpis.filter(isKpiTracked).length;
  const userSourceCatalog = useMemo(() => (
    sourceCatalog.filter((source) => source.enabled_for_contract_users !== false && USER_KPI_SOURCE_TYPES.has(source.source_type))
  ), [sourceCatalog]);
  const userSourceConfigs = useMemo(() => (
    sourceConfigs.filter((config) => USER_KPI_SOURCE_TYPES.has(config.source_type))
  ), [sourceConfigs]);
  const platformManagedCount = Math.max(0, sourceConfigs.length - userSourceConfigs.length);
  const selectedSourceConfig = useMemo(() => (
    userSourceConfigs.find((config) => config.source_config_id === selectedSourceConfigId) || userSourceConfigs[0] || null
  ), [userSourceConfigs, selectedSourceConfigId]);
  const selectedRuns = selectedSourceConfig ? sourceFetchRuns[selectedSourceConfig.source_config_id] || [] : [];
  const selectedActionResult = selectedSourceConfig ? sourceActionResults[selectedSourceConfig.source_config_id] : null;
  const visibleKpis = useMemo(() => kpis.filter((kpi) => kpi.status !== "ignored"), [kpis]);
  const selectedBindings = selectedSourceConfig ? kpiBindingsForSource(selectedSourceConfig, visibleKpis) : [];
  const enabledBindingCount = selectedBindings.filter((binding) => binding.enabled !== false).length;

  useEffect(() => {
    if (!userSourceConfigs.length) {
      if (selectedSourceConfigId) setSelectedSourceConfigId(null);
      return;
    }
    if (!selectedSourceConfigId || !userSourceConfigs.some((config) => config.source_config_id === selectedSourceConfigId)) {
      setSelectedSourceConfigId(userSourceConfigs[0].source_config_id);
    }
  }, [userSourceConfigs, selectedSourceConfigId]);

  useEffect(() => {
    if (!selectedSourceConfig) return;
    setSamplePayloadDraft(
      selectedSourceConfig.sample_payload == null
        ? ""
        : typeof selectedSourceConfig.sample_payload === "string"
          ? selectedSourceConfig.sample_payload
          : JSON.stringify(selectedSourceConfig.sample_payload, null, 2)
    );
    void onLoadFetchRuns(selectedSourceConfig);
  }, [selectedSourceConfig?.source_config_id]);

  const updateSelectedSource = (updates: Partial<KPISourceConfig>) => {
    if (!selectedSourceConfig) return;
    void onUpdateSourceConfig(selectedSourceConfig, updates);
  };

  const updateSelectedMapping = (kpiField: string, sourceField: string, transform?: string) => {
    if (!selectedSourceConfig) return;
    const mappings = setKpiSourceMapping(
      selectedSourceConfig.field_mappings,
      kpiField,
      sourceField,
      transform || mappingForKpiField(selectedSourceConfig.field_mappings, kpiField)?.transform || "string",
    );
    updateSelectedSource({ field_mappings: mappings });
  };

  const saveSamplePayload = () => {
    if (!selectedSourceConfig) return;
    if (!samplePayloadDraft.trim()) {
      updateSelectedSource({ sample_payload: null });
      return;
    }
    const trimmed = samplePayloadDraft.trim();
    const shouldParseJson = selectedSourceConfig.source_type === "json" || trimmed.startsWith("{") || trimmed.startsWith("[");
    try {
      updateSelectedSource({ sample_payload: shouldParseJson ? JSON.parse(samplePayloadDraft) : samplePayloadDraft });
      toast({ title: "Sample payload saved", description: "Preview fetch will use this upload sample for validation." });
    } catch {
      toast({ title: "Invalid sample JSON", description: "Fix the sample payload before saving.", variant: "destructive" });
    }
  };

  const sourceStatusTone = (config: KPISourceConfig) => (
    config.last_error
      ? "border-red-200 bg-red-50 text-red-700"
      : config.status === "ready" || config.status === "mapped"
        ? "border-blue-200 bg-blue-50 text-blue-700"
        : "border-amber-200 bg-amber-50 text-amber-700"
  );

  return (
    <section className="overflow-hidden rounded-lg border border-border bg-white shadow-sm">
      <div className="flex flex-col gap-3 border-b border-border px-4 py-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="min-w-0">
          <h4 className="text-sm font-semibold text-gray-950">Actual Ingestion</h4>
          <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] font-semibold">
            <span className="rounded-full border border-blue-200 bg-blue-50 px-2 py-1 text-blue-700">{userSourceConfigs.length} source{userSourceConfigs.length === 1 ? "" : "s"}</span>
            <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-1 text-emerald-700">{trackedCount} tracked KPI{trackedCount === 1 ? "" : "s"}</span>
            {platformManagedCount > 0 && <span className="rounded-full border border-border bg-muted/30 px-2 py-1 text-gray-600">{platformManagedCount} managed</span>}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={onOpenActualsUpload} disabled={isUploadingActuals || trackedCount === 0}>
            {isUploadingActuals ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
            Upload Actuals
          </Button>
          <Button type="button" variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={onRefreshSources} disabled={isSourceLoading}>
            <RefreshCw className={`h-3.5 w-3.5 ${isSourceLoading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </div>

      <div className="grid min-h-[420px] lg:grid-cols-[240px_1fr]">
        <aside className="border-b border-border bg-muted/30 p-3 lg:border-b-0 lg:border-r">
          <div className="mb-4">
            <p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Sources</p>
            <div className="space-y-1.5">
              {userSourceConfigs.length ? userSourceConfigs.map((config) => {
                const selected = selectedSourceConfig?.source_config_id === config.source_config_id;
                return (
                  <button
                    key={config.source_config_id}
                    type="button"
                    onClick={() => setSelectedSourceConfigId(config.source_config_id)}
                    className={`w-full rounded-lg border p-2 text-left transition-colors ${selected ? "border-blue-200 bg-white shadow-sm" : "border-border bg-white/70 hover:border-gray-300 hover:bg-white"}`}
                  >
                    <div className="flex items-start gap-2">
                      <span className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md border ${sourceStatusTone(config)}`}>
                        <UploadCloud className="h-3.5 w-3.5" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs font-semibold text-gray-900">{config.display_name}</span>
                        <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">{titleCase(config.source_type)} · {enabledKpiIdsForSource(config, kpis).length} KPI{enabledKpiIdsForSource(config, kpis).length === 1 ? "" : "s"}</span>
                      </span>
                    </div>
                    <span className={`mt-2 inline-flex rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${sourceStatusTone(config)}`}>
                      {titleCase(config.last_error ? "last_fetch_failed" : config.status || "draft")}
                    </span>
                  </button>
                );
              }) : (
                <div className="rounded-lg border border-dashed border-border bg-white px-3 py-3 text-xs leading-5 text-muted-foreground">No source configured.</div>
              )}
            </div>
          </div>

          <div>
            <p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Add Source</p>
            <div className="grid gap-1.5">
              {userSourceCatalog.map((source) => (
                <button
                  key={source.source_type}
                  type="button"
                  onClick={() => onCreateSourceConfig(source)}
                  disabled={isSourceLoading}
                  className="flex items-center justify-between gap-2 rounded-lg border border-border bg-white px-2 py-2 text-left transition-colors hover:border-blue-200 hover:bg-blue-50 disabled:opacity-60"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-xs font-semibold text-gray-900">{source.label}</span>
                    <span className="block truncate text-[10px] text-muted-foreground">{titleCase(source.source_type)}</span>
                  </span>
                  <Plus className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                </button>
              ))}
            </div>
          </div>
        </aside>

        <div className="min-w-0 p-3">
          {selectedSourceConfig ? (
            <div className="space-y-3">
              <div className="flex flex-col gap-3 rounded-lg border border-border bg-muted/30 p-3 xl:flex-row xl:items-center xl:justify-between">
                <div className="min-w-0">
                  <h5 className="truncate text-sm font-semibold text-gray-950">{selectedSourceConfig.display_name}</h5>
                  <p className="mt-1 truncate text-xs text-muted-foreground">{titleCase(selectedSourceConfig.source_type)} · {titleCase(selectedSourceConfig.schedule?.cadence || "manual")} · last success {selectedSourceConfig.last_success_at || "not yet"}</p>
                </div>
                <div className="grid grid-cols-4 gap-1 rounded-md bg-gray-200/70 p-1">
                  {[
                    { id: "upload", label: "Load", icon: <Upload className="h-3.5 w-3.5" /> },
                    { id: "mapping", label: "Map", icon: <BookOpen className="h-3.5 w-3.5" /> },
                    { id: "validation", label: "Check", icon: <CheckCircle2 className="h-3.5 w-3.5" /> },
                    { id: "fetch", label: "Run", icon: <RefreshCw className="h-3.5 w-3.5" /> },
                  ].map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setSourceSetupTab(tab.id as typeof sourceSetupTab)}
                      className={`inline-flex items-center justify-center gap-1 rounded px-2 py-1.5 text-[11px] font-semibold ${sourceSetupTab === tab.id ? "bg-white text-gray-950 shadow-sm" : "text-muted-foreground hover:text-gray-800"}`}
                    >
                      {tab.icon}
                      <span className="hidden sm:inline">{tab.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {sourceSetupTab === "upload" && (
                <div className="grid gap-3 xl:grid-cols-[0.9fr_1.1fr]">
                  <div className="space-y-3 rounded-lg border border-border bg-white p-3">
                    <label className="block text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                      Display name
                      <input
                        key={`${selectedSourceConfig.source_config_id}-name`}
                        defaultValue={selectedSourceConfig.display_name}
                        onBlur={(event) => updateSelectedSource({ display_name: event.target.value })}
                        className="mt-1 h-9 w-full rounded-md border border-border px-2 text-sm font-medium text-gray-800"
                      />
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      <label className="block text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                        Type
                        <select
                          value={selectedSourceConfig.source_type}
                          onChange={(event) => updateSelectedSource({ source_type: event.target.value, file_format: event.target.value === "manual_attestation" ? "json" : event.target.value })}
                          className="mt-1 h-9 w-full rounded-md border border-border bg-white px-2 text-sm text-gray-700"
                        >
                          <option value="csv">CSV</option>
                          <option value="xlsx">Excel</option>
                          <option value="json">JSON</option>
                          <option value="xml">XML</option>
                          <option value="manual_attestation">Manual</option>
                        </select>
                      </label>
                      <label className="block text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                        Record path
                        <input
                          key={`${selectedSourceConfig.source_config_id}-record`}
                          defaultValue={selectedSourceConfig.record_path || ""}
                          onBlur={(event) => updateSelectedSource({ record_path: event.target.value })}
                          placeholder="records"
                          className="mt-1 h-9 w-full rounded-md border border-border px-2 text-sm text-gray-700"
                        />
                      </label>
                    </div>
                    <Button type="button" variant="outline" size="sm" className="h-8 w-full gap-1.5 text-xs" onClick={onOpenActualsUpload} disabled={isUploadingActuals || trackedCount === 0}>
                      {isUploadingActuals ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                      Upload Actuals File
                    </Button>
                  </div>
                  <div className="rounded-lg border border-border bg-white p-3">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Sample Payload</p>
                      <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-[11px] text-muted-foreground" onClick={saveSamplePayload}>
                        Save
                      </Button>
                    </div>
                    <Textarea
                      value={samplePayloadDraft}
                      onChange={(event) => setSamplePayloadDraft(event.target.value)}
                      placeholder='kpi_id,value,timestamp'
                      className="min-h-[148px] resize-y font-mono text-xs"
                    />
                  </div>
                </div>
              )}

              {sourceSetupTab === "mapping" && (
                <div className="rounded-lg border border-border bg-white p-3">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Field Mapping</p>
                      <p className="mt-1 text-xs text-muted-foreground">Default fields apply to each binding unless that KPI overrides them.</p>
                    </div>
                    <Link
                      href={`/contracts/${selectedSourceConfig.contract_id || ""}/kpis`}
                      className="rounded-md border border-border bg-white px-2.5 py-1.5 text-xs font-semibold text-gray-700 hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700"
                    >
                      Full Binding Editor
                    </Link>
                  </div>
                  <KpiBindingSummary
                    config={selectedSourceConfig}
                    kpis={visibleKpis}
                    bindings={selectedBindings}
                    enabledCount={enabledBindingCount}
                  />
                  <KpiSourceFieldMapper
                    sourceConfigId={selectedSourceConfig.source_config_id}
                    fieldMappings={selectedSourceConfig.field_mappings}
                    schemaFields={selectedSourceConfig.schema_fields}
                    samplePayload={selectedSourceConfig.sample_payload}
                    samplePayloadDraft={samplePayloadDraft}
                    recordPath={selectedSourceConfig.record_path}
                    trackedCount={trackedCount}
                    isSaving={isSourceLoading}
                    onUpdateMapping={updateSelectedMapping}
                    onMapTrackedKpis={() => onMapTrackedKpis(selectedSourceConfig)}
                  />
                </div>
              )}

              {sourceSetupTab === "validation" && (
                <div className="space-y-3 rounded-lg border border-border bg-white p-3">
                  <div className="grid gap-2 md:grid-cols-2">
                    <label className="block text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                      Dedupe key
                      <input key={`${selectedSourceConfig.source_config_id}-dedupe`} defaultValue={selectedSourceConfig.dedupe_key || "source_record_id"} onBlur={(event) => updateSelectedSource({ dedupe_key: event.target.value })} placeholder="source_record_id" className="mt-1 h-9 w-full rounded-md border border-border px-2 text-sm" />
                    </label>
                    <label className="block text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                      Watermark
                      <input key={`${selectedSourceConfig.source_config_id}-watermark`} defaultValue={selectedSourceConfig.watermark_field || "timestamp"} onBlur={(event) => updateSelectedSource({ watermark_field: event.target.value })} placeholder="timestamp" className="mt-1 h-9 w-full rounded-md border border-border px-2 text-sm" />
                    </label>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {["kpi_id/kpi_name", "actual_value", "timestamp", "dedupe"].map((field) => (
                      <span key={field} className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-700">{field}</span>
                    ))}
                  </div>
                  <Button type="button" variant="outline" size="sm" className="h-8 w-fit gap-1.5 text-xs" onClick={() => onTestSourceConfig(selectedSourceConfig)} disabled={isSourceLoading}>
                    {isSourceLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                    Validate
                  </Button>
                  {selectedActionResult?.skipped_rows?.length ? (
                    <div className="rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
                      {selectedActionResult.skipped_rows.length} skipped row{selectedActionResult.skipped_rows.length === 1 ? "" : "s"} in latest validation.
                    </div>
                  ) : null}
                </div>
              )}

              {sourceSetupTab === "fetch" && (
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-white p-3">
                    <Button type="button" variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={() => onTestSourceConfig(selectedSourceConfig)} disabled={isSourceLoading}>
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      Test
                    </Button>
                    <Button type="button" size="sm" className="h-8 gap-1.5 bg-cs-primary text-xs text-white hover:bg-cs-primary/90" onClick={() => onFetchSourceConfig(selectedSourceConfig)} disabled={isSourceLoading}>
                      {isSourceLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                      Fetch Now
                    </Button>
                    <span className="rounded-full border border-border bg-muted/30 px-2 py-1 text-[11px] font-semibold text-gray-600">Manual</span>
                    <span className="rounded-full border border-border bg-muted/30 px-2 py-1 text-[11px] font-semibold text-gray-600">Watermark: {selectedSourceConfig.watermark_value || "none"}</span>
                  </div>
                  <div className="grid gap-2 md:grid-cols-2">
                    {selectedRuns.length ? selectedRuns.slice(0, 6).map((run) => (
                      <div key={run.run_id} className="rounded-lg border border-border bg-white px-3 py-2">
                        <div className="flex items-center justify-between gap-2 text-xs">
                          <span className="truncate font-semibold text-gray-800">{titleCase(run.status || "run")}</span>
                          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">{run.records_accepted || 0}/{run.records_fetched || 0}</span>
                        </div>
                        <p className="mt-1 truncate text-[11px] text-muted-foreground">{run.trigger_type || "manual"} · {run.finished_at || run.started_at || "running"}</p>
                      </div>
                    )) : (
                      <div className="rounded-lg border border-dashed border-border bg-white px-3 py-3 text-xs text-muted-foreground">No fetch runs yet.</div>
                    )}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="flex min-h-[280px] items-center justify-center rounded-lg border border-dashed border-border bg-muted/30 text-sm text-muted-foreground">
              Add a source to map tracked KPI actuals.
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function KpiBindingSummary({
  config,
  kpis,
  bindings,
  enabledCount,
}: {
  config: KPISourceConfig;
  kpis: ContractKPI[];
  bindings: KPISourceBinding[];
  enabledCount: number;
}) {
  const kpiById = useMemo(() => new Map(kpis.map((kpi, index) => [kpi.kpi_id, { kpi, index }])), [kpis]);
  const visibleBindings = bindings.filter((binding) => binding.enabled !== false || binding.field_mappings?.length || Object.keys(binding.match_rule || {}).length);

  return (
    <div className="mb-3 rounded-lg border border-border bg-muted/30 p-2">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">KPI Bindings</p>
        <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${enabledCount ? "border-blue-200 bg-blue-50 text-blue-700" : "border-amber-200 bg-amber-50 text-amber-700"}`}>
          {enabledCount} enabled
        </span>
      </div>
      {visibleBindings.length ? (
        <div className="max-h-52 overflow-auto rounded-md border border-border bg-white">
          <table className="min-w-full text-left text-xs">
            <thead className="sticky top-0 bg-muted/30 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-2 py-1.5">KPI</th>
                <th className="px-2 py-1.5">Mode</th>
                <th className="px-2 py-1.5">Match</th>
                <th className="px-2 py-1.5">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {visibleBindings.map((binding) => {
                const linked = kpiById.get(binding.kpi_id);
                const status = kpiBindingStatus(config, binding, enabledCount);
                const statusClass = status === "valid"
                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                  : status === "disabled"
                    ? "border-border bg-muted/30 text-gray-600"
                    : "border-amber-200 bg-amber-50 text-amber-700";
                return (
                  <tr key={binding.binding_id || binding.kpi_id} className="align-top">
                    <td className="max-w-[240px] px-2 py-1.5">
                      <p className="font-mono text-[10px] font-semibold text-muted-foreground">
                        {linked ? kpiDisplayCode(linked.kpi, linked.index) : binding.kpi_id}
                      </p>
                      <p className="mt-0.5 truncate font-semibold text-gray-900">{linked?.kpi.name || binding.kpi_id}</p>
                    </td>
                    <td className="px-2 py-1.5">
                      <span className={`rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${binding.enabled === false ? "border-border bg-muted/30 text-gray-600" : "border-blue-200 bg-blue-50 text-blue-700"}`}>
                        {binding.enabled === false ? "Off" : binding.field_mappings?.length ? "Override" : "Defaults"}
                      </span>
                    </td>
                    <td className="px-2 py-1.5 text-[11px] text-muted-foreground">
                      {Object.keys(binding.match_rule || {}).length ? `${binding.match_rule?.field || "field"} = ${binding.match_rule?.value ?? "value"}` : "Any row"}
                    </td>
                    <td className="px-2 py-1.5">
                      <span className={`rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${statusClass}`}>
                        {bindingStatusLabel(status)}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="rounded-md border border-dashed border-border bg-white px-3 py-3 text-xs text-muted-foreground">
          No KPI bindings yet. Map tracked KPIs or open the full binding editor.
        </div>
      )}
    </div>
  );
}

function IntegrationsDashboardView({
  kpis,
  trackedKpis,
  deferredCount,
  actuals,
  sourceCatalog,
  sourceConfigs,
  sourceFetchRuns,
  sourceActionResults,
  isSourceLoading,
  isUploadingActuals,
  onOpenActualsUpload,
  onCreateSourceConfig,
  onUpdateSourceConfig,
  onMapTrackedKpis,
  onTestSourceConfig,
  onFetchSourceConfig,
  onLoadFetchRuns,
  onRefreshSources,
}: {
  kpis: ContractKPI[];
  trackedKpis: ContractKPI[];
  deferredCount: number;
  actuals: ContractKPIActual[];
  sourceCatalog: KPISourceCatalogItem[];
  sourceConfigs: KPISourceConfig[];
  sourceFetchRuns: Record<string, KPISourceFetchRun[]>;
  sourceActionResults: Record<string, any>;
  isSourceLoading: boolean;
  isUploadingActuals: boolean;
  onOpenActualsUpload: () => void;
  onCreateSourceConfig: (source: KPISourceCatalogItem) => void | Promise<void>;
  onUpdateSourceConfig: (config: KPISourceConfig, updates: Partial<KPISourceConfig>) => void | Promise<KPISourceConfig | undefined>;
  onMapTrackedKpis: (config: KPISourceConfig) => void | Promise<void>;
  onTestSourceConfig: (config: KPISourceConfig, payload?: any) => void | Promise<void>;
  onFetchSourceConfig: (config: KPISourceConfig, payload?: any) => void | Promise<void>;
  onLoadFetchRuns: (config: KPISourceConfig) => void | Promise<void>;
  onRefreshSources: () => void | Promise<void>;
}) {
  const trackedCodes = trackedKpis.map((kpi, index) => kpiDisplayCode(kpi, index));
  const kpiCodeById = useMemo(() => new Map(kpis.map((kpi, index) => [kpi.kpi_id, kpiDisplayCode(kpi, index)])), [kpis]);
  const configuredStreams = sourceConfigs.map((config) => {
    const mappedCodes = enabledKpiIdsForSource(config, kpis).map((kpiId) => kpiCodeById.get(kpiId) || kpiId).filter(Boolean);
    const detectedFields = (config.schema_fields || []).map((field) => String(field.name || field.field || "")).filter(Boolean);
    const requiredFields = (config.validation_rules || [])
      .map((rule) => String(rule.field || rule.kpi_field || ""))
      .filter(Boolean);
    return {
      eyebrow: `${titleCase(config.connector_family || config.source_type)} Evidence Stream`,
      name: config.display_name || titleCase(config.source_type),
      description: config.last_error
        ? config.last_error
        : `${titleCase(config.source_type)} source using ${titleCase(config.auth_type || "none")} auth and ${titleCase(config.schedule?.cadence || "manual")} cadence.`,
      cadence: titleCase(config.schedule?.cadence || "manual"),
      connector: titleCase(config.source_type),
      kpis: mappedCodes,
      fields: detectedFields.length ? detectedFields : (config.field_mappings || []).map((mapping) => String(mapping.source_field || mapping.source || "")).filter(Boolean),
      required: requiredFields.length ? requiredFields : ["kpi_id", "actual_value", "timestamp"],
      status: config.last_error ? "Last fetch failed" : config.enabled ? "Enabled" : titleCase(config.status || "Draft"),
      sourceConfigId: config.source_config_id,
    };
  });
  const fallbackStreams = [
    {
      eyebrow: "ERP Evidence Stream",
      name: "SAP S/4HANA Dispatch",
      description: "Operational dispatch and fulfillment readings used for time, service, and quality obligations.",
      cadence: "Hourly",
      connector: "REST API",
      kpis: trackedCodes.filter((_, index) => index % 4 === 0).slice(0, 4),
      fields: ["dispatch_id", "actual_departure", "service_level", "delay_minutes"],
      required: ["kpi_id", "value", "timestamp", "unit"],
    },
    {
      eyebrow: "ITSM Evidence Stream",
      name: "ServiceNow Incident Queue",
      description: "Incident response records for remediation SLAs, reopen counts, and escalation aging.",
      cadence: "Real time",
      connector: "Webhook",
      kpis: trackedCodes.filter((_, index) => index % 4 === 1).slice(0, 4),
      fields: ["ticket_id", "priority", "opened_at", "closed_at"],
      required: ["ticket_id", "status", "priority", "timestamp"],
    },
    {
      eyebrow: "File Feed Evidence Stream",
      name: "SFTP Ops Workbooks",
      description: "Uploaded workbook records for monthly evidence, penalties, invoices, and manual attestation.",
      cadence: "On file arrival",
      connector: "SFTP CSV",
      kpis: trackedCodes.filter((_, index) => index % 4 === 2).slice(0, 4),
      fields: ["period", "supplier", "actual_value", "threshold"],
      required: ["kpi_name", "value", "period", "source"],
    },
    {
      eyebrow: "Telemetry Evidence Stream",
      name: "AIDX / IoT REST Feed",
      description: "Sensor and telemetry values for continuous target checks and target-attainment charts.",
      cadence: "Hourly",
      connector: "REST API",
      kpis: trackedCodes.filter((_, index) => index % 4 === 3).slice(0, 4),
      fields: ["sensor_id", "reading", "location", "captured_at"],
      required: ["metric", "value", "timestamp", "unit"],
    },
  ].map((stream, index) => ({
    ...stream,
    kpis: stream.kpis.length ? stream.kpis : trackedCodes.slice(index, index + 2),
    status: "Header check passed",
    sourceConfigId: undefined,
  }));
  const streams = configuredStreams.length ? configuredStreams : fallbackStreams;

  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-border bg-white px-4 py-3 shadow-sm">
        <h3 className="text-base font-semibold text-gray-950">Integrations</h3>
        <p className="mt-1 text-sm text-gray-600">
          {trackedKpis.length} tracked KPIs mapped across {streams.filter((stream) => stream.kpis.length).length || streams.length} evidence streams. {deferredCount} extracted KPIs are approved or pending but not actively monitored yet.
        </p>
      </section>

      <KpiActualSourcesWorkspace
        kpis={kpis}
        sourceCatalog={sourceCatalog}
        sourceConfigs={sourceConfigs}
        sourceFetchRuns={sourceFetchRuns}
        sourceActionResults={sourceActionResults}
        isSourceLoading={isSourceLoading}
        isUploadingActuals={isUploadingActuals}
        onOpenActualsUpload={onOpenActualsUpload}
        onCreateSourceConfig={onCreateSourceConfig}
        onUpdateSourceConfig={onUpdateSourceConfig}
        onMapTrackedKpis={onMapTrackedKpis}
        onTestSourceConfig={onTestSourceConfig}
        onFetchSourceConfig={onFetchSourceConfig}
        onLoadFetchRuns={onLoadFetchRuns}
        onRefreshSources={onRefreshSources}
      />

      <div className="grid gap-4 xl:grid-cols-2">
        {streams.map((stream) => (
          <EvidenceStreamCard
            key={stream.name}
            stream={stream}
            actualCount={actuals.filter((actual) => {
              const haystack = `${actual.source || ""} ${actual.metadata?.source_config_id || ""} ${actual.metadata?.source_display_name || ""}`.toLowerCase();
              return haystack.includes(String(stream.sourceConfigId || "").toLowerCase()) || haystack.includes(stream.name.toLowerCase());
            }).length}
          />
        ))}
      </div>

      <section className="rounded-lg border border-border bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <h4 className="text-sm font-semibold text-gray-950">Deferred KPI Queue</h4>
          <span className="rounded-full border border-border bg-muted/30 px-2 py-1 text-[11px] font-semibold text-gray-600">{deferredCount} deferred</span>
        </div>
        <div className="grid gap-2 md:grid-cols-2">
          {kpis.filter((kpi) => !isKpiTracked(kpi)).slice(0, 6).map((kpi, index) => (
            <div key={kpi.kpi_id || index} className="rounded-md border border-border bg-muted/30 px-3 py-2">
              <p className="truncate text-xs font-semibold text-gray-900">{kpi.name}</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">{formatKpiValue(kpi)} · {titleCase(kpi.kpi_type)}</p>
            </div>
          ))}
          {!deferredCount && <p className="text-sm italic text-muted-foreground">Every accepted KPI is active in source setup.</p>}
        </div>
      </section>
    </div>
  );
}

function EvidenceStreamCard({ stream, actualCount }: { stream: any; actualCount: number }) {
  return (
    <article className="rounded-lg border border-border bg-white shadow-sm">
      <div className="border-b border-border p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">{stream.eyebrow}</p>
            <h4 className="mt-1 text-sm font-semibold text-gray-950">{stream.name}</h4>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">{stream.description}</p>
          </div>
          <span className={`rounded-full border px-2 py-1 text-[11px] font-semibold ${
            String(stream.status || "").toLowerCase().includes("failed")
              ? "border-red-200 bg-red-50 text-red-700"
              : String(stream.status || "").toLowerCase().includes("enabled")
                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                : "border-amber-200 bg-amber-50 text-amber-700"
          }`}>
            {stream.status || "Header check passed"}
          </span>
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {(stream.kpis.length ? stream.kpis : ["No tracked KPI"]).map((code: string) => (
            <span key={code} className="rounded-full border border-blue-100 bg-blue-50 px-2 py-1 text-[10px] font-semibold text-blue-700">{code}</span>
          ))}
        </div>
      </div>

      <div className="grid gap-3 p-4 md:grid-cols-2">
        <KpiDetail label="Source Contract" value={stream.connector} />
        <KpiDetail label="Polling Schedule" value={stream.cadence} />
        <KpiDetail label="Fetched Records" value={`${actualCount.toLocaleString()} records`} />
        <KpiDetail label="Source API" value={`${stream.name.replace(/\s+/g, "_").toLowerCase()} / production`} />
      </div>

      <div className="border-t border-border p-4">
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Required Headers</p>
            <div className="flex flex-wrap gap-1.5">
              {stream.required.map((field: string) => (
                <span key={field} className="rounded bg-emerald-50 px-2 py-1 text-[10px] font-semibold text-emerald-700">{field}</span>
              ))}
            </div>
          </div>
          <div>
            <p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Detected Fields</p>
            <div className="flex flex-wrap gap-1.5">
              {stream.fields.map((field: string) => (
                <span key={field} className="rounded bg-gray-100 px-2 py-1 text-[10px] font-semibold text-gray-600">{field}</span>
              ))}
            </div>
          </div>
        </div>
      </div>
    </article>
  );
}

function ComplianceFlagsDashboardView({
  breaches,
  kpis,
  isLoading,
  onFlagRemediationEmail,
}: {
  breaches: ContractKPIBreach[];
  kpis: ContractKPI[];
  isLoading: boolean;
  onFlagRemediationEmail: (breach: ContractKPIBreach) => ContractKPIBreach | null | void | Promise<ContractKPIBreach | null | void>;
}) {
  const [expandedFlagId, setExpandedFlagId] = useState<string | null>(null);
  const [alertDraft, setAlertDraft] = useState<{ to: string; subject: string; body: string; recipientSource?: ContractKPIBreach["breach_email_recipient_source"] } | null>(null);
  const kpiById = useMemo(() => new Map(kpis.map((kpi) => [kpi.kpi_id, kpi])), [kpis]);
  const orderedBreaches = useMemo(() => (
    [...breaches].sort((a, b) => {
      const aSeverity = breachSeverity(a, kpiById.get(a.kpi_id));
      const bSeverity = breachSeverity(b, kpiById.get(b.kpi_id));
      const rank: Record<string, number> = { Critical: 5, High: 4, Medium: 3, Low: 2, OK: 1 };
      return (rank[bSeverity] || 0) - (rank[aSeverity] || 0);
    })
  ), [breaches, kpiById]);

  const openEscalation = async (breach: ContractKPIBreach, kpi?: ContractKPI) => {
    const updated = await onFlagRemediationEmail(breach);
    const source = updated || breach;
    const recipient = source.breach_email_to || kpi?.contact_email || "";
    setAlertDraft({
      to: recipient,
      subject: `[BREACH ALERT] ${kpi?.name || breach.source_kpi?.name || breach.kpi_id}`,
      body: source.breach_email_draft || buildEscalationDraft(source, kpi),
      recipientSource: source.breach_email_recipient_source,
    });
  };

  if (isLoading && !orderedBreaches.length) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((item) => (
          <div key={item} className="h-24 animate-pulse rounded-lg border border-border bg-white" />
        ))}
      </div>
    );
  }

  return (
    <section className="rounded-lg border border-border bg-white shadow-sm">
      <div className="border-b border-border px-4 py-3">
        <h3 className="text-base font-semibold text-gray-950">Compliance Flags</h3>
        <p className="mt-1 text-xs text-muted-foreground">Tracked KPI breach checks sorted by impact and severity.</p>
      </div>

      <div className="grid grid-cols-[minmax(260px,1fr)_140px_130px_120px_40px] border-b border-border bg-muted/30 px-4 py-2 text-[10px] font-bold uppercase tracking-wide text-muted-foreground max-lg:hidden">
        <div>Flag / KPI</div>
        <div>Impact</div>
        <div>Status</div>
        <div>Severity</div>
        <div />
      </div>

      {!orderedBreaches.length ? (
        <div className="px-6 py-14 text-center">
          <AlertCircle className="mx-auto h-8 w-8 text-gray-300" />
          <p className="mt-3 text-sm font-medium text-muted-foreground">No compliance flags for tracked KPIs.</p>
          <p className="mt-1 text-xs text-muted-foreground">Track KPIs and upload actuals to populate this queue.</p>
        </div>
      ) : (
        <div className="divide-y divide-gray-100">
          {orderedBreaches.map((breach) => {
            const kpi = kpiById.get(breach.kpi_id);
            const severity = breachSeverity(breach, kpi);
            const expanded = expandedFlagId === breach.breach_id;
            const expected = `${breach.operator || kpi?.operator || ""} ${breach.expected_value ?? kpi?.value_min ?? kpi?.value ?? "N/A"} ${kpi?.unit || breach.actual_unit || ""}`.trim();
            const actual = `${breach.actual_value ?? "N/A"} ${breach.actual_unit || kpi?.unit || ""}`.trim();
            const exposure = Math.abs(toNumber(kpi?.consequence_value) || 0);
            return (
              <div key={breach.breach_id || `${breach.kpi_id}-${breach.created_at}`} className="bg-white">
                <div className="grid gap-3 px-4 py-3 text-sm lg:grid-cols-[minmax(260px,1fr)_140px_130px_120px_40px] lg:items-center">
                  <button type="button" onClick={() => setExpandedFlagId(expanded ? null : breach.breach_id)} className="min-w-0 text-left">
                    <div className="flex items-center gap-2">
                      <span className={`h-2.5 w-2.5 rounded-full ${breach.is_breach ? "bg-red-500" : "bg-emerald-500"}`} />
                      <p className="truncate font-semibold text-gray-950">{kpi?.name || breach.source_kpi?.name || breach.kpi_id}</p>
                    </div>
                    <p className="mt-1 truncate pl-4 text-[11px] text-muted-foreground">
                      {breach.kpi_id} · SLA: {breach.remediation_sla || kpi?.remediation_sla || "Not specified"}
                    </p>
                  </button>
                  <div className={breach.is_breach ? "font-semibold text-red-600" : "font-semibold text-emerald-700"}>
                    {exposure ? `-${dashboardMoney(exposure)}` : "No penalty"}
                  </div>
                  <select className="h-8 rounded-md border border-border bg-white px-2 text-xs font-semibold text-gray-700" defaultValue={breach.status || (breach.is_breach ? "open" : "clear")}>
                    <option value="open">Open</option>
                    <option value="in_progress">In progress</option>
                    <option value="resolved">Resolved</option>
                    <option value="clear">Clear</option>
                  </select>
                  <span className={`w-fit rounded-full border px-2 py-1 text-[11px] font-semibold ${severityClass(severity)}`}>{severity}</span>
                  <button type="button" onClick={() => setExpandedFlagId(expanded ? null : breach.breach_id)} className="rounded p-1 hover:bg-gray-100">
                    <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${expanded ? "rotate-180" : ""}`} />
                  </button>
                </div>

                {expanded && (
                  <div className="space-y-3 border-t border-border bg-muted/30 px-4 py-4">
                    <p className="text-sm text-gray-700">
                      Actual performance for this tracked KPI {breach.is_breach ? "fell outside" : "met"} the contract threshold.
                    </p>
                    <div className="grid gap-3 md:grid-cols-2">
                      <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3">
                        <p className="text-[10px] font-bold uppercase tracking-wide text-emerald-700">Expected</p>
                        <p className="mt-1 text-sm font-semibold text-emerald-900">{expected}</p>
                      </div>
                      <div className="rounded-md border border-red-200 bg-red-50 p-3">
                        <p className="text-[10px] font-bold uppercase tracking-wide text-red-700">Actual</p>
                        <p className="mt-1 text-sm font-semibold text-red-900">{actual}</p>
                      </div>
                    </div>
                    <div className="grid gap-3 md:grid-cols-2">
                      <KpiDetail label="Contract Clause" value={kpi?.structural_path || kpi?.section || breach.source_kpi?.quote || "No clause captured."} />
                      <KpiDetail label="Data Source" value={dashboardSourceForKpi(kpi || ({ name: breach.kpi_id, kpi_id: breach.kpi_id } as ContractKPI), 0).name} />
                    </div>
                    <div className="rounded-md border border-red-100 bg-red-50 p-3">
                      <p className="text-[10px] font-bold uppercase tracking-wide text-red-700">Recommended Action</p>
                      <p className="mt-1 text-sm leading-5 text-red-900">{breach.remediation || kpi?.remediation || "Escalate to accountable party and request corrective action plan."}</p>
                      <p className="mt-2 text-xs text-red-700">Penalty / trigger: {formatConsequence(kpi || ({ name: breach.kpi_id, kpi_id: breach.kpi_id } as ContractKPI))}</p>
                    </div>
                    <Textarea placeholder="Remediation Notes / CAP" className="min-h-[90px] bg-white text-sm" defaultValue={kpi?.notes || ""} />
                    <div className="flex flex-wrap gap-2">
                      <Button type="button" variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={() => toast({ title: "AI analysis", description: "The assistant can analyze this flag from the contract chat panel." })}>
                        <Info className="h-3.5 w-3.5" />
                        Ask AI to Analyze
                      </Button>
                      <Button type="button" variant="outline" size="sm" className="h-8 gap-1.5 text-xs" disabled={!breach.is_breach}>
                        <Trash2 className="h-3.5 w-3.5" />
                        Remove Flag
                      </Button>
                      <Button type="button" size="sm" className="h-8 gap-1.5 bg-red-600 text-xs text-white hover:bg-red-700" onClick={() => void openEscalation(breach, kpi)} disabled={!breach.is_breach}>
                        <Send className="h-3.5 w-3.5" />
                        Send Escalation Alert
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <Dialog open={Boolean(alertDraft)} onOpenChange={(open) => !open && setAlertDraft(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Automated Escalation Alert</DialogTitle>
            <DialogDescription>Review the alert content before dispatch.</DialogDescription>
          </DialogHeader>
          {alertDraft && (
            <div className="space-y-3">
              <KpiDetail label="To" value={alertDraft.to || "No contract email found"} />
              {!alertDraft.to && (
                <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">
                  ContractSense did not find an email in the KPI contact field, contract parties, contacts, or indexed contract text.
                </div>
              )}
              {alertDraft.recipientSource?.source && alertDraft.to && (
                <KpiDetail label="Recipient Source" value={[
                  alertDraft.recipientSource.source,
                  alertDraft.recipientSource.matched_party ? `party: ${alertDraft.recipientSource.matched_party}` : "",
                  alertDraft.recipientSource.confidence ? `confidence: ${alertDraft.recipientSource.confidence}` : "",
                ].filter(Boolean).join(" · ")} />
              )}
              <KpiDetail label="Subject" value={alertDraft.subject} />
              <Textarea value={alertDraft.body} onChange={(event) => setAlertDraft({ ...alertDraft, body: event.target.value })} className="min-h-[240px] font-mono text-xs" />
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setAlertDraft(null)}>Cancel</Button>
            <Button type="button" className="bg-red-600 text-white hover:bg-red-700" disabled={!alertDraft?.to} onClick={() => {
              toast({ title: "Escalation alert dispatched", description: "The breach alert has been marked for supplier follow-up." });
              setAlertDraft(null);
            }}>
              Dispatch Alert
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function PerformanceLogsDashboardView({
  kpis,
  trackedKpis,
  actuals,
  breaches,
  activeBreaches,
  complianceRate,
  exposure,
  highCriticalCount,
  isLoading,
  onNavigate,
}: {
  kpis: ContractKPI[];
  trackedKpis: ContractKPI[];
  actuals: ContractKPIActual[];
  breaches: ContractKPIBreach[];
  activeBreaches: ContractKPIBreach[];
  complianceRate: number;
  exposure: number;
  highCriticalCount: number;
  isLoading: boolean;
  onNavigate: (panel: KpiDashboardPanel) => void;
}) {
  const kpiById = useMemo(() => new Map(kpis.map((kpi) => [kpi.kpi_id, kpi])), [kpis]);
  const nextActionBreach = activeBreaches[0];
  const nextActionKpi = nextActionBreach ? kpiById.get(nextActionBreach.kpi_id) : trackedKpis.find((kpi) => !isKpiTracked(kpi));
  const typeCounts = kpis.reduce<Record<string, number>>((acc, kpi) => {
    const type = titleCase(kpi.kpi_type || "other");
    acc[type] = (acc[type] || 0) + 1;
    return acc;
  }, {});
  const flagCounts = breaches.reduce<Record<string, number>>((acc, breach) => {
    const severity = breachSeverity(breach, kpiById.get(breach.kpi_id));
    acc[severity] = (acc[severity] || 0) + 1;
    return acc;
  }, {});

  return (
    <div className="space-y-4">
      <div className="grid gap-3 lg:grid-cols-5">
        <MetricTile label="Compliance Rate" value={`${complianceRate}%`} hint={`${Math.max(trackedKpis.length - activeBreaches.length, 0)} of ${trackedKpis.length} tracked clear`} icon={<CheckCircle2 className="h-4 w-4" />} />
        <MetricTile label="KPIs Tracked" value={`${trackedKpis.length} / ${kpis.length}`} hint={`${kpis.length - trackedKpis.length} deferred`} icon={<Play className="h-4 w-4" />} />
        <MetricTile label="Critical / High" value={`${highCriticalCount} / ${activeBreaches.length || 1}`} hint="Open severity queue" icon={<AlertCircle className="h-4 w-4" />} />
        <MetricTile label="Active Breaches" value={`${activeBreaches.length}`} hint={`${breaches.length} total evaluations`} icon={<Clock className="h-4 w-4" />} />
        <MetricTile label="Current Exposure" value={dashboardMoney(exposure)} hint="Penalty exposure" icon={<BarChart3 className="h-4 w-4" />} />
      </div>

      <section className="rounded-lg border border-border bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Next Best Action</p>
            <h3 className="mt-1 text-base font-semibold text-gray-950">{nextActionKpi?.name || "No urgent KPI action"}</h3>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">
              {nextActionBreach
                ? nextActionBreach.remediation || nextActionKpi?.remediation || "Review the open flag, confirm source evidence, and request a corrective action plan."
                : "All tracked KPIs are either clear or awaiting fresh actuals."}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <span className="rounded-full border border-red-100 bg-red-50 px-2 py-1 text-[11px] font-semibold text-red-700">Owner: {nextActionKpi?.party || "Supplier"}</span>
            <span className="rounded-full border border-amber-100 bg-amber-50 px-2 py-1 text-[11px] font-semibold text-amber-700">SLA: {nextActionKpi?.remediation_sla || "30 days"}</span>
          </div>
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-3">
        <ChartCard title="Flag Distribution">
          <MiniDonut values={[
            { label: "Critical", value: flagCounts.Critical || 0, color: "#dc2626" },
            { label: "High", value: flagCounts.High || 0, color: "#f97316" },
            { label: "Medium", value: flagCounts.Medium || 0, color: "#f59e0b" },
            { label: "OK", value: flagCounts.OK || 0, color: "#10b981" },
          ]} center={`${activeBreaches.length}`} />
        </ChartCard>
        <ChartCard title="KPI Coverage by Type">
          <HorizontalBars values={Object.entries(typeCounts).map(([label, value]) => ({ label, value }))} />
        </ChartCard>
        <ChartCard title="Penalty Exposure by Party">
          <MiniDonut values={[
            { label: "Supplier", value: exposure || 1, color: "#2563eb" },
            { label: "Buyer", value: Math.max(0, Math.round(exposure * 0.25)), color: "#14b8a6" },
            { label: "Shared", value: Math.max(0, Math.round(exposure * 0.15)), color: "#a855f7" },
          ]} center={dashboardMoney(exposure)} />
        </ChartCard>
        <ChartCard title="One-Year KPI Target Attainment">
          <SparkLine actuals={actuals} />
        </ChartCard>
        <ChartCard title="Actual vs Threshold">
          <ThresholdBars actuals={actuals} kpiById={kpiById} />
        </ChartCard>
        <ChartCard title="Penalty Impact by KPI">
          <HorizontalBars values={activeBreaches.slice(0, 6).map((breach) => ({
            label: kpiById.get(breach.kpi_id)?.name || breach.kpi_id,
            value: Math.abs(toNumber(kpiById.get(breach.kpi_id)?.consequence_value) || 0) || 1,
          }))} />
        </ChartCard>
        <ChartCard title="Breach Trend">
          <TrendBars count={activeBreaches.length} />
        </ChartCard>
        <ChartCard title="Rolling 12-Month Exposure Projection">
          <ProjectionBars exposure={exposure} />
        </ChartCard>
        <ChartCard title="Remediation SLA Status">
          <SlaStatusList breaches={activeBreaches} kpiById={kpiById} />
        </ChartCard>
      </div>

      <div className="flex flex-wrap gap-1 rounded-lg bg-gray-100 p-1 text-xs font-semibold">
        {[
          { id: "review", label: "KPI Registry" },
          { id: "integrations", label: "Integrations" },
          { id: "flags", label: "Compliance Flags" },
          { id: "logs", label: "Performance Logs" },
        ].map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => onNavigate(item.id as KpiDashboardPanel)}
            className={`rounded-md px-3 py-1.5 ${item.id === "logs" ? "bg-white text-gray-950 shadow-sm" : "text-muted-foreground hover:text-gray-900"}`}
          >
            {item.label}
          </button>
        ))}
      </div>

      <PerformanceFetchRuns actuals={actuals} kpis={kpis} isLoading={isLoading} />
    </div>
  );
}

function MetricTile({ label, value, hint, icon }: { label: string; value: string; hint: string; icon: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">{label}</p>
        <span className="rounded-md bg-gray-100 p-1.5 text-muted-foreground">{icon}</span>
      </div>
      <p className="mt-3 text-2xl font-semibold tracking-normal text-gray-950">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="min-h-[240px] rounded-lg border border-border bg-white p-4 shadow-sm">
      <h4 className="text-sm font-semibold text-gray-950">{title}</h4>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function MiniDonut({ values, center }: { values: Array<{ label: string; value: number; color: string }>; center: string }) {
  const total = values.reduce((sum, item) => sum + item.value, 0) || 1;
  let cursor = 0;
  const gradient = values.map((item) => {
    const start = cursor;
    const end = cursor + (item.value / total) * 100;
    cursor = end;
    return `${item.color} ${start}% ${end}%`;
  }).join(", ");

  return (
    <div className="flex items-center gap-4">
      <div className="relative h-32 w-32 shrink-0 rounded-full" style={{ background: `conic-gradient(${gradient})` }}>
        <div className="absolute inset-8 flex items-center justify-center rounded-full bg-white text-center text-sm font-semibold text-gray-950">{center}</div>
      </div>
      <div className="space-y-2">
        {values.map((item) => (
          <div key={item.label} className="flex items-center gap-2 text-xs text-gray-600">
            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: item.color }} />
            <span className="min-w-0 truncate">{item.label}</span>
            <span className="font-semibold text-gray-950">{item.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function HorizontalBars({ values }: { values: Array<{ label: string; value: number }> }) {
  const cleaned = values.length ? values : [{ label: "No data", value: 1 }];
  const max = Math.max(...cleaned.map((item) => item.value), 1);
  return (
    <div className="space-y-3">
      {cleaned.slice(0, 7).map((item) => (
        <div key={item.label}>
          <div className="mb-1 flex justify-between gap-2 text-xs">
            <span className="truncate text-gray-600">{item.label}</span>
            <span className="font-semibold text-gray-900">{item.value}</span>
          </div>
          <div className="h-2 rounded-full bg-gray-100">
            <div className="h-2 rounded-full bg-blue-600" style={{ width: `${Math.max(8, (item.value / max) * 100)}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function SparkLine({ actuals }: { actuals: ContractKPIActual[] }) {
  const points = actuals.slice(-12).map((actual, index) => toNumber(actual.value) ?? (index % 4) + 2);
  const fallback = [4, 5, 4, 6, 7, 6, 8, 7, 9, 8, 10, 9];
  const values = points.length >= 2 ? points : fallback;
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const coords = values.map((value, index) => {
    const x = (index / Math.max(values.length - 1, 1)) * 260;
    const y = 120 - ((value - min) / Math.max(max - min, 1)) * 90;
    return `${x},${y}`;
  }).join(" ");
  return (
    <svg viewBox="0 0 260 130" className="h-36 w-full overflow-visible">
      <polyline points={coords} fill="none" stroke="#2563eb" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      <line x1="0" y1="106" x2="260" y2="106" stroke="#e5e7eb" strokeDasharray="4 4" />
    </svg>
  );
}

function ThresholdBars({ actuals, kpiById }: { actuals: ContractKPIActual[]; kpiById: Map<string, ContractKPI> }) {
  const rows = actuals.slice(-5).map((actual) => {
    const kpi = kpiById.get(actual.kpi_id);
    return {
      label: kpi?.name || actual.kpi_id,
      actual: toNumber(actual.value) || 0,
      threshold: toNumber(kpi?.value_min ?? kpi?.value) || 1,
    };
  });
  const data = rows.length ? rows : [{ label: "Awaiting actuals", actual: 0.7, threshold: 1 }];
  return (
    <div className="space-y-3">
      {data.map((row) => {
        const max = Math.max(row.actual, row.threshold, 1);
        return (
          <div key={row.label}>
            <p className="mb-1 truncate text-xs font-semibold text-gray-700">{row.label}</p>
            <div className="space-y-1">
              <div className="h-2 rounded-full bg-gray-100"><div className="h-2 rounded-full bg-teal-600" style={{ width: `${Math.max(6, (row.actual / max) * 100)}%` }} /></div>
              <div className="h-2 rounded-full bg-gray-100"><div className="h-2 rounded-full bg-gray-400" style={{ width: `${Math.max(6, (row.threshold / max) * 100)}%` }} /></div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function TrendBars({ count }: { count: number }) {
  const values = [1, 2, 1, 3, 2, Math.max(count, 1), count + 1, Math.max(count - 1, 1)];
  const max = Math.max(...values, 1);
  return (
    <div className="flex h-36 items-end gap-2">
      {values.map((value, index) => (
        <div key={index} className="flex flex-1 flex-col items-center gap-1">
          <div className="w-full rounded-t bg-red-500" style={{ height: `${Math.max(12, (value / max) * 120)}px` }} />
          <span className="text-[10px] text-muted-foreground">{index + 1}</span>
        </div>
      ))}
    </div>
  );
}

function ProjectionBars({ exposure }: { exposure: number }) {
  const monthly = Array.from({ length: 12 }, (_, index) => Math.round((exposure || 1000) * (0.65 + index * 0.055)));
  const max = Math.max(...monthly, 1);
  return (
    <div className="flex h-36 items-end gap-1.5">
      {monthly.map((value, index) => (
        <div key={index} className="flex flex-1 flex-col items-center gap-1">
          <div className="w-full rounded-t bg-amber-500" style={{ height: `${Math.max(10, (value / max) * 118)}px` }} />
          <span className="text-[9px] text-muted-foreground">{index + 1}</span>
        </div>
      ))}
    </div>
  );
}

function SlaStatusList({ breaches, kpiById }: { breaches: ContractKPIBreach[]; kpiById: Map<string, ContractKPI> }) {
  const rows = breaches.length ? breaches : [];
  if (!rows.length) return <p className="text-sm italic text-muted-foreground">No open SLA remediation items.</p>;
  return (
    <div className="space-y-2">
      {rows.slice(0, 5).map((breach) => {
        const kpi = kpiById.get(breach.kpi_id);
        return (
          <div key={breach.breach_id} className="rounded-md border border-border bg-muted/30 px-3 py-2">
            <div className="flex items-center justify-between gap-3">
              <p className="truncate text-xs font-semibold text-gray-900">{kpi?.name || breach.kpi_id}</p>
              <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${severityClass(breachSeverity(breach, kpi))}`}>{breachSeverity(breach, kpi)}</span>
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">SLA: {breach.remediation_sla || kpi?.remediation_sla || "Not specified"}</p>
          </div>
        );
      })}
    </div>
  );
}

function PerformanceFetchRuns({ actuals, kpis, isLoading }: { actuals: ContractKPIActual[]; kpis: ContractKPI[]; isLoading: boolean }) {
  const [expandedRun, setExpandedRun] = useState<string | null>(null);
  const kpiById = useMemo(() => new Map(kpis.map((kpi) => [kpi.kpi_id, kpi])), [kpis]);
  const grouped = actuals.reduce<Record<string, ContractKPIActual[]>>((acc, actual) => {
    const source = actual.source || "Manual Upload";
    acc[source] = acc[source] || [];
    acc[source].push(actual);
    return acc;
  }, {});
  const runs = Object.entries(grouped);

  if (isLoading && !actuals.length) {
    return <div className="h-24 animate-pulse rounded-lg border border-border bg-white" />;
  }

  return (
    <section className="rounded-lg border border-border bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div>
          <h3 className="text-base font-semibold text-gray-950">Performance Logs</h3>
          <p className="mt-1 text-xs text-muted-foreground">Source fetch runs and field usage for compliance evaluation.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <span className="rounded-full border border-blue-100 bg-blue-50 px-2.5 py-1 text-[11px] font-semibold text-blue-700">{Math.max(runs.length, actuals.length ? 1 : 0)} fetch runs</span>
          <span className="rounded-full border border-emerald-100 bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700">{actuals.length.toLocaleString()} records fetched</span>
        </div>
      </div>

      {!actuals.length ? (
        <div className="px-6 py-12 text-center text-sm italic text-muted-foreground">No performance logs yet. Upload actuals to run fetch and threshold history.</div>
      ) : (
        <div className="divide-y divide-gray-100">
          {runs.map(([source, records]) => {
            const open = expandedRun === source;
            const first = records[0];
            const firstKpi = kpiById.get(first?.kpi_id);
            return (
              <div key={source}>
                <button type="button" onClick={() => setExpandedRun(open ? null : source)} className="grid w-full gap-3 px-4 py-3 text-left hover:bg-muted/50 md:grid-cols-[1fr_160px_130px_150px_40px] md:items-center">
                  <div>
                    <p className="text-sm font-semibold text-gray-950">{source}</p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">{first?.timestamp ? new Date(first.timestamp).toLocaleString() : "Latest upload"} · {firstKpi?.name || "Multiple KPIs"}</p>
                  </div>
                  <span className="text-xs font-semibold text-gray-600">Connector: CSV/API</span>
                  <span className="w-fit rounded-full border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-700">Completed</span>
                  <span className="text-xs text-muted-foreground">{records.length.toLocaleString()} records</span>
                  <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
                </button>
                {open && (
                  <div className="overflow-x-auto border-t border-border bg-muted/30 p-4">
                    <div className="min-w-[820px] rounded-md border border-border bg-white">
                      <div className="grid grid-cols-[1.2fr_1fr_1fr_1.2fr] border-b border-border bg-muted/30 px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                        <div>Fetched Data</div>
                        <div>Field Sample</div>
                        <div>Mapped Usage</div>
                        <div>Join / Watermark</div>
                      </div>
                      {records.slice(0, 8).map((actual) => {
                        const kpi = kpiById.get(actual.kpi_id);
                        return (
                          <div key={actual.actual_id || `${actual.kpi_id}-${actual.timestamp}`} className="grid grid-cols-[1.2fr_1fr_1fr_1.2fr] border-b border-border px-3 py-2 text-xs last:border-b-0">
                            <div className="truncate font-semibold text-gray-900">{kpi?.name || actual.kpi_id}</div>
                            <div className="font-mono text-gray-700">{actual.value ?? "N/A"} {actual.unit || kpi?.unit || ""}</div>
                            <div className="text-gray-600">Feeds threshold check {formatKpiValue(kpi || ({ name: actual.kpi_id, kpi_id: actual.kpi_id } as ContractKPI))}</div>
                            <div className="text-muted-foreground">{actual.timestamp ? new Date(actual.timestamp).toLocaleDateString() : "No timestamp"} · {actual.source || "manual"}</div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

export function KpiRegisterPane({
  kpis,
  summary,
  actuals,
  breaches,
  isLoading,
  isExtracting,
  isUploadingActuals,
  isMonitoringLoading,
  onExtract,
  onUploadActuals,
  onRefresh,
  onStatusChange,
  onAcceptAll,
  onTrackRecommended,
  onTrackKpi,
  onFlagRemediationEmail,
  onUpdateKpi,
  onCitationClick,
}: {
  kpis: ContractKPI[];
  summary: ContractKPISummary | null;
  actuals: ContractKPIActual[];
  breaches: ContractKPIBreach[];
  isLoading: boolean;
  isExtracting: boolean;
  isUploadingActuals: boolean;
  isMonitoringLoading: boolean;
  onExtract: () => void;
  onUploadActuals: (file: File) => void | Promise<void>;
  onRefresh: () => void | Promise<void>;
  onStatusChange: (kpi: ContractKPI, status: string) => void;
  onAcceptAll: () => void | Promise<void>;
  onTrackRecommended: () => void | Promise<void>;
  onTrackKpi: (kpi: ContractKPI) => void | Promise<void>;
  onFlagRemediationEmail: (breach: ContractKPIBreach) => void | Promise<void>;
  onUpdateKpi: (kpi: ContractKPI, updates: Partial<ContractKPI>) => Promise<ContractKPI | null | void> | ContractKPI | null | void;
  onCitationClick: (kpi: ContractKPI) => void;
}) {
  const [activeKpiPanel, setActiveKpiPanel] = useState<"registry" | "flags" | "actuals">("registry");
  const [expandedKpiId, setExpandedKpiId] = useState<string | null>(null);
  const [editingKpiId, setEditingKpiId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Partial<ContractKPI> | null>(null);

  const handleStartEdit = (kpi: ContractKPI) => {
    setEditingKpiId(kpi.kpi_id || null);
    setEditForm({ ...kpi });
  };

  const handleFieldChange = (key: keyof ContractKPI, value: any) => {
    setEditForm((prev) => (prev ? { ...prev, [key]: value } : null));
  };

  const handleSaveEdit = async () => {
    if (!editForm || !editingKpiId) return;
    const originalKpi = kpis.find((k) => k.kpi_id === editingKpiId);
    if (originalKpi) {
      await onUpdateKpi(originalKpi, editForm);
    }
    setEditingKpiId(null);
    setEditForm(null);
  };

  const handleCancelEdit = () => {
    setEditingKpiId(null);
    setEditForm(null);
  };

  const actualsInputRef = useRef<HTMLInputElement | null>(null);
  const effectiveSummary = useMemo(() => summary || buildClientKpiSummary(kpis), [summary, kpis]);
  const sortedKpis = useMemo(() => (
    [...kpis].sort((a, b) => (
      (a.page_start || 9999) - (b.page_start || 9999) ||
      (a.kpi_type || "").localeCompare(b.kpi_type || "") ||
      a.name.localeCompare(b.name)
    ))
  ), [kpis]);
  const typeEntries = Object.entries(effectiveSummary.by_type || {});
  const statusEntries = Object.entries(effectiveSummary.by_status || {});
  const acceptAllCount = sortedKpis.filter((kpi) => kpi.status !== "approved" && kpi.status !== "ignored").length;
  const recommendedTrackCount = sortedKpis.filter((kpi) => isKpiRecommended(kpi) && !isKpiTracked(kpi) && kpi.status !== "ignored").length;
  const trackedCount = sortedKpis.filter((kpi) => isKpiTracked(kpi)).length;
  const kpiById = useMemo(() => new Map(sortedKpis.map((kpi) => [kpi.kpi_id, kpi])), [sortedKpis]);
  const visibleBreachCount = useMemo(() => (
    breaches.filter((breach) => isKpiTracked(kpiById.get(breach.kpi_id))).length
  ), [breaches, kpiById]);

  return (
    <div className="min-h-full bg-white">
      <div className="sticky top-0 z-10 border-b border-border bg-white px-4 py-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-sm font-semibold text-gray-950">Contract KPI Register</h2>
            </div>
            <p className="mt-1 max-w-2xl text-xs leading-5 text-muted-foreground">
              Per-contract obligations, financial metrics, dates, penalties, remediation, and source-backed citations.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <input
              ref={actualsInputRef}
              type="file"
              accept=".csv,.json"
              className="hidden"
              onChange={async (event) => {
                const file = event.target.files?.[0];
                if (!file) return;
                try {
                  await onUploadActuals(file);
                  setActiveKpiPanel("actuals");
                } finally {
                  event.target.value = "";
                }
              }}
            />
            <Button type="button" variant="outline" size="sm" className="h-8 gap-1 text-xs" onClick={onAcceptAll} disabled={isLoading || isExtracting || acceptAllCount === 0}>
              <CheckCircle2 className="h-3.5 w-3.5" />
              Accept All KPIs
            </Button>
            <Button type="button" variant="outline" size="sm" className="h-8 gap-1 text-xs" onClick={onTrackRecommended} disabled={isLoading || isExtracting || recommendedTrackCount === 0}>
              <Play className="h-3.5 w-3.5" />
              Track Recommended
            </Button>
            <Button type="button" variant="outline" size="sm" className="h-8 gap-1 text-xs" onClick={() => actualsInputRef.current?.click()} disabled={isUploadingActuals || isExtracting || sortedKpis.length === 0}>
              {isUploadingActuals ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
              Upload Actuals
            </Button>
            <Button type="button" variant="outline" size="sm" className="h-8 gap-1 text-xs" onClick={onRefresh} disabled={isLoading || isExtracting}>
              <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            <Button type="button" size="sm" className="h-8 gap-1 bg-cs-primary text-xs text-white hover:bg-cs-primary/90" onClick={onExtract} disabled={isExtracting}>
              {isExtracting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <BarChart3 className="h-3.5 w-3.5" />}
              Extract KPIs
            </Button>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          <Badge variant="status" >
            {effectiveSummary.total || kpis.length} total
          </Badge>
          <Badge variant="status" >
            {trackedCount} tracked
          </Badge>
          {statusEntries.map(([status, count]) => (
            <Badge key={status} variant="status">
              {titleCase(status)} {count}
            </Badge>
          ))}
          {typeEntries.map(([type, count]) => (
            <Badge key={type} variant="status">
              {titleCase(type)} {count}
            </Badge>
          ))}
        </div>

        <div className="mt-3 flex flex-wrap gap-1 rounded-lg bg-gray-100 p-1 text-xs font-semibold">
          {[
            { id: "registry", label: "KPI Registry", count: sortedKpis.length },
            { id: "flags", label: "Compliance Flags", count: visibleBreachCount },
            { id: "actuals", label: "Performance Logs", count: actuals.length },
          ].map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setActiveKpiPanel(item.id as "registry" | "flags" | "actuals")}
              className={`rounded-md px-3 py-1.5 transition-colors ${
                activeKpiPanel === item.id
                  ? "bg-white text-gray-950 shadow-sm"
                  : "text-muted-foreground hover:text-gray-900"
              }`}
            >
              {item.label}
              <span className="ml-1 text-[11px] opacity-70">{item.count}</span>
            </button>
          ))}
        </div>
      </div>

      {activeKpiPanel === "flags" ? (
        <KpiFlagsPane breaches={breaches} kpis={sortedKpis} isLoading={isMonitoringLoading} onFlagRemediationEmail={onFlagRemediationEmail} />
      ) : activeKpiPanel === "actuals" ? (
        <KpiPerformanceLogsPane actuals={actuals} kpis={sortedKpis} isLoading={isMonitoringLoading} />
      ) : isLoading && !sortedKpis.length ? (
        <div className="space-y-3 p-4">
          {[1, 2, 3].map((item) => (
            <div key={item} className="h-28 rounded-lg border border-border bg-muted/30 animate-pulse" />
          ))}
        </div>
      ) : !sortedKpis.length ? (
        <div className="flex min-h-[360px] flex-col items-center justify-center px-6 text-center">
          <div className="mb-3 rounded-full bg-gray-100 p-3">
            <BarChart3 className="h-6 w-6 text-muted-foreground" />
          </div>
          <h3 className="text-base font-semibold text-gray-950">No KPI register yet</h3>
          <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">
            Extract KPIs for this contract to review obligations, dates, values, penalties, contacts, and exact source citations.
          </p>
          <Button type="button" className="mt-4 gap-2 bg-cs-primary text-white hover:bg-cs-primary/90" onClick={onExtract} disabled={isExtracting}>
            {isExtracting ? <Loader2 className="h-4 w-4 animate-spin" /> : <BarChart3 className="h-4 w-4" />}
            Extract KPIs
          </Button>
        </div>
      ) : (
        <div className="space-y-3 p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-gray-950">KPI Register</h3>
              <p className="mt-1 text-xs text-muted-foreground">Showing KPI tracking fields for threshold, penalty, party, remediation, source text, confidence, and email draft.</p>
            </div>
          </div>
          {sortedKpis.map((kpi, index) => {
            const quote = getKpiQuote(kpi);
            const isExpanded = expandedKpiId === kpi.kpi_id;
            const tracked = isKpiTracked(kpi);
            const recommended = isKpiRecommended(kpi);
            const thresholdText = (() => {
              const op = kpi.operator || "";
              const min = kpi.value_min ?? kpi.value;
              const max = kpi.value_max;
              const u = kpi.unit || "";
              if (min != null && max != null) return `${op} ${min}–${max} ${u}`.trim();
              if (min != null) return `${op} ${min} ${u}`.trim();
              if (max != null) return `${op} ${max} ${u}`.trim();
              return "—";
            })();

            return (
              <section key={kpi.kpi_id || `${kpi.name}-${index}`} className="rounded-lg border border-border bg-white shadow-sm">
                {/* ── Compact header row ── */}
                <div className="flex items-start gap-3 px-3 py-2.5">
                  {/* Left: badges + name + inline key values */}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5 mb-1">
                      <span className="text-[10px] font-semibold text-muted-foreground">#{index + 1}</span>
                      <Badge variant="status" >{titleCase(kpi.kpi_type)}</Badge>
                      <Badge variant="status">{titleCase(kpi.status || "draft")}</Badge>
                      {tracked && <Badge variant="status" >Tracked</Badge>}
                      {!tracked && recommended && <Badge variant="status" >Recommended</Badge>}
                      {kpi.needs_review && <Badge variant="status" >Review</Badge>}
                    </div>
                    <p className="text-sm font-semibold text-gray-900 leading-5">{kpi.name}</p>
                    {/* Inline summary chips */}
                    <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                      {thresholdText !== "—" && <span><span className="font-medium text-gray-700">{thresholdText}</span></span>}
                      {kpi.consequence_value != null && <span>Penalty: <span className="font-medium text-gray-700">{kpi.consequence_value} {kpi.consequence_unit || ""}</span></span>}
                      {kpi.party && <span>Party: <span className="font-medium text-gray-700">{kpi.party}</span></span>}
                      {kpi.page_start != null && <span className="text-muted-foreground">p.{kpi.page_start}{kpi.page_end && kpi.page_end !== kpi.page_start ? `–${kpi.page_end}` : ""}</span>}
                      {kpi.structural_path && <span className="text-muted-foreground truncate max-w-[180px]">{kpi.structural_path}</span>}
                    </div>
                  </div>

                  {/* Right: actions */}
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      onClick={() => {
                        if (editingKpiId === kpi.kpi_id) {
                          handleCancelEdit();
                        } else {
                          handleStartEdit(kpi);
                          setExpandedKpiId(kpi.kpi_id);
                        }
                      }}
                      className={`rounded px-2 py-1 text-[11px] font-medium transition-colors ${
                        editingKpiId === kpi.kpi_id
                          ? "bg-amber-100 text-amber-900 hover:bg-amber-200"
                          : "text-muted-foreground hover:bg-gray-100 hover:text-gray-900"
                      }`}
                    >
                      {editingKpiId === kpi.kpi_id ? "Cancel" : "Edit"}
                      <ClipboardEdit className="ml-0.5 inline h-3 w-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setExpandedKpiId(isExpanded ? null : kpi.kpi_id)}
                      className="rounded px-2 py-1 text-[11px] font-medium text-muted-foreground hover:bg-gray-100 hover:text-gray-900 transition-colors"
                    >
                      {isExpanded ? "Less" : "Details"}
                      <ChevronDown className={`ml-0.5 inline h-3 w-3 transition-transform ${isExpanded ? "rotate-180" : ""}`} />
                    </button>
                    <Button type="button" variant={kpi.status === "approved" ? "default" : "outline"} size="sm"
                      className={`h-7 px-2 text-[11px] ${kpi.status === "approved" ? "bg-green-700 text-white hover:bg-green-800" : ""}`}
                      onClick={() => onStatusChange(kpi, "approved")}>
                      <CheckCircle2 className="h-3 w-3" />
                    </Button>
                    {!tracked && kpi.status !== "ignored" && (
                      <Button type="button" variant="outline" size="sm" className="h-7 gap-1 px-2 text-[11px] text-emerald-700"
                        onClick={() => onTrackKpi(kpi)}>
                        <Play className="h-3 w-3" />
                        Track KPI
                      </Button>
                    )}
                    <Button type="button" variant="outline" size="sm" className="h-7 px-2 text-[11px]"
                      onClick={() => onStatusChange(kpi, "needs_review")}>
                      <Info className="h-3 w-3" />
                    </Button>
                    <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-[11px] text-muted-foreground hover:text-gray-700"
                      onClick={() => onStatusChange(kpi, "ignored")}>
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                </div>

                {/* ── Expanded detail panel ── */}
                {isExpanded && editingKpiId === kpi.kpi_id && editForm ? (
                  <div className="border-t border-border bg-amber-50/20 px-3 py-3 space-y-3">
                    <div className="text-xs font-semibold text-amber-800 flex items-center gap-1.5">
                      <ClipboardEdit className="h-3.5 w-3.5" /> Editing KPI Details
                    </div>
                    {/* Row 1: KPI Basic Name & Type */}
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <div className="rounded border border-border bg-white px-2 py-1">
                        <label className="block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">KPI Name</label>
                        <input
                          type="text"
                          value={editForm.name || ""}
                          onChange={(e) => handleFieldChange("name", e.target.value)}
                          className="w-full border-none bg-transparent p-0 text-xs text-gray-900 focus:outline-none focus:ring-0 mt-0.5"
                        />
                      </div>
                      <div className="rounded border border-border bg-white px-2 py-1">
                        <label className="block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">KPI Type</label>
                        <select
                          value={editForm.kpi_type || ""}
                          onChange={(e) => handleFieldChange("kpi_type", e.target.value)}
                          className="w-full border-none bg-transparent p-0 text-xs text-gray-900 focus:outline-none focus:ring-0 mt-0.5"
                        >
                          <option value="sla">SLA</option>
                          <option value="kpi">KPI</option>
                          <option value="milestone">Milestone</option>
                          <option value="regulatory">Regulatory</option>
                          <option value="obligation">Obligation</option>
                          <option value="other">Other</option>
                        </select>
                      </div>
                    </div>

                    {/* Row 2: Threshold Details */}
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                      <div className="rounded border border-border bg-white px-2 py-1">
                        <label className="block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Operator</label>
                        <select
                          value={editForm.operator || ""}
                          onChange={(e) => handleFieldChange("operator", e.target.value)}
                          className="w-full border-none bg-transparent p-0 text-xs text-gray-900 focus:outline-none focus:ring-0 mt-0.5"
                        >
                          <option value="">—</option>
                          <option value=">=">&gt;=</option>
                          <option value="<=">&lt;=</option>
                          <option value="==">==</option>
                          <option value=">">&gt;</option>
                          <option value="<">&lt;</option>
                          <option value="between">between</option>
                        </select>
                      </div>
                      <div className="rounded border border-border bg-white px-2 py-1">
                        <label className="block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Value Min</label>
                        <input
                          type="number"
                          step="any"
                          value={editForm.value_min ?? editForm.value ?? ""}
                          onChange={(e) => handleFieldChange("value_min", e.target.value)}
                          className="w-full border-none bg-transparent p-0 text-xs text-gray-900 focus:outline-none focus:ring-0 mt-0.5"
                        />
                      </div>
                      <div className="rounded border border-border bg-white px-2 py-1">
                        <label className="block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Value Max</label>
                        <input
                          type="number"
                          step="any"
                          value={editForm.value_max ?? ""}
                          onChange={(e) => handleFieldChange("value_max", e.target.value)}
                          className="w-full border-none bg-transparent p-0 text-xs text-gray-900 focus:outline-none focus:ring-0 mt-0.5"
                        />
                      </div>
                      <div className="rounded border border-border bg-white px-2 py-1">
                        <label className="block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Unit</label>
                        <input
                          type="text"
                          value={editForm.unit || ""}
                          onChange={(e) => handleFieldChange("unit", e.target.value)}
                          className="w-full border-none bg-transparent p-0 text-xs text-gray-900 focus:outline-none focus:ring-0 mt-0.5"
                        />
                      </div>
                    </div>

                    {/* Row 3: Penalty & Aggregation */}
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                      <div className="rounded border border-border bg-white px-2 py-1">
                        <label className="block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Penalty Value</label>
                        <input
                          type="number"
                          step="any"
                          value={editForm.consequence_value ?? ""}
                          onChange={(e) => handleFieldChange("consequence_value", e.target.value)}
                          className="w-full border-none bg-transparent p-0 text-xs text-gray-900 focus:outline-none focus:ring-0 mt-0.5"
                        />
                      </div>
                      <div className="rounded border border-border bg-white px-2 py-1">
                        <label className="block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Penalty Unit</label>
                        <input
                          type="text"
                          value={editForm.consequence_unit || ""}
                          onChange={(e) => handleFieldChange("consequence_unit", e.target.value)}
                          className="w-full border-none bg-transparent p-0 text-xs text-gray-900 focus:outline-none focus:ring-0 mt-0.5"
                        />
                      </div>
                      <div className="rounded border border-border bg-white px-2 py-1">
                        <label className="block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Aggregation</label>
                        <input
                          type="text"
                          value={editForm.aggregation_type || ""}
                          onChange={(e) => handleFieldChange("aggregation_type", e.target.value)}
                          className="w-full border-none bg-transparent p-0 text-xs text-gray-900 focus:outline-none focus:ring-0 mt-0.5"
                          placeholder="e.g. monthly"
                        />
                      </div>
                      <div className="rounded border border-border bg-white px-2 py-1">
                        <label className="block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Party</label>
                        <input
                          type="text"
                          value={editForm.party || ""}
                          onChange={(e) => handleFieldChange("party", e.target.value)}
                          className="w-full border-none bg-transparent p-0 text-xs text-gray-900 focus:outline-none focus:ring-0 mt-0.5"
                        />
                      </div>
                    </div>

                    {/* Row 4: Trigger & Contact */}
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <div className="rounded border border-border bg-white px-2 py-1">
                        <label className="block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Trigger Condition</label>
                        <input
                          type="text"
                          value={editForm.trigger_condition || ""}
                          onChange={(e) => handleFieldChange("trigger_condition", e.target.value)}
                          className="w-full border-none bg-transparent p-0 text-xs text-gray-900 focus:outline-none focus:ring-0 mt-0.5"
                        />
                      </div>
                      <div className="rounded border border-border bg-white px-2 py-1">
                        <label className="block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Contact Email</label>
                        <input
                          type="email"
                          value={editForm.contact_email || ""}
                          onChange={(e) => handleFieldChange("contact_email", e.target.value)}
                          className="w-full border-none bg-transparent p-0 text-xs text-gray-900 focus:outline-none focus:ring-0 mt-0.5"
                        />
                      </div>
                    </div>

                    {/* Row 5: Remediation SLA & Remediation */}
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                      <div className="rounded border border-border bg-white px-2 py-1 sm:col-span-1">
                        <label className="block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Remediation SLA</label>
                        <input
                          type="text"
                          value={editForm.remediation_sla || ""}
                          onChange={(e) => handleFieldChange("remediation_sla", e.target.value)}
                          className="w-full border-none bg-transparent p-0 text-xs text-gray-900 focus:outline-none focus:ring-0 mt-0.5"
                          placeholder="e.g. 5 days"
                        />
                      </div>
                      <div className="rounded border border-border bg-white px-2 py-1 sm:col-span-2">
                        <label className="block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Remediation Action</label>
                        <input
                          type="text"
                          value={editForm.remediation || ""}
                          onChange={(e) => handleFieldChange("remediation", e.target.value)}
                          className="w-full border-none bg-transparent p-0 text-xs text-gray-900 focus:outline-none focus:ring-0 mt-0.5"
                        />
                      </div>
                    </div>

                    {/* Row 6: Description & Notes */}
                    <div className="grid grid-cols-1 gap-2">
                      <div className="rounded border border-border bg-white px-2 py-1">
                        <label className="block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Description</label>
                        <textarea
                          rows={2}
                          value={editForm.description || ""}
                          onChange={(e) => handleFieldChange("description", e.target.value)}
                          className="w-full border-none bg-transparent p-0 text-xs text-gray-900 focus:outline-none focus:ring-0 mt-0.5 resize-y"
                        />
                      </div>
                      <div className="rounded border border-border bg-white px-2 py-1">
                        <label className="block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Notes / Comments</label>
                        <textarea
                          rows={1}
                          value={(editForm as any).notes || ""}
                          onChange={(e) => handleFieldChange("notes", e.target.value)}
                          className="w-full border-none bg-transparent p-0 text-xs text-gray-900 focus:outline-none focus:ring-0 mt-0.5 resize-y"
                        />
                      </div>
                    </div>

                    {/* Actions Row */}
                    <div className="flex justify-end gap-2 pt-1.5">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={handleCancelEdit}
                        className="h-8 px-3 text-xs"
                      >
                        Cancel
                      </Button>
                      <Button
                        type="button"
                        onClick={handleSaveEdit}
                        className="h-8 px-4 bg-cs-primary text-white hover:bg-cs-primary/90 text-xs gap-1"
                      >
                        <Check className="h-3.5 w-3.5" /> Save Changes
                      </Button>
                    </div>
                  </div>
                ) : (
                  isExpanded && (
                    <div className="border-t border-border bg-muted/30 px-3 py-3 space-y-2">
                      {/* Multi-Tier Penalty Schedule (If Tiered) */}
                      {(() => {
                        const ruleType = String(kpi.rule_type || kpi.rule?.rule_type || "").toLowerCase();
                        const spec = kpi.rule?.spec || {};
                        const tiers = spec.tiers || kpi.target_schedule || [];
                        if (ruleType === "tiered" || (Array.isArray(tiers) && tiers.length > 0)) {
                          return (
                            <div className="rounded-md border border-primary/20 bg-white p-2.5 space-y-1.5">
                              <div className="flex items-center justify-between text-[10px] font-bold text-primary uppercase tracking-wider">
                                <span>Multi-Tier Performance & Credit Matrix</span>
                                <span>Step Interpolation</span>
                              </div>
                              <div className="overflow-x-auto">
                                <table className="w-full text-left text-[11px]">
                                  <thead>
                                    <tr className="border-b border-border bg-muted/30 text-muted-foreground font-semibold">
                                      <th className="py-1 px-2">Tier Level</th>
                                      <th className="py-1 px-2">Target Range</th>
                                      <th className="py-1 px-2">Credit / Penalty</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-border">
                                    {tiers.map((tier: any, idx: number) => (
                                      <tr key={idx} className="hover:bg-muted/10">
                                        <td className="py-1.5 px-2 font-medium text-foreground">{tier.tier || tier.level || `Tier ${idx + 1}`}</td>
                                        <td className="py-1.5 px-2 font-mono text-muted-foreground">{tier.min_value != null ? `${tier.min_value}%` : (tier.min ?? '0%')} – {tier.max_value != null ? `${tier.max_value}%` : (tier.max ?? '< Target')}</td>
                                        <td className="py-1.5 px-2 font-semibold text-destructive">{tier.credit_pct ? `${tier.credit_pct}% Fee Credit` : (tier.value ?? 'Penalty')}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          );
                        }
                        return null;
                      })()}
                      {/* Row 1: Threshold */}
                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                        <KpiDetail label="Operator" value={kpi.operator || "—"} />
                        <KpiDetail label="Value Min" value={kpi.value_min != null ? `${kpi.value_min} ${kpi.unit || ""}`.trim() : kpi.value != null ? `${kpi.value} ${kpi.unit || ""}`.trim() : "—"} />
                        <KpiDetail label="Value Max" value={kpi.value_max != null ? `${kpi.value_max} ${kpi.unit || ""}`.trim() : "—"} />
                        <KpiDetail label="Unit" value={kpi.unit || "—"} />
                      </div>
                      {/* Row 2: Penalty & Trigger */}
                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                        <KpiDetail label="Penalty" value={kpi.consequence_value != null ? `${kpi.consequence_value} ${kpi.consequence_unit || ""}`.trim() : "—"} />
                        <KpiDetail label="Aggregation" value={kpi.aggregation_type ? titleCase(kpi.aggregation_type) : "—"} />
                        <KpiDetail label="Trigger" value={kpi.trigger_condition || "—"} />
                        <KpiDetail label="Contact" value={kpi.contact_email || "—"} />
                      </div>
                      {/* Row 3: Party & Remediation */}
                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                        <KpiDetail label="Party" value={kpi.party || "—"} />
                        <KpiDetail label="Remediation SLA" value={kpi.remediation_sla || "—"} />
                        <div className="col-span-2"><KpiDetail label="Remediation" value={kpi.remediation || "—"} /></div>
                      </div>
                      {/* Row 4: Source */}
                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                        <div className="col-span-2"><KpiDetail label="Structural Path" value={kpi.structural_path || kpi.section_path || kpi.section || "—"} /></div>
                        <KpiDetail label="Pages" value={kpi.page_start != null ? (kpi.page_end && kpi.page_end !== kpi.page_start ? `${kpi.page_start}–${kpi.page_end}` : `${kpi.page_start}`) : "—"} />
                        <KpiDetail label="Confidence" value={formatConfidence(kpi.confidence)} />
                      </div>
                      {/* Description / Notes */}
                      {(kpi.description || (kpi as any).notes || kpi.confidence_reason) && (
                        <div className="grid grid-cols-1 gap-2">
                          {kpi.description && <KpiDetail label="Description" value={kpi.description} />}
                          {(kpi as any).notes && <KpiDetail label="Notes" value={(kpi as any).notes} />}
                          {kpi.confidence_reason && <KpiDetail label="Confidence Reason" value={kpi.confidence_reason} />}
                        </div>
                      )}
                      {/* Quote */}
                      <div className="rounded-md border border-border bg-white p-2">
                        <div className="mb-1 flex items-center justify-between">
                          <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Verbatim</span>
                          <Button type="button" variant="ghost" size="sm" className="h-6 gap-1 px-2 text-[10px] text-muted-foreground" onClick={() => onCitationClick(kpi)}>
                            <ExternalLink className="h-3 w-3" /> View in PDF
                          </Button>
                        </div>
                        {quote
                          ? <blockquote className="max-h-28 overflow-auto whitespace-pre-wrap text-xs italic leading-5 text-gray-700">{quote}</blockquote>
                          : <p className="text-xs text-muted-foreground">No quote captured.</p>
                        }
                      </div>
                    </div>
                  )
                )}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

function KpiDetail({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0 rounded border border-border bg-white px-2 py-1.5">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-0.5 break-words text-xs leading-4 text-gray-800">{value}</div>
    </div>
  );
}

export function KpiFlagsPane({
  breaches,
  kpis,
  isLoading,
  onFlagRemediationEmail,
}: {
  breaches: ContractKPIBreach[];
  kpis: ContractKPI[];
  isLoading: boolean;
  onFlagRemediationEmail: (breach: ContractKPIBreach) => void | Promise<void>;
}) {
  const [expandedFlagId, setExpandedFlagId] = useState<string | null>(null);
  const kpiById = useMemo(() => new Map(kpis.map((kpi) => [kpi.kpi_id, kpi])), [kpis]);
  const orderedBreaches = useMemo(() => (
    breaches
      .filter((breach) => isKpiTracked(kpiById.get(breach.kpi_id)))
      .sort((a, b) => Number(Boolean(b.is_breach)) - Number(Boolean(a.is_breach)))
  ), [breaches, kpiById]);

  if (isLoading && !orderedBreaches.length) {
    return (
      <div className="space-y-3 p-4">
        {[1, 2, 3].map((item) => (
          <div key={item} className="h-20 rounded-lg border border-border bg-muted/30 animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div className="p-4">
      <div className="overflow-hidden rounded-lg border border-border bg-white">
        <div className="border-b border-border px-4 py-3">
          <h3 className="text-sm font-semibold text-gray-900">Compliance Flags</h3>
          <p className="mt-1 text-xs text-muted-foreground">Breach evaluation results from KPI actuals, sorted by flagged items first.</p>
        </div>
        {orderedBreaches.length === 0 ? (
          <div className="py-12 text-center text-sm italic text-muted-foreground">
            No compliance flags for tracked KPIs. Track a KPI, then upload actuals to run breach checks.
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {orderedBreaches.map((breach) => {
              const kpi = kpiById.get(breach.kpi_id);
              const isFlagged = Boolean(breach.is_breach);
              const isOpen = expandedFlagId === breach.breach_id;
              const emailReady = Boolean(breach.send_remediation_email || breach.breach_email_draft);
              const impact = kpi?.consequence_value != null
                ? `${kpi.consequence_value} ${kpi.consequence_unit || ""}`.trim()
                : "None";
              return (
                <div key={breach.breach_id || `${breach.kpi_id}-${breach.created_at}`} className="bg-white">
                  <div className="grid gap-3 px-4 py-3 transition-colors hover:bg-muted/50 md:grid-cols-[16px_minmax(240px,1fr)_120px_120px_110px_96px_24px] md:items-center">
                    <span className={`h-2.5 w-2.5 rounded-full ${isFlagged ? "bg-red-500" : "bg-emerald-500"}`} />
                    <button type="button" onClick={() => setExpandedFlagId(isOpen ? null : breach.breach_id)} className="min-w-0 text-left">
                      <p className="truncate text-sm font-semibold text-gray-900">{kpi?.name || breach.source_kpi?.name || breach.kpi_id}</p>
                      <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                        {breach.kpi_id} · {kpi?.kpi_type || "compliance"}
                        {(breach.remediation_sla || kpi?.remediation_sla) ? ` · SLA: ${breach.remediation_sla || kpi?.remediation_sla}` : ""}
                      </p>
                    </button>
                    <div className="text-xs font-semibold text-red-600">{impact}</div>
                    <span className={`w-fit rounded-full border px-2 py-1 text-[11px] font-semibold ${
                      isFlagged ? "border-red-200 bg-red-50 text-red-700" : "border-emerald-200 bg-emerald-50 text-emerald-700"
                    }`}>
                      {isFlagged ? "Open" : "Clear"}
                    </span>
                    <span className="w-fit rounded-full border border-border bg-muted/30 px-2 py-1 text-[11px] font-semibold text-gray-600">
                      {isFlagged ? "High" : "OK"}
                    </span>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 gap-1 px-2 text-[11px]"
                      onClick={() => onFlagRemediationEmail(breach)}
                      disabled={!isFlagged}
                    >
                      <Send className="h-3 w-3" />
                      {emailReady ? "Ready" : "Email"}
                    </Button>
                    <button type="button" onClick={() => setExpandedFlagId(isOpen ? null : breach.breach_id)} className="rounded p-1 hover:bg-gray-100">
                      <ChevronDown className={`h-4 w-4 text-gray-300 transition-transform ${isOpen ? "rotate-180" : ""}`} />
                    </button>
                  </div>

                  {isOpen && (
                    <div className="space-y-3 border-t border-border bg-muted/30 px-4 py-4">
                      <div className="grid gap-3 md:grid-cols-2">
                        <KpiDetail label="Expected (Contract)" value={`${breach.operator || kpi?.operator || ""} ${breach.expected_value ?? kpi?.value_min ?? kpi?.value ?? "N/A"} ${kpi?.unit || breach.actual_unit || ""}`.trim()} />
                        <KpiDetail label="Actual (Ingested)" value={`${breach.actual_value ?? "N/A"} ${breach.actual_unit || kpi?.unit || ""}`.trim()} />
                      </div>
                      <KpiDetail label="Contract Clause" value={kpi?.structural_path || kpi?.section || breach.source_kpi?.quote || "—"} />
                      <KpiDetail label="Recommended Action" value={breach.remediation || kpi?.remediation || "Standard monitoring — no escalation required."} />
                      {breach.breach_email_draft && (
                        <div className="rounded-md border border-border bg-white p-3">
                          <div className="mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                            <Send className="h-3 w-3" />
                            Remediation Email Draft
                          </div>
                          <pre className="max-h-64 overflow-auto whitespace-pre-wrap text-xs leading-5 text-gray-700">{breach.breach_email_draft}</pre>
                        </div>
                      )}
                      <div className="text-xs text-muted-foreground">
                        Evaluated {breach.created_at ? new Date(breach.created_at).toLocaleString() : "recently"}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export function KpiPerformanceLogsPane({
  actuals,
  kpis,
  isLoading,
}: {
  actuals: ContractKPIActual[];
  kpis: ContractKPI[];
  isLoading: boolean;
}) {
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);
  const kpiById = useMemo(() => new Map(kpis.map((kpi) => [kpi.kpi_id, kpi])), [kpis]);

  if (isLoading && !actuals.length) {
    return (
      <div className="space-y-3 p-4">
        {[1, 2, 3].map((item) => (
          <div key={item} className="h-20 rounded-lg border border-border bg-muted/30 animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div className="p-4">
      <div className="overflow-hidden rounded-lg border border-border bg-white">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
          <div>
            <h3 className="text-sm font-semibold text-gray-900">Performance Logs</h3>
            <p className="mt-1 text-xs text-muted-foreground">Actual values staged for KPI compliance evaluation.</p>
          </div>
          <span className="rounded-full border border-emerald-100 bg-emerald-50 px-2.5 py-1 text-[11px] text-emerald-700">
            {actuals.length.toLocaleString()} records fetched
          </span>
        </div>
        {actuals.length === 0 ? (
          <div className="px-6 py-12 text-center text-sm text-muted-foreground">
            <p className="italic">No performance logs yet. Upload actuals to begin threshold checks.</p>
            <p className="mt-2 text-xs">
              Accepted CSV/JSON fields: <span className="font-mono">kpi_id</span> or <span className="font-mono">kpi_name</span>, <span className="font-mono">value</span>, <span className="font-mono">unit</span>, <span className="font-mono">timestamp</span>.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {actuals.map((actual) => {
              const kpi = kpiById.get(actual.kpi_id);
              const isOpen = expandedLogId === actual.actual_id;
              const timestamp = actual.timestamp || actual.created_at;
              return (
                <div key={actual.actual_id || `${actual.kpi_id}-${timestamp}`} className="bg-white">
                  <button
                    type="button"
                    onClick={() => setExpandedLogId(isOpen ? null : actual.actual_id)}
                    className="grid w-full gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/50 md:grid-cols-[minmax(160px,0.8fr)_minmax(240px,1.2fr)_minmax(180px,0.8fr)_120px_24px] md:items-center"
                  >
                    <div>
                      <p className="text-xs font-bold text-gray-800">{actual.source || "manual"}</p>
                      <p className="mt-0.5 text-[10px] text-muted-foreground">{timestamp ? new Date(timestamp).toLocaleString() : "No timestamp"}</p>
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-xs font-semibold text-gray-900">{kpi?.name || actual.kpi_id}</p>
                      <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{actual.kpi_id}</p>
                    </div>
                    <p className="font-mono text-sm font-semibold text-gray-800">
                      {actual.value ?? "N/A"} {actual.unit || kpi?.unit || ""}
                    </p>
                    <span className="w-fit rounded-full border border-blue-100 bg-blue-50 px-2 py-1 text-[11px] font-semibold text-blue-700">
                      Logged
                    </span>
                    <ChevronDown className={`h-4 w-4 text-gray-300 transition-transform ${isOpen ? "rotate-180" : ""}`} />
                  </button>
                  {isOpen && (
                    <div className="space-y-3 border-t border-border bg-muted/30 px-4 py-4">
                      <KpiDetail label="Mapped Usage" value={`Feeds threshold check ${kpi?.operator || ""} ${kpi?.value_min ?? kpi?.value ?? ""} ${kpi?.unit || ""}`.trim() || "Mapped KPI"} />
                      <KpiDetail label="Field Sample" value={actual.metadata && Object.keys(actual.metadata).length ? JSON.stringify(actual.metadata, null, 2) : "No metadata captured"} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

const REDLINE_INLINE_PATTERN = /\[\[CS_REDLINE_(DEL|INS):(\d+)\]\]([\s\S]*?)\[\[\/CS_REDLINE_\1\]\]/g;

function renderInlineRedlineText(text: string, keyPrefix: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null;
  REDLINE_INLINE_PATTERN.lastIndex = 0;

  while ((match = REDLINE_INLINE_PATTERN.exec(text)) !== null) {
    if (match.index > cursor) {
      nodes.push(text.slice(cursor, match.index));
    }
    const kind = match[1];
    const changeId = match[2];
    const value = match[3];
    nodes.push(
      <span
        key={`${keyPrefix}-${kind}-${changeId}-${match.index}`}
        className={
          kind === "DEL"
            ? "rounded-sm bg-red-50 px-0.5 text-red-700 line-through decoration-red-500 decoration-2"
            : "rounded-sm bg-emerald-50 px-0.5 text-emerald-800 underline decoration-emerald-500 decoration-2 underline-offset-2"
        }
        title={kind === "DEL" ? `Deleted text · change ${changeId}` : `Inserted text · change ${changeId}`}
      >
        {value}
      </span>
    );
    cursor = REDLINE_INLINE_PATTERN.lastIndex;
  }

  if (cursor < text.length) {
    nodes.push(text.slice(cursor));
  }
  return nodes.length ? nodes : [text];
}

function docxPreviewBlocks(text: string) {
  return (text || "")
    .replace(/\s*\[\[DOCX_PAGE:(\d+)\]\]\s*/g, "\n\n[[DOCX_PAGE:$1]]\n\n")
    .split(/\n{2,}/);
}

/** Groups blocks into pages by `--- Page N ---` markers. Returns null if no page markers found. */
function groupBlocksByPage(blocks: string[]): string[][] | null {
  const pages: string[][] = [];
  let current: string[] = [];
  let hasMarker = false;

  for (const block of blocks) {
    const trimmed = block.trim();
    if (/^---\s*Page\s+\d+\s*---$/i.test(trimmed)) {
      hasMarker = true;
      if (current.length > 0) {
        pages.push(current);
        current = [];
      }
      continue;
    }
    current.push(block);
  }
  if (current.length > 0) pages.push(current);

  return hasMarker ? pages : null;
}

export function AgentDocumentPreviewPane({
  document,
  preview,
  isLoading,
  selectedVersionId,
  onVersionChange,
  onDownload,
  onResolveEdit,
  resolvingEditIds,
  onSaveText,
  isSaving,
}: {
  document: AgentDocumentSummary | null;
  preview: AgentDocumentPreview | null;
  isLoading: boolean;
  selectedVersionId: string;
  onVersionChange: (versionId: string) => void;
  onDownload: () => void;
  onResolveEdit: (edit: AgentEditAnnotation, mode: "accept" | "reject") => void;
  resolvingEditIds: Set<string>;
  onSaveText: (bodyText: string) => Promise<unknown>;
  isSaving: boolean;
}) {
  const effectiveDocument = document || preview?.document || null;
  const versions = effectiveDocument?.versions || [];
  const bodyText = preview?.body_text || "";
  const [mode, setMode] = useState<"preview" | "edit">("preview");
  const [draftText, setDraftText] = useState(bodyText);
  const redlineChanges = (
    preview?.redline_changes ||
    preview?.applied_redline_changes ||
    effectiveDocument?.redline_changes ||
    []
  );
  const unmatchedRedlines = preview?.unmatched_redline_changes || effectiveDocument?.unmatched_redline_changes || [];
  const editAnnotations = preview?.edit_annotations || [];
  const isRedline = Boolean(effectiveDocument?.artifact_kind?.includes("redline") || redlineChanges.length);
  const isDirty = draftText !== bodyText;

  useEffect(() => {
    setDraftText(bodyText);
    setMode("preview");
  }, [preview?.version_id, bodyText]);

  if (!effectiveDocument) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-center text-sm text-muted-foreground">
        Select a generated DOCX from the explorer.
      </div>
    );
  }

  return (
    <div className="flex min-h-full flex-col">
      <div className="flex min-h-12 items-center justify-between gap-3 border-b border-border bg-white px-4 py-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-gray-900">{preview?.filename || effectiveDocument.filename}</div>
          <div className="text-xs text-muted-foreground">
            {isRedline ? "Redline DOCX copy" : "Editable DOCX copy"} · Version {preview?.version_number || effectiveDocument.current_version_number || 1}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {versions.length > 1 && (
            <select
              value={selectedVersionId}
              onChange={(event) => onVersionChange(event.target.value)}
              className="h-8 rounded-md border border-border bg-white px-2 text-xs text-gray-700 outline-none focus:border-gray-400"
              aria-label="Select document version"
            >
              {versions.map((version) => (
                <option key={version.version_id} value={version.version_id}>
                  Version {version.version_number}
                </option>
              ))}
            </select>
          )}
          <div className="flex h-8 rounded-md border border-border bg-muted/30 p-0.5">
            <button
              type="button"
              onClick={() => setMode("preview")}
              className={`rounded px-2 text-xs font-medium ${mode === "preview" ? "bg-white text-gray-900 shadow-sm" : "text-muted-foreground hover:text-gray-900"}`}
            >
              Preview
            </button>
            <button
              type="button"
              onClick={() => setMode("edit")}
              className={`rounded px-2 text-xs font-medium ${mode === "edit" ? "bg-white text-gray-900 shadow-sm" : "text-muted-foreground hover:text-gray-900"}`}
            >
              Edit
            </button>
          </div>
          {mode === "edit" && (
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 gap-1 rounded-md bg-white px-2 text-xs"
                onClick={() => setDraftText(bodyText)}
                disabled={!isDirty || isSaving}
              >
                <X className="h-3.5 w-3.5" />
                Discard
              </Button>
              <Button
                type="button"
                size="sm"
                className="h-8 gap-1 rounded-md px-2 text-xs"
                onClick={async () => {
                  const saved = await onSaveText(draftText);
                  if (saved) setMode("preview");
                }}
                disabled={!isDirty || isSaving || !draftText.trim()}
              >
                {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ClipboardCheck className="h-3.5 w-3.5" />}
                Save
              </Button>
            </>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 gap-1 rounded-md bg-white px-2 text-xs"
            onClick={onDownload}
            disabled={!preview?.download_url}
          >
            <Download className="h-3.5 w-3.5" />
            Download
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex h-full min-h-[360px] items-center justify-center text-sm text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Loading DOCX preview...
        </div>
      ) : (
        <div className="flex-1 overflow-auto bg-gray-100 px-4 py-6">
          <div
            className="mx-auto min-h-[900px] max-w-[816px] bg-white px-16 py-14 text-[15px] leading-7 text-gray-950 shadow-sm ring-1 ring-gray-200 font-serif"
          >
            <h1 className="mb-8 text-center text-lg font-bold uppercase leading-7">
              {(preview?.document?.title || effectiveDocument.title || effectiveDocument.filename).replace(/\.docx$/i, "")}
            </h1>
            {isRedline && redlineChanges.length ? (
              <div className="mb-8 space-y-2 rounded-lg border border-blue-100 bg-blue-50/40 p-3 font-sans">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-sm font-semibold text-gray-900">Approved redline changes</h2>
                  <span className="rounded-full bg-white px-2 py-0.5 text-xs font-medium text-blue-700">
                    {redlineChanges.length} applied{unmatchedRedlines.length ? ` · ${unmatchedRedlines.length} unmatched` : ""}
                  </span>
                </div>
                {redlineChanges.map((change, index) => (
                  <div key={change.finding_id || index} className="rounded-md border border-border bg-white p-2 text-xs leading-5">
                    <div className="mb-1 font-semibold text-gray-900">{change.rule_name || `Change ${index + 1}`}</div>
                    <div className="grid gap-2 sm:grid-cols-2">
                      <div className="rounded border border-red-100 bg-red-50 px-2 py-1 text-red-800">
                        <div className="text-[10px] font-semibold uppercase tracking-wide text-red-500">Original</div>
                        {change.matched_text || "No source text matched"}
                      </div>
                      <div className="rounded border border-emerald-100 bg-emerald-50 px-2 py-1 text-emerald-800">
                        <div className="text-[10px] font-semibold uppercase tracking-wide text-emerald-600">Redline</div>
                        {change.suggested_revision || "[delete without replacement]"}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
            {editAnnotations.length ? (
              <div className="mb-8 space-y-2 rounded-lg border border-blue-100 bg-blue-50/40 p-3 font-sans">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-sm font-semibold text-gray-900">Tracked edits</h2>
                  <span className="rounded-full bg-white px-2 py-0.5 text-xs font-medium text-blue-700">
                    {editAnnotations.filter((edit) => edit.status === "pending").length} pending
                  </span>
                </div>
                {editAnnotations.map((edit) => {
                  const isPending = !edit.status || edit.status === "pending";
                  const isResolving = resolvingEditIds.has(edit.edit_id);
                  return (
                    <div key={edit.edit_id} className="rounded-md border border-border bg-white p-2 text-xs leading-5">
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <div className="min-w-0 truncate font-semibold text-gray-900">{edit.reason || "Tracked edit"}</div>
                        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize ${
                          edit.status === "accepted"
                            ? "bg-emerald-50 text-emerald-700"
                            : edit.status === "rejected"
                              ? "bg-red-50 text-red-700"
                              : "bg-amber-50 text-amber-700"
                        }`}>
                          {edit.status || "pending"}
                        </span>
                      </div>
                      <div className="grid gap-2 sm:grid-cols-2">
                        <div className="rounded border border-red-100 bg-red-50 px-2 py-1 text-red-800">
                          <div className="text-[10px] font-semibold uppercase tracking-wide text-red-500">Original</div>
                          {edit.deleted_text || "[empty]"}
                        </div>
                        <div className="rounded border border-emerald-100 bg-emerald-50 px-2 py-1 text-emerald-800">
                          <div className="text-[10px] font-semibold uppercase tracking-wide text-emerald-600">Replacement</div>
                          {edit.inserted_text || "[delete]"}
                        </div>
                      </div>
                      <div className="mt-2 flex items-center gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-7 gap-1 px-2 text-xs text-emerald-700"
                          disabled={!isPending || isResolving}
                          onClick={() => onResolveEdit(edit, "accept")}
                        >
                          <Check className="h-3.5 w-3.5" />
                          Accept
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-7 gap-1 px-2 text-xs text-red-700"
                          disabled={!isPending || isResolving}
                          onClick={() => onResolveEdit(edit, "reject")}
                        >
                          <X className="h-3.5 w-3.5" />
                          Reject
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : null}
            {mode === "edit" ? (
              <div className="space-y-3">
                <DocumentEditor
                  content={bodyText}
                  onChange={(text) => setDraftText(text)}
                />
                <div className="font-sans text-xs text-muted-foreground">
                  Saving creates a new DOCX version in the explorer.
                </div>
              </div>
            ) : bodyText ? (() => {
              const blocks = docxPreviewBlocks(bodyText);
              const pages = groupBlocksByPage(blocks);
              if (pages) {
                return (
                  <div className="space-y-8">
                    {pages.map((pageBlocks, pageIdx) => (
                      <div key={pageIdx} className="break-inside-avoid rounded-sm bg-white px-16 py-14 shadow-sm ring-1 ring-gray-200 font-serif min-h-[900px]">
                        {pageBlocks.map((block, index) => {
                          const trimmed = block.trim();
                          if (!trimmed) return null;
                          if (/^(Amendment \/ Applied Change|Converted Source Contract Text)$/i.test(trimmed)) {
                            return <h2 key={index} className="pt-3 text-base font-bold">{trimmed}</h2>;
                          }
                          if (/^Source page \d+/i.test(trimmed)) {
                            return <p key={index} className="text-right text-xs italic text-muted-foreground">{trimmed}</p>;
                          }
                          const pageMarker = trimmed.match(/^\[\[DOCX_PAGE:(\d+)\]\]$/);
                          if (pageMarker) {
                            return <p key={index} className="text-right text-xs italic text-muted-foreground">Source page {pageMarker[1]}</p>;
                          }
                          return (
                            <p key={index} className="whitespace-pre-wrap text-justify">
                              {isRedline ? renderInlineRedlineText(trimmed, `redline-${pageIdx}-${index}`) : trimmed}
                            </p>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                );
              }
              return (
                <div className="space-y-4">
                  {blocks.map((block, index) => {
                    const trimmed = block.trim();
                    if (!trimmed) return null;
                    if (trimmed === "--- Page Break ---") {
                      return (
                        <div key={`${index}-${trimmed}`} className="my-8 border-t border-dashed border-gray-300 pt-2 text-right text-xs italic text-muted-foreground">
                          Page break
                        </div>
                      );
                    }
                    if (/^(Amendment \/ Applied Change|Converted Source Contract Text)$/i.test(trimmed)) {
                      return <h2 key={`${index}-${trimmed}`} className="pt-3 text-base font-bold">{trimmed}</h2>;
                    }
                    if (/^Source page \d+/i.test(trimmed)) {
                      return <p key={`${index}-${trimmed}`} className="text-right text-xs italic text-muted-foreground">{trimmed}</p>;
                    }
                    const pageMarker = trimmed.match(/^\[\[DOCX_PAGE:(\d+)\]\]$/);
                    if (pageMarker) {
                      return <p key={`${index}-${trimmed}`} className="text-right text-xs italic text-muted-foreground">Source page {pageMarker[1]}</p>;
                    }
                    return (
                      <p key={`${index}-${trimmed.slice(0, 20)}`} className="whitespace-pre-wrap text-justify">
                        {isRedline ? renderInlineRedlineText(trimmed, `redline-${index}`) : trimmed}
                      </p>
                    );
                  })}
                </div>
              );
            })() : (
              <p className="text-sm text-muted-foreground">No preview text is available for this DOCX.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function ContractProjectExplorer({
  projectId,
  projectName,
  documents,
  agentDocuments,
  currentContractId,
  selectedAgentDocumentId,
  isLoading,
  isAgentDocumentsLoading,
  isCreatingEditableCopy,
  kpis,
  sourceCatalog,
  sourceConfigs,
  sourceFetchRuns,
  sourceActionResults,
  isSourceLoading,
  isExplorerOpen,
  onToggleExplorer,
  onOpenContractDocument,
  onOpenAgentDocument,
  onCreateEditableCopy,
  onCreateSourceConfig,
  onUpdateSourceConfig,
  onMapTrackedKpis,
  onTestSourceConfig,
  onFetchSourceConfig,
  onLoadFetchRuns,
  onRefreshSources,
}: {
  projectId: string | null;
  projectName: string;
  documents: WorkspaceDocumentSummary[];
  agentDocuments: AgentDocumentSummary[];
  currentContractId: string;
  selectedAgentDocumentId: string | null;
  isLoading: boolean;
  isAgentDocumentsLoading: boolean;
  isCreatingEditableCopy: boolean;
  kpis: ContractKPI[];
  sourceCatalog: KPISourceCatalogItem[];
  sourceConfigs: KPISourceConfig[];
  sourceFetchRuns: Record<string, KPISourceFetchRun[]>;
  sourceActionResults: Record<string, any>;
  isSourceLoading: boolean;
  isExplorerOpen: boolean;
  onToggleExplorer: () => void;
  onOpenContractDocument: () => void;
  onOpenAgentDocument: (documentId: string, versionId?: string) => void;
  onCreateEditableCopy: () => void;
  onCreateSourceConfig: (source: KPISourceCatalogItem) => void | Promise<void>;
  onUpdateSourceConfig: (config: KPISourceConfig, updates: Partial<KPISourceConfig>) => void | Promise<KPISourceConfig | undefined>;
  onMapTrackedKpis: (config: KPISourceConfig) => void | Promise<void>;
  onTestSourceConfig: (config: KPISourceConfig, payload?: any) => void | Promise<void>;
  onFetchSourceConfig: (config: KPISourceConfig, payload?: any) => void | Promise<void>;
  onLoadFetchRuns: (config: KPISourceConfig) => void | Promise<void>;
  onRefreshSources: () => void | Promise<void>;
}) {
  const [sourceFamilyFilter, setSourceFamilyFilter] = useState<string>("all");
  const [selectedSourceConfigId, setSelectedSourceConfigId] = useState<string | null>(null);
  const [sourceSetupTab, setSourceSetupTab] = useState<"connection" | "mapping" | "validation" | "fetch">("connection");
  const [samplePayloadDraft, setSamplePayloadDraft] = useState<string>("");
  const trackedCount = kpis.filter(isKpiTracked).length;
  const userSourceCatalog = useMemo(() => (
    sourceCatalog.filter((source) => source.enabled_for_contract_users !== false && USER_KPI_SOURCE_TYPES.has(source.source_type))
  ), [sourceCatalog]);
  const userSourceConfigs = useMemo(() => (
    sourceConfigs.filter((config) => USER_KPI_SOURCE_TYPES.has(config.source_type))
  ), [sourceConfigs]);
  const platformManagedCount = Math.max(0, sourceConfigs.length - userSourceConfigs.length);
  const selectedSourceConfig = useMemo(() => (
    userSourceConfigs.find((config) => config.source_config_id === selectedSourceConfigId) || userSourceConfigs[0] || null
  ), [userSourceConfigs, selectedSourceConfigId]);
  const selectedRuns = selectedSourceConfig ? sourceFetchRuns[selectedSourceConfig.source_config_id] || [] : [];
  const selectedActionResult = selectedSourceConfig ? sourceActionResults[selectedSourceConfig.source_config_id] : null;
  const catalogFamilies = useMemo(() => (
    Array.from(new Set(userSourceCatalog.map((source) => source.family || "other"))).sort()
  ), [userSourceCatalog]);
  const visibleCatalog = useMemo(() => (
    sourceFamilyFilter === "all"
      ? userSourceCatalog
      : userSourceCatalog.filter((source) => (source.family || "other") === sourceFamilyFilter)
  ), [userSourceCatalog, sourceFamilyFilter]);
  const uploadHref = projectId
    ? `/dashboard?project_id=${encodeURIComponent(projectId)}&tab=contracts&upload=1`
    : "/dashboard?upload=1";

  useEffect(() => {
    if (!userSourceConfigs.length) {
      if (selectedSourceConfigId) setSelectedSourceConfigId(null);
      return;
    }
    if (!selectedSourceConfigId || !userSourceConfigs.some((config) => config.source_config_id === selectedSourceConfigId)) {
      setSelectedSourceConfigId(userSourceConfigs[0].source_config_id);
    }
  }, [userSourceConfigs, selectedSourceConfigId]);

  useEffect(() => {
    if (!selectedSourceConfig) return;
    setSamplePayloadDraft(
      selectedSourceConfig.sample_payload == null
        ? ""
        : typeof selectedSourceConfig.sample_payload === "string"
          ? selectedSourceConfig.sample_payload
          : JSON.stringify(selectedSourceConfig.sample_payload, null, 2)
    );
    void onLoadFetchRuns(selectedSourceConfig);
  }, [selectedSourceConfig?.source_config_id]);

  const updateSelectedSource = (updates: Partial<KPISourceConfig>) => {
    if (!selectedSourceConfig) return;
    void onUpdateSourceConfig(selectedSourceConfig, updates);
  };

  const updateSelectedMapping = (kpiField: string, sourceField: string, transform?: string) => {
    if (!selectedSourceConfig) return;
    const mappings = [...(selectedSourceConfig.field_mappings || [])];
    const index = mappings.findIndex((mapping) => mapping.kpi_field === kpiField);
    const nextMapping = { kpi_field: kpiField, source_field: sourceField, transform: transform || mappings[index]?.transform || "string" };
    if (index >= 0) mappings[index] = { ...mappings[index], ...nextMapping };
    else mappings.push(nextMapping);
    updateSelectedSource({ field_mappings: mappings });
  };

  const saveSamplePayload = () => {
    if (!selectedSourceConfig) return;
    if (!samplePayloadDraft.trim()) {
      updateSelectedSource({ sample_payload: null });
      return;
    }
    const trimmed = samplePayloadDraft.trim();
    const shouldParseJson = selectedSourceConfig.source_type === "json" || trimmed.startsWith("{") || trimmed.startsWith("[");
    try {
      updateSelectedSource({ sample_payload: shouldParseJson ? JSON.parse(samplePayloadDraft) : samplePayloadDraft });
      toast({ title: "Sample payload saved", description: "Preview fetch will use this upload sample for validation." });
    } catch {
      toast({ title: "Invalid sample JSON", description: "Fix the sample payload before saving.", variant: "destructive" });
    }
  };

  const mappingSourceField = (kpiField: string) => (
    selectedSourceConfig?.field_mappings?.find((mapping) => mapping.kpi_field === kpiField)?.source_field || ""
  );
  const sourceStatusTone = (config: KPISourceConfig) => (
    config.last_error
      ? "border-red-200 bg-red-50 text-red-700"
      : config.enabled || config.status === "enabled"
        ? "border-emerald-200 bg-emerald-50 text-emerald-700"
        : config.status === "ready" || config.status === "mapped"
          ? "border-blue-200 bg-blue-50 text-blue-700"
          : "border-amber-200 bg-amber-50 text-amber-700"
  );

  if (!isExplorerOpen) {
    return (
      <aside className="hidden w-[48px] shrink-0 flex-col items-center border-r border-border bg-white py-2 md:flex">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-muted-foreground hover:text-gray-950"
          onClick={onToggleExplorer}
          title="Expand explorer"
        >
          <PanelLeftOpen className="h-4 w-4" />
        </Button>
        <div className="mt-3 flex flex-col items-center gap-1.5 overflow-y-auto px-1">
          {documents.map((document) => {
            const isCurrent = !selectedAgentDocumentId && document._id === currentContractId;
            return (
              <Link
                key={document._id}
                href={`/contracts/${document._id}`}
                title={document.contract_name}
                onClick={() => {
                  if (document._id === currentContractId) onOpenContractDocument();
                }}
                className={`group relative flex h-8 w-8 items-center justify-center rounded-md transition-colors ${
                  isCurrent ? "bg-cs-primary/10 text-cs-primary" : "text-muted-foreground hover:bg-muted/50 hover:text-gray-600"
                }`}
              >
                <FileText className="h-4 w-4" />
                <span className="pointer-events-none absolute left-full z-50 ml-2 whitespace-nowrap rounded-md bg-gray-900 px-2 py-1 text-xs text-white opacity-0 shadow-md transition-opacity group-hover:opacity-100">
                  {document.contract_name}
                </span>
              </Link>
            );
          })}
        </div>
      </aside>
    );
  }

  return (
    <aside className="hidden w-[260px] shrink-0 flex-col border-r border-border bg-white md:flex xl:w-[300px]">
      <div className="flex h-12 items-center justify-between border-b border-border px-4">
        <div className="text-sm font-medium text-gray-800">Explorer</div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground hover:text-gray-950"
            onClick={onToggleExplorer}
            title="Collapse explorer"
          >
            <PanelLeftClose className="h-4 w-4" />
          </Button>
          <Button
            asChild
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground hover:text-gray-950"
            title="Upload document"
          >
            <Link href={uploadHref} aria-label="Upload document">
              <UploadCloud className="h-4 w-4" />
            </Link>
          </Button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        <div className="mb-3 flex min-w-0 items-center gap-2 px-1 text-sm text-gray-600">
          <FolderOpen className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="truncate">{projectName}</span>
        </div>

        {isLoading && documents.length <= 1 ? (
          <div className="space-y-2 px-1">
            {[1, 2, 3].map((item) => (
              <div key={item} className="h-8 rounded-md bg-gray-100 animate-pulse" />
            ))}
          </div>
        ) : (
          <div className="space-y-1">
            {documents.map((document) => {
              const isCurrent = !selectedAgentDocumentId && document._id === currentContractId;
              return (
                <Link
                  key={document._id}
                  href={`/contracts/${document._id}`}
                  title={document.contract_name}
                  onClick={() => {
                    if (document._id === currentContractId) onOpenContractDocument();
                  }}
                  className={`flex min-w-0 items-center gap-2 rounded-lg px-2 py-2 text-sm transition-colors ${
                    isCurrent ? "bg-cs-primary/10 text-cs-primary" : "text-gray-600 hover:bg-muted/50 hover:text-gray-950"
                  }`}
                >
                  <FileText className={`h-4 w-4 shrink-0 ${isCurrent ? "text-cs-primary" : "text-rose-500"}`} />
                  <span className="truncate">{truncateMiddle(document.contract_name, 34)}</span>
                </Link>
              );
            })}
          </div>
        )}

        <div className="mt-5 border-t border-border pt-4">
          <div className="mb-2 flex items-center justify-between gap-2 px-1">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Agent documents</div>
            <TooltipProvider delayDuration={150}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-gray-500 hover:text-gray-900"
                    onClick={onCreateEditableCopy}
                    disabled={isCreatingEditableCopy}
                  >
                    {isCreatingEditableCopy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Copy className="h-3.5 w-3.5" />}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Copy</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>

          {isAgentDocumentsLoading && !agentDocuments.length ? (
            <div className="space-y-2 px-1">
              {[1, 2].map((item) => (
                <div key={item} className="h-8 rounded-md bg-gray-100 animate-pulse" />
              ))}
            </div>
          ) : agentDocuments.length ? (
            <div className="space-y-1">
              {agentDocuments.map((document) => {
                const isSelected = selectedAgentDocumentId === document.document_id;
                return (
                  <button
                    key={document.document_id}
                    type="button"
                    title={document.filename}
                    onClick={() => onOpenAgentDocument(document.document_id)}
                    className={`flex w-full min-w-0 items-center gap-2 rounded-lg px-2 py-2 text-left text-sm transition-colors ${
                      isSelected ? "bg-blue-50 text-blue-900 ring-1 ring-blue-100" : "text-gray-600 hover:bg-muted/50 hover:text-gray-950"
                    }`}
                  >
                    <FileText className={`h-4 w-4 shrink-0 ${isSelected ? "text-blue-600" : "text-blue-500"}`} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{truncateMiddle(document.filename, 32)}</span>
                      <span className="block truncate text-[11px] text-muted-foreground">
                        DOCX · Version {document.current_version_number || document.versions?.[0]?.version_number || 1}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="rounded-lg px-1 py-2 text-xs leading-5 text-muted-foreground">
              No generated DOCX yet.
            </div>
          )}
        </div>

        {false && (
        <div className="mt-5 border-t border-border pt-4">
          <div className="mb-2 flex items-center justify-between gap-2 px-1">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">KPI Actual Sources</div>
              <div className="mt-0.5 text-[11px] text-muted-foreground">{trackedCount} tracked KPI{trackedCount === 1 ? "" : "s"} · uploads/manual only</div>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs text-gray-600 hover:text-gray-950"
              onClick={onRefreshSources}
              disabled={isSourceLoading}
              title="Refresh sources"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isSourceLoading ? "animate-spin" : ""}`} />
            </Button>
          </div>
          {platformManagedCount > 0 && (
            <div className="mb-2 rounded-md border border-blue-100 bg-blue-50 px-2 py-1.5 text-[11px] leading-4 text-blue-800">
              {platformManagedCount} enterprise integration{platformManagedCount === 1 ? "" : "s"} managed from the main Integrations area.
            </div>
          )}

          <div className="space-y-2">
            {userSourceConfigs.length ? (
              <div className="space-y-1">
                {userSourceConfigs.map((config) => {
                  const selected = selectedSourceConfig?.source_config_id === config.source_config_id;
                  return (
                    <button
                      key={config.source_config_id}
                      type="button"
                      onClick={() => setSelectedSourceConfigId(config.source_config_id)}
                      className={`w-full rounded-lg border p-2 text-left transition-colors ${
                        selected ? "border-blue-200 bg-blue-50" : "border-border bg-muted/30 hover:border-gray-300"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="min-w-0">
                          <span className="block truncate text-xs font-semibold text-gray-900">{config.display_name}</span>
                          <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                            {titleCase(config.source_type)} · {titleCase(config.schedule?.cadence || "manual")} · {config.kpi_ids?.length || 0} KPIs
                          </span>
                        </span>
                        <span className={`shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${sourceStatusTone(config)}`}>
                          {titleCase(config.last_error ? "last_fetch_failed" : config.enabled ? "enabled" : config.status || "draft")}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-border bg-muted/30 px-3 py-3 text-xs leading-5 text-muted-foreground">
                No actual source configured yet. Add CSV, Excel, JSON, XML, or manual evidence below, then map fields and validate a sample fetch.
              </div>
            )}

            {selectedSourceConfig && (
              <div className="rounded-lg border border-border bg-white p-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-xs font-semibold text-gray-950">{selectedSourceConfig.display_name}</p>
                    <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                      Last success: {selectedSourceConfig.last_success_at || "not yet"}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-[11px] text-muted-foreground"
                    onClick={() => {
                      navigator.clipboard?.writeText(JSON.stringify(selectedSourceConfig, null, 2));
                      toast({ title: "Source copied", description: "Actual source JSON copied for review." });
                    }}
                  >
                    JSON
                  </Button>
                </div>

                <div className="mt-2 grid grid-cols-4 gap-1 rounded-md bg-gray-100 p-1">
                  {[
                    { id: "connection", label: "Upload" },
                    { id: "mapping", label: "Map" },
                    { id: "validation", label: "Rules" },
                    { id: "fetch", label: "Fetch" },
                  ].map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setSourceSetupTab(tab.id as typeof sourceSetupTab)}
                      className={`rounded px-1 py-1 text-[10px] font-semibold ${
                        sourceSetupTab === tab.id ? "bg-white text-gray-950 shadow-sm" : "text-muted-foreground hover:text-gray-800"
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>

                {sourceSetupTab === "connection" && (
                  <div className="mt-2 space-y-2">
                    <div className="rounded-md border border-border bg-muted/30 px-2 py-2">
                      <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">User-facing source</p>
                      <p className="mt-1 text-[11px] leading-4 text-muted-foreground">
                        Contract users can upload or paste actuals here. SAP, Oracle, REST, S3, and warehouse connectors are configured by ContractSense in Integrations.
                      </p>
                    </div>
                    <label className="block text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                      Display name
                      <input
                        key={`${selectedSourceConfig.source_config_id}-name`}
                        defaultValue={selectedSourceConfig.display_name}
                        onBlur={(event) => updateSelectedSource({ display_name: event.target.value })}
                        className="mt-1 h-8 w-full rounded-md border border-border px-2 text-xs font-medium text-gray-800"
                      />
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      <label className="block text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                        Source type
                        <select
                          value={selectedSourceConfig.source_type}
                          onChange={(event) => updateSelectedSource({ source_type: event.target.value, file_format: event.target.value === "manual_attestation" ? "json" : event.target.value })}
                          className="mt-1 h-8 w-full rounded-md border border-border bg-white px-2 text-xs text-gray-700"
                        >
                          <option value="csv">CSV</option>
                          <option value="xlsx">Excel</option>
                          <option value="json">JSON</option>
                          <option value="xml">XML</option>
                          <option value="manual_attestation">Manual</option>
                        </select>
                      </label>
                      <label className="block text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                        Record path
                        <input
                          key={`${selectedSourceConfig.source_config_id}-record`}
                          defaultValue={selectedSourceConfig.record_path || ""}
                          onBlur={(event) => updateSelectedSource({ record_path: event.target.value })}
                          placeholder="records or data.rows"
                          className="mt-1 h-8 w-full rounded-md border border-border px-2 text-xs text-gray-700"
                        />
                      </label>
                    </div>
                    <Textarea
                      value={samplePayloadDraft}
                      onChange={(event) => setSamplePayloadDraft(event.target.value)}
                      placeholder='Paste sample JSON rows, or a CSV preview such as: kpi_id,value,timestamp'
                      className="min-h-[96px] resize-y font-mono text-[11px]"
                    />
                    <Button type="button" variant="outline" size="sm" className="h-7 w-full text-[11px]" onClick={saveSamplePayload}>
                      Save Sample Payload
                    </Button>
                  </div>
                )}

                {sourceSetupTab === "mapping" && (
                  <div className="mt-2 space-y-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 w-full text-[11px]"
                      onClick={() => onMapTrackedKpis(selectedSourceConfig)}
                      disabled={isSourceLoading || trackedCount === 0}
                    >
                      Map {trackedCount} Tracked KPI{trackedCount === 1 ? "" : "s"}
                    </Button>
                    {[
                      ["kpi_id", "kpi_id", "string"],
                      ["kpi_name", "kpi_name", "string"],
                      ["actual_value", "value", "number"],
                      ["timestamp", "timestamp", "datetime"],
                      ["unit", "unit", "string"],
                      ["period", "period", "string"],
                      ["source_record_id", "record_id", "string"],
                    ].map(([kpiField, placeholder, transform]) => (
                      <label key={kpiField} className="grid grid-cols-[92px_1fr] items-center gap-2 text-[10px] font-semibold text-muted-foreground">
                        <span>{kpiField}</span>
                        <input
                          key={`${selectedSourceConfig.source_config_id}-${kpiField}`}
                          defaultValue={mappingSourceField(kpiField)}
                          onBlur={(event) => updateSelectedMapping(kpiField, event.target.value || placeholder, transform)}
                          placeholder={placeholder}
                          className="h-8 rounded-md border border-border px-2 text-xs text-gray-700"
                        />
                      </label>
                    ))}
                  </div>
                )}

                {sourceSetupTab === "validation" && (
                  <div className="mt-2 space-y-2">
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        key={`${selectedSourceConfig.source_config_id}-dedupe`}
                        defaultValue={selectedSourceConfig.dedupe_key || "source_record_id"}
                        onBlur={(event) => updateSelectedSource({ dedupe_key: event.target.value })}
                        placeholder="dedupe key"
                        className="h-8 rounded-md border border-border px-2 text-xs"
                      />
                      <input
                        key={`${selectedSourceConfig.source_config_id}-watermark`}
                        defaultValue={selectedSourceConfig.watermark_field || "timestamp"}
                        onBlur={(event) => updateSelectedSource({ watermark_field: event.target.value })}
                        placeholder="watermark field"
                        className="h-8 rounded-md border border-border px-2 text-xs"
                      />
                    </div>
                    <div className="rounded-md border border-border bg-muted/30 p-2">
                      <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Required checks</p>
                      <div className="mt-2 flex flex-wrap gap-1">
                        {["kpi_id/kpi_name", "actual_value", "timestamp", "dedupe"].map((field) => (
                          <span key={field} className="rounded bg-emerald-50 px-2 py-1 text-[10px] font-semibold text-emerald-700">{field}</span>
                        ))}
                      </div>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 w-full gap-1 text-[11px]"
                      onClick={() => onTestSourceConfig(selectedSourceConfig)}
                      disabled={isSourceLoading}
                    >
                      {isSourceLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                      Validate Fetch
                    </Button>
                    {selectedActionResult?.skipped_rows?.length ? (
                      <div className="rounded-md border border-amber-200 bg-amber-50 p-2 text-[11px] text-amber-800">
                        {selectedActionResult.skipped_rows.length} skipped row{selectedActionResult.skipped_rows.length === 1 ? "" : "s"} in latest validation.
                      </div>
                    ) : null}
                  </div>
                )}

                {sourceSetupTab === "fetch" && (
                  <div className="mt-2 space-y-2">
                    <div className="rounded-md border border-border bg-muted/30 px-2 py-2">
                      <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Manual upload run</p>
                      <p className="mt-1 text-[11px] leading-4 text-muted-foreground">
                        Validate the mapped upload sample, then ingest actuals on demand. Automated polling stays platform-managed in Integrations.
                      </p>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <Button type="button" variant="outline" size="sm" className="h-8 gap-1 text-[11px]" onClick={() => onTestSourceConfig(selectedSourceConfig)} disabled={isSourceLoading}>
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        Test Fetch
                      </Button>
                      <Button type="button" size="sm" className="h-8 gap-1 bg-cs-primary text-[11px] text-white hover:bg-cs-primary/90" onClick={() => onFetchSourceConfig(selectedSourceConfig)} disabled={isSourceLoading}>
                        {isSourceLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                        Fetch Now
                      </Button>
                    </div>
                    <div className="grid grid-cols-2 gap-1 text-[10px] text-muted-foreground">
                      <span className="rounded bg-muted/30 px-1.5 py-1">Mode: Manual</span>
                      <span className="rounded bg-muted/30 px-1.5 py-1">Watermark: {selectedSourceConfig.watermark_value || "none"}</span>
                    </div>
                    <div className="max-h-36 space-y-1 overflow-y-auto">
                      {selectedRuns.length ? selectedRuns.slice(0, 5).map((run) => (
                        <div key={run.run_id} className="rounded-md border border-border bg-muted/30 px-2 py-1.5">
                          <div className="flex items-center justify-between gap-2 text-[11px]">
                            <span className="truncate font-semibold text-gray-700">{titleCase(run.status || "run")}</span>
                            <span className="text-muted-foreground">{run.records_accepted || 0}/{run.records_fetched || 0}</span>
                          </div>
                          <p className="mt-0.5 truncate text-[10px] text-muted-foreground">{run.trigger_type || "manual"} · {run.finished_at || run.started_at || "running"}</p>
                        </div>
                      )) : (
                        <div className="rounded-md border border-dashed border-border px-2 py-2 text-[11px] text-muted-foreground">No fetch runs yet.</div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="mt-3 rounded-lg border border-border bg-white p-2">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="text-[11px] font-semibold text-gray-700">Actual Source Library</div>
              <select
                value={sourceFamilyFilter}
                onChange={(event) => setSourceFamilyFilter(event.target.value)}
                className="h-7 rounded-md border border-border bg-white px-2 text-[11px] text-gray-600"
              >
                <option value="all">All</option>
                {catalogFamilies.map((family) => (
                  <option key={family} value={family}>{titleCase(family)}</option>
                ))}
              </select>
            </div>
            <div className="max-h-72 space-y-1 overflow-y-auto pr-1">
              {(visibleCatalog.length ? visibleCatalog : userSourceCatalog).map((source) => (
                <button
                  key={source.source_type}
                  type="button"
                  onClick={() => onCreateSourceConfig(source)}
                  disabled={isSourceLoading}
                  className="flex w-full items-center justify-between gap-2 rounded-md border border-border bg-muted/30 px-2 py-2 text-left transition-colors hover:border-blue-200 hover:bg-blue-50 disabled:opacity-60"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-xs font-semibold text-gray-900">{source.label}</span>
                    <span className="block truncate text-[10px] text-muted-foreground">
                      {titleCase(source.family || "source")} · {(source.auth_types || []).slice(0, 2).join(", ") || "no auth"}
                    </span>
                  </span>
                  <Plus className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                </button>
              ))}
            </div>
          </div>
        </div>
        )}
      </div>
    </aside>
  );
}

export function getStatusBadgeClass(status: string | undefined): string {
  switch (status) {
    case "Uploaded": return "bg-gray-100 text-gray-700 border border-gray-300";
    case "Indexing":
    case "Summarizing":
    case "Processing": return "bg-yellow-100 text-yellow-800 border border-yellow-300 animate-pulse";
    case "Ready to Edit": return "bg-gray-100 text-gray-800 border border-gray-300";
    case "Editing": return "bg-zinc-100 text-zinc-800 border border-zinc-300";
    case "Pending Approval": return "bg-amber-100 text-amber-800 border border-amber-300";
    case "Rejected": return "bg-red-100 text-red-800 border border-red-300";
    case "Completed": return "bg-green-100 text-green-800 border border-green-300";
    default: return "bg-gray-100 text-muted-foreground border border-gray-300";
  }
}

export function getStatusIcon(status: string | undefined): React.ReactNode {
  switch (status) {
    case "Uploaded": return <Upload className="h-3 w-3 mr-1 inline-block" />;
    case "Indexing":
    case "Summarizing":
    case "Processing": return <RefreshCw className="h-3 w-3 mr-1 inline-block animate-spin" />;
    case "Ready to Edit": return <FileText className="h-3 w-3 mr-1 inline-block" />;
    case "Editing": return <ClipboardEdit className="h-3 w-3 mr-1 inline-block" />;
    case "Pending Approval": return <Search className="h-3 w-3 mr-1 inline-block" />;
    case "Rejected": return <ClipboardX className="h-3 w-3 mr-1 inline-block" />;
    case "Completed": return <ClipboardCheck className="h-3 w-3 mr-1 inline-block" />;
    default: return <Clock className="h-3 w-3 mr-1 inline-block" />;
  }
}
