"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

export function MessageActions({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy text: ", err);
    }
  };

  return (
    <div className="flex items-center gap-1.5 mt-2 px-1 text-black/35">
      <button
        type="button"
        onClick={handleCopy}
        className="flex items-center gap-1 rounded px-2 py-1 text-xs hover:bg-black/5 hover:text-black/70 transition-colors animate-fade-in"
        title="Copy message"
      >
        {copied ? (
          <>
            <Check className="h-3.5 w-3.5 text-green-600 animate-in fade-in zoom-in duration-200" />
            <span className="text-[10px] text-green-600 font-medium">Copied</span>
          </>
        ) : (
          <>
            <Copy className="h-3.5 w-3.5" />
            <span className="text-[10px] font-medium">Copy</span>
          </>
        )}
      </button>
    </div>
  );
}
