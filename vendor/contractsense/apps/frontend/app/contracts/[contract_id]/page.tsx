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
  ClipboardEdit, ClipboardCheck, ClipboardX, Search, Upload, ChevronUp, ChevronDown, ChevronRight,
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
  XCircle,
} from "lucide-react";
import { useBreadcrumbs } from "@/app/context/BreadcrumbContext";

import { useAccountContext } from '@/app/context/AccountContext';

import "@/styles/pdf-viewer.css";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ContractPerformanceDashboardPane, KpiRegisterPane, KpiFlagsPane, KpiPerformanceLogsPane, ContractProjectExplorer, kpiBindingsForSource, getStatusBadgeClass, getStatusIcon, AgentDocumentPreviewPane } from "@/components/contracts/panes";

type QuestionAnswerConfidence = 'high' | 'medium' | 'low';
const PROJECT_SELECTION_KEY = "dashboardSelectedProject";
const USER_KPI_SOURCE_TYPES = new Set(["csv", "xlsx", "json", "xml", "scanned_images", "file_upload", "manual_attestation", "oracle_fusion", "sap_s4hana", "oracle_db", "sap_ariba"]);

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
  page_start?: number | null;
  page_end?: number | null;
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
  indexStatus?: string | null;
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
    <div className="flex h-96 w-full items-center justify-center rounded-lg bg-muted">
      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      <p className="ml-2 text-muted-foreground">Loading PDF Viewer...</p>
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
    case "ignored": return "border-border bg-muted/30 text-muted-foreground";
    case "needs_review": return "border-amber-200 bg-amber-50 text-amber-700";
    default: return "border-blue-100 bg-blue-50 text-blue-700";
  }
}

