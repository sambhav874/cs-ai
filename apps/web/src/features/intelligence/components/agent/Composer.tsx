import type { FormEvent } from "react";
import { ArrowRight, Check, ChevronDown, Link2, Sparkles, Square } from "lucide-react";
import { Button } from "@cs/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@cs/components/ui/dropdown-menu";
import {
  isReferenceDocumentReady,
  modelOptions,
  providerLabel,
  type AIProvider,
  type ReferenceDocument,
} from "@cs/lib/agentMessageFormatting";

export interface ComposerProps {
  draft: string;
  setDraft: (draft: string) => void;
  onSubmit: (event?: FormEvent, submittedDraft?: string) => void;
  onStop: () => void;
  isThinking: boolean;
  isProjectScope: boolean;
  availableReferenceDocuments: ReferenceDocument[];
  selectedReferenceIds: string[];
  selectedReferenceLabel: string;
  selectedReferenceSet: Set<string>;
  onSelectReferenceIds: (ids: string[]) => void;
  onToggleReferenceDocument: (documentId: string) => void;
  selectedProvider: AIProvider;
  onProviderChange: (provider: AIProvider) => void;
}

export function Composer({
  draft,
  setDraft,
  onSubmit,
  onStop,
  isThinking,
  isProjectScope,
  availableReferenceDocuments,
  selectedReferenceIds,
  selectedReferenceLabel,
  selectedReferenceSet,
  onSelectReferenceIds,
  onToggleReferenceDocument,
  selectedProvider,
  onProviderChange,
}: ComposerProps) {
  return (
    <>
      <form
        onSubmit={onSubmit}
        className="w-full rounded-lg border border-fg-950/10 bg-card/70 backdrop-blur-2xl p-4 shadow-[0_4px_40px_rgba(0,0,0,0.06)] transition-all duration-300 focus-within:border-primary-700/50 focus-within:ring-2 focus-within:ring-primary-700/20"
      >
        <div className="flex flex-col gap-2 min-h-[80px] text-left">
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                onSubmit();
              }
            }}
            disabled={isThinking}
            placeholder={isProjectScope ? "Ask a question about this space..." : "Ask a question about this contract..."}
            className="w-full bg-transparent border-0 p-0 text-sm text-fg-950 placeholder-black/30 outline-none focus:ring-0 focus:outline-none resize-none min-h-[50px] leading-relaxed"
          />

          {/* Bottom Accessory Row with dropdown selectors side-by-side and Send button */}
          <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-fg-950/10">
            <div className="flex flex-wrap items-center gap-1.5">
              {/* 1. Context / Doc Selector */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 gap-2 rounded-lg border-fg-950/10 bg-card px-3 text-xs font-medium text-fg-950/70 shadow-e1 hover:bg-black/[0.02] hover:border-fg-950/20 hover:text-fg-950 transition-all disabled:opacity-25"
                    disabled={isThinking || (isProjectScope ? availableReferenceDocuments.length === 0 : availableReferenceDocuments.length <= 1)}
                  >
                    <Link2 className="h-3.5 w-3.5 text-fg-950/40" />
                    <span className="max-w-[120px] truncate">{selectedReferenceLabel}</span>
                    <ChevronDown className="h-3 w-3 text-fg-950/30" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent side="top" align="start" className="max-h-80 w-72 overflow-y-auto rounded-lg border-fg-950/10 bg-card p-1.5 text-fg-950 shadow-e3 z-50">
                  <DropdownMenuLabel className="px-2.5 py-1.5 text-[10px] font-semibold text-fg-950/40 uppercase tracking-wider">Refer to</DropdownMenuLabel>
                  <DropdownMenuSeparator className="bg-fg-950/5 mx-1" />
                  <DropdownMenuItem
                    onSelect={(event) => {
                      event.preventDefault();
                      onSelectReferenceIds([]);
                    }}
                    className="flex items-center justify-between rounded-lg hover:bg-black/[0.04] cursor-pointer text-xs py-2 px-2.5"
                  >
                    <span className="text-fg-950/80">
                      {isProjectScope ? "All docs in this space" : "Current contract only"}
                    </span>
                    {selectedReferenceIds.length === 0 && <Check className="h-3.5 w-3.5 text-fg-950/40" />}
                  </DropdownMenuItem>
                  {!isProjectScope && (
                    <DropdownMenuItem
                      onSelect={(event) => {
                        event.preventDefault();
                        onSelectReferenceIds(["all"]);
                      }}
                      className="flex items-center justify-between rounded-lg hover:bg-black/[0.04] cursor-pointer text-xs py-2 px-2.5"
                    >
                      <span className="text-fg-950/80">All docs in this space</span>
                      {selectedReferenceIds.includes("all") && <Check className="h-3.5 w-3.5 text-fg-950/40" />}
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuSeparator className="bg-fg-950/5 mx-1" />
                  {availableReferenceDocuments.map((document) => {
                    const isReady = isReferenceDocumentReady(document);
                    const isChecked = (!isProjectScope && document.isCurrent) || selectedReferenceSet.has(document.id);
                    return (
                      <DropdownMenuCheckboxItem
                        key={document.id}
                        checked={isChecked}
                        disabled={(!isProjectScope && document.isCurrent) || !isReady}
                        onSelect={(event) => {
                          event.preventDefault();
                          if ((isProjectScope || !document.isCurrent) && isReady) {
                            onToggleReferenceDocument(document.id);
                          }
                        }}
                        className="flex items-start gap-2.5 p-2 rounded-lg hover:bg-fg-950/5 cursor-pointer text-xs transition-colors"
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium text-fg-950/80">{document.name}</span>
                          <span className="block text-[10px] text-fg-950/40 truncate">
                            {!isProjectScope && document.isCurrent ? "Current" : isReady ? "Indexed" : document.status || "Not indexed"}
                          </span>
                        </span>
                      </DropdownMenuCheckboxItem>
                    );
                  })}
                </DropdownMenuContent>
              </DropdownMenu>

              {/* 2. Model Selector */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 gap-2 rounded-lg border-fg-950/10 bg-card px-3 text-xs font-medium shadow-e1 hover:bg-black/[0.02] hover:border-fg-950/20 transition-all disabled:opacity-25"
                    disabled={isThinking}
                    style={{
                      color: selectedProvider === "claude" ? "#6b4fa0" : selectedProvider === "openai" ? "#10a37f" : selectedProvider === "gemini" ? "#4285f4" : "#333"
                    }}
                  >
                    <Sparkles className="h-3.5 w-3.5" style={{ opacity: 0.7 }} />
                    <span>{providerLabel(selectedProvider)}</span>
                    <ChevronDown className="h-3 w-3 text-fg-950/30" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent side="top" align="start" className="w-52 rounded-lg border-fg-950/10 bg-card p-1.5 text-fg-950 shadow-e3 z-50">
                  {modelOptions.map((option) => (
                    <DropdownMenuItem
                      key={option.value}
                      onClick={() => onProviderChange(option.value)}
                      className="flex flex-col items-start gap-0.5 rounded-lg hover:bg-black/[0.04] cursor-pointer px-2.5 py-2 text-xs"
                    >
                      <div className="flex items-center gap-1.5 w-full font-medium text-fg-950/80">
                        {option.label}
                        {selectedProvider === option.value && <Check className="h-3.5 w-3.5 ml-auto text-fg-950/40" />}
                      </div>
                      <span className="text-[10px] text-fg-950/35">{option.description}</span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            {/* Send button */}
            {isThinking ? (
              <Button
                type="button"
                onClick={onStop}
                aria-label="Stop generating"
                title="Stop generating"
                className="h-8 w-8 rounded-lg bg-primary-solid hover:bg-primary-solid-hover/85 text-white transition-all duration-200 shadow-e1 focus-visible:ring-2 focus-visible:ring-primary-700"
              >
                <Square className="h-3 w-3 fill-current" />
              </Button>
            ) : (
              <Button
                type="submit"
                disabled={!draft.trim()}
                aria-label="Send message"
                className="h-8 w-8 rounded-lg bg-primary-solid hover:bg-primary-solid-hover/85 text-white transition-all duration-200 shadow-e1 disabled:bg-primary-solid/10 disabled:text-fg-950/20 disabled:shadow-none focus-visible:ring-2 focus-visible:ring-primary-700"
              >
                <ArrowRight className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      </form>
      <p className="pt-1.5 text-center text-[11px] leading-4 text-fg-500">AI can make mistakes. Answers are not legal advice.</p>
    </>
  );
}
