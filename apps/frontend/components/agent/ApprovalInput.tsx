"use client";

import { useRef } from "react";
import { ArrowRight, Check, X } from "lucide-react";
import type { Suggestion } from "@/lib/agent";

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
    <div className="rounded-2xl border border-gray-200 bg-white shadow-sm">
      <div className="px-4 pb-2 pt-3">
        <p className="text-xs font-medium text-gray-700">
          The agent wants to: <span className="text-gray-900">{suggestion.label}</span>
        </p>
      </div>

      <div className="flex flex-row flex-nowrap items-center gap-2 px-2 pb-2">
        <button
          type="button"
          onClick={onReject}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-full border border-red-200 bg-white px-4 py-2 text-sm font-medium text-red-600 transition-colors hover:bg-red-50 disabled:opacity-50"
        >
          <X className="h-4 w-4" />
          No
        </button>
        <button
          type="button"
          onClick={onApprove}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-medium text-emerald-700 transition-colors hover:bg-emerald-100 disabled:opacity-50"
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
        className="border-t border-gray-100 px-2 pb-2 pt-1.5"
      >
        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            type="text"
            placeholder="Tell me what to do instead..."
            className="min-w-0 flex-1 rounded-lg border border-gray-200 bg-gray-50 px-3 py-1.5 text-xs text-gray-900 outline-none placeholder:text-gray-400 focus:border-gray-400 focus:bg-white"
            disabled={busy}
          />
          <button
            type="submit"
            disabled={busy}
            className="inline-flex items-center gap-1 rounded-lg bg-gray-900 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-cs-primary/90 disabled:opacity-50"
          >
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </form>
    </div>
  );
}
