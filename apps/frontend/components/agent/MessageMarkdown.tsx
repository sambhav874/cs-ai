"use client";

import { Children, cloneElement, isValidElement } from "react";
import type { ReactElement, ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Check } from "lucide-react";
import { MarkdownTable } from "@/components/agent/MarkdownTable";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { CitationAnnotation } from "@/lib/agent";
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
} from "@/lib/agentMessageFormatting";

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
              ? "h-5 min-w-5 rounded-md border-gray-100 bg-gray-100 px-1.5 text-[10px] leading-none text-gray-500"
              : "mx-0.5 h-4 min-w-4 rounded border-gray-100 bg-gray-100 px-1 align-super text-[9px] leading-none text-gray-500",
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
              "inline-flex items-center justify-center border font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-300",
              isUnverified
                ? isSourceVariant
                  ? "h-5 min-w-5 rounded-md border-amber-200 bg-amber-50 px-1.5 text-[10px] leading-none text-amber-700 hover:border-amber-300 hover:bg-amber-100"
                  : "mx-0.5 h-4 min-w-4 rounded border-amber-200 bg-amber-50 px-1 align-super text-[9px] leading-none text-amber-700 hover:border-amber-300 hover:bg-amber-100"
                : isSourceVariant
                  ? "h-5 min-w-5 rounded-md border-gray-200 bg-white px-1.5 text-[10px] leading-none text-gray-600 hover:border-gray-300 hover:bg-gray-50"
                  : "mx-0.5 h-4 min-w-4 rounded border-gray-200 bg-white px-1 align-super text-[9px] leading-none text-gray-600 hover:border-gray-300 hover:bg-gray-50",
            )}
            aria-label={`Open citation ${annotation.ref}`}
          >
            {annotation.ref}
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" align="center" className="max-w-[280px] rounded-md border bg-white p-3 text-left text-gray-800 shadow-lg">
          <div className="space-y-1.5">
            <div className="text-xs font-semibold text-gray-900">{documentName}</div>
            <div className="text-[11px] font-medium text-blue-700">{page}</div>
            {isUnverified && (
              <div className="text-[10px] text-amber-700 font-semibold bg-amber-50 rounded px-1.5 py-0.5 border border-amber-100 flex items-center gap-1">
                <span>⚠️</span>
                <span>Unverified source text</span>
              </div>
            )}
            {quote ? (
              <div className="max-h-24 overflow-hidden text-xs leading-5 text-gray-600">{quote}</div>
            ) : (
              <div className="text-xs text-gray-500">No quote preview available.</div>
            )}
            <div className="pt-1 text-[11px] text-gray-400">Click to open this source in the PDF.</div>
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
          <h3 className="mt-3 text-sm font-semibold leading-5 text-gray-950 first:mt-0">
            {renderCitationAwareChildren(children, "h1")}
          </h3>
        ),
        h2: ({ children }) => (
          <h3 className="mt-3 text-sm font-semibold leading-5 text-gray-950 first:mt-0">
            {renderCitationAwareChildren(children, "h2")}
          </h3>
        ),
        h3: ({ children }) => (
          <h4 className="mt-2.5 text-[13px] font-semibold leading-5 text-gray-950 first:mt-0">
            {renderCitationAwareChildren(children, "h3")}
          </h4>
        ),
        p: ({ children }) => (
          <p className="mb-2 max-w-full break-words leading-[1.65] last:mb-0">
            {renderCitationAwareChildren(children, "p")}
          </p>
        ),
        table: ({ children }) => <MarkdownTable>{children}</MarkdownTable>,
        thead: ({ children }) => <thead className="bg-gray-50">{children}</thead>,
        tbody: ({ children }) => <tbody className="divide-y divide-gray-100 bg-white">{children}</tbody>,
        th: ({ children }) => (
          <th scope="col" className="min-w-[120px] px-2 py-2 align-top font-semibold leading-4 text-gray-700 [overflow-wrap:anywhere] sm:px-3">
            {renderCitationAwareChildren(children, "th")}
          </th>
        ),
        td: ({ children }) => (
          <td className="min-w-[120px] px-2 py-2 align-top leading-5 text-gray-700 [overflow-wrap:anywhere] sm:px-3">
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
                  isChecked ? "border-blue-600 bg-blue-600" : "border-gray-300 bg-white",
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
              checked ? "border-blue-600 bg-blue-600" : "border-gray-300 bg-white",
            )}>
              {checked ? <Check className="h-3 w-3" /> : null}
            </span>
          ) : null
        ),
        strong: ({ children }) => (
          <strong className="break-words font-semibold text-gray-950">
            {renderCitationAwareChildren(children, "strong")}
          </strong>
        ),
        em: ({ children }) => (
          <em className="text-gray-700">
            {renderCitationAwareChildren(children, "em")}
          </em>
        ),
        blockquote: ({ children }) => (
          <blockquote className="my-3 border-l-2 border-gray-300 pl-3 text-gray-600">
            {renderCitationAwareChildren(children, "quote")}
          </blockquote>
        ),
        code: ({ children }) => (
          <code className="break-words rounded bg-gray-100 px-1 py-0.5 text-[12px] text-gray-900">
            {children}
          </code>
        ),
        pre: ({ children }) => (
          <pre className="my-3 max-w-full overflow-hidden whitespace-pre-wrap break-words rounded-md bg-gray-950 p-3 text-xs leading-5 text-gray-50">
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
              className="break-words font-medium text-blue-700 underline decoration-blue-200 underline-offset-2 hover:text-blue-900"
            >
              {renderedChildren}
            </a>
          ) : (
            <span className="break-words font-medium text-gray-800">{renderedChildren}</span>
          );
        },
      }}
    >
      {content}
    </ReactMarkdown>
  );
}
