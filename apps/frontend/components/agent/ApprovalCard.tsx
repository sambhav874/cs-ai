"use client";

import { Check, X } from "lucide-react";
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
    </section>
  );
}
