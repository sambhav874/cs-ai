"use client";

import { Check, Download, FileText, PencilLine, ShieldCheck, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { AgentArtifact, AgentEditAnnotation } from "@/lib/agentMessageFormatting";

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
      ? "Recorded in project memory"
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
}
