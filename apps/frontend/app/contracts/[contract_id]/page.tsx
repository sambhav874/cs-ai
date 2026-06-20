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
      <Loader2 className="h-8 w-8 animate-spin text-gray-500" />
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
  const parts: string[] = [];
  if (kpi.operator && kpi.operator !== "=") parts.push(kpi.operator);
  if (kpi.value_min != null || kpi.value_max != null) {
    parts.push(`${kpi.value_min ?? "?"}${kpi.value_max != null ? ` - ${kpi.value_max}` : ""}`);
  } else if (kpi.value != null && kpi.value !== "") {
    parts.push(String(kpi.value));
  }
  if (kpi.unit) parts.push(kpi.unit);
  return parts.length ? parts.join(" ") : "Not specified";
}

function formatConsequence(kpi: ContractKPI) {
  const parts: string[] = [];
  if (kpi.consequence_value != null) parts.push(String(kpi.consequence_value));
  if (kpi.consequence_unit) parts.push(kpi.consequence_unit);
  if (kpi.aggregation_type) parts.push(`(${titleCase(kpi.aggregation_type)})`);
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
    case "ignored": return "border-gray-200 bg-gray-50 text-gray-500";
    case "needs_review": return "border-amber-200 bg-amber-50 text-amber-700";
    default: return "border-blue-100 bg-blue-50 text-blue-700";
  }
}

