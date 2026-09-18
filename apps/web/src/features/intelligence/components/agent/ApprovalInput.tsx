import { useRef } from "react";
import { ArrowRight, Check, X } from "lucide-react";
import type { Suggestion } from "@cs/lib/agent";

interface ApprovalInputProps {
  suggestion: Suggestion;
  busy?: boolean;
  onApprove: () => void;
  onReject: () => void;
  onCustom: (instruction: string) => void;
}

export function ApprovalInput({ suggestion, busy, onApprove, onReject, onCustom }: ApprovalInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleCustomSubmit = () => {
    const text = inputRef.current?.value?.trim();
    if (text) {
      onCustom(text);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <div className="rounded-lg border border-surface-200 bg-card shadow-e1">
      <div className="px-4 pb-2 pt-3">
        <p className="text-xs font-medium text-fg-700">
          The agent wants to: <span className="text-fg-950">{suggestion.label}</span>
        </p>
      </div>

      <div className="flex flex-row flex-nowrap items-center gap-2 px-2 pb-2">
        <button
          type="button"
          onClick={onReject}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-full border border-risk-200 bg-card px-4 py-2 text-sm font-medium text-risk-600 transition-colors hover:bg-risk-50 disabled:opacity-50"
        >
          <X className="h-4 w-4" />
          No
        </button>
        <button
          type="button"
          onClick={onApprove}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-full border border-success-200 bg-success-50 px-4 py-2 text-sm font-medium text-success-700 transition-colors hover:bg-success-100 disabled:opacity-50"
        >
          <Check className="h-4 w-4" />
          Yes
        </button>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          handleCustomSubmit();
        }}
        className="border-t border-surface-100 px-2 pb-2 pt-1.5"
      >
        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            type="text"
            placeholder="Tell me what to do instead..."
            className="min-w-0 flex-1 rounded-lg border border-surface-200 bg-surface-50 px-3 py-1.5 text-xs text-fg-950 outline-none placeholder:text-fg-400 focus:border-fg-400 focus:bg-card"
            disabled={busy}
          />
          <button
            type="submit"
            disabled={busy}
            aria-label="Send custom instruction"
            className="inline-flex items-center gap-1 rounded-lg bg-primary-solid px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-primary-solid-hover/90 disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-primary-700 focus-visible:outline-none"
          >
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </form>
    </div>
  );
}
