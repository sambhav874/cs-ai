import type { ProjectStats, DocumentWithProgress, ContractKPI } from "./types";

export const emptyStats: ProjectStats = {
  total_documents: 0,
  uploaded_count: 0,
  processing_count: 0,
  ready_to_edit_count: 0,
  editing_count: 0,
  pending_approval_count: 0,
  rejected_count: 0,
  completed_count: 0,
  error_count: 0,
};

export function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

export function formatDate(dateString?: string) {
  if (!dateString) return "Unknown";
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function truncateMiddle(value: string, maxLength = 42) {
  if (!value || value.length <= maxLength) return value;
  const head = Math.ceil((maxLength - 3) / 2);
  const tail = Math.floor((maxLength - 3) / 2);
  return `${value.slice(0, head)}...${value.slice(value.length - tail)}`;
}

export function isActiveJobStatus(status?: string) {
  return status === "IN_PROGRESS" || status === "PENDING" || status === "QUEUED";
}

export function completedStatusForJob(jobType?: string) {
  switch (jobType) {
    case "indexing":
      return "Indexed";
    case "summarizing":
      return "Summarized";
    case "processing":
      return "Ready to Edit";
    default:
      return "Completed";
  }
}

export function getProcessingLabel(doc: DocumentWithProgress) {
  if (doc.error) return `Error: ${doc.error.message}`;
  if (doc.status === "Ready to Edit" || doc.status === "Summarized" || doc.status === "Indexed" || doc.status === "Ingested" || doc.status === "Completed") {
    return "Ingested";
  }
  if (doc.status === "Approved") {
    return "Approved";
  }
  if (
    doc.status === "queued" ||
    doc.status === "pending" ||
    doc.status === "Syncronizing" ||
    doc.status === "Indexing" ||
    doc.status === "Processing" ||
    doc.status === "Uploaded"
  ) {
    return "Processing";
  }

  return `Processing ${Math.round(doc.progress)}%`;
}

export function statusClass(status: string) {
  switch (status) {
    case "Uploaded":
    case "Indexing":
    case "Summarizing":
    case "Processing":
    case "processing":
    case "pending":
    case "queued":
      return "bg-attention-50 text-attention-700 border-attention-200";
    case "Ready to Edit":
    case "Ready":
    case "Indexed":
    case "Ingested":
    case "Completed":
      return "bg-primary-50 text-primary-700 border-primary-200";
    case "Editing":
      return "bg-info-50 text-info-700 border-info-200";
    case "Approved":
      return "bg-success-50 text-success-700 border-success-200";
    case "Pending Approval":
    case "Pending Your Approval":
      return "bg-info-50 text-info-700 border-info-200";
    case "Submitted":
      return "bg-muted text-muted-foreground border-border";
    case "Rejected":
    case "Error":
    case "error":
      return "bg-destructive/10 text-destructive border-destructive/20";
    default:
      return "bg-muted text-muted-foreground border-border";
  }
}

export function formatKpiType(value?: string) {
  if (!value) return "Obligation";
  return value.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

export function isProjectKpiTracked(kpi?: ContractKPI | null) {
  const trackingStatus = String(kpi?.tracking_status || "").toLowerCase();
  return Boolean(kpi?.is_tracked || trackingStatus === "tracked" || trackingStatus === "active");
}

export function isProjectKpiRecommended(kpi?: ContractKPI | null) {
  const trackingStatus = String(kpi?.tracking_status || "").toLowerCase();
  return Boolean(kpi?.is_recommended || trackingStatus === "recommended");
}

export function getKpiCategory(kpi: ContractKPI): "sla" | "penalty" | "deadline" | "other" {
  const kpiType = String(kpi.kpi_type || "").toLowerCase();
  const recordType = String(kpi.record_type || "").toLowerCase();
  const ruleType = String(kpi.rule_type || kpi.rule?.rule_type || "").toLowerCase();
  if (recordType === "supporting_measurement" || kpiType === "sla" || kpiType === "performance" || ruleType === "tiered" || ruleType === "threshold") {
    return "sla";
  }
  if (recordType === "financial_consequence" || kpiType === "penalty" || kpi.consequence_value != null || kpi.consequence?.value != null) {
    return "penalty";
  }
  if (recordType === "reporting_or_evidence_obligation" || kpiType === "deadline" || kpiType === "notice" || ruleType === "deadline") {
    return "deadline";
  }
  return "other";
}

export function formatKpiValue(kpi: ContractKPI) {
  const ruleType = String(kpi.rule_type || kpi.rule?.rule_type || "").toLowerCase();
  const spec = kpi.rule?.spec || {};

  if (ruleType === "qualitative") {
    return "Qualitative Obligation (Human Judgment)";
  }
  if (ruleType === "tiered") {
    const tiers = spec.tiers || kpi.target_schedule || [];
    if (Array.isArray(tiers) && tiers.length > 0) {
      const summary = tiers
        .map((t: any) => {
          const name = t.tier || t.level || `Tier ${t.min_value ?? ''}`;
          const val = t.credit_pct ? `${t.credit_pct}%` : (t.value ?? t.max_value ?? '?');
          return `${name}: ${val}`;
        })
        .slice(0, 2)
        .join(', ');
      return `Tiered Matrix (${tiers.length} Tiers: ${summary}${tiers.length > 2 ? '...' : ''})`;
    }
    return "Tiered SLA Matrix";
  }
  if (ruleType === "composite") {
    const formula = spec.formula || kpi.formula;
    return formula ? `Formula: ${formula}` : "Composite Derived Metric";
  }
  if (ruleType === "deadline") {
    const grace = spec.grace_days ?? kpi.grace_period_days ?? 0;
    return `Deadline Deliverable${grace > 0 ? ` (+${grace}d grace)` : ''}`;
  }
  if (ruleType === "error_budget") {
    const budget = spec.budget ?? kpi.error_budget;
    return `Error Budget: ${budget ?? 'Specified'} ${kpi.unit || ''}`.trim();
  }

  const bits = [
    kpi.operator && kpi.operator !== "specified" ? kpi.operator.replace(/_/g, " ") : null,
    kpi.value_min != null || kpi.value_max != null || spec.min != null || spec.max != null
      ? `${spec.min ?? kpi.value_min ?? "?"}${spec.max != null || kpi.value_max != null ? ` - ${spec.max ?? kpi.value_max}` : ""}`
      : spec.target ?? kpi.value ?? kpi.target_value,
    kpi.unit && kpi.unit !== "number" ? kpi.unit : null,
  ].filter((item) => item !== null && item !== undefined && `${item}`.trim() !== "");
  return bits.length ? bits.join(" ") : "Structured value pending review";
}

export function formatKpiConsequence(kpi: ContractKPI) {
  const val = kpi.consequence_value != null ? String(kpi.consequence_value) : (kpi.consequence?.value != null ? String(kpi.consequence.value) : null);
  const unit = kpi.consequence_unit || kpi.consequence?.unit || "";
  
  if (val != null) {
    if (unit === "%" || unit === "percent") {
      return `Up to ${val}% Fee Credit`;
    }
    if (unit.toLowerCase().includes("usd") || unit === "$" || unit === "currency") {
      const num = parseFloat(val);
      const formatted = !isNaN(num) ? `$${num.toLocaleString()}` : `$${val}`;
      return `${formatted} Penalty`;
    }
    return `${val} ${unit}`.trim();
  }

  const ruleType = String(kpi.rule_type || kpi.rule?.rule_type || "").toLowerCase();
  const spec = kpi.rule?.spec || {};
  const tiers = spec.tiers || kpi.target_schedule || [];
  if (ruleType === "tiered" && Array.isArray(tiers) && tiers.length > 0) {
    const maxCredit = Math.max(...tiers.map((t: any) => t.credit_pct || 0));
    if (maxCredit > 0) {
      return `Tiered (Up to ${maxCredit}% Credit)`;
    }
  }

  return "—";
}
