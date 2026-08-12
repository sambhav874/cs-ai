"use client";

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useParams, useRouter } from "next/navigation";

const PDFViewerDynamic = dynamic(
  () => import("@/components/PDFViewer/Sample"),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full w-full items-center justify-center bg-slate-950 text-slate-300 font-mono text-xs p-12">
        <Loader2 className="h-6 w-6 animate-spin mr-2 text-amber-400" />
        <span>Loading Official Contract PDF Document...</span>
      </div>
    ),
  },
);
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  Bell,
  Database,
  Lightbulb,
  BarChart3,
  BookOpen,
  Building2,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  Download,
  ExternalLink,
  FileText,
  Globe,
  Handshake,
  Info,
  Loader2,
  Mail,
  MoreHorizontal,
  Network,
  Play,
  Plus,
  RefreshCw,
  Send,
  MessageSquare,
  Image as ImageIcon,
  Settings2,
  ShieldCheck,
  Truck,
  Upload,
  UploadCloud,
  Maximize2,
  Filter,
  Search,
  Layers,
  Sparkles,
  Zap,
  X,
  ShieldAlert,
} from "lucide-react";
import { VarianceComparison } from "@/components/contracts/VarianceComparison";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { useBreadcrumbs } from "@/app/context/BreadcrumbContext";
import KpiSourceFieldMapper from "@/components/kpis/KpiSourceFieldMapper";
import { apiUploadWithProgress } from "@/lib/apiClient";
import {
  detectKpiSourceFields,
  getDefaultKpiSourceMappings,
} from "@/lib/kpi-source-fields";
import type { KpiSourceFieldMapping } from "@/lib/kpi-source-fields";
import { motion } from "framer-motion";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuCheckboxItem,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

const USER_KPI_SOURCE_TYPES = new Set([
  "csv",
  "xlsx",
  "json",
  "xml",
  "scanned_images",
  "file_upload",
  "rest_api",
  "manual_attestation",
  "oracle_fusion",
  "sap_s4hana",
  "oracle_db",
  "sap_ariba",
]);

const SOURCE_CONFIG_DEFAULTS: Record<
  string,
  { endpoint?: string; auth_type?: string; method?: string; note?: string }
> = {
  rest_api: {
    method: "GET",
    auth_type: "bearer",
    note: "Enter the REST endpoint URL that returns JSON performance data.",
  },
  oracle_fusion: {
    endpoint:
      "https://your-tenant.fa.oraclecloud.com/fscmRestApi/resources/11.13.18.05",
    auth_type: "basic",
    method: "GET",
    note: "Oracle Fusion Cloud REST API. Use Basic auth (username/password) or OAuth2.",
  },
  sap_s4hana: {
    endpoint: "https://your-tenant.s4hana.cloud.sap/sap/opu/odata/sap",
    auth_type: "basic",
    method: "GET",
    note: "SAP S/4HANA OData API endpoint. Use Basic auth or SAP destination.",
  },
  oracle_db: {
    auth_type: "password",
    note: "Oracle Database connection. Configure host, port, SID/service name, and credentials.",
  },
  sap_ariba: {
    endpoint: "https://openapi.ariba.com",
    auth_type: "oauth2",
    method: "GET",
    note: "SAP Ariba Open API. Requires OAuth2 client credentials and realm name.",
  },
};

const SOURCE_TYPE_DISPLAY: Record<
  string,
  { label: string; businessObject?: string }
> = {
  csv: { label: "CSV Upload" },
  xlsx: { label: "Excel Upload" },
  json: { label: "JSON Feed" },
  xml: { label: "XML Feed" },
  scanned_images: { label: "Scanned Images" },
  file_upload: { label: "File Upload" },
  rest_api: { label: "REST API" },
  manual_attestation: { label: "Manual Attestation" },
  oracle_fusion: { label: "Oracle Fusion", businessObject: "AP_INVOICES" },
  sap_s4hana: {
    label: "SAP S/4HANA",
    businessObject: "FI_DOCUMNT / MM_EKKO",
  },
  oracle_db: { label: "Oracle Database" },
  sap_ariba: {
    label: "SAP Ariba",
    businessObject: "Sourcing/Procurement",
  },
};

function sourceTypeLabel(sourceType: string): string {
  const entry = SOURCE_TYPE_DISPLAY[sourceType];
  if (!entry) return titleCase(sourceType);
  return entry.businessObject
    ? `${entry.label} · ${entry.businessObject}`
    : entry.label;
}

type PanelKey =
  | "intelligence"
  | "review"
  | "heatmap"
  | "sources"
  | "flags"
  | "logs"
  | "recoveries";

interface FullContractData {
  _id: string;
  contract_name: string;
  status?: string;
  projectId?: string | null;
  project_id?: string | null;
  project_name?: string | null;
  project?: { _id?: string; name?: string | null } | null;
}

interface ContractKPI {
  kpi_id: string;
  contract_id: string;
  document_id?: string | null;
  chunk_id?: string | null;
  contract_name?: string;
  name: string;
  description?: string;
  kpi_type?: string;
  category?: string | null;
  record_type?: string;
  record_role?:
  | "primary_kpi"
  | "supporting_metric"
  | "obligation"
  | "financial_term"
  | "reference_only"
  | "recovery"
  | string;
  party_role?: "supplier" | "client" | "mutual" | null;
  party?: string | null;
  responsible_party?: string | null;
  obligation?: Record<string, any> | null;
  obligation_action?: string | null;
  trigger?: string | null;
  scope?: string | null;
  acceptance_criteria?: string | null;
  dependencies?: any[];
  exceptions?: any[];
  trackability?: Record<string, any> | null;
  trackability_status?: string | null;
  tracking_readiness?: {
    ready?: boolean;
    checks?: Record<string, boolean>;
    reason?: string | null;
  } | null;
  operator?: string;
  value?: string | number | null;
  target_value?: string | number | null;
  target_type?: string | null;
  formula?: string | null;
  unit?: string | null;
  value_min?: number | null;
  value_max?: number | null;
  rule_type?: string | null;
  target_schedule?: Array<Record<string, any>>;
  rule?: {
    rule_type?: string;
    spec?: Record<string, any>;
  };
  recovery?: Record<string, any> | null;
  phase1?: { recovery?: Record<string, any> | null } | null;
  custom_attributes?: Record<string, any> | null;
  consequence_value?: number | null;
  consequence_unit?: string | null;
  aggregation_type?: string | null;
  trigger_condition?: string | null;
  period_type?: string | null;
  evaluation_window?: string | null;
  source_config_id?: string | null;
  source_config_status?: string | null;
  field_mappings?: Array<Record<string, any>>;
  evaluation_rule?: Record<string, any>;
  source_requirements?: Record<string, any>;
  remediation?: string | null;
  remediation_sla?: string | null;
  contact_email?: string | null;
  quote?: string;
  source_quote?: string;
  clause_text?: string;
  citation?: Record<string, any>;
  citation_details?: Record<string, any>;
  page_start?: number | null;
  page_end?: number | null;
  section?: string | null;
  section_path?: string | null;
  structural_path?: string | null;
  confidence?: number;
  confidence_reason?: string;
  notes?: string | null;
  needs_review?: boolean;
  status?: string;
  governance_status?: string | null;
  governance_version?: number | null;
  catalog_metric_key?: string | null;
  certified_at?: string | null;
  certified_by?: string | null;
  business_hours?: Record<string, any>;
  blackout_windows?: Array<Record<string, any>>;
  severity_grace_periods?: Record<string, any>;
  reporting_lock?: Record<string, any>;
  missing_data_policy?: string | null;
  error_budget?: Record<string, any>;
  is_recommended?: boolean;
  recommendation_reason?: string | null;
  tracking_status?: string | null;
  is_tracked?: boolean;
  last_tracking_backfill?: {
    created_breach_count?: number;
    skipped_count?: number;
    actual_count?: number;
  } | null;
}

interface ContractKPISummary {
  total?: number;
  by_type?: Record<string, number>;
  by_status?: Record<string, number>;
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
  duplicate_skipped?: boolean;
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
  severity?: string;
  remediation?: string | null;
  remediation_sla?: string | null;
  breach_email_draft?: string | null;
  breach_email_to?: string | null;
  breach_email_recipient_source?: {
    source?: string;
    confidence?: string;
    matched_party?: string;
  } | null;
  team_notified_at?: string | null;
  team_notified_by?: string | null;
  penalty_amount?: number | null;
  penalty_triggered?: string | null;
  variance?: number | null;
  variance_percent?: number | null;
  burn_rate?: number | null;
  period_locked?: boolean | null;
  blackout_applied?: boolean | null;
  deadline_at?: string | null;
  sample_count?: number | null;
  source?: string | null;
  timestamp?: string;
  period_end?: string | null;
  source_kpi?: {
    name?: string;
    quote?: string;
    contract_name?: string;
    category?: string;
    section?: string;
    party?: string;
    party_role?: string;
    beneficiary?: string;
  };
  created_at?: string;
  updated_at?: string;
}

interface KPIPortfolio {
  summary?: {
    contract_count?: number;
    contracts_with_kpis?: number;
    contracts_with_tracked_kpis?: number;
    kpi_count?: number;
    tracked_kpi_count?: number;
    open_breach_count?: number;
    source_count?: number;
    stale_source_count?: number;
    failed_source_count?: number;
    actual_count?: number;
    open_exposure?: number;
    coverage_percent?: number;
  };
  connector_health?: Record<string, number>;
  risky_contracts?: Array<Record<string, any>>;
  upcoming_reporting_windows?: Array<Record<string, any>>;
  top_breaches?: ContractKPIBreach[];
}

interface KPICatalogEntry {
  metric_key: string;
  display_name?: string;
  description?: string;
  certified_status?: string;
  contract_family?: string;
  unit?: string;
  owner?: string;
  owners?: string[];
  tags?: string[];
  kpi_count?: number;
  tracked_count?: number;
  certified_count?: number;
  version?: number;
  source_clause_lineage?: Array<Record<string, any>>;
}

interface KPIAlert {
  alert_id: string;
  alert_key?: string;
  event_type?: string;
  contract_id?: string;
  kpi_id?: string;
  breach_id?: string;
  source_config_id?: string;
  severity?: string;
  status?: string;
  title?: string;
  message?: string;
  channels?: string[];
  delivery?: Record<string, any>;
  last_seen_at?: string;
  created_at?: string;
}

interface KPISourceCatalogItem {
  source_type: string;
  label: string;
  family?: string;
  auth_types?: string[];
  cadences?: string[];
  enabled_for_contract_users?: boolean;
}

interface KPIIntegrationProfile {
  profile_id: string;
  source_type: string;
  display_name: string;
  status?: string;
  endpoint?: string | null;
  method?: string | null;
  auth_type?: string | null;
  record_path?: string | null;
  data_path?: string | null;
  dedupe_key?: string | null;
  watermark_field?: string | null;
  field_mappings?: Array<Record<string, any>>;
  sample_payload?: any;
  schedule?: { cadence?: string; timezone?: string };
}

interface KPISourceConfig {
  source_config_id: string;
  contract_id: string;
  project_id?: string | null;
  display_name: string;
  source_type: string;
  runtime_source_type?: string;
  connector_family?: string;
  status?: string;
  enabled?: boolean;
  auth_type?: string;
  credential_ref?: string | null;
  schedule?: { cadence?: string; timezone?: string; start_at?: string | null };
  next_run_at?: string | null;
  last_run_at?: string | null;
  last_success_at?: string | null;
  last_error?: string | null;
  endpoint?: string | null;
  signed_url?: string | null;
  method?: string | null;
  file_format?: string | null;
  schema_fields?: Array<Record<string, any>>;
  sample_payload?: any;
  record_path?: string | null;
  data_path?: string | null;
  field_mappings?: Array<Record<string, any>>;
  validation_rules?: Array<Record<string, any>>;
  dedupe_key?: string | null;
  watermark_field?: string | null;
  watermark_value?: string | null;
  kpi_ids?: string[];
  kpi_bindings?: KPISourceBinding[];
  last_fetch_status?: Record<string, any>;
  headers?: Record<string, string> | null;
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
  contract_id?: string;
  source_config_id: string;
  source_type?: string;
  status?: string;
  trigger_type?: string;
  started_at?: string;
  finished_at?: string;
  duration_ms?: number;
  records_fetched?: number;
  records_accepted?: number;
  records_skipped?: number;
  created_actual_count?: number;
  created_breach_count?: number;
  deferred_evaluation_count?: number;
  normalized_preview?: Array<Record<string, any>>;
  skipped_rows?: Array<Record<string, any>>;
  errors?: string[];
  watermark_before?: any;
  watermark_after?: any;
}

interface KPISourceRunDetail {
  fetch_run: KPISourceFetchRun;
  created_actuals: ContractKPIActual[];
  created_breaches: ContractKPIBreach[];
  raw_records?: Array<Record<string, any>>;
  normalized_rows?: Array<Record<string, any>>;
  skipped_rows?: Array<Record<string, any>>;
}

const titleCase = (value?: string | null) =>
  value
    ? value
      .replace(/[_-]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/\b\w/g, (letter) => letter.toUpperCase())
    : "Not specified";

function BreachStatusBadge({ status }: { status: string }) {
  const norm = String(status || "").toLowerCase();
  let icon = <AlertCircle className="w-3.5 h-3.5" />;
  let colorClass = "border-gray-400 bg-white text-gray-950";
  let label = titleCase(status);

  switch (norm) {
    case "open":
      icon = <AlertCircle className="w-3.5 h-3.5" />;
      colorClass = "border-red-200 bg-red-50 text-red-700";
      break;
    case "in_action":
      icon = <Clock className="w-3.5 h-3.5" />;
      colorClass = "border-blue-300 bg-blue-50 text-blue-800";
      label = "In Action";
      break;
    case "closed":
      icon = <CheckCircle2 className="w-3.5 h-3.5" />;
      colorClass = "border-gray-300 bg-gray-100 text-gray-700";
      break;
    case "escalated":
      icon = <Mail className="w-3.5 h-3.5" />;
      colorClass = "border-purple-200 bg-purple-50 text-purple-700";
      break;
    case "acknowledged":
      icon = <CheckCircle2 className="w-3.5 h-3.5" />;
      colorClass = "border-orange-200 bg-orange-50 text-orange-700";
      break;
    case "reminded":
      icon = <Bell className="w-3.5 h-3.5" />;
      colorClass = "border-yellow-200 bg-yellow-50 text-yellow-700";
      break;
    case "clear":
      icon = <CheckCircle2 className="w-3.5 h-3.5" />;
      colorClass = "border-emerald-200 bg-emerald-50 text-emerald-700";
      break;
    default:
      icon = <AlertCircle className="w-3.5 h-3.5" />;
      break;
  }

  return (
    <span className={`flex w-fit items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold shadow-sm ${colorClass}`}>
      {icon}
      {label}
    </span>
  );
}

const isKpiTracked = (kpi?: ContractKPI | null) => {
  const status = String(kpi?.tracking_status || "").toLowerCase();
  return Boolean(
    kpi?.is_tracked || status === "tracked" || status === "active",
  );
};

const isKpiRecommended = (kpi?: ContractKPI | null) => {
  const status = String(kpi?.tracking_status || "").toLowerCase();
  return Boolean(kpi?.is_recommended || status === "recommended");
};

const toNumber = (value?: string | number | null) => {
  if (value == null || value === "") return null;
  const parsed = Number(String(value).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
};

function extractCurrency(unit?: string | null): string {
  if (!unit) return "USD";
  const match = unit.match(/^([A-Z]{3})\b/);
  return match ? match[1] : "USD";
}

const financialImpactText = (amount: number | null, kpi?: ContractKPI) => {
  if (amount == null) return "not defined in the agreement";
  const consequenceUnit = String(
    (kpi as any)?.consequence_currency || kpi?.consequence_unit || "",
  );
  const currency = consequenceUnit.match(
    /\b(SEK|USD|EUR|GBP|NOK|DKK|CHF|CAD|AUD|JPY|CNY|INR)\b/i,
  )?.[1]?.toUpperCase();
  return `${currency ? `${currency} ` : ""}${amount.toLocaleString()}`;
};

const money = (value: number, currency?: string) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency || "USD",
    maximumFractionDigits: 0,
  }).format(Math.max(0, value));

// Most extracted obligations don't carry an explicit remediation clause, so
// breach.remediation / kpi.remediation are usually empty and every card fell
// back to one identical hardcoded sentence. This derives distinct guidance
// per breach from fields the obligation actually has (name, clause, party,
// whether it carries a financial penalty) instead of inventing new facts.
const defaultRemediationText = (kpi?: ContractKPI, breach?: ContractKPIBreach) => {
  const clause =
    kpi?.section || (kpi as any)?.section_path || (kpi as any)?.structural_path || "the applicable clause";
  const name = kpi?.name || breach?.source_kpi?.name || "this obligation";
  const party = kpi?.party || "the counterparty";
  const hasPenalty = Boolean(toNumber(breach?.penalty_amount) || toNumber(kpi?.consequence_value));
  return hasPenalty
    ? `Issue a recovery notice to ${party} for the "${name}" variance under ${clause} and apply the corrective billing adjustment.`
    : `Escalate "${name}" non-compliance to ${party} under ${clause} and request a corrective action plan.`;
};

const tierScheduleFor = (kpi: ContractKPI): Array<Record<string, any>> => {
  const lt =
    (kpi as any).measurement?.lookup_table ||
    (kpi as any).lookup_table ||
    (kpi as any).measurement?.price_structure;
  const ltRows = Array.isArray(lt)
    ? lt
    : lt && typeof lt === "object" && Array.isArray(lt.rows)
      ? lt.rows
      : [];

  const sources = [
    ltRows,
    kpi.target_schedule,
    kpi.rule?.spec?.tiers,
    kpi.recovery?.target_schedule,
    kpi.phase1?.recovery?.target_schedule,
    kpi.custom_attributes?.target_schedule,
  ];
  const merged: Array<Record<string, any>> = [];
  const seen = new Set<string>();
  for (const source of sources) {
    if (!Array.isArray(source)) continue;
    for (const tier of source) {
      if (!tier || typeof tier !== "object") continue;
      const key = JSON.stringify(tier);
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(tier);
    }
  }
  return merged;
};

const formatKpiValue = (kpi: ContractKPI) => {
  const tiers = tierScheduleFor(kpi);
  const ruleType = String(
    kpi.rule_type || kpi.rule?.rule_type || kpi.target_type || "",
  ).toLowerCase();
  if (
    ruleType === "tiered" ||
    ruleType === "lookup_table" ||
    tiers.length > 0
  ) {
    return `Tiered schedule · ${tiers.length} tier${tiers.length === 1 ? "" : "s"}`;
  }

  const val =
    kpi.value ?? kpi.target_value ?? (kpi as any).measurement?.threshold;
  const hasValue = val != null && val !== "";
  const hasMinMax = kpi.value_min != null || kpi.value_max != null;

  if (!hasValue && !hasMinMax) {
    const formulaStr =
      kpi.formula ||
      (kpi as any).measurement?.formula ||
      kpi.rule?.spec?.formula ||
      (kpi as any).measurement_scope ||
      (kpi as any).measurement?.measurement_scope;
    if (
      formulaStr ||
      ruleType === "reference_formula" ||
      kpi.target_type === "reference_formula"
    ) {
      return formulaStr || "Referenced in text";
    }
    return "Not specified";
  }

  const pieces: string[] = [];
  if (kpi.operator && kpi.operator !== "=" && kpi.operator !== "conforms_to") {
    pieces.push(kpi.operator);
  }

  if (hasMinMax) {
    pieces.push(
      `${kpi.value_min ?? "?"}${kpi.value_max != null ? ` - ${kpi.value_max}` : ""}`,
    );
  } else if (hasValue) {
    pieces.push(String(val));
  }

  if (kpi.unit && kpi.unit !== "native" && kpi.unit !== "None") {
    pieces.push(kpi.unit);
  }

  return pieces.length ? pieces.join(" ") : "Not specified";
};

const formatConsequence = (kpi: ContractKPI) => {
  const pieces: string[] = [];
  if (kpi.consequence_value != null) pieces.push(String(kpi.consequence_value));
  if (kpi.consequence_unit) pieces.push(kpi.consequence_unit);
  if (kpi.aggregation_type) pieces.push(`(${titleCase(kpi.aggregation_type)})`);
  return pieces.length ? pieces.join(" ") : "Not specified";
};

const severityFor = (breach: ContractKPIBreach, kpi?: ContractKPI) => {
  if (!breach.is_breach) return "OK";
  if (breach.severity) return titleCase(breach.severity);
  const exposure = Math.abs(toNumber(kpi?.consequence_value) || 0);
  if (exposure >= 50000) return "Critical";
  if (exposure >= 10000) return "High";
  if (exposure > 0) return "Medium";
  return "Low";
};

const statusTone = (value?: string | null) => {
  const status = String(value || "").toLowerCase();
  if (status === "in_action") {
    return "border-blue-300 bg-blue-50 text-blue-800";
  }
  if (
    [
      "approved",
      "tracked",
      "ready",
      "mapped",
      "enabled",
      "clear",
      "ok",
      "completed",
    ].includes(status)
  ) {
    return "border-gray-300 bg-white text-gray-800";
  }
  if (
    ["open", "failed", "last_fetch_failed", "critical", "high"].some((item) =>
      status.includes(item),
    )
  ) {
    return "border-gray-400 bg-white text-gray-950";
  }
  if (
    ["review", "recommended", "draft", "pending", "medium"].some((item) =>
      status.includes(item),
    )
  ) {
    return "border-gray-200 bg-gray-50 text-gray-700";
  }
  return "border-gray-200 bg-gray-50 text-gray-600";
};

const kpiCode = (kpi: ContractKPI, index: number) => {
  return String(index + 1);
};

const sourceBindingId = (
  sourceConfigId: string,
  kpiId: string,
  index: number,
) => {
  const seed = `${sourceConfigId}:${kpiId}:${index}`;
  let hash = 0;
  for (let offset = 0; offset < seed.length; offset += 1) {
    hash = ((hash << 5) - hash + seed.charCodeAt(offset)) | 0;
  }
  return `bind_${Math.abs(hash).toString(16)}`;
};

const AIRPORT_DEMO_SOURCE_KPI_CODES: Record<string, Set<string>> = {
  csv: new Set(["SGHA-13.1-TURNAROUND-DELAY", "SGHA-13.2-FAILURE-TO-PROVIDE", "SGHA-1.1-LANDING", "SGHA-1.3-PASSENGER", "SGHA-1.5-PARKING"]),
  json: new Set(["SGHA-13.3-BAGGAGE-CARGO-MISHANDLING", "SGHA-13.7-MONTHLY-ON-TIME-SLA", "SGHA-2.3-PASSENGER-SERVICES", "SGHA-2.3-RAMP-HANDLING"]),
  scanned_images: new Set(["SGHA-13.1-TURNAROUND-DELAY", "SGHA-13.2-FAILURE-TO-PROVIDE", "SGHA-1.1-LANDING", "SGHA-1.3-PASSENGER", "SGHA-1.5-PARKING"]),
  file_upload: new Set(["SGHA-13.3-BAGGAGE-CARGO-MISHANDLING", "SGHA-13.7-MONTHLY-ON-TIME-SLA", "SGHA-2.3-PASSENGER-SERVICES", "SGHA-2.3-RAMP-HANDLING"]),
  rest_api: new Set(["SGHA-13.4-DEICING-FAILURE", "SGHA-13.5-REFUELLING-DELAY", "SGHA-2.7-ELECTRICITY", "SGHA-2.8-DEICING", "SGHA-2.12-CANCELLATION"]),
  sap_s4hana: new Set(["SGHA-13.6-SAFETY-COMPLIANCE-BREACH", "SGHA-1.6-EXTRA-HOURS", "SGHA-2.16-RETURN-TO-RAMP"]),
};

const airportDemoSourceCodes = (
  config: Pick<KPISourceConfig, "source_type" | "display_name">,
) => {
  const name = String(config.display_name || "").toLowerCase();
  const legacyNamesByType: Record<string, Set<string>> = {
    scanned_images: new Set(["scanned images", "csv upload", "csv feed"]),
    file_upload: new Set(["file upload", "json upload", "json feed"]),
  };
  if (
    /airport|ground handling|ground operations/i.test(name) ||
    legacyNamesByType[config.source_type]?.has(name)
  ) {
    return AIRPORT_DEMO_SOURCE_KPI_CODES[config.source_type] || null;
  }
  return null;
};

const isAirportDemoSource = (config: KPISourceConfig) =>
  Boolean(airportDemoSourceCodes(config));

const normalizeFieldMappings = (
  fieldMappings?: Array<Record<string, any>>,
): KpiSourceFieldMapping[] =>
  (fieldMappings || [])
    .filter((mapping) => mapping && typeof mapping === "object")
    .map((mapping) => ({
      kpi_field: String(mapping.kpi_field || mapping.target || mapping.field || ""),
      source_field: String(mapping.source_field || mapping.source || ""),
      transform: mapping.transform || undefined,
    }))
    .filter((mapping) => mapping.kpi_field && mapping.source_field);

const updateFieldMapping = (
  fieldMappings: Array<Record<string, any>> | undefined,
  kpiField: string,
  sourceField: string,
  transform?: string,
): KpiSourceFieldMapping[] => {
  const mappings = normalizeFieldMappings(fieldMappings);
  const index = mappings.findIndex(
    (mapping) =>
      String(
        mapping.kpi_field ||
        mapping.target ||
        mapping.field ||
        "",
      ) === kpiField,
  );
  const normalizedSourceField = sourceField.trim();
  if (!normalizedSourceField) {
    if (index >= 0) mappings.splice(index, 1);
    return mappings;
  }
  const next = {
    kpi_field: kpiField,
    source_field: normalizedSourceField,
    transform,
  };
  if (index >= 0) mappings[index] = { ...mappings[index], ...next };
  else mappings.push(next);
  return mappings;
};

const bindingsForSource = (config: KPISourceConfig, kpis: ContractKPI[]) => {
  const allowedCodes = airportDemoSourceCodes(config);
  let scopedKpis = allowedCodes
    ? kpis.filter((kpi) => allowedCodes.has(kpi.kpi_id.split(":").pop() || kpi.kpi_id))
    : kpis;
  if (!scopedKpis || scopedKpis.length === 0) {
    scopedKpis = kpis;
  }
  const explicitBindings =
    Array.isArray(config.kpi_bindings) && config.kpi_bindings.length > 0;
  // If no explicitly enabled binding exists on the source config, infer default enabled bindings
  const inferDemoBindings = !(config.kpi_bindings || []).some((binding) => binding?.enabled !== false);
  const bindingByKpiId = new Map<string, KPISourceBinding>();
  (config.kpi_bindings || []).forEach((binding) => {
    if (binding?.kpi_id) bindingByKpiId.set(String(binding.kpi_id), binding);
  });
  const legacyKpiIds = new Set((config.kpi_ids || []).map(String));
  return scopedKpis.map((kpi, index) => {
    const existing = bindingByKpiId.get(kpi.kpi_id);
    return {
      binding_id:
        existing?.binding_id ||
        sourceBindingId(config.source_config_id, kpi.kpi_id, index + 1),
      kpi_id: kpi.kpi_id,
      enabled: existing
        ? inferDemoBindings || existing.enabled !== false
        : inferDemoBindings || (!explicitBindings && legacyKpiIds.has(kpi.kpi_id)) || true,
      match_rule:
        existing?.match_rule && Object.keys(existing.match_rule).length > 0
          ? existing.match_rule
          : {
            field: "kpi_code",
            operator: "equals",
            value: kpi.kpi_id.split(":").pop() || kpi.kpi_id,
          },
      field_mappings: normalizeFieldMappings(existing?.field_mappings),
      aggregation: existing?.aggregation || kpi.aggregation_type || "latest",
      unit_override: existing?.unit_override || null,
      dedupe_key_override: existing?.dedupe_key_override || null,
      watermark_field_override: existing?.watermark_field_override || null,
      validation_status: existing?.validation_status || null,
    } satisfies KPISourceBinding;
  });
};

const enabledKpiIdsForSource = (
  config: KPISourceConfig,
  kpis?: ContractKPI[],
) => {
  const bindings = kpis
    ? bindingsForSource(config, kpis)
    : config.kpi_bindings || [];
  const ids = bindings
    .filter((binding) => binding.enabled !== false)
    .map((binding) => String(binding.kpi_id));
  if (ids.length || (config.kpi_bindings || []).length)
    return Array.from(new Set(ids));
  return Array.from(
    new Set((config.kpi_ids || []).map(String).filter(Boolean)),
  );
};

const upsertSourceBinding = (
  config: KPISourceConfig,
  kpis: ContractKPI[],
  nextBinding: KPISourceBinding,
) =>
  bindingsForSource(config, kpis).map((binding) =>
    binding.kpi_id === nextBinding.kpi_id
      ? { ...binding, ...nextBinding }
      : binding,
  );



const quoteFor = (kpi: ContractKPI | any) =>
  kpi.identity?.source_clause?.quote ||
  kpi.source_evidence?.[0]?.quote ||
  kpi.phase1?.quote ||
  kpi.citation?.quote ||
  kpi.citation_details?.quote ||
  kpi.source_quote ||
  kpi.quote ||
  kpi.clause_text ||
  "";

const formatDateTime = (value?: string | null) => {
  if (!value) return "Not stamped";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
};

const actualLabel = (
  actual?: ContractKPIActual | null,
  kpi?: ContractKPI | null,
) => {
  if (!actual) return "No actual";
  return `${actual.value ?? "N/A"} ${actual.unit || kpi?.unit || ""}`.trim();
};

const actualTimestamp = (actual?: ContractKPIActual | null) =>
  actual?.timestamp || actual?.created_at || null;

const expectedFor = (breach: ContractKPIBreach, kpi?: ContractKPI | null) =>
  `${breach.operator || kpi?.operator || ""} ${breach.expected_value ?? kpi?.value_min ?? kpi?.value ?? "N/A"} ${kpi?.unit || breach.actual_unit || ""}`.trim();

const breachNarrative = (
  breach: ContractKPIBreach,
  kpi?: ContractKPI | null,
) => {
  const actual =
    `${breach.actual_value ?? "N/A"} ${breach.actual_unit || kpi?.unit || ""}`.trim();
  const expected = expectedFor(breach, kpi);
  if (!breach.is_breach)
    return `Actual value ${actual} meets the contract threshold (${expected}).`;

  const operator = String(breach.operator || kpi?.operator || "").trim();
  const actualNumber = toNumber(breach.actual_value);
  const expectedNumber = toNumber(
    breach.expected_value ?? kpi?.value_min ?? kpi?.value,
  );
  if (actualNumber != null && expectedNumber != null) {
    if (
      (operator.includes(">") || operator === "min") &&
      actualNumber < expectedNumber
    ) {
      return `Actual value ${actual} fell below the contractual threshold (${expected}).`;
    }
    if (
      (operator.includes("<") || operator === "max") &&
      actualNumber > expectedNumber
    ) {
      return `Actual value ${actual} exceeded the contractual threshold (${expected}).`;
    }
  }
  return `Actual value ${actual} violated the contractual threshold (${expected}).`;
};

const humanizeSourceLabel = (source?: string | null) => {
  const labels: Record<string, string> = {
    scanned_images: "Scanned Images",
    file_upload: "File Upload",
    csv: "CSV file",
    json: "JSON file",
    xlsx: "Excel file",
    xml: "XML file",
    rest_api: "REST feed",
    sap_s4hana: "SAP S/4HANA",
    manual_attestation: "Manual attestation",
  };
  const raw = String(source || "").trim();
  if (!raw) return "Operations data";
  if (raw.startsWith("source_config:")) {
    const sourceType = raw.split(":").pop()?.toLowerCase() || "";
    return labels[sourceType] || titleCase(sourceType);
  }
  if (raw.toLowerCase().startsWith("upload:")) return "Uploaded file";
  return labels[raw.toLowerCase()] || raw.replace(/[_-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
};

const humanizeExpectation = (operator: string, value: string, unit: string) => {
  const operatorLabel: Record<string, string> = {
    ">=": "at least",
    ">": "more than",
    "<=": "no more than",
    "<": "less than",
    "=": "exactly",
    "==": "exactly",
  };
  return `${operatorLabel[operator.toLowerCase()] || operator || "the contract threshold"} ${value} ${unit}`.trim();
};

const buildEscalationDraft = (breach: ContractKPIBreach, kpi?: ContractKPI) => {
  const unit = kpi?.unit || breach.actual_unit || "";
  const actual =
    `${breach.actual_value ?? "not reported"} ${breach.actual_unit || unit}`.trim();
  const penalty = toNumber(breach.penalty_amount ?? kpi?.consequence_value);
  const penaltyText = financialImpactText(penalty, kpi);
  const variance = breach.variance_percent;
  const varianceText = variance !== null && variance !== undefined ? `${variance >= 0 ? "+" : ""}${variance.toFixed(1)}%` : "N/A";
  const severity = breach.severity || "Medium";
  const contract = breach.source_kpi?.contract_name || kpi?.contract_name || "the agreement";
  const section = kpi?.section || "";
  const clause = kpi?.quote || "";
  const period = breach.period_end || breach.timestamp || breach.created_at;
  const periodText = period ? new Date(period).toISOString().slice(0, 10) : "N/A";
  const remediation = breach.remediation || kpi?.remediation || "Please review the discrepancy, confirm the root cause, and provide a corrective action plan.";
  const sla = breach.remediation_sla || kpi?.remediation_sla || "7 days";
  const clauseBlock = section || clause ? `\nContract reference: ${section}\n"${clause}"\n` : "";
  const sourceLabel = humanizeSourceLabel(breach.source || kpi?.source_requirements?.source_type);
  const expectation = humanizeExpectation(
    String(breach.operator || kpi?.operator || ""),
    String(breach.expected_value ?? kpi?.value_min ?? kpi?.value ?? "N/A"),
    unit,
  );
  const kpiName = kpi?.name || breach.source_kpi?.name || breach.kpi_id;
  return [
    `Subject: Action needed: ${kpiName} did not meet the contract requirement`,
    "",
    "Hello,",
    "",
    `We found a compliance issue under ${contract}. Please review the details below.`,
    "",
    "What happened",
    `- Requirement: ${kpiName}`,
    `- Contract expectation: ${expectation}`,
    `- Reported result: ${actual}`,
    `- Difference from expectation: ${varianceText}`,
    `- Reporting period: ${periodText}`,
    `- Data source: ${sourceLabel}`,
    `- Severity: ${severity}`,
    "",
    "Why this matters",
    `- Estimated financial impact: ${penaltyText}`,
    "",
    "What needs to happen",
    remediation,
    `Please investigate the cause and send a corrective action plan within ${sla}.`,
    clauseBlock,
    "Please confirm once the issue has been reviewed.",
    "",
    "Regards,",
    "Contract Compliance Team",
  ].join("\n");
};

const chartPointsFor = (actuals: ContractKPIActual[]) => {
  const ordered = [...actuals].sort(
    (left, right) =>
      new Date(actualTimestamp(left) || 0).getTime() -
      new Date(actualTimestamp(right) || 0).getTime(),
  );
  return ordered.map((actual, index) => ({
    xLabel: actualTimestamp(actual)
      ? new Date(actualTimestamp(actual) as string).toLocaleDateString()
      : `#${index + 1}`,
    value: toNumber(actual.value) ?? 0,
  }));
};

type IngestionMode = "manual" | "scheduled" | "realtime" | "attestation";

const ingestionModeFor = (source?: KPISourceConfig | null): IngestionMode => {
  if (!source) return "manual";
  if (source.source_type === "manual_attestation") return "attestation";
  const cadence = String(source.schedule?.cadence || "").toLowerCase();
  if (["webhook", "real_time", "realtime", "on_file_arrival"].includes(cadence))
    return "realtime";
  if (source.enabled || !["", "manual"].includes(cadence)) return "scheduled";
  return "manual";
};

const ingestionModeLabel = (source?: KPISourceConfig | null) => {
  const mode = ingestionModeFor(source);
  if (mode === "scheduled")
    return `Scheduled ${titleCase(source?.schedule?.cadence || "polling")}`;
  if (mode === "realtime") return "Webhook / realtime";
  if (mode === "attestation") return "Manual attestation";
  return "Manual fetch";
};

const runDisplayTime = (run: KPISourceFetchRun) =>
  formatDateTime(run.finished_at || run.started_at);

const runDuration = (run: KPISourceFetchRun) => {
  if (run.duration_ms != null) {
    if (run.duration_ms < 1000) return `${run.duration_ms}ms`;
    return `${(run.duration_ms / 1000).toFixed(1)}s`;
  }
  if (run.started_at && run.finished_at) {
    const delta =
      new Date(run.finished_at).getTime() - new Date(run.started_at).getTime();
    if (Number.isFinite(delta) && delta >= 0)
      return `${(delta / 1000).toFixed(1)}s`;
  }
  return "running";
};

const sourceEndpointLabel = (source?: KPISourceConfig | null) => {
  if (!source) return "Actual ingestion";
  if (source.endpoint) return `${source.method || "GET"} ${source.endpoint}`;
  if (source.signed_url) return "Signed file URL";
  if (source.source_type === "manual_attestation")
    return "Workspace attestation";
  if (["csv", "xlsx", "json", "xml", "scanned_images", "file_upload"].includes(source.source_type))
    return `${titleCase(source.source_type)} upload sample`;
  return titleCase(source.source_type);
};

function ScrollableTabs({ tabs, activeTab, onTabChange }: { tabs: { id: string; label: string }[]; activeTab: string; onTabChange: (id: string) => void }) {
  const scrollRef = useRef<HTMLDivElement>(null);

  const scroll = (direction: "left" | "right") => {
    if (scrollRef.current) {
      const scrollAmount = 250;
      scrollRef.current.scrollBy({ left: direction === "left" ? -scrollAmount : scrollAmount, behavior: "smooth" });
    }
  };

  return (
    <div className="relative flex items-center flex-1 min-w-0 w-full mr-2">
      <button onClick={() => scroll("left")} className="absolute left-0 z-10 flex h-full items-center justify-center bg-gradient-to-r from-background via-background/90 to-transparent pr-5 pl-1" type="button">
        <ChevronLeft className="h-4 w-4 text-muted-foreground" />
      </button>

      <div
        ref={scrollRef}
        className="flex items-center gap-1.5 overflow-x-auto scrollbar-hide px-8 py-1 w-full"
        style={{
          scrollbarWidth: "none",
          msOverflowStyle: "none",
          maskImage: "linear-gradient(to right, transparent, black 28px, black calc(100% - 28px), transparent)",
          WebkitMaskImage: "linear-gradient(to right, transparent, black 28px, black calc(100% - 28px), transparent)"
        }}
      >
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => onTabChange(tab.id)}
            className={`whitespace-nowrap rounded-md px-2.5 py-1 text-xs font-semibold transition-colors flex-shrink-0 ${activeTab === tab.id
              ? "bg-[#015CA9] text-white shadow-sm"
              : "bg-muted/50 text-gray-700 hover:bg-muted"
              }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <button onClick={() => scroll("right")} className="absolute right-0 z-10 flex h-full items-center justify-center bg-gradient-to-l from-background via-background/90 to-transparent pl-5 pr-1" type="button">
        <ChevronRight className="h-4 w-4 text-muted-foreground" />
      </button>
    </div>
  );
}

export type RecoveryReminderAction = {
  dispatch_id: string;
  audience: "team_owner" | "client" | string;
  recipient: string;
  sent_at: string;
  status: string;
  subject: string;
};



export default function ContractKpiManagementPage() {
  const { setBreadcrumbs } = useBreadcrumbs();
  const router = useRouter();
  const params = useParams();

  const contractId =
    typeof params?.contract_id === "string" ? params.contract_id : "";

  const apiUrl = process.env.NEXT_PUBLIC_EXTRACTOR_API_URL;
  const { token, authChecked, isAuthenticated, authenticatedFetch } = useAuth();


  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [activePanel, setActivePanel] = useState<PanelKey>("review");
  const [showAcceptKpisFirstModal, setShowAcceptKpisFirstModal] = useState(false);
  const [actionLogs, setActionLogs] = useState<Record<string, RecoveryReminderAction[]>>({});
  const [contract, setContract] = useState<FullContractData | null>(null);
  const [kpis, setKpis] = useState<ContractKPI[]>([]);
  const [summary, setSummary] = useState<ContractKPISummary | null>(null);
  const [actuals, setActuals] = useState<ContractKPIActual[]>([]);
  const [breaches, setBreaches] = useState<ContractKPIBreach[]>([]);
  const [portfolio, setPortfolio] = useState<KPIPortfolio | null>(null);
  const [catalogEntries, setCatalogEntries] = useState<KPICatalogEntry[]>([]);
  const [kpiAlerts, setKpiAlerts] = useState<KPIAlert[]>([]);
  const [sourceCatalog, setSourceCatalog] = useState<KPISourceCatalogItem[]>(
    [],
  );
  const [recentProfiles, setRecentProfiles] = useState<KPIIntegrationProfile[]>(
    [],
  );
  const [sourceConfigs, setSourceConfigs] = useState<KPISourceConfig[]>([]);
  const [sourceRuns, setSourceRuns] = useState<
    Record<string, KPISourceFetchRun[]>
  >({});
  const [runDetails, setRunDetails] = useState<
    Record<string, KPISourceRunDetail | { error: string }>
  >({});
  const [sourceResults, setSourceResults] = useState<Record<string, any>>({});
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);
  const [samplePayload, setSamplePayload] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isKpiDataPending, setIsKpiDataPending] = useState(false);
  const [isExtracting, setIsExtracting] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isSavingSource, setIsSavingSource] = useState(false);
  const [runningSourceIds, setRunningSourceIds] = useState<Set<string>>(new Set());
  const [isCreatingAlertRules, setIsCreatingAlertRules] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sortedKpis = useMemo(
    () =>
      [...kpis].sort(
        (left, right) =>
          Number(isKpiTracked(right)) - Number(isKpiTracked(left)) ||
          (left.page_start || 9999) - (right.page_start || 9999) ||
          (left.kpi_type || "").localeCompare(right.kpi_type || "") ||
          left.name.localeCompare(right.name),
      ),
    [kpis],
  );
  const kpiById = useMemo(
    () => new Map(kpis.map((kpi) => [kpi.kpi_id, kpi])),
    [kpis],
  );
  const trackedKpis = useMemo(
    () => sortedKpis.filter(isKpiTracked),
    [sortedKpis],
  );
  const airportDemoFlagsReady = useMemo(() => {
    const demoSources = sourceConfigs.filter((config) => isAirportDemoSource(config));
    if (!demoSources.length) return true;
    const expectedSourceGroups: string[][] = [
      ["scanned_images", "csv"],
      ["file_upload", "json"],
      ["rest_api"],
      ["sap_s4hana"],
    ];
    const completedRun = (config: KPISourceConfig) => {
      const status = String(config.last_fetch_status?.status || "").toLowerCase();
      return Boolean(config.last_run_at) && !["failed", "validation_failed", "last_fetch_failed"].includes(status);
    };
    return expectedSourceGroups.every((sourceTypes) =>
      demoSources.some(
        (config) =>
          sourceTypes.includes(config.source_type) &&
          completedRun(config) &&
          Boolean(
            config.last_success_at ||
            config.last_run_at ||
            Number(config.last_fetch_status?.record_count || 0) > 0 ||
            Number(config.last_fetch_status?.accepted_count || 0) > 0 ||
            Number(config.last_fetch_status?.actual_count || 0) > 0,
          ),
      ),
    );
  }, [sourceConfigs]);
  const airportDemoCompletedSourceCount = useMemo(
    () =>
      sourceConfigs.filter(
        (config) => {
          const status = String(config.last_fetch_status?.status || "").toLowerCase();
          return (
            isAirportDemoSource(config) &&
            Boolean(config.last_run_at) &&
            !["failed", "validation_failed", "last_fetch_failed"].includes(status)
          );
        },
      ).length,
    [sourceConfigs],
  );
  const activeBreaches = useMemo(
    () =>
      (airportDemoFlagsReady ? breaches : []).filter(
        (breach) =>
          isKpiTracked(kpiById.get(breach.kpi_id)) &&
          breach.is_breach &&
          breach.status !== "resolved" &&
          breach.status !== "closed",
      ),
    [airportDemoFlagsReady, breaches, kpiById],
  );
  const visibleBreaches = useMemo(
    () =>
      (airportDemoFlagsReady ? breaches : []).filter((breach) =>
        isKpiTracked(kpiById.get(breach.kpi_id)),
      ),
    [airportDemoFlagsReady, breaches, kpiById],
  );
  const deferredCount = sortedKpis.filter(
    (kpi) => kpi.status !== "ignored" && !isKpiTracked(kpi),
  ).length;
  const recommendedTrackCount = sortedKpis.filter(
    (kpi) =>
      isKpiRecommended(kpi) && !isKpiTracked(kpi) && kpi.status === "approved",
  ).length;
  const exposure = activeBreaches.reduce(
    (total, breach) =>
      total +
      Math.abs(toNumber(kpiById.get(breach.kpi_id)?.consequence_value) || 0),
    0,
  );
  const contractCurrency = useMemo(() => {
    const firstConsequenceUnit = sortedKpis.find((kpi) => kpi.consequence_unit)?.consequence_unit;
    return extractCurrency(firstConsequenceUnit);
  }, [sortedKpis]);
  const openAlertCount = kpiAlerts.filter(
    (alert) => String(alert.status || "open").toLowerCase() === "open",
  ).length;
  const certifiedMetricCount = catalogEntries.filter(
    (entry) =>
      String(entry.certified_status || "").toLowerCase() === "certified",
  ).length;
  const complianceRate = trackedKpis.length
    ? Math.max(
      0,
      Math.round(
        ((trackedKpis.length - activeBreaches.length) / trackedKpis.length) *
        100,
      ),
    )
    : 0;
  const userSourceCatalog = useMemo(
    () =>
      sourceCatalog.filter(
        (source) =>
          source.enabled_for_contract_users !== false &&
          USER_KPI_SOURCE_TYPES.has(source.source_type),
      ),
    [sourceCatalog],
  );
  const userSourceConfigs = useMemo(
    () =>
      sourceConfigs.filter((config) =>
        USER_KPI_SOURCE_TYPES.has(config.source_type),
      ),
    [sourceConfigs],
  );
  const sourcesByKpiId = useMemo(() => {
    const grouped = new Map<string, KPISourceConfig[]>();
    const add = (kpiId: string | undefined | null, source: KPISourceConfig) => {
      if (!kpiId) return;
      const current = grouped.get(kpiId) || [];
      if (
        !current.some(
          (item) => item.source_config_id === source.source_config_id,
        )
      ) {
        current.push(source);
        grouped.set(kpiId, current);
      }
    };
    userSourceConfigs.forEach((config) => {
      enabledKpiIdsForSource(config, kpis).forEach((kpiId) =>
        add(kpiId, config),
      );
    });
    kpis.forEach((kpi) => {
      const legacy = userSourceConfigs.find(
        (config) => config.source_config_id === kpi.source_config_id,
      );
      if (legacy) add(kpi.kpi_id, legacy);
    });
    return grouped;
  }, [kpis, userSourceConfigs]);
  const selectedSource = useMemo(
    () =>
      userSourceConfigs.find(
        (config) => config.source_config_id === selectedSourceId,
      ) ||
      userSourceConfigs[0] ||
      null,
    [userSourceConfigs, selectedSourceId],
  );
  const allFetchRuns = useMemo(
    () =>
      userSourceConfigs
        .flatMap((config) =>
          (sourceRuns[config.source_config_id] || []).map((run) => ({
            ...run,
            source_config_id: run.source_config_id || config.source_config_id,
          })),
        )
        .sort(
          (left, right) =>
            new Date(right.started_at || right.finished_at || 0).getTime() -
            new Date(left.started_at || left.finished_at || 0).getTime(),
        ),
    [sourceRuns, userSourceConfigs],
  );
  const actualsByKpiId = useMemo(() => {
    const grouped = new Map<string, ContractKPIActual[]>();
    actuals.forEach((actual) => {
      const list = grouped.get(actual.kpi_id) || [];
      list.push(actual);
      grouped.set(actual.kpi_id, list);
    });
    return grouped;
  }, [actuals]);

  useEffect(() => {
    if (!selectedSource) {
      setSamplePayload("");
      return;
    }
    setSamplePayload(
      selectedSource.sample_payload == null
        ? ""
        : typeof selectedSource.sample_payload === "string"
          ? selectedSource.sample_payload
          : JSON.stringify(selectedSource.sample_payload, null, 2),
    );
  }, [selectedSource?.source_config_id]);

  const hasAutoSelectedRef = useRef(false);
  useEffect(() => {
    if (!hasAutoSelectedRef.current && !selectedSourceId && sourceConfigs[0]?.source_config_id) {
      setSelectedSourceId(sourceConfigs[0].source_config_id);
      hasAutoSelectedRef.current = true;
    }
  }, [sourceConfigs, selectedSourceId]);

  useEffect(() => {
    if (contract) {
      setBreadcrumbs([
        { label: "Projects", href: "/dashboard" },
        ...(contract?.project_id || contract?.projectId || contract?.project?._id ? [{
          label: contract.project_name || contract.project?.name || "Project",
          href: `/dashboard/projects/${contract.project_id || contract.projectId || contract.project?._id || ""}`,
        }] : []),
        {
          label: contract.contract_name || "Contract",
          href: `/contracts/${contractId}`,
        },
        { label: "KPI Management", href: `/contracts/${contractId}/kpis` },
      ]);
    } else {
      setBreadcrumbs([
        { label: "Projects", href: "/dashboard" },
        { label: "KPI Management", href: `/contracts/${contractId}/kpis` },
      ]);
    }
  }, [contract, contractId, setBreadcrumbs]);

  const loadFetchRuns = useCallback(
    async (config: KPISourceConfig) => {
      if (!apiUrl || !config?.source_config_id) return;
      const result = await authenticatedFetch(
        `${apiUrl}/contracts/${contractId}/kpis/source-configs/${encodeURIComponent(config.source_config_id)}/fetch-runs`,
      );
      if (!result.error) {
        setSourceRuns((current) => ({
          ...current,
          [config.source_config_id]: Array.isArray(result.data?.fetch_runs)
            ? result.data.fetch_runs
            : [],
        }));
      }
    },
    [apiUrl, authenticatedFetch, contractId],
  );

  const loadRunDetail = useCallback(
    async (sourceConfigId: string, runId: string) => {
      if (!apiUrl || !sourceConfigId || !runId || runDetails[runId]) return;
      const result = await authenticatedFetch(
        `${apiUrl}/contracts/${contractId}/kpis/source-configs/${encodeURIComponent(sourceConfigId)}/fetch-runs/${encodeURIComponent(runId)}`,
      );
      setRunDetails((current) => ({
        ...current,
        [runId]: result.error ? { error: result.error } : result.data,
      }));
    },
    [apiUrl, authenticatedFetch, contractId, runDetails],
  );

  const loadWorkspace = useCallback(async ({ showLoading = true }: { showLoading?: boolean } = {}) => {
    if (!apiUrl || !contractId || !authChecked || !isAuthenticated) return;
    if (showLoading) setIsLoading(true);
    setError(null);
    try {
      const [
        contractResult,
        kpiResult,
        actualResult,
        breachResult,
        sourceResult,
      ] = await Promise.all([
        authenticatedFetch(`${apiUrl}/contracts/${contractId}`),
        authenticatedFetch(`${apiUrl}/contracts/${contractId}/kpis`),
        authenticatedFetch(`${apiUrl}/contracts/${contractId}/kpis/actuals`),
        authenticatedFetch(`${apiUrl}/contracts/${contractId}/kpis/breaches`),
        authenticatedFetch(
          `${apiUrl}/contracts/${contractId}/kpis/source-configs`,
        ),
      ]);
      const firstError = [
        contractResult,
        kpiResult,
        actualResult,
        breachResult,
        sourceResult,
      ].find((result) => result.error);
      if (firstError?.error) throw new Error(firstError.error);
      const loadedContract = contractResult.data || null;
      setIsKpiDataPending(Boolean(kpiResult.data?.extraction_in_progress));
      setContract(loadedContract);
      setKpis(Array.isArray(kpiResult.data?.kpis) ? kpiResult.data.kpis : []);
      setSummary(kpiResult.data?.summary || null);
      setActuals(
        Array.isArray(actualResult.data?.actuals)
          ? actualResult.data.actuals
          : [],
      );
      setBreaches(
        Array.isArray(breachResult.data?.breaches)
          ? breachResult.data.breaches
          : [],
      );
      setSourceConfigs(
        Array.isArray(sourceResult.data?.source_configs)
          ? sourceResult.data.source_configs
          : [],
      );

      const projectId =
        loadedContract?.projectId ||
        loadedContract?.project_id ||
        loadedContract?.project?._id;
      if (showLoading) setIsLoading(false);
      void Promise.all([
        authenticatedFetch(`${apiUrl}/kpis/source-catalog?scope=user`),
        authenticatedFetch(`${apiUrl}/kpis/integrations/profiles/recent`),
      ]).then(([catalogResult, recentProfilesResult]) => {
        if (!catalogResult.error)
          setSourceCatalog(
            Array.isArray(catalogResult.data?.sources)
              ? catalogResult.data.sources
              : [],
          );
        if (!recentProfilesResult.error)
          setRecentProfiles(
            Array.isArray(recentProfilesResult.data?.profiles)
              ? recentProfilesResult.data.profiles
              : [],
          );
      });
      if (projectId) {
        void Promise.all([
          authenticatedFetch(`${apiUrl}/projects/${projectId}/kpis/portfolio`),
          authenticatedFetch(`${apiUrl}/projects/${projectId}/kpis/catalog`),
          authenticatedFetch(`${apiUrl}/projects/${projectId}/kpis/alerts`),
        ]).then(([portfolioResult, metricCatalogResult, alertsResult]) => {
          if (!portfolioResult.error) setPortfolio(portfolioResult.data || null);
          if (!metricCatalogResult.error)
            setCatalogEntries(
              Array.isArray(metricCatalogResult.data?.entries)
                ? metricCatalogResult.data.entries
                : [],
            );
          if (!alertsResult.error)
            setKpiAlerts(
              Array.isArray(alertsResult.data?.alerts)
                ? alertsResult.data.alerts
                : [],
            );
        });
      } else {
        setPortfolio(null);
        setCatalogEntries([]);
        setKpiAlerts([]);
      }
    } catch (loadError) {
      setIsKpiDataPending(false);
      const message =
        loadError instanceof Error
          ? loadError.message
          : "Unable to load KPI management.";
      setError(message);
    } finally {
      if (showLoading) setIsLoading(false);
    }
  }, [apiUrl, authChecked, authenticatedFetch, contractId, isAuthenticated]);

  useEffect(() => {
    void loadWorkspace();
  }, [loadWorkspace]);

  useEffect(() => {
    if (!isKpiDataPending) return;
    const refreshTimer = window.setTimeout(() => {
      void loadWorkspace({ showLoading: false });
    }, 1500);
    return () => window.clearTimeout(refreshTimer);
  }, [isKpiDataPending, loadWorkspace]);

  useEffect(() => {
    if (selectedSource) void loadFetchRuns(selectedSource);
  }, [loadFetchRuns, selectedSource?.source_config_id]);

  useEffect(() => {
    userSourceConfigs.forEach((config) => {
      if (!sourceRuns[config.source_config_id]) void loadFetchRuns(config);
    });
  }, [loadFetchRuns, sourceRuns, userSourceConfigs]);

  const updateKpi = async (kpi: ContractKPI, updates: Partial<ContractKPI>) => {
    if (!apiUrl) return null;
    const normalizedUpdates: Partial<ContractKPI> = { ...updates };
    const numericUpdates = normalizedUpdates as Record<
      "value_min" | "value_max" | "consequence_value",
      unknown
    >;
    (["value_min", "value_max", "consequence_value"] as const).forEach(
      (key) => {
        const value = numericUpdates[key];
        if (value === undefined) return;
        numericUpdates[key] =
          value === null || String(value).trim() === "" ? null : Number(value);
      },
    );
    const previous = kpis;
    setKpis((current) =>
      current.map((item) =>
        item.kpi_id === kpi.kpi_id ? { ...item, ...normalizedUpdates } : item,
      ),
    );
    const result = await authenticatedFetch(
      `${apiUrl}/contracts/${contractId}/kpis/${encodeURIComponent(kpi.kpi_id)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(normalizedUpdates),
      },
    );
    if (result.error) {
      setKpis(previous);
      toast({
        title: "Could not update KPI",
        description: result.error,
        variant: "destructive",
      });
      return null;
    }
    const updated = result.data as ContractKPI;
    setKpis((current) =>
      current.map((item) => (item.kpi_id === updated.kpi_id ? updated : item)),
    );
    return updated;
  };

  const updateBreachStatus = async (breachId: string, status: string) => {
    if (!apiUrl) return null;
    const previous = [...breaches];
    setBreaches((current) =>
      current.map((b) => (b.breach_id === breachId ? { ...b, status } : b)),
    );
    const result = await authenticatedFetch(
      `${apiUrl}/contracts/${contractId}/kpis/breaches/${encodeURIComponent(breachId)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      },
    );
    if (result.error) {
      setBreaches(previous);
      toast({
        title: "Could not update status",
        description: result.error,
        variant: "destructive",
      });
      return null;
    }
    const updated = result.data.breach as ContractKPIBreach;
    setBreaches((current) =>
      current.map((item) => (item.breach_id === updated.breach_id ? updated : item)),
    );
    return updated;
  };

  const extractKpis = async () => {
    if (!apiUrl) return;
    setIsExtracting(true);
    const result = await authenticatedFetch(
      `${apiUrl}/contracts/${contractId}/kpis/extract`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ replace_drafts: true, ai_provider: "groq" }),
      },
    );
    setIsExtracting(false);
    if (result.error) {
      toast({
        title: "Could not extract KPIs",
        description: result.error,
        variant: "destructive",
      });
      return;
    }
    toast({
      title: "KPIs extracted",
      description: `${result.data?.kpi_count ?? result.data?.kpis?.length ?? 0} KPI candidates ready.`,
    });
    await loadWorkspace();
  };

  const acceptAll = async () => {
    const candidates = kpis.filter(
      (kpi) => kpi.status !== "approved" && kpi.status !== "ignored",
    );
    await Promise.all(
      candidates.map((kpi) =>
        updateKpi(kpi, {
          status: "approved",
          ...(isKpiRecommended(kpi)
            ? { tracking_status: "tracked", is_tracked: true }
            : {}),
        }),
      ),
    );
    toast({
      title: "KPI candidates accepted",
      description: `${candidates.length} KPI${candidates.length === 1 ? "" : "s"} accepted${recommendedTrackCount ? ` · ${recommendedTrackCount} recommended activated for tracking` : ""}.`,
    });
  };

  const trackRecommended = async () => {
    const candidates = kpis.filter(
      (kpi) =>
        isKpiRecommended(kpi) &&
        !isKpiTracked(kpi) &&
        kpi.status === "approved",
    );
    const updated = await Promise.all(
      candidates.map((kpi) =>
        updateKpi(kpi, { tracking_status: "tracked", is_tracked: true }),
      ),
    );
    const backfilled = updated.reduce(
      (total, item) =>
        total + Number(item?.last_tracking_backfill?.created_breach_count || 0),
      0,
    );
    await loadWorkspace();
    toast({
      title: "Recommended KPIs tracked",
      description: backfilled
        ? `${backfilled} existing actual${backfilled === 1 ? "" : "s"} evaluated immediately.`
        : `${candidates.length} KPI${candidates.length === 1 ? "" : "s"} activated.`,
    });
  };

  const uploadActuals = async (files: FileList | File[] | File) => {
    if (!apiUrl || !token) return;
    const fileList = Array.from(files instanceof File ? [files] : files);
    if (!fileList.length) return;

    setIsUploading(true);
    let totalCount = 0;
    let totalBreaches = 0;
    let successCount = 0;
    let errorMessages: string[] = [];

    for (const file of fileList) {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("evaluate", "true");
      try {
        const result = await apiUploadWithProgress<any>(
          `${apiUrl}/contracts/${contractId}/kpis/actuals/upload`,
          formData,
        );
        if (result.error)
          throw new Error(result.error || `Unable to upload ${file.name}`);
        const payload = result.data || {};
        totalCount += payload.count || 0;
        totalBreaches += payload.breaches?.length || 0;
        successCount++;
      } catch (uploadError) {
        errorMessages.push(
          `${file.name}: ${uploadError instanceof Error ? uploadError.message : "Upload failed"}`,
        );
      }
    }

    setIsUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = "";

    if (successCount > 0) {
      toast({
        title: `${successCount} file${successCount === 1 ? "" : "s"} ingested successfully!`,
        description: `${totalCount} actual rows mapped, ${totalBreaches} compliance evaluations generated.`,
      });
      setActivePanel("logs");
      await loadWorkspace();
    }
    if (errorMessages.length > 0) {
      toast({
        title: "Some files failed to upload",
        description: errorMessages.join("; "),
        variant: "destructive",
      });
    }
  };

  const defaultMappings = getDefaultKpiSourceMappings();

  const createSource = async (source: KPISourceCatalogItem) => {
    if (!apiUrl) return null;
    setIsSavingSource(true);
    const visibleKpis = sortedKpis.filter((kpi) => kpi.status !== "ignored");
    const demoCodes = airportDemoSourceCodes({
      source_type: source.source_type,
      display_name: source.label,
    });
    const targetKpis = demoCodes
      ? visibleKpis.filter((kpi) => demoCodes.has(kpi.kpi_id.split(":").pop() || kpi.kpi_id))
      : visibleKpis;
    const initialKpiIds = targetKpis.map((kpi) => kpi.kpi_id);
    const initialBindings = targetKpis.map((kpi, index) => ({
      binding_id: sourceBindingId("new_source", kpi.kpi_id, index + 1),
      kpi_id: kpi.kpi_id,
      enabled: true,
      match_rule: {
        field: "kpi_code",
        operator: "equals",
        value: kpi.kpi_id.split(":").pop() || kpi.kpi_id,
      },
      field_mappings: [],
      aggregation: "latest",
    }));

    const result = await authenticatedFetch(
      `${apiUrl}/contracts/${contractId}/kpis/source-configs`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          display_name: source.label,
          source_type: source.source_type,
          file_format:
            source.source_type === "manual_attestation"
              ? "json"
              : source.source_type === "scanned_images"
                ? "csv"
                : source.source_type === "file_upload"
                  ? "json"
                  : source.source_type,
          auth_type: source.auth_types?.[0] || "none",
          status: "mapped",
          enabled: true,
          schedule: {
            cadence: "manual",
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
          },
          dedupe_key: "source_record_id",
          watermark_field: "timestamp",
          field_mappings: defaultMappings,
          kpi_ids: initialKpiIds,
          kpi_bindings: initialBindings,
          validation_rules: [
            { field: "actual_value", rule: "required_numeric" },
            { field: "timestamp", rule: "required_datetime" },
          ],
        }),
      },
    );
    setIsSavingSource(false);
    if (result.error) {
      toast({
        title: "Could not create source",
        description: result.error,
        variant: "destructive",
      });
      return null;
    }
    const created = result.data as KPISourceConfig;
    setSourceConfigs((current) => [created, ...current]);
    setSelectedSourceId(created.source_config_id);
    return created;
  };

  const uploadSourceSampleFile = async (
    config: KPISourceConfig,
    file: File,
  ) => {
    if (!apiUrl || !token) return;
    setIsSavingSource(true);
    const formData = new FormData();
    formData.append("file", file);
    try {
      const response = await fetch(
        `${apiUrl}/contracts/${contractId}/kpis/source-configs/${encodeURIComponent(config.source_config_id)}/sample-upload`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          body: formData,
        },
      );
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.detail || "Failed to parse sample file.");
      if (data.source_config) {
        setSourceConfigs((current) =>
          current.map((item) =>
            item.source_config_id === data.source_config.source_config_id
              ? data.source_config
              : item,
          ),
        );
      }
      if (data.sample_payload) {
        setSamplePayload(
          typeof data.sample_payload === "string"
            ? data.sample_payload
            : JSON.stringify(data.sample_payload, null, 2),
        );
      }
      toast({
        title: "Sample file uploaded & auto-mapped!",
        description: `Parsed ${data.record_count || 0} rows. ${data.field_mappings?.length || 0} fields auto-mapped.`,
      });
    } catch (uploadError) {
      toast({
        title: "Sample upload failed",
        description:
          uploadError instanceof Error
            ? uploadError.message
            : "Invalid file format.",
        variant: "destructive",
      });
    } finally {
      setIsSavingSource(false);
    }
  };

  const deleteSource = async (config: KPISourceConfig) => {
    if (!apiUrl) return;
    if (!window.confirm(`Delete ${config.display_name}?`)) return;
    setIsSavingSource(true);
    const result = await authenticatedFetch(
      `${apiUrl}/contracts/${contractId}/kpis/source-configs/${encodeURIComponent(config.source_config_id)}`,
      { method: "DELETE" },
    );
    setIsSavingSource(false);
    if (result.error) {
      toast({
        title: "Could not delete source",
        description: result.error,
        variant: "destructive",
      });
      return;
    }
    setSourceConfigs((current) =>
      current.filter((item) => item.source_config_id !== config.source_config_id),
    );
    setSelectedSourceId((current) =>
      current === config.source_config_id ? null : current,
    );
    setSourceResults((current) => {
      const next = { ...current };
      delete next[config.source_config_id];
      return next;
    });
    toast({ title: "Source deleted" });
  };

  const updateSource = async (
    config: KPISourceConfig,
    updates: Partial<KPISourceConfig>,
  ) => {
    if (!apiUrl) return null;
    const payload = {
      ...config,
      ...updates,
      schedule: { ...(config.schedule || {}), ...(updates.schedule || {}) },
    };
    setIsSavingSource(true);
    const result = await authenticatedFetch(
      `${apiUrl}/contracts/${contractId}/kpis/source-configs/${encodeURIComponent(config.source_config_id)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
    );
    setIsSavingSource(false);
    if (result.error) {
      toast({
        title: "Could not save source",
        description: result.error,
        variant: "destructive",
      });
      return null;
    }
    setSourceConfigs((current) =>
      current.map((item) =>
        item.source_config_id === result.data.source_config_id
          ? result.data
          : item,
      ),
    );
    return result.data as KPISourceConfig;
  };

  const toggleSourceKpi = async (config: KPISourceConfig, kpi: ContractKPI) => {
    const currentBindings = bindingsForSource(
      config,
      sortedKpis.filter((item) => item.status !== "ignored"),
    );
    const currentBinding = currentBindings.find(
      (binding) => binding.kpi_id === kpi.kpi_id,
    );
    const nextBinding = {
      ...(currentBinding || {
        binding_id: sourceBindingId(
          config.source_config_id,
          kpi.kpi_id,
          currentBindings.length + 1,
        ),
        kpi_id: kpi.kpi_id,
      }),
      enabled: !(currentBinding?.enabled !== false),
    };
    const nextBindings = currentBindings.map((binding) =>
      binding.kpi_id === kpi.kpi_id ? nextBinding : binding,
    );
    const nextKpiIds = Array.from(
      new Set(
        nextBindings
          .filter((binding) => binding.enabled !== false)
          .map((binding) => binding.kpi_id),
      ),
    );
    await updateSource(config, {
      kpi_bindings: nextBindings,
      kpi_ids: nextKpiIds,
      status: nextKpiIds.length
        ? config.enabled
          ? "enabled"
          : "mapped"
        : "draft",
      field_mappings: config.field_mappings?.length
        ? config.field_mappings
        : defaultMappings,
    });
  };

  const updateSourceBinding = async (
    config: KPISourceConfig,
    nextBinding: KPISourceBinding,
  ) => {
    const visibleKpis = sortedKpis.filter((kpi) => kpi.status !== "ignored");
    const nextBindings = upsertSourceBinding(config, visibleKpis, nextBinding);
    const nextKpiIds = Array.from(
      new Set(
        nextBindings
          .filter((binding) => binding.enabled !== false)
          .map((binding) => binding.kpi_id),
      ),
    );
    await updateSource(config, {
      kpi_bindings: nextBindings,
      kpi_ids: nextKpiIds,
      status: nextKpiIds.length
        ? config.enabled
          ? "enabled"
          : "mapped"
        : "draft",
      field_mappings: config.field_mappings?.length
        ? config.field_mappings
        : defaultMappings,
    });
  };

  const applyIngestionMode = async (
    config: KPISourceConfig,
    mode: IngestionMode,
  ) => {
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    const baseStatus = enabledKpiIdsForSource(config, sortedKpis).length
      ? "mapped"
      : "ready";
    const updates: Partial<KPISourceConfig> =
      mode === "scheduled"
        ? {
          enabled: true,
          status: "enabled",
          schedule: {
            ...(config.schedule || {}),
            cadence:
              config.schedule?.cadence && config.schedule.cadence !== "manual"
                ? config.schedule.cadence
                : "daily",
            timezone,
          },
        }
        : mode === "realtime"
          ? {
            enabled: true,
            status: "enabled",
            schedule: {
              ...(config.schedule || {}),
              cadence: "webhook",
              timezone,
            },
          }
          : mode === "attestation"
            ? ({
              source_type: "manual_attestation",
              file_format: "json",
              enabled: false,
              status: baseStatus,
              schedule: {
                ...(config.schedule || {}),
                cadence: "manual",
                timezone,
              },
            } as Partial<KPISourceConfig>)
            : {
              enabled: false,
              status: baseStatus,
              schedule: {
                ...(config.schedule || {}),
                cadence: "manual",
                timezone,
              },
            };
    await updateSource(config, updates);
  };

  const saveSamplePayload = async (config: KPISourceConfig) => {
    const trimmed = samplePayload.trim();
    let parsed: any = trimmed || null;
    if (
      trimmed &&
      (config.source_type === "json" ||
        trimmed.startsWith("{") ||
        trimmed.startsWith("["))
    ) {
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        toast({
          title: "Invalid JSON sample",
          description: "Fix the payload before saving.",
          variant: "destructive",
        });
        return;
      }
    }
    await updateSource(config, {
      sample_payload: parsed,
    } as Partial<KPISourceConfig>);
    toast({ title: "Sample saved" });
  };

  const runSourceAction = async (
    config: KPISourceConfig,
    action: "test" | "fetch",
  ) => {
    if (!apiUrl) return null;
    const payloadStr = samplePayload.trim();
    const isFileSource = [
      "csv",
      "xlsx",
      "json",
      "xml",
      "scanned_images",
      "file_upload",
      "manual_attestation",
    ].includes(config.source_type);
    if (isFileSource && !payloadStr && !config.sample_payload) {
      toast({
        title: "Please attach a data file",
        description:
          "Select a file before validating this source.",
      });
      if (fileInputRef.current) {
        fileInputRef.current.click();
      }
      return null;
    }
    setRunningSourceIds((prev) => new Set(prev).add(config.source_config_id));
    try {
      const payload = payloadStr
        ? (() => {
          try {
            return JSON.parse(samplePayload);
          } catch {
            return samplePayload;
          }
        })()
        : undefined;
      const result = await authenticatedFetch(
        `${apiUrl}/contracts/${contractId}/kpis/source-configs/${encodeURIComponent(config.source_config_id)}/${action}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            action === "fetch"
              ? { trigger_type: "manual", evaluate: true, payload }
              : { payload },
          ),
        },
      );
      if (result.error) {
        toast({
          title: action === "fetch" ? "Fetch failed" : "Validation failed",
          description: result.error,
          variant: "destructive",
        });
        return null;
      }
      setSourceResults((current) => ({
        ...current,
        [config.source_config_id]: result.data,
      }));
      if (result.data?.source_config) {
        setSourceConfigs((current) =>
          current.map((item) =>
            item.source_config_id === result.data.source_config.source_config_id
              ? result.data.source_config
              : item,
          ),
        );
      }
      // Refresh the data without replacing the workspace with its full-page
      // loading state. Upload/demo fetches finish quickly and should leave the
      // completed run and actuals visible instead of looking like a reset.
      await Promise.all([
        loadWorkspace({ showLoading: false }),
        loadFetchRuns(config),
      ]);
      toast({
        title:
          action === "fetch"
            ? "Source fetch complete"
            : "Source validation complete",
      });
      return result.data;
    } finally {
      setRunningSourceIds((prev) => {
        const next = new Set(prev);
        next.delete(config.source_config_id);
        return next;
      });
    }
  };

  const testSourceConfiguration = async (
    config: KPISourceConfig,
    updates: Partial<KPISourceConfig>,
  ) => {
    const saved = await updateSource(config, updates);
    if (!saved) return null;
    return runSourceAction(saved, "test");
  };

  const flagRemediationEmail = async (breach: ContractKPIBreach) => {
    if (!apiUrl || !breach.breach_id) return null;
    const result = await authenticatedFetch(
      `${apiUrl}/contracts/${contractId}/kpis/breaches/${encodeURIComponent(breach.breach_id)}/flag-remediation-email`,
      {
        method: "POST",
      },
    );
    if (result.error) {
      toast({
        title: "Could not prepare escalation",
        description: result.error,
        variant: "destructive",
      });
      return null;
    }
    const updated = result.data as ContractKPIBreach;
    setBreaches((current) =>
      current.map((item) =>
        item.breach_id === updated.breach_id ? updated : item,
      ),
    );
    return updated;
  };

  const notifyTeamForBreach = async (breach: ContractKPIBreach) => {
    if (!apiUrl || !breach.breach_id) return null;
    const result = await authenticatedFetch(
      `${apiUrl}/contracts/${contractId}/kpis/breaches/${encodeURIComponent(breach.breach_id)}/notify-team`,
      {
        method: "POST",
      },
    );
    if (result.error) {
      toast({
        title: "Could not notify team",
        description: result.error,
        variant: "destructive",
      });
      return null;
    }
    const updated = result.data as ContractKPIBreach;
    setBreaches((current) =>
      current.map((item) =>
        item.breach_id === updated.breach_id ? updated : item,
      ),
    );
    // Confirmation is shown as a modal (FlagsPanel's notifyConfirmName dialog),
    // not a toast, per the "must show a modal saying team is notified" ask.
    return updated;
  };

  const certifyKpi = async (
    kpi: ContractKPI,
    governanceStatus: "reviewed" | "certified" | "deprecated",
  ) => {
    if (!apiUrl) return null;
    const result = await authenticatedFetch(
      `${apiUrl}/contracts/${contractId}/kpis/${encodeURIComponent(kpi.kpi_id)}/certify`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: governanceStatus,
          notes: `Marked ${governanceStatus} from KPI workspace.`,
        }),
      },
    );
    if (result.error) {
      toast({
        title: "Could not update governance",
        description: result.error,
        variant: "destructive",
      });
      return null;
    }
    const updated = result.data as ContractKPI;
    setKpis((current) =>
      current.map((item) => (item.kpi_id === updated.kpi_id ? updated : item)),
    );
    await loadWorkspace();
    toast({
      title: "KPI governance updated",
      description: `${updated.name || "KPI"} is now ${titleCase(governanceStatus)}.`,
    });
    return updated;
  };

  const createDefaultAlertRules = async () => {
    if (!apiUrl) return;
    setIsCreatingAlertRules(true);
    const rules = [
      {
        name: "Breach created",
        event_type: "breach_created",
        severity_min: "Low",
        channels: ["in_app"],
      },
      {
        name: "Source stale",
        event_type: "source_stale",
        severity_min: "Medium",
        channels: ["in_app"],
      },
      {
        name: "Missing actual",
        event_type: "missing_actual",
        severity_min: "Medium",
        channels: ["in_app"],
      },
      {
        name: "Connector failed",
        event_type: "connector_failed",
        severity_min: "High",
        channels: ["in_app"],
      },
      {
        name: "Upcoming deadline",
        event_type: "upcoming_deadline",
        severity_min: "Medium",
        channels: ["in_app"],
      },
      {
        name: "Burn rate risk",
        event_type: "burn_rate_risk",
        severity_min: "Medium",
        channels: ["in_app"],
      },
    ];
    const results = await Promise.all(
      rules.map((rule) =>
        authenticatedFetch(
          `${apiUrl}/contracts/${contractId}/kpis/alert-rules`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(rule),
          },
        ),
      ),
    );
    setIsCreatingAlertRules(false);
    const failed = results.find((result) => result.error);
    if (failed?.error) {
      toast({
        title: "Could not create alert rules",
        description: failed.error,
        variant: "destructive",
      });
      return;
    }
    await loadWorkspace();
    toast({
      title: "Alert rules ready",
      description:
        "ContractSense will now surface KPI intelligence alerts for this contract.",
    });
  };

  const exportSnapshot = () => {
    const blob = new Blob(
      [
        JSON.stringify(
          {
            contract,
            kpis,
            actuals,
            breaches,
            sourceConfigs,
            exported_at: new Date().toISOString(),
          },
          null,
          2,
        ),
      ],
      { type: "application/json" },
    );
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${(contract?.contract_name || "contract").replace(/[^a-z0-9]+/gi, "_").toLowerCase()}_kpis.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  if (!authChecked || isAuthenticated === null) {
    return <LoadingState label="Checking access..." />;
  }

  if (!isAuthenticated) {
    return <LoadingState label="Redirecting..." />;
  }

  const sourceResult = selectedSource
    ? sourceResults[selectedSource.source_config_id]
    : null;

  return (
    <div className="min-h-screen bg-[#F9F9FF] font-InterVar text-gray-950">
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(event) => {
          const files = event.target.files;
          if (files && files.length) void uploadActuals(files);
        }}
      />

      <header className="border-b border-gray-200 bg-white">
        <div className="px-4 py-4 md:px-8">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
            <div className="min-w-0">
              <Link
                href={`/contracts/${contractId}`}
                title="View Contract PDF"
                className="group relative flex max-w-[95%] items-center"
              >
                <div className="relative overflow-hidden pr-8">
                  <h1 className="truncate text-2xl font-semibold tracking-tight text-gray-950 transition-colors group-hover:text-cs-primary">
                    {contract?.contract_name || "Contract Obligation Management"}
                  </h1>
                  <div className="pointer-events-none absolute inset-y-0 right-0 w-12 bg-gradient-to-r from-transparent to-white transition-opacity group-hover:opacity-0" />
                </div>
                <ChevronRight className="absolute right-0 h-6 w-6 text-gray-400 opacity-50 transition-all duration-200 group-hover:translate-x-1 group-hover:text-cs-primary group-hover:opacity-100" />
              </Link>
              <div className="mt-3 flex flex-wrap gap-2 text-xs">
                <Pill tone="emerald">{trackedKpis.length} tracked</Pill>
                <Pill tone="amber">{deferredCount} deferred</Pill>
                <Pill tone={activeBreaches.length ? "red" : "emerald"}>
                  {activeBreaches.length} open flags
                </Pill>
                <Pill tone="blue">{actuals.length} actuals</Pill>
              </div>
            </div>

            <div className="flex shrink-0 flex-wrap gap-2">
              <Link href={`/contracts/${contractId}`}>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-9 gap-1.5 text-xs"
                >
                  <FileText className="h-3.5 w-3.5" />
                  View PDF
                </Button>
              </Link>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-9 gap-1.5 text-xs"
                onClick={() => fileInputRef.current?.click()}
                disabled={isUploading || !kpis.length}
              >
                {isUploading ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Upload className="h-3.5 w-3.5" />
                )}
                Upload Actuals
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-9 gap-1.5 text-xs"
                onClick={exportSnapshot}
                disabled={!kpis.length}
              >
                <Download className="h-3.5 w-3.5" />
                Export
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-9 gap-1.5 text-xs"
                onClick={() => void loadWorkspace()}
                disabled={isLoading}
              >
                <RefreshCw
                  className={`h-3.5 w-3.5 ${isLoading ? "animate-spin" : ""}`}
                />
                Refresh
              </Button>
            </div>
          </div>

          <div className="mt-5 grid gap-2 md:grid-cols-3 xl:grid-cols-6">
            <Metric
              label="Compliance"
              value={`${complianceRate}%`}
              detail={`${Math.max(trackedKpis.length - activeBreaches.length, 0)} clear`}
            />
            <Metric
              label="Register"
              value={`${kpis.length}`}
              detail={`${summary?.total || kpis.length} extracted records`}
            />
            <Metric
              label="Tracking"
              value={`${trackedKpis.length}/${kpis.length || 0}`}
              detail={`${deferredCount} deferred`}
            />
            <Metric
              label="Flags"
              value={`${activeBreaches.length}`}
              detail={`${visibleBreaches.length} evaluations`}
            />
            <Metric
              label="Exposure"
              value={money(exposure, contractCurrency)}
              detail="current open risk"
            />
            <Metric
              label="Intelligence"
              value={`${openAlertCount}`}
              detail={`${certifiedMetricCount} certified`}
            />
          </div>
        </div>
      </header>

      <main className="grid gap-5 px-4 py-5 md:px-8 xl:grid-cols-[220px_1fr]">
        <aside className="h-fit rounded-lg border border-gray-200 bg-white p-2">
          {[
            {
              id: "intelligence",
              label: "Intelligence",
              icon: <Network className="h-4 w-4" />,
              count: openAlertCount,
            },
            {
              id: "review",
              label: "Review & Track",
              icon: <ShieldCheck className="h-4 w-4" />,
              count: kpis.length,
            },
            {
              id: "heatmap",
              label: "KPI Heatmap",
              icon: <Layers className="h-4 w-4" />,
              count: trackedKpis.length,
            },
            {
              id: "sources",
              label: "Actual Sources",
              icon: <UploadCloud className="h-4 w-4" />,
              count: userSourceConfigs.length,
            },
            {
              id: "flags",
              label: "Contract Breaches",
              icon: <AlertCircle className="h-4 w-4" />,
              count: activeBreaches.length,
            },
            {
              id: "recoveries",
              label: "Recoveries Management",
              icon: <RefreshCw className="h-4 w-4" />,
              count: activeBreaches.length,
            },
            {
              id: "logs",
              label: "Performance Logs",
              icon: <Clock className="h-4 w-4" />,
              count: allFetchRuns.length,
            },
          ].map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                if (item.id === "sources" && trackedKpis.length === 0) {
                  setShowAcceptKpisFirstModal(true);
                  return;
                }
                setActivePanel(item.id as PanelKey);
              }}
              className={`mb-1 flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm font-semibold transition-colors ${activePanel === item.id
                ? "bg-cs-primary text-white"
                : item.id === "sources" && trackedKpis.length === 0
                  ? "text-gray-400 hover:bg-gray-50"
                  : "text-gray-600 hover:bg-gray-50 hover:text-gray-950"
                }`}
            >
              <span className="flex min-w-0 items-center gap-2">
                {item.icon}
                <span className="truncate">{item.label}</span>
              </span>
              <span
                className={`rounded-full px-1.5 py-0.5 text-[10px] ${activePanel === item.id ? "bg-white/15 text-white" : "bg-gray-100 text-gray-500"}`}
              >
                {item.count}
              </span>
            </button>
          ))}
        </aside>

        {showAcceptKpisFirstModal && (
          <div
            className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 p-4"
            onClick={() => setShowAcceptKpisFirstModal(false)}
          >
            <div
              className="w-full max-w-sm rounded-xl border border-gray-200 bg-white p-6 shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-100">
                  <ShieldCheck className="h-5 w-5 text-amber-600" />
                </div>
                <h3 className="text-sm font-bold text-gray-900">Accept KPIs first</h3>
              </div>
              <p className="mt-3 text-sm text-gray-600">
                Actual Sources connects live data to tracked obligations. Accept
                (or Track Recommended) at least one KPI in Review &amp; Track
                before connecting sources — otherwise nothing will be evaluated
                and breach flags will always show 0.
              </p>
              <div className="mt-5 flex justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setShowAcceptKpisFirstModal(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={() => {
                    setShowAcceptKpisFirstModal(false);
                    setActivePanel("review");
                  }}
                >
                  Go to Review &amp; Track
                </Button>
              </div>
            </div>
          </div>
        )}

        <section className="min-w-0">
          {isLoading || isKpiDataPending ? (
            <LoadingState
              label={
                isKpiDataPending
                  ? "Preparing KPI obligations and compliance data..."
                  : "Loading KPI workspace..."
              }
              embedded
            />
          ) : error ? (
            <div className="rounded-lg border border-gray-300 bg-white px-4 py-3 text-sm text-gray-800">
              {error}
            </div>
          ) : activePanel === "intelligence" ? (
            <IntelligencePanel
              portfolio={portfolio}
              catalogEntries={catalogEntries}
              alerts={kpiAlerts}
              contractId={contractId}
              onCreateDefaultAlerts={createDefaultAlertRules}
              isCreatingAlertRules={isCreatingAlertRules}
            />
          ) : activePanel === "review" ? (
            <ReviewPanel
              kpis={sortedKpis}
              sourceConfigs={sourceConfigs}
              sourcesByKpiId={sourcesByKpiId}
              actualsByKpiId={actualsByKpiId}
              breaches={airportDemoFlagsReady ? breaches : []}
              onAcceptAll={acceptAll}
              onTrackRecommended={trackRecommended}
              onUpdateKpi={updateKpi}
              onCertifyKpi={certifyKpi}
              onOpenClause={(kpi) => {
                const citation = kpi.citation || kpi.citation_details || {};
                const page =
                  citation.page ?? citation.page_start ?? kpi.page_start;
                const quote = quoteFor(kpi);
                const citationKey = `kpi_${kpi.kpi_id || Date.now()}`;
                window.sessionStorage.setItem(
                  `contractsense:kpiCitation:${citationKey}`,
                  JSON.stringify({
                    quote,
                    page,
                    kpi_id: kpi.kpi_id,
                    document_id:
                      citation.document_id ||
                      citation.doc_id ||
                      kpi.document_id ||
                      kpi.contract_id ||
                      contractId,
                    filename:
                      citation.filename ||
                      kpi.contract_name ||
                      contract?.contract_name ||
                      null,
                  }),
                );
                router.push(
                  `/contracts/${kpi.contract_id || contractId}?kpi_citation=${encodeURIComponent(citationKey)}`,
                );
              }}
              recommendedTrackCount={recommendedTrackCount}
            />
          ) : activePanel === "heatmap" ? (
            <KpiHeatmapPanel
              kpis={sortedKpis}
              actuals={actuals}
              breaches={airportDemoFlagsReady ? breaches : []}
            />
          ) : activePanel === "sources" ? (
            <GuidedSourcesPanel
              sourceCatalog={userSourceCatalog}
              recentProfiles={recentProfiles}
              sourceConfigs={userSourceConfigs}
              selectedSource={selectedSource}
              selectedRuns={
                selectedSource
                  ? sourceRuns[selectedSource.source_config_id] || []
                  : []
              }
              sourceResult={sourceResult}
              kpis={sortedKpis}
              trackedKpis={trackedKpis}
              isSavingSource={isSavingSource}
              runningSourceIds={runningSourceIds}
              onSelectSource={setSelectedSourceId}
              onCreateSource={createSource}
              onUpdateSource={updateSource}
              onUpdateSourceBinding={updateSourceBinding}
              onDeleteSource={deleteSource}
              onRunSourceAction={runSourceAction}
              onTestSourceConfiguration={testSourceConfiguration}
              onUploadSampleFile={uploadSourceSampleFile}
              onAllSourcesReady={() => setActivePanel("flags")}
            />
          ) : activePanel === "recoveries" ? (
            <RecoveriesPanel breaches={visibleBreaches} kpiById={kpiById} actionLogs={actionLogs} setActionLogs={setActionLogs} updateBreachStatus={updateBreachStatus} onNotifyTeam={notifyTeamForBreach} />
          ) : activePanel === "flags" ? (
            <FlagsPanel
              breaches={visibleBreaches}
              kpiById={kpiById}
              flagsReady={airportDemoFlagsReady}
              completedSourceCount={airportDemoCompletedSourceCount}
              onFlagRemediationEmail={flagRemediationEmail}
              onNotifyTeam={notifyTeamForBreach}
              onBreachStatusChange={(breachId, status) =>
                setBreaches((current) =>
                  current.map((breach) =>
                    breach.breach_id === breachId ? { ...breach, status } : breach,
                  ),
                )
              }
            />
          ) : (
            <LogsPanel
              actuals={actuals}
              kpiById={kpiById}
              sourceConfigs={userSourceConfigs}
              sourceRuns={sourceRuns}
              runDetails={runDetails}
              onLoadRunDetail={loadRunDetail}
            />
          )}
        </section>
      </main>
    </div>
  );
}

function LoadingState({
  label,
  embedded = false,
}: {
  label: string;
  embedded?: boolean;
}) {
  return (
    <div
      className={`${embedded ? "min-h-[420px]" : "min-h-screen"} flex items-center justify-center bg-neutral-50 text-sm text-gray-500`}
    >
      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
      {label}
    </div>
  );
}

function Pill({
  children,
  tone = "gray",
}: {
  children: React.ReactNode;
  tone?: "gray" | "emerald" | "amber" | "red" | "blue";
}) {
  const classes = {
    gray: "border-gray-200 bg-gray-50 text-gray-600",
    emerald: "border-gray-200 bg-white text-gray-700",
    amber: "border-gray-200 bg-gray-50 text-gray-700",
    red: "border-gray-300 bg-white text-gray-950",
    blue: "border-gray-200 bg-white text-gray-700",
  }[tone];
  return (
    <span
      className={`inline-flex items-center rounded-md border px-2.5 py-1 text-xs font-semibold ${classes}`}
    >
      {children}
    </span>
  );
}

function Metric({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white px-4 py-3">
      <p className="text-[10px] font-bold uppercase tracking-wide text-gray-500">
        {label}
      </p>
      <p className="mt-2 text-2xl font-semibold tracking-normal text-gray-950">
        {value}
      </p>
      <p className="mt-1 text-xs text-gray-500">{detail}</p>
    </div>
  );
}

function IntelligencePanel({
  portfolio,
  catalogEntries,
  alerts,
  contractId,
  onCreateDefaultAlerts,
  isCreatingAlertRules,
}: {
  portfolio: KPIPortfolio | null;
  catalogEntries: KPICatalogEntry[];
  alerts: KPIAlert[];
  contractId: string;
  onCreateDefaultAlerts: () => void | Promise<void>;
  isCreatingAlertRules: boolean;
}) {
  const summary = portfolio?.summary || {};
  const health = portfolio?.connector_health || {};
  const openAlerts = alerts.filter(
    (alert) => String(alert.status || "open").toLowerCase() === "open",
  );
  const certified = catalogEntries.filter(
    (entry) =>
      String(entry.certified_status || "").toLowerCase() === "certified",
  );

  return (
    <div className="space-y-4">
      <div className="grid gap-3 xl:grid-cols-4">
        <Metric
          label="Portfolio Coverage"
          value={`${summary.coverage_percent ?? 0}%`}
          detail={`${summary.contracts_with_kpis ?? 0}/${summary.contract_count ?? 0} contracts`}
        />
        <Metric
          label="Monitored Obligations"
          value={`${summary.tracked_kpi_count ?? 0}`}
          detail={`${summary.kpi_count ?? 0} in catalog`}
        />
        <Metric
          label="Open Alerts"
          value={`${openAlerts.length}`}
          detail={`${summary.open_breach_count ?? 0} breach flags`}
        />
        <Metric
          label="Source Health"
          value={`${health.healthy ?? 0}`}
          detail={`${health.stale ?? 0} stale · ${health.failed ?? 0} failed`}
        />
      </div>

      <section className="rounded-lg border border-gray-200 bg-white">
        <div className="flex flex-col gap-3 border-b border-gray-100 p-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-base font-semibold text-gray-950">
              ContractSense Alerts
            </h2>
            <p className="mt-1 text-xs text-gray-500">
              Exceptions are generated from agreement obligations, source
              evidence, and deterministic evaluation state.
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 text-xs"
            onClick={onCreateDefaultAlerts}
            disabled={isCreatingAlertRules}
          >
            {isCreatingAlertRules ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Bell className="h-3.5 w-3.5" />
            )}
            Default Rules
          </Button>
        </div>
        {!alerts.length ? (
          <div className="px-4 py-8 text-sm text-gray-500">
            No obligation exceptions yet.
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {alerts.slice(0, 8).map((alert) => (
              <div
                key={alert.alert_id || alert.alert_key}
                className="grid gap-3 px-4 py-3 lg:grid-cols-[1fr_150px_140px] lg:items-center"
              >
                <div className="min-w-0">
                  <div className="mb-1 flex flex-wrap items-center gap-1.5">
                    <span
                      className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${statusTone(alert.severity || "medium")}`}
                    >
                      {titleCase(alert.severity || "Medium")}
                    </span>
                    <span className="rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-[10px] font-semibold text-gray-500">
                      {titleCase(alert.event_type || "alert")}
                    </span>
                  </div>
                  <p className="truncate text-sm font-semibold text-gray-950">
                    {alert.title || "KPI alert"}
                  </p>
                  <p className="mt-0.5 line-clamp-2 text-xs text-gray-500">
                    {alert.message || "Review this ContractSense KPI signal."}
                  </p>
                </div>
                <div className="text-xs text-gray-500">
                  <p className="font-semibold text-gray-800">
                    {titleCase(alert.status || "open")}
                  </p>
                  <p>
                    {formatDateTime(alert.last_seen_at || alert.created_at)}
                  </p>
                </div>
                <Link
                  href={`/contracts/${alert.contract_id || contractId}/kpis${alert.kpi_id ? `?kpi_id=${encodeURIComponent(alert.kpi_id)}` : ""}`}
                  className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-gray-200 bg-white px-2 text-xs font-semibold text-gray-700 hover:bg-gray-50"
                >
                  Open KPI
                  <ExternalLink className="h-3.5 w-3.5" />
                </Link>
              </div>
            ))}
          </div>
        )}
      </section>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
        <section className="rounded-lg border border-gray-200 bg-white">
          <div className="flex items-center justify-between border-b border-gray-100 p-4">
            <div>
              <h2 className="text-base font-semibold text-gray-950">
                Metric Catalog
              </h2>
              <p className="mt-1 text-xs text-gray-500">
                {certified.length} certified metrics across this project.
              </p>
            </div>
            <Pill tone="blue">{catalogEntries.length}</Pill>
          </div>
          {!catalogEntries.length ? (
            <div className="px-4 py-8 text-sm text-gray-500">
              Extract or certify KPIs to populate the ContractSense metric
              catalog.
            </div>
          ) : (
            <div className="max-h-[420px] overflow-auto">
              <table className="min-w-full text-left text-xs">
                <thead className="sticky top-0 bg-gray-50 text-[10px] font-bold uppercase tracking-wide text-gray-400">
                  <tr>
                    <th className="px-3 py-2">Metric</th>
                    <th className="px-3 py-2">Governance</th>
                    <th className="px-3 py-2">Coverage</th>
                    <th className="px-3 py-2">Owner</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {catalogEntries.slice(0, 30).map((entry) => (
                    <tr key={entry.metric_key}>
                      <td className="px-3 py-2">
                        <p className="font-semibold text-gray-950">
                          {entry.display_name || entry.metric_key}
                        </p>
                        <p className="mt-0.5 max-w-[360px] truncate text-[11px] text-gray-400">
                          {entry.description || entry.metric_key}
                        </p>
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${statusTone(entry.certified_status || "draft")}`}
                        >
                          {titleCase(entry.certified_status || "draft")} v
                          {entry.version || 1}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-gray-600">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-gray-900">
                            {entry.tracked_count || 0}
                          </span>
                          <span className="text-gray-400">of</span>
                          <span>{entry.kpi_count || 0}</span>
                        </div>
                      </td>
                      <td className="max-w-[160px] truncate px-3 py-2 text-gray-600">
                        {entry.owner || entry.owners?.[0] || "Unassigned"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="space-y-4">
          <div className="rounded-lg border border-gray-200 bg-white p-4">
            <div className="mb-3 flex items-center gap-2">
              <Settings2 className="h-4 w-4 text-gray-500" />
              <h2 className="text-sm font-semibold text-gray-950">
                Risky Contracts
              </h2>
            </div>
            <div className="space-y-2">
              {(portfolio?.risky_contracts || []).slice(0, 6).map((row) => (
                <Link
                  key={String(row.contract_id)}
                  href={`/contracts/${row.contract_id}/kpis`}
                  className="block rounded-md border border-gray-200 bg-white px-3 py-2 hover:bg-gray-50"
                >
                  <div className="flex justify-between gap-2">
                    <span className="truncate text-xs font-semibold text-gray-900">
                      {row.contract_name || row.contract_id}
                    </span>
                    <span className="text-xs font-semibold text-gray-500">
                      {row.open_breach_count || 0} flags
                    </span>
                  </div>
                  <p className="mt-1 text-[11px] text-gray-500">
                    {row.tracked_count || 0} tracked ·{" "}
                    {row.stale_source_count || 0} stale sources
                  </p>
                </Link>
              ))}
              {!(portfolio?.risky_contracts || []).length && (
                <p className="text-sm text-gray-500">
                  No risky contracts detected.
                </p>
              )}
            </div>
          </div>

          <div className="rounded-lg border border-gray-200 bg-white p-4">
            <div className="mb-3 flex items-center gap-2">
              <Clock className="h-4 w-4 text-gray-500" />
              <h2 className="text-sm font-semibold text-gray-950">
                Upcoming Windows
              </h2>
            </div>
            <div className="space-y-2">
              {(portfolio?.upcoming_reporting_windows || [])
                .slice(0, 6)
                .map((window) => (
                  <div
                    key={`${window.kpi_id}-${window.due_at}`}
                    className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2"
                  >
                    <p className="truncate text-xs font-semibold text-gray-900">
                      {window.name || window.kpi_id}
                    </p>
                    <p className="mt-1 text-[11px] text-gray-500">
                      {formatDateTime(window.due_at)} ·{" "}
                      {titleCase(window.frequency || window.window || "window")}
                    </p>
                  </div>
                ))}
              {!(portfolio?.upcoming_reporting_windows || []).length && (
                <p className="text-sm text-gray-500">
                  No reporting windows due soon.
                </p>
              )}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function ReviewPanel({
  kpis,
  sourcesByKpiId,
  actualsByKpiId,
  breaches,
  sourceConfigs,
  recommendedTrackCount,
  onAcceptAll,
  onTrackRecommended,
  onUpdateKpi,
  onCertifyKpi,
  onOpenClause,
}: {
  kpis: ContractKPI[];
  sourceConfigs: KPISourceConfig[];
  sourcesByKpiId: Map<string, KPISourceConfig[]>;
  actualsByKpiId: Map<string, ContractKPIActual[]>;
  breaches: ContractKPIBreach[];
  recommendedTrackCount: number;
  onAcceptAll: () => void | Promise<void>;
  onTrackRecommended: () => void | Promise<void>;
  onUpdateKpi: (
    kpi: ContractKPI,
    updates: Partial<ContractKPI>,
  ) => Promise<ContractKPI | null>;
  onCertifyKpi: (
    kpi: ContractKPI,
    status: "reviewed" | "certified" | "deprecated",
  ) => Promise<ContractKPI | null>;
  onOpenClause: (kpi: ContractKPI) => void;
}) {
  const { token } = useAuth();
  const params = useParams();
  const contractId =
    typeof params?.contract_id === "string" ? params.contract_id : "";
  const [expandedKpiId, setExpandedKpiId] = useState<string | null>(null);
  const [isContractPaneOpen, setIsContractPaneOpen] = useState(false);
  const [editingKpiId, setEditingKpiId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<
    | "all"
    | "supplier"
    | "client"
    | "mutual"
  >("all");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [filterCategory, setFilterCategory] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [pagination, setPagination] = useState({
    currentPage: 1,
    itemsPerPage: 10,
  });
  const breachByKpiId = useMemo(() => {
    const mapping = new Map<string, ContractKPIBreach[]>();
    breaches.forEach((breach) => {
      const list = mapping.get(breach.kpi_id) || [];
      list.push(breach);
      mapping.set(breach.kpi_id, list);
    });
    return mapping;
  }, [breaches]);

  // Helper to categorize Supplier vs Client Obligation
  const getObligationType = (
    kpi: ContractKPI,
  ): "supplier" | "client" | "mutual" | "unresolved" => {
    const obType = String(
      kpi.party_role ||
      (kpi as any).obligation_type ||
      (kpi as any).party_type ||
      "",
    ).toLowerCase();
    if (obType === "mutual") return "mutual";
    if (obType === "supplier") return "supplier";
    if (obType === "client") return "client";

    const partyStr = String(
      kpi.party ||
      (kpi as any).responsible_party ||
      (kpi as any).business_owner ||
      "",
    ).toLowerCase();
    const quoteStr = String(quoteFor(kpi) || "").toLowerCase();
    const combined = `${partyStr} ${quoteStr}`;

    if (
      /\b(client|customer|operator|buyer|purchaser|owner|company|enterprise|subscriber|lessee|licensee|principal|agency|authority)\b/.test(
        partyStr,
      )
    ) {
      return "client";
    }
    if (
      /\b(supplier|provider|vendor|contractor|managed services provider|seller|developer|manufacturer|subcontractor|lessor|concessionaire|licensor|gnodeb|service provider|partner|consultant|builder|epc)\b/.test(
        partyStr,
      )
    ) {
      return "supplier";
    }
    if (
      /\b(client|customer|operator|buyer|purchaser|owner|company|enterprise|subscriber|lessee|licensee|principal|agency|authority)\b/.test(
        combined,
      ) &&
      /\b(shall pay|shall provide access|shall notify|shall furnish|shall reimburse|shall grant|responsible for providing)\b/.test(
        combined,
      )
    ) {
      return "client";
    }
    return "unresolved";
  };

  // Helper to categorize KPI type
  const getCategory = (kpi: ContractKPI) => {
    const kpiType = String(kpi.kpi_type || "").toLowerCase();
    const recordType = String(kpi.record_type || "").toLowerCase();
    const role = String(kpi.record_role || "").toLowerCase();
    const ruleType = String(
      (kpi as any).rule_type || (kpi as any).rule?.rule_type || "",
    ).toLowerCase();
    if (
      recordType === "supporting_measurement" ||
      role === "primary_kpi" ||
      kpiType === "sla" ||
      kpiType === "performance"
    )
      return "sla";
    if (
      recordType === "financial_consequence" ||
      kpiType === "penalty" ||
      kpi.consequence_value != null
    )
      return "penalty";
    if (
      kpiType === "deadline" ||
      kpiType === "notice" ||
      ruleType === "deadline"
    )
      return "deadline";
    if (!kpiType && (ruleType === "tiered" || ruleType === "threshold"))
      return "sla";
    return "other";
  };

  const getRecordCategory = (kpi: ContractKPI): string => {
    const recordType = String(kpi.record_type || "").toLowerCase();
    switch (recordType) {
      case "fee_schedule": return "fee_schedule";
      case "kpi":
      case "supporting_measurement": return "kpi";
      case "penalty":
      case "financial_consequence": return "penalty";
      case "obligation":
      case "trackable_operational_obligation": return "obligation";
      case "liability_clause": return "liability_clause";
      case "payment_term": return "payment_term";
      case "remedy": return "remedy";
      case "index_clause": return "index_clause";
      case "reference_only":
      case "process_only": return "reference_only";
      default:
        // fallback to existing category logic including deadlines
        return getCategory(kpi);
    }
  };

  const baseFilteredKpis = useMemo(() => {
    return kpis.filter((kpi) => {
      // 1. Status filter
      if (filterStatus === "tracked" && !isKpiTracked(kpi)) return false;
      if (
        filterStatus === "review" &&
        (kpi.status === "approved" || kpi.status === "ignored")
      )
        return false;
      if (filterStatus === "approved" && kpi.status !== "approved") return false;

      // 2. Category filter
      if (filterCategory.length > 0) {
        if (!filterCategory.includes(getRecordCategory(kpi))) {
          return false;
        }
      }

      // 3. Search query filter
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        const nameMatch = (kpi.name || "").toLowerCase().includes(query);
        const idMatch = (kpi.kpi_id || "").toLowerCase().includes(query);
        const sectionMatch = (
          kpi.structural_path ||
          kpi.section_path ||
          kpi.section ||
          ""
        )
          .toLowerCase()
          .includes(query);
        const partyMatch = (kpi.party || (kpi as any).responsible_party || "")
          .toLowerCase()
          .includes(query);
        const quoteMatch = (quoteFor(kpi) || "").toLowerCase().includes(query);
        if (!(nameMatch || idMatch || sectionMatch || partyMatch || quoteMatch))
          return false;
      }

      return true;
    });
  }, [kpis, filterStatus, filterCategory, searchQuery]);

  const supplierCount = useMemo(
    () => baseFilteredKpis.filter((kpi) => getObligationType(kpi) === "supplier").length,
    [baseFilteredKpis],
  );
  const primaryKpiCount = useMemo(
    () => baseFilteredKpis.filter((kpi) => kpi.record_role === "primary_kpi").length,
    [baseFilteredKpis],
  );
  const clientCount = useMemo(
    () => baseFilteredKpis.filter((kpi) => getObligationType(kpi) === "client").length,
    [baseFilteredKpis],
  );
  const mutualCount = useMemo(
    () => baseFilteredKpis.filter((kpi) => getObligationType(kpi) === "mutual").length,
    [baseFilteredKpis],
  );
  const allCount = baseFilteredKpis.length;

  const filteredKpis = useMemo(() => {
    return baseFilteredKpis.filter((kpi) => {
      // 1. Tab filter
      if (activeTab === "supplier" && getObligationType(kpi) !== "supplier")
        return false;
      if (activeTab === "client" && getObligationType(kpi) !== "client")
        return false;
      if (activeTab === "mutual" && getObligationType(kpi) !== "mutual")
        return false;
      return true;
    });
  }, [baseFilteredKpis, activeTab]);

  const totalPages = Math.max(
    1,
    Math.ceil(filteredKpis.length / pagination.itemsPerPage),
  );
  const paginatedKpis = filteredKpis.slice(
    (pagination.currentPage - 1) * pagination.itemsPerPage,
    pagination.currentPage * pagination.itemsPerPage,
  );

  if (!kpis.length) {
    return (
      <div className="flex min-h-[460px] flex-col items-center justify-center rounded-lg border border-gray-200 bg-white px-6 text-center">
        <BarChart3 className="h-8 w-8 text-gray-300" />
        <h2 className="mt-3 text-base font-semibold text-gray-950">
          No trackable obligations yet
        </h2>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PerformanceSummaryCards
        kpis={kpis}
        actualsByKpiId={actualsByKpiId}
        breaches={breaches}
        sourcesByKpiId={sourcesByKpiId}
        sourceConfigs={sourceConfigs}
      />

      <div className="rounded-md border bg-card overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-border bg-[#F9FAFC] p-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-base font-semibold text-foreground">
              Trackable Operational Obligations
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Showing {filteredKpis.length} of {kpis.length} extracted contract
              records ({primaryKpiCount || 0} supporting measurements ·{" "}
              {supplierCount} Supplier · {clientCount} Client · {mutualCount}{" "}
              Mutual).
            </p>
          </div>
          <div className="flex flex-wrap gap-2 items-center">
            {kpis.some(
              (kpi) => kpi.status !== "approved" && kpi.status !== "ignored"
            ) && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 gap-1.5 text-xs"
                  onClick={onAcceptAll}
                >
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Accept All
                </Button>
              )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 gap-1.5 text-xs text-foreground/80"
              onClick={onTrackRecommended}
              disabled={recommendedTrackCount === 0}
            >
              <Play className="h-3.5 w-3.5" />
              Track Recommended
            </Button>
          </div>
        </div>

        {/* Category Tabs & Real-Time Search */}
        <div className="flex flex-col gap-3 p-4 border-b border-border sm:flex-row sm:items-center sm:justify-between bg-background overflow-x-auto">
          <ScrollableTabs
            tabs={[
              { id: "all", label: `All (${allCount})` },
              { id: "supplier", label: `Supplier Obligations (${supplierCount})` },
              { id: "client", label: `Client Obligations (${clientCount})` },
              { id: "mutual", label: `Mutual Obligations (${mutualCount})` },
            ]}
            activeTab={activeTab}
            onTabChange={(id) => {
              setActiveTab(id as any);
              setPagination((p) => ({ ...p, currentPage: 1 }));
            }}
          />

          <div className="flex items-center gap-3 w-full sm:w-auto shrink-0">
            <Select
              value={filterStatus}
              onValueChange={(val) => {
                setFilterStatus(val);
                setPagination((p) => ({ ...p, currentPage: 1 }));
              }}
            >
              <SelectTrigger className="w-[130px] h-8 text-xs font-semibold border-border bg-[#FFFFFF]">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="tracked">Tracked</SelectItem>
                <SelectItem value="review">To Review</SelectItem>
                <SelectItem value="approved">Approved</SelectItem>
              </SelectContent>
            </Select>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  className="w-[170px] h-8 text-xs font-semibold border-border bg-[#FFFFFF] justify-between px-3"
                >
                  <span className="truncate">
                    {filterCategory.length === 0
                      ? "All Categories"
                      : `${filterCategory.length} Selected`}
                  </span>
                  <ChevronDown className="h-4 w-4 opacity-50" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-[170px]">
                {[
                  { value: "fee_schedule", label: "Fee Schedule" },
                  { value: "kpi", label: "KPI" },
                  { value: "obligation", label: "Obligation" },
                  { value: "penalty", label: "Penalty" },
                  { value: "liability_clause", label: "Liability Clause" },
                  { value: "payment_term", label: "Payment Term" },
                  { value: "remedy", label: "Remedy" },
                  { value: "index_clause", label: "Index Clause" },
                  { value: "deadline", label: "Deadline" },
                  { value: "reference_only", label: "Reference Only" },
                ].map((option) => (
                  <DropdownMenuCheckboxItem
                    key={option.value}
                    checked={filterCategory.includes(option.value)}
                    onSelect={(e) => e.preventDefault()}
                    onCheckedChange={(checked) => {
                      setFilterCategory((prev) => {
                        if (checked) {
                          return [...prev, option.value];
                        }
                        return prev.filter((v) => v !== option.value);
                      });
                      setPagination((p) => ({ ...p, currentPage: 1 }));
                    }}
                  >
                    {option.label}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            {(filterStatus !== "all" || filterCategory.length > 0 || searchQuery !== "" || activeTab !== "all") && (
              <Button
                variant="ghost"
                className="h-8 px-2 text-xs text-muted-foreground hover:text-foreground"
                onClick={() => {
                  setFilterStatus("all");
                  setFilterCategory([]);
                  setSearchQuery("");
                  setActiveTab("all");
                  setPagination((p) => ({ ...p, currentPage: 1 }));
                }}
              >
                Clear all
              </Button>
            )}

            <div className="relative flex-1 sm:min-w-[220px]">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-700" />
              <input
                type="text"
                placeholder="Search obligation, section, quote..."
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setPagination((p) => ({ ...p, currentPage: 1 }));
                }}
                className="h-8 w-full rounded-md border border-gray-400 bg-[#FFFFFF] pl-8 pr-3 text-xs text-foreground outline-none focus:border-[#015CA9] focus:ring-1 focus:ring-[#015CA9]"
              />
            </div>
          </div>
        </div>

        <Table>
          <TableHeader>
            <TableRow className="bg-[#FBFCFD] hover:bg-[#FBFCFD]">
              <TableHead className="w-[60px] font-semibold text-foreground/90 text-center">
                S.no.
              </TableHead>
              <TableHead className="w-[280px] font-semibold text-foreground/90">
                Obligation
              </TableHead>
              <TableHead className="font-semibold text-foreground/90">
                Status
              </TableHead>
              <TableHead className="font-semibold text-foreground/90">
                Target / Acceptance
              </TableHead>
              <TableHead className="font-semibold text-foreground/90">
                Sources
              </TableHead>
              <TableHead className="text-right pr-4 font-semibold text-foreground/90">
                Actions
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {paginatedKpis.map((kpi, i) => {
              const index =
                (pagination.currentPage - 1) * pagination.itemsPerPage + i;
              const tracked = isKpiTracked(kpi);
              const obType = getObligationType(kpi);
              const sources = sourcesByKpiId.get(kpi.kpi_id) || [];
              const backfilled = Number(
                kpi.last_tracking_backfill?.created_breach_count || 0,
              );
              const kpiActuals = actualsByKpiId.get(kpi.kpi_id) || [];
              const kpiBreaches = breachByKpiId.get(kpi.kpi_id) || [];
              const latestActual = [...kpiActuals].sort(
                (left, right) =>
                  new Date(actualTimestamp(right) || 0).getTime() -
                  new Date(actualTimestamp(left) || 0).getTime(),
              )[0];
              const latestFlag =
                kpiBreaches.find((breach) => breach.is_breach) ||
                kpiBreaches[0];
              const expanded = expandedKpiId === kpi.kpi_id;
              const editing = editingKpiId === kpi.kpi_id;
              return (
                <React.Fragment key={kpi.kpi_id || `${kpi.name}-${index}`}>
                  <TableRow
                    className={`bg-[#FFFFFF] hover:bg-muted/15 transition-colors cursor-pointer ${expanded ? "bg-muted/15" : ""}`}
                    onClick={() =>
                      setExpandedKpiId(expanded ? null : kpi.kpi_id)
                    }
                  >
                    <TableCell className="align-middle py-4 text-sm font-semibold text-center text-foreground">
                      {index + 1}.
                    </TableCell>
                    <TableCell className="align-middle py-4">
                      <div className="min-w-0 flex-1">
                        <h3 className="line-clamp-2 text-sm font-semibold leading-5 text-foreground">
                          {kpi.name}
                        </h3>
                      </div>
                    </TableCell>
                    <TableCell className="align-middle py-4">
                      <div className="flex flex-wrap items-center gap-1.5">
                        {obType === "supplier" ? (
                          <span className="inline-flex items-center gap-1 rounded-full border border-orange-200 bg-orange-50 px-2 py-0.5 text-[10px] font-semibold text-orange-800">
                            <Truck className="h-3 w-3" />
                            Supplier
                          </span>
                        ) : obType === "client" ? (
                          <span className="inline-flex items-center gap-1 rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-[10px] font-semibold text-indigo-800">
                            <Building2 className="h-3 w-3" />
                            Client
                          </span>
                        ) : obType === "mutual" ? (
                          <span className="inline-flex items-center gap-1 rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-[10px] font-semibold text-violet-800">
                            <Handshake className="h-3 w-3" />
                            Mutual
                          </span>
                        ) : (
                          <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-800">
                            Needs review
                          </span>
                        )}
                        <span
                          className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${kpi.status === "approved" ? "border-green-200 bg-green-50 text-green-700" : statusTone(kpi.status || "review")}`}
                        >
                          {titleCase(kpi.status || "review")}
                        </span>
                        <span
                          className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${tracked ? "border-[#015CA9]/30 bg-[#015CA9]/10 text-[#015CA9]" : "border-gray-200 bg-gray-50 text-gray-600"}`}
                        >
                          {tracked ? "Tracked" : "Deferred"}
                        </span>
                        {isKpiRecommended(kpi) && !tracked && (
                          <span className="rounded-full border border-gray-200 bg-white px-2 py-0.5 text-[10px] font-semibold text-gray-700">
                            Recommended
                          </span>
                        )}
                        {backfilled > 0 && (
                          <span className="rounded-full border border-gray-200 bg-white px-2 py-0.5 text-[10px] font-semibold text-gray-700">
                            {backfilled} backfilled
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="align-middle font-medium text-sm text-foreground/80">
                      {formatKpiValue(kpi)}
                    </TableCell>
                    <TableCell className="align-middle py-4">
                      <div className="flex flex-wrap gap-1">
                        {sources.length ? (
                          sources.slice(0, 3).map((source) => (
                            <span
                              key={source.source_config_id}
                              className="max-w-[128px] truncate rounded-full border border-border bg-background px-2 py-0.5 text-[10px] font-semibold text-muted-foreground"
                            >
                              {source.display_name}
                            </span>
                          ))
                        ) : (
                          <span className="text-xs font-semibold text-muted-foreground">
                            Not configured
                          </span>
                        )}
                        {sources.length > 3 && (
                          <span className="rounded-full border border-border bg-background px-2 py-0.5 text-[10px] text-muted-foreground">
                            +{sources.length - 3}
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="align-middle text-right pr-4">
                      <div className="flex flex-wrap justify-end gap-1.5">
                        {kpi.status !== "approved" && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-8 text-xs border-green-200 hover:bg-green-50 hover:text-green-700"
                            onClick={(e) => {
                              e.stopPropagation();
                              onUpdateKpi(kpi, { status: "approved" });
                            }}
                          >
                            Accept
                          </Button>
                        )}
                        {!tracked && kpi.status === "approved" && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-8 gap-1.5 text-xs border-[#015CA9]/30 hover:bg-[#015CA9]/10 hover:text-[#015CA9]"
                            onClick={(e) => {
                              e.stopPropagation();
                              onUpdateKpi(kpi, {
                                tracking_status: "tracked",
                                is_tracked: true,
                              });
                            }}
                          >
                            <Play className="h-3.5 w-3.5" />
                            Track
                          </Button>
                        )}
                        {!tracked &&
                          kpi.status !== "approved" &&
                          kpi.status !== "ignored" && (
                            <span className="inline-flex h-8 items-center rounded-md border border-gray-200 bg-gray-50 px-2 text-xs font-semibold text-gray-500">
                              Accept to track
                            </span>
                          )}
                        {tracked && kpi.status === "approved" && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-8 text-xs font-semibold"
                            onClick={(e) => {
                              e.stopPropagation();
                              setExpandedKpiId(expanded ? null : kpi.kpi_id);
                            }}
                          >
                            View
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                </React.Fragment>
              );
            })}
          </TableBody>
        </Table>

        {filteredKpis.length > 0 && (
          <div className="flex items-center justify-between border-t border-border/50 p-4">
            <p className="text-sm text-muted-foreground">
              Showing {paginatedKpis.length} of {filteredKpis.length} KPIs
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="h-8"
                onClick={() =>
                  setPagination((p) => ({
                    ...p,
                    currentPage: Math.max(1, p.currentPage - 1),
                  }))
                }
                disabled={pagination.currentPage === 1}
              >
                Previous
              </Button>
              <span className="text-sm font-medium text-foreground">
                Page {pagination.currentPage} of {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                className="h-8"
                onClick={() =>
                  setPagination((p) => ({
                    ...p,
                    currentPage: Math.min(totalPages, p.currentPage + 1),
                  }))
                }
                disabled={pagination.currentPage === totalPages}
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </div>

      <Dialog
        open={!!expandedKpiId}
        onOpenChange={(open) => {
          if (!open) {
            setExpandedKpiId(null);
            setIsContractPaneOpen(false);
          }
        }}
      >
        {(() => {
          const kpi = kpis.find((k) => k.kpi_id === expandedKpiId);
          if (!kpi) return null;
          const kpiActuals = actualsByKpiId.get(kpi.kpi_id) || [];
          const kpiBreaches = breaches.filter((b) => b.kpi_id === kpi.kpi_id);
          const tracked = isKpiTracked(kpi);
          const editing = editingKpiId === kpi.kpi_id;
          const latestActual =
            kpiActuals.length > 0
              ? [...kpiActuals].sort(
                (a, b) =>
                  new Date(actualTimestamp(b) || 0).getTime() -
                  new Date(actualTimestamp(a) || 0).getTime(),
              )[0]
              : null;
          const latestFlag =
            kpiBreaches.length > 0
              ? [...kpiBreaches].sort(
                (a, b) =>
                  new Date(b.created_at || b.timestamp || 0).getTime() -
                  new Date(a.created_at || a.timestamp || 0).getTime(),
              )[0]
              : null;
          const sources = sourcesByKpiId.get(kpi.kpi_id) || [];
          const tierSchedule = tierScheduleFor(kpi);
          const tierColumns = Array.from(
            new Set(tierSchedule.flatMap((tier) => Object.keys(tier))),
          );
          return (
            <DialogContent
              className={
                isContractPaneOpen
                  ? "max-w-7xl w-[82vw] max-h-[88vh] h-[88vh] flex flex-row overflow-hidden rounded-xl p-0 gap-0 border border-gray-200 shadow-sm bg-white"
                  : "max-w-4xl max-h-[90vh] flex flex-col overflow-hidden rounded-xl p-0 gap-0 border border-gray-200 shadow-sm transition-all duration-300 bg-white"
              }
            >
              <DialogHeader className="sr-only">
                <DialogTitle>KPI Details</DialogTitle>
                <DialogDescription>Details for {kpi.name}</DialogDescription>
              </DialogHeader>

              {/* Left Pane: Obligation Details */}
              <div
                className={
                  isContractPaneOpen
                    ? "w-1/2 flex flex-col overflow-hidden border-r border-gray-200 shrink-0 bg-white h-full"
                    : "w-full flex flex-col overflow-hidden h-full"
                }
              >
                <div className="flex flex-wrap items-center justify-between gap-4 border-b border-gray-200 px-6 py-4 pr-12 shrink-0 bg-white">
                  <h4 className="text-sm font-semibold text-gray-900">
                    Obligation Details
                  </h4>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-8 text-xs border-gray-200 hover:border-[#015CA9] hover:text-[#015CA9] rounded-md"
                      onClick={() =>
                        setEditingKpiId(editing ? null : kpi.kpi_id)
                      }
                    >
                      {editing ? "Done Editing" : "Edit KPI"}
                    </Button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8 w-8 p-0 border-gray-200"
                        >
                          <MoreHorizontal className="h-4 w-4 text-[#A7A9AC]" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-40">
                        <DropdownMenuItem
                          onClick={() => onCertifyKpi(kpi, "reviewed")}
                        >
                          <ShieldCheck className="mr-2 h-4 w-4 text-[#015CA9]" />{" "}
                          Review
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => onCertifyKpi(kpi, "certified")}
                        >
                          <BookOpen className="mr-2 h-4 w-4 text-[#015CA9]" />{" "}
                          Certify
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="text-[#EE3224] focus:text-[#EE3224]"
                          onClick={() =>
                            onUpdateKpi(kpi, {
                              status: "ignored",
                              is_tracked: false,
                              tracking_status: "ignored",
                            })
                          }
                        >
                          <AlertCircle className="mr-2 h-4 w-4" /> Remove
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="text-[#A7A9AC] focus:text-[#A7A9AC]"
                          onClick={() => onCertifyKpi(kpi, "deprecated")}
                        >
                          <Clock className="mr-2 h-4 w-4" /> Deprecate
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto px-6 py-6 space-y-6">
                  <div>
                    {editing ? (
                      <div className="grid gap-4 lg:grid-cols-4">
                        <EditableKpiField
                          label="KPI Name"
                          value={kpi.name}
                          onCommit={(value) =>
                            onUpdateKpi(kpi, { name: value })
                          }
                          wide
                        />
                        <EditableKpiField
                          label="Operator"
                          value={kpi.operator || ""}
                          onCommit={(value) =>
                            onUpdateKpi(kpi, { operator: value })
                          }
                        />
                        <EditableKpiField
                          label="Unit"
                          value={kpi.unit || ""}
                          onCommit={(value) =>
                            onUpdateKpi(kpi, { unit: value })
                          }
                        />
                        <EditableKpiField
                          label="Threshold Min"
                          value={kpi.value_min ?? kpi.value ?? ""}
                          onCommit={(value) =>
                            onUpdateKpi(kpi, { value_min: value as any })
                          }
                        />
                        <EditableKpiField
                          label="Threshold Max"
                          value={kpi.value_max ?? ""}
                          onCommit={(value) =>
                            onUpdateKpi(kpi, { value_max: value as any })
                          }
                        />
                        <EditableKpiField
                          label="Responsible Party"
                          value={kpi.party || kpi.responsible_party || ""}
                          onCommit={(value) =>
                            onUpdateKpi(kpi, { party: value })
                          }
                        />
                        <EditableKpiField
                          label="Trigger"
                          value={kpi.trigger_condition || ""}
                          onCommit={(value) =>
                            onUpdateKpi(kpi, { trigger_condition: value })
                          }
                          wide
                        />
                        <EditableKpiField
                          label="Remediation"
                          value={kpi.remediation || ""}
                          onCommit={(value) =>
                            onUpdateKpi(kpi, { remediation: value })
                          }
                          wide
                        />
                      </div>
                    ) : (
                      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                        <DetailTile
                          label="Latest Actual"
                          value={actualLabel(latestActual, kpi)}
                          tone={latestFlag?.is_breach ? "amber" : "gray"}
                        />
                        <DetailTile
                          label="Last Flag"
                          value={
                            latestFlag
                              ? latestFlag.is_breach
                                ? `${severityFor(latestFlag, kpi)} · open`
                                : "Clear"
                              : "No evaluation"
                          }
                          tone={latestFlag?.is_breach ? "amber" : "gray"}
                        />
                        <DetailTile
                          label="Target / Acceptance"
                          value={formatKpiValue(kpi)}
                          tone="blue"
                        />
                        <DetailTile
                          label="Trigger"
                          value={kpi.trigger_condition || "Not specified"}
                          tone="amber"
                        />
                        <DetailTile
                          label="Penalty"
                          value={formatConsequence(kpi)}
                          tone={
                            kpi.consequence_value != null ? "amber" : "gray"
                          }
                        />
                        <DetailTile
                          label="Owner"
                          value={
                            kpi.party ||
                            kpi.responsible_party ||
                            "Not specified"
                          }
                        />
                        <DetailTile
                          label="Party role"
                          value={kpi.party_role || "Needs review"}
                          tone={kpi.party_role ? "gray" : "amber"}
                        />
                        <DetailTile
                          label="Tracking readiness"
                          value={
                            kpi.trackability_status ||
                            kpi.tracking_status ||
                            "Not classified"
                          }
                          tone={
                            kpi.trackability_status === "trackable"
                              ? "blue"
                              : "amber"
                          }
                        />
                      </div>
                    )}

                    {!editing && (
                      <div className="mt-6 grid gap-3 md:grid-cols-2">
                        <DetailTile
                          label="Required action"
                          value={
                            kpi.obligation_action ||
                            kpi.obligation?.action ||
                            kpi.description ||
                            "Not specified"
                          }
                        />
                        <DetailTile
                          label="Scope / dependency"
                          value={
                            kpi.scope ||
                            (kpi.dependencies || []).join(", ") ||
                            "Not specified"
                          }
                        />
                      </div>
                    )}

                    {tierSchedule.length > 0 && (
                      <div className="border-t border-gray-200 pt-6 mt-6">
                        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <h4 className="text-sm font-semibold text-gray-900">
                              Tiered Performance Schedule
                            </h4>
                            <p className="mt-1 text-xs text-[#A7A9AC]">
                              All extracted thresholds and consequences for this
                              KPI.
                            </p>
                          </div>
                          <span className="rounded-full border border-[#015CA9]/30 bg-[#015CA9]/10 px-2.5 py-0.5 text-xs font-semibold text-[#015CA9]">
                            {tierSchedule.length} tier
                            {tierSchedule.length === 1 ? "" : "s"}
                          </span>
                        </div>
                        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
                          <table className="min-w-full text-left text-xs">
                            <thead className="bg-gray-50 text-[10px] font-bold uppercase tracking-wide text-[#A7A9AC] border-b border-gray-200">
                              <tr>
                                {tierColumns.map((column) => (
                                  <th
                                    key={column}
                                    className="whitespace-nowrap px-3.5 py-2.5"
                                  >
                                    {titleCase(column)}
                                  </th>
                                ))}
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-200">
                              {tierSchedule.map((tier, index) => (
                                <tr
                                  key={`${kpi.kpi_id}-tier-${index}`}
                                  className="hover:bg-gray-50 transition-colors"
                                >
                                  {tierColumns.map((column) => (
                                    <td
                                      key={`${index}-${column}`}
                                      className="whitespace-nowrap px-3.5 py-2.5 font-medium text-gray-900"
                                    >
                                      {displayCell(tier[column])}
                                    </td>
                                  ))}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}

                    {/* Contract Evidence */}
                    <div className="border-t border-gray-200 pt-6 mt-6">
                      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                        <h4 className="text-sm font-semibold text-gray-900">
                          Contract Evidence
                        </h4>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className={`h-8 gap-1.5 text-xs transition-all shadow-sm rounded-md font-semibold ${isContractPaneOpen
                            ? "bg-[#015CA9] hover:bg-[#014c8c] text-white border-transparent"
                            : "border-gray-200 text-[#015CA9] hover:border-[#015CA9] hover:bg-[#015CA9]/5"
                            }`}
                          onClick={() =>
                            setIsContractPaneOpen(!isContractPaneOpen)
                          }
                        >
                          <FileText className="h-3.5 w-3.5" />
                          {isContractPaneOpen
                            ? "Close Contract Viewer"
                            : "Refer Contract"}
                        </Button>
                      </div>
                      <div className="space-y-2">
                        <p className="text-xs font-medium text-[#A7A9AC]">
                          {kpi.structural_path ||
                            kpi.section_path ||
                            kpi.section ||
                            "Clause location not captured"}
                        </p>
                        <blockquote className="border-l-4 border-[#015CA9] pl-4 text-sm leading-relaxed text-gray-900 max-h-32 overflow-auto bg-gray-50/60 p-3 rounded-r-md border-y border-r border-gray-200">
                          {quoteFor(kpi) ||
                            kpi.confidence_reason ||
                            kpi.recommendation_reason ||
                            "No source quote captured."}
                        </blockquote>
                      </div>
                    </div>

                    <SlaPolicyStrip kpi={kpi} />
                  </div>
                </div>
              </div>

              {/* Right Pane: Side-by-Side PDF Viewer */}
              {isContractPaneOpen && (
                <div className="w-1/2 flex flex-col bg-white text-gray-900 overflow-hidden max-h-[88vh] border-l border-gray-200 shrink-0 h-full relative">
                  {/* Target Verbatim Clause Highlight Banner */}
                  <div className="p-4 bg-[#015CA9]/5 border-b border-gray-200 shrink-0 space-y-1.5 relative">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5 text-xs font-bold tracking-wide text-[#015CA9] uppercase">
                        <Sparkles className="h-3.5 w-3.5 text-[#015CA9]" />{" "}
                        Target Verbatim Clause Highlight
                      </div>
                      <button
                        type="button"
                        onClick={() => setIsContractPaneOpen(false)}
                        className="text-gray-400 hover:text-gray-700 p-1 rounded-md hover:bg-gray-200/60 transition-colors"
                        title="Close Contract Viewer"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                    <blockquote className="border-l-4 border-[#015CA9] pl-3 py-2 text-xs font-semibold text-gray-900 leading-relaxed bg-white rounded-r-md border border-gray-200 max-h-24 overflow-y-auto font-sans shadow-sm">
                      "{quoteFor(kpi)}"
                    </blockquote>
                  </div>

                  {/* PDF Render Canvas Stream */}
                  <div className="flex-1 w-full h-full relative overflow-hidden bg-white">
                    <PDFViewerDynamic
                      contractId={kpi.contract_id || contractId}
                      searchKey={kpi.kpi_id}
                      searchValue={quoteFor(kpi)}
                      token={token || ""}
                    />
                  </div>
                </div>
              )}
            </DialogContent>
          );
        })()}
      </Dialog>
    </div>
  );
}

type ExtraChartKey =
  | "recoveries"
  | "category"
  | "penalty"
  | "turnaround"
  | "landing"
  | "occasions";

const EXTRA_CHARTS: Array<{ key: ExtraChartKey; label: string }> = [
  { key: "recoveries", label: "Recoveries Pipeline" },
  { key: "category", label: "Breaches by Category" },
  { key: "penalty", label: "Penalty Exposure" },
  { key: "turnaround", label: "B747-200 Turnaround Charge Mix" },
  { key: "landing", label: "Extra Labor Rate: Straight vs Overtime" },
  { key: "occasions", label: "Ancillary Charges Ranked" },
];

function PerformanceSummaryCards({
  kpis,
  actualsByKpiId,
  breaches,
  sourcesByKpiId,
  sourceConfigs,
}: {
  kpis: ContractKPI[];
  actualsByKpiId: Map<string, ContractKPIActual[]>;
  breaches: ContractKPIBreach[];
  sourcesByKpiId: Map<string, KPISourceConfig[]>;
  sourceConfigs: KPISourceConfig[];
}) {
  const tracked = kpis.filter(isKpiTracked);
  const actuals = Array.from(actualsByKpiId.values()).flat();
  const openFlags = breaches.filter(
    (breach) => breach.is_breach && breach.status !== "resolved",
  );
  const resolvedCount = breaches.filter((b) => b.status === "resolved").length;
  const totalExposure = openFlags.reduce(
    (sum, b) => sum + (Number(b.penalty_amount) || 0),
    0,
  );
  const coveragePercent = kpis.length
    ? Math.round((tracked.length / kpis.length) * 100)
    : 0;
  const recoveryRate =
    breaches.length > 0
      ? Math.round((resolvedCount / breaches.length) * 100)
      : 0;
  const typeCounts = kpis.reduce<Record<string, number>>((acc, kpi) => {
    const label = titleCase(kpi.kpi_type || "other");
    acc[label] = (acc[label] || 0) + 1;
    return acc;
  }, {});
  const linkedSourceCount = sourceConfigs.filter(
    (config) =>
      (Array.isArray(config.kpi_bindings) && config.kpi_bindings.length > 0) ||
      (Array.isArray(config.kpi_ids) && config.kpi_ids.length > 0) ||
      config.status === "linked" ||
      config.status === "mapped",
  ).length;
  const [chartsOpen, setChartsOpen] = useState(false);

  return (
    <div className="space-y-5">
      {/* ── Headline KPI Strip ── */}
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <HeadlineCard
          label="Total Penalty Exposure"
          value={totalExposure > 0 ? `${totalExposure.toLocaleString()}` : "—"}
          unit="USD"
          tone={totalExposure > 0 ? "red" : "neutral"}
        />
        <HeadlineCard
          label="Open Contract Breaches"
          value={String(openFlags.length)}
          unit={`of ${breaches.length}`}
          tone={openFlags.length > 0 ? "red" : "green"}
        />
        <HeadlineCard
          label="KPI Coverage"
          value={`${coveragePercent}`}
          unit="%"
          tone="blue"
          detail={`${tracked.length} of ${kpis.length} tracked`}
        />
        <HeadlineCard
          label="Recovery Rate"
          value={breaches.length > 0 ? `${recoveryRate}` : "—"}
          unit="%"
          tone={recoveryRate >= 80 ? "green" : recoveryRate > 0 ? "amber" : "neutral"}
          detail={`${resolvedCount} resolved`}
        />
      </div>

      {/* ── Compliance Status ── */}
      <SectionHeader title="Compliance Status" />
      <div className="grid gap-3 xl:grid-cols-3">
        <section className="group rounded-xl border border-gray-100 bg-white p-5 shadow-sm transition-all duration-200 hover:shadow-md hover:border-gray-200 flex flex-col">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
              Performance Trend
            </h3>
            <span className="inline-flex items-center rounded-md border border-gray-100 bg-gray-50 px-2 py-0.5 text-[10px] font-medium text-gray-500">
              {actuals.length} actuals
            </span>
          </div>
          <div className="flex-1">
            <OverallSparkline actuals={actuals} />
          </div>
          <p className="mt-3 text-[11px] leading-4 text-gray-400">
            Y-axis: recorded actual value per KPI (units vary — SEK, tonnes,
            hours). Gradient = oldest → newest.
          </p>
        </section>
        <section className="group rounded-xl border border-gray-100 bg-white p-5 shadow-sm transition-all duration-200 hover:shadow-md hover:border-gray-200 flex flex-col">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
              KPI Coverage
            </h3>
            <span className="inline-flex items-center rounded-md border border-blue-100 bg-blue-50 px-2 py-0.5 text-[10px] font-medium text-blue-600">
              {tracked.length} of {kpis.length} tracked
            </span>
          </div>
          <div className="flex-1">
            <HorizontalMiniBars
              values={Object.entries(typeCounts).map(([label, value]) => ({
                label,
                value,
              }))}
            />
          </div>
          <p className="mt-3 text-[11px] leading-4 text-gray-400">
            {tracked.length} of {kpis.length} extracted obligations actively
            monitored.
          </p>
        </section>
        <section className="group rounded-xl border border-gray-100 bg-white p-5 shadow-sm transition-all duration-200 hover:shadow-md hover:border-gray-200 flex flex-col">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
              Contract Breaches
            </h3>
            <span
              className={`inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-medium ${openFlags.length
                ? "border border-red-100 bg-red-50 text-red-600"
                : "border border-green-100 bg-green-50 text-green-600"
                }`}
            >
              {openFlags.length} open
            </span>
          </div>
          <div className="flex-1 flex items-center">
            <FlagDonut
              open={openFlags.length}
              clear={Math.max(tracked.length - openFlags.length, 0)}
            />
          </div>
        </section>
      </div>

      {/* ── Financial Exposure ── */}
      {linkedSourceCount > 0 && (
        <div className="space-y-3">
          <button
            type="button"
            onClick={() => setChartsOpen((open) => !open)}
            className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-gray-100 bg-white px-3 py-2.5 text-xs font-semibold text-gray-500 shadow-sm transition-all duration-200 hover:shadow-md hover:border-gray-200 hover:text-gray-700"
          >
            <ChevronDown
              className={`h-4 w-4 transition-transform ${chartsOpen ? "rotate-180" : ""}`}
            />
            {chartsOpen
              ? "Hide financial & rate charts"
              : "Show financial exposure & rate reference charts"}
          </button>
          {chartsOpen && (
            <>
              <SectionHeader title="Financial Exposure" />
              <div className="flex gap-3">
                {(["recoveries", "category", "penalty"] as ExtraChartKey[]).map(
                  (key) => (
                    <section
                      key={key}
                      className="group flex min-h-0 flex-1 flex-col rounded-xl border border-gray-100 bg-white p-5 shadow-sm transition-all duration-200 hover:shadow-md hover:border-gray-200"
                    >
                      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500">
                        {EXTRA_CHARTS.find((c) => c.key === key)?.label}
                      </h3>
                      {key === "recoveries" ? (
                        <RecoveryPipelineChart breaches={breaches} />
                      ) : key === "category" ? (
                        <BreachesByCategoryChart
                          openFlags={openFlags}
                          kpis={kpis}
                        />
                      ) : (
                        <PenaltyExposureChart openFlags={openFlags} />
                      )}
                    </section>
                  ),
                )}
              </div>
              <SectionHeader title="Contract Rate Reference" />
              <div className="flex gap-3">
                {(["turnaround", "landing", "occasions"] as ExtraChartKey[]).map(
                  (key) => (
                    <section
                      key={key}
                      className="group flex min-h-0 flex-1 flex-col rounded-xl border border-gray-100 bg-white p-5 shadow-sm transition-all duration-200 hover:shadow-md hover:border-gray-200"
                    >
                      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500">
                        {EXTRA_CHARTS.find((c) => c.key === key)?.label}
                      </h3>
                      {key === "turnaround" ? (
                        <TurnaroundChargeMixChart kpis={kpis} />
                      ) : key === "landing" ? (
                        <LaborRateEscalationChart kpis={kpis} />
                      ) : (
                        <AncillaryChargesChart kpis={kpis} />
                      )}
                    </section>
                  ),
                )}
              </div>
            </>
          )}
        </div>
      )}
      {linkedSourceCount === 0 && (
        <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50/50 p-6">
          <p className="text-xs font-semibold text-gray-700">
            Link a source to unlock financial exposure &amp; rate charts
          </p>
          <p className="mt-1 text-xs text-gray-500">
            Recoveries pipeline, severity mix, penalty exposure, turnaround
            pricing, extra labor rates, and ancillary charges light up once a
            source is mapped.
          </p>
        </div>
      )}
    </div>
  );
}

function SectionHeader({ title }: { title: string }) {
  return (
    <div className="flex items-center gap-3">
      <h2 className="text-xs font-bold uppercase tracking-wider text-gray-400">
        {title}
      </h2>
      <div className="h-px flex-1 bg-gray-100" />
    </div>
  );
}

function HeadlineCard({
  label,
  value,
  unit,
  tone,
  detail,
}: {
  label: string;
  value: string;
  unit: string;
  tone: "red" | "green" | "blue" | "amber" | "neutral";
  detail?: string;
}) {
  const accent = {
    red: "border-l-red-500",
    green: "border-l-green-500",
    blue: "border-l-blue-500",
    amber: "border-l-amber-500",
    neutral: "border-l-gray-300",
  }[tone];
  const valueColor = {
    red: "text-red-600",
    green: "text-green-600",
    blue: "text-blue-600",
    amber: "text-amber-600",
    neutral: "text-gray-500",
  }[tone];
  return (
    <div
      className={`group rounded-xl border border-gray-100 border-l-[3px] ${accent} bg-white px-4 py-3 shadow-sm transition-all duration-200 hover:shadow-md`}
    >
      <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">
        {label}
      </p>
      <div className="mt-1 flex items-baseline gap-1.5">
        <span className={`text-2xl font-bold tracking-tight ${valueColor}`}>
          {value}
        </span>
        {unit && (
          <span className="text-xs font-medium text-gray-400">{unit}</span>
        )}
      </div>
      {detail && (
        <p className="mt-0.5 text-[11px] text-gray-400">{detail}</p>
      )}
    </div>
  );
}

function RecoveryPipelineChart({
  breaches,
}: {
  breaches: ContractKPIBreach[];
}) {
  const openFlags = breaches.filter(
    (breach) => breach.is_breach && breach.status !== "resolved",
  );
  const counts: Record<string, number> = { open: 0, acknowledged: 0, reminded: 0, escalated: 0, in_action: 0 };
  openFlags.forEach((breach) => {
    const key = String(breach.status || "open");
    counts[key] = (counts[key] || 0) + 1;
  });
  const resolved = breaches.filter((breach) => breach.status === "resolved").length;
  const rows = [
    { label: "Open", value: counts.open, color: "#c2410c" },
    { label: "In Action", value: counts.in_action, color: "#0070f3" },
    { label: "Ack", value: counts.acknowledged || 0, color: "#f97316" },
    { label: "Reminded", value: counts.reminded || 0, color: "#9333ea" },
    { label: "Escalated", value: counts.escalated || 0, color: "#7e22ce" },
    { label: "Resolved", value: resolved, color: "#15803D" },
  ];
  const max = Math.max(...rows.map((row) => row.value), 1);
  const withRemedy = openFlags.filter((breach) => breach.remediation).length;
  const withSla = openFlags.filter((breach) => breach.remediation_sla).length;
  const daysOpen = openFlags
    .map((breach) => {
      const raw = breach.created_at || breach.timestamp;
      const parsed = raw ? Date.parse(String(raw)) : NaN;
      return Number.isFinite(parsed)
        ? Math.max(0, (Date.now() - parsed) / 86400000)
        : null;
    })
    .filter((days): days is number => days != null);
  const avgDays = daysOpen.length
    ? Math.round(daysOpen.reduce((sum, days) => sum + days, 0) / daysOpen.length)
    : 0;
  const oldestDays = daysOpen.length ? Math.round(Math.max(...daysOpen)) : 0;
  return (
    <div>
      <div className="flex items-end justify-between gap-2">
        {rows.map((row) => (
          <div key={row.label} className="flex flex-1 flex-col items-center gap-1.5 group/bar cursor-default">
            <span className="text-sm font-semibold text-gray-900 tabular-nums">{row.value}</span>
            <div className="flex h-24 w-full items-end rounded bg-white/80 backdrop-blur-md border border-black/5 shadow-sm hover:brightness-105 transition-all animate-in fade-in slide-in-from-bottom-4">
              <motion.div
                initial={{ height: 0 }}
                animate={{ height: `${Math.max(6, (row.value / max) * 100)}%` }}
                transition={{ duration: 0.7, ease: "easeOut" }}
                className="w-full rounded transition-all duration-200 group-hover/bar:opacity-80"
                style={{ backgroundColor: row.color }}
              />
            </div>
            <span className="text-[10px] font-medium text-gray-400">{row.label}</span>
          </div>
        ))}
      </div>
      <div className="mt-auto pt-3 grid grid-cols-3 gap-2 text-xs">
        <div className="rounded bg-white/80 backdrop-blur-md border border-black/5 shadow-sm hover:brightness-105 transition-all animate-in fade-in slide-in-from-bottom-4 p-2.5">
          <span className="block text-[10px] font-medium text-gray-400 uppercase tracking-wider font-semibold">Remedies</span>
          <span className="text-sm font-semibold text-gray-900 tracking-wide tabular-nums">
            {withRemedy}/{openFlags.length}
          </span>
        </div>
        <div className="rounded bg-white/80 backdrop-blur-md border border-black/5 shadow-sm hover:brightness-105 transition-all animate-in fade-in slide-in-from-bottom-4 p-2.5">
          <span className="block text-[10px] font-medium text-gray-400 uppercase tracking-wider font-semibold">SLA set</span>
          <span className="text-sm font-semibold text-gray-900 tracking-wide tabular-nums">
            {withSla}/{openFlags.length}
          </span>
        </div>
        <div className="rounded bg-white/80 backdrop-blur-md border border-black/5 shadow-sm hover:brightness-105 transition-all animate-in fade-in slide-in-from-bottom-4 p-2.5">
          <span className="block text-[10px] font-medium text-gray-400 uppercase tracking-wider font-semibold">Flag age</span>
          <span className="text-sm font-semibold text-gray-900 tracking-wide tabular-nums">
            avg {avgDays}d · oldest {oldestDays}d
          </span>
        </div>
      </div>
    </div>
  );
}

function BreachesByCategoryChart({
  openFlags,
  kpis,
}: {
  openFlags: ContractKPIBreach[];
  kpis: ContractKPI[];
}) {
  const kpiById = useMemo(
    () => new Map(kpis.map((kpi) => [kpi.kpi_id, kpi])),
    [kpis],
  );
  const total = openFlags.length;
  const breachesByCategory = openFlags.reduce<
    Record<string, { count: number; hasCritical: boolean; hasHigh: boolean }>
  >((acc, breach) => {
    const kpi = kpiById.get(breach.kpi_id);
    const cat = kpi?.category || breach.source_kpi?.category || "other";
    if (!acc[cat]) acc[cat] = { count: 0, hasCritical: false, hasHigh: false };
    acc[cat].count += 1;
    if (breach.severity === "critical") acc[cat].hasCritical = true;
    if (breach.severity === "high") acc[cat].hasHigh = true;
    return acc;
  }, {});
  const sorted = Object.entries(breachesByCategory)
    .sort((a, b) => b[1].count - a[1].count);
  const maxCount = Math.max(...sorted.map(([, v]) => v.count), 1);
  const formatCategory = (cat: string) =>
    cat
      .replace(/_/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());
  const topCategory = sorted[0];
  const insightText = topCategory
    ? `${formatCategory(topCategory[0])} accounts for ${topCategory[1].count} of ${total} open breaches — the highest concentration of risk.`
    : "No open breaches by category.";
  return (
    <div className="flex flex-1 flex-col">
      <div className="mb-3 flex items-baseline justify-between">
        <span className="text-2xl font-bold text-gray-900 tracking-wide tabular-nums">
          {total}
        </span>
        <span className="text-[11px] text-gray-400">
          {total === 1 ? "flag" : "flags"} by category
        </span>
      </div>
      {sorted.length > 0 ? (
        <div className="flex flex-1 flex-col gap-2.5">
          {sorted.map(([cat, data]) => (
            <div key={cat} className="group/row cursor-default">
              <div className="mb-1 flex items-center justify-between gap-2 text-[11px]">
                <span className="flex items-center gap-1.5 text-gray-500 group-hover/row:text-gray-700 transition-colors">
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{
                      backgroundColor: data.hasCritical
                        ? "#c2410c"
                        : data.hasHigh
                          ? "#f97316"
                          : "#0070f3",
                    }}
                  />
                  {formatCategory(cat)}
                </span>
                <span className="font-semibold text-gray-900 tracking-wide tabular-nums">
                  {data.count}
                </span>
              </div>
              <div className="h-5 overflow-hidden rounded-full bg-white/80 backdrop-blur-md border border-black/5">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{
                    width: `${Math.max(8, (data.count / maxCount) * 100)}%`,
                  }}
                  transition={{ duration: 0.5, ease: "easeOut" }}
                  className="h-5 rounded-full bg-[#0070f3] transition-all duration-200 group-hover/row:bg-[#0051a8]"
                />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex flex-1 items-center justify-center rounded border border-dashed border-gray-200 p-6 text-xs text-gray-400">
          No open breaches.
        </div>
      )}
      <p className="mt-auto pt-3 text-[11px] leading-4 text-gray-400">
        {insightText}
      </p>
    </div>
  );
}

const kpiCodeFor = (kpi: ContractKPI) =>
  kpi.kpi_id.split(":").slice(-1)[0] || kpi.kpi_id;

function TurnaroundChargeMixChart({ kpis }: { kpis: ContractKPI[] }) {
  const byCode = (code: string) =>
    kpis.find((kpi) => kpiCodeFor(kpi)?.trim().toUpperCase() === code);

  const readValue = (kpi?: ContractKPI) => Number((kpi as any)?.value) || 0;

  const bars = [
    { label: "Ramp Handling", value: readValue(byCode("BALTIA-JFK-GHA-001")), color: "#9333ea", hover: "#7e22ce" },
    { label: "Passenger Service", value: readValue(byCode("BALTIA-JFK-GHA-002")), color: "#0070f3", hover: "#0051a8" },
    { label: "Flight Ops/Dispatch", value: readValue(byCode("BALTIA-JFK-GHA-003")), color: "#10b981", hover: "#059669" },
  ].filter((bar) => bar.value > 0);

  const max = Math.max(...bars.map((b) => b.value), 1);
  const barHeight = 200;
  const total = bars.reduce((sum, b) => sum + b.value, 0);

  return (
    <div className="flex h-full flex-col">
      <div className="mb-8 flex items-center justify-between gap-2">
        <span className="text-[11px] text-gray-400">
          USD per B747-200 turnaround, fixed rate by charge category
        </span>
      </div>

      {bars.length ? (
        <div
          className="flex flex-1 items-end justify-around gap-2 pb-6"
          style={{ minHeight: barHeight + 40 }}
        >
          {bars.map((bar) => (
            <div
              key={bar.label}
              className="group/band flex h-full flex-1 cursor-default flex-col items-center justify-end gap-2"
            >
              <span
                className="text-[11px] font-semibold tabular-nums"
                style={{ color: bar.color }}
              >
                {bar.value.toLocaleString()}
              </span>
              <div
                className="flex w-14 items-end rounded-t border border-black/5 bg-white/80 backdrop-blur-md"
                style={{ height: barHeight }}
              >
                <motion.div
                  initial={{ height: 0 }}
                  animate={{ height: `${Math.max(4, (bar.value / max) * barHeight)}px` }}
                  transition={{ duration: 0.5, ease: "easeOut" }}
                  className="w-full rounded-t transition-all duration-200"
                  style={{ backgroundColor: bar.color }}
                />
              </div>
              <span className="mt-2 text-center text-[10px] font-medium text-gray-400">
                {bar.label}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex flex-1 items-center justify-center rounded border border-dashed border-gray-200 p-6 text-xs text-gray-400">
          Turnaround charge KPIs not extracted.
        </div>
      )}

      <p className="mt-auto pt-4 text-[11px] text-gray-400">
        Every B747-200 turnaround bills {total.toLocaleString()} USD across ramp
        handling, passenger service, and flight ops/dispatch combined (Annex B P1.1).
      </p>
    </div>
  );
}

function PenaltyExposureChart({ openFlags }: { openFlags: ContractKPIBreach[] }) {
  const rows = openFlags
    .filter((breach) => breach.penalty_amount)
    .map((breach) => ({
      label: breach.kpi_id.split(":").slice(-1)[0] || "KPI",
      amount: Number(breach.penalty_amount) || 0,
    }))
    .sort((a, b) => b.amount - a.amount);
  const totalExposure = rows.reduce((sum, row) => sum + row.amount, 0);
  const max = Math.max(...rows.map((row) => row.amount), 1);
  return (
    <div>
      <div className="mb-4 rounded bg-white/80 backdrop-blur-md border border-black/5 shadow-sm p-3 text-center">
        <span className="block text-[10px] font-semibold uppercase tracking-wider font-semibold text-[#f97316]">
          Total Exposure
        </span>
        <span className="mt-1 block text-2xl font-bold text-[#c2410c] tabular-nums">
          {totalExposure.toLocaleString()} <span className="text-sm font-medium">USD</span>
        </span>
      </div>
      {rows.length ? (
        <div className="space-y-3">
          {rows.map((row, index) => (
            <div key={row.label} className="group/row cursor-default">
              <div className="mb-1.5 flex justify-between gap-2 text-[11px]">
                <span className="truncate text-gray-500 group-hover/row:text-gray-700 transition-colors">
                  {row.label}
                </span>
                <span className="font-semibold text-gray-900 tracking-wide tabular-nums">
                  {row.amount.toLocaleString()} USD
                </span>
              </div>
              <div className="h-3 overflow-hidden rounded-full bg-slate-100/50">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${Math.max(6, (row.amount / max) * 100)}%` }}
                  transition={{ duration: 0.5, ease: "easeOut" }}
                  className="h-3 rounded-full bg-[#f97316] transition-all duration-200 group-hover/row:bg-[#c2410c]"
                />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded border border-dashed border-gray-200 p-6 text-center text-xs text-gray-400">
          No penalty-bearing breaches in this contract.
        </div>
      )}
      <p className="mt-auto pt-3 text-[11px] leading-4 text-gray-400">
        Per-incident consequence values. Exposure = incident count × per-unit
        rate.
      </p>
    </div>
  );
}

function LaborRateEscalationChart({ kpis }: { kpis: ContractKPI[] }) {
  const byCode = (code: string) =>
    kpis.find((kpi) => kpiCodeFor(kpi)?.trim().toUpperCase() === code);

  const tierValue = (kpi: ContractKPI | undefined, keyword: string) => {
    const entry = (kpi?.target_schedule || []).find((item) =>
      String(item.condition || "").toLowerCase().includes(keyword),
    );
    return Number(entry?.value) || 0;
  };

  const groups = [
    { label: "Ramp/Cleaning", kpi: byCode("BALTIA-JFK-GHA-015") },
    { label: "Passenger Agent", kpi: byCode("BALTIA-JFK-GHA-016") },
    { label: "CTX Bag Runner", kpi: byCode("BALTIA-JFK-GHA-017") },
  ]
    .map((g) => ({
      label: g.label,
      straight: tierValue(g.kpi, "straight"),
      overtime: tierValue(g.kpi, "overtime"),
    }))
    .filter((g) => g.straight > 0 || g.overtime > 0);

  const max = Math.max(...groups.map((g) => Math.max(g.straight, g.overtime)), 1);
  const barHeight = 200;

  return (
    <div className="flex h-full flex-col">
      <div className="mb-8 flex items-center justify-between gap-2">
        <span className="text-[11px] text-gray-400">
          USD/hour, extra labor beyond staffed positions
        </span>
        <span className="flex items-center gap-3 text-[10px] font-medium text-gray-500">
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-sm bg-[#0070f3]" /> Straight Time
          </span>
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-sm bg-[#9333ea]" /> Overtime
          </span>
        </span>
      </div>

      {groups.length ? (
        <div
          className="flex flex-1 items-end justify-between gap-2 pb-6"
          style={{ minHeight: barHeight + 40 }}
        >
          {groups.map((g) => (
            <div
              key={g.label}
              className="group/band flex h-full flex-1 cursor-default flex-col items-center justify-end gap-2"
            >
              <div className="flex h-full items-end justify-center gap-1.5">
                <div className="flex h-full flex-col items-center justify-end gap-1.5">
                  <span className="text-[10px] font-semibold tabular-nums text-[#0070f3]">
                    {g.straight.toLocaleString()}
                  </span>
                  <div
                    className="flex w-9 items-end rounded-t border border-black/5 bg-white/80 backdrop-blur-md"
                    style={{ height: barHeight }}
                  >
                    <motion.div
                      initial={{ height: 0 }}
                      animate={{ height: `${Math.max(4, (g.straight / max) * barHeight)}px` }}
                      transition={{ duration: 0.5, ease: "easeOut" }}
                      className="w-full rounded-t bg-[#0070f3] transition-all duration-200 group-hover/band:bg-[#0051a8]"
                    />
                  </div>
                </div>

                <div className="flex h-full flex-col items-center justify-end gap-1.5">
                  <span className="text-[10px] font-semibold tabular-nums text-[#9333ea]">
                    {g.overtime.toLocaleString()}
                  </span>
                  <div
                    className="flex w-9 items-end rounded-t border border-black/5 bg-white/80 backdrop-blur-md"
                    style={{ height: barHeight }}
                  >
                    <motion.div
                      initial={{ height: 0 }}
                      animate={{ height: `${Math.max(4, (g.overtime / max) * barHeight)}px` }}
                      transition={{ duration: 0.5, ease: "easeOut" }}
                      className="w-full rounded-t bg-[#9333ea] transition-all duration-200 group-hover/band:bg-[#7e22ce]"
                    />
                  </div>
                </div>
              </div>

              <span className="mt-2 text-center text-[10px] font-medium text-gray-400">
                {g.label}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex flex-1 items-center justify-center rounded border border-dashed border-gray-200 p-6 text-xs text-gray-400">
          Extra labor rate KPIs not extracted.
        </div>
      )}

      <p className="mt-auto pt-4 text-[11px] text-gray-400">
        Overtime runs 1.5x straight time across every labor category (Annex B
        P1.4) — the rate Swissport bills when a turnaround needs staff beyond
        the committed manning table.
      </p>
    </div>
  );
}

function ancillaryChargeEntries(kpis: ContractKPI[]) {
  const byCode = (code: string) =>
    kpis.find((kpi) => kpiCodeFor(kpi)?.trim().toUpperCase() === code);
  const entries: Array<{ label: string; value: number }> = [];

  (byCode("BALTIA-JFK-GHA-004")?.target_schedule || []).forEach((entry) => {
    const condition = String(entry.condition || "Deicing fluid");
    entries.push({ label: `Deice fluid — ${condition}`, value: Number(entry.value) || 0 });
  });
  (byCode("BALTIA-JFK-GHA-023")?.target_schedule || []).forEach((entry) => {
    const condition = String(entry.condition || "Heater/AC");
    entries.push({ label: `Heater/AC — ${condition}`, value: Number(entry.value) || 0 });
  });
  const callout = byCode("BALTIA-JFK-GHA-005");
  if (callout) {
    entries.push({ label: "Deice minimum callout charge", value: Number((callout as any).value) || 0 });
  }

  return entries.filter((e) => e.value > 0).sort((a, b) => b.value - a.value);
}

function AncillaryChargesChart({ kpis }: { kpis: ContractKPI[] }) {
  const rows = ancillaryChargeEntries(kpis);
  const max = Math.max(...rows.map((row) => row.value), 1);
  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-2">
        <span className="text-[11px] text-gray-400">
          USD per occasion, sorted by value
        </span>
        <span className="text-[11px] font-semibold text-gray-900 tracking-wide">
          {rows.length} charges
        </span>
      </div>
      {rows.length ? (
        <div className="space-y-3">
          {rows.map((row) => (
            <div key={row.label} className="group/row cursor-default">
              <div className="mb-1.5 flex justify-between gap-2 text-[11px]">
                <span className="truncate text-gray-500 group-hover/row:text-gray-700 transition-colors">
                  {row.label}
                </span>
                <span className="font-semibold text-gray-900 tracking-wide tabular-nums">
                  {row.value.toLocaleString()} USD
                </span>
              </div>
              <div className="h-5 overflow-hidden rounded-full bg-slate-100/50">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${(row.value / max) * 100}%` }}
                  transition={{ duration: 0.5, ease: "easeOut" }}
                  className="h-5 rounded-full bg-[#0070f3] transition-all duration-200 group-hover/row:bg-[#0051a8]"
                />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded border border-dashed border-gray-200 p-6 text-center text-xs text-gray-400">
          No ancillary per-occasion charges found in the register.
        </div>
      )}
    </div>
  );
}

function OverallSparkline({ actuals }: { actuals: ContractKPIActual[] }) {
  const points = chartPointsFor(actuals).slice(-18);
  return (
    <Sparkline
      values={points.length ? points.map((point) => point.value) : [0, 0, 0, 0]}
      labels={points.map((point) => point.xLabel)}
      heightClass="h-36"
      unit="mixed"
    />
  );
}

function HorizontalMiniBars({
  values,
}: {
  values: Array<{ label: string; value: number }>;
}) {
  const rows = values.length
    ? values
    : [{ label: "No extracted KPIs", value: 1 }];
  const max = Math.max(...rows.map((row) => row.value), 1);
  return (
    <div className="space-y-2.5">
      {rows.slice(0, 5).map((row, index) => (
        <div key={row.label} className="group/bar cursor-default">
          <div className="mb-1 flex justify-between gap-2 text-[11px]">
            <span className="truncate text-gray-500 group-hover/bar:text-gray-700 transition-colors">
              {row.label}
            </span>
            <span className="font-semibold text-gray-700 tabular-nums">{row.value}</span>
          </div>
          <div className="h-5 rounded-full bg-gray-100 overflow-hidden">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${Math.max(8, (row.value / max) * 100)}%` }}
              transition={{
                duration: 0.5,
                ease: "easeOut",
              }}
              className="h-5 rounded-full bg-blue-500 transition-all duration-200 group-hover/bar:bg-blue-600"
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function FlagDonut({ open, clear }: { open: number; clear: number }) {
  const total = Math.max(open + clear, 1);
  const openPercent = (open / total) * 100;
  return (
    <div className="flex items-center gap-5">
      <motion.div
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.5, ease: "easeOut" }}
        className="relative h-28 w-28 shrink-0 rounded-full"
        style={{
          background: `conic-gradient(${open > 0 ? "#ef4444" : "#22c55e"} 0 ${openPercent}%, #d1d5db ${openPercent}% 100%)`,
          boxShadow: open > 0 ? "0 0 0 3px rgba(239, 68, 68, 0.08)" : "0 0 0 3px rgba(34, 197, 94, 0.08)",
        }}
      >
        <div className="absolute inset-6 flex items-center justify-center rounded-full bg-white text-lg font-bold text-gray-950 shadow-inner">
          {open}
        </div>
      </motion.div>
      <div className="space-y-2.5 text-xs">
        <div className="flex items-center gap-2.5">
          <span
            className="h-2.5 w-2.5 rounded-full shadow-sm"
            style={{ backgroundColor: open > 0 ? "#ef4444" : "#22c55e" }}
          />
          <span className="text-gray-500">
            Open flags <strong className="text-gray-900">{open}</strong>
          </span>
        </div>
        <div className="flex items-center gap-2.5">
          <span className="h-2.5 w-2.5 rounded-full bg-gray-300" />
          <span className="text-gray-500">
            Clear tracked <strong className="text-gray-900">{clear}</strong>
          </span>
        </div>
      </div>
    </div>
  );
}

function EditableKpiField({
  label,
  value,
  onCommit,
  wide = false,
}: {
  label: string;
  value: string | number | null;
  onCommit: (value: string) => unknown | Promise<unknown>;
  wide?: boolean;
}) {
  const [draft, setDraft] = useState(String(value ?? ""));

  useEffect(() => {
    setDraft(String(value ?? ""));
  }, [value]);

  const commit = () => {
    if (draft !== String(value ?? "")) void onCommit(draft);
  };

  return (
    <label
      className={`block rounded-md border border-gray-200 bg-white px-3 py-2 ${wide ? "lg:col-span-2" : ""}`}
    >
      <span className="text-[10px] font-bold uppercase tracking-wide text-gray-500">
        {label}
      </span>
      <input
        value={draft}
        inputMode={label.toLowerCase().includes("threshold") ? "decimal" : undefined}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            event.currentTarget.blur();
          }
        }}
        aria-label={label}
        className="mt-1 h-8 w-full border-0 bg-transparent p-0 text-sm font-semibold text-gray-900 outline-none focus:ring-0"
      />
    </label>
  );
}

function KpiHistoryChart({
  kpi,
  actuals,
  breaches,
}: {
  kpi: ContractKPI;
  actuals: ContractKPIActual[];
  breaches: ContractKPIBreach[];
}) {
  const points = chartPointsFor(actuals);
  const latestBreach = breaches.find((breach) => breach.is_breach);
  return (
    <section className="rounded bg-white/80 backdrop-blur-md border border-black/5 shadow-sm hover:brightness-105 transition-all animate-in fade-in slide-in-from-bottom-4 p-4">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h4 className="text-sm font-semibold text-gray-900 tracking-wide">
            Tracked Performance
          </h4>
          <p className="mt-1 text-xs text-gray-500">
            Historical actuals against the contract threshold.
          </p>
        </div>
        <Pill tone={latestBreach ? "red" : "emerald"}>
          {latestBreach ? "Flagged" : "Monitoring"}
        </Pill>
      </div>
      <Sparkline
        values={points.length ? points.map((point) => point.value) : []}
        labels={points.map((point) => point.xLabel)}
        threshold={toNumber(kpi.value_min ?? kpi.value)}
        heightClass="h-44"
      />
      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        <DetailTile label="Target" value={formatKpiValue(kpi)} tone="blue" />
        <DetailTile
          label="Latest"
          value={
            actuals.length
              ? actualLabel(
                [...actuals].sort(
                  (left, right) =>
                    new Date(actualTimestamp(right) || 0).getTime() -
                    new Date(actualTimestamp(left) || 0).getTime(),
                )[0],
                kpi,
              )
              : "No actual"
          }
        />
        <DetailTile label="Samples" value={`${actuals.length}`} />
      </div>
    </section>
  );
}

function Sparkline({
  values,
  labels,
  threshold,
  heightClass,
  unit,
}: {
  values: number[];
  labels?: string[];
  threshold?: number | null;
  heightClass: string;
  unit?: string;
}) {
  const data =
    values.length >= 2
      ? values
      : values.length === 1
        ? [values[0], values[0]]
        : [0, 0];
  const thresholdValue = threshold ?? undefined;
  const min = Math.min(...data, thresholdValue ?? data[0], 0);
  const max = Math.max(...data, thresholdValue ?? data[0], 1);
  const range = Math.max(max - min, 1);
  const coords = data
    .map((value, index) => {
      const x = (index / Math.max(data.length - 1, 1)) * 320;
      const y = 140 - ((value - min) / range) * 110;
      return `${x},${y}`;
    })
    .join(" ");
  const thresholdY =
    thresholdValue == null
      ? null
      : 140 - ((thresholdValue - min) / range) * 110;
  const gradId = `sp-${unit || "def"}`;

  return (
    <div
      className={`${heightClass} rounded-lg border border-gray-100 bg-gradient-to-br from-gray-50/50 to-white p-3`}
    >
      {values.length ? (
        <svg viewBox="0 0 320 170" className="h-full w-full overflow-visible">
          <defs>
            <linearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.6" />
              <stop offset="100%" stopColor="#3b82f6" />
            </linearGradient>
            <linearGradient id={`${gradId}-a`} x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.06" />
              <stop offset="100%" stopColor="#3b82f6" stopOpacity="0.01" />
            </linearGradient>
          </defs>
          <line x1="0" y1="140" x2="320" y2="140" stroke="#e5e7eb" strokeWidth="0.5" />
          {[0, 1, 2, 3].map((i) => {
            const yPos = 140 - (i / 3) * 110;
            const val = min + (i / 3) * range;
            return (
              <g key={i}>
                <line x1="0" y1={yPos} x2="320" y2={yPos} stroke="#f9fafb" strokeWidth="0.5" />
                <text x="-2" y={yPos + 3} textAnchor="end" fill="#d1d5db" fontSize="8" fontFamily="system-ui">
                  {Math.round(val).toLocaleString()}
                </text>
              </g>
            );
          })}
          {thresholdY != null && (
            <>
              <line
                x1="0"
                y1={thresholdY}
                x2="320"
                y2={thresholdY}
                stroke="#3b82f6"
                strokeDasharray="6 4"
                strokeWidth="0.8"
                strokeOpacity="0.4"
              />
              <rect x="2" y={Math.max(8, thresholdY - 14)} width="52" height="13" rx="3" fill="#eff6ff" fillOpacity="0.9" />
              <text
                x="5"
                y={Math.max(18, thresholdY - 4)}
                fill="#1d4ed8"
                fontSize="8"
                fontWeight="500"
                fontFamily="system-ui"
              >
                target {thresholdValue?.toLocaleString()}
              </text>
            </>
          )}
          {data.length > 1 && (
            <motion.polygon
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 1, delay: 0.5 }}
              points={`0,140 ${coords} 320,140`}
              fill={`url(#${gradId}-a)`}
            />
          )}
          <motion.polyline
            initial={{ pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: 1.5, ease: "easeInOut" }}
            points={coords}
            fill="none"
            stroke={`url(#${gradId})`}
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {data.map((value, index) => {
            const [cx, cy] = coords.split(" ")[index].split(",").map(Number);
            return (
              <motion.g key={`${value}-${index}`}>
                <motion.circle
                  cx={cx}
                  cy={cy}
                  r="5"
                  fill="white"
                  stroke="#3b82f6"
                  strokeWidth="2"
                  initial={{ scale: 0, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ duration: 0.3, delay: 0.5 }}
                />
                <motion.circle
                  cx={cx}
                  cy={cy}
                  r="2"
                  fill="#3b82f6"
                  initial={{ scale: 0, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ duration: 0.3, delay: 0.6 }}
                />
              </motion.g>
            );
          })}
          {labels?.length ? (
            <text x="0" y="164" fill="#9ca3af" fontSize="9" fontFamily="system-ui">
              {labels[0]}
            </text>
          ) : null}
          {labels?.length && labels.length > 1 ? (
            <text x="320" y="164" textAnchor="end" fill="#9ca3af" fontSize="9" fontFamily="system-ui">
              {labels[labels.length - 1]}
            </text>
          ) : null}
        </svg>
      ) : (
        <div className="flex h-full items-center justify-center text-sm text-gray-400">
          No actual history yet.
        </div>
      )}
      {unit && (
        <div className="mt-1 flex items-center justify-end gap-1.5">
          <svg viewBox="0 0 32 8" className="h-2 w-8">
            <defs>
              <linearGradient id={`${gradId}-l`} x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.6" />
                <stop offset="100%" stopColor="#3b82f6" />
              </linearGradient>
            </defs>
            <rect x="0" y="2" width="32" height="4" rx="2" fill={`url(#${gradId}-l)`} />
          </svg>
          <span className="text-[9px] text-gray-400">oldest → newest</span>
        </div>
      )}
    </div>
  );
}

function KpiActualHistory({
  kpi,
  actuals,
}: {
  kpi: ContractKPI;
  actuals: ContractKPIActual[];
}) {
  const rows = [...actuals].sort(
    (left, right) =>
      new Date(actualTimestamp(right) || 0).getTime() -
      new Date(actualTimestamp(left) || 0).getTime(),
  );
  return (
    <section className="rounded-lg border border-gray-200 bg-white">
      <div className="border-b border-gray-100 px-4 py-3">
        <h4 className="text-sm font-semibold text-gray-950">
          Historical Actual Logs
        </h4>
        <p className="mt-1 text-xs text-gray-500">
          Stored actuals for this tracked KPI.
        </p>
      </div>
      {!rows.length ? (
        <div className="px-4 py-10 text-center text-sm text-gray-400">
          No actual logs recorded yet.
        </div>
      ) : (
        <div className="max-h-[240px] overflow-auto">
          <table className="min-w-full text-left text-xs">
            <thead className="sticky top-0 bg-gray-50 text-[10px] font-bold uppercase tracking-wide text-gray-400">
              <tr>
                <th className="px-3 py-2">Actual</th>
                <th className="px-3 py-2">Source</th>
                <th className="px-3 py-2">Timestamp</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((actual) => (
                <tr
                  key={
                    actual.actual_id ||
                    `${actual.kpi_id}-${actualTimestamp(actual)}`
                  }
                >
                  <td className="px-3 py-2 font-mono text-gray-900">
                    {actualLabel(actual, kpi)}
                  </td>
                  <td className="max-w-[160px] truncate px-3 py-2 text-gray-600">
                    {humanizeSourceLabel(actual.source)}
                  </td>
                  <td className="px-3 py-2 text-gray-500">
                    {formatDateTime(actualTimestamp(actual))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function KpiBreachStrip({
  kpi,
  breaches,
}: {
  kpi: ContractKPI;
  breaches: ContractKPIBreach[];
}) {
  if (breaches.length === 0) {
    return null;
  }
  return (
    <div className="mt-6">
      <h5 className="mb-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
        Compliance Evaluations
      </h5>
      <RecordPreviewTable rows={breaches} empty="No evaluations" />
    </div>
  );
}

function SlaPolicyStrip({ kpi }: { kpi: ContractKPI }) {
  const businessHoursEnabled = Boolean(
    kpi.business_hours?.enabled || kpi.business_hours?.business_days_only,
  );
  const blackoutCount = Array.isArray(kpi.blackout_windows)
    ? kpi.blackout_windows.length
    : 0;
  const lockDays = kpi.reporting_lock?.lock_after_days;
  const errorBudget = kpi.error_budget || {};
  const hasPolicy =
    businessHoursEnabled ||
    blackoutCount ||
    lockDays ||
    kpi.missing_data_policy ||
    Object.keys(errorBudget).length;
  if (!hasPolicy) return null;
  const budgetText = Object.keys(errorBudget).length
    ? `${errorBudget.consumed ?? 0}/${errorBudget.budget ?? errorBudget.allowed ?? "budget"}`
    : "Not configured";
  return (
    <details className="border-t border-border pt-6 mt-6 group">
      <summary className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-foreground hover:text-muted-foreground list-none [&::-webkit-details-marker]:hidden">
        <ChevronDown className="h-4 w-4 transition-transform group-open:-rotate-180" />
        Advanced SLA/SLO Policy
      </summary>
      <div className="mt-4 grid gap-x-8 gap-y-6 grid-cols-2 xl:grid-cols-5 pl-6">
        <DetailTile
          label="Business Hours"
          value={
            businessHoursEnabled
              ? `${kpi.business_hours?.start || "09:00"}-${kpi.business_hours?.end || "17:00"}`
              : "Calendar time"
          }
          tone={businessHoursEnabled ? "blue" : "gray"}
        />
        <DetailTile
          label="Blackouts"
          value={
            blackoutCount
              ? `${blackoutCount} window${blackoutCount === 1 ? "" : "s"}`
              : "None"
          }
          tone={blackoutCount ? "amber" : "gray"}
        />
        <DetailTile
          label="Reporting Lock"
          value={
            lockDays
              ? `${lockDays} day${Number(lockDays) === 1 ? "" : "s"}`
              : "Unlocked"
          }
        />
        <DetailTile
          label="Missing Data"
          value={titleCase(kpi.missing_data_policy || "flag missing evidence")}
          tone="amber"
        />
        <DetailTile
          label="Error Budget"
          value={budgetText}
          tone={Object.keys(errorBudget).length ? "blue" : "gray"}
        />
      </div>
    </details>
  );
}

function DetailTile({
  label,
  value,
  tone = "gray",
}: {
  label: string;
  value: string;
  tone?: "gray" | "blue" | "amber";
}) {
  const textColor = {
    gray: "text-foreground",
    blue: "text-[#015CA9]",
    amber: "text-amber-700",
  }[tone];
  return (
    <div className="min-w-0 flex flex-col gap-1">
      <p className="text-[13px] font-medium text-muted-foreground">{label}</p>
      <p className={`text-xs font-semibold break-words whitespace-normal leading-relaxed ${textColor}`}>{value}</p>
    </div>
  );
}

function displayCell(value: any) {
  if (value == null || value === "") return "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function previewColumns(rows: Array<Record<string, any>>) {
  const preferred = [
    "row",
    "kpi_id",
    "kpi_name",
    "actual_value",
    "value",
    "unit",
    "timestamp",
    "period",
    "source_record_id",
    "record_id",
    "reason",
    "actual_id",
    "status",
  ];
  const keys = new Set<string>();
  rows
    .slice(0, 8)
    .forEach((row) => Object.keys(row || {}).forEach((key) => keys.add(key)));
  const ordered = preferred.filter((key) => keys.has(key));
  Array.from(keys).forEach((key) => {
    if (!ordered.includes(key) && ordered.length < 7) ordered.push(key);
  });
  return ordered.length ? ordered : preferred.slice(0, 5);
}

function RecordPreviewTable({
  rows,
  empty,
}: {
  rows: Array<Record<string, any>>;
  empty: string;
}) {
  if (!rows.length) {
    return (
      <div className="rounded-md border border-dashed border-gray-200 bg-white px-3 py-4 text-sm text-gray-400">
        {empty}
      </div>
    );
  }
  const columns = previewColumns(rows);
  return (
    <div className="max-h-64 overflow-auto rounded-md border border-gray-200 bg-white">
      <table className="min-w-full text-left text-xs">
        <thead className="sticky top-0 bg-gray-50 text-[10px] font-bold uppercase tracking-wide text-gray-400">
          <tr>
            {columns.map((column) => (
              <th key={column} className="px-3 py-2">
                {column.replace(/_/g, " ")}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {rows.slice(0, 50).map((row, rowIndex) => (
            <tr
              key={`${row.actual_id || row.source_record_id || row.record_id || rowIndex}`}
              className="bg-white"
            >
              {columns.map((column) => (
                <td
                  key={column}
                  className="max-w-[220px] truncate px-3 py-2 text-gray-700"
                  title={displayCell(row[column])}
                >
                  {displayCell(row[column])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > 50 && (
        <div className="border-t border-gray-100 px-3 py-2 text-xs text-gray-400">
          Showing 50 of {rows.length} rows.
        </div>
      )}
    </div>
  );
}

function RunPreviewBlock({
  title,
  rows,
  empty,
}: {
  title: string;
  rows: Array<Record<string, any>>;
  empty: string;
}) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2">
        <p className="text-[10px] font-bold uppercase tracking-wide text-gray-400">
          {title}
        </p>
        <span className="text-xs font-semibold text-gray-500">
          {rows.length}
        </span>
      </div>
      <RecordPreviewTable rows={rows} empty={empty} />
    </div>
  );
}

function SourceKpiBindingEditor({
  config,
  kpis,
  selectedBindingKpiId,
  disabled,
  onSelectBinding,
  onToggleSourceKpi,
  onUpdateBinding,
  onUpdateSource,
}: {
  config: KPISourceConfig;
  kpis: ContractKPI[];
  selectedBindingKpiId?: string | null;
  disabled: boolean;
  onSelectBinding: (kpiId: string) => void;
  onToggleSourceKpi: (
    config: KPISourceConfig,
    kpi: ContractKPI,
  ) => void | Promise<void>;
  onUpdateBinding: (
    config: KPISourceConfig,
    binding: KPISourceBinding,
  ) => void | Promise<void>;
  onUpdateSource: (
    config: KPISourceConfig,
    updates: Partial<KPISourceConfig>,
  ) => void | Promise<KPISourceConfig | null>;
}) {
  const [searchQuery, setSearchQuery] = useState("");
  const [suggestedKpiIds, setSuggestedKpiIds] = useState<string[]>([]);

  if (!kpis.length) {
    return (
      <div className="rounded-md border border-dashed border-gray-200 bg-gray-50 px-3 py-4 text-sm text-gray-500">
        No obligation records available to assign.
      </div>
    );
  }

  const bindings = bindingsForSource(config, kpis);
  const enabledCount = bindings.filter((b) => b.enabled !== false).length;

  const filtered = kpis
    .map((kpi, idx) => ({ kpi, idx }))
    .filter(({ kpi }) => {
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();
      return (
        kpi.name.toLowerCase().includes(q) ||
        (kpi.kpi_type || "").toLowerCase().includes(q)
      );
    });

  const linkAll = async () => {
    const allKpiIds = kpis.map((k) => k.kpi_id);
    const newBindings = kpis.map((kpi, idx) => ({
      binding_id: sourceBindingId(config.source_config_id, kpi.kpi_id, idx + 1),
      kpi_id: kpi.kpi_id,
      enabled: true,
      field_mappings: [],
      aggregation: "latest",
    }));
    await onUpdateSource(config, {
      kpi_ids: allKpiIds,
      kpi_bindings: newBindings,
      status: "mapped",
      enabled: true,
    });
  };

  const unlinkAll = async () => {
    const newBindings = bindings.map((b) => ({ ...b, enabled: false }));
    await onUpdateSource(config, {
      kpi_ids: [],
      kpi_bindings: newBindings,
    });
  };

  const smartMatch = async () => {
    const sourceLabel =
      `${config.display_name || ""} ${config.source_type || ""}`.toLowerCase();
    const schemaFields = (config.schema_fields || [])
      .map((field) => (typeof field === "string" ? field : field?.name))
      .filter(Boolean)
      .map((field) => String(field).toLowerCase());
    const stopWords = new Set([
      "the",
      "and",
      "for",
      "with",
      "from",
      "service",
      "source",
      "actual",
      "value",
      "data",
      "metric",
      "kpi",
      "upload",
      "feed",
      "workbook",
      "csv",
      "xlsx",
      "json",
      "xml",
      "manual",
    ]);
    const words = (value: string) =>
      value
        .replace(/[^a-z0-9]+/g, " ")
        .split(/\s+/)
        .filter((word) => word.length > 2 && !stopWords.has(word));
    const sourceTerms = words(sourceLabel);
    const fieldTerms = schemaFields.flatMap(words);
    const uniqueTerms = new Set([...sourceTerms, ...fieldTerms]);

    const scored = kpis.map((kpi) => {
      const kpiText =
        `${kpi.name} ${kpi.kpi_id} ${kpi.description || ""} ${kpi.structural_path || kpi.section_path || kpi.section || ""} ${quoteFor(kpi)}`.toLowerCase();
      const kpiTerms = new Set(words(kpiText));
      let score = 0;
      uniqueTerms.forEach((term) => {
        if (kpiTerms.has(term)) score += fieldTerms.includes(term) ? 2 : 1;
      });
      if (
        schemaFields.some(
          (field) =>
            field === kpi.kpi_id.toLowerCase() ||
            field.includes(kpi.kpi_id.toLowerCase()),
        )
      )
        score += 5;
      return { id: kpi.kpi_id, score };
    });
    const nextSuggestions = scored
      .filter((item) => item.score >= 2)
      .sort((left, right) => right.score - left.score)
      .map((item) => item.id);
    setSuggestedKpiIds(nextSuggestions);
  };

  const applySuggestedMatches = async () => {
    const matched = new Set(suggestedKpiIds);
    const newBindings = kpis.map((kpi, idx) => ({
      binding_id: sourceBindingId(config.source_config_id, kpi.kpi_id, idx + 1),
      kpi_id: kpi.kpi_id,
      enabled: matched.has(kpi.kpi_id),
      field_mappings:
        bindings.find((binding) => binding.kpi_id === kpi.kpi_id)
          ?.field_mappings || [],
      aggregation:
        bindings.find((binding) => binding.kpi_id === kpi.kpi_id)
          ?.aggregation || "latest",
    }));
    await onUpdateSource(config, {
      kpi_ids: suggestedKpiIds,
      kpi_bindings: newBindings,
      status: suggestedKpiIds.length ? "mapped" : "draft",
    });
    setSuggestedKpiIds([]);
  };

  return (
    <div className="space-y-2">
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            disabled={disabled}
            onClick={smartMatch}
            className="rounded-md border border-cs-primary/30 bg-cs-primary/5 px-2.5 py-1 text-[11px] font-semibold text-cs-primary hover:bg-cs-primary/10 disabled:opacity-40"
          >
            Suggest Matches
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={linkAll}
            className="rounded-md border border-gray-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-40"
          >
            Link All ({kpis.length})
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={unlinkAll}
            className="rounded-md border border-gray-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-gray-500 hover:bg-gray-50 disabled:opacity-40"
          >
            Unlink All
          </button>
          <span className="ml-1 text-xs font-semibold text-gray-400">
            {enabledCount} linked
          </span>
        </div>

        {suggestedKpiIds.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-900">
            <span>
              <strong>{suggestedKpiIds.length}</strong> likely match
              {suggestedKpiIds.length === 1 ? "" : "es"} found from source
              fields and names. Review the checked rows, then apply.
            </span>
            <button
              type="button"
              disabled={disabled}
              onClick={() => void applySuggestedMatches()}
              className="rounded-md bg-cs-primary px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-cs-primary/90 disabled:opacity-40"
            >
              Apply suggestions
            </button>
          </div>
        )}
        <input
          type="text"
          placeholder="Search obligations..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="h-7 w-44 rounded-md border border-gray-200 bg-white px-2 text-xs text-gray-800 placeholder:text-gray-400"
        />
      </div>

      {/* Clean checklist */}
      <div className="max-h-[400px] overflow-y-auto rounded-md border border-gray-200">
        {filtered.map(({ kpi, idx }) => {
          const binding = bindings[idx];
          const isEnabled = binding.enabled !== false;
          const kpiType = String(
            kpi.kpi_type || (kpi as any).rule_type || "",
          ).toLowerCase();
          const typeBadge =
            kpiType === "sla" || kpiType === "performance"
              ? "SLA"
              : kpiType === "penalty"
                ? "Penalty"
                : kpiType === "deadline" || kpiType === "notice"
                  ? "Deadline"
                  : "KPI";

          return (
            <div
              key={kpi.kpi_id}
              className={`flex items-center gap-3 border-b border-gray-100 px-3 py-2 last:border-b-0 ${isEnabled ? "bg-white" : "bg-gray-50/50"}`}
            >
              <input
                type="checkbox"
                checked={isEnabled}
                disabled={disabled}
                onChange={() => {
                  onSelectBinding(kpi.kpi_id);
                  void onToggleSourceKpi(config, kpi);
                }}
                className="h-4 w-4 shrink-0 rounded border-gray-300 text-cs-primary focus:ring-cs-primary"
              />
              <div className="min-w-0 flex-1">
                <p
                  className={`truncate text-xs font-semibold ${isEnabled ? "text-gray-900" : "text-gray-500"}`}
                >
                  {kpi.name}
                </p>
                {(kpi as any).target_value != null && (
                  <p className="mt-0.5 truncate text-[11px] text-gray-400">
                    Target: {formatKpiValue(kpi)}
                  </p>
                )}
              </div>
              <span className="shrink-0 rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-[10px] font-semibold text-gray-500">
                {typeBadge}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const SEEDED_DEMO_ROWS: Record<string, Array<Record<string, any>>> = {
  csv: [
    { kpi_code: "SGHA-1.1-LANDING", kpi_name: "Landing Charge", actual_value: 2850.00, mtow_tonnes: 22, timestamp: "2025-11-15T09:00:00", event_id: "csv-ARN-SGHA-1.1-LANDING-01", unit: "SEK total invoiced (rate schedule: max(77*MTOW,655) under 25t, 1193+123*MTOW at/above)", period: "2025-11", airport_iata_code: "ARN", airport_name: "Stockholm Arlanda Airport", airline_iata_code: "SK", airline_name: "SAS Scandinavian Airlines", flight_number: "SK410", terminal: "T5", stand: "12", supplier: "SGA", source_type: "csv" },
    { kpi_code: "SGHA-1.1-LANDING", kpi_name: "Landing Charge", actual_value: 3120.50, mtow_tonnes: 24, timestamp: "2025-11-20T10:30:00", event_id: "csv-ARN-SGHA-1.1-LANDING-02", unit: "SEK total invoiced (rate schedule: max(77*MTOW,655) under 25t, 1193+123*MTOW at/above)", period: "2025-11", airport_iata_code: "ARN", airport_name: "Stockholm Arlanda Airport", airline_iata_code: "SK", airline_name: "SAS Scandinavian Airlines", flight_number: "SK418", terminal: "T5", stand: "14", supplier: "SGA", source_type: "csv" },
    { kpi_code: "SGHA-1.1-LANDING", kpi_name: "Landing Charge", actual_value: 4350.00, mtow_tonnes: 27, timestamp: "2025-12-01T08:15:00", event_id: "csv-CPH-SGHA-1.1-LANDING-03", unit: "SEK total invoiced (rate schedule: max(77*MTOW,655) under 25t, 1193+123*MTOW at/above)", period: "2025-12", airport_iata_code: "CPH", airport_name: "Copenhagen Airport", airline_iata_code: "SK", airline_name: "SAS Scandinavian Airlines", flight_number: "SK429", terminal: "T3", stand: "22", supplier: "SGA", source_type: "csv" },
    { kpi_code: "SGHA-1.3-PASSENGER", kpi_name: "Passenger Charge", actual_value: 185.00, timestamp: "2025-11-15T09:00:00", event_id: "csv-ARN-SGHA-1.3-PASSENGER-01", unit: "SEK per departing passenger", period: "2025-11", airport_iata_code: "ARN", airport_name: "Stockholm Arlanda Airport", airline_iata_code: "SK", airline_name: "SAS Scandinavian Airlines", flight_number: "SK410", terminal: "T5", stand: "12", supplier: "SGA", source_type: "csv" },
    { kpi_code: "SGHA-1.3-PASSENGER", kpi_name: "Passenger Charge", actual_value: 192.00, timestamp: "2025-11-20T10:30:00", event_id: "csv-ARN-SGHA-1.3-PASSENGER-02", unit: "SEK per departing passenger", period: "2025-11", airport_iata_code: "ARN", airport_name: "Stockholm Arlanda Airport", airline_iata_code: "SK", airline_name: "SAS Scandinavian Airlines", flight_number: "SK418", terminal: "T5", stand: "14", supplier: "SGA", source_type: "csv" },
    { kpi_code: "SGHA-1.5-PARKING", kpi_name: "Apron Parking Charge", actual_value: 4200.00, mtow_tonnes: 22, hours_parked: 44, days_parked: 2, timestamp: "2025-11-15T09:00:00", event_id: "csv-ARN-SGHA-1.5-PARKING-01", unit: "SEK total (MTOW * days * 32, min 249)", period: "2025-11", airport_iata_code: "ARN", airport_name: "Stockholm Arlanda Airport", airline_iata_code: "SK", airline_name: "SAS Scandinavian Airlines", flight_number: "SK410", terminal: "T5", stand: "12", supplier: "SGA", source_type: "csv" },
    { kpi_code: "SGHA-1.5-PARKING", kpi_name: "Apron Parking Charge", actual_value: 3800.00, mtow_tonnes: 20, hours_parked: 30, days_parked: 2, timestamp: "2025-12-01T08:15:00", event_id: "csv-CPH-SGHA-1.5-PARKING-02", unit: "SEK total (MTOW * days * 32, min 249)", period: "2025-12", airport_iata_code: "CPH", airport_name: "Copenhagen Airport", airline_iata_code: "SK", airline_name: "SAS Scandinavian Airlines", flight_number: "SK429", terminal: "T3", stand: "22", supplier: "SGA", source_type: "csv" },
    { kpi_code: "SGHA-1.1-LANDING", kpi_name: "Landing Charge", actual_value: 2990.00, mtow_tonnes: 23, timestamp: "2025-12-05T11:00:00", event_id: "csv-OSL-SGHA-1.1-LANDING-04", unit: "SEK total invoiced (rate schedule: max(77*MTOW,655) under 25t, 1193+123*MTOW at/above)", period: "2025-12", airport_iata_code: "OSL", airport_name: "Oslo Airport", airline_iata_code: "SK", airline_name: "SAS Scandinavian Airlines", flight_number: "SK433", terminal: "T1", stand: "08", supplier: "SGA", source_type: "csv" },
  ],
  json: [
    { kpi_code: "SGHA-2.3-PASSENGER-SERVICES", kpi_name: "Passenger Services Turnaround Rate", measurement: 3051.00, recorded_at: "2025-11-15T09:00:00", record_id: "json-ARN-SGHA-2.3-PASSENGER-01", unit: "SEK per turnaround", period: "2025-11", airport_iata_code: "ARN", airport_name: "Stockholm Arlanda Airport", airline_iata_code: "SK", airline_name: "SAS Scandinavian Airlines", flight_number: "SK410", terminal: "T5", stand: "12", supplier: "Swedavia", source_type: "json" },
    { kpi_code: "SGHA-2.3-PASSENGER-SERVICES", kpi_name: "Passenger Services Turnaround Rate", measurement: 3538.00, recorded_at: "2025-11-20T10:30:00", record_id: "json-ARN-SGHA-2.3-PASSENGER-02", unit: "SEK per turnaround", period: "2025-11", airport_iata_code: "ARN", airport_name: "Stockholm Arlanda Airport", airline_iata_code: "SK", airline_name: "SAS Scandinavian Airlines", flight_number: "SK418", terminal: "T5", stand: "14", supplier: "Swedavia", source_type: "json" },
    { kpi_code: "SGHA-2.3-PASSENGER-SERVICES", kpi_name: "Passenger Services Turnaround Rate", measurement: 3868.00, recorded_at: "2025-12-01T08:15:00", record_id: "json-CPH-SGHA-2.3-PASSENGER-03", unit: "SEK per turnaround", period: "2025-12", airport_iata_code: "CPH", airport_name: "Copenhagen Airport", airline_iata_code: "SK", airline_name: "SAS Scandinavian Airlines", flight_number: "SK429", terminal: "T3", stand: "22", supplier: "Swedavia", source_type: "json" },
    { kpi_code: "SGHA-2.3-RAMP-HANDLING", kpi_name: "Ramp Handling Turnaround Rate", measurement: 3543.00, recorded_at: "2025-11-15T09:00:00", record_id: "json-ARN-SGHA-2.3-RAMP-01", unit: "SEK per turnaround", period: "2025-11", airport_iata_code: "ARN", airport_name: "Stockholm Arlanda Airport", airline_iata_code: "SK", airline_name: "SAS Scandinavian Airlines", flight_number: "SK410", terminal: "T5", stand: "12", supplier: "Swedavia", source_type: "json" },
    { kpi_code: "SGHA-2.3-RAMP-HANDLING", kpi_name: "Ramp Handling Turnaround Rate", measurement: 4030.00, recorded_at: "2025-11-20T10:30:00", record_id: "json-ARN-SGHA-2.3-RAMP-02", unit: "SEK per turnaround", period: "2025-11", airport_iata_code: "ARN", airport_name: "Stockholm Arlanda Airport", airline_iata_code: "SK", airline_name: "SAS Scandinavian Airlines", flight_number: "SK418", terminal: "T5", stand: "14", supplier: "Swedavia", source_type: "json" },
    { kpi_code: "SGHA-2.3-RAMP-HANDLING", kpi_name: "Ramp Handling Turnaround Rate", measurement: 4523.00, recorded_at: "2025-12-01T08:15:00", record_id: "json-CPH-SGHA-2.3-RAMP-03", unit: "SEK per turnaround", period: "2025-12", airport_iata_code: "CPH", airport_name: "Copenhagen Airport", airline_iata_code: "SK", airline_name: "SAS Scandinavian Airlines", flight_number: "SK429", terminal: "T3", stand: "22", supplier: "Swedavia", source_type: "json" },
    { kpi_code: "SGHA-2.3-PASSENGER-SERVICES", kpi_name: "Passenger Services Turnaround Rate", measurement: 4679.00, recorded_at: "2025-12-05T11:00:00", record_id: "json-OSL-SGHA-2.3-PASSENGER-04", unit: "SEK per turnaround", period: "2025-12", airport_iata_code: "OSL", airport_name: "Oslo Airport", airline_iata_code: "SK", airline_name: "SAS Scandinavian Airlines", flight_number: "SK433", terminal: "T1", stand: "08", supplier: "Swedavia", source_type: "json" },
    { kpi_code: "SGHA-2.3-RAMP-HANDLING", kpi_name: "Ramp Handling Turnaround Rate", measurement: 5172.00, recorded_at: "2025-12-05T11:00:00", record_id: "json-OSL-SGHA-2.3-RAMP-04", unit: "SEK per turnaround", period: "2025-12", airport_iata_code: "OSL", airport_name: "Oslo Airport", airline_iata_code: "SK", airline_name: "SAS Scandinavian Airlines", flight_number: "SK433", terminal: "T1", stand: "08", supplier: "Swedavia", source_type: "json" },
  ],
  rest_api: [
    { kpi_code: "SGHA-2.7-ELECTRICITY", kpi_name: "Ground Power Electricity Charge", metric_value: 119.00, observed_at: "2025-11-15T09:00:00", event_id: "rest_api-ARN-SGHA-2.7-ELECTRICITY-01", unit: "SEK/day", period: "2025-11", airport_iata_code: "ARN", airport_name: "Stockholm Arlanda Airport", airline_iata_code: "SK", airline_name: "SAS Scandinavian Airlines", flight_number: "SK410", terminal: "T5", stand: "12", supplier: "Swedavia", source_type: "rest_api" },
    { kpi_code: "SGHA-2.7-ELECTRICITY", kpi_name: "Ground Power Electricity Charge", metric_value: 151.00, observed_at: "2025-11-20T10:30:00", event_id: "rest_api-ARN-SGHA-2.7-ELECTRICITY-02", unit: "SEK/day", period: "2025-11", airport_iata_code: "ARN", airport_name: "Stockholm Arlanda Airport", airline_iata_code: "SK", airline_name: "SAS Scandinavian Airlines", flight_number: "SK418", terminal: "T5", stand: "14", supplier: "Swedavia", source_type: "rest_api" },
    { kpi_code: "SGHA-2.8-DEICING", kpi_name: "De-icing Fluid Charge", metric_value: 17.31, observed_at: "2025-12-01T08:15:00", event_id: "rest_api-CPH-SGHA-2.8-DEICING-01", unit: "SEK per liter", period: "2025-12", airport_iata_code: "CPH", airport_name: "Copenhagen Airport", airline_iata_code: "SK", airline_name: "SAS Scandinavian Airlines", flight_number: "SK429", terminal: "T3", stand: "22", supplier: "Swedavia", source_type: "rest_api" },
    { kpi_code: "SGHA-2.8-DEICING", kpi_name: "De-icing Fluid Charge", metric_value: 19.50, observed_at: "2025-12-05T11:00:00", event_id: "rest_api-OSL-SGHA-2.8-DEICING-02", unit: "SEK per liter", period: "2025-12", airport_iata_code: "OSL", airport_name: "Oslo Airport", airline_iata_code: "SK", airline_name: "SAS Scandinavian Airlines", flight_number: "SK433", terminal: "T1", stand: "08", supplier: "Swedavia", source_type: "rest_api" },
    { kpi_code: "SGHA-2.12-CANCELLATION", kpi_name: "Cancellation Notice Charge", notice_hours: 4, applicable_turnaround_charge_sek: 3543.00, charge_percent_expected: 100, actual_credit_sek: 3543.00, observed_at: "2025-11-15T09:00:00", event_id: "rest_api-ARN-SGHA-2.12-CANCEL-01", unit: "percent of applicable turnaround charge (100% under 6h notice, 50% for 6-24h)", period: "2025-11", airport_iata_code: "ARN", airport_name: "Stockholm Arlanda Airport", airline_iata_code: "SK", airline_name: "SAS Scandinavian Airlines", flight_number: "SK410", terminal: "T5", stand: "12", supplier: "Swedavia", source_type: "rest_api" },
    { kpi_code: "SGHA-2.7-ELECTRICITY", kpi_name: "Ground Power Electricity Charge", metric_value: 135.00, observed_at: "2025-12-08T14:00:00", event_id: "rest_api-ARN-SGHA-2.7-ELECTRICITY-03", unit: "SEK/day", period: "2025-12", airport_iata_code: "ARN", airport_name: "Stockholm Arlanda Airport", airline_iata_code: "SK", airline_name: "SAS Scandinavian Airlines", flight_number: "SK445", terminal: "T5", stand: "16", supplier: "Swedavia", source_type: "rest_api" },
    { kpi_code: "SGHA-2.8-DEICING", kpi_name: "De-icing Fluid Charge", metric_value: 16.80, observed_at: "2025-12-10T07:30:00", event_id: "rest_api-ARN-SGHA-2.8-DEICING-03", unit: "SEK per liter", period: "2025-12", airport_iata_code: "ARN", airport_name: "Stockholm Arlanda Airport", airline_iata_code: "SK", airline_name: "SAS Scandinavian Airlines", flight_number: "SK451", terminal: "T5", stand: "20", supplier: "Swedavia", source_type: "rest_api" },
    { kpi_code: "SGHA-2.12-CANCELLATION", kpi_name: "Cancellation Notice Charge", notice_hours: 14, applicable_turnaround_charge_sek: 4030.00, charge_percent_expected: 50, actual_credit_sek: 2015.00, observed_at: "2025-12-12T16:45:00", event_id: "rest_api-CPH-SGHA-2.12-CANCEL-02", unit: "percent of applicable turnaround charge (100% under 6h notice, 50% for 6-24h)", period: "2025-12", airport_iata_code: "CPH", airport_name: "Copenhagen Airport", airline_iata_code: "SK", airline_name: "SAS Scandinavian Airlines", flight_number: "SK460", terminal: "T3", stand: "18", supplier: "Swedavia", source_type: "rest_api" },
  ],
  sap_s4hana: [
    { kpi_code: "SGHA-1.6-EXTRA-HOURS", kpi_name: "Extra Opening Hours", amount: 1244.00, posting_date: "2025-11-15T09:00:00", document_id: "sap_s4hana-ARN-SGHA-1.6-EXTRA-01", unit: "SEK per manhour", period: "2025-11", airport_iata_code: "ARN", airport_name: "Stockholm Arlanda Airport", airline_iata_code: "SK", airline_name: "SAS Scandinavian Airlines", company_code: "SAS-ARN", source_type: "sap_s4hana" },
    { kpi_code: "SGHA-1.6-EXTRA-HOURS", kpi_name: "Extra Opening Hours", amount: 1244.00, posting_date: "2025-11-20T10:30:00", document_id: "sap_s4hana-ARN-SGHA-1.6-EXTRA-02", unit: "SEK per manhour", period: "2025-11", airport_iata_code: "ARN", airport_name: "Stockholm Arlanda Airport", airline_iata_code: "SK", airline_name: "SAS Scandinavian Airlines", company_code: "SAS-ARN", source_type: "sap_s4hana" },
    { kpi_code: "SGHA-1.6-EXTRA-HOURS", kpi_name: "Extra Opening Hours", amount: 1244.00, posting_date: "2025-12-01T08:15:00", document_id: "sap_s4hana-CPH-SGHA-1.6-EXTRA-03", unit: "SEK per manhour", period: "2025-12", airport_iata_code: "CPH", airport_name: "Copenhagen Airport", airline_iata_code: "SK", airline_name: "SAS Scandinavian Airlines", company_code: "SAS-ARN", source_type: "sap_s4hana" },
    { kpi_code: "SGHA-2.16-RETURN-TO-RAMP", kpi_name: "Return to Ramp Charge Waiver", physical_load_change: false, amount: 0.00, posting_date: "2025-11-15T09:00:00", document_id: "sap_s4hana-ARN-SGHA-2.16-RTR-01", unit: "SEK additional charge (0 unless physical change of load involved)", period: "2025-11", airport_iata_code: "ARN", airport_name: "Stockholm Arlanda Airport", airline_iata_code: "SK", airline_name: "SAS Scandinavian Airlines", company_code: "SAS-ARN", source_type: "sap_s4hana" },
    { kpi_code: "SGHA-2.16-RETURN-TO-RAMP", kpi_name: "Return to Ramp Charge Waiver", physical_load_change: true, amount: 3500.00, posting_date: "2025-12-05T11:00:00", document_id: "sap_s4hana-OSL-SGHA-2.16-RTR-02", unit: "SEK additional charge (0 unless physical change of load involved)", period: "2025-12", airport_iata_code: "OSL", airport_name: "Oslo Airport", airline_iata_code: "SK", airline_name: "SAS Scandinavian Airlines", company_code: "SAS-ARN", source_type: "sap_s4hana" },
    { kpi_code: "SGHA-1.6-EXTRA-HOURS", kpi_name: "Extra Opening Hours", amount: 1244.00, posting_date: "2025-12-08T14:00:00", document_id: "sap_s4hana-ARN-SGHA-1.6-EXTRA-04", unit: "SEK per manhour", period: "2025-12", airport_iata_code: "ARN", airport_name: "Stockholm Arlanda Airport", airline_iata_code: "SK", airline_name: "SAS Scandinavian Airlines", company_code: "SAS-ARN", source_type: "sap_s4hana" },
    { kpi_code: "SGHA-2.16-RETURN-TO-RAMP", kpi_name: "Return to Ramp Charge Waiver", physical_load_change: false, amount: 0.00, posting_date: "2025-12-10T07:30:00", document_id: "sap_s4hana-ARN-SGHA-2.16-RTR-03", unit: "SEK additional charge (0 unless physical change of load involved)", period: "2025-12", airport_iata_code: "ARN", airport_name: "Stockholm Arlanda Airport", airline_iata_code: "SK", airline_name: "SAS Scandinavian Airlines", company_code: "SAS-ARN", source_type: "sap_s4hana" },
    { kpi_code: "SGHA-1.6-EXTRA-HOURS", kpi_name: "Extra Opening Hours", amount: 1244.00, posting_date: "2025-12-12T16:45:00", document_id: "sap_s4hana-CPH-SGHA-1.6-EXTRA-05", unit: "SEK per manhour", period: "2025-12", airport_iata_code: "CPH", airport_name: "Copenhagen Airport", airline_iata_code: "SK", airline_name: "SAS Scandinavian Airlines", company_code: "SAS-ARN", source_type: "sap_s4hana" },
  ],
};

function GuidedSourcesPanel({
  sourceCatalog,
  recentProfiles,
  sourceConfigs,
  selectedSource,
  selectedRuns,
  sourceResult,
  kpis,
  trackedKpis,
  isSavingSource,
  runningSourceIds,
  onSelectSource,
  onCreateSource,
  onUpdateSource,
  onUpdateSourceBinding,
  onDeleteSource,
  onRunSourceAction,
  onTestSourceConfiguration,
  onUploadSampleFile,
  onAllSourcesReady,
}: {
  sourceCatalog: KPISourceCatalogItem[];
  recentProfiles: KPIIntegrationProfile[];
  sourceConfigs: KPISourceConfig[];
  selectedSource: KPISourceConfig | null;
  selectedRuns: KPISourceFetchRun[];
  sourceResult: any;
  kpis: ContractKPI[];
  trackedKpis: ContractKPI[];
  isSavingSource: boolean;
  runningSourceIds: Set<string>;
  onSelectSource: (sourceId: string) => void;
  onCreateSource: (
    source: KPISourceCatalogItem,
  ) => void | Promise<KPISourceConfig | null>;
  onUpdateSource: (
    config: KPISourceConfig,
    updates: Partial<KPISourceConfig>,
  ) => void | Promise<KPISourceConfig | null>;
  onUpdateSourceBinding: (
    config: KPISourceConfig,
    binding: KPISourceBinding,
  ) => void | Promise<void>;
  onDeleteSource: (config: KPISourceConfig) => void | Promise<void>;
  onRunSourceAction: (
    config: KPISourceConfig,
    action: "test" | "fetch",
  ) => void | Promise<any>;
  onTestSourceConfiguration: (
    config: KPISourceConfig,
    updates: Partial<KPISourceConfig>,
  ) => void | Promise<any>;
  onUploadSampleFile?: (
    config: KPISourceConfig,
    file: File,
  ) => void | Promise<void>;
  onAllSourcesReady?: () => void;
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const perSourceInputRef = useRef<HTMLInputElement | null>(null);
  const [isBulkFetching, setIsBulkFetching] = useState(false);
  const [bulkFetchStatus, setBulkFetchStatus] = useState("");
  const [uploadTargetId, setUploadTargetId] = useState<string | null>(null);
  const [uploadedFileIds, setUploadedFileIds] = useState<Set<string>>(() => {
    if (typeof window !== "undefined") {
      try {
        const stored = sessionStorage.getItem("uploadedFileIds");
        if (stored) return new Set(JSON.parse(stored));
      } catch { }
    }
    return new Set();
  });
  const [hasPreviewedTest, setHasPreviewedTest] = useState<Set<string>>(() => {
    if (typeof window !== "undefined") {
      try {
        const stored = sessionStorage.getItem("hasPreviewedTest");
        if (stored) return new Set(JSON.parse(stored));
      } catch { }
    }
    return new Set();
  });
  const [mockLoading, setMockLoading] = useState<Set<string>>(new Set());
  const [isAddingSource, setIsAddingSource] = useState(false);
  const [configModalSource, setConfigModalSource] =
    useState<KPISourceConfig | null>(null);
  const [step, setStep] = useState<"connect" | "ingest">("connect");
  const [showSourceChoices, setShowSourceChoices] = useState(false);
  const [smartMatched, setSmartMatched] = useState<Set<string>>(() => {
    if (typeof window !== "undefined") {
      try {
        const stored = sessionStorage.getItem("smartMatched");
        if (stored) return new Set(JSON.parse(stored));
      } catch { }
    }
    return new Set();
  });
  const [fieldOverrides, setFieldOverrides] = useState<Record<string, string>>(
    {},
  );
  useEffect(() => {
    if (selectedSource && isAddingSource) {
      setIsAddingSource(false);
    }
  }, [selectedSource?.source_config_id]);
  useEffect(() => {
    if (selectedSource) {
      if (smartMatched.has(selectedSource.source_config_id)) {
        setStep("ingest");
      } else {
        setStep("connect");
      }
    }
  }, [selectedSource, smartMatched, hasPreviewedTest, uploadedFileIds]);
  useEffect(() => {
    if (typeof window !== "undefined") {
      sessionStorage.setItem("uploadedFileIds", JSON.stringify(Array.from(uploadedFileIds)));
    }
  }, [uploadedFileIds]);
  useEffect(() => {
    if (typeof window !== "undefined") {
      sessionStorage.setItem("hasPreviewedTest", JSON.stringify(Array.from(hasPreviewedTest)));
    }
  }, [hasPreviewedTest]);
  useEffect(() => {
    if (typeof window !== "undefined") {
      sessionStorage.setItem("smartMatched", JSON.stringify(Array.from(smartMatched)));
    }
  }, [smartMatched]);
  const visibleKpis = kpis.filter((kpi) => kpi.status !== "ignored");
  const bindings = selectedSource
    ? bindingsForSource(selectedSource, visibleKpis)
    : [];
  const enabledBindings = bindings.filter(
    (binding) => binding.enabled !== false,
  );
  const previewRows = useMemo(() => {
    const sourceType = selectedSource?.source_type;
    const hasFile = selectedSource && uploadedFileIds.has(selectedSource.source_config_id);
    const alreadyTested = selectedSource && hasPreviewedTest.has(selectedSource.source_config_id);

    if (sourceType && SEEDED_DEMO_ROWS[sourceType]) {
      const hasSeededPayload = Array.isArray(selectedSource?.sample_payload) &&
        selectedSource.sample_payload.length > 0;
      if (
        (sourceType === "csv" || sourceType === "json" || sourceType === "xlsx" || sourceType === "xml" || sourceType === "scanned_images" || sourceType === "file_upload") &&
        !hasFile &&
        !hasSeededPayload
      ) {
        return [];
      }
      if (!alreadyTested && !hasSeededPayload) {
        return [];
      }
      return SEEDED_DEMO_ROWS[sourceType].slice(0, 8);
    }
    if (!alreadyTested) {
      return [];
    }
    const rows =
      sourceResult?.available_data ||
      sourceResult?.normalized_rows ||
      selectedSource?.sample_payload ||
      [];
    return Array.isArray(rows)
      ? rows.filter((row) => row && typeof row === "object").slice(0, 8)
      : [];
  }, [selectedSource?.sample_payload, selectedSource?.source_type, selectedSource?.source_config_id, sourceResult, uploadedFileIds, hasPreviewedTest]);
  const previewFields = useMemo(
    () =>
      Array.from(new Set(previewRows.flatMap((row) => Object.keys(row)))).slice(
        0,
        8,
      ),
    [previewRows],
  );
  const normalize = (value: unknown) =>
    String(value || "")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");
  const rowLabel = (row: Record<string, any>) =>
    String(
      row.kpi_name ||
      row.metric_name ||
      row.metric ||
      row.name ||
      row.kpi_id ||
      row.metric_id ||
      "",
    );
  const findKpi = (row: Record<string, any>) => {
    const label = normalize(rowLabel(row));
    const id = String(row.kpi_id || row.metric_id || "");
    return (
      visibleKpis.find((kpi) => kpi.kpi_id === id) ||
      visibleKpis.find((kpi) => normalize(kpi.name) === label) ||
      visibleKpis.find((kpi) => label && normalize(kpi.name).includes(label)) ||
      null
    );
  };
  const findField = (fields: string[], names: readonly string[]) =>
    fields.find((field) =>
      names.some((name) => normalize(field).includes(name)),
    ) || "";
  const sourceFieldSuggestions = {
    actual_value:
      fieldOverrides.actual_value ||
      findField(previewFields, [
        "actualvalue",
        "value",
        "actual",
        "score",
        "amount",
        "result",
        "measurement",
      ]),
    timestamp:
      fieldOverrides.timestamp ||
      findField(previewFields, [
        "timestamp",
        "date",
        "eventtime",
        "recordedat",
        "observedat",
        "datetime",
        "createdat",
      ]),
    source_record_id:
      fieldOverrides.source_record_id ||
      findField(previewFields, [
        "sourcerecordid",
        "recordid",
        "id",
        "eventid",
        "uuid",
        "rowid",
      ]),
    unit:
      fieldOverrides.unit ||
      findField(previewFields, ["unit", "uom", "dimension"]),
    period:
      fieldOverrides.period ||
      findField(previewFields, ["period", "interval", "window", "month"]),
  };
  const hasMeasurementFields = Boolean(
    sourceFieldSuggestions.actual_value && sourceFieldSuggestions.timestamp,
  );
  const createFieldBinding = (kpi: ContractKPI) => {
    if (!selectedSource) return null;
    return {
      binding_id: sourceBindingId(
        selectedSource.source_config_id,
        kpi.kpi_id,
        1,
      ),
      kpi_id: kpi.kpi_id,
      enabled: true,
      match_rule: {},
      aggregation: kpi.aggregation_type || "latest",
      unit_override: null,
      dedupe_key_override: sourceFieldSuggestions.source_record_id || null,
      watermark_field_override: sourceFieldSuggestions.timestamp || null,
      validation_status: null,
      field_mappings: Object.entries(sourceFieldSuggestions)
        .filter(([, value]) => Boolean(value))
        .map(([kpi_field, source_field]) => ({
          kpi_field,
          source_field,
          transform:
            kpi_field === "actual_value"
              ? "number"
              : kpi_field === "timestamp"
                ? "datetime"
                : "string",
        })),
    } satisfies KPISourceBinding;
  };
  const smartMatch = async () => {
    if (!selectedSource || !visibleKpis.length) return;
    const rawRows =
      sourceResult?.available_data ||
      sourceResult?.normalized_rows ||
      selectedSource?.sample_payload ||
      [];
    const sourceRows = Array.isArray(rawRows)
      ? rawRows.filter(
        (row: any) => row && typeof row === "object",
      )
      : [];
    const previewCodes = new Set(
      sourceRows
        .map((row: any) => row?.kpi_code || row?.kpiCode)
        .filter(Boolean)
        .map(String),
    );
    const acceptedKpis = visibleKpis.filter(
      (kpi) => kpi.status === "approved" || isKpiTracked(kpi),
    );
    const allowedCodes = airportDemoSourceCodes(selectedSource);
    const sourceKpis = allowedCodes
      ? acceptedKpis.filter((kpi) => allowedCodes.has(kpi.kpi_id.split(":").pop() || kpi.kpi_id))
      : acceptedKpis;
    const scopedKpis = acceptedKpis.filter((kpi) =>
      previewCodes.has(kpi.kpi_id.split(":").pop() || kpi.kpi_id),
    );
    const targetKpis = sourceKpis.length
      ? sourceKpis
      : scopedKpis.length
        ? scopedKpis
        : acceptedKpis.length
          ? acceptedKpis
          : visibleKpis;
    const existingBindings = bindingsForSource(selectedSource, visibleKpis);
    const nextBindings = targetKpis.map((kpi, index) => {
      const existing = existingBindings.find(
        (binding) => binding.kpi_id === kpi.kpi_id,
      );
      const binding = createFieldBinding(kpi);
      return {
        ...(existing || {}),
        ...(binding || {}),
        binding_id:
          existing?.binding_id ||
          sourceBindingId(selectedSource.source_config_id, kpi.kpi_id, index + 1),
        kpi_id: kpi.kpi_id,
        enabled: true,
        match_rule: {
          field: "kpi_code",
          operator: "equals",
          value: kpi.kpi_id.split(":").pop() || kpi.kpi_id,
        },
      } satisfies KPISourceBinding;
    });
    if (!nextBindings.length) return;
    const mappedSource = await onUpdateSource(selectedSource, {
      kpi_bindings: nextBindings,
      kpi_ids: targetKpis.map((kpi) => kpi.kpi_id),
      status: "mapped",
    });
    if (!mappedSource) return;
    setSmartMatched((prev) => new Set(prev).add(selectedSource.source_config_id));
  };
  const availableProfiles = Array.from(
    new Map(
      recentProfiles
        .filter((profile) =>
          [
            "csv",
            "json",
            "scanned_images",
            "file_upload",
            "rest_api",
            "oracle_fusion",
            "sap_s4hana",
            "sap_ariba",
          ].includes(profile.source_type),
        )
        .map((profile) => [profile.source_type, profile]),
    ).values(),
  ).filter(
    (profile) =>
      !sourceConfigs.some(
        (config) =>
          config.source_type === profile.source_type &&
          config.display_name === profile.display_name,
      ),
  );
  const useRecentProfile = async (profile: KPIIntegrationProfile) => {
    const catalog = sourceCatalog.find(
      (item) => item.source_type === profile.source_type,
    );
    if (!catalog) return;
    const created = await onCreateSource({
      ...catalog,
      label: profile.display_name,
    });
    if (!created) return;
    const configured = await onUpdateSource(created, {
      display_name: profile.display_name,
      endpoint: profile.endpoint,
      method: profile.method,
      auth_type: profile.auth_type || "none",
      record_path: profile.record_path,
      data_path: profile.data_path,
      field_mappings: profile.field_mappings,
      sample_payload: profile.sample_payload,
      dedupe_key: profile.dedupe_key,
      watermark_field: profile.watermark_field,
      schedule: profile.schedule,
      status: "mapped",
      enabled: true,
    });
    const selected = configured || created;
    onSelectSource(selected.source_config_id);
    setStep("connect");
  };
  const useAllRecentProfiles = async () => {
    const catalogByType = new Map(
      sourceCatalog.map((item) => [item.source_type, item]),
    );
    const eligibleProfiles = availableProfiles.filter((profile) =>
      catalogByType.has(profile.source_type),
    );
    // Create + configure every source in parallel instead of one at a time --
    // each pair is an independent round trip (new source_config_id, no shared
    // state besides functional setSourceConfigs updates), so sequential
    // awaiting here was pure added latency (N sources = N x round-trip time).
    const createdConfigs = (
      await Promise.all(
        eligibleProfiles.map(async (profile) => {
          const catalog = catalogByType.get(profile.source_type);
          if (!catalog) return null;
          const created = await onCreateSource({
            ...catalog,
            label: profile.display_name,
          });
          if (!created) return null;
          const configured = await onUpdateSource(created, {
            display_name: profile.display_name,
            endpoint: profile.endpoint,
            method: profile.method,
            auth_type: profile.auth_type || "none",
            record_path: profile.record_path,
            data_path: profile.data_path,
            field_mappings: profile.field_mappings,
            sample_payload: profile.sample_payload,
            dedupe_key: profile.dedupe_key,
            watermark_field: profile.watermark_field,
            schedule: profile.schedule,
            status: "mapped",
            enabled: true,
          });
          return configured || created;
        }),
      )
    ).filter((config): config is KPISourceConfig => Boolean(config));
    if (!createdConfigs.length) return;
    const lastCreated = createdConfigs[createdConfigs.length - 1];
    onSelectSource(lastCreated.source_config_id);
    setStep("connect");

    // All sources connected -- now fetch every one of them in parallel (each
    // hits a distinct, non-overlapping set of KPIs, so there's no ordering
    // dependency) and only hand control back (switching straight to Contract
    // Breaches) once every fetch has actually landed, instead of leaving the
    // user staring at an empty sources list while ingestion runs one source
    // at a time in the background.
    setIsBulkFetching(true);
    try {
      let completed = 0;
      setBulkFetchStatus(`Fetching ${createdConfigs.length} sources...`);
      await Promise.all(
        createdConfigs.map(async (config) => {
          try {
            await onRunSourceAction(config, "fetch");
          } catch {
            // one source failing shouldn't block the rest from fetching
          } finally {
            completed += 1;
            setBulkFetchStatus(
              `Fetched ${completed} of ${createdConfigs.length} sources...`,
            );
          }
        }),
      );
      onAllSourcesReady?.();
    } finally {
      setIsBulkFetching(false);
      setBulkFetchStatus("");
    }
  };
  const uploadFile = async (file: File) => {
    const extension = file.name.split(".").pop()?.toLowerCase() || "csv";
    const type =
      extension === "xls" || extension === "xlsx"
        ? "xlsx"
        : extension === "json"
          ? "json"
          : extension === "xml"
            ? "xml"
            : "csv";
    const catalog = sourceCatalog.find((item) => item.source_type === type);
    if (!catalog || !onUploadSampleFile) return;
    const created = await onCreateSource(catalog);
    if (created) {
      await onUploadSampleFile(created, file);
      toast({ title: "File uploaded successfully!", variant: "default" });
      setUploadedFileIds((prev) => new Set(prev).add(created.source_config_id));
      setStep("connect");
    }
  };
  const sourceStatus = selectedSource?.last_error
    ? "Needs attention"
    : selectedSource?.last_success_at
      ? "Ready"
      : selectedSource
        ? "Preview required"
        : "Choose a source";

  const connectStep = selectedSource ? (
    <div className="space-y-4 p-4">
      <div className="rounded-lg border border-blue-200 bg-blue-50/60 p-4">
        <h4 className="text-sm font-semibold text-blue-950">
          Preview before mapping
        </h4>
        <p className="mt-1 text-xs leading-5 text-blue-900/80">
          Test the source first. Available columns are shown here; raw
          operational rows remain in the parking layer.
        </p>
      </div>
      {previewRows.length ? (
        <CompactRows rows={previewRows} fields={previewFields} />
      ) : (
        <div className="rounded-lg border border-dashed border-gray-200 p-8 text-center text-sm text-gray-500">
          {(() => {
            const isFileSource = ["csv", "json", "xlsx", "xml", "scanned_images", "file_upload"].includes(
              selectedSource.source_type,
            );
            const hasFile = uploadedFileIds.has(selectedSource.source_config_id);

            if (isFileSource && !hasFile) {
              return (
                <div className="flex flex-col items-center gap-3">
                  <Upload className="h-8 w-8 text-gray-400" />
                  <p>Please upload a file to preview data.</p>
                </div>
              );
            }

            return (
              <div className="flex flex-col items-center gap-3">
                <Play className="h-8 w-8 text-gray-400" />
                <p>Ready to test the connection and preview data.</p>
                <Button
                  type="button"
                  className="bg-cs-primary text-white mt-2"
                  disabled={mockLoading.has(selectedSource.source_config_id)}
                  onClick={() => {
                    setMockLoading((prev) =>
                      new Set(prev).add(selectedSource.source_config_id)
                    );
                    setTimeout(() => {
                      setMockLoading((prev) => {
                        const next = new Set(prev);
                        next.delete(selectedSource.source_config_id);
                        return next;
                      });
                      setHasPreviewedTest((prev) =>
                        new Set(prev).add(selectedSource.source_config_id)
                      );
                    }, 2000);
                  }}
                >
                  {mockLoading.has(selectedSource.source_config_id) ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Play className="mr-2 h-4 w-4" />
                  )}
                  {mockLoading.has(selectedSource.source_config_id) ? "Checking..." : "Preview & test"}
                </Button>
              </div>
            );
          })()}
        </div>
      )}
      {previewRows.length > 0 && (
        <Button
          type="button"
          size="sm"
          className="float-right bg-cs-primary text-white"
          disabled={(selectedSource && runningSourceIds.has(selectedSource.source_config_id)) as boolean}
          onClick={() => {
            if (selectedSource) {
              setStep("ingest");
              onRunSourceAction(selectedSource, "fetch");
            }
          }}
        >
          {selectedSource && runningSourceIds.has(selectedSource.source_config_id) ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="mr-2 h-4 w-4" />
          )}
          Ingest actuals
        </Button>
      )}
      <div className="clear-both" />
    </div>
  ) : (
    <EmptySourceState onUpload={() => fileInputRef.current?.click()} />
  );
  const matchStep = (
    <div className="space-y-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h4 className="text-sm font-semibold text-gray-950">
            Match rows to accepted KPIs
          </h4>
          <p className="mt-1 text-xs text-gray-500">
            Smart Match maps the fields, links the accepted KPIs, and ingests the actuals in one click.
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          className={`gap-1.5 text-white ${selectedSource && smartMatched.has(selectedSource.source_config_id) ? "bg-emerald-500 hover:bg-emerald-600" : "bg-cs-primary"}`}
          onClick={() => void smartMatch()}
          disabled={!previewRows.length || isSavingSource}
        >
          {selectedSource && smartMatched.has(selectedSource.source_config_id) ? (
            <CheckCircle2 className="h-3.5 w-3.5" />
          ) : (
            <Sparkles className="h-3.5 w-3.5" />
          )}
          {selectedSource && smartMatched.has(selectedSource.source_config_id) ? "Matched" : "Smart Match"}
        </Button>
      </div>
      <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-gray-950">Field mapping</p>
            <p className="mt-1 text-xs text-gray-500">
              Map columns once; every returned record will use the mapping for
              the selected KPI.
            </p>
          </div>
          <select
            className="h-8 min-w-[240px] rounded-md border border-gray-200 bg-white px-2 text-xs"
            onChange={(event) => {
              const kpi = visibleKpis.find(
                (item) => item.kpi_id === event.target.value,
              );
              const binding = kpi ? createFieldBinding(kpi) : null;
              if (selectedSource && binding)
                void onUpdateSourceBinding(selectedSource, binding);
            }}
          >
            <option value="">Choose target KPI</option>
            {visibleKpis.map((kpi) => (
              <option key={kpi.kpi_id} value={kpi.kpi_id}>
                {kpi.name}
              </option>
            ))}
          </select>
        </div>
        <div className="mt-4 overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <table className="min-w-full text-left text-xs">
            <thead className="bg-gray-50 text-[10px] uppercase tracking-wide text-gray-400">
              <tr>
                <th className="px-3 py-2">KPI field</th>
                <th className="px-3 py-2">Source field</th>
                <th className="px-3 py-2">Why</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {(
                [
                  [
                    "actual_value",
                    "Actual value",
                    [
                      "actualvalue",
                      "value",
                      "actual",
                      "score",
                      "amount",
                      "result",
                    ],
                  ],
                  [
                    "timestamp",
                    "Timestamp",
                    [
                      "timestamp",
                      "date",
                      "eventtime",
                      "recordedat",
                      "datetime",
                      "createdat",
                    ],
                  ],
                  [
                    "source_record_id",
                    "Record ID",
                    [
                      "sourcerecordid",
                      "recordid",
                      "id",
                      "eventid",
                      "uuid",
                      "rowid",
                    ],
                  ],
                  ["unit", "Unit (optional)", ["unit", "uom", "dimension"]],
                  [
                    "period",
                    "Period (optional)",
                    ["period", "interval", "window", "month"],
                  ],
                ] as const
              ).map(([field, label, names]) => {
                const sourceField = findField(previewFields, names);
                return (
                  <tr key={field}>
                    <td className="px-3 py-2 font-semibold text-gray-900">
                      {label}
                    </td>
                    <td className="px-3 py-2">
                      <select
                        value={sourceField}
                        onChange={(event) =>
                          setFieldOverrides((current) => ({
                            ...current,
                            [field]: event.target.value,
                          }))
                        }
                        className="h-8 min-w-[220px] rounded-md border border-gray-200 bg-white px-2 text-xs"
                      >
                        <option value="">Not mapped</option>
                        {previewFields.map((item) => (
                          <option key={item} value={item}>
                            {item}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td
                      className={`px-3 py-2 ${sourceField ? "text-emerald-700" : field === "unit" || field === "period" ? "text-gray-500" : "text-amber-700"}`}
                    >
                      {sourceField
                        ? "Smart suggestion"
                        : field === "unit" || field === "period"
                          ? "Optional"
                          : "Required"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      <div className="flex justify-end">
        {/* Continue to ingest button removed as matching step is skipped */}
      </div>
    </div>
  );
  const ingestStep = (
    <div className="space-y-4 p-4">
      <div>
        <h4 className="text-sm font-semibold text-gray-950">
          Validate and ingest actuals
        </h4>
        <p className="mt-1 text-xs text-gray-500">
          Rows are parked raw first, normalized into actuals, then evaluated for
          KPIs that are already tracked.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <DetailTile label="Preview rows" value={String(previewRows.length)} />
        <DetailTile
          label="Matched KPIs"
          value={String(enabledBindings.length)}
          tone="blue"
        />
        <DetailTile label="Tracked KPIs" value={String(trackedKpis.length)} />
      </div>
      <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800">
        Untracked KPIs remain deferred until explicitly activated.
      </div>
      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setStep("connect")}
        >
          Back to connect
        </Button>
        <Button
          type="button"
          size="sm"
          className="gap-1.5 bg-cs-primary text-white"
          onClick={() =>
            selectedSource && onRunSourceAction(selectedSource, "fetch")
          }
          disabled={
            !selectedSource ||
            !previewRows.length ||
            !enabledBindings.length ||
            runningSourceIds.has(selectedSource.source_config_id)
          }
        >
          {selectedSource && runningSourceIds.has(selectedSource.source_config_id) ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
          Ingest actuals
        </Button>
      </div>
    </div>
  );

  if (isBulkFetching) {
    return (
      <div className="flex min-h-[420px] flex-col items-center justify-center gap-4 rounded-xl border border-gray-200 bg-white p-16 text-center shadow-sm">
        <Loader2 className="h-10 w-10 animate-spin text-cs-primary" />
        <div>
          <p className="text-sm font-semibold text-gray-800">
            Connecting sources and fetching actuals&hellip;
          </p>
          <p className="mt-1 text-xs text-gray-500">
            {bulkFetchStatus || "This will just take a moment."}
          </p>
        </div>
      </div>
    );
  }

  return (
    <TooltipProvider delayDuration={200}>
      <div className="space-y-4">
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void uploadFile(file);
          }}
        />
        <input
          ref={perSourceInputRef}
          type="file"
          className="hidden"
          onChange={async (event) => {
            const file = event.target.files?.[0];
            const targetId = uploadTargetId;
            if (!file || !targetId || !onUploadSampleFile) return;
            const targetSource = sourceConfigs.find(
              (s) => s.source_config_id === targetId,
            );
            if (!targetSource) return;
            await onUploadSampleFile(targetSource, file);
            toast({ title: "File uploaded successfully!", variant: "default" });
            setUploadedFileIds((prev) => new Set(prev).add(targetId));
            onSelectSource(targetId);
            setStep("connect");
          }}
        />

        <div className="grid gap-6 xl:grid-cols-[380px_minmax(0,1fr)]">
          <aside className="flex flex-col h-full">
            <div className="space-y-3">
            <Button
              type="button"
              className="w-full gap-2 bg-cs-primary text-white"
              onClick={() => {
                setIsAddingSource(true);
              }}
            >
              <Plus className="h-4 w-4" />
              Add Data Source
            </Button>

            <section className="rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-sm font-semibold">Your sources</h3>
                <Pill tone="blue">{sourceConfigs.length}</Pill>
              </div>
              {sourceConfigs.map((source) => {
                const isSelected = selectedSource?.source_config_id === source.source_config_id;
                
                const getSourceIcon = (type?: string | null) => {
                  const norm = String(type || "").toLowerCase();
                  if (norm.includes('sap') || norm.includes('ariba') || norm.includes('db') || norm.includes('database') || norm.includes('s/4hana')) return <Database className="h-4 w-4 stroke-[1.5]" />;
                  if (norm.includes('api') || norm.includes('rest') || norm.includes('feed')) return <FileText className="h-4 w-4 stroke-[1.5]" />;
                  if (norm.includes('image') || norm.includes('scan')) return <ImageIcon className="h-4 w-4 stroke-[1.5]" />;
                  if (norm.includes('cloud') || norm.includes('aws') || norm.includes('s3')) return <UploadCloud className="h-4 w-4 stroke-[1.5]" />;
                  if (norm.includes('file') || norm.includes('csv') || norm.includes('spreadsheet')) return <BarChart3 className="h-4 w-4 stroke-[1.5]" />;
                  return <MessageSquare className="h-4 w-4 stroke-[1.5]" />;
                };
                
                return (
                <div
                  key={source.source_config_id}
                  className={`mb-3 flex items-start gap-3 rounded-xl border p-3 ${isSelected ? "border-cs-primary bg-cs-primary/5" : "border-gray-200 bg-white"}`}
                >
                  <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border ${isSelected ? "border-cs-primary bg-cs-primary text-white" : "border-gray-200 bg-gray-50/50 text-gray-500"}`}>
                    {getSourceIcon(source.source_type || source.display_name)}
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      onSelectSource(source.source_config_id);
                      setIsAddingSource(false);
                      setStep(source.last_success_at ? "ingest" : "connect");
                    }}
                    className="min-w-0 flex-1 p-0 text-left pt-[3px]"
                  >
                    <span className="block line-clamp-2 text-[15px] font-semibold leading-[1.3] text-gray-900">
                      {source.display_name}
                    </span>
                    <span className="mt-1 block text-[13.5px] text-gray-500">
                      {sourceTypeLabel(source.source_type)} ·{" "}
                      {enabledKpiIdsForSource(source, visibleKpis).length} matched
                    </span>
                  </button>
                  <div className="flex shrink-0 items-center gap-2 pt-2 pr-1">
                    <span className={`h-2 w-2 rounded-full ${source.last_error ? "bg-[#d97706]" : "bg-[#10b981]"}`} />
                    <button
                      type="button"
                      title="Delete source"
                      aria-label={`Delete ${source.display_name}`}
                      disabled={isSavingSource}
                      onClick={() => void onDeleteSource(source)}
                      className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-red-600 disabled:opacity-50"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              )})}
              {!sourceConfigs.length && (
                <p className="rounded border border-dashed border-gray-200 p-4 text-center text-xs text-gray-500">
                  No sources added yet.
                </p>
              )}
            </section>

            {availableProfiles.length > 0 && (
              <div className="pt-6 border-t border-gray-200 mt-6">
                <div className="mb-3 px-1 flex items-center justify-between">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-gray-500">
                    Recent connections
                  </h3>
                  <button
                    type="button"
                    onClick={() => void useAllRecentProfiles()}
                    disabled={isSavingSource}
                    className="text-[11px] font-semibold text-cs-primary hover:text-cs-primary/80 disabled:opacity-50"
                  >
                    Use all
                  </button>
                </div>
                <div className="flex flex-col gap-2">
                  {availableProfiles.map((profile) => (
                    <div
                      key={profile.profile_id}
                      className="group flex items-center justify-between rounded-xl border border-gray-200 bg-white p-2.5 shadow-sm"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-gray-200 bg-gray-50 text-gray-500">
                          {(() => {
                            const norm = String(profile.source_type || profile.display_name || "").toLowerCase();
                            if (norm.includes('sap') || norm.includes('ariba') || norm.includes('db') || norm.includes('database') || norm.includes('s/4hana')) return <Database className="h-4 w-4 stroke-[1.5]" />;
                            if (norm.includes('api') || norm.includes('rest') || norm.includes('feed')) return <FileText className="h-4 w-4 stroke-[1.5]" />;
                            if (norm.includes('image') || norm.includes('scan')) return <ImageIcon className="h-4 w-4 stroke-[1.5]" />;
                            if (norm.includes('cloud') || norm.includes('aws') || norm.includes('s3')) return <UploadCloud className="h-4 w-4 stroke-[1.5]" />;
                            if (norm.includes('file') || norm.includes('csv') || norm.includes('spreadsheet')) return <BarChart3 className="h-4 w-4 stroke-[1.5]" />;
                            return <MessageSquare className="h-4 w-4 stroke-[1.5]" />;
                          })()}
                        </div>
                        <div className="flex flex-col min-w-0">
                          <span className="truncate text-sm font-semibold text-gray-900">
                            {profile.display_name}
                          </span>
                          <span className="truncate text-xs text-gray-500">
                            {sourceTypeLabel(profile.source_type)}
                          </span>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => void useRecentProfile(profile)}
                        disabled={isSavingSource}
                        className="ml-2 rounded-lg bg-cs-primary/10 px-3 py-1.5 text-xs font-bold text-cs-primary transition-colors hover:bg-cs-primary/20 disabled:opacity-50"
                      >
                        Connect
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
            </div>

            <div className="mt-auto pt-6 text-sm text-gray-500">
              {selectedRuns.length
                ? `${selectedRuns.length} recent run${selectedRuns.length === 1 ? "" : "s"}`
                : "No runs yet."}{" "}
              · {sourceResult?.raw_records_parked || 0} raw rows parked
            </div>
          </aside>

          <main className="min-w-0">
            {!selectedSource || isAddingSource ? (
              <div className="space-y-4">
                <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
                  <div className="mb-4 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <h2 className="text-base font-semibold text-gray-950">
                        New Connection
                      </h2>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button type="button" className="text-gray-400 hover:text-gray-600">
                            <Info className="h-4 w-4" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent className="max-w-[250px]">
                          <p>Files create a workspace source. REST and ERP sources open the connection configuration modal.</p>
                        </TooltipContent>
                      </Tooltip>
                    </div>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    <button
                      type="button"
                      disabled={isSavingSource}
                      onClick={() => fileInputRef.current?.click()}
                      className="flex flex-col items-start justify-center rounded-lg border border-gray-200 bg-white px-4 py-4 hover:border-cs-primary hover:bg-cs-primary/5 disabled:opacity-60"
                    >
                      <Upload className="mb-2 h-5 w-5 text-gray-600" />
                      <span className="block text-sm font-semibold text-gray-900">
                        File Upload
                      </span>
                      <span className="mt-1 block text-xs text-gray-500">
                        Seeded sample or CSV, JSON, XLSX, XML
                      </span>
                    </button>
                    {sourceCatalog
                      .filter(
                        (source) =>
                          ![
                            "oracle_db",
                            "sap_ariba",
                            "manual_attestation",
                          ].includes(source.source_type)
                      )
                      .map((source) => (
                        <button
                          key={source.source_type}
                          type="button"
                          disabled={isSavingSource}
                          onClick={async () => {
                            const created = await onCreateSource(source);
                            if (
                              created &&
                              [
                                "rest_api",
                                "oracle_fusion",
                                "sap_s4hana",
                                "oracle_db",
                                "sap_ariba",
                              ].includes(source.source_type)
                            ) {
                              setConfigModalSource(created);
                            }
                          }}
                          className="flex flex-col items-start justify-center rounded-lg border border-gray-200 bg-white px-4 py-4 hover:border-cs-primary hover:bg-cs-primary/5 disabled:opacity-60"
                        >
                          <Network className="mb-2 h-5 w-5 text-gray-600" />
                          <span className="block text-sm font-semibold text-gray-900">
                            {source.label}
                          </span>
                          <span className="mt-1 block text-xs text-gray-500">
                            {sourceTypeLabel(source.family || source.source_type)}
                          </span>
                        </button>
                      ))}
                  </div>
                </div>

              </div>
            ) : (
              <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
                <div className="border-b border-gray-100 bg-gray-50/50 p-5">
                  <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
                    <div>
                      <h3 className="text-lg font-bold text-gray-950">
                        {selectedSource.display_name}
                      </h3>
                      <p className="mt-1 text-sm text-gray-500">
                        {sourceTypeLabel(selectedSource.runtime_source_type || selectedSource.source_type)} ·{" "}
                        {previewRows.length
                          ? `${previewRows.length} preview rows`
                          : "No preview yet"}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setConfigModalSource(selectedSource)}
                        disabled={isSavingSource}
                      >
                        <Settings2 className="mr-1.5 h-3.5 w-3.5" />
                        Configure
                      </Button>
                      {["csv", "json", "xlsx", "xml", "scanned_images", "file_upload"].includes(selectedSource.source_type) && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setUploadTargetId(selectedSource.source_config_id);
                            setTimeout(() => perSourceInputRef.current?.click(), 0);
                          }}
                          disabled={isSavingSource}
                        >
                          <Upload className="mr-1.5 h-3.5 w-3.5" />
                          Upload file
                        </Button>
                      )}
                    </div>
                  </div>

                  <div className="mt-6 flex items-center gap-6 border-b border-gray-200 pb-[1px]">
                    {(
                      [
                        ["connect", "Connect"],
                        ["ingest", "Ingest"],
                      ] as const
                    ).map(([key, label]) => (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setStep(key)}
                        className={`relative pb-3 text-sm font-semibold transition-colors ${step === key
                          ? "text-cs-primary"
                          : "text-gray-500 hover:text-gray-700"
                          }`}
                      >
                        {label}
                        {step === key && (
                          <span className="absolute bottom-0 left-0 h-[2px] w-full bg-cs-primary" />
                        )}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="p-5">
                  {step === "connect" && connectStep}
                  {step === "ingest" && ingestStep}
                </div>
              </div>
            )}
          </main>
        </div>

        {configModalSource && (
          <SourceConfigModal
            source={configModalSource}
            isSaving={isSavingSource}
            onClose={() => setConfigModalSource(null)}
            onSave={async (updates) => {
              await onUpdateSource(configModalSource, updates);
            }}
            onTest={async (updates) =>
              onTestSourceConfiguration(configModalSource, updates)
            }
          />
        )}
      </div>
    </TooltipProvider>
  );
}

function EmptySourceState({ onUpload }: { onUpload: () => void }) {
  return (
    <div className="flex min-h-[360px] flex-col items-center justify-center p-8 text-center">
      <UploadCloud className="h-10 w-10 text-gray-300" />
      <h3 className="mt-4 text-base font-semibold text-gray-950">
        Start with a data source
      </h3>
      <p className="mt-1 max-w-md text-sm text-gray-500">
        Upload a seeded sample or structured CSV, JSON, XLSX, or XML file, or connect a REST/ERP source.
      </p>
      <Button
        type="button"
        size="sm"
        className="mt-4 bg-cs-primary text-white"
        onClick={onUpload}
      >
        <Upload className="mr-1.5 h-3.5 w-3.5" />
        Upload data
      </Button>
    </div>
  );
}

function CompactRows({
  rows,
  fields,
}: {
  rows: Array<Record<string, any>>;
  fields: string[];
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200">
      <table className="min-w-full text-left text-xs">
        <thead className="bg-gray-50 text-[10px] uppercase tracking-wide text-gray-400">
          <tr>
            {fields.map((field) => (
              <th key={field} className="px-3 py-2">
                {field}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {rows.slice(0, 5).map((row, index) => (
            <tr key={index}>
              {fields.map((field) => (
                <td
                  key={field}
                  className="max-w-[180px] truncate px-3 py-2 text-gray-700"
                >
                  {displayCell(row[field])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FlagsPanel({
  breaches,
  kpiById,
  onFlagRemediationEmail,
  onNotifyTeam,
  onBreachStatusChange,
  flagsReady = true,
  completedSourceCount = 0,
}: {
  breaches: ContractKPIBreach[];
  kpiById: Map<string, ContractKPI>;
  onFlagRemediationEmail: (
    breach: ContractKPIBreach,
  ) => Promise<ContractKPIBreach | null>;
  onNotifyTeam: (
    breach: ContractKPIBreach,
  ) => Promise<ContractKPIBreach | null>;
  onBreachStatusChange: (breachId: string, status: string) => void;
  flagsReady?: boolean;
  completedSourceCount?: number;
}) {
  const { authenticatedFetch } = useAuth();
  const [expandedFlagId, setExpandedFlagId] = useState<string | null>(null);
  const [escalatingBreachId, setEscalatingBreachId] = useState<string | null>(null);
  const [notifyingTeamBreachId, setNotifyingTeamBreachId] = useState<string | null>(null);
  const [notifyConfirmName, setNotifyConfirmName] = useState<string | null>(null);
  const [isDispatching, setIsDispatching] = useState(false);
  const [alertDraft, setAlertDraft] = useState<{
    contractId: string;
    kpiId: string;
    breachId?: string;
    to: string;
    subject: string;
    body: string;
    recipientSource?: ContractKPIBreach["breach_email_recipient_source"];
    status?: "sent";
  } | null>(null);
  const ordered = [...breaches].sort((left, right) => {
    const leftClosed = String(left.status || "open").toLowerCase() === "closed";
    const rightClosed = String(right.status || "open").toLowerCase() === "closed";
    const severityRank: Record<string, number> = {
      Critical: 5,
      High: 4,
      Medium: 3,
      Low: 2,
      OK: 1,
    };
    return (
      Number(leftClosed) - Number(rightClosed) ||
      Number(right.is_breach) - Number(left.is_breach) ||
      (severityRank[severityFor(right, kpiById.get(right.kpi_id))] || 0) -
      (severityRank[severityFor(left, kpiById.get(left.kpi_id))] || 0)
    );
  });
  const openEscalation = async (
    breach: ContractKPIBreach,
    kpi?: ContractKPI,
  ) => {
    const updated = await onFlagRemediationEmail(breach);
    const source = updated || breach;
    const draftText = source.breach_email_draft || buildEscalationDraft(source, kpi);
    // The draft itself carries its own "Subject: ..." first line -- read that
    // instead of building a second, independent subject string that can (and
    // did) drift out of sync with the actual draft body. Once read, strip it
    // (plus the blank line after it) from the body so it isn't shown twice --
    // once in the dedicated Subject field, once again inside the textarea.
    const subjectMatch = draftText.match(/^Subject:\s*(.*)$/m);
    const subject =
      subjectMatch?.[1]?.trim() ||
      `Action needed: ${kpi?.name || source.source_kpi?.name || source.kpi_id} did not meet the contract requirement`;
    const body = subjectMatch
      ? draftText.slice(subjectMatch.index! + subjectMatch[0].length).replace(/^\n+/, "")
      : draftText;
    setAlertDraft({
      contractId: kpi?.contract_id || source.contract_id || "",
      kpiId: source.kpi_id || kpi?.kpi_id || "",
      breachId: source.breach_id,
      to: source.breach_email_to || kpi?.contact_email || "",
      subject,
      body,
      recipientSource: source.breach_email_recipient_source,
    });
  };

  const handleNotifyTeam = async (breach: ContractKPIBreach, kpi?: ContractKPI) => {
    setNotifyingTeamBreachId(breach.breach_id || "");
    const updated = await onNotifyTeam(breach);
    setNotifyingTeamBreachId(null);
    if (updated) {
      setNotifyConfirmName(kpi?.name || breach.source_kpi?.name || breach.kpi_id || "this breach");
    }
  };

  return (
    <>
      <section className="rounded-lg border border-gray-200 bg-white">
        <div className="border-b border-gray-100 p-4">
          <h2 className="text-base font-semibold text-gray-950">
            Contract Breaches
          </h2>
          <p className="mt-1 text-xs text-gray-500">
            Detailed breach records with threshold, source, remediation, and
            escalation actions.
          </p>
        </div>
        {!flagsReady ? (
          <div className="flex min-h-[360px] flex-col items-center justify-center px-6 py-16">
            <div className="relative mb-8 flex items-center justify-center">
              <div className="absolute inset-0 animate-ping rounded-full bg-cs-primary/30" style={{ animationDuration: '2s' }}></div>
              <div className="absolute inset-0 animate-pulse rounded-full bg-cs-primary/20" style={{ transform: 'scale(1.5)' }}></div>
              <div className="relative flex h-20 w-20 items-center justify-center rounded-full bg-cs-primary/10 border-2 border-cs-primary shadow-lg shadow-cs-primary/20">
                <ShieldAlert className="h-10 w-10 text-cs-primary" />
              </div>
            </div>
            <h3 className="text-xl font-bold tracking-tight text-gray-900">Identifying Contract Breaches...</h3>
            <p className="mt-2 max-w-sm text-center text-sm text-gray-500">
              Analyzing ingested actuals against contract thresholds, service levels, and penalty clauses.
            </p>

            <div className="mt-10 w-full max-w-md space-y-5">
              <div className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2.5 font-medium text-gray-700">
                  {completedSourceCount === 4 ? <CheckCircle2 className="h-5 w-5 text-emerald-500" /> : <Loader2 className="h-5 w-5 animate-spin text-cs-primary" />}
                  Ingesting data sources
                </span>
                <span className="font-bold text-gray-900 bg-gray-100 px-2.5 py-0.5 rounded-full">{completedSourceCount} / 4</span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-gray-100 shadow-inner">
                <div
                  className="h-full bg-cs-primary transition-all duration-700 ease-in-out"
                  style={{ width: `${(completedSourceCount / 4) * 100}%` }}
                />
              </div>

              <div className="mt-6 flex flex-col gap-3 rounded-xl border border-gray-200 bg-gray-50/50 p-5 text-sm text-gray-600 shadow-sm">
                <div className="flex items-center gap-3">
                  <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                  Parsing contract obligations
                </div>
                <div className="flex items-center gap-3">
                  <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                  Mapping supplier & client KPIs
                </div>
                <div className="flex items-center gap-3">
                  {completedSourceCount > 0 ? (
                    <Loader2 className="h-4 w-4 animate-spin text-cs-primary" />
                  ) : (
                    <div className="h-4 w-4 rounded-full border-2 border-gray-300" />
                  )}
                  <span className={completedSourceCount > 0 ? "font-medium text-gray-900" : ""}>
                    Cross-referencing actuals with thresholds
                  </span>
                </div>
              </div>
            </div>
          </div>
        ) : !ordered.length ? (
          <div className="px-6 py-16 text-center text-sm text-gray-500">
            No contract breaches for tracked KPIs.
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {ordered.map((breach) => {
              const kpi = kpiById.get(breach.kpi_id);
              const severity = severityFor(breach, kpi);
              const expanded = expandedFlagId === breach.breach_id;
              const exposure = Math.abs(
                toNumber(kpi?.consequence_value) ||
                toNumber(breach.penalty_amount) ||
                0,
              );
              const partyRole = (kpi?.party_role || breach.source_kpi?.party_role || "").toLowerCase();
              const isSupplierBreach = partyRole === "supplier";
              return (
                <div
                  key={
                    breach.breach_id || `${breach.kpi_id}-${breach.created_at}`
                  }
                  className="bg-white"
                >
                  <div className="grid gap-3 p-4 lg:grid-cols-[minmax(280px,1fr)_150px_130px_130px_230px] lg:items-center">
                    <button
                      type="button"
                      onClick={() =>
                        setExpandedFlagId(expanded ? null : breach.breach_id)
                      }
                      className="min-w-0 text-left"
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className={`h-2.5 w-2.5 rounded-full ${breach.is_breach ? "bg-cs-primary" : "bg-gray-300"}`}
                        />
                        <p className="truncate text-sm font-semibold text-gray-950">
                          {kpi?.name ||
                            breach.source_kpi?.name ||
                            breach.kpi_id}
                        </p>
                        {isSupplierBreach && (
                          <span className="w-fit shrink-0 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
                            Supplier
                          </span>
                        )}
                        {(partyRole === "client" || partyRole === "customer") && (
                          <span className="w-fit shrink-0 rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[11px] font-semibold text-sky-700">
                            Customer
                          </span>
                        )}
                      </div>
                    </button>
                    <div
                      className={
                        breach.is_breach
                          ? "text-sm font-semibold text-gray-950"
                          : "text-sm font-semibold text-gray-600"
                      }
                    >
                      {exposure ? `-${money(exposure, extractCurrency(kpi?.consequence_unit))}` : "No penalty"}
                    </div>
                    <BreachStatusBadge status={breach.status || (breach.is_breach ? "open" : "clear")} />
                    <span
                      className={`w-fit rounded-full border px-2 py-1 text-xs font-semibold ${statusTone(severity)}`}
                    >
                      {severity}
                    </span>
                    <div className="flex flex-wrap justify-start gap-1.5 lg:justify-end">
                      {String(breach.status || "open").toLowerCase() !== "in_action" && String(breach.status || "open").toLowerCase() !== "closed" && (
                        <>
                          {isSupplierBreach && (
                            <Button
                              type="button"
                              size="sm"
                              className="h-8 w-[110px] justify-center gap-1.5 bg-cs-primary text-xs text-white hover:bg-cs-primary/90"
                              onClick={async () => {
                                setEscalatingBreachId(breach.breach_id || "");
                                await openEscalation(breach, kpi);
                                setEscalatingBreachId(null);
                              }}
                              disabled={!breach.is_breach || escalatingBreachId === breach.breach_id}
                            >
                              {escalatingBreachId === breach.breach_id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Mail className="h-3.5 w-3.5" />}
                              {escalatingBreachId === breach.breach_id ? "Escalating..." : "Escalate"}
                            </Button>
                          )}
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-8 w-[110px] justify-center gap-1.5 text-xs disabled:opacity-60"
                            onClick={() => handleNotifyTeam(breach, kpi)}
                            disabled={
                              !breach.is_breach ||
                              notifyingTeamBreachId === breach.breach_id ||
                              !!breach.team_notified_at
                            }
                          >
                            {notifyingTeamBreachId === breach.breach_id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : breach.team_notified_at ? (
                              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                            ) : (
                              <Bell className="h-3.5 w-3.5" />
                            )}
                            {notifyingTeamBreachId === breach.breach_id
                              ? "Notifying..."
                              : breach.team_notified_at
                                ? "Team notified"
                                : "Notify team"}
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <Dialog open={!!expandedFlagId} onOpenChange={(open) => !open && setExpandedFlagId(null)}>
        {(() => {
          const breach = expandedFlagId ? ordered.find(b => b.breach_id === expandedFlagId) : null;
          if (!breach) return null;
          const kpi = kpiById.get(breach.kpi_id);
          const expected = expectedFor(breach, kpi);
          const actual = `${breach.actual_value ?? "N/A"} ${breach.actual_unit || kpi?.unit || ""}`.trim();
          const partyRole = (kpi?.party_role || breach.source_kpi?.party_role || "").toLowerCase();
          const isSupplierBreach = partyRole === "supplier";

          return (
            <DialogContent className="max-w-[640px] max-h-[90vh] flex flex-col overflow-hidden rounded-[20px] p-0 gap-0 border border-gray-200 shadow-2xl bg-white">
              <DialogHeader className="sr-only">
                <DialogTitle>Breach Details</DialogTitle>
                <DialogDescription>Details for {kpi?.name || breach.source_kpi?.name || breach.kpi_id}</DialogDescription>
              </DialogHeader>

              {/* head */}
              <div className="flex items-start justify-between px-6 py-[22px] pb-[18px] border-b border-gray-200 bg-white shrink-0">
                <div className="flex gap-3 items-center">
                  <div className="w-9 h-9 rounded-[10px] bg-red-50 border border-red-200 flex items-center justify-center shrink-0">
                    <AlertTriangle className="w-[18px] h-[18px] text-red-600" />
                  </div>
                  <div className="flex flex-col justify-center">
                    <p className="text-[11px] font-bold tracking-[0.06em] uppercase text-gray-400 mb-1 leading-none">
                      {titleCase(kpi?.category || breach.source_kpi?.category || "SLA")}
                    </p>
                    <h4 className="text-[17px] font-bold text-gray-950 leading-[1.3] m-0 max-w-[420px]">
                      {kpi?.name || breach.source_kpi?.name || breach.kpi_id}
                    </h4>
                  </div>
                </div>
              </div>

              {/* body */}
              <div className="flex-1 overflow-y-auto px-6 py-5 pb-6 bg-white">

                {/* meta row */}
                <div className="flex flex-wrap gap-5 mb-[18px]">
                  <div className="flex flex-col gap-[5px]">
                    <span className="text-[10.5px] font-semibold tracking-[0.04em] uppercase text-gray-400">
                      Contract clause
                    </span>
                    <span className="inline-flex items-center gap-1.5 w-fit text-[12.5px] font-semibold text-cs-primary bg-cs-primary/5 border border-cs-primary/20 px-2.5 py-[5px] rounded-full cursor-pointer hover:bg-cs-primary/10 transition-colors">
                      <FileText className="w-[13px] h-[13px] text-cs-primary shrink-0" />
                      {kpi?.structural_path || kpi?.section_path || kpi?.section || breach.source_kpi?.quote || "Not captured"}
                    </span>
                  </div>
                  <div className="flex flex-col gap-[5px]">
                    <span className="text-[10.5px] font-semibold tracking-[0.04em] uppercase text-gray-400">
                      Data source
                    </span>
                    <span className="inline-flex items-center gap-1.5 w-fit text-[12.5px] font-semibold text-gray-600 bg-gray-50 border border-gray-200 px-2.5 py-[5px] rounded-full">
                      <Database className="w-[13px] h-[13px] text-gray-400 shrink-0" />
                      {humanizeSourceLabel(breach.source)}
                    </span>
                  </div>
                  <div className="flex flex-col gap-[5px]">
                    <span className="text-[12px] font-semibold text-gray-500">
                      Escalation status
                    </span>
                    <span className="inline-flex items-center gap-1.5 w-fit text-[12.5px] font-semibold text-gray-600 bg-gray-50 border border-gray-200 px-2.5 py-[5px] rounded-full">
                      <Clock className="w-[13px] h-[13px] text-gray-400 shrink-0" />
                      {titleCase(breach.status || "Not yet escalated")}
                    </span>
                  </div>
                </div>

                <VarianceComparison expected={expected} actual={actual} />

                {/* action card */}
                <div className="bg-gray-50 border border-gray-200 rounded-[14px] p-[16px_18px] mb-[20px]">
                  <div className="flex items-center gap-2 mb-2">
                    <Lightbulb className="w-[15px] h-[15px] text-cs-primary shrink-0" />
                    <span className="text-[12px] font-bold text-gray-500">
                      Recommended action
                    </span>
                  </div>
                  <p className="text-[14px] leading-[1.55] text-gray-950 m-0">
                    {breach.remediation || kpi?.remediation || defaultRemediationText(kpi, breach)}
                  </p>
                </div>

                {/* foot */}
                <div className="flex gap-[10px] pt-0.5">
                  <Button
                    type="button"
                    variant="ghost"
                    className="flex-[0.75] h-auto py-[11px] px-[14px] bg-white border border-transparent text-[13.5px] font-semibold text-gray-400 hover:bg-gray-100 hover:text-gray-600 rounded-[10px]"
                  >
                    <Sparkles className="w-[15px] h-[15px] mr-[7px]" />
                    Ask AI
                  </Button>
                  
                  {breach.status !== "in_action" && String(breach.status || "open").toLowerCase() !== "closed" && (
                    <>
                      {isSupplierBreach && (
                        <Button
                          type="button"
                          className="flex-[1.3] h-auto py-[11px] px-[14px] bg-cs-primary text-white hover:bg-cs-primary/90 border border-cs-primary text-[13.5px] font-semibold rounded-[10px] shadow-none"
                          onClick={async () => {
                            setEscalatingBreachId(breach.breach_id || "");
                            await openEscalation(breach, kpi);
                            setEscalatingBreachId(null);
                            setExpandedFlagId(null);
                          }}
                          disabled={!breach.is_breach || escalatingBreachId === breach.breach_id}
                        >
                          {escalatingBreachId === breach.breach_id ? <Loader2 className="w-[15px] h-[15px] animate-spin mr-[7px]" /> : <Send className="w-[15px] h-[15px] mr-[7px]" />}
                          {escalatingBreachId === breach.breach_id ? "Generating..." : "Send escalation alert"}
                        </Button>
                      )}
                      <Button
                        type="button"
                        variant={isSupplierBreach ? "outline" : "default"}
                        className={
                          isSupplierBreach
                            ? "flex-[1.3] h-auto py-[11px] px-[14px] border border-gray-300 text-[13.5px] font-semibold text-gray-700 hover:bg-gray-50 rounded-[10px] shadow-none disabled:opacity-60"
                            : "flex-[1.3] h-auto py-[11px] px-[14px] bg-cs-primary text-white hover:bg-cs-primary/90 border border-cs-primary text-[13.5px] font-semibold rounded-[10px] shadow-none disabled:opacity-60"
                        }
                        onClick={() => handleNotifyTeam(breach, kpi)}
                        disabled={
                          !breach.is_breach ||
                          notifyingTeamBreachId === breach.breach_id ||
                          !!breach.team_notified_at
                        }
                      >
                        {notifyingTeamBreachId === breach.breach_id ? (
                          <Loader2 className="w-[15px] h-[15px] animate-spin mr-[7px]" />
                        ) : breach.team_notified_at ? (
                          <CheckCircle2 className="w-[15px] h-[15px] mr-[7px]" />
                        ) : (
                          <Bell className="w-[15px] h-[15px] mr-[7px]" />
                        )}
                        {notifyingTeamBreachId === breach.breach_id
                          ? "Notifying..."
                          : breach.team_notified_at
                            ? "Team notified"
                            : "Notify team"}
                      </Button>
                    </>
                  )}
                </div>

              </div>
            </DialogContent>
          );
        })()}
      </Dialog>

      <Dialog open={!!alertDraft} onOpenChange={(open) => !open && setAlertDraft(null)}>
        <DialogContent className="max-w-2xl p-0 overflow-hidden bg-white border-0 shadow-xl sm:rounded-lg">
          <DialogHeader className="sr-only">
            <DialogTitle>Escalation Alert</DialogTitle>
          </DialogHeader>
          {alertDraft && (
            <div className="w-full">
            {alertDraft.status === "sent" ? (
              <div className="flex flex-col items-center justify-center py-12 px-6 text-center">
                <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100">
                  <CheckCircle2 className="h-8 w-8 text-emerald-600" />
                </div>
                <h3 className="text-xl font-semibold text-gray-950 mb-2">Alert Email Sent</h3>
                <p className="mb-8 max-w-sm text-sm text-gray-500">
                  The escalation alert has been successfully dispatched. The issue is now marked as "In Action".
                </p>
                <Button
                  type="button"
                  variant="outline"
                  className="w-full max-w-[200px]"
                  onClick={() => setAlertDraft(null)}
                >
                  Close
                </Button>
              </div>
            ) : (
              <>
                <div className="border-b border-gray-100 px-5 py-4">
                  <h3 className="text-base font-semibold text-gray-950">
                    Escalation Alert Email
                  </h3>
                  <p className="mt-1 text-xs text-gray-500">
                    Review the generated breach notice before dispatch.
                  </p>
                </div>
                <div className="space-y-3 p-5">
                  <DetailTile
                    label="To"
                    value={alertDraft.to || "No contract email found"}
                    tone={alertDraft.to ? "gray" : "amber"}
                  />
                  <DetailTile label="Subject" value={alertDraft.subject} />
                  <Textarea
                    value={alertDraft.body}
                    onChange={(event) =>
                      setAlertDraft({ ...alertDraft, body: event.target.value })
                    }
                    className="min-h-[320px] font-mono text-xs"
                  />
                </div>
                <div className="flex justify-end gap-2 border-t border-gray-100 px-5 py-4">
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setAlertDraft(null)}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    className="bg-cs-primary text-white hover:bg-cs-primary/90"
                    disabled={!alertDraft.to || isDispatching}
                    onClick={async () => {
                      if (
                        !alertDraft?.to ||
                        !alertDraft?.kpiId ||
                        !alertDraft?.contractId
                      ) {
                        toast({
                          title: "Alert dispatch failed",
                          description:
                            "Missing recipient email, KPI ID, or Contract ID.",
                          variant: "destructive",
                        });
                        return;
                      }
                      setIsDispatching(true);
                      try {
                        const result = await authenticatedFetch(
                          `${process.env.NEXT_PUBLIC_EXTRACTOR_API_URL}/contracts/${alertDraft.contractId}/kpis/alerts/dispatch`,
                          {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({
                              kpi_id: alertDraft.kpiId,
                              recipient: alertDraft.to,
                              subject: alertDraft.subject,
                              body: alertDraft.body,
                              breach_id: alertDraft.breachId,
                              delivery_mode: "mock",
                            }),
                          },
                        );
                        if (result.error) throw new Error(result.error);
                        if (alertDraft.breachId) {
                          onBreachStatusChange(alertDraft.breachId, "in_action");
                        }
                        setAlertDraft({ ...alertDraft, status: "sent" });
                      } catch (err: any) {
                        toast({
                          title: "Alert dispatch failed",
                          description: err?.message || "Failed to send alert.",
                          variant: "destructive",
                        });
                      } finally {
                        setIsDispatching(false);
                      }
                    }}
                  >
                    {isDispatching ? "Dispatching..." : "Dispatch Alert"}
                  </Button>
                </div>
              </>
            )}
          </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!notifyConfirmName} onOpenChange={(open) => !open && setNotifyConfirmName(null)}>
        <DialogContent className="max-w-sm p-0 overflow-hidden bg-white border-0 shadow-xl sm:rounded-lg">
          <DialogHeader className="sr-only">
            <DialogTitle>Team notified</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col items-center gap-3 px-6 py-8 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50 border border-emerald-200">
              <CheckCircle2 className="h-6 w-6 text-emerald-600" />
            </div>
            <div>
              <p className="text-[15px] font-bold text-gray-950">Team notified</p>
              <p className="mt-1.5 text-[13px] text-gray-500">
                An internal alert was sent to your team for &ldquo;{notifyConfirmName}&rdquo;.
              </p>
            </div>
            <Button
              type="button"
              className="mt-2 w-full bg-cs-primary text-white hover:bg-cs-primary/90"
              onClick={() => setNotifyConfirmName(null)}
            >
              Done
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

const MOCK_ACCOUNT_EMAIL = "ops@scandinav-airlines.com";

function RecoveriesPanel({
  breaches,
  kpiById,
  actionLogs,
  setActionLogs,
  updateBreachStatus,
  onNotifyTeam,
}: {
  breaches: ContractKPIBreach[];
  kpiById: Map<string, ContractKPI>;
  actionLogs: Record<string, RecoveryReminderAction[]>;
  setActionLogs: React.Dispatch<React.SetStateAction<Record<string, RecoveryReminderAction[]>>>;
  updateBreachStatus: (breachId: string, status: string) => Promise<any>;
  onNotifyTeam: (breach: ContractKPIBreach) => Promise<ContractKPIBreach | null>;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [alertDraft, setAlertDraft] = useState<{ status?: "sent" } | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [notifyingTeamBreachId, setNotifyingTeamBreachId] = useState<string | null>(null);
  const [notifyConfirmName, setNotifyConfirmName] = useState<string | null>(null);

  const handleNotifyTeam = async (breach: ContractKPIBreach, kpi?: ContractKPI) => {
    setNotifyingTeamBreachId(breach.breach_id || "");
    const updated = await onNotifyTeam(breach);
    setNotifyingTeamBreachId(null);
    if (updated) {
      setNotifyConfirmName(kpi?.name || breach.source_kpi?.name || breach.kpi_id || "this breach");
    }
  };

  const recoveries = useMemo(() => {
    const severityRank: Record<string, number> = {
      Critical: 5,
      High: 4,
      Medium: 3,
      Low: 2,
      OK: 1,
    };
    return breaches
      .filter((breach) => breach.is_breach)
      .sort((left, right) => {
        const leftClosed = String(left.status || "open").toLowerCase() === "closed";
        const rightClosed = String(right.status || "open").toLowerCase() === "closed";
        return (
          Number(leftClosed) - Number(rightClosed) ||
          (severityRank[severityFor(right, kpiById.get(right.kpi_id))] || 0) -
          (severityRank[severityFor(left, kpiById.get(left.kpi_id))] || 0)
        );
      });
  }, [breaches, kpiById]);

  const receivedStatuses = new Set(["resolved", "recovered", "received", "recovery_received", "closed"]);
  const hasPenalty = (breach: ContractKPIBreach) =>
    Math.abs(
      toNumber(breach.penalty_amount) ||
      toNumber(kpiById.get(breach.kpi_id)?.consequence_value) ||
      0,
    ) > 0;
  const penaltyRecoveries = recoveries.filter(hasPenalty);
  const nonPenaltyRecoveries = recoveries.filter((breach) => !hasPenalty(breach));
  const receivedRecoveries = recoveries.filter((breach) =>
    receivedStatuses.has(String(breach.status || "").toLowerCase()),
  );
  const financialRecoveryItems = penaltyRecoveries.filter(
    (breach) => !receivedStatuses.has(String(breach.status || "").toLowerCase()),
  );
  const operationalFollowUpItems = nonPenaltyRecoveries.filter(
    (breach) => !receivedStatuses.has(String(breach.status || "").toLowerCase()),
  );
  const allActiveRecoveries = recoveries.filter(
    (breach) => !receivedStatuses.has(String(breach.status || "").toLowerCase()),
  );
  const inActionCount = allActiveRecoveries.filter(
    (breach) => String(breach.status || "open").toLowerCase() === "in_action",
  ).length;
  const openCount = allActiveRecoveries.length - inActionCount;
  const recoveryGroups = [
    {
      id: "financial-recovery",
      label: "Financial Recovery",
      description: "Breach KPIs with contractual penalty exposure. Status shows whether escalation is open or in action.",
      items: financialRecoveryItems,
    },
    {
      id: "operational-follow-up",
      label: "Operational Follow-up",
      description: "Breach KPIs requiring operational attention but carrying no financial penalty.",
      items: operationalFollowUpItems,
    },
    {
      id: "received",
      label: "Recovery Received",
      description: "Recoveries marked resolved or received; no further reminders are required.",
      items: receivedRecoveries,
    },
  ].filter((group) => group.items.length > 0);
  const groupedRecoveries = recoveryGroups.flatMap((group) =>
    group.items.map((breach, index) => ({
      breach,
      group,
      showGroupHeading: index === 0,
    })),
  );

  const remindersSent = allActiveRecoveries.reduce(
    (sum, breach) => sum + (actionLogs[breach.breach_id]?.length || 0),
    0,
  );
  const flaggedEmails = allActiveRecoveries.filter((breach) => breach.breach_email_to)
    .length;
  const exposure = allActiveRecoveries.reduce(
    (sum, breach) =>
      sum +
      Math.abs(
        toNumber(breach.penalty_amount) ||
        toNumber(kpiById.get(breach.kpi_id)?.consequence_value) ||
        0,
      ),
    0,
  );

  const sendReminder = async (
    breach: ContractKPIBreach,
    audience: "team_owner" | "client",
  ) => {
    if (isSending) return;
    const kpi = kpiById.get(breach.kpi_id);
    const recipient =
      audience === "team_owner"
        ? MOCK_ACCOUNT_EMAIL
        : breach.breach_email_to || kpi?.contact_email || "";
    if (!recipient) {
      toast({
        title: "No recipient available",
        description: "Add a contact email to the KPI or contract, then retry.",
        variant: "destructive",
      });
      return;
    }
    setIsSending(true);
    await new Promise((resolve) => setTimeout(resolve, 350));
    const action: RecoveryReminderAction = {
      dispatch_id: `rem-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      audience,
      recipient,
      sent_at: new Date().toISOString(),
      status: "mock_dispatched",
      subject: `Reminder: ${breach.source_kpi?.name || kpi?.name || breach.kpi_id
        } breach requires remediation`,
    };
    setActionLogs((current) => ({
      ...current,
      [breach.breach_id]: [...(current[breach.breach_id] || []), action],
    }));
    setIsSending(false);
    setAlertDraft({ status: "sent" });
  };

  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-gray-200 bg-white p-4">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-gray-950">
              Recoveries Management
            </h2>
            <p className="mt-1 text-xs text-gray-500">
              All breach flags with remedies, SLA, applicable penalty exposure,
              and the follow-up email trail. Reminders are mock-dispatched in demo mode.
            </p>
          </div>
          <Pill tone={allActiveRecoveries.length ? "red" : "emerald"}>
            {allActiveRecoveries.length} active
          </Pill>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <Metric
            label="Open recoveries"
            value={String(openCount)}
            detail="awaiting escalation"
          />
          <Metric
            label="In Action"
            value={String(inActionCount)}
            detail="escalation sent"
          />
          <Metric
            label="Reminders sent"
            value={String(remindersSent)}
            detail="mock-dispatched follow-ups"
          />
          <Metric
            label="Flagged emails"
            value={String(flaggedEmails)}
            detail="counterparty contacts on file"
          />
          <Metric
            label="Penalty exposure"
            value={money(exposure, "USD")}
            detail="current open risk"
          />
        </div>
      </section>

      {!groupedRecoveries.length ? (
        <section className="rounded-lg border border-gray-200 bg-white px-6 py-16 text-center text-sm text-gray-500">
          No active recoveries. Every tracked KPI is compliant.
        </section>
      ) : (
        <section className="divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white">
          {groupedRecoveries.map(({ breach, group, showGroupHeading }) => {
            const kpi = kpiById.get(breach.kpi_id);
            const severity = severityFor(breach, kpi);
            const penalty = Math.abs(
              toNumber(breach.penalty_amount) ||
              toNumber(kpi?.consequence_value) ||
              0,
            );
            const partyRole = (kpi?.party_role || breach.source_kpi?.party_role || "").toLowerCase();
            const isSupplierBreach = partyRole === "supplier";
            const isCustomerBreach = partyRole === "client" || partyRole === "customer";
            return (
              <div
                key={breach.breach_id}
                className={isCustomerBreach ? "bg-sky-50/40 border-l-2 border-l-sky-300" : "bg-white"}
              >
                {showGroupHeading && (
                  <div className="border-y border-gray-100 bg-gray-50 px-4 py-3 first:border-t-0">
                    <p className="text-xs font-bold uppercase tracking-wide text-gray-700">{group.label}</p>
                    <p className="mt-1 text-xs text-gray-500">{group.description}</p>
                  </div>
                )}
                <div className="grid gap-3 p-4 lg:grid-cols-[minmax(260px,1fr)_120px_120px_120px_190px] lg:items-center">
                  <button
                    type="button"
                    onClick={() =>
                      setExpandedId(expandedId === breach.breach_id ? null : breach.breach_id)
                    }
                    className="min-w-0 text-left"
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className={`h-2.5 w-2.5 rounded-full ${severity === "Critical" || severity === "High"
                          ? "bg-red-500"
                          : "bg-amber-400"
                          }`}
                      />
                      <p className="truncate text-sm font-semibold text-gray-950">
                        {kpi?.name || breach.source_kpi?.name}
                      </p>
                      {isSupplierBreach && (
                        <span className="w-fit shrink-0 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
                          Supplier
                        </span>
                      )}
                      {isCustomerBreach && (
                        <span className="w-fit shrink-0 rounded-full border border-sky-200 bg-sky-100 px-2 py-0.5 text-[11px] font-semibold text-sky-700">
                          Customer
                        </span>
                      )}
                    </div>
                  </button>
                  <div className="text-sm font-semibold text-gray-950">
                    {penalty ? `-${money(penalty, "USD")}` : "Operational only"}
                  </div>
                  <BreachStatusBadge status={breach.status || "open"} />
                  <span
                    className={`w-fit rounded-full border px-2 py-1 text-xs font-semibold ${statusTone(severity)}`}
                  >
                    {severity}
                  </span>
                  <div className="flex flex-wrap justify-start gap-1.5 lg:justify-end">
                    {String(breach.status || "open").toLowerCase() !== "closed" && (
                      <Button
                        type="button"
                        size="sm"
                        className="h-8 w-36 gap-1.5 text-xs rounded-md bg-cs-primary text-white hover:bg-cs-primary/90 shadow-sm"
                        onClick={() => breach.breach_id && void updateBreachStatus(breach.breach_id, "closed")}
                      >
                        <CheckCircle2 className="h-3.5 w-3.5 text-white" />
                        Mark Closed
                      </Button>
                    )}
                  </div>
                </div>

                {/* Expanded details are now in the Dialog below */}
              </div>
            );
          })}
        </section>
      )}

      <Dialog open={!!expandedId} onOpenChange={(open) => !open && setExpandedId(null)}>
        {(() => {
          const breach = expandedId ? groupedRecoveries.find(g => g.breach.breach_id === expandedId)?.breach : null;
          if (!breach) return null;
          const kpi = kpiById.get(breach.kpi_id);
          const expected = expectedFor(breach, kpi);
          const actual = `${breach.actual_value ?? "N/A"} ${breach.actual_unit || kpi?.unit || ""}`.trim();
          const partyRole = (kpi?.party_role || breach.source_kpi?.party_role || "").toLowerCase();
          const isSupplierBreach = partyRole === "supplier";
          const variance = breach.variance_percent
            ? `${Math.abs(toNumber(breach.variance_percent) || 0)}%`
            : breach.variance
              ? money(Math.abs(toNumber(breach.variance) || 0), "USD")
              : null;
          const penalty = Math.abs(
            toNumber(breach.penalty_amount) ||
            toNumber(kpi?.consequence_value) ||
            0,
          );
          const reminders = actionLogs[breach.breach_id] || [];
          const breachStatus = String(breach.status || "open").toLowerCase();
          const isInAction = breachStatus === "in_action";
          const isReceived = receivedStatuses.has(breachStatus);
          const allFollowUps = (isInAction || isReceived) ? [
            {
              dispatch_id: `initial-esc-${breach.breach_id}`,
              audience: "Client (Escalation Alert)",
              recipient: breach.breach_email_to || kpi?.contact_email || MOCK_ACCOUNT_EMAIL,
              sent_at: breach.updated_at || breach.timestamp || new Date().toISOString(),
              status: "mock_dispatched"
            },
            ...reminders
          ] : reminders;

          return (
            <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col overflow-hidden rounded-[20px] p-0 gap-0 border border-gray-200 shadow-xl bg-white">
              <DialogHeader className="sr-only">
                <DialogTitle>Recovery details</DialogTitle>
                <DialogDescription>Details for {kpi?.name || breach.source_kpi?.name || breach.kpi_id}</DialogDescription>
              </DialogHeader>

              <div className="flex items-center justify-between border-b border-gray-200 p-[22px_24px_18px] bg-white shrink-0">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] border border-green-200 bg-green-50">
                    <Handshake className="h-[18px] w-[18px] text-green-600 stroke-2" />
                  </div>
                  <div>
                    <h4 className="text-[12px] font-bold text-gray-400 mb-1 leading-none">
                      Recovery in progress
                    </h4>
                    <p className="text-[17px] font-bold text-gray-950 leading-[1.3] m-0">
                      Recovery details
                    </p>
                  </div>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-[20px_24px_24px] bg-white">
                <div className="flex items-center justify-between bg-green-50 border border-green-200 rounded-[14px] p-[16px_20px] mb-4">
                  <div>
                    <div className="text-[11px] font-bold text-green-800 mb-[5px]">Penalty eligibility</div>
                    <div className="text-[28px] font-extrabold text-green-900 tracking-[-0.01em]">{penalty ? money(penalty, "USD") : "Not eligible"}</div>
                  </div>
                  {variance && (
                    <span className="text-[12px] font-semibold text-green-800 bg-white border border-green-200 px-[12px] py-[5px] rounded-full">
                      {variance} variance
                    </span>
                  )}
                </div>

                <VarianceComparison expected={expected} actual={actual} />

                <h5 className="text-[12px] font-bold text-gray-500 mb-2">Remedy</h5>
                <p className="text-[14px] leading-[1.6] text-gray-950 mb-[18px]">
                  {breach.remediation || kpi?.remediation || defaultRemediationText(kpi, breach)}
                </p>

                <div className="grid grid-cols-2 gap-x-5 gap-y-3.5 mb-5">
                  <div className="flex flex-col gap-1">
                    <span className="text-[12px] font-semibold text-gray-500">Data source</span>
                    <span className="text-[13.5px] font-semibold text-gray-950">{humanizeSourceLabel(breach.source)}</span>
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="text-[12px] font-semibold text-gray-500">Flagged escalation email</span>
                    <span className="text-[13.5px] font-semibold text-cs-primary break-all">
                      {breach.breach_email_to || kpi?.contact_email || "No contact on file"}
                    </span>
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="text-[12px] font-semibold text-gray-500">SLA</span>
                    <span className="text-[13.5px] font-medium text-gray-400">
                      {breach.remediation_sla || kpi?.remediation_sla || "Not specified"}
                    </span>
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="text-[12px] font-semibold text-gray-500">Trigger</span>
                    <span className="text-[13.5px] font-medium text-gray-400">
                      {breach.penalty_triggered || kpi?.trigger_condition || "Not specified"}
                    </span>
                  </div>
                </div>

                <div className="bg-gray-50 border border-gray-200 rounded-[14px] p-[14px_18px] mb-5">
                  <div className="text-[12px] font-bold text-gray-600 mb-3">
                    Follow-up actions
                  </div>
                  {!allFollowUps.length ? (
                    <p className="text-xs text-gray-500 m-0">No actions recorded.</p>
                  ) : (
                    <div className="flex flex-col gap-2">
                      {allFollowUps.map((reminder) => (
                        <div
                          key={reminder.dispatch_id}
                          className="flex items-center gap-[10px]"
                        >
                          <div className="w-[18px] h-[18px] text-green-600 shrink-0">
                            <CheckCircle2 className="w-[18px] h-[18px]" />
                          </div>
                          <div className="flex-1 text-[13px] text-gray-950 truncate">
                            <span className="font-semibold">{reminder.audience === "team_owner" ? "Team escalation alert" : "Client escalation alert"}</span>
                            <span className="text-gray-400 mx-1">→</span>
                            {reminder.recipient}
                          </div>
                          <span className="text-[12px] text-gray-400 whitespace-nowrap shrink-0">
                            {formatDateTime(reminder.sent_at)}
                          </span>
                          <span className="text-[11.5px] font-semibold text-gray-600 bg-white border border-gray-200 px-[9px] py-[3px] rounded-full whitespace-nowrap ml-[10px] shrink-0">
                            {reminder.status === "mock_dispatched" ? "Sent (test mode)" : titleCase(reminder.status)}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="flex justify-end gap-[10px] pt-[14px] border-t border-gray-200">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        type="button"
                        variant="outline"
                        className="w-[38px] h-[38px] p-[10px] rounded-[9px] border-gray-200 text-gray-600 bg-white"
                        disabled={isSending}
                        aria-label="More recovery actions"
                      >
                        <MoreHorizontal className="w-[15px] h-[15px]" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-44">
                      <DropdownMenuItem
                        disabled={
                          !breach.is_breach ||
                          notifyingTeamBreachId === breach.breach_id ||
                          !!breach.team_notified_at
                        }
                        onClick={() => void handleNotifyTeam(breach, kpi)}
                      >
                        {notifyingTeamBreachId === breach.breach_id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : breach.team_notified_at ? (
                          <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                        ) : (
                          <Bell className="h-4 w-4" />
                        )}
                        {notifyingTeamBreachId === breach.breach_id
                          ? "Notifying..."
                          : breach.team_notified_at
                            ? "Team notified"
                            : "Notify team"}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                  {isSupplierBreach && (
                    <Button
                      type="button"
                      variant="outline"
                      className="h-[38px] px-[16px] text-[13.5px] font-semibold gap-[7px] rounded-[9px] border-gray-200 text-gray-600 bg-white hover:bg-gray-50"
                      onClick={() => void sendReminder(breach, "client")}
                      disabled={isSending || !isInAction}
                    >
                      <Send className="w-[15px] h-[15px]" />
                      Remind client
                    </Button>
                  )}
                  {String(breach.status || "open").toLowerCase() !== "closed" && (
                    <Button
                      type="button"
                      className="h-[38px] px-[16px] text-[13.5px] font-semibold gap-[7px] rounded-[9px] bg-cs-primary text-white border border-cs-primary hover:bg-cs-primary/90"
                      onClick={() => {
                        if (breach.breach_id) {
                           void updateBreachStatus(breach.breach_id, "closed");
                           setExpandedId(null);
                        }
                      }}
                    >
                      <CheckCircle2 className="w-[15px] h-[15px]" />
                      Mark as closed
                    </Button>
                  )}
                </div>
              </div>
            </DialogContent>
          );
        })()}
      </Dialog>

      <Dialog open={!!alertDraft} onOpenChange={(open) => !open && setAlertDraft(null)}>
        <DialogContent className="max-w-2xl p-0 overflow-hidden bg-white border-0 shadow-xl sm:rounded-lg">
          <DialogHeader className="sr-only">
            <DialogTitle>Message Sent</DialogTitle>
          </DialogHeader>
          {alertDraft && (
            <div className="w-full">
            <div className="flex flex-col items-center justify-center py-12 px-6 text-center">
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100">
                <CheckCircle2 className="h-8 w-8 text-emerald-600" />
              </div>
              <h3 className="text-xl font-semibold text-gray-950 mb-2">Follow up message sent</h3>
              <p className="mb-8 max-w-sm text-sm text-gray-500">
                The follow up message has been successfully dispatched.
              </p>
              <Button
                type="button"
                variant="outline"
                className="w-full max-w-[200px]"
                onClick={() => setAlertDraft(null)}
              >
                Close
              </Button>
            </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!notifyConfirmName} onOpenChange={(open) => !open && setNotifyConfirmName(null)}>
        <DialogContent className="max-w-sm p-0 overflow-hidden bg-white border-0 shadow-xl sm:rounded-lg">
          <DialogHeader className="sr-only">
            <DialogTitle>Team notified</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col items-center gap-3 px-6 py-8 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50 border border-emerald-200">
              <CheckCircle2 className="h-6 w-6 text-emerald-600" />
            </div>
            <div>
              <p className="text-[15px] font-bold text-gray-950">Team notified</p>
              <p className="mt-1.5 text-[13px] text-gray-500">
                An internal alert was sent to your team for &ldquo;{notifyConfirmName}&rdquo;.
              </p>
            </div>
            <Button
              type="button"
              className="mt-2 w-full bg-cs-primary text-white hover:bg-cs-primary/90"
              onClick={() => setNotifyConfirmName(null)}
            >
              Done
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function LogsPanel({
  actuals,
  kpiById,
  sourceConfigs,
  sourceRuns,
  runDetails,
  onLoadRunDetail,
}: {
  actuals: ContractKPIActual[];
  kpiById: Map<string, ContractKPI>;
  sourceConfigs: KPISourceConfig[];
  sourceRuns: Record<string, KPISourceFetchRun[]>;
  runDetails: Record<string, KPISourceRunDetail | { error: string }>;
  onLoadRunDetail: (
    sourceConfigId: string,
    runId: string,
  ) => void | Promise<void>;
}) {
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null);
  const sourceById = useMemo(
    () =>
      new Map(sourceConfigs.map((source) => [source.source_config_id, source])),
    [sourceConfigs],
  );
  const runs = useMemo(
    () =>
      sourceConfigs
        .flatMap((source) =>
          (sourceRuns[source.source_config_id] || []).map((run) => ({
            ...run,
            source_config_id: run.source_config_id || source.source_config_id,
          })),
        )
        .sort(
          (left, right) =>
            new Date(right.started_at || right.finished_at || 0).getTime() -
            new Date(left.started_at || left.finished_at || 0).getTime(),
        ),
    [sourceConfigs, sourceRuns],
  );
  const totalRecords = runs.reduce(
    (total, run) => total + Number(run.records_fetched || 0),
    0,
  );
  const totalCreated = runs.reduce(
    (total, run) =>
      total + Number(run.created_actual_count || run.records_accepted || 0),
    0,
  );

  const toggleRun = (run: KPISourceFetchRun) => {
    const next = expandedRunId === run.run_id ? null : run.run_id;
    setExpandedRunId(next);
    if (next) void onLoadRunDetail(run.source_config_id, run.run_id);
  };

  return (
    <section className="rounded-lg border border-gray-200 bg-white">
      <div className="flex flex-col gap-3 border-b border-gray-100 p-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="text-base font-semibold text-gray-950">
            Performance Logs
          </h2>
          <p className="mt-1 text-xs text-gray-500">
            Source fetch runs, records accepted, duplicate skips, and generated
            contract breaches.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Pill tone="blue">{runs.length} fetch runs</Pill>
          <Pill tone="emerald">{totalRecords} records fetched</Pill>
          <Pill tone="gray">{totalCreated} actuals created</Pill>
        </div>
      </div>
      {!runs.length ? (
        <div className="px-6 py-16 text-center text-sm text-gray-500">
          No source fetch runs yet.
          {actuals.length
            ? ` ${actuals.length} uploaded actual${actuals.length === 1 ? "" : "s"} exist outside the source ledger.`
            : ""}
        </div>
      ) : (
        <div className="divide-y divide-gray-100">
          {runs.map((run) => {
            const source = sourceById.get(run.source_config_id);
            const expanded = expandedRunId === run.run_id;
            const detail = runDetails[run.run_id];
            const detailError =
              detail && "error" in detail ? detail.error : null;
            const runDetail = detail && !("error" in detail) ? detail : null;
            const normalizedRows =
              runDetail?.normalized_rows ||
              runDetail?.fetch_run?.normalized_preview ||
              run.normalized_preview ||
              [];
            const skippedRows =
              runDetail?.skipped_rows ||
              runDetail?.fetch_run?.skipped_rows ||
              run.skipped_rows ||
              [];
            const rawRows = (runDetail?.raw_records || []).map((raw) => ({
              row: raw.row_index,
              status: raw.processing_status,
              kpi_ids: (raw.mapped_kpi_ids || []).join(", "),
              payload: raw.raw_payload,
            }));
            const createdActuals = runDetail?.created_actuals || [];
            const createdBreaches = runDetail?.created_breaches || [];
            const actualRows = createdActuals.map((actual) => {
              const kpi = kpiById.get(actual.kpi_id);
              return {
                actual_id: actual.actual_id,
                kpi: kpi?.name || actual.kpi_id,
                value: actualLabel(actual, kpi),
                timestamp: formatDateTime(actualTimestamp(actual)),
                period: actual.metadata?.period,
                record_id:
                  actual.metadata?.source_record_id ||
                  actual.metadata?.source_dedupe_key ||
                  actual.metadata?.record_id,
              };
            });
            const breachRows = createdBreaches.map((breach) => {
              const kpi = kpiById.get(breach.kpi_id);
              return {
                breach_id: breach.breach_id,
                kpi: kpi?.name || breach.kpi_id,
                status: breach.is_breach ? "flagged" : "clear",
                severity: severityFor(breach, kpi),
                expected: expectedFor(breach, kpi),
                actual:
                  `${breach.actual_value ?? "N/A"} ${breach.actual_unit || kpi?.unit || ""}`.trim(),
              };
            });

            return (
              <div key={run.run_id} className="bg-white">
                <div className="grid gap-3 p-4 lg:grid-cols-[150px_minmax(220px,1fr)_minmax(240px,1.2fr)_120px_120px_90px] lg:items-center">
                  <div>
                    <p className="text-sm font-semibold text-gray-950">
                      {runDisplayTime(run)}
                    </p>
                    <p className="mt-0.5 text-xs text-gray-400">
                      {runDuration(run)} fetch time
                    </p>
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-gray-950">
                      {source?.display_name || run.source_config_id}
                    </p>
                    <p className="mt-0.5 text-xs text-gray-400">
                      {titleCase(
                        source?.source_type || run.source_type || "source",
                      )}{" "}
                      ·{" "}
                      {source
                        ? ingestionModeLabel(source)
                        : titleCase(run.trigger_type || "manual")}
                    </p>
                  </div>
                  <p className="min-w-0 truncate font-mono text-xs text-gray-500">
                    {sourceEndpointLabel(source)}
                  </p>
                  <span
                    className={`w-fit rounded-full border px-2 py-1 text-xs font-semibold ${statusTone(run.status || "completed")}`}
                  >
                    {titleCase(run.status || "completed")}
                  </span>
                  <div>
                    <p className="text-sm font-semibold text-gray-950">
                      {run.records_fetched || 0} records
                    </p>
                    <p className="mt-0.5 text-xs text-gray-400">
                      {run.records_skipped || 0} skipped
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 justify-self-start text-xs text-gray-500 lg:justify-self-end"
                    onClick={() => toggleRun(run)}
                  >
                    Details
                    <ChevronDown
                      className={`ml-1 h-3.5 w-3.5 transition-transform ${expanded ? "rotate-180" : ""}`}
                    />
                  </Button>
                </div>

                {expanded && (
                  <div className="space-y-3 border-t border-gray-100 bg-gray-50 p-4">
                    <div className="grid gap-2 md:grid-cols-4">
                      <DetailTile
                        label="Accepted Rows"
                        value={`${run.records_accepted || createdActuals.length || 0}`}
                        tone="blue"
                      />
                      <DetailTile
                        label="Created Actuals"
                        value={`${run.created_actual_count ?? createdActuals.length}`}
                      />
                      <DetailTile
                        label="Generated Flags"
                        value={`${run.created_breach_count ?? createdBreaches.length}`}
                        tone={
                          run.created_breach_count || createdBreaches.length
                            ? "amber"
                            : "gray"
                        }
                      />
                      <DetailTile
                        label="Skipped Rows"
                        value={`${run.records_skipped || skippedRows.length || 0}`}
                        tone={
                          run.records_skipped || skippedRows.length
                            ? "amber"
                            : "gray"
                        }
                      />
                    </div>

                    {detailError ? (
                      <div className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800">
                        {detailError}
                      </div>
                    ) : !detail ? (
                      <div className="flex items-center rounded-md border border-gray-200 bg-white px-3 py-3 text-sm text-gray-500">
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Loading fetched records...
                      </div>
                    ) : (
                      <div className="grid gap-3 xl:grid-cols-2">
                        <RunPreviewBlock
                          title="Created Actuals"
                          rows={actualRows}
                          empty="No actuals were created in this run."
                        />
                        <RunPreviewBlock
                          title="Skipped / Duplicate Rows"
                          rows={skippedRows}
                          empty="No skipped rows for this run."
                        />
                        <RunPreviewBlock
                          title="Raw Parking Layer"
                          rows={rawRows}
                          empty="No raw rows were parked for this run."
                        />
                        <RunPreviewBlock
                          title="Accepted Normalized Rows"
                          rows={normalizedRows}
                          empty="No normalized rows were stored for this run."
                        />
                        <RunPreviewBlock
                          title="Generated Flags"
                          rows={breachRows}
                          empty="No contract breaches were generated in this run."
                        />
                      </div>
                    )}
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

// ---------------------------------------------------------------------------
// KPI Tracking Heatmap Panel
// ---------------------------------------------------------------------------

const IATA_METRIC_CATEGORIES = [
  { key: "ground_handling", label: "Ground Handling" },
  { key: "refuelling", label: "Refuelling" },
  { key: "turnover_time", label: "Turnover Time" },
  { key: "de_icing", label: "De-Icing" },
  { key: "security", label: "Security" },
  { key: "baggage", label: "Baggage" },
  { key: "catering", label: "Catering" },
  { key: "passenger", label: "Passenger Svcs" },
];

function classifyKpiToCategory(kpi: ContractKPI): string {
  const text =
    `${kpi.name} ${kpi.description || ""} ${quoteFor(kpi)} ${kpi.kpi_type || ""} ${kpi.structural_path || ""} ${kpi.scope || ""}`.toLowerCase();
  if (/refuel|fuel|tanker|uplift/.test(text)) return "refuelling";
  if (/turnaround|turnover|gate|stand|taxi/.test(text)) return "turnover_time";
  if (/de.?ic|anti.?ic|deicing/.test(text)) return "de_icing";
  if (/secur|screening|access/.test(text)) return "security";
  if (/baggage|luggage|bag/.test(text)) return "baggage";
  if (/catering|meal|food|beverage/.test(text)) return "catering";
  if (/passenger|pax|boarding|check.?in/.test(text)) return "passenger";
  return "ground_handling";
}

function KpiHeatmapPanel({
  kpis,
  actuals,
  breaches,
}: {
  kpis: ContractKPI[];
  actuals: ContractKPIActual[];
  breaches: ContractKPIBreach[];
}) {
  const trackedKpis = kpis.filter(isKpiTracked);
  const acceptedKpis = kpis.filter((k) => k.status === "approved");
  const breachKpiIds = new Set(
    breaches
      .filter((b) => b.is_breach && b.status !== "resolved")
      .map((b) => b.kpi_id),
  );
  const actualKpiIds = new Set(actuals.map((a) => a.kpi_id));

  const cellStatus = (
    kpi: ContractKPI,
  ):
    | "tracked_clear"
    | "tracked_breach"
    | "accepted"
    | "deferred"
    | "ignored" => {
    if (kpi.status === "ignored") return "ignored";
    if (!isKpiTracked(kpi))
      return kpi.status === "approved" ? "accepted" : "deferred";
    if (breachKpiIds.has(kpi.kpi_id)) return "tracked_breach";
    return "tracked_clear";
  };

  const statusMeta = {
    tracked_clear: {
      dot: "bg-emerald-500",
      label: "Tracked · Clear",
      text: "text-emerald-700",
      bg: "bg-emerald-50 border-emerald-200",
    },
    tracked_breach: {
      dot: "bg-[#EE3224]",
      label: "Tracked · Breach",
      text: "text-[#EE3224]",
      bg: "bg-red-50 border-red-200",
    },
    accepted: {
      dot: "bg-[#015CA9]",
      label: "Accepted · Not tracked",
      text: "text-[#015CA9]",
      bg: "bg-blue-50 border-blue-200",
    },
    deferred: {
      dot: "bg-gray-300",
      label: "Deferred",
      text: "text-gray-500",
      bg: "bg-gray-50 border-gray-200",
    },
    ignored: {
      dot: "bg-gray-200",
      label: "Ignored",
      text: "text-gray-300",
      bg: "bg-gray-50 border-gray-100",
    },
  };

  const byCategory: Record<string, ContractKPI[]> = {};
  IATA_METRIC_CATEGORIES.forEach((cat) => {
    byCategory[cat.key] = [];
  });
  kpis.forEach((kpi) => {
    const cat = classifyKpiToCategory(kpi);
    if (!byCategory[cat]) byCategory[cat] = [];
    byCategory[cat].push(kpi);
  });

  const visibleCategories = IATA_METRIC_CATEGORIES.filter(
    (cat) => byCategory[cat.key]?.length > 0,
  );

  const summary = {
    tracked_clear: trackedKpis.filter((k) => !breachKpiIds.has(k.kpi_id))
      .length,
    tracked_breach: [...breachKpiIds].filter((id) =>
      kpis.find((k) => k.kpi_id === id && isKpiTracked(k)),
    ).length,
    accepted: acceptedKpis.filter((k) => !isKpiTracked(k)).length,
    deferred: kpis.filter(
      (k) =>
        k.status !== "approved" && k.status !== "ignored" && !isKpiTracked(k),
    ).length,
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-4">
        {[
          {
            displayLabel: "Tracked Clear",
            value: summary.tracked_clear,
            meta: statusMeta.tracked_clear,
          },
          {
            displayLabel: "Active Breaches",
            value: summary.tracked_breach,
            meta: statusMeta.tracked_breach,
          },
          {
            displayLabel: "Accepted",
            value: summary.accepted,
            meta: statusMeta.accepted,
          },
          {
            displayLabel: "Deferred",
            value: summary.deferred,
            meta: statusMeta.deferred,
          },
        ].map((item) => (
          <div
            key={item.displayLabel}
            className={`rounded-lg border p-4 ${item.meta.bg}`}
          >
            <p
              className={`text-[10px] font-bold uppercase tracking-wider ${item.meta.text}`}
            >
              {item.displayLabel}
            </p>
            <p className="mt-2 text-3xl font-semibold text-gray-950">
              {item.value}
            </p>
          </div>
        ))}
      </div>

      {visibleCategories.length > 0 && (
        <section className="rounded-lg border border-gray-200 bg-white">
          <div className="border-b border-gray-100 px-5 py-4">
            <h2 className="text-base font-semibold text-gray-950">
              Coverage by Service Category
            </h2>
            <p className="mt-1 text-xs text-gray-500">
              KPI obligation density per IATA operational service area.
            </p>
          </div>
          <div className="grid gap-0 divide-y divide-gray-100">
            {visibleCategories.map((cat) => {
              const catKpis = byCategory[cat.key] || [];
              const catTracked = catKpis.filter(isKpiTracked).length;
              const catBreaches = catKpis.filter((k) =>
                breachKpiIds.has(k.kpi_id),
              ).length;
              const coverage = catKpis.length
                ? Math.round((catTracked / catKpis.length) * 100)
                : 0;
              const breachPercent = catKpis.length
                ? Math.round((catBreaches / catKpis.length) * 100)
                : 0;
              const greenPercent = catKpis.length
                ? Math.round((Math.max(0, catTracked - catBreaches) / catKpis.length) * 100)
                : 0;
              return (
                <div
                  key={cat.key}
                  className="grid items-center gap-4 px-5 py-3 sm:grid-cols-[160px_1fr_80px_80px_80px]"
                >
                  <p className="text-sm font-semibold text-gray-900">
                    {cat.label}
                  </p>
                  <div className="h-2 rounded-full bg-gray-100 overflow-hidden flex w-full">
                    {breachPercent > 0 && (
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${breachPercent}%` }}
                        transition={{ duration: 0.8, ease: "easeOut" }}
                        className="h-full bg-[#EE3224]"
                      />
                    )}
                    {greenPercent > 0 && (
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${greenPercent}%` }}
                        transition={{ duration: 0.8, ease: "easeOut" }}
                        className="h-full bg-emerald-500"
                      />
                    )}
                  </div>
                  <p className="text-center text-xs font-semibold text-gray-700">
                    {catKpis.length} KPIs
                  </p>
                  <p className="text-center text-xs font-semibold text-emerald-700">
                    {catTracked} tracked
                  </p>
                  <p
                    className={`text-center text-xs font-semibold ${catBreaches > 0 ? "text-[#EE3224]" : "text-gray-400"}`}
                  >
                    {catBreaches} breach{catBreaches !== 1 ? "es" : ""}
                  </p>
                </div>
              );
            })}
          </div>
        </section>
      )}

      <section className="rounded-lg border border-gray-200 bg-white">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between border-b border-gray-100 px-5 py-4 gap-4">
          <div>
            <h2 className="text-base font-semibold text-gray-950">
              KPI Tracking Matrix
            </h2>
            <p className="mt-1 text-xs text-gray-500">
              Operational clause coverage across IATA service categories. Each
              cell represents a tracked obligation and its current compliance
              state.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            {Object.entries(statusMeta)
              .filter(([k]) => k !== "ignored")
              .map(([key, meta]) => (
                <div key={key} className="flex items-center gap-1.5">
                  <span className={`h-2.5 w-2.5 rounded-full ${meta.dot}`} />
                  <span className="text-xs text-gray-500">{meta.label}</span>
                </div>
              ))}
          </div>
        </div>

        {!kpis.length ? (
          <div className="px-5 py-12 text-center text-sm text-gray-500">
            No KPIs extracted yet. Run extraction from the header to populate
            the matrix.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full border-collapse text-left text-xs">
              <thead>
                <tr className="bg-gray-50">
                  <th className="sticky left-0 z-10 bg-gray-50 px-4 py-3 text-[10px] font-bold uppercase tracking-wide text-gray-400 min-w-[200px]">
                    Obligation / KPI
                  </th>
                  {IATA_METRIC_CATEGORIES.map((cat) => (
                    <th
                      key={cat.key}
                      className="px-3 py-3 text-[10px] font-bold uppercase tracking-wide text-gray-400 min-w-[120px] text-center"
                    >
                      {cat.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {kpis
                  .filter((k) => k.status !== "ignored")
                  .slice(0, 40)
                  .map((kpi) => {
                    const kpiCategory = classifyKpiToCategory(kpi);
                    const status = cellStatus(kpi);
                    const meta = statusMeta[status];
                    return (
                      <tr key={kpi.kpi_id} className="hover:bg-gray-50/60">
                        <td className="sticky left-0 z-10 bg-white px-4 py-2.5 hover:bg-gray-50/60">
                          <div className="flex items-start gap-2">
                            <span
                              className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${meta.dot}`}
                            />
                            <div className="min-w-0">
                              <p className="truncate max-w-[180px] text-xs font-semibold text-gray-900">
                                {kpi.name}
                              </p>
                              <p
                                className={`text-[10px] font-medium ${meta.text}`}
                              >
                                {meta.label}
                              </p>
                            </div>
                          </div>
                        </td>
                        {IATA_METRIC_CATEGORIES.map((cat) => {
                          const isMatch = cat.key === kpiCategory;
                          return (
                            <td
                              key={cat.key}
                              className="px-3 py-2.5 text-center"
                            >
                              {isMatch ? (
                                <motion.span
                                  initial={{ scale: 0.5, opacity: 0 }}
                                  animate={{ scale: 1, opacity: 1 }}
                                  transition={{ duration: 0.3 }}
                                  className={`inline-flex h-6 w-6 items-center justify-center rounded-full border ${meta.bg}`}
                                >
                                  <span
                                    className={`h-2.5 w-2.5 rounded-full ${meta.dot}`}
                                  />
                                </motion.span>
                              ) : (
                                <span className="inline-block h-1 w-4 rounded-full bg-gray-100" />
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        )}


      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Source Configuration Modal (REST API, SAP, Oracle, File connectors)
// ---------------------------------------------------------------------------

interface SourceConfigModalProps {
  source: KPISourceConfig;
  onClose: () => void;
  onSave: (updates: Partial<KPISourceConfig>) => Promise<void>;
  onTest: (updates: Partial<KPISourceConfig>) => Promise<any>;
  isSaving: boolean;
}

function SourceConfigModal({
  source,
  onClose,
  onSave,
  onTest,
  isSaving,
}: SourceConfigModalProps) {
  const isApiType = [
    "rest_api",
    "oracle_fusion",
    "sap_s4hana",
    "sap_ariba",
    "oracle_db",
  ].includes(source.source_type);
  const isErp = [
    "oracle_fusion",
    "sap_s4hana",
    "sap_ariba",
    "oracle_db",
  ].includes(source.source_type);

  const defaults = SOURCE_CONFIG_DEFAULTS[source.source_type] || {};

  const [endpoint, setEndpoint] = useState(
    source.endpoint || defaults.endpoint || "",
  );
  const [method, setMethod] = useState(
    source.method || defaults.method || "GET",
  );
  const [authType, setAuthType] = useState(
    source.auth_type || defaults.auth_type || "none",
  );
  const [credentialRef, setCredentialRef] = useState("");
  const [recordPath, setRecordPath] = useState(
    source.record_path || source.data_path || "",
  );
  const [displayName, setDisplayName] = useState(source.display_name || "");
  const [cadence, setCadence] = useState(source.schedule?.cadence || "manual");
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);
  const [testData, setTestData] = useState<Array<Record<string, any>>>([]);
  const [sapRecords, setSapRecords] = useState(() => {
    if (source.source_type !== "sap_s4hana") return "";
    const payload = source.sample_payload;
    return payload == null
      ? JSON.stringify({ value: [] }, null, 2)
      : typeof payload === "string"
        ? payload
        : JSON.stringify(payload, null, 2);
  });

  const handleSave = async () => {
    let sapPayload: unknown;
    if (source.source_type === "sap_s4hana" && sapRecords.trim()) {
      try {
        sapPayload = JSON.parse(sapRecords);
      } catch {
        setTestResult({ ok: false, message: "SAP records must be valid JSON." });
        return;
      }
      if (!sapPayload || typeof sapPayload !== "object" || !Array.isArray((sapPayload as { value?: unknown }).value)) {
        setTestResult({ ok: false, message: 'SAP records must use an OData-style { "value": [...] } payload.' });
        return;
      }
    }
    const updates: Partial<KPISourceConfig> = {
      display_name: displayName || source.display_name,
      endpoint: endpoint || undefined,
      method: method || "GET",
      auth_type: authType,
      credential_ref: credentialRef || undefined,
      record_path: recordPath || undefined,
      schedule: { ...(source.schedule || {}), cadence },
      status: endpoint ? "mapped" : source.status || "draft",
      enabled: cadence !== "manual",
      ...(source.source_type === "sap_s4hana" && sapRecords.trim()
        ? { sample_payload: sapPayload }
        : {}),
    };
    await onSave(updates);
    onClose();
  };

  const handleTest = async () => {
    setIsTesting(true);
    setTestResult(null);
    setTestData([]);
    try {
      const result = await onTest({
        display_name: displayName || source.display_name,
        endpoint: endpoint || undefined,
        method: method || "GET",
        auth_type: authType,
        credential_ref: credentialRef || undefined,
        record_path: recordPath || undefined,
        schedule: { ...(source.schedule || {}), cadence },
        enabled: cadence !== "manual",
        status: endpoint ? "mapped" : source.status || "draft",
      });
      const connection = result?.connection;
      const availableData = result?.available_data || [];
      setTestData(
        Array.isArray(availableData) ? availableData.slice(0, 5) : [],
      );
      setTestResult({
        ok: Boolean(connection?.ok),
        message: connection?.ok
          ? `Connection succeeded. ${availableData.length || result?.fetch_run?.records_fetched || 0} sample row(s) detected; ${result?.schema_fields?.length || 0} fields available to map.`
          : (connection?.errors || ["Connection test failed."]).join(" "),
      });
    } catch (error) {
      setTestResult({
        ok: false,
        message:
          error instanceof Error ? error.message : "Connection test failed.",
      });
    } finally {
      setIsTesting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <div className="w-full max-w-2xl rounded-lg border border-gray-200 bg-white shadow-lg">
        <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
          <div>
            <h3 className="text-base font-semibold text-gray-950">
              Configure Source
            </h3>
            <p className="mt-0.5 text-xs text-gray-500">
              {source.display_name} · {sourceTypeLabel(source.source_type)}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 px-6 py-5 max-h-[60vh] overflow-y-auto">
          {defaults.note && (
            <div className="rounded-md border border-[#015CA9]/20 bg-[#015CA9]/5 px-3 py-2.5 text-xs text-[#015CA9] leading-relaxed">
              {defaults.note}
            </div>
          )}

          <label className="block">
            <span className="text-[10px] font-bold uppercase tracking-wide text-gray-500">
              Display Name
            </span>
            <input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="mt-1 h-9 w-full rounded-md border border-gray-200 px-3 text-sm text-gray-800 focus:border-[#015CA9] focus:outline-none focus:ring-1 focus:ring-[#015CA9]"
              placeholder={source.display_name}
            />
          </label>

          {isApiType && (
            <>
              <label className="block">
                <span className="text-[10px] font-bold uppercase tracking-wide text-gray-500">
                  {isErp ? "Base API Endpoint / Host" : "Endpoint URL"}
                </span>
                <input
                  value={endpoint}
                  onChange={(e) => setEndpoint(e.target.value)}
                  className="mt-1 h-9 w-full rounded-md border border-gray-200 px-3 font-mono text-xs text-gray-800 focus:border-[#015CA9] focus:outline-none focus:ring-1 focus:ring-[#015CA9]"
                  placeholder={
                    defaults.endpoint || "https://api.example.com/v1/kpi-data"
                  }
                />
              </label>

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="text-[10px] font-bold uppercase tracking-wide text-gray-500">
                    HTTP Method
                  </span>
                  <select
                    value={method}
                    onChange={(e) => setMethod(e.target.value)}
                    className="mt-1 h-9 w-full rounded-md border border-gray-200 bg-white px-3 text-sm text-gray-800 focus:border-[#015CA9] focus:outline-none"
                  >
                    {["GET", "POST", "PUT"].map((m) => (
                      <option key={m}>{m}</option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="text-[10px] font-bold uppercase tracking-wide text-gray-500">
                    Authentication
                  </span>
                  <select
                    value={authType}
                    onChange={(e) => setAuthType(e.target.value)}
                    className="mt-1 h-9 w-full rounded-md border border-gray-200 bg-white px-3 text-sm text-gray-800 focus:border-[#015CA9] focus:outline-none"
                  >
                    {[
                      "none",
                      "bearer",
                      "basic",
                      "api_key",
                      "oauth2",
                      "sap_destination",
                      "password",
                      "wallet",
                    ].map((a) => (
                      <option key={a} value={a}>
                        {titleCase(a)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              {(authType === "bearer" || authType === "api_key") && (
                <label className="block">
                  <span className="text-[10px] font-bold uppercase tracking-wide text-gray-500">
                    Credential Reference
                  </span>
                  <input
                    value={credentialRef}
                    onChange={(e) => setCredentialRef(e.target.value)}
                    className="mt-1 h-9 w-full rounded-md border border-gray-200 px-3 font-mono text-xs text-gray-800 focus:border-[#015CA9] focus:outline-none focus:ring-1 focus:ring-[#015CA9]"
                    placeholder="env:IATA_SOURCE_TOKEN"
                  />
                </label>
              )}
              {(authType === "basic" || authType === "password") && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block">
                    <span className="text-[10px] font-bold uppercase tracking-wide text-gray-500">
                      Credential Reference
                    </span>
                    <input
                      value={credentialRef}
                      onChange={(e) => setCredentialRef(e.target.value)}
                      className="mt-1 h-9 w-full rounded-md border border-gray-200 px-3 font-mono text-xs text-gray-800 focus:border-[#015CA9] focus:outline-none focus:ring-1 focus:ring-[#015CA9]"
                      placeholder="env:IATA_BASIC_CREDENTIAL"
                    />
                  </label>
                  <label className="block">
                    <span className="text-[10px] font-bold uppercase tracking-wide text-gray-500">
                      Secret handling
                    </span>
                    <p className="mt-2 text-xs leading-5 text-gray-500">
                      Username/password values are resolved from the credential
                      reference at fetch time.
                    </p>
                  </label>
                </div>
              )}
              {authType === "oauth2" && (
                <label className="block">
                  <span className="text-[10px] font-bold uppercase tracking-wide text-gray-500">
                    OAuth2 Token Endpoint
                  </span>
                  <input
                    className="mt-1 h-9 w-full rounded-md border border-gray-200 px-3 font-mono text-xs text-gray-800 focus:border-[#015CA9] focus:outline-none focus:ring-1 focus:ring-[#015CA9]"
                    placeholder="https://auth.example.com/oauth/token"
                  />
                </label>
              )}
              {isErp && (
                <label className="block">
                  <span className="text-[10px] font-bold uppercase tracking-wide text-gray-500">
                    ERP resource / data path
                  </span>
                  <input
                    value={recordPath}
                    onChange={(e) => setRecordPath(e.target.value)}
                    className="mt-1 h-9 w-full rounded-md border border-gray-200 px-3 font-mono text-xs text-gray-800 focus:border-[#015CA9] focus:outline-none focus:ring-1 focus:ring-[#015CA9]"
                    placeholder="value / records / items"
                  />
                  <span className="mt-1 block text-[11px] text-gray-500">
                    Test Connection will expose response fields for mapping into
                    tracked KPIs.
                  </span>
                </label>
              )}
              {source.source_type === "sap_s4hana" && (
                <label className="block">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[10px] font-bold uppercase tracking-wide text-gray-500">
                      Add SAP records for preview
                    </span>
                    <button
                      type="button"
                      className="text-[11px] font-semibold text-[#015CA9]"
                      onClick={() => setSapRecords(JSON.stringify({ value: [{ kpi_code: "SGHA-2.7-ELECTRICITY", amount: 119, posting_date: new Date().toISOString(), document_id: "SAP-DOC-001", unit: "SEK" }] }, null, 2))}
                    >
                      Load template
                    </button>
                  </div>
                  <textarea
                    value={sapRecords}
                    onChange={(event) => setSapRecords(event.target.value)}
                    className="mt-1 min-h-40 w-full rounded-md border border-gray-200 px-3 py-2 font-mono text-xs text-gray-800 focus:border-[#015CA9] focus:outline-none focus:ring-1 focus:ring-[#015CA9]"
                    spellCheck={false}
                  />
                  <span className="mt-1 block text-[11px] text-gray-500">
                    Use SAP OData format: <code>{'{ "value": [...] }'}</code>. Save, then click Test Connection to preview these records.
                  </span>
                </label>
              )}
            </>
          )}

          <label className="block">
            <span className="text-[10px] font-bold uppercase tracking-wide text-gray-500">
              Fetch Cadence
            </span>
            <select
              value={cadence}
              onChange={(e) => setCadence(e.target.value)}
              className="mt-1 h-9 w-full rounded-md border border-gray-200 bg-white px-3 text-sm text-gray-800 focus:border-[#015CA9] focus:outline-none"
            >
              <option value="manual">Manual (on demand)</option>
              <option value="hourly">Hourly</option>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
            </select>
          </label>

          {testResult && (
            <div
              className={`rounded-md border px-3 py-2.5 text-xs ${testResult.ok ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-red-200 bg-red-50 text-red-800"}`}
            >
              {testResult.message}
            </div>
          )}
          {testResult?.ok && testData.length > 0 && (
            <div className="rounded-md border border-gray-200 bg-gray-50 p-3">
              <p className="text-[10px] font-bold uppercase tracking-wide text-gray-500">
                Available data preview
              </p>
              <div className="mt-2 overflow-x-auto rounded border border-gray-200 bg-white">
                <table className="min-w-full text-left text-[11px]">
                  <thead className="bg-gray-50 text-gray-400">
                    <tr>
                      {Object.keys(testData[0])
                        .slice(0, 6)
                        .map((key) => (
                          <th key={key} className="px-2 py-1.5 font-semibold">
                            {key}
                          </th>
                        ))}
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      {Object.keys(testData[0])
                        .slice(0, 6)
                        .map((key) => (
                          <td
                            key={key}
                            className="max-w-[160px] truncate px-2 py-1.5 text-gray-700"
                          >
                            {displayCell(testData[0][key])}
                          </td>
                        ))}
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-gray-100 px-6 py-4">
          {isApiType && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-9 gap-1.5 text-xs"
              onClick={handleTest}
              disabled={isTesting || isSaving}
            >
              {isTesting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Zap className="h-3.5 w-3.5" />
              )}
              Test Connection
            </Button>
          )}
          <div className="ml-auto flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-9 text-xs"
              onClick={onClose}
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              className="h-9 bg-[#015CA9] text-xs text-white hover:bg-[#014c8c]"
              onClick={handleSave}
              disabled={isSaving}
            >
              {isSaving ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : null}
              Save Configuration
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
