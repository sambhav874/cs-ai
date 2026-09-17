"use client";

import { Quote, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";

type CitedSegment = {
  id: string;
  text: string;
  page_number?: number | null;
  page?: number | string | null;
  page_start?: number | null;
  page_end?: number | null;
  type: string;
  contract_id?: string | null;
  contract_name?: string | null;
};

type CitationAnnotation = {
  ref: number;
  doc_id?: string | null;
  document_id?: string | null;
  filename?: string;
  page?: number | string | null;
  page_start?: number | null;
  page_end?: number | null;
  quote: string;
  segment_id?: string;
  evidence_id?: string;
};

interface CitationHoverCardProps {
  annotation: CitationAnnotation | CitedSegment;
  className?: string;
}

function segmentText(segment: CitationAnnotation | CitedSegment): string {
  if ("quote" in segment && segment.quote) return segment.quote;
  if ("text" in segment && segment.text) return segment.text;
  return "";
}

function segmentDocName(segment: CitationAnnotation | CitedSegment): string {
  if ("filename" in segment && segment.filename) return segment.filename;
  if ("contract_name" in segment && segment.contract_name) return segment.contract_name;
  return "Document";
}

function segmentPage(segment: CitationAnnotation | CitedSegment): number | string | null {
  if ("page_start" in segment && "page_end" in segment && segment.page_start != null && segment.page_end != null && segment.page_end !== segment.page_start) {
    return `${segment.page_start}-${segment.page_end}`;
  }
  if ("page" in segment && segment.page) return segment.page;
  if ("page_number" in segment && segment.page_number) return segment.page_number;
  return null;
}

function segmentRef(segment: CitationAnnotation | CitedSegment): number | string {
  if ("ref" in segment) return segment.ref;
  return "";
}

export function CitationHoverCard({ annotation, className }: CitationHoverCardProps) {
  const quote = segmentText(annotation);
  const docName = segmentDocName(annotation);
  const page = segmentPage(annotation);
  const ref = segmentRef(annotation);

  if (!quote) {
    return (
      <span className={cn("inline-flex items-center gap-0.5 rounded bg-gray-100 px-1 py-0 text-[11px] font-medium text-gray-500 cursor-default", className)}>
        [{ref}]
      </span>
    );
  }

  return (
    <span className={cn("group relative inline-flex cursor-default", className)}>
      <span className="inline-flex items-center gap-0.5 rounded bg-emerald-50 px-1 py-0 text-[11px] font-medium text-emerald-700 border border-emerald-100 transition-colors group-hover:bg-emerald-100">
        [{ref}]
        <Quote className="hidden h-2.5 w-2.5 text-emerald-400 group-hover:inline-block" />
      </span>
      <span className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 -translate-x-1/2 opacity-0 transition-opacity group-hover:opacity-100">
        <span className="block w-80 rounded-lg border border-gray-200 bg-white p-3 shadow-lg">
          <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-gray-400">
            <Quote className="h-3 w-3" />
            <span>{docName}</span>
            {page ? <span className="text-gray-300">\u00b7 p. {page}</span> : null}
          </div>
          <p className="text-[11px] leading-5 text-gray-700 whitespace-pre-wrap line-clamp-4">{quote}</p>
          <span className="mt-1.5 block text-[10px] text-gray-400">
            Citation [{ref}]
          </span>
        </span>
      </span>
    </span>
  );
}

interface CitationMarkdownRendererProps {
  content: string;
  annotations?: CitationAnnotation[];
  citedSegments?: CitedSegment[];
}

export function renderMarkdownWithCitations(
  content: string,
  annotations?: CitationAnnotation[],
  citedSegments?: CitedSegment[]
) {
  const segments = annotations?.length
    ? annotations
    : citedSegments?.length
      ? citedSegments.map((seg, index) => ({
          ref: index + 1,
          quote: seg.text || "",
          doc_id: seg.contract_id,
          filename: seg.contract_name,
          page: seg.page_number || seg.page,
          page_start: seg.page_start ?? seg.page_number ?? seg.page ?? undefined,
          page_end: seg.page_end ?? undefined,
          segment_id: seg.id,
        }))
      : [];

  if (!segments.length) return content;

  const parts: Array<{ type: "text" | "citation"; value: string; annotation?: CitationAnnotation }> = [];
  let remaining = content;
  const pattern = /\[(\d+)\]/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(remaining)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ type: "text", value: remaining.slice(lastIndex, match.index) });
    }
    const num = parseInt(match[1], 10);
    const annotation = segments.find((seg) => seg.ref === num);
    parts.push({ type: "citation", value: match[0], annotation: annotation as CitationAnnotation | undefined });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < remaining.length) {
    parts.push({ type: "text", value: remaining.slice(lastIndex) });
  }

  return parts;
}
