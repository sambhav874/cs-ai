"use client";

import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import type { TabularColumnConfig } from "@/lib/tabularReviews";
import type { TabularReviewProposal } from "@/lib/agent";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

const formatOptions = ["text", "bulleted_list", "date", "yes_no", "number", "percentage", "monetary_amount", "currency", "tag"];

interface TabularReviewProposalEditorProps {
  proposal: TabularReviewProposal;
  onChange: (proposal: TabularReviewProposal) => void;
  documentNamesById?: Record<string, string>;
  className?: string;
}

function reindex(columns: TabularColumnConfig[]) {
  return columns.map((column, index) => ({ ...column, index }));
}

function emptyColumn(index: number): TabularColumnConfig {
  return {
    index,
    name: "New field",
    prompt: "Extract the relevant contract language for this field and cite the source.",
    format: "text",
    tags: [],
  };
}

export function TabularReviewProposalEditor({
  proposal,
  onChange,
  documentNamesById = {},
  className,
}: TabularReviewProposalEditorProps) {
  function patch(next: Partial<TabularReviewProposal>) {
    onChange({ ...proposal, ...next });
  }

  function updateColumn(index: number, update: Partial<TabularColumnConfig>) {
    const columns = proposal.columns_config.map((column, position) => (
      position === index ? { ...column, ...update } : column
    ));
    patch({ columns_config: reindex(columns) });
  }

  function moveColumn(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= proposal.columns_config.length) return;
    const columns = [...proposal.columns_config];
    const [item] = columns.splice(index, 1);
    columns.splice(target, 0, item);
    patch({ columns_config: reindex(columns) });
  }

  function removeColumn(index: number) {
    patch({ columns_config: reindex(proposal.columns_config.filter((_, position) => position !== index)) });
  }

  function removeDocument(documentId: string) {
    patch({ document_ids: proposal.document_ids.filter((id) => id !== documentId) });
  }

  function addColumn() {
    patch({ columns_config: reindex([...proposal.columns_config, emptyColumn(proposal.columns_config.length)]) });
  }

  return (
    <div className={cn("space-y-3", className)}>
      <div className="grid gap-2 sm:grid-cols-[1fr_160px]">
        <label className="space-y-1 text-xs font-medium text-gray-900">
          Review title
          <Input className="h-8 text-xs" value={proposal.title} onChange={(event) => patch({ title: event.target.value })} />
        </label>
        <label className="space-y-1 text-xs font-medium text-gray-900">
          Practice area
          <Input className="h-8 text-xs" value={proposal.practice_area || ""} onChange={(event) => patch({ practice_area: event.target.value })} />
        </label>
      </div>

      <details className="rounded-md border border-gray-200 bg-white px-2.5 py-2">
        <summary className="cursor-pointer text-xs font-medium text-gray-700">
          Documents ({proposal.document_ids.length})
        </summary>
        <div className="mt-2 space-y-1.5">
          {proposal.document_ids.map((documentId) => (
            <div key={documentId} className="flex items-center gap-2 rounded-md border border-gray-100 bg-gray-50 px-2 py-1.5">
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs font-medium text-gray-800">
                  {documentNamesById[documentId] || documentId}
                </div>
                {documentNamesById[documentId] ? (
                  <div className="truncate font-mono text-[10px] text-gray-400">{documentId}</div>
                ) : null}
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0"
                onClick={() => removeDocument(documentId)}
                aria-label="Remove document"
              >
                <Trash2 className="size-3.5" />
              </Button>
            </div>
          ))}
        </div>
        <details className="mt-2">
          <summary className="cursor-pointer text-[11px] font-medium text-gray-500">Edit document IDs</summary>
          <Textarea
            value={proposal.document_ids.join("\n")}
            onChange={(event) => patch({
              document_ids: event.target.value.split(/\n|,/).map((item) => item.trim()).filter(Boolean),
            })}
            className="mt-2 min-h-16 font-mono text-xs"
          />
        </details>
      </details>

      <div className="flex items-center justify-between gap-3">
        <div className="text-xs text-gray-600">
          {proposal.estimated_rows || proposal.document_ids.length} rows · {proposal.columns_config.length} fields · est. {proposal.estimated_tokens || 0} tokens
        </div>
        <Button type="button" variant="outline" size="sm" className="h-8" onClick={addColumn}>
          <Plus className="mr-1.5 size-3.5" />
          Add field
        </Button>
      </div>

      <div className="space-y-2">
        {proposal.columns_config.map((column, index) => (
          <div key={`${column.index}-${index}`} className="rounded-md border border-gray-200 bg-white p-2.5">
            <div className="flex items-center gap-2">
              <span className="shrink-0 text-[11px] font-semibold text-gray-500">{index + 1}</span>
              <Input
                className="h-8 min-w-0 flex-1 text-xs"
                value={column.name}
                onChange={(event) => updateColumn(index, { name: event.target.value })}
              />
              <select
                value={column.format || "text"}
                onChange={(event) => updateColumn(index, { format: event.target.value })}
                className="h-8 w-28 rounded-md border border-input bg-background px-2 text-xs"
              >
                {formatOptions.map((format) => <option key={format} value={format}>{format}</option>)}
              </select>
              <div className="flex shrink-0 gap-0.5">
                <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={() => moveColumn(index, -1)} disabled={index === 0} aria-label="Move field up">
                  <ArrowUp className="size-3.5" />
                </Button>
                <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={() => moveColumn(index, 1)} disabled={index === proposal.columns_config.length - 1} aria-label="Move field down">
                  <ArrowDown className="size-3.5" />
                </Button>
                <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={() => removeColumn(index)} aria-label="Remove field">
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            </div>
            <details className="mt-2">
              <summary className="cursor-pointer text-[11px] font-medium text-gray-500">Prompt and tags</summary>
              <label className="mt-2 block space-y-1 text-xs font-medium text-gray-900">
                Extraction prompt
                <Textarea value={column.prompt} onChange={(event) => updateColumn(index, { prompt: event.target.value })} className="min-h-20 text-xs" />
              </label>
              <label className="mt-2 block space-y-1 text-xs font-medium text-gray-900">
                Tags
                <Input
                  className="h-8 text-xs"
                  value={(column.tags || []).join(", ")}
                  onChange={(event) => updateColumn(index, { tags: event.target.value.split(",").map((item) => item.trim()).filter(Boolean) })}
                  placeholder="High, Medium, Low"
                />
              </label>
            </details>
          </div>
        ))}
      </div>
    </div>
  );
}
