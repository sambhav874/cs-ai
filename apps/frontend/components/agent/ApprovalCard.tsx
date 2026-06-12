"use client";

import { ArrowRight, Check, X } from "lucide-react";
import type { AgentApprovalRequest, TabularReviewProposal } from "@/lib/agent";
import { Button } from "@/components/ui/button";
import { TabularReviewProposalEditor } from "@/components/agent/TabularReviewProposalEditor";

interface ApprovalCardProps {
  approval: AgentApprovalRequest;
  proposal?: TabularReviewProposal | null;
  documentNamesById?: Record<string, string>;
  busy?: boolean;
  onProposalChange?: (proposal: TabularReviewProposal) => void;
  onApprove: () => void;
  onReject: () => void;
}

type RedlineChangePreview = {
  finding_id?: string;
  rule_name?: string;
  matched_text?: string;
  suggested_revision?: string;
  rationale?: string;
  status?: string;
};

function redlineChangesFromApproval(approval: AgentApprovalRequest): RedlineChangePreview[] {
  const rawChanges = approval.payload?.redline_changes;
  if (!Array.isArray(rawChanges)) return [];
  return rawChanges.filter((item): item is RedlineChangePreview => Boolean(item && typeof item === "object"));
}

export function ApprovalCard({
  approval,
  proposal,
  documentNamesById,
  busy,
  onProposalChange,
  onApprove,
  onReject,
}: ApprovalCardProps) {
  const isTabularApproval = Boolean(proposal);
  const redlineChanges = redlineChangesFromApproval(approval);
  return (
    <section className="rounded-lg border border-gray-200 bg-gray-50 p-3">
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold text-gray-950">{approval.title}</h3>
          <p className="mt-0.5 text-xs leading-5 text-gray-600">
            {isTabularApproval && proposal
              ? `${proposal.document_ids.length} docs · ${proposal.columns_config.length} fields${proposal.estimated_tokens ? ` · est. ${proposal.estimated_tokens} tokens` : ""}`
              : approval.description}
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button type="button" size="sm" variant="outline" onClick={onReject} disabled={busy}>
            <X className="mr-1.5 size-3.5" />
            Reject
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={onApprove}
            disabled={busy || (isTabularApproval && (!proposal?.columns_config.length || !proposal.document_ids.length))}
          >
            <Check className="mr-1.5 size-3.5" />
            Approve
          </Button>
        </div>
      </div>
      {proposal && onProposalChange ? (
        <TabularReviewProposalEditor
          proposal={proposal}
          documentNamesById={documentNamesById}
          onChange={onProposalChange}
        />
      ) : null}
      {redlineChanges.length ? (
        <div className="space-y-2">
          {redlineChanges.map((change, index) => (
            <div key={change.finding_id || index} className="rounded-md border border-blue-100 bg-white p-2.5">
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="truncate text-xs font-semibold text-gray-900">
                  {change.rule_name || `Change ${index + 1}`}
                </div>
                <span className="shrink-0 rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-700">
                  Pending approval
                </span>
              </div>
              <div className="grid gap-2 sm:grid-cols-[1fr_auto_1fr] sm:items-start">
                <div className="rounded border border-red-100 bg-red-50 px-2 py-1.5 text-xs leading-5 text-red-800">
                  <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-red-500">Original</div>
                  {change.matched_text || "No source text matched"}
                </div>
                <ArrowRight className="hidden h-4 w-4 text-gray-400 sm:block" />
                <div className="rounded border border-emerald-100 bg-emerald-50 px-2 py-1.5 text-xs leading-5 text-emerald-800">
                  <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-600">Redline</div>
                  {change.suggested_revision || "[delete without replacement]"}
                </div>
              </div>
              {change.rationale ? (
                <p className="mt-2 text-[11px] leading-4 text-gray-500">{change.rationale}</p>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
