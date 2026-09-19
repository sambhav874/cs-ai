import { Check, Download, FileText, PencilLine, ShieldCheck, Trash2 } from "lucide-react";
import { Button } from "@cs/components/ui/button";
import { cn } from "@cs/lib/utils";
import type { AgentArtifact, AgentEditAnnotation } from "@cs/lib/agentMessageFormatting";

export interface ArtifactCardProps {
  artifact: AgentArtifact;
  resolvingEditIds: Set<string>;
  onArtifactCreated?: (artifact: AgentArtifact) => void;
  downloadAgentArtifact: (artifact: AgentArtifact) => void;
  resolveArtifactEdit: (
    artifact: AgentArtifact,
    edit: AgentEditAnnotation,
    mode: "accept" | "reject",
  ) => void;
  resolveArtifactEditsBulk: (
    artifact: AgentArtifact,
    edits: AgentEditAnnotation[],
    mode: "accept" | "reject",
  ) => void;
}

export function ArtifactCard({
  artifact,
  resolvingEditIds,
  onArtifactCreated,
  downloadAgentArtifact,
  resolveArtifactEdit,
  resolveArtifactEditsBulk,
}: ArtifactCardProps) {
  const isKpiExtraction = artifact.artifact_kind === "kpi_extraction" || artifact.type === "kpi_extraction";
  const isProjectFact = artifact.artifact_kind === "project_fact";
  const isRedline = Boolean(artifact.artifact_kind?.includes("redline") || artifact.applied_redline_changes?.length);
  const changeCount = artifact.applied_redline_changes?.length ?? artifact.redline_changes?.length ?? 0;
  const unmatchedCount = artifact.unmatched_redline_changes?.length ?? 0;
  const editAnnotations = artifact.edit_annotations ?? [];
  const pendingEditAnnotations = editAnnotations.filter((edit) => !edit.status || edit.status === "pending");
  const isBulkResolving = pendingEditAnnotations.some((edit) => resolvingEditIds.has(edit.edit_id));
  const artifactTitle = isKpiExtraction ? artifact.contract_name || artifact.filename : artifact.filename;
  const subtitle = isKpiExtraction
    ? `${artifact.kpi_count ?? 0} KPI rows · ${artifact.new_or_updated_count ?? 0} new/updated${artifact.extraction_method ? ` · ${artifact.extraction_method}` : ""}`
    : isProjectFact
      ? "Recorded in space memory"
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
      className="mt-2 max-w-full rounded-lg border border-primary-100 bg-primary-50/60 p-2.5"
    >
      <div className="flex items-center gap-2">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-card text-primary-700 shadow-e1">
          {isKpiExtraction ? <ShieldCheck className="h-4 w-4" /> : <FileText className="h-4 w-4" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-semibold text-fg-950">{artifactTitle}</div>
          <div className="text-[11px] leading-4 text-fg-500">{subtitle}</div>
        </div>
        {artifact.document_id && artifact.version_id && onArtifactCreated ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 shrink-0 gap-1 rounded-md border-primary-200 bg-card px-2 text-xs text-primary-700 hover:bg-primary-50"
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
            className="h-8 shrink-0 gap-1 rounded-md border-primary-200 bg-card px-2 text-xs text-primary-700 hover:bg-primary-50"
            onClick={() => downloadAgentArtifact(artifact)}
          >
            <Download className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Download</span>
          </Button>
        ) : null}
      </div>
      {isKpiExtraction ? (
        <div className="mt-2 flex flex-wrap gap-1.5 pl-10 text-[10px] font-medium text-fg-500">
          {artifact.run_id ? (
            <span className="rounded-full border border-primary-100 bg-card px-2 py-0.5">
              Run {artifact.run_id}
            </span>
          ) : null}
          {artifact.candidate_count != null ? (
            <span className="rounded-full border border-primary-100 bg-card px-2 py-0.5">
              {artifact.candidate_count} candidates checked
            </span>
          ) : null}
          {artifact.llm_error ? (
            <span className="rounded-full border border-attention-100 bg-attention-50 px-2 py-0.5 text-attention-700">
              Rule fallback used
            </span>
          ) : null}
        </div>
      ) : null}
      {isRedline && artifact.redline_changes?.length ? (
        <div className="mt-2 space-y-1.5">
          {artifact.redline_changes.slice(0, 3).map((change, index) => (
            <div key={change.finding_id || index} className="rounded-md border border-primary-100 bg-card px-2 py-1.5 text-[11px] leading-4 text-fg-700">
              <div className="font-medium text-fg-950">{change.rule_name || `Change ${index + 1}`}</div>
              <div className="mt-0.5 line-clamp-2">
                <span className="text-risk-700">{change.matched_text}</span>
                <span className="px-1 text-fg-400">→</span>
                <span className="text-success-700">{change.suggested_revision || "[delete]"}</span>
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
                className="h-7 gap-1 rounded-md px-2 text-[11px] text-success-700"
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
                className="h-7 gap-1 rounded-md px-2 text-[11px] text-risk-700"
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
              <div key={edit.edit_id} className="rounded-md border border-primary-100 bg-card p-2 text-[11px] leading-4 text-fg-700">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <div className="min-w-0 truncate font-medium text-fg-950">{edit.reason || "Tracked edit"}</div>
                  <span className={cn(
                    "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize",
                    edit.status === "accepted"
                      ? "bg-success-50 text-success-700"
                      : edit.status === "rejected"
                        ? "bg-risk-50 text-risk-700"
                        : "bg-attention-50 text-attention-700",
                  )}>
                    {edit.status || "pending"}
                  </span>
                </div>
                <div className="grid gap-1.5 sm:grid-cols-2">
                  <div className="rounded border border-risk-100 bg-risk-50 px-2 py-1 text-risk-900">
                    <div className="text-[10px] font-semibold uppercase text-risk-600">Original</div>
                    <div className="line-clamp-2">{edit.deleted_text || "[empty]"}</div>
                  </div>
                  <div className="rounded border border-success-100 bg-success-50 px-2 py-1 text-success-800">
                    <div className="text-[10px] font-semibold uppercase text-success-700">Replacement</div>
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
                    className="h-7 gap-1 rounded-md px-2 text-[11px] text-success-700"
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
                    className="h-7 gap-1 rounded-md px-2 text-[11px] text-risk-700"
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
}
