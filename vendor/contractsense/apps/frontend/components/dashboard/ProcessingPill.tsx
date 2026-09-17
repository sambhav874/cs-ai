import { memo } from "react";
import { AlertCircle, FileText, RefreshCw } from "lucide-react";
import { cx, statusClass, getProcessingLabel } from "./utils";
import type { DocumentWithProgress } from "./types";

export const ProcessingPill = memo(function ProcessingPill({ doc }: { doc: DocumentWithProgress }) {
  const isActive = doc.isProcessing || ["pending", "queued", "processing"].includes(doc.status);
  return (
    <div className="min-w-[150px]">
      <span className={cx("inline-flex items-center rounded-full border px-2 py-1 text-xs font-medium", statusClass(doc.error ? "error" : doc.status))}>
        {doc.error ? (
          <AlertCircle className="mr-1 h-3 w-3" />
        ) : isActive ? (
          <RefreshCw className="mr-1 h-3 w-3 animate-spin" />
        ) : (
          <FileText className="mr-1 h-3 w-3" />
        )}
        {getProcessingLabel(doc)}
      </span>
      {isActive && (
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-foreground transition-[width] duration-150"
            style={{ width: `${Math.min(doc.progress || 8, 100)}%` }}
          />
        </div>
      )}
    </div>
  );
});