export default function ContractView() {
  const { setBreadcrumbs, setHeaderActions } = useBreadcrumbs();
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
    workspaceProject?._id || contract?.projectId || contract?.project_id || contract?.project?._id || null
  ), [contract, workspaceProject]);

  const contractProjectId = useMemo(() => (
    contract?.projectId ||
    contract?.project_id ||
    contract?.project?._id ||
    null
  ), [contract?.projectId, contract?.project_id, contract?.project?._id]);

  const workspaceProjectName = useMemo(() => (
    workspaceProject?.name || contract?.project_name || contract?.project?.name || "Contracts"
  ), [contract, workspaceProject]);

  useEffect(() => {
    if (contract) {
      setBreadcrumbs([
        { label: "Projects", href: "/dashboard" },
        { label: workspaceProjectName || "Project", href: workspaceProjectId ? `/dashboard/projects/${workspaceProjectId}` : "/dashboard" },
        { label: contract.contract_name || "Contract" }
      ]);
    } else {
      setBreadcrumbs([{ label: "Projects", href: "/dashboard" }]);
    }
  }, [contract, workspaceProjectId, workspaceProjectName, setBreadcrumbs]);

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
      status: document.indexStatus ?? undefined,
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
          file_format:
            source.source_type === "scanned_images"
              ? "csv"
              : source.source_type === "file_upload"
                ? "json"
                : source.source_type === "manual_attestation"
                  ? "json"
                  : source.source_type,
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
    const editableStatusesForEditor = ["Ingested", "Ready to Edit", "Editing", "Rejected"];
    const editableStatusesForPersonal = ["Ingested", "Ready to Edit", "Editing"];

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

    // "Ingested" is where a contract sits once the worker finishes it, and
    // where the editor picks it up — the backend has always accepted a submit
    // from there, but this list did not, so the Submit button never appeared
    // on a freshly ingested contract. "Ready to Edit" is legacy: nothing has
    // ever written it.
    const allowedStatuses = ["Ingested", "Ready to Edit", "Editing", "Rejected"];
    if (!allowedStatuses.includes(contractStatus || '')) return false;
    if (!assignedApproverId) return false;

    return isAssignedEditor;
  }, [contract, currentUserId, isPersonalDoc, contractStatus, isAssignedEditor, assignedApproverId]);

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
    const allowedStatuses = ["Ready to Edit", "Editing"];
    return isContractOwner && allowedStatuses.includes(contractStatus || '');
  }, [currentUserId, contractStatus, isContractOwner, contract]);

  const canRequestReEdit = useMemo(() => {
    // "Completed" is legacy — documents from older releases still carry it.
    if (!contract || !currentUserId || !["Approved", "Completed"].includes(contract.status || "")) return false;
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
      if (contractStatus === "Approved" || contractStatus === "Completed") return "Completed";
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

  // Citations need indexed text; nothing else about the contract makes them
  // available.
  const isUnprocessed = useMemo(
    () => !hasIndexedContent || contract?.status === "Uploaded",
    [contract?.status, hasIndexedContent]);

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
          page_start: segment.page_start ?? segment.page_number ?? segment.page ?? undefined,
          page_end: segment.page_end ?? undefined,
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

  useEffect(() => {
    if (!contractId) return;
    setHeaderActions(
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            const query = new URLSearchParams({ contract_id: contractId as string });
            if (workspaceProjectId) query.set("project_id", workspaceProjectId);
            router.push(`/playbooks?${query.toString()}`);
          }}
          className="hidden h-8 gap-1.5 rounded-lg text-xs lg:inline-flex"
        >
          <BookOpen className="h-3.5 w-3.5" />
          Run Playbook
        </Button>
        {contractStatus && (
          <span className={`hidden items-center rounded-full px-2.5 py-1 text-xs font-medium sm:inline-flex ${getStatusBadgeClass(contractStatus)}`} title={`Current Status: ${contractStatus}`}>
            {getStatusIcon(contractStatus)} {displayStatus}
          </span>
        )}
      </div>
    );
    return () => setHeaderActions(null);
  }, [setHeaderActions, contractId, workspaceProjectId, router, contractStatus, displayStatus]);

  const isLoading = loadingContract || loadingUser;

  if (!isClientLoaded) {
    return null;
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-card">
        <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
          <ContractLoadingScreen />
        </main>
      </div>
    );
  }

  if (error || !contract) {
    return (
      <div className="min-h-screen bg-card">
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

  const hasWorkflowActions = canDecideOnReEdit ||
    (contractStatus === 'Re-edit Denied' && isAssignedEditor) ||
    (!canDecideOnReEdit && contractStatus !== 'Re-edit Denied' && (canSubmit || canApprove || canReject || canMarkComplete || canRequestReEdit));

  return (
    <div className="h-[calc(100vh-4rem)] overflow-hidden bg-card font-InterVar text-foreground">
      <main className="h-full">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="flex h-full min-h-0 flex-col"
        >
          {error && (
            <div className="text-center text-red-600 bg-red-100 p-3 rounded-md border border-red-300 shadow-sm mx-auto max-w-2xl text-sm">
              <AlertCircle className="h-5 w-5 inline-block mr-2 text-red-500" />
              <span className="font-semibold">Error:</span> {error}
            </div>
          )}

          {contract && currentUserInfo && (
            <motion.div layout className="flex min-h-0 flex-1 flex-col bg-card">
              {/* Re-edit Request Notification Banner */}
              {canDecideOnReEdit && contract.reEditRequest && (
                <div className="border-b border-amber-200 bg-amber-50 px-4 py-3 md:px-10">
                  <h3 className="font-semibold text-amber-800">Review Re-edit Request</h3>
                  <p className="text-sm text-amber-700 mt-1">
                    The editor has requested to re-open this contract for editing for the following reason:
                  </p>
                  <blockquote className="mt-2 border-l-4 border-amber-300 pl-3 text-sm italic text-muted-foreground">
                    "{contract.reEditRequest.reason}"
                  </blockquote>
                </div>
              )}

              {hasWorkflowActions && (
                <div className="flex min-h-[52px] shrink-0 items-center justify-end gap-3 border-b border-border bg-muted/20 px-6 py-2.5 md:px-8">

                  <div className="ml-auto flex shrink-0 items-center gap-2">

                  {canDecideOnReEdit && (
                    <>
                      <Button size="sm" onClick={handleApproveReEdit} disabled={isApprovingReEdit} className="hidden bg-primary text-primary-foreground hover:bg-primary/90 lg:inline-flex">
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
                    <Button size="sm" onClick={handleAcknowledgeDenial} disabled={isAcknowledging} className="hidden bg-primary text-primary-foreground hover:bg-primary/90 lg:inline-flex">
                      {isAcknowledging && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                      Acknowledge
                    </Button>
                  )}

                  {!canDecideOnReEdit && contractStatus !== 'Re-edit Denied' && (
                    <>
                      {canSubmit && (
                        <Button size="sm" onClick={handleSubmitForApproval} disabled={isSubmittingApproval || !canSubmit} className="hidden bg-primary text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60 lg:inline-flex">
                          {isSubmittingApproval && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                          <Send className="mr-1 h-4 w-4" /> Submit
                        </Button>
                      )}

                      {canApprove && (
                        <Button size="sm" onClick={handleApprove} disabled={isApproving} className="hidden bg-primary text-primary-foreground hover:bg-primary/90 lg:inline-flex">
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
                        <Button size="sm" onClick={handleMarkComplete} disabled={isCompleting} className="hidden bg-primary text-primary-foreground hover:bg-primary/90 lg:inline-flex">
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

                  </div>
                </div>
              )}

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
                  <ResizablePanel defaultSize={isKpiWorkspace ? 54 : 66} minSize={42} className="flex h-full flex-col overflow-hidden border-r border-border bg-muted/30">
                    <Tabs
                      value={documentTabsValue}
                      onValueChange={setActiveTab}
                      className="flex-1 flex flex-col h-full"
                    >
                      <div className="flex min-h-12 flex-col gap-2 border-b border-border bg-card px-4 py-2 sm:h-12 sm:flex-row sm:items-center sm:justify-between sm:py-0">
                        <div>
                          <div className="text-sm font-medium text-foreground/90">Document Viewer</div>
                        </div>
                        <TabsList className="grid h-9 w-full grid-cols-3 rounded-md bg-muted p-1 sm:w-auto">
                          <TabsTrigger value="default" className="rounded px-2 text-xs data-[state=active]:bg-card data-[state=active]:text-foreground">
                            <FileText className="h-4 w-4 mr-1 sm:mr-2" />PDF View
                          </TabsTrigger>
                          <TabsTrigger value="docx" disabled={!selectedAgentDocument} className="rounded px-2 text-xs data-[state=active]:bg-card data-[state=active]:text-foreground">
                            DOCX
                          </TabsTrigger>
                          <button
                            type="button"
                            title="Open KPI management"
                            onClick={() => router.push(`/contracts/${contract._id}/kpis`)}
                            className="inline-flex items-center justify-center whitespace-nowrap rounded px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
                          >
                            <BarChart3 className="mr-1 h-4 w-4 sm:mr-2" />KPIs
                          </button>
                        </TabsList>
                      </div>

                      <TabsContent value="default" className=" overflow-auto bg-muted/30 rounded-b-lg h-full">
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

                      <TabsContent value="docx" className="h-full overflow-auto rounded-b-lg bg-muted">
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

                  <ResizableHandle withHandle className="bg-muted" />

                  {/* Right Compartment: KPI tracking console in KPI mode, assistant otherwise */}
                  <ResizablePanel defaultSize={isKpiWorkspace ? 46 : 34} minSize={isKpiWorkspace ? 36 : 26} className="flex h-full flex-col overflow-hidden bg-card">
                    {isKpiWorkspace ? (
                      <div className="flex h-full min-h-0 flex-col">
                        <div className="flex h-12 shrink-0 items-center justify-between border-b border-border bg-card px-3">
                          <div>
                            <p className="text-sm font-semibold text-foreground">Tracking Console</p>
                            <p className="text-[11px] text-muted-foreground">Review, sources, flags, logs</p>
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
                      className="absolute inset-y-0 right-0 flex w-full max-w-[460px] flex-col bg-card shadow-2xl"
                      onClick={(event) => event.stopPropagation()}
                    >
                      <div className="flex h-12 shrink-0 items-center justify-between border-b border-border px-3">
                        <div>
                          <p className="text-sm font-semibold text-foreground">Contract Assistant</p>
                          <p className="text-[11px] text-muted-foreground">Collapsed while tracking console is active</p>
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
