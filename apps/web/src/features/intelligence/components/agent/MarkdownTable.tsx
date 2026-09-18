import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Maximize2, X } from "lucide-react";

export function MarkdownTable({ children }: { children: ReactNode }) {
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    if (!isFullscreen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setIsFullscreen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isFullscreen]);

  return (
    <>
      <div className="relative group my-3">
        <button
          onClick={() => setIsFullscreen(true)}
          className="absolute top-2 right-2 p-1.5 rounded-lg border border-surface-200 bg-card/95 text-fg-500 hover:text-fg-950 shadow-e2 opacity-0 group-hover:opacity-100 transition-all duration-200 z-10 flex items-center justify-center cursor-pointer hover:bg-surface-50 active:scale-95 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-primary-700 focus-visible:outline-none"
          title="Open in fullscreen"
          aria-label="Open table in fullscreen"
        >
          <Maximize2 className="h-3.5 w-3.5" />
        </button>
        <div className="max-w-full overflow-x-auto rounded-lg border border-surface-200 bg-card">
          <table className="min-w-[540px] table-auto divide-y divide-surface-200 text-left text-[10px] sm:text-[11px]">
            {children}
          </table>
        </div>
      </div>

      {isFullscreen && (
        <div
          className="fixed inset-0 bg-scrim/60 backdrop-blur-sm z-[9999] flex items-center justify-center p-4 sm:p-10"
          style={{ animation: "fadeIn 0.2s ease-out forwards" }}
          onClick={() => setIsFullscreen(false)}
        >
          <style>{`
            @keyframes fadeIn {
              from { opacity: 0; }
              to { opacity: 1; }
            }
            @keyframes scaleIn {
              from { transform: scale(0.95); opacity: 0; }
              to { transform: scale(1); opacity: 1; }
            }
          `}</style>
          <div
            className="bg-card rounded-lg shadow-e3 border border-surface-200 w-full max-w-6xl max-h-[85vh] flex flex-col p-6 overflow-hidden"
            style={{ animation: "scaleIn 0.25s cubic-bezier(0.16, 1, 0.3, 1) forwards" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-center mb-4 pb-3 border-b border-surface-100 shrink-0">
              <h3 className="font-semibold text-fg-950 text-sm">Table Preview</h3>
              <button
                onClick={() => setIsFullscreen(false)}
                className="p-1 rounded-md hover:bg-surface-100 text-fg-500 hover:text-fg-700 transition-colors flex items-center justify-center cursor-pointer active:scale-95 focus-visible:ring-2 focus-visible:ring-primary-700 focus-visible:outline-none"
                title="Close"
                aria-label="Close fullscreen table"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex-1 overflow-auto rounded-lg border border-surface-200 bg-card p-2">
              <table className="min-w-full table-auto divide-y divide-surface-200 text-left text-xs sm:text-sm">
                {children}
              </table>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
