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
  if (doc.status === "Ready to Edit") return "Ready to edit";
  if (doc.status === "queued") return "Queued — waiting for service";
  if (doc.status === "pending") return "Waiting";
  if (doc.status === "Summarized") return "Summarized";
  if (doc.status === "Indexed") return "Ingested";
  if (doc.status === "Syncronizing") return "Indexing";

  switch (doc.currentStep) {
    case "indexing":
      return `Indexing ${Math.round(doc.progress)}%`;
    case "summarizing":
      return `Analyzing ${Math.round(doc.progress)}%`;
    case "processing":
      return `Processing ${Math.round(doc.progress)}%`;
    default:
      return `Processing ${Math.round(doc.progress)}%`;
  }
}

export function statusClass(status: string) {
  switch (status) {
    case "Uploaded":
      return "bg-muted text-muted-foreground border-border";
    case "Indexing":
    case "Summarizing":
    case "Processing":
    case "processing":
    case "pending":
    case "queued":
      return "bg-amber-50 text-amber-700 border-amber-200";
    case "Ready to Edit":
    case "Ready":
    case "Indexed":
    case "Ingested":
      return "bg-sky-50 text-sky-700 border-sky-200";
    case "Editing":
      return "bg-indigo-50 text-indigo-700 border-indigo-200";
    case "Pending Approval":
    case "Pending Your Approval":
      return "bg-purple-50 text-purple-700 border-purple-200";
    case "Submitted":
      return "bg-muted text-muted-foreground border-border";
    case "Rejected":
    case "Error":
    case "error":
      return "bg-destructive/10 text-destructive border-destructive/20";
    case "Completed":
      return "bg-emerald-50 text-emerald-700 border-emerald-200";
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

export function formatKpiValue(kpi: ContractKPI) {
  const bits = [
    kpi.operator && kpi.operator !== "specified" ? kpi.operator.replace(/_/g, " ") : null,
    kpi.value_min != null || kpi.value_max != null
      ? `${kpi.value_min ?? "?"}${kpi.value_max != null ? ` - ${kpi.value_max}` : ""}`
      : kpi.value,
    kpi.unit && kpi.unit !== "number" ? kpi.unit : null,
  ].filter((item) => item !== null && item !== undefined && `${item}`.trim() !== "");
  return bits.length ? bits.join(" ") : "Structured value pending review";
}

export function formatKpiConsequence(kpi: ContractKPI) {
  const bits = [
    kpi.consequence_value != null ? String(kpi.consequence_value) : null,
    kpi.consequence_unit || null,
  ].filter((item) => item !== null && item !== undefined && `${item}`.trim() !== "");
  return bits.length ? bits.join(" ") : "None";
}
