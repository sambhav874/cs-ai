import { ApprovalInput } from "@cs/components/agent/ApprovalInput";
import type { Suggestion } from "@cs/lib/agent";

export interface ApprovalCardProps {
  suggestion: Suggestion;
  busy?: boolean;
  onApprove: () => void;
  onReject: () => void;
  onCustom: (instruction: string) => void;
}

export function ApprovalCard({
  suggestion,
  busy,
  onApprove,
  onReject,
  onCustom,
}: ApprovalCardProps) {
  return (
    <div>
      <ApprovalInput
        suggestion={suggestion}
        busy={busy}
        onApprove={onApprove}
        onReject={onReject}
        onCustom={onCustom}
      />
      <p className="pt-1.5 text-center text-[11px] leading-4 text-fg-500">
        AI can make mistakes. Answers are not legal advice.
      </p>
    </div>
  );
}
