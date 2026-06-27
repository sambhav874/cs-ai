import { type ReactNode } from "react";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Download, FileText, FolderOpen, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cx } from "./utils";
import type { DocumentWithProgress, AgentDocumentSummary, AgentDocumentPreview } from "./types";

export function ProjectAssistantWorkspace({
  documents,
  agentDocuments,
  selectedAgentDocument,
  preview,
  isAgentDocumentsLoading,
  isPreviewLoading,
  onOpenAgentDocument,
  onDownloadPreview,
  chat,
}: {
  documents: DocumentWithProgress[];
  agentDocuments: AgentDocumentSummary[];
  selectedAgentDocument: { documentId: string; versionId: string } | null;
  preview: AgentDocumentPreview | null;
  isAgentDocumentsLoading: boolean;
  isPreviewLoading: boolean;
  onOpenAgentDocument: (documentId: string, versionId?: string) => void | Promise<void>;
  onDownloadPreview: () => void | Promise<void>;
  chat: ReactNode;
}) {
  return (
    <div className="grid h-[calc(100dvh-9.5rem)] min-h-0 grid-cols-1 overflow-hidden bg-background xl:grid-cols-[260px_minmax(0,1fr)_420px]">
      <aside className="hidden min-h-0 min-w-0 border-r border-border bg-muted/30 xl:flex xl:flex-col">
        <div className="flex h-12 items-center justify-between border-b border-border px-4">
          <div className="text-sm font-semibold text-foreground">Explorer</div>
          {isAgentDocumentsLoading ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : null}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          <div className="mb-5">
            <div className="mb-2 flex items-center gap-2 px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <FolderOpen className="h-3.5 w-3.5" />
              Project Documents
            </div>
            {documents.length === 0 ? (
              <div className="rounded-md border border-dashed border-border bg-background px-3 py-4 text-xs text-muted-foreground">
                No contracts uploaded yet.
              </div>
            ) : (
              <div className="space-y-1">
                {documents.map((document) => (
                  <Link
                    key={document._id}
                    href={`/contracts/${document._id}`}
                    className="flex min-w-0 items-center gap-2 rounded-md px-2 py-2 text-sm text-muted-foreground hover:bg-background hover:text-foreground"
                    title={document.contract_name}
                  >
                    <FileText className="h-4 w-4 shrink-0 text-rose-500" />
                    <span className="truncate">{document.contract_name}</span>
                  </Link>
                ))}
              </div>
            )}
          </div>

          <div>
            <div className="mb-2 flex items-center gap-2 px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <FileText className="h-3.5 w-3.5" />
              Generated DOCX
            </div>
            {agentDocuments.length === 0 ? (
              <div className="rounded-md border border-dashed border-border bg-background px-3 py-4 text-xs leading-5 text-muted-foreground">
                Ask the assistant to create a checklist, template, amendment, memo, or copies.
              </div>
            ) : (
              <div className="space-y-1">
                {agentDocuments.map((document) => {
                  const versionId = document.current_version_id || document.versions?.[0]?.version_id;
                  const isSelected = selectedAgentDocument?.documentId === document.document_id;
                  return (
                    <button
                      key={document.document_id}
                      type="button"
                      onClick={() => versionId && onOpenAgentDocument(document.document_id, versionId)}
                      className={cx(
                        "flex w-full min-w-0 items-start gap-2 rounded-md px-2 py-2 text-left text-sm transition-colors",
                        isSelected ? "bg-background text-foreground shadow-sm ring-1 ring-border" : "text-muted-foreground hover:bg-background hover:text-foreground",
                      )}
                      title={document.filename}
                    >
                      <FileText className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{document.title || document.filename}</span>
                        <span className="mt-0.5 block text-xs text-muted-foreground">
                          V{document.current_version_number || 1}
                          {document.versions?.length ? ` · ${document.versions.length} version${document.versions.length === 1 ? "" : "s"}` : ""}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </aside>

      <section className="hidden min-h-0 min-w-0 flex-col border-r border-border bg-muted/10 xl:flex">
        <div className="flex h-12 shrink-0 items-center justify-between border-b border-border bg-background px-4">
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-foreground">
              {preview?.filename || "Generated document preview"}
            </div>
            {preview?.version_number ? (
              <div className="text-xs text-muted-foreground">Version {preview.version_number}</div>
            ) : null}
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 gap-1.5"
            disabled={!preview || isPreviewLoading}
            onClick={onDownloadPreview}
          >
            <Download className="h-4 w-4" />
            Download
          </Button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto overscroll-contain px-5 py-6">
          {isPreviewLoading ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Opening document...
            </div>
          ) : preview ? (
            <div
              className="mx-auto min-h-[960px] max-w-[816px] bg-background px-14 py-12 text-[15px] leading-7 text-foreground shadow-sm ring-1 ring-border font-serif"
            >
              <h1 className="mb-7 text-center text-lg font-bold uppercase leading-7">
                {(preview.title || preview.filename || "Generated Document").replace(/\.docx$/i, "")}
              </h1>
              <div className="docx-preview-markdown">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={{
                    h1: ({ children }) => <h1 className="mb-5 mt-7 text-center text-lg font-bold uppercase">{children}</h1>,
                    h2: ({ children }) => <h2 className="mb-3 mt-6 text-base font-bold">{children}</h2>,
                    h3: ({ children }) => <h3 className="mb-2 mt-5 text-[15px] font-bold">{children}</h3>,
                    p: ({ children }) => <p className="mb-3 text-justify">{children}</p>,
                    ul: ({ children }) => <ul className="mb-4 list-disc space-y-1 pl-6">{children}</ul>,
                    ol: ({ children }) => <ol className="mb-4 list-decimal space-y-1 pl-6">{children}</ol>,
                    li: ({ children }) => <li className="pl-1">{children}</li>,
                    table: ({ children }) => (
                      <div className="my-4 overflow-x-auto">
                        <table className="w-full border-collapse text-left text-[13px] leading-5">{children}</table>
                      </div>
                    ),
                    th: ({ children }) => <th className="border border-border bg-muted px-2 py-1.5 font-bold">{children}</th>,
                    td: ({ children }) => <td className="border border-border px-2 py-1.5 align-top">{children}</td>,
                    blockquote: ({ children }) => (
                      <blockquote className="my-4 border-l-2 border-border pl-4 italic text-muted-foreground">{children}</blockquote>
                    ),
                  }}
                >
                  {preview.body_text || ""}
                </ReactMarkdown>
              </div>
            </div>
          ) : (
            <div className="flex h-full flex-col items-center justify-center text-center text-sm text-muted-foreground">
              <FileText className="mb-3 h-10 w-10 text-muted-foreground/30" />
              <p className="font-medium text-foreground/80">Generated DOCX files open here.</p>
              <p className="mt-1 max-w-sm">
                Ask for a checklist, template, amended copy, or document copies, then open it from the explorer.
              </p>
            </div>
          )}
        </div>
      </section>

      <section className="min-h-0 min-w-0 overflow-hidden">{chat}</section>
    </div>
  );
}