export default function ContractView() {
  const [contract, setContract] = useState<FullContractData | null>(null);
  const [workspaceProject, setWorkspaceProject] = useState<ProjectSummary | null>(null);
  const [workspaceDocuments, setWorkspaceDocuments] = useState<WorkspaceDocumentSummary[]>([]);
  const [agentDocuments, setAgentDocuments] = useState<AgentDocumentSummary[]>([]);
  const [selectedAgentDocument, setSelectedAgentDocument] = useState<{ documentId: string; versionId: string } | null>(null);
  const [agentDocumentPreview, setAgentDocumentPreview] = useState<AgentDocumentPreview | null>(null);
  const [isAgentDocumentsLoading, setIsAgentDocumentsLoading] = useState(false);
  const [isAgentDocumentPreviewLoading, setIsAgentDocumentPreviewLoading] = useState(false);
  const [isExplorerOpen, setIsExplorerOpen] = useState(true);
  const [isCreatingEditableCopy, setIsCreatingEditableCopy] = useState(false);
  const [isSavingAgentDocument, setIsSavingAgentDocument] = useState(false);
  const [resolvingAgentEditIds, setResolvingAgentEditIds] = useState<Set<string>>(() => new Set());
  const [contractKpis, setContractKpis] = useState<ContractKPI[]>([]);
  const [contractKpiSummary, setContractKpiSummary] = useState<ContractKPISummary | null>(null);
  const [contractKpiActuals, setContractKpiActuals] = useState<ContractKPIActual[]>([]);
  const [contractKpiBreaches, setContractKpiBreaches] = useState<ContractKPIBreach[]>([]);
  const [kpiSourceCatalog, setKpiSourceCatalog] = useState<KPISourceCatalogItem[]>([]);
  const [kpiSourceConfigs, setKpiSourceConfigs] = useState<KPISourceConfig[]>([]);
  const [kpiSourceFetchRuns, setKpiSourceFetchRuns] = useState<Record<string, KPISourceFetchRun[]>>({});
  const [kpiSourceActionResults, setKpiSourceActionResults] = useState<Record<string, any>>({});
  const [isKpisLoading, setIsKpisLoading] = useState(false);
  const [isExtractingKpis, setIsExtractingKpis] = useState(false);
  const [isUploadingKpiActuals, setIsUploadingKpiActuals] = useState(false);
  const [isKpiMonitoringLoading, setIsKpiMonitoringLoading] = useState(false);
  const [isKpiSourceLoading, setIsKpiSourceLoading] = useState(false);
  const [isWorkspaceLoading, setIsWorkspaceLoading] = useState(false);
  const [storedProjectId, setStoredProjectId] = useState<string | null>(null);
  const [currentUserInfo, setCurrentUserInfo] = useState<UserInDB | null>(null);
  const [loadingContract, setLoadingContract] = useState(true);
  const [loadingUser, setLoadingUser] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [selectedVersionIndex, setSelectedVersionIndex] = useState(0);
  const [latestVersionNum, setLatestVersionNum] = useState(0);
  const [isClientLoaded, setIsClientLoaded] = useState(false);

  const [searchValue, setSearchValue] = useState("");
  const [pdfViewerContractId, setPdfViewerContractId] = useState<string | null>(null);
  const [pdfViewerDocumentName, setPdfViewerDocumentName] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<string>("default");
  const [isKpiAgentOpen, setIsKpiAgentOpen] = useState(false);
  const [rawSearchValue, setRawSearchValue] = useState<string>("");
  const [highlightedRawContent, setHighlightedRawContent] = useState<string>("");
  const rawViewRef = useRef<HTMLDivElement>(null);
  const handledKpiCitationRef = useRef<string | null>(null);

  const [totalHighlights, setTotalHighlights] = useState<number>(0);
  const [currentHighlightIndex, setCurrentHighlightIndex] = useState<number>(0);
  const [activeHighlightIndex, setActiveHighlightIndex] = useState<number | null>(null);

  const [isSavingDraft, setIsSavingDraft] = useState(false);
  const [isSubmittingVersion, setIsSubmittingVersion] = useState(false);
  const [isSubmittingApproval, setIsSubmittingApproval] = useState(false);
  const [isApproving, setIsApproving] = useState(false);
  const [isRejecting, setIsRejecting] = useState(false);
  const [isCompleting, setIsCompleting] = useState(false);
  const [isRejectModalOpen, setIsRejectModalOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");

  const [aiProvider, setAiProvider] = useState<string>('groq');

  const [isRequestingReEdit, setIsRequestingReEdit] = useState(false);
  const [isApprovingReEdit, setIsApprovingReEdit] = useState(false);
  const [isDenyingReEdit, setIsDenyingReEdit] = useState(false);
  const [isReEditRequestModalOpen, setIsReEditRequestModalOpen] = useState(false);
  const [isDenyReEditModalOpen, setIsDenyReEditModalOpen] = useState(false);
  const [reEditRequestReason, setReEditRequestReason] = useState("");
  const [reEditDenialReason, setReEditDenialReason] = useState("");



  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  const { selectedAccountId } = useAccountContext();
  const contractId = typeof params?.contract_id === 'string' ? params.contract_id : undefined;
  const initialAgentSessionId = searchParams.get("session_id");
  const apiUrl = process.env.NEXT_PUBLIC_EXTRACTOR_API_URL;

  useEffect(() => {
    setPdfViewerContractId(contractId || null);
    setPdfViewerDocumentName(null);
  }, [contractId]);

  const workspaceProjectId = useMemo(() => (
    contract?.projectId ||
    contract?.project_id ||
    contract?.project?._id ||
    storedProjectId ||
    null
  ), [contract?.projectId, contract?.project_id, contract?.project?._id, storedProjectId]);

  const contractProjectId = useMemo(() => (
    contract?.projectId ||
    contract?.project_id ||
    contract?.project?._id ||
    null
  ), [contract?.projectId, contract?.project_id, contract?.project?._id]);

  const workspaceProjectName = useMemo(() => (
    workspaceProject?.name ||
    contract?.project?.name ||
    contract?.project_name ||
    "Contracts"
  ), [workspaceProject?.name, contract?.project?.name, contract?.project_name]);

  const explorerDocuments = useMemo(() => {
    if (!contract) return workspaceDocuments;

    const currentDocument: WorkspaceDocumentSummary = {
      _id: contract._id,
      contract_name: contract.contract_name,
      status: contract.status,
      projectId: workspaceProjectId,
      uploaded_by: contract.uploaded_by,
      uploader_name: contract.uploaded_by_name,
      uploaded_at: contract.uploaded_at,
      page_count: contract.page_count,
    };

    const documents = workspaceDocuments.length > 0 ? workspaceDocuments : [];
    const hasCurrentDocument = documents.some((document) => document._id === contract._id);
    return hasCurrentDocument ? documents : [currentDocument, ...documents];
  }, [contract, workspaceDocuments, workspaceProjectId]);

  const agentReferenceDocuments = useMemo(() => (
    explorerDocuments.map((document) => ({
      id: document._id,
      name: document.contract_name,
      status: document.status,
      isCurrent: document._id === contract?._id,
    }))
  ), [contract?._id, explorerDocuments]);

  const selectedAgentDocumentSummary = useMemo(() => {
    if (!selectedAgentDocument) return null;
    return agentDocuments.find((document) => document.document_id === selectedAgentDocument.documentId) || null;
  }, [agentDocuments, selectedAgentDocument]);

  const countHighlights = useCallback(() => {
    if (!rawSearchValue) return 0;

    try {
      const segments = JSON.parse(rawSearchValue) as CitedSegment[];
      if (Array.isArray(segments)) {
        return segments.length;
      }
    } catch (e) {
      if (rawViewRef.current) {
        const marks = rawViewRef.current.querySelectorAll("mark");
        return marks.length;
      }
    }
    return 0;
  }, [rawSearchValue]);

  const goToNextHighlight = useCallback(() => {
    if (totalHighlights > 0) {
      const nextIndex = (currentHighlightIndex + 1) % totalHighlights;
      setCurrentHighlightIndex(nextIndex);
      setActiveHighlightIndex(nextIndex);
      highlightSingleSegment(nextIndex);
    }
  }, [currentHighlightIndex, totalHighlights]);

  const goToPrevHighlight = useCallback(() => {
    if (totalHighlights > 0) {
      const prevIndex = currentHighlightIndex === 0 ? totalHighlights - 1 : currentHighlightIndex - 1;
      setCurrentHighlightIndex(prevIndex);
      setActiveHighlightIndex(prevIndex);
      highlightSingleSegment(prevIndex);
    }
  }, [currentHighlightIndex, totalHighlights]);

  useEffect(() => {
    const count = countHighlights();
    setTotalHighlights(count);
    if (count === 0) {
      setCurrentHighlightIndex(0);
      setActiveHighlightIndex(null);
    } else {
      setCurrentHighlightIndex(0);
      setActiveHighlightIndex(0);
    }
  }, [countHighlights]);

  useEffect(() => {
    const aiProviderFromLocalStorage = localStorage.getItem("aiProvider");
    if (aiProviderFromLocalStorage) {
      setAiProvider(aiProviderFromLocalStorage);
    } else {
      // Set default if not in localStorage
      setAiProvider('groq');
      localStorage.setItem("aiProvider", 'groq');
    }
  }, []);

  useEffect(() => {
    if (contract?.process?.results || contract?.process?.lastSave?.data) {
      const versions = [...(contract.process.results || [])];
      if (contract.process.lastSave?.data) {
        versions.push(contract.process.lastSave.data);
      }
    }
  }, [contract]);



  const fetchCurrentUser = useCallback(async () => {
    setToken("cookie");
    if (!apiUrl) { setError("API URL Missing"); setLoadingUser(false); return; }
    try {
      const response = await apiFetch(`${apiUrl}/users/me/`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || `Failed user fetch (${response.status})`);
      setCurrentUserInfo(data as UserInDB);
    } catch (err: any) {
      setError(err.message);
      setCurrentUserInfo(null);
      if (err.message?.includes("401") || err.message?.includes("403")) {
        localStorage.removeItem('token');
        router.push('/signin');
      }
    } finally { setLoadingUser(false); }
  }, [apiUrl, router]);

  const fetchContractDetails = useCallback(async () => {
    if (loadingUser || !isClientLoaded || !contractId || !token) return;
    setLoadingContract(true);
    setError(null);
    if (!apiUrl) { setError("API URL Missing"); setLoadingContract(false); return; }
    try {
      const response = await apiFetch(`${apiUrl}/contracts/${contractId}`);
      let data: any = null;
      try {
        data = await response.json();
      } catch (parseError) {
        console.error("fetchContractDetails: Failed to parse response as JSON!", parseError);
        throw new Error("Received invalid data format from server.");
      }

      if (!response.ok) {
        const errorMsg = data.detail || `HTTP error ${response.status}`;
        if (response.status === 404) throw new Error("Contract not found.");
        if (response.status === 403) throw new Error("Permission denied.");
        if (response.status === 401) throw new Error("Auth failed.");
        throw new Error(errorMsg);
      }

      if (!data._id && !data.id) {
        console.error("ID Check Failed: fetched contract data is missing an identifier.");
        throw new Error("Fetched contract data is missing ID (_id or id).");
      }

      if (data._id && !data.id) data.id = data._id;

      setContract(data as FullContractData);

      const latestNum = versions.filter((v: any) => typeof v?.version === 'number')
        .reduce((maxV: number, curr: any) => Math.max(maxV, curr.version), 0);
      setLatestVersionNum(latestNum);

      const allVersions = [...versions];
      if (lastSave?.data) {
        allVersions.push({
          ...lastSave.data,
          version: "Last Saved Draft",
          isLastSave: true,
          createdAt: lastSave.savedAt || new Date().toISOString()
        });
      }

      let initialIndex = allVersions.length > 0 ? allVersions.length - 1 : 0;
      const lastSaveIndex = allVersions.findIndex(v => v.isLastSave);

      if (lastSaveIndex !== -1) {
        initialIndex = lastSaveIndex;
      } else {
        for (let i = versions.length - 1; i >= 0; i--) {
          if (versions[i]?.version === latestNum) {
            initialIndex = i;
            break;
          }
        }
      }
      setSelectedVersionIndex(initialIndex);
    } catch (err: any) {
      setError(err.message);
      setContract(null);
      toast({
        title: "Error Loading Contract",
        description: err.message,
        variant: "destructive"
      });
      if (err.message?.includes("Auth failed")) router.push('/signin');
    } finally {
      setLoadingContract(false);
    }
  }, [contractId, isClientLoaded, loadingUser, apiUrl, token, router]);

  useEffect(() => {
    setIsClientLoaded(true);
    fetchCurrentUser();
  }, [fetchCurrentUser]);

  useEffect(() => {
    if (typeof window === "undefined" || !selectedAccountId) return;
    setStoredProjectId(localStorage.getItem(`${PROJECT_SELECTION_KEY}_${selectedAccountId}`));
  }, [selectedAccountId]);

  useEffect(() => {
    if (contractId && !loadingUser && token) fetchContractDetails();
  }, [contractId, loadingUser, token, fetchContractDetails]);

  const fetchWorkspaceContext = useCallback(async () => {
    if (!apiUrl || !token || !contract || !workspaceProjectId) {
      setWorkspaceProject(null);
      setWorkspaceDocuments([]);
      return;
    }

    setIsWorkspaceLoading(true);
    try {
      const [projectsResponse, documentsResponse] = await Promise.all([
        apiFetch(`${apiUrl}/projects/${workspaceProjectId}`),
        apiFetch(`${apiUrl}/projects/${workspaceProjectId}/contracts`),
      ]);

      if (projectsResponse.ok) {
        setWorkspaceProject(await projectsResponse.json());
      }

      if (documentsResponse.ok) {
        const data = await documentsResponse.json();
        setWorkspaceDocuments(((data?.documents || []) as WorkspaceDocumentSummary[]));
      }
    } catch (error) {
      console.error("Failed to load workspace context:", error);
      setWorkspaceDocuments([]);
    } finally {
      setIsWorkspaceLoading(false);
    }
  }, [apiUrl, token, contract, workspaceProjectId]);

  useEffect(() => {
    fetchWorkspaceContext();
  }, [fetchWorkspaceContext]);

  const fetchAgentDocuments = useCallback(async () => {
    if (!apiUrl || !token || !contractId) {
      setAgentDocuments([]);
      return;
    }

    setIsAgentDocumentsLoading(true);
    try {
      const response = await apiFetch(`${apiUrl}/contracts/${contractId}/agent/documents`);
      if (!response.ok) throw new Error("Unable to load agent documents.");
      const data = await response.json();
      setAgentDocuments(Array.isArray(data?.documents) ? data.documents : []);
    } catch (error) {
      console.error("Failed to load agent documents:", error);
      setAgentDocuments([]);
    } finally {
      setIsAgentDocumentsLoading(false);
    }
  }, [apiUrl, token, contractId]);

  useEffect(() => {
    fetchAgentDocuments();
  }, [fetchAgentDocuments]);

  const fetchContractKpis = useCallback(async () => {
    if (!apiUrl || !token || !contractId) {
      setContractKpis([]);
      setContractKpiSummary(null);
      return;
    }

    setIsKpisLoading(true);
    try {
      const response = await apiFetch(`${apiUrl}/contracts/${contractId}/kpis`);
      const data = await response.json();
      if (!response.ok) throw new Error(data?.detail || "Unable to load KPI register.");
      setContractKpis(Array.isArray(data?.kpis) ? data.kpis : []);
      setContractKpiSummary(data?.summary || null);
    } catch (error) {
      console.error("Failed to load contract KPIs:", error);
      setContractKpis([]);
      setContractKpiSummary(null);
    } finally {
      setIsKpisLoading(false);
    }
  }, [apiUrl, token, contractId]);

  useEffect(() => {
    fetchContractKpis();
  }, [fetchContractKpis]);

  const fetchKpiMonitoring = useCallback(async () => {
    if (!apiUrl || !token || !contractId) {
      setContractKpiActuals([]);
      setContractKpiBreaches([]);
      return;
    }
    setIsKpiMonitoringLoading(true);
    try {
      const [actualsResponse, breachesResponse] = await Promise.all([
        apiFetch(`${apiUrl}/contracts/${contractId}/kpis/actuals`),
        apiFetch(`${apiUrl}/contracts/${contractId}/kpis/breaches`),
      ]);
      const [actualsPayload, breachesPayload] = await Promise.all([
        actualsResponse.json(),
        breachesResponse.json(),
      ]);
      if (!actualsResponse.ok) throw new Error(actualsPayload?.detail || "Unable to load KPI performance logs.");
      if (!breachesResponse.ok) throw new Error(breachesPayload?.detail || "Unable to load KPI compliance flags.");
      setContractKpiActuals(Array.isArray(actualsPayload?.actuals) ? actualsPayload.actuals : []);
      setContractKpiBreaches(Array.isArray(breachesPayload?.breaches) ? breachesPayload.breaches : []);
    } catch (error) {
      console.error("Failed to load KPI monitoring data:", error);
      setContractKpiActuals([]);
      setContractKpiBreaches([]);
    } finally {
      setIsKpiMonitoringLoading(false);
    }
  }, [apiUrl, token, contractId]);

  useEffect(() => {
    fetchKpiMonitoring();
  }, [fetchKpiMonitoring]);

  const fetchKpiSourceWorkspace = useCallback(async () => {
    if (!apiUrl || !token || !contractId) {
      setKpiSourceCatalog([]);
      setKpiSourceConfigs([]);
      return;
    }
    setIsKpiSourceLoading(true);
    try {
      const [catalogResponse, configsResponse] = await Promise.all([
        apiFetch(`${apiUrl}/kpis/source-catalog?scope=user`),
        apiFetch(`${apiUrl}/contracts/${contractId}/kpis/source-configs`),
      ]);
      const [catalogPayload, configsPayload] = await Promise.all([
        catalogResponse.json(),
        configsResponse.json(),
      ]);
      if (!catalogResponse.ok) throw new Error(catalogPayload?.detail || "Unable to load KPI source catalog.");
      if (!configsResponse.ok) throw new Error(configsPayload?.detail || "Unable to load KPI source configs.");
      setKpiSourceCatalog(Array.isArray(catalogPayload?.sources) ? catalogPayload.sources : []);
      setKpiSourceConfigs(Array.isArray(configsPayload?.source_configs) ? configsPayload.source_configs : []);
    } catch (error) {
      console.error("Failed to load KPI source workspace:", error);
      setKpiSourceCatalog([]);
      setKpiSourceConfigs([]);
    } finally {
      setIsKpiSourceLoading(false);
    }
  }, [apiUrl, token, contractId]);

  useEffect(() => {
    fetchKpiSourceWorkspace();
  }, [fetchKpiSourceWorkspace]);

  const createKpiSourceConfig = useCallback(async (source: KPISourceCatalogItem) => {
    if (!apiUrl || !token || !contractId) return;
    if (!USER_KPI_SOURCE_TYPES.has(source.source_type)) {
      toast({
        title: "Platform-managed connector",
        description: "Enterprise KPI connectors are configured by ContractSense from Integrations.",
        variant: "destructive",
      });
      return;
    }
    setIsKpiSourceLoading(true);
    try {
      const defaultMappings = getDefaultKpiSourceMappings();
      const response = await apiFetch(`${apiUrl}/contracts/${contractId}/kpis/source-configs`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          display_name: source.label,
          source_type: source.source_type,
          auth_type: source.auth_types?.[0] || "none",
          status: "draft",
          schedule: {
            cadence: "manual",
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
          },
          field_mappings: defaultMappings,
          validation_rules: [
            { field: "actual_value", rule: "required_numeric" },
            { field: "timestamp", rule: "required_datetime" },
          ],
        }),
      });
      const created = await response.json();
      if (!response.ok) throw new Error(created?.detail || "Unable to create source config.");
      setKpiSourceConfigs((current) => [created, ...current.filter((item) => item.source_config_id !== created.source_config_id)]);
      toast({
        title: "Actual source created",
        description: `${source.label} is ready for sample data, field mapping, and validation.`,
      });
    } catch (error: any) {
      toast({
        title: "Could not create source config",
        description: error?.message || "Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsKpiSourceLoading(false);
    }
  }, [apiUrl, token, contractId]);

  const mapTrackedKpisToSourceConfig = useCallback(async (config: KPISourceConfig) => {
    if (!apiUrl || !token || !contractId) return;
    const trackedKpis = contractKpis.filter(isKpiTracked);
    const trackedKpiIds = trackedKpis.map((kpi) => kpi.kpi_id).filter(Boolean);
    if (!trackedKpiIds.length) {
      toast({
        title: "No tracked KPIs yet",
        description: "Track KPIs first, then map them to this source.",
        variant: "destructive",
      });
      return;
    }
    setIsKpiSourceLoading(true);
    try {
      const response = await apiFetch(`${apiUrl}/contracts/${contractId}/kpis/source-configs/${encodeURIComponent(config.source_config_id)}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ...config,
          kpi_bindings: kpiBindingsForSource(config, trackedKpis).map((binding) => ({
            ...binding,
            enabled: trackedKpiIds.includes(binding.kpi_id),
          })),
          kpi_ids: trackedKpiIds,
          status: "mapped",
          field_mappings: config.field_mappings?.length ? config.field_mappings : getDefaultKpiSourceMappings(),
        }),
      });
      const updated = await response.json();
      if (!response.ok) throw new Error(updated?.detail || "Unable to map source config.");
      setKpiSourceConfigs((current) => current.map((item) => item.source_config_id === updated.source_config_id ? updated : item));
      await fetchContractKpis();
      toast({
        title: "Tracked KPIs mapped",
        description: `${trackedKpiIds.length} tracked KPI${trackedKpiIds.length === 1 ? "" : "s"} now reference ${config.display_name}.`,
      });
    } catch (error: any) {
      toast({
        title: "Could not map source",
        description: error?.message || "Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsKpiSourceLoading(false);
    }
  }, [apiUrl, token, contractId, contractKpis, fetchContractKpis]);

  const updateKpiSourceConfig = useCallback(async (config: KPISourceConfig, updates: Partial<KPISourceConfig>) => {
    if (!apiUrl || !token || !contractId) return;
    const payload = {
      ...config,
      ...updates,
      schedule: {
        ...(config.schedule || {}),
        ...(updates.schedule || {}),
      },
    };
    setIsKpiSourceLoading(true);
    try {
      const response = await apiFetch(`${apiUrl}/contracts/${contractId}/kpis/source-configs/${encodeURIComponent(config.source_config_id)}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      const updated = await response.json();
      if (!response.ok) throw new Error(updated?.detail || "Unable to update source config.");
      setKpiSourceConfigs((current) => current.map((item) => item.source_config_id === updated.source_config_id ? updated : item));
      if (updates.kpi_ids || updates.kpi_bindings || updates.field_mappings) await fetchContractKpis();
      return updated as KPISourceConfig;
    } catch (error: any) {
      toast({
        title: "Could not save source config",
        description: error?.message || "Please try again.",
        variant: "destructive",
      });
      throw error;
    } finally {
      setIsKpiSourceLoading(false);
    }
  }, [apiUrl, token, contractId, fetchContractKpis]);

  const loadKpiSourceFetchRuns = useCallback(async (config: KPISourceConfig) => {
    if (!apiUrl || !token || !contractId || !config?.source_config_id) return;
    try {
      const response = await apiFetch(`${apiUrl}/contracts/${contractId}/kpis/source-configs/${encodeURIComponent(config.source_config_id)}/fetch-runs`);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.detail || "Unable to load source fetch runs.");
      setKpiSourceFetchRuns((current) => ({
        ...current,
        [config.source_config_id]: Array.isArray(payload?.fetch_runs) ? payload.fetch_runs : [],
      }));
    } catch (error) {
      console.error("Failed to load KPI source fetch runs:", error);
    }
  }, [apiUrl, token, contractId]);

  const testKpiSourceConfig = useCallback(async (config: KPISourceConfig, payload?: any) => {
    if (!apiUrl || !token || !contractId) return;
    setIsKpiSourceLoading(true);
    try {
      const response = await apiFetch(`${apiUrl}/contracts/${contractId}/kpis/source-configs/${encodeURIComponent(config.source_config_id)}/test`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ payload }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result?.detail || "Source validation failed.");
      setKpiSourceActionResults((current) => ({ ...current, [config.source_config_id]: result }));
      if (result?.source_config) {
        setKpiSourceConfigs((current) => current.map((item) => item.source_config_id === result.source_config.source_config_id ? result.source_config : item));
      }
      await loadKpiSourceFetchRuns(config);
      toast({
        title: "Source validation complete",
        description: `${result?.normalized_rows?.length || 0} normalized row${result?.normalized_rows?.length === 1 ? "" : "s"} ready for ingestion.`,
      });
    } catch (error: any) {
      toast({
        title: "Source validation failed",
        description: error?.message || "Review the sample data and field mappings.",
        variant: "destructive",
      });
    } finally {
      setIsKpiSourceLoading(false);
    }
  }, [apiUrl, token, contractId, loadKpiSourceFetchRuns]);

  const fetchKpiSourceConfig = useCallback(async (config: KPISourceConfig, payload?: any) => {
    if (!apiUrl || !token || !contractId) return;
    setIsKpiSourceLoading(true);
    try {
      const response = await apiFetch(`${apiUrl}/contracts/${contractId}/kpis/source-configs/${encodeURIComponent(config.source_config_id)}/fetch`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ trigger_type: "manual", evaluate: true, payload }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result?.detail || "Source fetch failed.");
      setKpiSourceActionResults((current) => ({ ...current, [config.source_config_id]: result }));
      if (result?.source_config) {
        setKpiSourceConfigs((current) => current.map((item) => item.source_config_id === result.source_config.source_config_id ? result.source_config : item));
      }
      await Promise.all([fetchKpiMonitoring(), fetchContractKpis(), loadKpiSourceFetchRuns(config)]);
      toast({
        title: "Source fetch complete",
        description: `${result?.created_actuals?.length || 0} actual${result?.created_actuals?.length === 1 ? "" : "s"} ingested. ${result?.created_breaches?.length || 0} deterministic evaluation${result?.created_breaches?.length === 1 ? "" : "s"} recorded.`,
      });
    } catch (error: any) {
      toast({
        title: "Source fetch failed",
        description: error?.message || "Review source config and try again.",
        variant: "destructive",
      });
    } finally {
      setIsKpiSourceLoading(false);
    }
  }, [apiUrl, token, contractId, fetchKpiMonitoring, fetchContractKpis, loadKpiSourceFetchRuns]);

  const extractContractKpis = useCallback(async () => {
    if (!apiUrl || !token || !contractId) return;
    setIsExtractingKpis(true);
    try {
      const response = await apiFetch(`${apiUrl}/contracts/${contractId}/kpis/extract`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ replace_drafts: true, ai_provider: aiProvider || "groq" }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.detail || "Unable to extract KPIs.");
      setContractKpis(Array.isArray(data?.kpis) ? data.kpis : []);
      setContractKpiSummary(data?.summary || null);
      await fetchKpiMonitoring();
      router.push(`/contracts/${contractId}/kpis`);
      toast({
        title: "KPIs extracted",
        description: `${data?.kpi_count ?? data?.kpis?.length ?? 0} KPI candidates are ready for review via ${data?.extraction_method || "hybrid extraction"}.`,
      });
    } catch (error: any) {
      toast({
        title: "Could not extract KPIs",
        description: error?.message || "Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsExtractingKpis(false);
    }
  }, [apiUrl, token, contractId, aiProvider, fetchKpiMonitoring, router]);

  const updateContractKpi = useCallback(async (kpi: ContractKPI, updates: Partial<ContractKPI>) => {
    if (!apiUrl || !token || !contractId || !kpi.kpi_id) return;
    const previousKpis = contractKpis;

    // Normalize min/max/value numerical types if they are sent as strings
    const sanitizedUpdates = { ...updates };
    const normalizeOptionalNumber = (value: unknown) => (
      value === "" || value === null || value === undefined ? null : Number(value)
    );
    if (sanitizedUpdates.value_min !== undefined) {
      sanitizedUpdates.value_min = normalizeOptionalNumber(sanitizedUpdates.value_min);
    }
    if (sanitizedUpdates.value_max !== undefined) {
      sanitizedUpdates.value_max = normalizeOptionalNumber(sanitizedUpdates.value_max);
    }
    if (sanitizedUpdates.consequence_value !== undefined) {
      sanitizedUpdates.consequence_value = normalizeOptionalNumber(sanitizedUpdates.consequence_value);
    }

    const optimisticKpis = contractKpis.map((item) =>
      item.kpi_id === kpi.kpi_id ? { ...item, ...sanitizedUpdates } : item
    );
    setContractKpis(optimisticKpis);

    try {
      const response = await apiFetch(`${apiUrl}/contracts/${contractId}/kpis/${encodeURIComponent(kpi.kpi_id)}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(sanitizedUpdates),
      });
      const updated = await response.json();
      if (!response.ok) throw new Error(updated?.detail || "Unable to update KPI.");
      const nextKpis = optimisticKpis.map((item) => item.kpi_id === kpi.kpi_id ? updated : item);
      setContractKpis(nextKpis);
      setContractKpiSummary(buildClientKpiSummary(nextKpis));
      return updated as ContractKPI;
    } catch (error: any) {
      setContractKpis(previousKpis);
      setContractKpiSummary(buildClientKpiSummary(previousKpis));
      toast({
        title: "Could not update KPI",
        description: error?.message || "Please try again.",
        variant: "destructive",
      });
      return null;
    }
  }, [apiUrl, token, contractId, contractKpis]);

  const updateContractKpiStatus = useCallback(async (kpi: ContractKPI, status: string) => {
    await updateContractKpi(kpi, { status });
  }, [updateContractKpi]);

  const acceptAllContractKpis = useCallback(async () => {
    const candidates = contractKpis.filter((kpi) => kpi.status !== "approved" && kpi.status !== "ignored");
    if (!candidates.length) return;
    await Promise.all(candidates.map((kpi) => updateContractKpi(kpi, { status: "approved" })));
    await fetchContractKpis();
    toast({
      title: "All KPI candidates accepted",
      description: `${candidates.length} KPI${candidates.length === 1 ? "" : "s"} marked approved. Tracking still stays opt-in.`,
    });
  }, [contractKpis, updateContractKpi, fetchContractKpis]);

  const trackRecommendedContractKpis = useCallback(async () => {
    const candidates = contractKpis.filter((kpi) => isKpiRecommended(kpi) && !isKpiTracked(kpi) && kpi.status !== "ignored");
    if (!candidates.length) return;
    const updatedKpis = await Promise.all(candidates.map((kpi) => updateContractKpi(kpi, {
      status: "approved",
      tracking_status: "tracked",
      is_tracked: true,
    })));
    const backfilledEvaluations = updatedKpis.reduce((total, updated) => (
      total + Number(updated?.last_tracking_backfill?.created_breach_count || 0)
    ), 0);
    await fetchContractKpis();
    await fetchKpiMonitoring();
    toast({
      title: "Recommended KPIs tracked",
      description: backfilledEvaluations
        ? `${candidates.length} KPI${candidates.length === 1 ? "" : "s"} are active. ${backfilledEvaluations} existing actual${backfilledEvaluations === 1 ? "" : "s"} evaluated immediately.`
        : `${candidates.length} KPI${candidates.length === 1 ? "" : "s"} will now participate in breach checks.`,
    });
  }, [contractKpis, updateContractKpi, fetchContractKpis, fetchKpiMonitoring]);

  const trackContractKpi = useCallback(async (kpi: ContractKPI) => {
    const updated = await updateContractKpi(kpi, {
      status: "approved",
      tracking_status: "tracked",
      is_tracked: true,
    });
    const backfilledEvaluations = Number(updated?.last_tracking_backfill?.created_breach_count || 0);
    await fetchKpiMonitoring();
    toast({
      title: "KPI tracking enabled",
      description: backfilledEvaluations
        ? `${kpi.name} is active. ${backfilledEvaluations} existing actual${backfilledEvaluations === 1 ? "" : "s"} evaluated immediately.`
        : `${kpi.name} will now be checked when actuals are ingested.`,
    });
  }, [updateContractKpi, fetchKpiMonitoring]);

  const flagBreachRemediationEmail = useCallback(async (breach: ContractKPIBreach) => {
    if (!apiUrl || !token || !contractId || !breach.breach_id) return null;
    try {
      const response = await apiFetch(`${apiUrl}/contracts/${contractId}/kpis/breaches/${encodeURIComponent(breach.breach_id)}/flag-remediation-email`, {
        method: "POST",
      });
      const updated = await response.json();
      if (!response.ok) throw new Error(updated?.detail || "Unable to prepare remediation email.");
      setContractKpiBreaches((current) => current.map((item) => item.breach_id === breach.breach_id ? updated : item));
      toast({
        title: "Email draft ready",
        description: "The remediation email draft is attached to this compliance flag.",
      });
      return updated as ContractKPIBreach;
    } catch (error: any) {
      toast({
        title: "Could not prepare email",
        description: error?.message || "Please try again.",
        variant: "destructive",
      });
      return null;
    }
  }, [apiUrl, token, contractId]);

  const uploadKpiActuals = useCallback(async (file: File) => {
    if (!apiUrl || !token || !contractId) return;
    const formData = new FormData();
    formData.append("file", file);
    formData.append("evaluate", "true");
    setIsUploadingKpiActuals(true);
    try {
      const result = await apiUploadWithProgress<any>(`${apiUrl}/contracts/${contractId}/kpis/actuals/upload`, formData);
      if (result.error) throw new Error(result.error || "Unable to upload KPI actuals.");
      const payload = result.data || {};
      await fetchKpiMonitoring();
      const deferredCount = Array.isArray(payload.deferred_evaluations) ? payload.deferred_evaluations.length : 0;
      toast({
        title: "Actuals ingested",
        description: `${payload.count || 0} rows mapped, ${payload.breaches?.length || 0} tracked evaluations created${deferredCount ? `, ${deferredCount} deferred until tracking` : ""}${payload.skipped?.length ? `, ${payload.skipped.length} skipped` : ""}.`,
      });
    } catch (error: any) {
      toast({
        title: "Actuals upload failed",
        description: error?.message || "Please check the CSV/JSON file.",
        variant: "destructive",
      });
      throw error;
    } finally {
      setIsUploadingKpiActuals(false);
    }
  }, [apiUrl, token, contractId, fetchKpiMonitoring]);

  const openAgentDocument = useCallback((documentId: string, versionId?: string) => {
    const document = agentDocuments.find((item) => item.document_id === documentId);
    const resolvedVersionId = versionId || document?.current_version_id || document?.versions?.[0]?.version_id;
    if (!resolvedVersionId) return;
    setSelectedAgentDocument({ documentId, versionId: resolvedVersionId });
    setSearchValue("");
    setRawSearchValue("");
    setActiveTab("docx");
  }, [agentDocuments]);

  const openContractDocument = useCallback(() => {
    setSelectedAgentDocument(null);
    setAgentDocumentPreview(null);
    setActiveTab("default");
  }, []);

  const createEditableCopy = useCallback(async () => {
    if (!apiUrl || !token || !contractId) return;
    setIsCreatingEditableCopy(true);
    try {
      const response = await apiFetch(`${apiUrl}/contracts/${contractId}/agent/documents/copy`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ session_id: initialAgentSessionId || undefined }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.detail || "Unable to create editable copy.");
      await fetchAgentDocuments();
      if (data?.document_id && data?.version_id) {
        setSelectedAgentDocument({ documentId: data.document_id, versionId: data.version_id });
        setActiveTab("docx");
      }
      toast({
        title: "Editable copy created",
        description: "The DOCX copy is now available in the explorer.",
      });
    } catch (error: any) {
      toast({
        title: "Could not create editable copy",
        description: error?.message || "Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsCreatingEditableCopy(false);
    }
  }, [apiUrl, token, contractId, initialAgentSessionId, fetchAgentDocuments]);

  const downloadAgentDocumentVersion = useCallback(async (preview: AgentDocumentPreview | null) => {
    if (!apiUrl || !token || !preview?.download_url) return;
    const blob = await apiDownload(`${apiUrl}${preview.download_url}`);
    const objectUrl = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = preview.filename || "Contract Copy.docx";
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(objectUrl);
  }, [apiUrl, token]);

  const resolveAgentDocumentEdit = useCallback(async (edit: AgentEditAnnotation, mode: "accept" | "reject") => {
    if (!apiUrl || !token || !contractId || !selectedAgentDocument || !edit.edit_id) return;
    setResolvingAgentEditIds((current) => new Set([...current, edit.edit_id]));
    try {
      const response = await apiFetch(
        `${apiUrl}/contracts/${contractId}/agent/documents/${selectedAgentDocument.documentId}/edits/${edit.edit_id}/${mode}`,
        {
          method: "POST",
        },
      );
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.detail || `Unable to ${mode} edit.`);
      await fetchAgentDocuments();
      setAgentDocumentPreview((current) => current
        ? {
            ...current,
            version_id: String(payload?.version_id || current.version_id),
            download_url: String(payload?.download_url || current.download_url || ""),
            edit_annotations: current.edit_annotations?.map((annotation) => (
              annotation.edit_id === edit.edit_id
                ? { ...annotation, status: String(payload?.status || (mode === "accept" ? "accepted" : "rejected")) }
                : annotation
            )),
          }
        : current);
      setSelectedAgentDocument({
        documentId: selectedAgentDocument.documentId,
        versionId: String(payload?.version_id || selectedAgentDocument.versionId),
      });
    } catch (error: any) {
      toast({
        title: `Could not ${mode} edit`,
        description: error?.message || "Please try again.",
        variant: "destructive",
      });
    } finally {
      setResolvingAgentEditIds((current) => {
        const next = new Set(current);
        next.delete(edit.edit_id);
        return next;
      });
    }
  }, [apiUrl, token, contractId, selectedAgentDocument, fetchAgentDocuments]);

  const saveAgentDocumentText = useCallback(async (bodyText: string) => {
    if (!apiUrl || !token || !contractId || !selectedAgentDocument) return null;
    setIsSavingAgentDocument(true);
    try {
      const body = JSON.stringify({
        body_text: bodyText,
        change_summary: "Saved from live editor",
      });
      console.log("[saveAgentDocumentText] Sending body_text length:", bodyText?.length);
      const response = await apiFetch(
        `${apiUrl}/contracts/${contractId}/agent/documents/${selectedAgentDocument.documentId}/versions`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body,
        },
      );
      const payload = await response.json();
      if (!response.ok) {
        console.error("[saveAgentDocumentText] Error response:", payload);
        throw new Error(payload?.detail || "Unable to save DOCX version.");
      }
      await fetchAgentDocuments();
      setSelectedAgentDocument({
        documentId: selectedAgentDocument.documentId,
        versionId: String(payload?.version_id || selectedAgentDocument.versionId),
      });
      setAgentDocumentPreview((current) => current
        ? {
            ...current,
            version_id: String(payload?.version_id || current.version_id),
            version_number: Number(payload?.version_number || current.version_number || 1),
            body_text: bodyText,
            download_url: String(payload?.download_url || current.download_url || ""),
          }
        : current);
      toast({
        title: "DOCX version saved",
        description: `Version ${payload?.version_number || ""} is ready to preview and download.`,
      });
      return payload as { version_id?: string; version_number?: number };
    } catch (error: any) {
      toast({
        title: "Could not save DOCX",
        description: typeof error?.message === "string" ? error.message : JSON.stringify(error?.message),
        variant: "destructive",
      });
      return null;
    } finally {
      setIsSavingAgentDocument(false);
    }
  }, [apiUrl, token, contractId, selectedAgentDocument, fetchAgentDocuments]);

  useEffect(() => {
    if (!apiUrl || !token || !contractId || !selectedAgentDocument) {
      setAgentDocumentPreview(null);
      return;
    }

    let cancelled = false;
    async function loadPreview() {
      if (!selectedAgentDocument) return;
      setIsAgentDocumentPreviewLoading(true);
      try {
        const response = await apiFetch(
          `${apiUrl}/contracts/${contractId}/agent/documents/${selectedAgentDocument.documentId}/versions/${selectedAgentDocument.versionId}`,
        );
        const data = await response.json();
        if (!response.ok) throw new Error(data?.detail || "Unable to load DOCX preview.");
        if (!cancelled) setAgentDocumentPreview(data as AgentDocumentPreview);
      } catch (error) {
        console.error("Failed to load agent document preview:", error);
        if (!cancelled) setAgentDocumentPreview(null);
      } finally {
        if (!cancelled) setIsAgentDocumentPreviewLoading(false);
      }
    }

    loadPreview();
    return () => {
      cancelled = true;
    };
  }, [apiUrl, token, contractId, selectedAgentDocument]);

  useEffect(() => {
    const originalDisplayContent = contract?.index?.html_content || contract?.index?.content;
    const isHtml = !!contract?.index?.html_content;

    if (!originalDisplayContent || originalDisplayContent === '*No raw content*') {
      setHighlightedRawContent(originalDisplayContent || '*No raw content*');
      return;
    }

    if (!rawSearchValue || rawSearchValue.trim() === "") {
      setHighlightedRawContent(originalDisplayContent);
      setActiveHighlightIndex(null);
      setTotalHighlights(0);
      setCurrentHighlightIndex(0);
      if (activeTab === "raw" && rawViewRef.current) {
        rawViewRef.current.scrollTop = 0;
      }
      return;
    }

    if (!isHtml) {
      setHighlightedRawContent(renderPlainTextWithHighlights(
        originalDisplayContent,
        rawSearchValue,
        activeHighlightIndex,
      ));
      return;
    }

    // --- HTML DOM-based highlighting ---
    const parser = new DOMParser();
    const doc = parser.parseFromString(originalDisplayContent, 'text/html');
    const colors = ['bg-yellow-200', 'bg-blue-200', 'bg-green-200', 'bg-purple-200', 'bg-pink-200'];

    let searchTerms: string[] = [];
    try {
      const segments = JSON.parse(rawSearchValue) as CitedSegment[];
      if (Array.isArray(segments)) {
        searchTerms = segments.map(s => s.text).filter(Boolean) as string[];
      } else {
        searchTerms = [rawSearchValue];
      }
    } catch {
      searchTerms = [rawSearchValue];
    }

    // For each term, find and wrap it in text nodes
    searchTerms.forEach((rawTerm, termIndex) => {
      // Clean up markdown artifacts, table borders, and HTML tags from term
      let cleanTerm = rawTerm
        .replace(/<[^>]*>/g, ' ') // strip HTML tags from the search term
        .replace(/[*_#>`|=-]/g, ' ') // strip markdown formatting and table borders
        .trim();

      if (!cleanTerm) return;

      const walker = document.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT, null);
      let textNodes: { node: Text, start: number, end: number }[] = [];
      let fullText = "";

      let curNode;
      while ((curNode = walker.nextNode() as Text)) {
        if (curNode.parentElement && curNode.parentElement.tagName !== 'MARK') {
          const textContent = curNode.nodeValue || '';
          textNodes.push({
            node: curNode,
            start: fullText.length,
            end: fullText.length + textContent.length
          });
          fullText += textContent;
        }
      }

      // To handle cross-node matches, we extract the alphanumeric words and allow flexible punctuation
      const termRegexParts = cleanTerm.split(/\s+/).filter(Boolean);

      if (termRegexParts.length === 0) return;

      // [\W_]{0,500} allows any non-word characters (up to 500) between our words,
      // ignoring HTML node boundaries, missing spaces in tables, and LONG markdown table dividers
      const searchRegex = new RegExp(termRegexParts.map(escapeRegExp).join('[\\W_]{0,500}'), 'gi');

      let match;
      const matches: { start: number, end: number }[] = [];
      while ((match = searchRegex.exec(fullText)) !== null) {
        matches.push({ start: match.index, end: searchRegex.lastIndex });
        if (searchRegex.lastIndex === match.index) searchRegex.lastIndex++; // Prevent infinite loops
      }

      textNodes.forEach(n => {
        const overlappingMatches = matches.filter(m => m.start < n.end && m.end > n.start);
        if (overlappingMatches.length === 0) return;

        const originalText = n.node.nodeValue || '';
        const frag = document.createDocumentFragment();
        let lastIdx = 0;

        overlappingMatches.forEach(m => {
          const relativeStart = Math.max(0, m.start - n.start);
          const relativeEnd = Math.min(n.end - n.start, m.end - n.start);
          if (relativeStart >= relativeEnd) return;

          if (relativeStart > lastIdx) {
            frag.appendChild(document.createTextNode(originalText.substring(lastIdx, relativeStart)));
          }

          const mark = document.createElement('mark');
          const isActive = activeHighlightIndex === termIndex || (activeHighlightIndex === null && searchTerms.length === 1 && termIndex === 0);
          const colorClass = colors[termIndex % colors.length];
          const highlightClass = isActive
            ? `${colorClass} text-black px-1 py-0.5 rounded-sm border-2 border-red-500 shadow-lg`
            : `${colorClass} text-black px-0.5 rounded-sm border border-${colorClass.replace('bg-', '')}`;

          mark.className = highlightClass;
          mark.setAttribute('data-segment-index', String(termIndex));
          mark.setAttribute('data-active', String(isActive));
          mark.textContent = originalText.substring(relativeStart, relativeEnd);
          frag.appendChild(mark);

          lastIdx = relativeEnd;
        });

        if (lastIdx < originalText.length) {
          frag.appendChild(document.createTextNode(originalText.substring(lastIdx)));
        }

        if (n.node.parentNode) {
          n.node.parentNode.replaceChild(frag, n.node);
        }
      });
    });

    setHighlightedRawContent(doc.body.innerHTML);
  }, [contract?.index?.html_content, contract?.index?.content, rawSearchValue, activeTab, activeHighlightIndex]);

  const versions = contract?.process?.results || [];
  const lastSave = contract?.process?.lastSave;
  const allVersionsForDropdown = [...versions];
  if (lastSave?.data) {
    allVersionsForDropdown.push({
      ...lastSave.data,
      version: "Last Saved Draft",
      isLastSave: true,
      createdAt: lastSave.savedAt || new Date().toISOString()
    });
  }

  const currentDisplayVersionIndex = Math.min(
    selectedVersionIndex,
    allVersionsForDropdown.length > 0 ? allVersionsForDropdown.length - 1 : 0
  );
  const currentDisplayData = allVersionsForDropdown.length > 0 ? allVersionsForDropdown[currentDisplayVersionIndex] : null;
  const isViewingLastSave = !!currentDisplayData?.isLastSave;

  const currentUserId = currentUserInfo?._id;
  const contractStatus = contract?.status;
  const isPersonalDoc = contract?.ownerType === 'user';
  const accountOwnerId = contract?.ownerType === 'team' ? contract?.ownerId : null;
  const assignedEditorId = contract?.workflowRoles?.editorUserId;
  const assignedApproverId = contract?.workflowRoles?.approverUserId;
  const contractOwnerId = contract?.ownerId;
  const userOwnedAccountId = currentUserInfo?.ownedAccountId;

  const isAccountOwner = useMemo(() => {
    return !!(currentUserInfo &&
      contract?.ownerType === 'team' &&
      contractOwnerId &&
      userOwnedAccountId &&
      contractOwnerId === userOwnedAccountId);
  }, [currentUserInfo, contract?.ownerType, contract?.ownerId]);

  const isAssignedEditor = useMemo(() => !!(currentUserInfo && assignedEditorId && currentUserInfo._id === assignedEditorId), [currentUserInfo, assignedEditorId]);
  const isAssignedApprover = useMemo(() => !!(currentUserInfo && assignedApproverId && currentUserInfo._id === assignedApproverId), [currentUserInfo, assignedApproverId]);
  const isContractOwner = useMemo(() => {
    return !!(currentUserInfo && isPersonalDoc && contract?.ownerId === currentUserInfo._id);
  }, [currentUserInfo, contract, isPersonalDoc]);

  const canEdit = useMemo(() => {
    if (!contract || !currentUserId) return false;
    const currentStatus = contract?.status;
    const editableStatusesForEditor = ["Ready to Edit", "Editing", "Rejected"];
    const editableStatusesForPersonal = ["Ready to Edit", "Editing"];

    if (isAssignedEditor && editableStatusesForEditor.includes(currentStatus || '')) {
      return true;
    }
    if (isContractOwner && editableStatusesForPersonal.includes(currentStatus || '')) {
      return true;
    }
    return false;
  }, [contract, currentUserId, isAssignedEditor, isContractOwner]);

  const canSubmit = useMemo(() => {
    if (!contract || !currentUserId || isPersonalDoc) return false;
    if (isViewingLastSave) return false;

    const allowedStatuses = ["Ready to Edit", "Editing", "Rejected"];
    if (!allowedStatuses.includes(contractStatus || '')) return false;
    if (!assignedApproverId) return false;

    return isAssignedEditor;
  }, [contract, currentUserId, isPersonalDoc, contractStatus, isAssignedEditor, assignedApproverId, isViewingLastSave]);

  const canApprove = useMemo(() => {
    if (!contract || !currentUserId || isPersonalDoc) return false;
    if (isAssignedApprover && contractStatus === "Pending Approval") return true;
    return false;
  }, [currentUserId, contractStatus, isAssignedApprover, isPersonalDoc, contract]);

  const canReject = useMemo(() => {
    if (!contract || !currentUserId || isPersonalDoc) return false;
    if (isAssignedApprover && contractStatus === "Pending Approval") return true;
    return false;
  }, [currentUserId, contractStatus, isAccountOwner, isAssignedApprover, isPersonalDoc, contract]);

  const canMarkComplete = useMemo(() => {
    if (!contract || !currentUserId) return false;
    if (contract.process?.lastSave) return false;
    const allowedStatuses = ["Ready to Edit", "Editing"];
    return isContractOwner && allowedStatuses.includes(contractStatus || '');
  }, [currentUserId, contractStatus, isContractOwner, contract]);

  const canRequestReEdit = useMemo(() => {
    if (!contract || !currentUserId || contract.status !== "Completed") return false;
    // For personal docs, the owner can always request.
    if (isContractOwner) return true;
    // For team docs, only the assigned editor can request.
    if (isAssignedEditor) return true;

    return false;
  }, [contract, currentUserId, contractStatus, isContractOwner, isAssignedEditor]);

  const canDecideOnReEdit = useMemo(() => {
    // Basic conditions: Must have data and be in the correct status.
    if (!contract || !currentUserId || contract.status !== "Pending Re-edit Approval") {
      return false;
    }

    // CRUCIAL RULE: A user who is the assigned editor for this document
    // can NEVER decide on a re-edit request, even if they are also the account owner.
    // Their editor role takes precedence.
    if (isAssignedEditor) {
      return false;
    }

    // If the user is NOT the editor, then they can decide if they are
    // the assigned approver OR the account owner.
    if (isAssignedApprover || isAccountOwner) {
      return true;
    }

    // Default to false for all other users.
    return false;
  }, [contractStatus, currentUserId, contract, isAssignedEditor, isAssignedApprover, isAccountOwner]);


  const displayStatus = useMemo(() => {
    if (!contractStatus) return "Unknown";
    if (isPersonalDoc) {
      if (contractStatus === "Completed") return "Completed";
      if (["Ready to Edit", "Editing"].includes(contractStatus)) return "Ready";
      if (["Indexing", "Summarizing", "Processing"].includes(contractStatus)) return "Processing";
      if (contractStatus === "Uploaded") return "Uploaded";
      return contractStatus;
    }
    if (contractStatus === "Pending Approval") {
      // Check for the most specific roles first.
      if (isAssignedApprover) return "Pending Your Approval";
      if (isAssignedEditor) return "Submitted";
      // If the user is the owner but NOT the assigned approver or editor, they get the approver's view.
      if (isAccountOwner) return "Pending Your Approval";
      // Fallback for other users.
      return "Pending Approval";
    }
    return contractStatus;
  }, [contractStatus, isPersonalDoc, isAssignedApprover, isAssignedEditor, isAccountOwner]);

  const agentRoleLabel = useMemo(() => {
    if (isAssignedApprover || canApprove) return "Approver";
    if (isAssignedEditor || canEdit) return "Editor";
    if (isAccountOwner) return "Account owner";
    if (isContractOwner) return "Owner";
    return "Reviewer";
  }, [isAssignedApprover, canApprove, isAssignedEditor, canEdit, isAccountOwner, isContractOwner]);

  const hasIndexedContent = useMemo(() => {
    const indexedContent = contract?.index?.html_content || contract?.index?.content;
    return Boolean(indexedContent && indexedContent !== "*No raw content*");
  }, [contract?.index?.html_content, contract?.index?.content]);

  const isUnprocessed = useMemo(() =>
    !hasIndexedContent && (
      !contract?.process?.results ||
      contract.process.results.length === 0 ||
      contract.status === "Uploaded"
    ),
    [contract?.process?.results, contract?.status, hasIndexedContent]);

  const handleSaveDraft = async (dataFromContractDetails: any) => {
    if (!dataFromContractDetails || !Array.isArray(dataFromContractDetails.results)) {
      console.error("handleSaveDraft received invalid data:", dataFromContractDetails);
      toast({ title: "Error", description: "Invalid data format received for saving draft.", variant: "destructive" });
      return;
    }

    if (!canEdit) {
      toast({
        title: "Permission Denied",
        description: "Cannot save draft in current state.",
        variant: "destructive"
      });
      return;
    }
    if (!contract?._id || !token || !apiUrl) {
      toast({ title: "Cannot Save Draft", variant: "destructive" });
      return;
    }
    setIsSavingDraft(true);
    setError(null);
    try {
      const payload = dataFromContractDetails;
      const response = await apiFetch(`${apiUrl}/contracts/${contract._id}/save-draft/`, {
        method: "PUT",
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload)
      });

      const result = await response.json();
      if (!response.ok) throw new Error(result.detail || "Failed to save draft");
      if (!result?._id && !result?.id) throw new Error("Save draft response missing ID.");

      setContract(result as FullContractData);
      const updatedVersions = result.process?.results || [];
      const updatedLastSave = result.process?.lastSave;
      const updatedAllVersionsForDropdown = [...updatedVersions];

      if (updatedLastSave?.data) {
        updatedAllVersionsForDropdown.push({
          ...updatedLastSave.data,
          version: "Last Saved Draft",
          isLastSave: true,
          createdAt: updatedLastSave.savedAt || new Date().toISOString()
        });
      }

      const draftIndex = updatedAllVersionsForDropdown.findIndex(v => v.isLastSave);

      if (draftIndex !== -1) {
        setSelectedVersionIndex(draftIndex);
      } else {
        setSelectedVersionIndex(updatedVersions.length > 0 ? updatedVersions.length - 1 : 0);
      }

      toast({ title: "Success", description: "Draft saved." });
    } catch (error: any) {
      setError(error.message);
      toast({ title: "Error Saving Draft", description: error.message, variant: "destructive" });
    } finally {
      setIsSavingDraft(false);
    }
  };

  const handleSubmitDraft = async (data: any) => {
    if (!canEdit) {
      toast({ title: "Permission Denied", description: "Cannot save new version.", variant: "destructive" });
      return;
    }
    if (!contract || !token || !apiUrl || !contract._id) {
      toast({ title: "Cannot Save Version", variant: "destructive" });
      return;
    }

    setIsSubmittingVersion(true);
    setError(null);
    try {
      const numericVersions = contract.process?.results?.filter(v => typeof v.version === 'number').map(v => v.version) || [];
      const latestVersionNumLocal = Math.max(...numericVersions.filter((v): v is number => typeof v === 'number'), 0);

      const response = await apiFetch(`${apiUrl}/contracts/${contract._id}/submit-draft/`, {
        method: "PUT",
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ results: [data] })
      });

      const result = await response.json();
      if (!response.ok) throw new Error(result.detail || "Failed to save new version");
      if (!result?._id && !result?.id) throw new Error("Save version response missing ID.");

      setContract(result as FullContractData);
      setLatestVersionNum(latestVersionNumLocal + 1);
      setSelectedVersionIndex((result.process?.results?.length || 1) - 1);

      toast({
        title: "Success",
        description: `Version ${latestVersionNumLocal + 1} saved.`
      });
    } catch (error: any) {
      setError(error.message);
      toast({
        title: "Error Saving Version",
        description: error.message,
        variant: "destructive"
      });
    } finally {
      setIsSubmittingVersion(false);
    }
  };

  const handleSubmitForApproval = async () => {
    if (!canSubmit || !contract?._id || !token || !apiUrl) return;
    setIsSubmittingApproval(true);
    setError(null);
    try {
      const response = await apiFetch(`${apiUrl}/contracts/${contract._id}/submit`, {
        method: "POST",
      });

      const result = await response.json();
      if (!response.ok) throw new Error(result.detail || "Failed to submit for approval");
      if (!result?._id && !result?.id) throw new Error("Submit response missing ID.");

      setContract(result as FullContractData);
      toast({
        title: "Success",
        description: "Submitted for approval."
      });
    } catch (error: any) {
      setError(error.message);
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive"
      });
    } finally {
      setIsSubmittingApproval(false);
    }
  };

  const handleApprove = async () => {
    if (!canApprove || !contract?._id || !token || !apiUrl) return;
    setIsApproving(true); setError(null);
    try {
      const response = await apiFetch(`${apiUrl}/contracts/${contract._id}/approve`, { method: "POST" });

      const result = await response.json();
      if (!response.ok) throw new Error(result.detail || "Failed to approve");
      if (!result?._id && !result?.id) throw new Error("Approve response missing ID.");

      setContract(result as FullContractData);
      toast({ title: "Success", description: "Approved." });
    } catch (error: any) {
      setError(error.message);
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } finally {
      setIsApproving(false);
    }
  };

  const handleReject = async (reasonInput: string | null) => {
    if (!canReject || !contract?._id || !token || !apiUrl) return;
    setIsRejecting(true); setError(null);
    try {
      const response = await apiFetch(`${apiUrl}/contracts/${contract._id}/reject`, {
        method: "POST",
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: reasonInput || null })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.detail || "Failed to reject");
      if (!result?._id && !result?.id) throw new Error("Reject response missing ID.");
      setContract(result as FullContractData);
      setRejectReason("");
      setIsRejectModalOpen(false);
      toast({ title: "Contract Rejected" });
    } catch (error: any) {
      setError(error.message);
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } finally {
      setIsRejecting(false);
    }
  };

  const handleMarkComplete = async () => {
    if (!canMarkComplete || !contract?._id || !token || !apiUrl) return;
    setIsCompleting(true); setError(null);
    try {
      const response = await apiFetch(`${apiUrl}/contracts/${contract._id}/complete`, { method: "POST" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.detail || "Failed to mark complete");
      if (!result?._id && !result?.id) throw new Error("Complete response missing ID.");
      setContract(result as FullContractData);
      toast({ title: "Success", description: "Marked complete." });
    } catch (error: any) {
      setError(error.message);
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } finally {
      setIsCompleting(false);
    }
  };

  const handleRequestReEdit = async () => {
    if (!canRequestReEdit || !contract?._id || !token || !apiUrl) return;
    if (reEditRequestReason.length < 10) {
      toast({ title: "Reason Required", description: "Please provide a reason of at least 10 characters.", variant: "destructive" });
      return;
    }
    setIsRequestingReEdit(true);
    try {
      const response = await apiFetch(`${apiUrl}/contracts/${contract._id}/request-reedit`, {
        method: "POST",
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: reEditRequestReason })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.detail || "Failed to submit re-edit request");

      setContract(result as FullContractData);
      setIsReEditRequestModalOpen(false);
      setReEditRequestReason("");
      toast({ title: "Success", description: "Your request to re-edit has been submitted." });
    } catch (error: any) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } finally {
      setIsRequestingReEdit(false);
    }
  };

  const handleApproveReEdit = async () => {
    if (!canDecideOnReEdit || !contract?._id || !token || !apiUrl) return;
    setIsApprovingReEdit(true);
    try {
      const response = await apiFetch(`${apiUrl}/contracts/${contract._id}/approve-reedit`, {
        method: "POST",
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.detail || "Failed to approve re-edit request");

      setContract(result as FullContractData);
      toast({ title: "Re-edit Approved", description: "The contract is now available for editing." });
    } catch (error: any) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } finally {
      setIsApprovingReEdit(false);
    }
  };

  const handleDenyReEdit = async () => {
    if (!canDecideOnReEdit || !contract?._id || !token || !apiUrl) return;
    if (reEditDenialReason.length < 10) {
      toast({ title: "Reason Required", description: "Please provide a denial reason of at least 10 characters.", variant: "destructive" });
      return;
    }
    setIsDenyingReEdit(true);
    try {
      const response = await apiFetch(`${apiUrl}/contracts/${contract._id}/deny-reedit`, {
        method: "POST",
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: reEditDenialReason })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.detail || "Failed to deny re-edit request");

      setContract(result as FullContractData);
      setIsDenyReEditModalOpen(false);
      setReEditDenialReason("");
      toast({ title: "Request Denied", description: "The re-edit request has been denied." });
    } catch (error: any) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } finally {
      setIsDenyingReEdit(false);
    }
  };

  const [isAcknowledging, setIsAcknowledging] = useState(false)

  const handleAcknowledgeDenial = async () => {
    if (contract?.status !== 'Re-edit Denied' || !isAssignedEditor || !token || !apiUrl) return;

    setIsAcknowledging(true);
    try {
      const response = await apiFetch(`${apiUrl}/contracts/${contract._id}/acknowledge-denial`, {
        method: "POST",
      });
      if (!response.ok) {
        const result = await response.json();
        throw new Error(result.detail || "Failed to acknowledge denial");
      }

      toast({
        title: "Denial Acknowledged",
        description: "The contract has been moved back to Completed.",
      });
      // Navigate back to the history page after acknowledgment
      router.push('/history');

    } catch (error: any) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } finally {
      setIsAcknowledging(false);
    }
  };

  const handlePdfSearch = (word: string) => {
    setSearchValue(word);
  };

  // Removed handleGenerateReport
  
  useEffect(() => {
    if (activeTab === "raw" && rawSearchValue && rawSearchValue.trim() !== "" && rawViewRef.current) {
      const timer = setTimeout(() => {
        const marks = rawViewRef.current?.querySelectorAll("mark");
        if (marks && marks.length > 0) {
          const activeMark = rawViewRef.current?.querySelector(`mark[data-segment-index="${activeHighlightIndex}"]`) as HTMLElement;
          const targetMark = activeMark || marks[currentHighlightIndex] || marks[0];

          if (targetMark) {
            targetMark.scrollIntoView({
              behavior: "smooth",
              block: "center",
              inline: "nearest"
            });
          }
        }
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [activeTab, rawSearchValue, highlightedRawContent, activeHighlightIndex, currentHighlightIndex]);

  useEffect(() => {
    if (activeTab !== "kpis") {
      setIsKpiAgentOpen(false);
    }
  }, [activeTab]);

  const handlePdfCitationAndSwitch = (
    citationText: string,
    confidence: QuestionAnswerConfidence,
    allSegments?: CitedSegment[],
    targetContractId?: string | null,
    targetFilename?: string | null
  ) => {
    if (isUnprocessed) {
      toast({
        title: "Contract Not Ingested",
        description: "Cannot show citation details until indexed text is available.",
        variant: "default"
      });
      return;
    }

    const cleanedCitationText = citationText?.trim() || "";
    const pdfCitationEntries = allSegments && allSegments.length > 0
      ? allSegments.map((segment) => ({
          page: segment.page ?? segment.page_number,
          quote: segment.text || cleanedCitationText,
        }))
      : cleanedCitationText
        ? [{ quote: cleanedCitationText }]
        : [];
    const normalizedTargetFilename = targetFilename?.trim().toLowerCase();
    const filenameMatchedDocument = normalizedTargetFilename
      ? workspaceDocuments.find((document) => document.contract_name.trim().toLowerCase() === normalizedTargetFilename)
      : null;
    const resolvedTargetContractId =
      targetContractId ||
      allSegments?.[0]?.contract_id ||
      filenameMatchedDocument?._id ||
      contractId ||
      null;
    const resolvedTargetName =
      targetFilename ||
      allSegments?.[0]?.contract_name ||
      workspaceDocuments.find((document) => document._id === resolvedTargetContractId)?.contract_name ||
      (resolvedTargetContractId === contractId ? contract?.contract_name : null);

    setSearchValue(pdfCitationEntries.length > 0 ? JSON.stringify(pdfCitationEntries) : "");
    setPdfViewerContractId(resolvedTargetContractId);
    setPdfViewerDocumentName(resolvedTargetName || null);
    setSelectedAgentDocument(null);
    setAgentDocumentPreview(null);
    setRawSearchValue("");
    setActiveHighlightIndex(null);
    setTotalHighlights(0);

    setCurrentHighlightIndex(0);
    setActiveTab("default");
  };

  useEffect(() => {
    const citationKey = searchParams.get("kpi_citation");
    if (!citationKey || handledKpiCitationRef.current === citationKey || !contract) return;
    const storedCitation = window.sessionStorage.getItem(`contractsense:kpiCitation:${citationKey}`);
    if (!storedCitation) return;
    handledKpiCitationRef.current = citationKey;
    try {
      const parsed = JSON.parse(storedCitation) as {
        quote?: string;
        page?: number | string | null;
        kpi_id?: string;
        document_id?: string | null;
        filename?: string | null;
      };
      const parsedPage = parsed.page == null || parsed.page === "" ? null : Number(parsed.page);
      const citationSegment: CitedSegment = {
        id: parsed.kpi_id || citationKey,
        text: parsed.quote || "",
        page: parsed.page,
        page_number: parsedPage != null && Number.isFinite(parsedPage) ? parsedPage : null,
        type: "kpi",
        contract_id: parsed.document_id || contractId || null,
        contract_name: parsed.filename || contract.contract_name,
      };
      handlePdfCitationAndSwitch(
        parsed.quote || "",
        "high",
        [citationSegment],
        parsed.document_id || contractId || null,
        parsed.filename || contract.contract_name,
      );
      window.sessionStorage.removeItem(`contractsense:kpiCitation:${citationKey}`);
    } catch {
      toast({
        title: "Could not open KPI citation",
        description: "The stored KPI citation could not be read.",
        variant: "destructive",
      });
    }
  }, [contract, contractId, searchParams]);

  const handleKpiCitationClick = useCallback((kpi: ContractKPI) => {
    const citation = kpi.citation || kpi.citation_details || {};
    const quote = citation.quote || kpi.source_quote || kpi.quote || kpi.clause_text || "";
    const targetContractId = citation.document_id || citation.doc_id || kpi.document_id || kpi.contract_id || contractId || null;
    const targetFilename = citation.filename || kpi.contract_name || contract?.contract_name || null;
    const citationSegment: CitedSegment = {
      id: citation.segment_id || kpi.chunk_id || kpi.kpi_id,
      text: quote,
      page: citation.page ?? citation.page_start ?? kpi.page_start,
      page_number: citation.page_start ?? kpi.page_start,
      type: "kpi",
      contract_id: targetContractId,
      contract_name: targetFilename,
    };

    handlePdfCitationAndSwitch(
      quote,
      (kpi.confidence || 0) >= 0.8 ? "high" : (kpi.confidence || 0) >= 0.55 ? "medium" : "low",
      quote ? [citationSegment] : undefined,
      targetContractId,
      targetFilename,
    );
  }, [contract?.contract_name, contractId]);

  const handleAgentArtifactCreated = useCallback((artifact: { document_id?: string; version_id?: string }) => {
    void fetchAgentDocuments();
    if (artifact.document_id && artifact.version_id) {
      setSelectedAgentDocument({ documentId: artifact.document_id, versionId: artifact.version_id });
      setSearchValue("");
      setRawSearchValue("");
      setActiveTab("docx");
    }
  }, [fetchAgentDocuments]);

  const highlightSingleSegment = (index: number) => {
    if (!rawSearchValue) return;

    try {
      const segments = JSON.parse(rawSearchValue) as CitedSegment[];
      if (Array.isArray(segments) && segments[index]) {
        setActiveHighlightIndex(index);

        setTimeout(() => {
          const marks = rawViewRef.current?.querySelectorAll("mark");
          if (marks && marks.length > index) {
            marks[index].scrollIntoView({
              behavior: "smooth",
              block: "center",
              inline: "nearest"
            });
          }
        }, 100);
      }
    } catch (e) {
      setTimeout(() => {
        const marks = rawViewRef.current?.querySelectorAll("mark");
        if (marks && marks.length > index) {
          marks[index].scrollIntoView({
            behavior: "smooth",
            block: "center",
            inline: "nearest"
          });
        }
      }, 100);
    }
  };

  const handleExportToCSV = (versionData: any) => {
    const thinkContent = contract?.contract_think || "";
    const structuredData = versionData.results.map((result: any, index: number) => ({
      Question: result.question,
      Answer: result.answer,
      Reason: result.reason,
      "Think Content": index === 0 ? thinkContent : ""
    }));
    const csvData = convertToCSV(structuredData);
    const blob = new Blob([csvData], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${versionData.contract_name}_analysis.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
  };

  // Removed handleExportToPDF


  const convertToCSV = (data: any[]) => {
    if (data.length === 0) return '';
    const headers = ['Question', 'Answer', 'Reason', 'Think Content']
      .map(header => `"${header.replace(/"/g, '""')}"`)
      .join(',');
    const rows = data.map((row) =>
      [row.Question, row.Answer, row.Reason, row['Think Content']]
        .map((value) => {
          const stringValue = typeof value === 'string' ? value : String(value);
          return `"${stringValue.replace(/"/g, '""')}"`;
        })
        .join(',')
    );
    return [headers, ...rows].join('\n');
  };

  const formatRawContent = (content: string): string => {
    if (!content) return '*No content available*';

    let formatted = content
      .replace(/\{(\d+)\}-+[\r\n]+/g, '\n\n---\n\n**Page $1**\n\n---\n\n');

    return formatted
      .replace(/(\n\d+\.\s+)([A-Z][A-Z\s]+[A-Z])(\.?)/g, '\n## $2\n')
      .replace(/\*\*([^*]+)\*\*/g, '**$1**')
      .replace(/__([^_]+)__/g, '**$1**')
      .replace(/(\n\s*)(\d+\.)\s+/g, '$1$2 ')
      .replace(/(\n\s*)[•\-]\s+/g, '$1- ')
      .replace(/(\n\s*)([^\n]+)\s*\|\s*([^\n]+)/g, '$1| $2 | $3 |')
      .replace(/(\n)([A-Z][A-Z\s]+[A-Z])(\n)/g, '$1\n## $2$3');
  };

  const isLoading = loadingContract || loadingUser;

  if (!isClientLoaded) {
    return null;
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-white">
        <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
          <ContractLoadingScreen />
        </main>
      </div>
    );
  }

  if (error || !contract) {
    return (
      <div className="min-h-screen bg-white">
        <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-20 rounded-md border border-red-200 bg-red-50 p-8"
          >
            <div className="flex items-start space-x-3">
              <AlertCircle className="h-6 w-6 text-red-600" />
              <div>
                <h3 className="text-red-800 font-semibold text-lg">
                  Error loading contract details
                </h3>
                <p className="text-red-700 mt-2">{error || "No contract found"}</p>
              </div>
            </div>
          </motion.div>
        </main>
      </div>
    );
  }

  const isKpiWorkspace = false;
  const documentTabsValue = activeTab === "kpis" ? "default" : activeTab;
  const renderContractAgentPanel = () => (
    <ContractAgentPanel
      contractId={contract._id}
      contractName={contract.contract_name}
      projectId={contractProjectId}
      roleLabel={agentRoleLabel}
      userName={currentUserInfo?.username ?? ""}
      canEdit={canEdit}
      canApprove={canApprove}
      canRequestReEdit={canRequestReEdit}
      apiUrl={apiUrl}
      token={token}
      aiProvider={aiProvider}
      initialSessionId={initialAgentSessionId}
      referenceDocuments={agentReferenceDocuments}
      onAiProviderChange={setAiProvider}
      onArtifactCreated={handleAgentArtifactCreated}
      onCitationClick={(citationText, confidence, citedSegments, targetContractId, targetFilename) =>
        handlePdfCitationAndSwitch(citationText, confidence, citedSegments, targetContractId, targetFilename)
      }
    />
  );

  return (
    <div className="h-screen overflow-hidden bg-white font-InterVar text-gray-900">
      <main className="h-screen">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="flex h-screen min-h-0 flex-col"
        >
          {error && (
            <div className="text-center text-red-600 bg-red-100 p-3 rounded-md border border-red-300 shadow-sm mx-auto max-w-2xl text-sm">
              <AlertCircle className="h-5 w-5 inline-block mr-2 text-red-500" />
              <span className="font-semibold">Error:</span> {error}
            </div>
          )}

          {contract && currentUserInfo && (
            <motion.div layout className="flex min-h-0 flex-1 flex-col bg-white">
              {/* Re-edit Request Notification Banner */}
              {canDecideOnReEdit && contract.reEditRequest && (
                <div className="border-b border-amber-200 bg-amber-50 px-4 py-3 md:px-10">
                  <h3 className="font-semibold text-amber-800">Review Re-edit Request</h3>
                  <p className="text-sm text-amber-700 mt-1">
                    The editor has requested to re-open this contract for editing for the following reason:
                  </p>
                  <blockquote className="mt-2 border-l-4 border-amber-300 pl-3 text-sm italic text-gray-700">
                    "{contract.reEditRequest.reason}"
                  </blockquote>
                </div>
              )}

              <div className="flex min-h-16 shrink-0 items-center gap-3 border-b border-gray-200 bg-white px-4 py-3 md:px-6">
                <Button variant="ghost" size="icon" onClick={() => router.back()} className="h-8 w-8 shrink-0 text-gray-500 hover:text-gray-900" title="Back">
                  <ArrowLeft className="h-4 w-4" />
                </Button>
                <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden text-sm text-gray-500">
                  <Link href="/dashboard" className="hidden shrink-0 font-serif text-2xl font-light text-gray-700 hover:text-gray-950 sm:inline">
                    Projects
                  </Link>
                  <span className="hidden shrink-0 text-gray-300 sm:inline">›</span>
                  <span className="truncate font-serif text-2xl font-light text-gray-700">
                    {workspaceProjectName}{workspaceProjectId ? ` (#${workspaceProjectId.slice(-6)})` : ""}
                  </span>
                  <span className="shrink-0 text-gray-300">›</span>
                  <span className="hidden shrink-0 font-serif text-2xl font-light text-gray-700 md:inline">Assistant</span>
                  <span className="hidden shrink-0 text-gray-300 md:inline">›</span>
                  <span className="truncate font-serif text-2xl font-light text-gray-950" title={contract.contract_name}>
                    {truncateMiddle(contract.contract_name, 34)}
                  </span>
                </div>

                <div className="ml-auto flex shrink-0 items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      const query = new URLSearchParams({ contract_id: contract._id });
                      if (workspaceProjectId) query.set("project_id", workspaceProjectId);
                      router.push(`/playbooks?${query.toString()}`);
                    }}
                    className="hidden h-8 gap-1.5 rounded-lg text-xs lg:inline-flex"
                  >
                    <BookOpen className="h-3.5 w-3.5" />
                    Run Playbook
                  </Button>
                  <span className={`hidden items-center rounded-full px-2.5 py-1 text-xs font-medium sm:inline-flex ${getStatusBadgeClass(contractStatus)}`} title={`Current Status: ${contractStatus}`}>
                    {getStatusIcon(contractStatus)} {displayStatus}
                  </span>

                  {canDecideOnReEdit && (
                    <>
                      <Button size="sm" onClick={handleApproveReEdit} disabled={isApprovingReEdit} className="hidden bg-gray-900 text-white hover:bg-gray-800 lg:inline-flex">
                        {isApprovingReEdit && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        <Check className="mr-1 h-4 w-4" /> Approve Re-edit
                      </Button>
                      <Dialog open={isDenyReEditModalOpen} onOpenChange={setIsDenyReEditModalOpen}>
                        <DialogTrigger asChild><Button size="sm" variant="destructive" className="hidden lg:inline-flex"><X className="mr-1 h-4 w-4" /> Deny</Button></DialogTrigger>
                        <DialogContent>
                          <DialogHeader><DialogTitle>Deny Re-edit Request</DialogTitle><DialogDescription>Please provide a reason for denying this request.</DialogDescription></DialogHeader>
                          <Textarea placeholder="e.g., The contract is legally finalized..." value={reEditDenialReason} onChange={(e) => setReEditDenialReason(e.target.value)} className="min-h-[100px]" />
                          <DialogFooter>
                            <DialogClose asChild><Button type="button" variant="ghost">Cancel</Button></DialogClose>
                            <Button variant="destructive" onClick={handleDenyReEdit} disabled={isDenyingReEdit}>{isDenyingReEdit && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Confirm Denial</Button>
                          </DialogFooter>
                        </DialogContent>
                      </Dialog>
                    </>
                  )}

                  {contractStatus === 'Re-edit Denied' && isAssignedEditor && (
                    <Button size="sm" onClick={handleAcknowledgeDenial} disabled={isAcknowledging} className="hidden bg-gray-900 text-white hover:bg-gray-800 lg:inline-flex">
                      {isAcknowledging && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                      Acknowledge
                    </Button>
                  )}

                  {!canDecideOnReEdit && contractStatus !== 'Re-edit Denied' && (
                    <>
                      {canSubmit && (
                        <TooltipProvider delayDuration={100}>
                          <Tooltip open={isViewingLastSave ? undefined : false}>
                            <TooltipTrigger asChild>
                              <span tabIndex={0} className="hidden lg:inline-flex">
                                <Button size="sm" onClick={handleSubmitForApproval} disabled={isSubmittingApproval || isSavingDraft || isSubmittingVersion || !canSubmit} className="bg-gray-900 text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-60">
                                  {isSubmittingApproval && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                  <Send className="mr-1 h-4 w-4" /> Submit
                                </Button>
                              </span>
                            </TooltipTrigger>
                            {isViewingLastSave && (<TooltipContent><p>Please save this draft as a new version first.</p></TooltipContent>)}
                          </Tooltip>
                        </TooltipProvider>
                      )}

                      {canApprove && (
                        <Button size="sm" onClick={handleApprove} disabled={isApproving} className="hidden bg-gray-900 text-white hover:bg-gray-800 lg:inline-flex">
                          {isApproving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} <Check className="mr-1 h-4 w-4" /> Approve
                        </Button>
                      )}

                      {canReject && (
                        <Dialog open={isRejectModalOpen} onOpenChange={setIsRejectModalOpen}>
                          <DialogTrigger asChild><Button size="sm" variant="destructive" disabled={isRejecting} className="hidden lg:inline-flex"><X className="mr-1 h-4 w-4" /> Reject</Button></DialogTrigger>
                          <DialogContent>
                            <DialogHeader><DialogTitle>Reject Contract</DialogTitle><DialogDescription>Provide reason (optional).</DialogDescription></DialogHeader>
                            <Textarea placeholder="Rejection reason..." value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} className="min-h-[80px]" />
                            <DialogFooter>
                              <DialogClose asChild><Button type="button" variant="ghost">Cancel</Button></DialogClose>
                              <Button variant="destructive" onClick={() => handleReject(rejectReason)} disabled={isRejecting}>{isRejecting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Confirm</Button>
                            </DialogFooter>
                          </DialogContent>
                        </Dialog>
                      )}

                      {canMarkComplete && (
                        <Button size="sm" onClick={handleMarkComplete} disabled={isCompleting} className="hidden bg-gray-900 text-white hover:bg-gray-800 lg:inline-flex">
                          {isCompleting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                          <Check className="mr-1 h-4 w-4" /> Complete
                        </Button>
                      )}

                      {canRequestReEdit && (
                        <Dialog open={isReEditRequestModalOpen} onOpenChange={setIsReEditRequestModalOpen}>
                          <DialogTrigger asChild><Button size="sm" variant="outline" className="hidden lg:inline-flex"><RefreshCw className="mr-1 h-4 w-4" /> Re-edit</Button></DialogTrigger>
                          <DialogContent>
                            <DialogHeader><DialogTitle>Request to Re-edit Contract</DialogTitle><DialogDescription>Provide a clear reason why this contract needs to be re-opened.</DialogDescription></DialogHeader>
                            <Textarea placeholder="e.g., The final scope of work has changed..." value={reEditRequestReason} onChange={(e) => setReEditRequestReason(e.target.value)} className="min-h-[100px]" />
                            <DialogFooter>
                              <DialogClose asChild><Button type="button" variant="ghost">Cancel</Button></DialogClose>
                              <Button onClick={handleRequestReEdit} disabled={isRequestingReEdit}>{isRequestingReEdit && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Submit Request</Button>
                            </DialogFooter>
                          </DialogContent>
                        </Dialog>
                      )}
                    </>
                  )}

                  <Button variant="ghost" size="icon" className="h-8 w-8 text-gray-500 hover:text-gray-900" title="New assistant chat">
                    <Plus className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-gray-500 hover:text-gray-900" title="Clear chat">
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              {contractStatus === 'Rejected' && contract.rejectedReason && (
                <div className="border-b border-red-100 bg-red-50 px-4 py-2 text-xs text-red-700 md:px-6">
                  <span className="font-semibold">Rejected:</span> <span className="italic">"{contract.rejectedReason}"</span>
                </div>
              )}

              {contractStatus === 'Re-edit Denied' && contract.reEditRequest?.denialReason && isAssignedEditor && (
                <div className="border-b border-orange-100 bg-orange-50 px-4 py-2 text-xs text-orange-700 md:px-6">
                  <span className="font-semibold">Re-edit denied:</span> <span className="italic">"{contract.reEditRequest.denialReason}"</span>
                </div>
              )}

              <div className="flex min-h-0 w-full flex-1 overflow-hidden">
                {!isKpiWorkspace && (
                  <ContractProjectExplorer
                    projectId={workspaceProjectId}
                    projectName={workspaceProjectName}
                    documents={explorerDocuments}
                    agentDocuments={agentDocuments}
                    currentContractId={contract._id}
                    selectedAgentDocumentId={selectedAgentDocument?.documentId || null}
                    isLoading={isWorkspaceLoading}
                    isAgentDocumentsLoading={isAgentDocumentsLoading}
                    isCreatingEditableCopy={isCreatingEditableCopy}
                    kpis={contractKpis}
                    sourceCatalog={kpiSourceCatalog}
                    sourceConfigs={kpiSourceConfigs}
                    sourceFetchRuns={kpiSourceFetchRuns}
                    sourceActionResults={kpiSourceActionResults}
                    isSourceLoading={isKpiSourceLoading}
                    isExplorerOpen={isExplorerOpen}
                    onToggleExplorer={() => setIsExplorerOpen((prev) => !prev)}
                    onOpenContractDocument={openContractDocument}
                    onOpenAgentDocument={openAgentDocument}
                    onCreateEditableCopy={createEditableCopy}
                    onCreateSourceConfig={createKpiSourceConfig}
                    onUpdateSourceConfig={updateKpiSourceConfig}
                    onMapTrackedKpis={mapTrackedKpisToSourceConfig}
                    onTestSourceConfig={testKpiSourceConfig}
                    onFetchSourceConfig={fetchKpiSourceConfig}
                    onLoadFetchRuns={loadKpiSourceFetchRuns}
                    onRefreshSources={fetchKpiSourceWorkspace}
                  />
                )}
                <div className="min-w-0 flex-1">
                <ResizablePanelGroup direction="horizontal" className="h-full w-full">

                  {/* Left Compartment: Document/PDF Workspace */}
                  <ResizablePanel defaultSize={isKpiWorkspace ? 54 : 66} minSize={42} className="flex h-full flex-col overflow-hidden border-r border-gray-200 bg-gray-50">
                    <Tabs
                      value={documentTabsValue}
                      onValueChange={setActiveTab}
                      className="flex-1 flex flex-col h-full"
                    >
                      <div className="flex min-h-12 flex-col gap-2 border-b border-gray-200 bg-white px-4 py-2 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <div className="text-sm font-medium text-gray-800">Document Viewer</div>
                        </div>
                        <TabsList className="grid h-9 w-full grid-cols-3 rounded-md bg-gray-100 p-1 sm:w-auto">
                          <TabsTrigger value="default" className="rounded px-2 text-xs data-[state=active]:bg-white data-[state=active]:text-gray-900">
                            <FileText className="h-4 w-4 mr-1 sm:mr-2" />PDF View
                          </TabsTrigger>
                          <TabsTrigger value="docx" disabled={!selectedAgentDocument} className="rounded px-2 text-xs data-[state=active]:bg-white data-[state=active]:text-gray-900">
                            DOCX
                          </TabsTrigger>
                          <button
                            type="button"
                            title="Open KPI management"
                            onClick={() => router.push(`/contracts/${contract._id}/kpis`)}
                            className="inline-flex items-center justify-center whitespace-nowrap rounded px-2 py-1 text-xs font-medium text-gray-500 transition-colors hover:text-gray-900"
                          >
                            <BarChart3 className="mr-1 h-4 w-4 sm:mr-2" />KPIs
                          </button>
                        </TabsList>
                      </div>

                      <TabsContent value="default" className=" overflow-auto bg-gray-50 rounded-b-lg h-full">
                        {token && (pdfViewerContractId || contractId) && (
                          <div className="flex h-full w-full flex-col">
                            {pdfViewerContractId && pdfViewerContractId !== contractId && (
                              <div className="flex min-h-10 items-center justify-between border-b border-blue-100 bg-blue-50 px-4 text-xs text-blue-800">
                                <span className="truncate">
                                  Viewing cited document: {pdfViewerDocumentName || "Project document"}
                                </span>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 px-2 text-xs text-blue-800 hover:bg-blue-100"
                                  onClick={() => {
                                    setPdfViewerContractId(contractId || null);
                                    setPdfViewerDocumentName(null);
                                    setSearchValue("");
                                  }}
                                >
                                  Back to opened contract
                                </Button>
                              </div>
                            )}
                            <PDFViewerDynamic
                              key={pdfViewerContractId || contractId || ""}
                              contractId={pdfViewerContractId || contractId || ""}
                              searchKey=""
                              searchValue={searchValue}
                              token={token}
                            />
                          </div>
                        )}
                      </TabsContent>

                      <TabsContent value="docx" className="h-full overflow-auto rounded-b-lg bg-gray-100">
                        <AgentDocumentPreviewPane
                          document={selectedAgentDocumentSummary}
                          preview={agentDocumentPreview}
                          isLoading={isAgentDocumentPreviewLoading}
                          selectedVersionId={selectedAgentDocument?.versionId || ""}
                          onVersionChange={(versionId) => {
                            if (!selectedAgentDocument) return;
                            setSelectedAgentDocument({ documentId: selectedAgentDocument.documentId, versionId });
                          }}
                          onDownload={() => downloadAgentDocumentVersion(agentDocumentPreview)}
                          onResolveEdit={resolveAgentDocumentEdit}
                          resolvingEditIds={resolvingAgentEditIds}
                          onSaveText={saveAgentDocumentText}
                          isSaving={isSavingAgentDocument}
                        />
                      </TabsContent>

                    </Tabs>
                  </ResizablePanel>

                  <ResizableHandle withHandle className="bg-gray-200" />

                  {/* Right Compartment: KPI tracking console in KPI mode, assistant otherwise */}
                  <ResizablePanel defaultSize={isKpiWorkspace ? 46 : 34} minSize={isKpiWorkspace ? 36 : 26} className="flex h-full flex-col overflow-hidden bg-white">
                    {isKpiWorkspace ? (
                      <div className="flex h-full min-h-0 flex-col">
                        <div className="flex h-12 shrink-0 items-center justify-between border-b border-gray-200 bg-white px-3">
                          <div>
                            <p className="text-sm font-semibold text-gray-950">Tracking Console</p>
                            <p className="text-[11px] text-gray-500">Review, sources, flags, logs</p>
                          </div>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-8 gap-1.5 px-2 text-xs"
                            onClick={() => setIsKpiAgentOpen(true)}
                            title="Open assistant"
                          >
                            <Menu className="h-3.5 w-3.5" />
                            Agent
                          </Button>
                        </div>
                        <div className="min-h-0 flex-1 overflow-hidden">
                          <ContractPerformanceDashboardPane
                            kpis={contractKpis}
                            summary={contractKpiSummary}
                            actuals={contractKpiActuals}
                            breaches={contractKpiBreaches}
                            sourceCatalog={kpiSourceCatalog}
                            sourceConfigs={kpiSourceConfigs}
                            sourceFetchRuns={kpiSourceFetchRuns}
                            sourceActionResults={kpiSourceActionResults}
                            isLoading={isKpisLoading}
                            isExtracting={isExtractingKpis}
                            isUploadingActuals={isUploadingKpiActuals}
                            isMonitoringLoading={isKpiMonitoringLoading}
                            isSourceLoading={isKpiSourceLoading}
                            onExtract={extractContractKpis}
                            onUploadActuals={uploadKpiActuals}
                            onRefresh={async () => {
                              await fetchContractKpis();
                              await fetchKpiMonitoring();
                            }}
                            onStatusChange={updateContractKpiStatus}
                            onAcceptAll={acceptAllContractKpis}
                            onTrackRecommended={trackRecommendedContractKpis}
                            onTrackKpi={trackContractKpi}
                            onFlagRemediationEmail={flagBreachRemediationEmail}
                            onUpdateKpi={updateContractKpi}
                            onCitationClick={handleKpiCitationClick}
                            onCreateSourceConfig={createKpiSourceConfig}
                            onUpdateSourceConfig={updateKpiSourceConfig}
                            onMapTrackedKpis={mapTrackedKpisToSourceConfig}
                            onTestSourceConfig={testKpiSourceConfig}
                            onFetchSourceConfig={fetchKpiSourceConfig}
                            onLoadFetchRuns={loadKpiSourceFetchRuns}
                            onRefreshSources={fetchKpiSourceWorkspace}
                          />
                        </div>
                      </div>
                    ) : (
                      renderContractAgentPanel()
                    )}
                  </ResizablePanel>

                </ResizablePanelGroup>
                {isKpiWorkspace && isKpiAgentOpen && (
                  <div className="fixed inset-0 z-[120] bg-black/20" onClick={() => setIsKpiAgentOpen(false)}>
                    <div
                      className="absolute inset-y-0 right-0 flex w-full max-w-[460px] flex-col bg-white shadow-2xl"
                      onClick={(event) => event.stopPropagation()}
                    >
                      <div className="flex h-12 shrink-0 items-center justify-between border-b border-gray-200 px-3">
                        <div>
                          <p className="text-sm font-semibold text-gray-950">Contract Assistant</p>
                          <p className="text-[11px] text-gray-500">Collapsed while tracking console is active</p>
                        </div>
                        <Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={() => setIsKpiAgentOpen(false)} title="Close assistant">
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                      <div className="min-h-0 flex-1">
                        {renderContractAgentPanel()}
                      </div>
                    </div>
                  </div>
                )}
                </div>
              </div>
            </motion.div>
          )}
        </motion.div>
      </main>

    </div>
  );
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

function kpiBindingsForSource(config: KPISourceConfig, kpis: ContractKPI[]) {
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

function ContractPerformanceDashboardPane({
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

      <div className="sticky top-0 z-20 border-b border-gray-200 bg-white/95 backdrop-blur">
        <div className="px-4 py-3">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
            <div className="flex min-w-0 items-start gap-3">
              <button
                type="button"
                onClick={() => window.history.back()}
              className="mt-0.5 rounded-md border border-gray-200 bg-white p-2 text-gray-500 hover:bg-gray-50 hover:text-gray-900"
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
              <Button type="button" size="sm" className="h-8 gap-1.5 bg-gray-950 text-xs text-white hover:bg-gray-800" onClick={activePanel === "review" ? onExtract : () => setActivePanel("integrations")} disabled={isExtracting || (activePanel !== "review" && !trackedKpis.length)}>
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
    gray: "bg-gray-50 text-gray-700",
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
        active ? "bg-white text-gray-950 shadow-sm" : "text-gray-500 hover:bg-white/60 hover:text-gray-950"
      }`}
    >
      {icon}
      <span className="truncate">{label}</span>
      <span className={`ml-1 rounded-full px-1.5 py-0.5 text-[10px] ${active ? "bg-gray-100 text-gray-600" : "bg-white text-gray-500"}`}>
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
          <div key={item} className="h-32 animate-pulse rounded-lg border border-gray-200 bg-white" />
        ))}
      </div>
    );
  }

  if (!kpis.length) {
    return (
      <div className="flex min-h-[420px] flex-col items-center justify-center rounded-lg border border-gray-200 bg-white px-6 text-center">
        <div className="mb-3 rounded-full bg-gray-100 p-3">
          <BarChart3 className="h-6 w-6 text-gray-500" />
        </div>
        <h3 className="text-base font-semibold text-gray-950">No KPI review yet</h3>
        <p className="mt-2 max-w-md text-sm leading-6 text-gray-500">
          Extract contract KPIs to populate the review grid, tracking decisions, source setup, and compliance checks.
        </p>
        <Button type="button" className="mt-4 gap-2 bg-gray-950 text-white hover:bg-gray-800" onClick={onExtract} disabled={isExtracting}>
          {isExtracting ? <Loader2 className="h-4 w-4 animate-spin" /> : <BarChart3 className="h-4 w-4" />}
          Extract KPIs
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <section className="rounded-lg border border-gray-200 bg-white shadow-sm">
        <div className="flex flex-col gap-3 px-4 py-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-gray-950">Review & Activate</h3>
            <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] font-semibold">
              <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-1 text-emerald-700">{approvedCount} accepted</span>
              <span className="rounded-full border border-blue-200 bg-blue-50 px-2 py-1 text-blue-700">{trackedCount} tracked</span>
              <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-1 text-amber-700">{deferredCount} deferred</span>
              <span className="rounded-full border border-gray-200 bg-gray-50 px-2 py-1 text-gray-600">{pendingCount} pending</span>
              {removedCount > 0 && <span className="rounded-full border border-gray-200 bg-white px-2 py-1 text-gray-500">{removedCount} removed</span>}
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
                  : "border-gray-200 bg-gray-50 text-gray-600";
          const backfillCount = Number(kpi.last_tracking_backfill?.created_breach_count || 0);

          return (
            <article
              key={kpi.kpi_id || `${kpi.name}-${index}`}
              className={`rounded-lg border bg-white shadow-sm transition-colors ${
                tracked ? "border-emerald-200" : kpi.status === "ignored" ? "border-gray-200 opacity-70" : "border-gray-200"
              }`}
            >
              <div className="p-3">
                <div className="flex items-start gap-3">
                  <div className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border ${
                    tracked ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-gray-200 bg-gray-50 text-gray-500"
                  }`}>
                    {tracked ? <CheckCircle2 className="h-4 w-4" /> : <ClipboardCheck className="h-4 w-4" />}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-mono text-[11px] font-semibold text-gray-400">{kpiDisplayCode(kpi, index)}</span>
                      <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${kpiStatusClass(kpi.status)}`}>
                        {titleCase(kpi.status || "review")}
                      </span>
                      <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${tracked ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-amber-200 bg-amber-50 text-amber-700"}`}>
                        {tracked ? "Tracked" : "Not tracked"}
                      </span>
                      {recommended && !tracked && <span className="rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-700">Recommended</span>}
                      {backfillCount > 0 && <span className="rounded-full border border-purple-200 bg-purple-50 px-2 py-0.5 text-[10px] font-semibold text-purple-700">{backfillCount} backfilled</span>}
                    </div>
                    <h4 className="mt-1 line-clamp-2 text-sm font-semibold leading-5 text-gray-950">{kpi.name}</h4>
                    <p className="mt-0.5 truncate text-[11px] text-gray-400">{kpi.structural_path || kpi.section_path || kpi.section || "No section captured"}</p>
                  </div>

                  <button type="button" onClick={() => setExpandedKpiId(expanded ? null : kpi.kpi_id)} className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700">
                    <ChevronDown className={`h-4 w-4 transition-transform ${expanded ? "rotate-180" : ""}`} />
                  </button>
                </div>

                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  <KpiCardField label="Threshold" value={formatKpiValue(kpi)} />
                  <KpiCardField label="Penalty" value={formatConsequence(kpi)} />
                  <KpiCardField label="Owner" value={kpi.party || kpi.responsible_party || "Not specified"} />
                  <KpiCardField label="Source" value={`${source.name} · ${source.cadence}`} toneClass={sourceToneClass} />
                </div>

                <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap gap-1.5">
                    <button
                      type="button"
                      onClick={() => onStatusChange(kpi, kpi.status === "approved" ? "needs_review" : "approved")}
                      className={`rounded-md border px-2.5 py-1.5 text-[11px] font-semibold ${kpi.status === "approved" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50"}`}
                    >
                      {kpi.status === "approved" ? "Accepted" : "Accept"}
                    </button>
                    {!tracked && kpi.status !== "ignored" && (
                      <button type="button" onClick={() => onTrackKpi(kpi)} className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-[11px] font-semibold text-emerald-700 hover:bg-emerald-100">
                        <Play className="h-3 w-3" />
                        Track
                      </button>
                    )}
                    <button type="button" onClick={() => onStatusChange(kpi, "ignored")} className="rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-gray-500 hover:bg-gray-50">
                      Remove
                    </button>
                  </div>
                  <Button type="button" variant="ghost" size="sm" className="h-7 gap-1 px-2 text-[11px] text-gray-500" onClick={() => onCitationClick(kpi)}>
                    <ExternalLink className="h-3 w-3" />
                    Clause
                  </Button>
                </div>
              </div>

              {expanded && (
                <div className="grid gap-3 border-t border-gray-100 bg-gray-50 p-3 md:grid-cols-2">
                  <KpiDetail label="Source Text" value={quote || "No quote captured."} />
                  <KpiDetail label="Rule" value={kpi.evaluation_rule?.breach_when || kpi.formula || `${kpi.operator || "specified"} ${kpi.value ?? kpi.value_min ?? "target"}`} />
                  <KpiDetail label="Window" value={`${titleCase(kpi.period_type || "per_event")} · ${titleCase(kpi.evaluation_window || "current_record")}`} />
                  <KpiDetail label="Source Mapping" value={linkedSourceConfig ? `${linkedSourceConfig.display_name} · ${titleCase(linkedSourceConfig.status || "ready")}` : "Not configured"} />
                  <KpiDetail label="Remediation" value={kpi.remediation || kpi.remediation_sla || "Not specified"} />
                  <KpiDetail label="Contact" value={kpi.contact_email || "Not specified"} />
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
    <div className={`min-w-0 rounded-md border px-2.5 py-2 ${toneClass || "border-gray-200 bg-gray-50 text-gray-700"}`}>
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
    <section className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
      <div className="flex flex-col gap-3 border-b border-gray-100 px-4 py-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="min-w-0">
          <h4 className="text-sm font-semibold text-gray-950">Actual Ingestion</h4>
          <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] font-semibold">
            <span className="rounded-full border border-blue-200 bg-blue-50 px-2 py-1 text-blue-700">{userSourceConfigs.length} source{userSourceConfigs.length === 1 ? "" : "s"}</span>
            <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-1 text-emerald-700">{trackedCount} tracked KPI{trackedCount === 1 ? "" : "s"}</span>
            {platformManagedCount > 0 && <span className="rounded-full border border-gray-200 bg-gray-50 px-2 py-1 text-gray-600">{platformManagedCount} managed</span>}
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
        <aside className="border-b border-gray-100 bg-gray-50 p-3 lg:border-b-0 lg:border-r">
          <div className="mb-4">
            <p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-gray-400">Sources</p>
            <div className="space-y-1.5">
              {userSourceConfigs.length ? userSourceConfigs.map((config) => {
                const selected = selectedSourceConfig?.source_config_id === config.source_config_id;
                return (
                  <button
                    key={config.source_config_id}
                    type="button"
                    onClick={() => setSelectedSourceConfigId(config.source_config_id)}
                    className={`w-full rounded-lg border p-2 text-left transition-colors ${selected ? "border-blue-200 bg-white shadow-sm" : "border-gray-200 bg-white/70 hover:border-gray-300 hover:bg-white"}`}
                  >
                    <div className="flex items-start gap-2">
                      <span className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md border ${sourceStatusTone(config)}`}>
                        <UploadCloud className="h-3.5 w-3.5" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs font-semibold text-gray-900">{config.display_name}</span>
                        <span className="mt-0.5 block truncate text-[11px] text-gray-500">{titleCase(config.source_type)} · {enabledKpiIdsForSource(config, kpis).length} KPI{enabledKpiIdsForSource(config, kpis).length === 1 ? "" : "s"}</span>
                      </span>
                    </div>
                    <span className={`mt-2 inline-flex rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${sourceStatusTone(config)}`}>
                      {titleCase(config.last_error ? "last_fetch_failed" : config.status || "draft")}
                    </span>
                  </button>
                );
              }) : (
                <div className="rounded-lg border border-dashed border-gray-200 bg-white px-3 py-3 text-xs leading-5 text-gray-500">No source configured.</div>
              )}
            </div>
          </div>

          <div>
            <p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-gray-400">Add Source</p>
            <div className="grid gap-1.5">
              {userSourceCatalog.map((source) => (
                <button
                  key={source.source_type}
                  type="button"
                  onClick={() => onCreateSourceConfig(source)}
                  disabled={isSourceLoading}
                  className="flex items-center justify-between gap-2 rounded-lg border border-gray-200 bg-white px-2 py-2 text-left transition-colors hover:border-blue-200 hover:bg-blue-50 disabled:opacity-60"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-xs font-semibold text-gray-900">{source.label}</span>
                    <span className="block truncate text-[10px] text-gray-400">{titleCase(source.source_type)}</span>
                  </span>
                  <Plus className="h-3.5 w-3.5 shrink-0 text-gray-400" />
                </button>
              ))}
            </div>
          </div>
        </aside>

        <div className="min-w-0 p-3">
          {selectedSourceConfig ? (
            <div className="space-y-3">
              <div className="flex flex-col gap-3 rounded-lg border border-gray-200 bg-gray-50 p-3 xl:flex-row xl:items-center xl:justify-between">
                <div className="min-w-0">
                  <h5 className="truncate text-sm font-semibold text-gray-950">{selectedSourceConfig.display_name}</h5>
                  <p className="mt-1 truncate text-xs text-gray-500">{titleCase(selectedSourceConfig.source_type)} · {titleCase(selectedSourceConfig.schedule?.cadence || "manual")} · last success {selectedSourceConfig.last_success_at || "not yet"}</p>
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
                      className={`inline-flex items-center justify-center gap-1 rounded px-2 py-1.5 text-[11px] font-semibold ${sourceSetupTab === tab.id ? "bg-white text-gray-950 shadow-sm" : "text-gray-500 hover:text-gray-800"}`}
                    >
                      {tab.icon}
                      <span className="hidden sm:inline">{tab.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {sourceSetupTab === "upload" && (
                <div className="grid gap-3 xl:grid-cols-[0.9fr_1.1fr]">
                  <div className="space-y-3 rounded-lg border border-gray-200 bg-white p-3">
                    <label className="block text-[10px] font-bold uppercase tracking-wide text-gray-400">
                      Display name
                      <input
                        key={`${selectedSourceConfig.source_config_id}-name`}
                        defaultValue={selectedSourceConfig.display_name}
                        onBlur={(event) => updateSelectedSource({ display_name: event.target.value })}
                        className="mt-1 h-9 w-full rounded-md border border-gray-200 px-2 text-sm font-medium text-gray-800"
                      />
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      <label className="block text-[10px] font-bold uppercase tracking-wide text-gray-400">
                        Type
                        <select
                          value={selectedSourceConfig.source_type}
                          onChange={(event) => updateSelectedSource({ source_type: event.target.value, file_format: event.target.value === "manual_attestation" ? "json" : event.target.value })}
                          className="mt-1 h-9 w-full rounded-md border border-gray-200 bg-white px-2 text-sm text-gray-700"
                        >
                          <option value="csv">CSV</option>
                          <option value="xlsx">Excel</option>
                          <option value="json">JSON</option>
                          <option value="xml">XML</option>
                          <option value="manual_attestation">Manual</option>
                        </select>
                      </label>
                      <label className="block text-[10px] font-bold uppercase tracking-wide text-gray-400">
                        Record path
                        <input
                          key={`${selectedSourceConfig.source_config_id}-record`}
                          defaultValue={selectedSourceConfig.record_path || ""}
                          onBlur={(event) => updateSelectedSource({ record_path: event.target.value })}
                          placeholder="records"
                          className="mt-1 h-9 w-full rounded-md border border-gray-200 px-2 text-sm text-gray-700"
                        />
                      </label>
                    </div>
                    <Button type="button" variant="outline" size="sm" className="h-8 w-full gap-1.5 text-xs" onClick={onOpenActualsUpload} disabled={isUploadingActuals || trackedCount === 0}>
                      {isUploadingActuals ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                      Upload Actuals File
                    </Button>
                  </div>
                  <div className="rounded-lg border border-gray-200 bg-white p-3">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <p className="text-[10px] font-bold uppercase tracking-wide text-gray-400">Sample Payload</p>
                      <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-[11px] text-gray-500" onClick={saveSamplePayload}>
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
                <div className="rounded-lg border border-gray-200 bg-white p-3">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-wide text-gray-400">Field Mapping</p>
                      <p className="mt-1 text-xs text-gray-500">Default fields apply to each binding unless that KPI overrides them.</p>
                    </div>
                    <Link
                      href={`/contracts/${selectedSourceConfig.contract_id || ""}/kpis`}
                      className="rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-gray-700 hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700"
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
                <div className="space-y-3 rounded-lg border border-gray-200 bg-white p-3">
                  <div className="grid gap-2 md:grid-cols-2">
                    <label className="block text-[10px] font-bold uppercase tracking-wide text-gray-400">
                      Dedupe key
                      <input key={`${selectedSourceConfig.source_config_id}-dedupe`} defaultValue={selectedSourceConfig.dedupe_key || "source_record_id"} onBlur={(event) => updateSelectedSource({ dedupe_key: event.target.value })} placeholder="source_record_id" className="mt-1 h-9 w-full rounded-md border border-gray-200 px-2 text-sm" />
                    </label>
                    <label className="block text-[10px] font-bold uppercase tracking-wide text-gray-400">
                      Watermark
                      <input key={`${selectedSourceConfig.source_config_id}-watermark`} defaultValue={selectedSourceConfig.watermark_field || "timestamp"} onBlur={(event) => updateSelectedSource({ watermark_field: event.target.value })} placeholder="timestamp" className="mt-1 h-9 w-full rounded-md border border-gray-200 px-2 text-sm" />
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
                  <div className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 bg-white p-3">
                    <Button type="button" variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={() => onTestSourceConfig(selectedSourceConfig)} disabled={isSourceLoading}>
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      Test
                    </Button>
                    <Button type="button" size="sm" className="h-8 gap-1.5 bg-gray-950 text-xs text-white hover:bg-gray-800" onClick={() => onFetchSourceConfig(selectedSourceConfig)} disabled={isSourceLoading}>
                      {isSourceLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                      Fetch Now
                    </Button>
                    <span className="rounded-full border border-gray-200 bg-gray-50 px-2 py-1 text-[11px] font-semibold text-gray-600">Manual</span>
                    <span className="rounded-full border border-gray-200 bg-gray-50 px-2 py-1 text-[11px] font-semibold text-gray-600">Watermark: {selectedSourceConfig.watermark_value || "none"}</span>
                  </div>
                  <div className="grid gap-2 md:grid-cols-2">
                    {selectedRuns.length ? selectedRuns.slice(0, 6).map((run) => (
                      <div key={run.run_id} className="rounded-lg border border-gray-200 bg-white px-3 py-2">
                        <div className="flex items-center justify-between gap-2 text-xs">
                          <span className="truncate font-semibold text-gray-800">{titleCase(run.status || "run")}</span>
                          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-semibold text-gray-500">{run.records_accepted || 0}/{run.records_fetched || 0}</span>
                        </div>
                        <p className="mt-1 truncate text-[11px] text-gray-400">{run.trigger_type || "manual"} · {run.finished_at || run.started_at || "running"}</p>
                      </div>
                    )) : (
                      <div className="rounded-lg border border-dashed border-gray-200 bg-white px-3 py-3 text-xs text-gray-400">No fetch runs yet.</div>
                    )}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="flex min-h-[280px] items-center justify-center rounded-lg border border-dashed border-gray-200 bg-gray-50 text-sm text-gray-500">
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
    <div className="mb-3 rounded-lg border border-gray-200 bg-gray-50 p-2">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-[10px] font-bold uppercase tracking-wide text-gray-400">KPI Bindings</p>
        <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${enabledCount ? "border-blue-200 bg-blue-50 text-blue-700" : "border-amber-200 bg-amber-50 text-amber-700"}`}>
          {enabledCount} enabled
        </span>
      </div>
      {visibleBindings.length ? (
        <div className="max-h-52 overflow-auto rounded-md border border-gray-200 bg-white">
          <table className="min-w-full text-left text-xs">
            <thead className="sticky top-0 bg-gray-50 text-[10px] font-bold uppercase tracking-wide text-gray-400">
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
                    ? "border-gray-200 bg-gray-50 text-gray-600"
                    : "border-amber-200 bg-amber-50 text-amber-700";
                return (
                  <tr key={binding.binding_id || binding.kpi_id} className="align-top">
                    <td className="max-w-[240px] px-2 py-1.5">
                      <p className="font-mono text-[10px] font-semibold text-gray-400">
                        {linked ? kpiDisplayCode(linked.kpi, linked.index) : binding.kpi_id}
                      </p>
                      <p className="mt-0.5 truncate font-semibold text-gray-900">{linked?.kpi.name || binding.kpi_id}</p>
                    </td>
                    <td className="px-2 py-1.5">
                      <span className={`rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${binding.enabled === false ? "border-gray-200 bg-gray-50 text-gray-600" : "border-blue-200 bg-blue-50 text-blue-700"}`}>
                        {binding.enabled === false ? "Off" : binding.field_mappings?.length ? "Override" : "Defaults"}
                      </span>
                    </td>
                    <td className="px-2 py-1.5 text-[11px] text-gray-500">
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
        <div className="rounded-md border border-dashed border-gray-200 bg-white px-3 py-3 text-xs text-gray-500">
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
      <section className="rounded-lg border border-gray-200 bg-white px-4 py-3 shadow-sm">
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

      <section className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <h4 className="text-sm font-semibold text-gray-950">Deferred KPI Queue</h4>
          <span className="rounded-full border border-gray-200 bg-gray-50 px-2 py-1 text-[11px] font-semibold text-gray-600">{deferredCount} deferred</span>
        </div>
        <div className="grid gap-2 md:grid-cols-2">
          {kpis.filter((kpi) => !isKpiTracked(kpi)).slice(0, 6).map((kpi, index) => (
            <div key={kpi.kpi_id || index} className="rounded-md border border-gray-100 bg-gray-50 px-3 py-2">
              <p className="truncate text-xs font-semibold text-gray-900">{kpi.name}</p>
              <p className="mt-0.5 text-[11px] text-gray-400">{formatKpiValue(kpi)} · {titleCase(kpi.kpi_type)}</p>
            </div>
          ))}
          {!deferredCount && <p className="text-sm italic text-gray-400">Every accepted KPI is active in source setup.</p>}
        </div>
      </section>
    </div>
  );
}

function EvidenceStreamCard({ stream, actualCount }: { stream: any; actualCount: number }) {
  return (
    <article className="rounded-lg border border-gray-200 bg-white shadow-sm">
      <div className="border-b border-gray-100 p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wide text-gray-400">{stream.eyebrow}</p>
            <h4 className="mt-1 text-sm font-semibold text-gray-950">{stream.name}</h4>
            <p className="mt-1 text-xs leading-5 text-gray-500">{stream.description}</p>
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

      <div className="border-t border-gray-100 p-4">
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-gray-400">Required Headers</p>
            <div className="flex flex-wrap gap-1.5">
              {stream.required.map((field: string) => (
                <span key={field} className="rounded bg-emerald-50 px-2 py-1 text-[10px] font-semibold text-emerald-700">{field}</span>
              ))}
            </div>
          </div>
          <div>
            <p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-gray-400">Detected Fields</p>
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
          <div key={item} className="h-24 animate-pulse rounded-lg border border-gray-200 bg-white" />
        ))}
      </div>
    );
  }

  return (
    <section className="rounded-lg border border-gray-200 bg-white shadow-sm">
      <div className="border-b border-gray-200 px-4 py-3">
        <h3 className="text-base font-semibold text-gray-950">Compliance Flags</h3>
        <p className="mt-1 text-xs text-gray-500">Tracked KPI breach checks sorted by impact and severity.</p>
      </div>

      <div className="grid grid-cols-[minmax(260px,1fr)_140px_130px_120px_40px] border-b border-gray-200 bg-gray-50 px-4 py-2 text-[10px] font-bold uppercase tracking-wide text-gray-400 max-lg:hidden">
        <div>Flag / KPI</div>
        <div>Impact</div>
        <div>Status</div>
        <div>Severity</div>
        <div />
      </div>

      {!orderedBreaches.length ? (
        <div className="px-6 py-14 text-center">
          <AlertCircle className="mx-auto h-8 w-8 text-gray-300" />
          <p className="mt-3 text-sm font-medium text-gray-500">No compliance flags for tracked KPIs.</p>
          <p className="mt-1 text-xs text-gray-400">Track KPIs and upload actuals to populate this queue.</p>
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
                    <p className="mt-1 truncate pl-4 text-[11px] text-gray-400">
                      {breach.kpi_id} · SLA: {breach.remediation_sla || kpi?.remediation_sla || "Not specified"}
                    </p>
                  </button>
                  <div className={breach.is_breach ? "font-semibold text-red-600" : "font-semibold text-emerald-700"}>
                    {exposure ? `-${dashboardMoney(exposure)}` : "No penalty"}
                  </div>
                  <select className="h-8 rounded-md border border-gray-200 bg-white px-2 text-xs font-semibold text-gray-700" defaultValue={breach.status || (breach.is_breach ? "open" : "clear")}>
                    <option value="open">Open</option>
                    <option value="in_progress">In progress</option>
                    <option value="resolved">Resolved</option>
                    <option value="clear">Clear</option>
                  </select>
                  <span className={`w-fit rounded-full border px-2 py-1 text-[11px] font-semibold ${severityClass(severity)}`}>{severity}</span>
                  <button type="button" onClick={() => setExpandedFlagId(expanded ? null : breach.breach_id)} className="rounded p-1 hover:bg-gray-100">
                    <ChevronDown className={`h-4 w-4 text-gray-400 transition-transform ${expanded ? "rotate-180" : ""}`} />
                  </button>
                </div>

                {expanded && (
                  <div className="space-y-3 border-t border-gray-100 bg-gray-50 px-4 py-4">
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

      <section className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wide text-gray-400">Next Best Action</p>
            <h3 className="mt-1 text-base font-semibold text-gray-950">{nextActionKpi?.name || "No urgent KPI action"}</h3>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-gray-500">
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
            className={`rounded-md px-3 py-1.5 ${item.id === "logs" ? "bg-white text-gray-950 shadow-sm" : "text-gray-500 hover:text-gray-900"}`}
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
    <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] font-bold uppercase tracking-wide text-gray-400">{label}</p>
        <span className="rounded-md bg-gray-100 p-1.5 text-gray-500">{icon}</span>
      </div>
      <p className="mt-3 text-2xl font-semibold tracking-normal text-gray-950">{value}</p>
      <p className="mt-1 text-xs text-gray-500">{hint}</p>
    </div>
  );
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="min-h-[240px] rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
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
          <span className="text-[10px] text-gray-400">{index + 1}</span>
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
          <span className="text-[9px] text-gray-400">{index + 1}</span>
        </div>
      ))}
    </div>
  );
}

function SlaStatusList({ breaches, kpiById }: { breaches: ContractKPIBreach[]; kpiById: Map<string, ContractKPI> }) {
  const rows = breaches.length ? breaches : [];
  if (!rows.length) return <p className="text-sm italic text-gray-400">No open SLA remediation items.</p>;
  return (
    <div className="space-y-2">
      {rows.slice(0, 5).map((breach) => {
        const kpi = kpiById.get(breach.kpi_id);
        return (
          <div key={breach.breach_id} className="rounded-md border border-gray-100 bg-gray-50 px-3 py-2">
            <div className="flex items-center justify-between gap-3">
              <p className="truncate text-xs font-semibold text-gray-900">{kpi?.name || breach.kpi_id}</p>
              <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${severityClass(breachSeverity(breach, kpi))}`}>{breachSeverity(breach, kpi)}</span>
            </div>
            <p className="mt-1 text-[11px] text-gray-400">SLA: {breach.remediation_sla || kpi?.remediation_sla || "Not specified"}</p>
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
    return <div className="h-24 animate-pulse rounded-lg border border-gray-200 bg-white" />;
  }

  return (
    <section className="rounded-lg border border-gray-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 px-4 py-3">
        <div>
          <h3 className="text-base font-semibold text-gray-950">Performance Logs</h3>
          <p className="mt-1 text-xs text-gray-500">Source fetch runs and field usage for compliance evaluation.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <span className="rounded-full border border-blue-100 bg-blue-50 px-2.5 py-1 text-[11px] font-semibold text-blue-700">{Math.max(runs.length, actuals.length ? 1 : 0)} fetch runs</span>
          <span className="rounded-full border border-emerald-100 bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700">{actuals.length.toLocaleString()} records fetched</span>
        </div>
      </div>

      {!actuals.length ? (
        <div className="px-6 py-12 text-center text-sm italic text-gray-400">No performance logs yet. Upload actuals to run fetch and threshold history.</div>
      ) : (
        <div className="divide-y divide-gray-100">
          {runs.map(([source, records]) => {
            const open = expandedRun === source;
            const first = records[0];
            const firstKpi = kpiById.get(first?.kpi_id);
            return (
              <div key={source}>
                <button type="button" onClick={() => setExpandedRun(open ? null : source)} className="grid w-full gap-3 px-4 py-3 text-left hover:bg-gray-50 md:grid-cols-[1fr_160px_130px_150px_40px] md:items-center">
                  <div>
                    <p className="text-sm font-semibold text-gray-950">{source}</p>
                    <p className="mt-0.5 text-[11px] text-gray-400">{first?.timestamp ? new Date(first.timestamp).toLocaleString() : "Latest upload"} · {firstKpi?.name || "Multiple KPIs"}</p>
                  </div>
                  <span className="text-xs font-semibold text-gray-600">Connector: CSV/API</span>
                  <span className="w-fit rounded-full border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-700">Completed</span>
                  <span className="text-xs text-gray-500">{records.length.toLocaleString()} records</span>
                  <ChevronDown className={`h-4 w-4 text-gray-400 transition-transform ${open ? "rotate-180" : ""}`} />
                </button>
                {open && (
                  <div className="overflow-x-auto border-t border-gray-100 bg-gray-50 p-4">
                    <div className="min-w-[820px] rounded-md border border-gray-200 bg-white">
                      <div className="grid grid-cols-[1.2fr_1fr_1fr_1.2fr] border-b border-gray-200 bg-gray-50 px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-gray-400">
                        <div>Fetched Data</div>
                        <div>Field Sample</div>
                        <div>Mapped Usage</div>
                        <div>Join / Watermark</div>
                      </div>
                      {records.slice(0, 8).map((actual) => {
                        const kpi = kpiById.get(actual.kpi_id);
                        return (
                          <div key={actual.actual_id || `${actual.kpi_id}-${actual.timestamp}`} className="grid grid-cols-[1.2fr_1fr_1fr_1.2fr] border-b border-gray-100 px-3 py-2 text-xs last:border-b-0">
                            <div className="truncate font-semibold text-gray-900">{kpi?.name || actual.kpi_id}</div>
                            <div className="font-mono text-gray-700">{actual.value ?? "N/A"} {actual.unit || kpi?.unit || ""}</div>
                            <div className="text-gray-600">Feeds threshold check {formatKpiValue(kpi || ({ name: actual.kpi_id, kpi_id: actual.kpi_id } as ContractKPI))}</div>
                            <div className="text-gray-500">{actual.timestamp ? new Date(actual.timestamp).toLocaleDateString() : "No timestamp"} · {actual.source || "manual"}</div>
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

function KpiRegisterPane({
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
      <div className="sticky top-0 z-10 border-b border-gray-200 bg-white px-4 py-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-gray-500" />
              <h2 className="text-sm font-semibold text-gray-950">Contract KPI Register</h2>
            </div>
            <p className="mt-1 max-w-2xl text-xs leading-5 text-gray-500">
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
            <Button type="button" size="sm" className="h-8 gap-1 bg-gray-950 text-xs text-white hover:bg-gray-800" onClick={onExtract} disabled={isExtracting}>
              {isExtracting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <BarChart3 className="h-3.5 w-3.5" />}
              Extract KPIs
            </Button>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          <Badge variant="outline" className="rounded-full border-gray-200 bg-gray-50 text-gray-700">
            {effectiveSummary.total || kpis.length} total
          </Badge>
          <Badge variant="outline" className="rounded-full border-emerald-200 bg-emerald-50 text-emerald-700">
            {trackedCount} tracked
          </Badge>
          {statusEntries.map(([status, count]) => (
            <Badge key={status} variant="outline" className={`rounded-full ${kpiStatusClass(status)}`}>
              {titleCase(status)} {count}
            </Badge>
          ))}
          {typeEntries.map(([type, count]) => (
            <Badge key={type} variant="outline" className="rounded-full border-gray-200 bg-white text-gray-600">
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
                  : "text-gray-500 hover:text-gray-900"
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
            <div key={item} className="h-28 rounded-lg border border-gray-200 bg-gray-50 animate-pulse" />
          ))}
        </div>
      ) : !sortedKpis.length ? (
        <div className="flex min-h-[360px] flex-col items-center justify-center px-6 text-center">
          <div className="mb-3 rounded-full bg-gray-100 p-3">
            <BarChart3 className="h-6 w-6 text-gray-500" />
          </div>
          <h3 className="text-base font-semibold text-gray-950">No KPI register yet</h3>
          <p className="mt-2 max-w-md text-sm leading-6 text-gray-500">
            Extract KPIs for this contract to review obligations, dates, values, penalties, contacts, and exact source citations.
          </p>
          <Button type="button" className="mt-4 gap-2 bg-gray-950 text-white hover:bg-gray-800" onClick={onExtract} disabled={isExtracting}>
            {isExtracting ? <Loader2 className="h-4 w-4 animate-spin" /> : <BarChart3 className="h-4 w-4" />}
            Extract KPIs
          </Button>
        </div>
      ) : (
        <div className="space-y-3 p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-gray-950">KPI Register</h3>
              <p className="mt-1 text-xs text-gray-500">Showing KPI tracking fields for threshold, penalty, party, remediation, source text, confidence, and email draft.</p>
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
              <section key={kpi.kpi_id || `${kpi.name}-${index}`} className="rounded-lg border border-gray-200 bg-white shadow-sm">
                {/* ── Compact header row ── */}
                <div className="flex items-start gap-3 px-3 py-2.5">
                  {/* Left: badges + name + inline key values */}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5 mb-1">
                      <span className="text-[10px] font-semibold text-gray-400">#{index + 1}</span>
                      <Badge variant="outline" className="rounded-full border-gray-200 bg-white text-[10px] text-gray-600 px-1.5 py-0">{titleCase(kpi.kpi_type)}</Badge>
                      <Badge variant="outline" className={`rounded-full text-[10px] px-1.5 py-0 ${kpiStatusClass(kpi.status)}`}>{titleCase(kpi.status || "draft")}</Badge>
                      {tracked && <Badge variant="outline" className="rounded-full border-emerald-200 bg-emerald-50 text-[10px] text-emerald-700 px-1.5 py-0">Tracked</Badge>}
                      {!tracked && recommended && <Badge variant="outline" className="rounded-full border-blue-200 bg-blue-50 text-[10px] text-blue-700 px-1.5 py-0">Recommended</Badge>}
                      {kpi.needs_review && <Badge variant="outline" className="rounded-full border-amber-200 bg-amber-50 text-[10px] text-amber-700 px-1.5 py-0">Review</Badge>}
                    </div>
                    <p className="text-sm font-semibold text-gray-900 leading-5">{kpi.name}</p>
                    {/* Inline summary chips */}
                    <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-gray-500">
                      {thresholdText !== "—" && <span><span className="font-medium text-gray-700">{thresholdText}</span></span>}
                      {kpi.consequence_value != null && <span>Penalty: <span className="font-medium text-gray-700">{kpi.consequence_value} {kpi.consequence_unit || ""}</span></span>}
                      {kpi.party && <span>Party: <span className="font-medium text-gray-700">{kpi.party}</span></span>}
                      {kpi.page_start != null && <span className="text-gray-400">p.{kpi.page_start}{kpi.page_end && kpi.page_end !== kpi.page_start ? `–${kpi.page_end}` : ""}</span>}
                      {kpi.structural_path && <span className="text-gray-400 truncate max-w-[180px]">{kpi.structural_path}</span>}
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
                          : "text-gray-500 hover:bg-gray-100 hover:text-gray-900"
                      }`}
                    >
                      {editingKpiId === kpi.kpi_id ? "Cancel" : "Edit"}
                      <ClipboardEdit className="ml-0.5 inline h-3 w-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setExpandedKpiId(isExpanded ? null : kpi.kpi_id)}
                      className="rounded px-2 py-1 text-[11px] font-medium text-gray-500 hover:bg-gray-100 hover:text-gray-900 transition-colors"
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
                    <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-[11px] text-gray-400 hover:text-gray-700"
                      onClick={() => onStatusChange(kpi, "ignored")}>
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                </div>

                {/* ── Expanded detail panel ── */}
                {isExpanded && editingKpiId === kpi.kpi_id && editForm ? (
                  <div className="border-t border-gray-100 bg-amber-50/20 px-3 py-3 space-y-3">
                    <div className="text-xs font-semibold text-amber-800 flex items-center gap-1.5">
                      <ClipboardEdit className="h-3.5 w-3.5" /> Editing KPI Details
                    </div>
                    {/* Row 1: KPI Basic Name & Type */}
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <div className="rounded border border-gray-200 bg-white px-2 py-1">
                        <label className="block text-[10px] font-semibold uppercase tracking-wide text-gray-400">KPI Name</label>
                        <input
                          type="text"
                          value={editForm.name || ""}
                          onChange={(e) => handleFieldChange("name", e.target.value)}
                          className="w-full border-none bg-transparent p-0 text-xs text-gray-900 focus:outline-none focus:ring-0 mt-0.5"
                        />
                      </div>
                      <div className="rounded border border-gray-200 bg-white px-2 py-1">
                        <label className="block text-[10px] font-semibold uppercase tracking-wide text-gray-400">KPI Type</label>
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
                      <div className="rounded border border-gray-200 bg-white px-2 py-1">
                        <label className="block text-[10px] font-semibold uppercase tracking-wide text-gray-400">Operator</label>
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
                      <div className="rounded border border-gray-200 bg-white px-2 py-1">
                        <label className="block text-[10px] font-semibold uppercase tracking-wide text-gray-400">Value Min</label>
                        <input
                          type="number"
                          step="any"
                          value={editForm.value_min ?? editForm.value ?? ""}
                          onChange={(e) => handleFieldChange("value_min", e.target.value)}
                          className="w-full border-none bg-transparent p-0 text-xs text-gray-900 focus:outline-none focus:ring-0 mt-0.5"
                        />
                      </div>
                      <div className="rounded border border-gray-200 bg-white px-2 py-1">
                        <label className="block text-[10px] font-semibold uppercase tracking-wide text-gray-400">Value Max</label>
                        <input
                          type="number"
                          step="any"
                          value={editForm.value_max ?? ""}
                          onChange={(e) => handleFieldChange("value_max", e.target.value)}
                          className="w-full border-none bg-transparent p-0 text-xs text-gray-900 focus:outline-none focus:ring-0 mt-0.5"
                        />
                      </div>
                      <div className="rounded border border-gray-200 bg-white px-2 py-1">
                        <label className="block text-[10px] font-semibold uppercase tracking-wide text-gray-400">Unit</label>
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
                      <div className="rounded border border-gray-200 bg-white px-2 py-1">
                        <label className="block text-[10px] font-semibold uppercase tracking-wide text-gray-400">Penalty Value</label>
                        <input
                          type="number"
                          step="any"
                          value={editForm.consequence_value ?? ""}
                          onChange={(e) => handleFieldChange("consequence_value", e.target.value)}
                          className="w-full border-none bg-transparent p-0 text-xs text-gray-900 focus:outline-none focus:ring-0 mt-0.5"
                        />
                      </div>
                      <div className="rounded border border-gray-200 bg-white px-2 py-1">
                        <label className="block text-[10px] font-semibold uppercase tracking-wide text-gray-400">Penalty Unit</label>
                        <input
                          type="text"
                          value={editForm.consequence_unit || ""}
                          onChange={(e) => handleFieldChange("consequence_unit", e.target.value)}
                          className="w-full border-none bg-transparent p-0 text-xs text-gray-900 focus:outline-none focus:ring-0 mt-0.5"
                        />
                      </div>
                      <div className="rounded border border-gray-200 bg-white px-2 py-1">
                        <label className="block text-[10px] font-semibold uppercase tracking-wide text-gray-400">Aggregation</label>
                        <input
                          type="text"
                          value={editForm.aggregation_type || ""}
                          onChange={(e) => handleFieldChange("aggregation_type", e.target.value)}
                          className="w-full border-none bg-transparent p-0 text-xs text-gray-900 focus:outline-none focus:ring-0 mt-0.5"
                          placeholder="e.g. monthly"
                        />
                      </div>
                      <div className="rounded border border-gray-200 bg-white px-2 py-1">
                        <label className="block text-[10px] font-semibold uppercase tracking-wide text-gray-400">Party</label>
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
                      <div className="rounded border border-gray-200 bg-white px-2 py-1">
                        <label className="block text-[10px] font-semibold uppercase tracking-wide text-gray-400">Trigger Condition</label>
                        <input
                          type="text"
                          value={editForm.trigger_condition || ""}
                          onChange={(e) => handleFieldChange("trigger_condition", e.target.value)}
                          className="w-full border-none bg-transparent p-0 text-xs text-gray-900 focus:outline-none focus:ring-0 mt-0.5"
                        />
                      </div>
                      <div className="rounded border border-gray-200 bg-white px-2 py-1">
                        <label className="block text-[10px] font-semibold uppercase tracking-wide text-gray-400">Contact Email</label>
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
                      <div className="rounded border border-gray-200 bg-white px-2 py-1 sm:col-span-1">
                        <label className="block text-[10px] font-semibold uppercase tracking-wide text-gray-400">Remediation SLA</label>
                        <input
                          type="text"
                          value={editForm.remediation_sla || ""}
                          onChange={(e) => handleFieldChange("remediation_sla", e.target.value)}
                          className="w-full border-none bg-transparent p-0 text-xs text-gray-900 focus:outline-none focus:ring-0 mt-0.5"
                          placeholder="e.g. 5 days"
                        />
                      </div>
                      <div className="rounded border border-gray-200 bg-white px-2 py-1 sm:col-span-2">
                        <label className="block text-[10px] font-semibold uppercase tracking-wide text-gray-400">Remediation Action</label>
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
                      <div className="rounded border border-gray-200 bg-white px-2 py-1">
                        <label className="block text-[10px] font-semibold uppercase tracking-wide text-gray-400">Description</label>
                        <textarea
                          rows={2}
                          value={editForm.description || ""}
                          onChange={(e) => handleFieldChange("description", e.target.value)}
                          className="w-full border-none bg-transparent p-0 text-xs text-gray-900 focus:outline-none focus:ring-0 mt-0.5 resize-y"
                        />
                      </div>
                      <div className="rounded border border-gray-200 bg-white px-2 py-1">
                        <label className="block text-[10px] font-semibold uppercase tracking-wide text-gray-400">Notes / Comments</label>
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
                        className="h-8 px-4 bg-gray-950 text-white hover:bg-gray-800 text-xs gap-1"
                      >
                        <Check className="h-3.5 w-3.5" /> Save Changes
                      </Button>
                    </div>
                  </div>
                ) : (
                  isExpanded && (
                    <div className="border-t border-gray-100 bg-gray-50 px-3 py-3 space-y-2">
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
                      <div className="rounded-md border border-gray-200 bg-white p-2">
                        <div className="mb-1 flex items-center justify-between">
                          <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Verbatim</span>
                          <Button type="button" variant="ghost" size="sm" className="h-6 gap-1 px-2 text-[10px] text-gray-500" onClick={() => onCitationClick(kpi)}>
                            <ExternalLink className="h-3 w-3" /> View in PDF
                          </Button>
                        </div>
                        {quote
                          ? <blockquote className="max-h-28 overflow-auto whitespace-pre-wrap text-xs italic leading-5 text-gray-700">{quote}</blockquote>
                          : <p className="text-xs text-gray-400">No quote captured.</p>
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
    <div className="min-w-0 rounded border border-gray-100 bg-white px-2 py-1.5">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">{label}</div>
      <div className="mt-0.5 break-words text-xs leading-4 text-gray-800">{value}</div>
    </div>
  );
}

function KpiFlagsPane({
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
          <div key={item} className="h-20 rounded-lg border border-gray-200 bg-gray-50 animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div className="p-4">
      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <div className="border-b border-gray-100 px-4 py-3">
          <h3 className="text-sm font-semibold text-gray-900">Compliance Flags</h3>
          <p className="mt-1 text-xs text-gray-500">Breach evaluation results from KPI actuals, sorted by flagged items first.</p>
        </div>
        {orderedBreaches.length === 0 ? (
          <div className="py-12 text-center text-sm italic text-gray-400">
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
                  <div className="grid gap-3 px-4 py-3 transition-colors hover:bg-gray-50 md:grid-cols-[16px_minmax(240px,1fr)_120px_120px_110px_96px_24px] md:items-center">
                    <span className={`h-2.5 w-2.5 rounded-full ${isFlagged ? "bg-red-500" : "bg-emerald-500"}`} />
                    <button type="button" onClick={() => setExpandedFlagId(isOpen ? null : breach.breach_id)} className="min-w-0 text-left">
                      <p className="truncate text-sm font-semibold text-gray-900">{kpi?.name || breach.source_kpi?.name || breach.kpi_id}</p>
                      <p className="mt-0.5 truncate text-[11px] text-gray-400">
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
                    <span className="w-fit rounded-full border border-gray-200 bg-gray-50 px-2 py-1 text-[11px] font-semibold text-gray-600">
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
                    <div className="space-y-3 border-t border-gray-100 bg-gray-50 px-4 py-4">
                      <div className="grid gap-3 md:grid-cols-2">
                        <KpiDetail label="Expected (Contract)" value={`${breach.operator || kpi?.operator || ""} ${breach.expected_value ?? kpi?.value_min ?? kpi?.value ?? "N/A"} ${kpi?.unit || breach.actual_unit || ""}`.trim()} />
                        <KpiDetail label="Actual (Ingested)" value={`${breach.actual_value ?? "N/A"} ${breach.actual_unit || kpi?.unit || ""}`.trim()} />
                      </div>
                      <KpiDetail label="Contract Clause" value={kpi?.structural_path || kpi?.section || breach.source_kpi?.quote || "—"} />
                      <KpiDetail label="Recommended Action" value={breach.remediation || kpi?.remediation || "Standard monitoring — no escalation required."} />
                      {breach.breach_email_draft && (
                        <div className="rounded-md border border-gray-200 bg-white p-3">
                          <div className="mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wide text-gray-400">
                            <Send className="h-3 w-3" />
                            Remediation Email Draft
                          </div>
                          <pre className="max-h-64 overflow-auto whitespace-pre-wrap text-xs leading-5 text-gray-700">{breach.breach_email_draft}</pre>
                        </div>
                      )}
                      <div className="text-xs text-gray-400">
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

function KpiPerformanceLogsPane({
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
          <div key={item} className="h-20 rounded-lg border border-gray-200 bg-gray-50 animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div className="p-4">
      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 px-4 py-3">
          <div>
            <h3 className="text-sm font-semibold text-gray-900">Performance Logs</h3>
            <p className="mt-1 text-xs text-gray-500">Actual values staged for KPI compliance evaluation.</p>
          </div>
          <span className="rounded-full border border-emerald-100 bg-emerald-50 px-2.5 py-1 text-[11px] text-emerald-700">
            {actuals.length.toLocaleString()} records fetched
          </span>
        </div>
        {actuals.length === 0 ? (
          <div className="px-6 py-12 text-center text-sm text-gray-400">
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
                    className="grid w-full gap-3 px-4 py-3 text-left transition-colors hover:bg-gray-50 md:grid-cols-[minmax(160px,0.8fr)_minmax(240px,1.2fr)_minmax(180px,0.8fr)_120px_24px] md:items-center"
                  >
                    <div>
                      <p className="text-xs font-bold text-gray-800">{actual.source || "manual"}</p>
                      <p className="mt-0.5 text-[10px] text-gray-400">{timestamp ? new Date(timestamp).toLocaleString() : "No timestamp"}</p>
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-xs font-semibold text-gray-900">{kpi?.name || actual.kpi_id}</p>
                      <p className="mt-0.5 truncate text-[11px] text-gray-400">{actual.kpi_id}</p>
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
                    <div className="space-y-3 border-t border-gray-100 bg-gray-50 px-4 py-4">
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

function AgentDocumentPreviewPane({
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
      <div className="flex h-full items-center justify-center p-8 text-center text-sm text-gray-500">
        Select a generated DOCX from the explorer.
      </div>
    );
  }

  return (
    <div className="flex min-h-full flex-col">
      <div className="flex min-h-12 items-center justify-between gap-3 border-b border-gray-200 bg-white px-4 py-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-gray-900">{preview?.filename || effectiveDocument.filename}</div>
          <div className="text-xs text-gray-500">
            {isRedline ? "Redline DOCX copy" : "Editable DOCX copy"} · Version {preview?.version_number || effectiveDocument.current_version_number || 1}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {versions.length > 1 && (
            <select
              value={selectedVersionId}
              onChange={(event) => onVersionChange(event.target.value)}
              className="h-8 rounded-md border border-gray-200 bg-white px-2 text-xs text-gray-700 outline-none focus:border-gray-400"
              aria-label="Select document version"
            >
              {versions.map((version) => (
                <option key={version.version_id} value={version.version_id}>
                  Version {version.version_number}
                </option>
              ))}
            </select>
          )}
          <div className="flex h-8 rounded-md border border-gray-200 bg-gray-50 p-0.5">
            <button
              type="button"
              onClick={() => setMode("preview")}
              className={`rounded px-2 text-xs font-medium ${mode === "preview" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-900"}`}
            >
              Preview
            </button>
            <button
              type="button"
              onClick={() => setMode("edit")}
              className={`rounded px-2 text-xs font-medium ${mode === "edit" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-900"}`}
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
        <div className="flex h-full min-h-[360px] items-center justify-center text-sm text-gray-500">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Loading DOCX preview...
        </div>
      ) : (
        <div className="flex-1 overflow-auto bg-gray-100 px-4 py-6">
          <div
            className="mx-auto min-h-[900px] max-w-[816px] bg-white px-16 py-14 text-[15px] leading-7 text-gray-950 shadow-sm ring-1 ring-gray-200"
            style={{ fontFamily: '"Times New Roman", Times, serif' }}
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
                  <div key={change.finding_id || index} className="rounded-md border border-gray-200 bg-white p-2 text-xs leading-5">
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
                    <div key={edit.edit_id} className="rounded-md border border-gray-200 bg-white p-2 text-xs leading-5">
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
                <div className="font-sans text-xs text-gray-400">
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
                      <div key={pageIdx} className="break-inside-avoid rounded-sm bg-white px-16 py-14 shadow-sm ring-1 ring-gray-200" style={{ fontFamily: '"Times New Roman", Times, serif', minHeight: "900px" }}>
                        {pageBlocks.map((block, index) => {
                          const trimmed = block.trim();
                          if (!trimmed) return null;
                          if (/^(Amendment \/ Applied Change|Converted Source Contract Text)$/i.test(trimmed)) {
                            return <h2 key={index} className="pt-3 text-base font-bold">{trimmed}</h2>;
                          }
                          if (/^Source page \d+/i.test(trimmed)) {
                            return <p key={index} className="text-right text-xs italic text-gray-500">{trimmed}</p>;
                          }
                          const pageMarker = trimmed.match(/^\[\[DOCX_PAGE:(\d+)\]\]$/);
                          if (pageMarker) {
                            return <p key={index} className="text-right text-xs italic text-gray-500">Source page {pageMarker[1]}</p>;
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
                        <div key={`${index}-${trimmed}`} className="my-8 border-t border-dashed border-gray-300 pt-2 text-right text-xs italic text-gray-400">
                          Page break
                        </div>
                      );
                    }
                    if (/^(Amendment \/ Applied Change|Converted Source Contract Text)$/i.test(trimmed)) {
                      return <h2 key={`${index}-${trimmed}`} className="pt-3 text-base font-bold">{trimmed}</h2>;
                    }
                    if (/^Source page \d+/i.test(trimmed)) {
                      return <p key={`${index}-${trimmed}`} className="text-right text-xs italic text-gray-500">{trimmed}</p>;
                    }
                    const pageMarker = trimmed.match(/^\[\[DOCX_PAGE:(\d+)\]\]$/);
                    if (pageMarker) {
                      return <p key={`${index}-${trimmed}`} className="text-right text-xs italic text-gray-500">Source page {pageMarker[1]}</p>;
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
              <p className="text-sm text-gray-500">No preview text is available for this DOCX.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ContractProjectExplorer({
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
      <aside className="hidden w-[48px] shrink-0 flex-col items-center border-r border-gray-200 bg-white py-2 md:flex">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-gray-500 hover:text-gray-950"
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
                  isCurrent ? "bg-blue-50 text-blue-600" : "text-gray-400 hover:bg-gray-50 hover:text-gray-600"
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
    <aside className="hidden w-[260px] shrink-0 flex-col border-r border-gray-200 bg-white md:flex xl:w-[300px]">
      <div className="flex h-12 items-center justify-between border-b border-gray-200 px-4">
        <div className="text-sm font-medium text-gray-800">Explorer</div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-gray-500 hover:text-gray-950"
            onClick={onToggleExplorer}
            title="Collapse explorer"
          >
            <PanelLeftClose className="h-4 w-4" />
          </Button>
          <Button
            asChild
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-gray-500 hover:text-gray-950"
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
          <FolderOpen className="h-4 w-4 shrink-0 text-gray-400" />
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
                    isCurrent ? "bg-gray-100 text-gray-950" : "text-gray-600 hover:bg-gray-50 hover:text-gray-950"
                  }`}
                >
                  <FileText className={`h-4 w-4 shrink-0 ${isCurrent ? "text-blue-600" : "text-rose-500"}`} />
                  <span className="truncate">{truncateMiddle(document.contract_name, 34)}</span>
                </Link>
              );
            })}
          </div>
        )}

        <div className="mt-5 border-t border-gray-100 pt-4">
          <div className="mb-2 flex items-center justify-between gap-2 px-1">
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-400">Agent documents</div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 gap-1 px-2 text-xs text-gray-600 hover:text-gray-950"
              onClick={onCreateEditableCopy}
              disabled={isCreatingEditableCopy}
            >
              {isCreatingEditableCopy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ClipboardEdit className="h-3.5 w-3.5" />}
              Copy
            </Button>
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
                      isSelected ? "bg-blue-50 text-blue-900 ring-1 ring-blue-100" : "text-gray-600 hover:bg-gray-50 hover:text-gray-950"
                    }`}
                  >
                    <FileText className={`h-4 w-4 shrink-0 ${isSelected ? "text-blue-600" : "text-blue-500"}`} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{truncateMiddle(document.filename, 32)}</span>
                      <span className="block truncate text-[11px] text-gray-400">
                        DOCX · Version {document.current_version_number || document.versions?.[0]?.version_number || 1}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="rounded-lg px-1 py-2 text-xs leading-5 text-gray-400">
              No generated DOCX yet.
            </div>
          )}
        </div>

        {false && (
        <div className="mt-5 border-t border-gray-100 pt-4">
          <div className="mb-2 flex items-center justify-between gap-2 px-1">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-gray-400">KPI Actual Sources</div>
              <div className="mt-0.5 text-[11px] text-gray-400">{trackedCount} tracked KPI{trackedCount === 1 ? "" : "s"} · uploads/manual only</div>
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
                        selected ? "border-blue-200 bg-blue-50" : "border-gray-200 bg-gray-50 hover:border-gray-300"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="min-w-0">
                          <span className="block truncate text-xs font-semibold text-gray-900">{config.display_name}</span>
                          <span className="mt-0.5 block truncate text-[11px] text-gray-500">
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
              <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50 px-3 py-3 text-xs leading-5 text-gray-500">
                No actual source configured yet. Add CSV, Excel, JSON, XML, or manual evidence below, then map fields and validate a sample fetch.
              </div>
            )}

            {selectedSourceConfig && (
              <div className="rounded-lg border border-gray-200 bg-white p-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-xs font-semibold text-gray-950">{selectedSourceConfig.display_name}</p>
                    <p className="mt-0.5 truncate text-[11px] text-gray-400">
                      Last success: {selectedSourceConfig.last_success_at || "not yet"}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-[11px] text-gray-500"
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
                        sourceSetupTab === tab.id ? "bg-white text-gray-950 shadow-sm" : "text-gray-500 hover:text-gray-800"
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>

                {sourceSetupTab === "connection" && (
                  <div className="mt-2 space-y-2">
                    <div className="rounded-md border border-gray-100 bg-gray-50 px-2 py-2">
                      <p className="text-[10px] font-bold uppercase tracking-wide text-gray-400">User-facing source</p>
                      <p className="mt-1 text-[11px] leading-4 text-gray-500">
                        Contract users can upload or paste actuals here. SAP, Oracle, REST, S3, and warehouse connectors are configured by ContractSense in Integrations.
                      </p>
                    </div>
                    <label className="block text-[10px] font-bold uppercase tracking-wide text-gray-400">
                      Display name
                      <input
                        key={`${selectedSourceConfig.source_config_id}-name`}
                        defaultValue={selectedSourceConfig.display_name}
                        onBlur={(event) => updateSelectedSource({ display_name: event.target.value })}
                        className="mt-1 h-8 w-full rounded-md border border-gray-200 px-2 text-xs font-medium text-gray-800"
                      />
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      <label className="block text-[10px] font-bold uppercase tracking-wide text-gray-400">
                        Source type
                        <select
                          value={selectedSourceConfig.source_type}
                          onChange={(event) => updateSelectedSource({ source_type: event.target.value, file_format: event.target.value === "manual_attestation" ? "json" : event.target.value })}
                          className="mt-1 h-8 w-full rounded-md border border-gray-200 bg-white px-2 text-xs text-gray-700"
                        >
                          <option value="csv">CSV</option>
                          <option value="xlsx">Excel</option>
                          <option value="json">JSON</option>
                          <option value="xml">XML</option>
                          <option value="manual_attestation">Manual</option>
                        </select>
                      </label>
                      <label className="block text-[10px] font-bold uppercase tracking-wide text-gray-400">
                        Record path
                        <input
                          key={`${selectedSourceConfig.source_config_id}-record`}
                          defaultValue={selectedSourceConfig.record_path || ""}
                          onBlur={(event) => updateSelectedSource({ record_path: event.target.value })}
                          placeholder="records or data.rows"
                          className="mt-1 h-8 w-full rounded-md border border-gray-200 px-2 text-xs text-gray-700"
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
                      <label key={kpiField} className="grid grid-cols-[92px_1fr] items-center gap-2 text-[10px] font-semibold text-gray-500">
                        <span>{kpiField}</span>
                        <input
                          key={`${selectedSourceConfig.source_config_id}-${kpiField}`}
                          defaultValue={mappingSourceField(kpiField)}
                          onBlur={(event) => updateSelectedMapping(kpiField, event.target.value || placeholder, transform)}
                          placeholder={placeholder}
                          className="h-8 rounded-md border border-gray-200 px-2 text-xs text-gray-700"
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
                        className="h-8 rounded-md border border-gray-200 px-2 text-xs"
                      />
                      <input
                        key={`${selectedSourceConfig.source_config_id}-watermark`}
                        defaultValue={selectedSourceConfig.watermark_field || "timestamp"}
                        onBlur={(event) => updateSelectedSource({ watermark_field: event.target.value })}
                        placeholder="watermark field"
                        className="h-8 rounded-md border border-gray-200 px-2 text-xs"
                      />
                    </div>
                    <div className="rounded-md border border-gray-100 bg-gray-50 p-2">
                      <p className="text-[10px] font-bold uppercase tracking-wide text-gray-400">Required checks</p>
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
                    <div className="rounded-md border border-gray-100 bg-gray-50 px-2 py-2">
                      <p className="text-[10px] font-bold uppercase tracking-wide text-gray-400">Manual upload run</p>
                      <p className="mt-1 text-[11px] leading-4 text-gray-500">
                        Validate the mapped upload sample, then ingest actuals on demand. Automated polling stays platform-managed in Integrations.
                      </p>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <Button type="button" variant="outline" size="sm" className="h-8 gap-1 text-[11px]" onClick={() => onTestSourceConfig(selectedSourceConfig)} disabled={isSourceLoading}>
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        Test Fetch
                      </Button>
                      <Button type="button" size="sm" className="h-8 gap-1 bg-gray-950 text-[11px] text-white hover:bg-gray-800" onClick={() => onFetchSourceConfig(selectedSourceConfig)} disabled={isSourceLoading}>
                        {isSourceLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                        Fetch Now
                      </Button>
                    </div>
                    <div className="grid grid-cols-2 gap-1 text-[10px] text-gray-500">
                      <span className="rounded bg-gray-50 px-1.5 py-1">Mode: Manual</span>
                      <span className="rounded bg-gray-50 px-1.5 py-1">Watermark: {selectedSourceConfig.watermark_value || "none"}</span>
                    </div>
                    <div className="max-h-36 space-y-1 overflow-y-auto">
                      {selectedRuns.length ? selectedRuns.slice(0, 5).map((run) => (
                        <div key={run.run_id} className="rounded-md border border-gray-100 bg-gray-50 px-2 py-1.5">
                          <div className="flex items-center justify-between gap-2 text-[11px]">
                            <span className="truncate font-semibold text-gray-700">{titleCase(run.status || "run")}</span>
                            <span className="text-gray-400">{run.records_accepted || 0}/{run.records_fetched || 0}</span>
                          </div>
                          <p className="mt-0.5 truncate text-[10px] text-gray-400">{run.trigger_type || "manual"} · {run.finished_at || run.started_at || "running"}</p>
                        </div>
                      )) : (
                        <div className="rounded-md border border-dashed border-gray-200 px-2 py-2 text-[11px] text-gray-400">No fetch runs yet.</div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="mt-3 rounded-lg border border-gray-200 bg-white p-2">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="text-[11px] font-semibold text-gray-700">Actual Source Library</div>
              <select
                value={sourceFamilyFilter}
                onChange={(event) => setSourceFamilyFilter(event.target.value)}
                className="h-7 rounded-md border border-gray-200 bg-white px-2 text-[11px] text-gray-600"
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
                  className="flex w-full items-center justify-between gap-2 rounded-md border border-gray-100 bg-gray-50 px-2 py-2 text-left transition-colors hover:border-blue-200 hover:bg-blue-50 disabled:opacity-60"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-xs font-semibold text-gray-900">{source.label}</span>
                    <span className="block truncate text-[10px] text-gray-400">
                      {titleCase(source.family || "source")} · {(source.auth_types || []).slice(0, 2).join(", ") || "no auth"}
                    </span>
                  </span>
                  <Plus className="h-3.5 w-3.5 shrink-0 text-gray-400" />
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

function getStatusBadgeClass(status: string | undefined): string {
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
    default: return "bg-gray-100 text-gray-500 border border-gray-300";
  }
}

function getStatusIcon(status: string | undefined): React.ReactNode {
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
