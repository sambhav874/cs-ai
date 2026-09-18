import { Children, cloneElement, isValidElement } from "react";
import type { ReactElement, ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Check } from "lucide-react";
import { MarkdownTable } from "@cs/components/agent/MarkdownTable";
import { Tooltip, TooltipContent, TooltipTrigger } from "@cs/components/ui/tooltip";
import { cn } from "@cs/lib/utils";
import type { CitationAnnotation } from "@cs/lib/agent";
import {
  citationDocumentName,
  citationQuote,
  citationRefs,
  citedSegmentsForAnnotation,
  cleanDisplayText,
  reactNodeToPlainText,
  safeMarkdownHref,
  visibleAnswerText,
  type AgentMessage,
  type CitedSegment,
} from "@cs/lib/agentMessageFormatting";

export interface MessageMarkdownProps {
  message: AgentMessage;
  onCitationClick?: (
    citationText: string,
    confidence: "high" | "medium" | "low",
    citedSegments?: CitedSegment[],
    targetContractId?: string | null,
    targetFilename?: string | null,
  ) => void;
}

export function MessageMarkdown({ message, onCitationClick }: MessageMarkdownProps) {
  const content = visibleAnswerText(message.content);
  if (!content) return null;

  const handleCitationClick = (annotation: CitationAnnotation) => {
    const confidence = message.confidence ?? "medium";
    const citedSegments = citedSegmentsForAnnotation(message, annotation);
    const citationText = citationQuote(annotation) || cleanDisplayText(citedSegments[0]?.text) || cleanDisplayText(message.citation) || "";
    const targetContractId = annotation.document_id || annotation.contract_id || annotation.doc_id || citedSegments[0]?.contract_id || null;
    const targetFilename = annotation.filename || citedSegments[0]?.contract_name || null;
    const parsedPage = typeof annotation.page === "number"
      ? annotation.page
      : typeof annotation.page === "string"
        ? Number.parseInt(annotation.page, 10)
        : null;
    const fallbackSegment: CitedSegment | null = citationText
      ? {
        id: annotation.segment_id || `citation-${annotation.ref}`,
        text: citationText,
        page: annotation.page ?? null,
        page_number: Number.isFinite(parsedPage) ? parsedPage : null,
        page_start: annotation.page_start ?? (Number.isFinite(parsedPage) ? parsedPage : null),
        page_end: annotation.page_end ?? null,
        type: "citation",
        contract_id: targetContractId,
        contract_name: targetFilename,
      }
      : null;
    const segmentsForViewer = citedSegments.length ? citedSegments : fallbackSegment ? [fallbackSegment] : undefined;
    onCitationClick?.(
      citationText,
      confidence,
      segmentsForViewer,
      targetContractId,
      targetFilename,
    );
  };

  const renderCitationButton = (
    annotation: CitationAnnotation,
    keySuffix: string | number = annotation.ref,
    variant: "inline" | "source" = "inline",
  ) => {
    const quote = citationQuote(annotation);
    const page = annotation.page_start != null && annotation.page_end != null && annotation.page_end !== annotation.page_start
      ? `Page ${annotation.page_start}-${annotation.page_end}`
      : annotation.page
        ? `Page ${annotation.page}`
        : "Source document";
    const documentName = citationDocumentName(annotation);
    const isSourceVariant = variant === "source";
    const isUnverified = annotation.verified === false;
    const hasNoActionableData = !annotation.page && !citationQuote(annotation);

    if (hasNoActionableData) {
      return (
        <span
          key={`${message.id}-citation-${keySuffix}`}
          className={cn(
            "inline-flex items-center justify-center border font-medium cursor-default",
            isSourceVariant
              ? "h-5 min-w-5 rounded-md border-surface-100 bg-surface-100 px-1.5 text-[10px] leading-none text-fg-500"
              : "mx-0.5 h-4 min-w-4 rounded border-surface-100 bg-surface-100 px-1 align-super text-[9px] leading-none text-fg-500",
          )}
        >
          {annotation.ref}
        </span>
      );
    }

    return (
      <Tooltip key={`${message.id}-citation-${keySuffix}`}>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={() => handleCitationClick(annotation)}
            className={cn(
              "inline-flex items-center justify-center border font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-surface-300",
              isUnverified
                ? isSourceVariant
                  ? "h-5 min-w-5 rounded-md border-attention-200 bg-attention-50 px-1.5 text-[10px] leading-none text-attention-700 hover:border-attention-200 hover:bg-attention-100"
                  : "mx-0.5 h-4 min-w-4 rounded border-attention-200 bg-attention-50 px-1 align-super text-[9px] leading-none text-attention-700 hover:border-attention-200 hover:bg-attention-100"
                : isSourceVariant
                  ? "h-5 min-w-5 rounded-md border-surface-200 bg-card px-1.5 text-[10px] leading-none text-fg-700 hover:border-surface-300 hover:bg-surface-50"
                  : "mx-0.5 h-4 min-w-4 rounded border-surface-200 bg-card px-1 align-super text-[9px] leading-none text-fg-700 hover:border-surface-300 hover:bg-surface-50",
            )}
            aria-label={`Open citation ${annotation.ref}`}
          >
            {annotation.ref}
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" align="center" className="max-w-[280px] rounded-md border bg-card p-3 text-left text-fg-950 shadow-e2">
          <div className="space-y-1.5">
            <div className="text-xs font-semibold text-fg-950">{documentName}</div>
            <div className="text-[11px] font-medium text-primary-700">{page}</div>
            {isUnverified && (
              <div className="text-[10px] text-attention-700 font-semibold bg-attention-50 rounded px-1.5 py-0.5 border border-attention-100 flex items-center gap-1">
                <span>⚠️</span>
                <span>Unverified source text</span>
              </div>
            )}
            {quote ? (
              <div className="max-h-24 overflow-hidden text-xs leading-5 text-fg-700">{quote}</div>
            ) : (
              <div className="text-xs text-fg-500">No quote preview available.</div>
            )}
            <div className="pt-1 text-[11px] text-fg-400">Click to open this source in the PDF.</div>
          </div>
        </TooltipContent>
      </Tooltip>
    );
  };

  const renderCitationAwareText = (
    text: string,
    keyPrefix: string,
  ): ReactNode[] => {
    const annotations = message.citationAnnotations ?? [];
    const annotationsByRef = new Map(annotations.map((annotation) => [Number(annotation.ref), annotation]));
    const markerRegex = /\[(\d+(?:\s*,\s*\d+)*)\]/g;
    const parts: ReactNode[] = [];
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = markerRegex.exec(text)) !== null) {
      const markerStart = match.index;
      if (match.index > lastIndex) {
        parts.push(text.slice(lastIndex, match.index));
      }

      const annotationsForThisMarker = citationRefs(match[1])
        .map((ref) => annotationsByRef.get(ref))
        .filter((annotation): annotation is CitationAnnotation => Boolean(annotation));

      if (annotationsForThisMarker.length) {
        annotationsForThisMarker.forEach((annotation, annotationIndex) => {
          parts.push(renderCitationButton(annotation, `${keyPrefix}-${markerStart}-${annotationIndex}`));
        });
      } else {
        parts.push(match[0]);
      }

      lastIndex = markerRegex.lastIndex;
    }

    if (lastIndex < text.length) {
      parts.push(text.slice(lastIndex));
    }

    return parts;
  };

  const renderCitationAwareChildren = (
    children: ReactNode,
    keyPrefix: string,
  ): ReactNode => Children.map(children, (child, childIndex) => {
    const childKey = `${keyPrefix}-${childIndex}`;
    if (typeof child === "string") {
      return renderCitationAwareText(child, childKey);
    }

    if (isValidElement<{ children?: ReactNode }>(child) && child.props.children) {
      return cloneElement(
        child as ReactElement<{ children?: ReactNode }>,
        undefined,
        renderCitationAwareChildren(child.props.children, childKey),
      );
    }

    return child;
  });

  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        h1: ({ children }) => (
          <h3 className="mt-3 text-sm font-semibold leading-5 text-fg-950 first:mt-0">
            {renderCitationAwareChildren(children, "h1")}
          </h3>
        ),
        h2: ({ children }) => (
          <h3 className="mt-3 text-sm font-semibold leading-5 text-fg-950 first:mt-0">
            {renderCitationAwareChildren(children, "h2")}
          </h3>
        ),
        h3: ({ children }) => (
          <h4 className="mt-2.5 text-[13px] font-semibold leading-5 text-fg-950 first:mt-0">
            {renderCitationAwareChildren(children, "h3")}
          </h4>
        ),
        p: ({ children }) => (
          <p className="mb-2 max-w-full break-words leading-[1.65] last:mb-0">
            {renderCitationAwareChildren(children, "p")}
          </p>
        ),
        table: ({ children }) => <MarkdownTable>{children}</MarkdownTable>,
        thead: ({ children }) => <thead className="bg-surface-50">{children}</thead>,
        tbody: ({ children }) => <tbody className="divide-y divide-surface-100 bg-card">{children}</tbody>,
        th: ({ children }) => (
          <th scope="col" className="min-w-[120px] px-2 py-2 align-top font-semibold leading-4 text-fg-700 [overflow-wrap:anywhere] sm:px-3">
            {renderCitationAwareChildren(children, "th")}
          </th>
        ),
        td: ({ children }) => (
          <td className="min-w-[120px] px-2 py-2 align-top leading-5 text-fg-700 [overflow-wrap:anywhere] sm:px-3">
            {renderCitationAwareChildren(children, "td")}
          </td>
        ),
        ul: ({ children }) => <ul className="mb-2.5 list-disc space-y-1 pl-3.5 leading-5 last:mb-0">{children}</ul>,
        ol: ({ children }) => <ol className="mb-2.5 list-decimal space-y-1 pl-3.5 leading-5 last:mb-0">{children}</ol>,
        li: ({ children }) => {
          const checklistMatch = reactNodeToPlainText(children).match(/^\s*\[( |x|X)\]\s+(.+)$/);
          if (checklistMatch) {
            const isChecked = checklistMatch[1].toLowerCase() === "x";
            return (
              <li className="flex list-none items-start gap-1.5 pl-0">
                <span className={cn(
                  "mt-1 flex h-4 w-4 shrink-0 items-center justify-center rounded border text-white",
                  isChecked ? "border-primary-700 bg-primary-700" : "border-surface-300 bg-card",
                )}>
                  {isChecked ? <Check className="h-3 w-3" /> : null}
                </span>
                <span className="min-w-0">{renderCitationAwareText(checklistMatch[2], "li-check")}</span>
              </li>
            );
          }

          return (
            <li className="pl-0">
              {renderCitationAwareChildren(children, "li")}
            </li>
          );
        },
        input: ({ checked, type }) => (
          type === "checkbox" ? (
            <span className={cn(
              "mr-2 inline-flex h-4 w-4 translate-y-0.5 items-center justify-center rounded border text-white",
              checked ? "border-primary-700 bg-primary-700" : "border-surface-300 bg-card",
            )}>
              {checked ? <Check className="h-3 w-3" /> : null}
            </span>
          ) : null
        ),
        strong: ({ children }) => (
          <strong className="break-words font-semibold text-fg-950">
            {renderCitationAwareChildren(children, "strong")}
          </strong>
        ),
        em: ({ children }) => (
          <em className="text-fg-700">
            {renderCitationAwareChildren(children, "em")}
          </em>
        ),
        blockquote: ({ children }) => (
          <blockquote className="my-3 border-l-2 border-surface-300 pl-3 text-fg-700">
            {renderCitationAwareChildren(children, "quote")}
          </blockquote>
        ),
        code: ({ children }) => (
          <code className="break-words rounded bg-surface-100 px-1 py-0.5 text-[12px] text-fg-950">
            {children}
          </code>
        ),
        pre: ({ children }) => (
          <pre className="my-3 max-w-full overflow-hidden whitespace-pre-wrap break-words rounded-md bg-fg-950 p-3 text-xs leading-5 text-fg-400">
            {children}
          </pre>
        ),
        a: ({ children, href }) => {
          const safeHref = safeMarkdownHref(href);
          const renderedChildren = renderCitationAwareChildren(children, "a");

          return safeHref ? (
            <a
              href={safeHref}
              target="_blank"
              rel="noopener noreferrer"
              className="break-words font-medium text-primary-700 underline decoration-primary-200 underline-offset-2 hover:text-primary-800"
            >
              {renderedChildren}
            </a>
          ) : (
            <span className="break-words font-medium text-fg-950">{renderedChildren}</span>
          );
        },
      }}
    >
      {content}
    </ReactMarkdown>
  );
}
