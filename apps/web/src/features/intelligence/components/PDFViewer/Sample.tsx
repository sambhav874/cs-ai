import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ZoomIn, ZoomOut, Loader2 } from "lucide-react";
import "./Sample.css";

type CitedSegment = {
  id?: string;
  text?: string;
  page_number?: number | string | null;
  page?: number | string | null;
  type?: string;
};

type QuoteEntry = {
  page?: number | null;
  page_start?: number | null;
  page_end?: number | null;
  quote: string;
};

type RawQuoteEntry = {
  page?: number | string | null;
  page_number?: number | string | null;
  page_start?: number | null;
  page_end?: number | null;
  quote?: string;
  text?: string;
};

type PdfDocument = import("pdfjs-v4").PDFDocumentProxy;
type PdfPage = import("pdfjs-v4").PDFPageProxy;
type PdfViewport = import("pdfjs-v4").PageViewport;
type PdfJs = typeof import("pdfjs-v4");

type PageSlot = {
  pageNumber: number;
  wrapper: HTMLDivElement;
  page?: PdfPage;
  viewport?: PdfViewport;
  canvas?: HTMLCanvasElement;
  textDivs: HTMLElement[];
  renderPromise?: Promise<void>;
  renderedScale?: number;
};

let pdfjsLib: PdfJs | null = null;

const SIDE_PADDING = 20;
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 3.0;
const ZOOM_STEP = 0.25;
const PRELOAD_RADIUS = 2;
const UNLOAD_DISTANCE = 10;
const MAX_DEVICE_PIXEL_RATIO = 1.5;
const STANDARD_FONT_DATA_URL = "https://unpkg.com/pdfjs-dist@4.10.38/standard_fonts/";
const HIGHLIGHT_CLASS = "pdf-text-highlight";
const ORIGINAL_TEXT_ATTR = "data-original-text";
const HIGHLIGHT_STYLE = "background-color: rgba(245, 158, 11, 0.45) !important; border-radius: 2px; color: transparent !important;";
const PAGE_BREAK_SENTINEL = "[[PAGE_BREAK]]";

async function getPdfJs() {
  if (pdfjsLib) return pdfjsLib;
  pdfjsLib = await import("pdfjs-v4");
  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-v4/build/pdf.worker.min.mjs",
    import.meta.url
  ).toString();
  return pdfjsLib;
}

function onlyLetters(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9]/g, "")
    .toLowerCase();
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function clampPage(pageNumber: number, totalPages: number) {
  if (!totalPages) return 1;
  return Math.max(1, Math.min(totalPages, pageNumber));
}

function strippedPosToOriginal(original: string, strippedPos: number) {
  let count = 0;
  for (let i = 0; i < original.length; i++) {
    if (/[a-zA-Z0-9]/.test(original[i])) {
      if (count === strippedPos) return i;
      count++;
    }
  }
  return original.length;
}

function clearHighlights(textDivs: HTMLElement[]) {
  for (const div of textDivs) {
    if (div.hasAttribute(ORIGINAL_TEXT_ATTR)) {
      div.textContent = div.getAttribute(ORIGINAL_TEXT_ATTR) ?? "";
      div.removeAttribute(ORIGINAL_TEXT_ATTR);
    }
  }
}

function clearPageHighlights(pageWrapper: HTMLDivElement) {
  const highlightLayer = pageWrapper.querySelector(".highlight-layer");
  if (highlightLayer) {
    highlightLayer.innerHTML = "";
  }
}

function pageToNumber(value: number | string | null | undefined) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const match = value.match(/\d+/);
    if (match) return Number.parseInt(match[0], 10);
  }
  return null;
}

function quoteSearchKeys(quote: string) {
  const segments = quote
    .split(/\.{3}|…/)
    .map((segment) => onlyLetters(segment))
    .filter((segment) => segment.length > 0);

  const keys: string[] = [];
  for (const seg of segments) {
    if (seg.length <= 48) {
      keys.push(seg);
    } else {
      keys.push(seg.slice(0, 48));
      keys.push(seg.slice(seg.length - 48));
      if (seg.length > 120) {
        keys.push(seg.slice(Math.floor(seg.length / 2) - 24, Math.floor(seg.length / 2) + 24));
      }
    }
  }
  return keys.filter((k) => k.length > 0);
}

function quoteMatchesPageText(pageText: string, quote: string) {
  const searchKeys = quoteSearchKeys(quote);
  return searchKeys.length > 0 && searchKeys.some((key) => pageText.includes(key));
}

function debugLog(message: string, data?: any) {
  const apiUrl = process.env.NEXT_PUBLIC_EXTRACTOR_API_URL || "http://localhost:8000/api/v1";
  fetch(`${apiUrl}/contracts/debug_log`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, data: data ? JSON.stringify(data) : "" }),
  }).catch(() => {});
}

function findLongestCommonSubstring(segment: string, fullStripped: string): { matchPos: number; matchLength: number } {
  const directIdx = fullStripped.indexOf(segment);
  if (directIdx !== -1) {
    return { matchPos: directIdx, matchLength: segment.length };
  }

  let bestPos = -1;
  let bestLen = 0;

  const m = segment.length;
  const n = fullStripped.length;
  if (m === 0 || n === 0) return { matchPos: -1, matchLength: 0 };

  let prevRow = new Array(n + 1).fill(0);
  let currRow = new Array(n + 1).fill(0);

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (segment[i - 1] === fullStripped[j - 1]) {
        currRow[j] = prevRow[j - 1] + 1;
        if (currRow[j] > bestLen) {
          bestLen = currRow[j];
          bestPos = j - bestLen;
        }
      } else {
        currRow[j] = 0;
      }
    }
    for (let j = 0; j <= n; j++) {
      prevRow[j] = currRow[j];
    }
  }

  return { matchPos: bestPos, matchLength: bestLen };
}

async function highlightQuote(textDivs: HTMLElement[], pageWrapper: HTMLDivElement, quote: string) {
  const logPrefix = "[PDFHighlight]";
  console.log(logPrefix, "highlightQuote entry", { quote: quote.slice(0, 80), divsCount: textDivs.length });
  debugLog("highlightQuote entry", { quote: quote.slice(0, 120), divsCount: textDivs.length });

  const segments = quote
    .split(/\.{3}|…/)
    .map((segment) => onlyLetters(segment))
    .filter((segment) => segment.length > 0);

  if (!segments.length) {
    console.log(logPrefix, "empty segments");
    debugLog("highlightQuote empty segments");
    return false;
  }

  // Ensure highlight-layer exists inside the pageWrapper
  let highlightLayer = pageWrapper.querySelector(".highlight-layer") as HTMLDivElement | null;
  if (!highlightLayer) {
    highlightLayer = document.createElement("div");
    highlightLayer.className = "highlight-layer";
    highlightLayer.style.position = "absolute";
    highlightLayer.style.left = "0";
    highlightLayer.style.top = "0";
    highlightLayer.style.width = "100%";
    highlightLayer.style.height = "100%";
    highlightLayer.style.pointerEvents = "none";
    highlightLayer.style.zIndex = "3";
    pageWrapper.appendChild(highlightLayer);
  }

  const divOrigTexts: string[] = [];
  const divStripped: string[] = [];
  const divStartInFull: number[] = [];
  let fullStripped = "";

  for (let i = 0; i < textDivs.length; i++) {
    const original = textDivs[i].textContent ?? "";
    const stripped = onlyLetters(original);
    divOrigTexts.push(original);
    divStripped.push(stripped);
    divStartInFull.push(fullStripped.length);
    fullStripped += stripped;
  }

  console.log(logPrefix, "fullStripped length:", fullStripped.length, "first80:", fullStripped.slice(0, 80));

  const divHighlightRanges = new Map<number, [number, number]>();

  for (const segment of segments) {
    const { matchPos, matchLength } = findLongestCommonSubstring(segment, fullStripped);

    console.log(logPrefix, "Segment match:", { matchPos, matchLength, segLen: segment.length });
    debugLog("Segment match info", { matchPos, matchLength, segmentLen: segment.length, fullStrippedLen: fullStripped.length });
    if (matchPos === -1 || matchLength < 20) {
      debugLog("Segment NOT found in fullStripped (no high-quality match)", { segment: segment.slice(0, 80), fullStrippedStart: fullStripped.slice(0, 80) });
      continue;
    }

    const matchEnd = matchPos + matchLength;

    for (let i = 0; i < textDivs.length; i++) {
      const divStart = divStartInFull[i];
      const divEnd = divStart + divStripped[i].length;
      if (matchPos >= divEnd || matchEnd <= divStart) continue;

      const localStart = Math.max(0, matchPos - divStart);
      const localEnd = Math.min(divStripped[i].length, matchEnd - divStart);
      divHighlightRanges.set(i, [localStart, localEnd]);
    }
  }

  if (divHighlightRanges.size === 0) {
    console.log(logPrefix, "divHighlightRanges was 0, running fallback");
    debugLog("divHighlightRanges was 0, running fallback");
    for (const segment of segments) {
      const candidates = [
        segment.slice(0, Math.min(segment.length, 120)),
        segment.slice(0, Math.min(segment.length, 80)),
        segment.slice(0, Math.min(segment.length, 48)),
        segment.slice(0, Math.min(segment.length, 32)),
      ].filter((c, idx, arr) => arr.indexOf(c) === idx);

      for (const candidate of candidates) {
        let found = false;
        for (let i = 0; i < textDivs.length; i++) {
          const pos = divStripped[i].indexOf(candidate);
          if (pos !== -1) {
            const end = pos + candidate.length;
            divHighlightRanges.set(i, [pos, Math.min(end, divStripped[i].length)]);
            found = true;
            break;
          }
        }
        if (found) break;
      }
      if (divHighlightRanges.size > 0) break;
    }
  }

  console.log(logPrefix, "Final divHighlightRanges size:", divHighlightRanges.size);
  debugLog("Final divHighlightRanges size", { size: divHighlightRanges.size });
  if (divHighlightRanges.size === 0) return false;

  const pageWrapperRect = pageWrapper.getBoundingClientRect();

  for (const [index, [strippedStart, strippedEnd]] of divHighlightRanges) {
    const div = textDivs[index];
    const original = divOrigTexts[index];
    const originalStart = strippedPosToOriginal(original, strippedStart);
    const originalEnd = strippedPosToOriginal(original, strippedEnd);

    // Get the Text Node inside the div
    let textNode: Node | null = null;
    for (let child = div.firstChild; child; child = child.nextSibling) {
      if (child.nodeType === Node.TEXT_NODE) {
        textNode = child;
        break;
      }
    }
    if (!textNode) continue;

    try {
      const range = document.createRange();
      range.setStart(textNode, originalStart);
      range.setEnd(textNode, originalEnd);

      const rects = range.getClientRects();
      for (let r = 0; r < rects.length; r++) {
        const clientRect = rects[r];
        
        // Calculate coords relative to the pageWrapper
        const left = clientRect.left - pageWrapperRect.left;
        const top = clientRect.top - pageWrapperRect.top;
        const width = clientRect.width;
        const height = clientRect.height;

        // Skip invalid/empty rectangles
        if (width <= 0 || height <= 0) continue;

        const overlay = document.createElement("div");
        overlay.className = "highlight-overlay pdf-text-highlight";
        overlay.style.left = `${left}px`;
        overlay.style.top = `${top}px`;
        overlay.style.width = `${width}px`;
        overlay.style.height = `${height}px`;
        
        highlightLayer.appendChild(overlay);
      }
    } catch (err) {
      console.warn("Failed to create DOM range highlight", err);
    }
  }

  debugLog("highlightQuote returning true");
  return true;
}

function expandQuoteEntry(entry: RawQuoteEntry): QuoteEntry[] {
  const rawQuote = (entry.quote ?? entry.text ?? "").trim();
  if (!rawQuote) return [];

  const page = pageToNumber(entry.page ?? entry.page_number);
  const pageStart = entry.page_start ?? page;
  const pageEnd = entry.page_end ?? pageStart;
  const quoteParts = rawQuote
    .split(PAGE_BREAK_SENTINEL)
    .map((part) => part.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  if (quoteParts.length <= 1) {
    return [{
      page,
      page_start: pageStart,
      page_end: pageEnd,
      quote: rawQuote.replace(PAGE_BREAK_SENTINEL, " ").trim(),
    }];
  }

  return quoteParts.map((quote, index) => ({
    page: page ? page + index : null,
    page_start: pageStart,
    page_end: pageEnd,
    quote,
  }));
}

function parseSearchValue(searchValue: string): QuoteEntry[] {
  const trimmed = searchValue.trim();
  if (!trimmed) return [];

  try {
    const parsed = JSON.parse(trimmed) as Array<CitedSegment | QuoteEntry | RawQuoteEntry>;
    if (Array.isArray(parsed)) {
      return parsed
        .flatMap((entry) => expandQuoteEntry(entry))
        .filter((entry) => entry.quote.length > 0);
    }
  } catch {
    // Fall back to a plain text search.
  }

  return [{ quote: trimmed }];
}

function createPagePlaceholder(pageNumber: number, width: number, height: number) {
  const wrapper = document.createElement("div");
  wrapper.dataset.pageNumber = String(pageNumber);
  wrapper.style.position = "relative";
  wrapper.style.margin = "0 auto 12px";
  wrapper.style.width = `${width}px`;
  wrapper.style.height = `${height}px`;
  wrapper.style.overflow = "hidden";
  wrapper.style.background = "#fff";
  wrapper.style.boxShadow = "0 4px 12px rgba(15, 23, 42, 0.12)";

  const placeholder = document.createElement("div");
  placeholder.style.position = "absolute";
  placeholder.style.inset = "0";
  placeholder.style.display = "flex";
  placeholder.style.alignItems = "center";
  placeholder.style.justifyContent = "center";
  placeholder.style.fontSize = "12px";
  placeholder.style.color = "#9ca3af";
  placeholder.style.background = "linear-gradient(90deg, #fff, #f8fafc, #fff)";
  placeholder.textContent = `Page ${pageNumber}`;
  wrapper.appendChild(placeholder);

  return wrapper;
}

export default function PDFViewer({
  contractId,
  searchValue,
  token,
}: {
  contractId: string;
  searchKey: string;
  searchValue: string;
  token: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const pdfDocRef = useRef<PdfDocument | null>(null);
  const pageSlotsRef = useRef<PageSlot[]>([]);
  const quoteListRef = useRef<QuoteEntry[]>([]);
  const pageTextCacheRef = useRef<Map<number, string>>(new Map());
  const observerRef = useRef<IntersectionObserver | null>(null);
  const layoutRequestIdRef = useRef(0);
  const scaleRef = useRef(1);
  const zoomRef = useRef(1);
  const currentPageRef = useRef(1);

  const [pdfBuffer, setPdfBuffer] = useState<ArrayBuffer | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [currentPage, setCurrentPage] = useState(1);
  const [numPages, setNumPages] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [highlightMarkers, setHighlightMarkers] = useState<number[]>([]);

  const updateHighlightMarkers = useCallback(() => {
    const scrollContainer = scrollContainerRef.current;
    if (!scrollContainer) return;

    const highlights = scrollContainer.querySelectorAll<HTMLElement>(".pdf-text-highlight");
    const scrollHeight = scrollContainer.scrollHeight;
    if (scrollHeight === 0) return;

    const positions: number[] = [];
    const scrollContainerRect = scrollContainer.getBoundingClientRect();

    highlights.forEach((el) => {
      const rect = el.getBoundingClientRect();
      const relativeTop = rect.top - scrollContainerRect.top + scrollContainer.scrollTop;
      const percent = (relativeTop / scrollHeight) * 100;
      positions.push(percent);
    });

    const uniquePositions = positions.filter((pos, idx, arr) => {
      return arr.findIndex((p) => Math.abs(p - pos) < 1) === idx;
    });

    setHighlightMarkers(uniquePositions);
  }, []);

  const quoteList = useMemo(() => parseSearchValue(searchValue), [searchValue]);
  const quoteKey = useMemo(
    () => quoteList.map((entry) => `${entry.page ?? ""}:${entry.quote}`).join("|"),
    [quoteList]
  );

  const pdfUrl = `${process.env.NEXT_PUBLIC_EXTRACTOR_API_URL}/contracts/${contractId}/render`;

  const clearViewer = useCallback(() => {
    layoutRequestIdRef.current += 1;
    observerRef.current?.disconnect();
    observerRef.current = null;
    pdfDocRef.current = null;
    pageSlotsRef.current = [];
    pageTextCacheRef.current.clear();
    setHighlightMarkers([]);
    if (containerRef.current) {
      containerRef.current.innerHTML = "";
    }
  }, []);

  const unloadRenderedPage = useCallback((slot: PageSlot) => {
    if (slot.renderPromise) return;
    slot.wrapper.innerHTML = "";
    slot.canvas = undefined;
    slot.textDivs = [];
    slot.viewport = undefined;
    slot.renderedScale = undefined;
  }, []);

  const clearRenderedHighlights = useCallback(() => {
    pageSlotsRef.current.forEach((slot) => {
      clearHighlights(slot.textDivs);
      clearPageHighlights(slot.wrapper);
    });
    setHighlightMarkers([]);
  }, []);

  const highlightRenderedPage = useCallback(async (pageNumber: number, list: QuoteEntry[], force = false) => {
    const slot = pageSlotsRef.current[pageNumber - 1];
    if (!slot?.textDivs.length) return false;

    clearHighlights(slot.textDivs);
    clearPageHighlights(slot.wrapper);

    let found = false;
    const pageEntries = force
      ? list
      : list.filter((entry) => {
          if (entry.page_start != null && entry.page_end != null) {
            return pageNumber >= entry.page_start && pageNumber <= entry.page_end;
          }
          return !entry.page || entry.page === pageNumber;
        });
    for (const entry of pageEntries) {
      const hit = await highlightQuote(slot.textDivs, slot.wrapper, entry.quote);
      found = found || hit;
    }
    setTimeout(updateHighlightMarkers, 50);
    return found;
  }, [updateHighlightMarkers]);

  const getPageText = useCallback(async (pageNumber: number) => {
    const cached = pageTextCacheRef.current.get(pageNumber);
    if (cached !== undefined) return cached;

    const doc = pdfDocRef.current;
    if (!doc) return "";

    const page = await doc.getPage(pageNumber);
    const textContent = await page.getTextContent();
    const text = (textContent.items as Array<{ str?: string }>)
      .map((item) => item.str ?? "")
      .join(" ");
    const normalized = onlyLetters(text);
    pageTextCacheRef.current.set(pageNumber, normalized);
    return normalized;
  }, []);

  const findQuotePage = useCallback(async (quote: string, hintedPage?: number | null) => {
    const doc = pdfDocRef.current;
    if (!doc) return null;

    const pageOrder: number[] = [];
    if (hintedPage) pageOrder.push(clampPage(hintedPage, doc.numPages));
    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
      if (!pageOrder.includes(pageNumber)) pageOrder.push(pageNumber);
    }

    for (const pageNumber of pageOrder) {
      const pageText = await getPageText(pageNumber);
      if (quoteMatchesPageText(pageText, quote)) {
        return pageNumber;
      }
    }
    return null;
  }, [getPageText]);

  const renderPage = useCallback(async (pageNumber: number) => {
    const doc = pdfDocRef.current;
    const slot = pageSlotsRef.current[pageNumber - 1];
    if (!doc || !slot) return;

    const scale = scaleRef.current;
    if (slot.renderedScale === scale && slot.canvas && slot.textDivs.length) {
      await highlightRenderedPage(pageNumber, quoteListRef.current);
      return;
    }

    if (slot.renderPromise) {
      await slot.renderPromise;
      return;
    }

    const requestId = layoutRequestIdRef.current;
    slot.renderPromise = (async () => {
      const lib = await getPdfJs();
      if (requestId !== layoutRequestIdRef.current) return;

      const page = slot.page ?? await doc.getPage(pageNumber);
      if (requestId !== layoutRequestIdRef.current) return;

      const viewport = page.getViewport({ scale });
      const outputScale = Math.min(window.devicePixelRatio || 1, MAX_DEVICE_PIXEL_RATIO);
      slot.page = page;
      slot.viewport = viewport;
      slot.wrapper.style.width = `${viewport.width}px`;
      slot.wrapper.style.height = `${viewport.height}px`;
      slot.wrapper.innerHTML = "";

      const canvas = document.createElement("canvas");
      canvas.width = Math.floor(viewport.width * outputScale);
      canvas.height = Math.floor(viewport.height * outputScale);
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;
      canvas.style.display = "block";
      slot.wrapper.appendChild(canvas);

      const canvasContext = canvas.getContext("2d");
      if (!canvasContext) return;

      const renderTask = page.render({
        canvasContext,
        viewport,
        transform: outputScale !== 1
          ? [outputScale, 0, 0, outputScale, 0, 0]
          : undefined,
      });

      try {
        await renderTask.promise;
      } catch (err) {
        if ((err as { name?: string })?.name !== "RenderingCancelledException") {
          console.error("PDF render error", err);
        }
        return;
      }
      if (requestId !== layoutRequestIdRef.current) return;

      const textLayerDiv = document.createElement("div");
      textLayerDiv.className = "pdf-text-layer";
      textLayerDiv.style.position = "absolute";
      textLayerDiv.style.left = "0";
      textLayerDiv.style.top = "0";
      textLayerDiv.style.width = `${viewport.width}px`;
      textLayerDiv.style.height = `${viewport.height}px`;
      textLayerDiv.style.overflow = "hidden";
      textLayerDiv.style.lineHeight = "1";
      textLayerDiv.style.pointerEvents = "none";
      textLayerDiv.style.userSelect = "none";
      textLayerDiv.style.setProperty("--scale-factor", String(scale));
      textLayerDiv.setAttribute("aria-hidden", "true");
      slot.wrapper.appendChild(textLayerDiv);

      const textLayer = new lib.TextLayer({
        textContentSource: page.streamTextContent(),
        container: textLayerDiv,
        viewport,
      });
      await textLayer.render();
      if (requestId !== layoutRequestIdRef.current) return;

      for (const textDiv of textLayer.textDivs) {
        textDiv.style.color = "transparent";
        textDiv.style.position = "absolute";
        textDiv.style.whiteSpace = "pre";
        textDiv.style.transformOrigin = "0% 0%";
        textDiv.style.pointerEvents = "none";
        textDiv.style.userSelect = "none";
      }

      slot.canvas = canvas;
      slot.textDivs = textLayer.textDivs;
      slot.renderedScale = scale;
      await highlightRenderedPage(pageNumber, quoteListRef.current);
    })();

    try {
      await slot.renderPromise;
    } finally {
      slot.renderPromise = undefined;
    }
  }, [highlightRenderedPage]);

  const pruneRenderedPages = useCallback((centerPage: number) => {
    pageSlotsRef.current.forEach((slot) => {
      if (Math.abs(slot.pageNumber - centerPage) > UNLOAD_DISTANCE) {
        unloadRenderedPage(slot);
      }
    });
  }, [unloadRenderedPage]);

  const renderPageWindow = useCallback((centerPage: number) => {
    const totalPages = pageSlotsRef.current.length;
    const normalizedCenter = clampPage(centerPage, totalPages);
    const start = Math.max(1, normalizedCenter - PRELOAD_RADIUS);
    const end = Math.min(totalPages, normalizedCenter + PRELOAD_RADIUS);

    for (let pageNumber = start; pageNumber <= end; pageNumber++) {
      void renderPage(pageNumber);
    }
    pruneRenderedPages(normalizedCenter);
  }, [pruneRenderedPages, renderPage]);

  const scrollToPage = useCallback((pageNumber: number, behavior: ScrollBehavior = "auto") => {
    const slot = pageSlotsRef.current[pageNumber - 1];
    if (!slot) return;

    slot.wrapper.scrollIntoView({
      behavior,
      block: "start",
    });
  }, []);

  const scrollToHighlightOnPage = useCallback((pageNumber: number) => {
    const slot = pageSlotsRef.current[pageNumber - 1];
    const scrollElement = scrollContainerRef.current;
    if (!slot || !scrollElement) return;

    const highlightElement = slot.wrapper.querySelector<HTMLElement>(".pdf-text-highlight");

    if (highlightElement) {
      const containerRect = scrollElement.getBoundingClientRect();
      const highlightRect = highlightElement.getBoundingClientRect();
      const offsetWithinContainer = highlightRect.top - containerRect.top;
      const targetTop =
        scrollElement.scrollTop +
        offsetWithinContainer -
        scrollElement.clientHeight / 2 +
        highlightRect.height / 2;

      scrollElement.scrollTo({
        top: Math.max(0, targetTop),
        behavior: "smooth",
      });
      return;
    }

    scrollToPage(pageNumber, "smooth");
  }, [scrollToPage]);

  const applyHighlights = useCallback(async (list: QuoteEntry[]) => {
    clearRenderedHighlights();
    if (!list.length) return null;

    let firstHitPage: number | null = null;

    for (const entry of list) {
      // Find all matching pages for this quote
      const matchingPages: number[] = [];
      const numPages = pageSlotsRef.current.length;
      for (let p = 1; p <= numPages; p++) {
        const pageText = await getPageText(p);
        if (quoteMatchesPageText(pageText, entry.quote)) {
          matchingPages.push(p);
        }
      }

      if (matchingPages.length > 0) {
        entry.page_start = Math.min(...matchingPages);
        entry.page_end = Math.max(...matchingPages);
        entry.page = entry.page_start;
      }

      let hitPage: number | null = null;

      // Render and highlight all matching pages in the range
      if (entry.page_start != null && entry.page_end != null) {
        for (let p = entry.page_start; p <= entry.page_end && p <= numPages; p++) {
          const pageNum = clampPage(p, numPages);
          await renderPage(pageNum);
          const found = await highlightRenderedPage(pageNum, [entry], true);
          if (found && hitPage === null) {
            hitPage = pageNum;
          }
        }
      }

      // Fallback: if hinted page is not in the identified range
      if (hitPage === null && entry.page) {
        const hintedPage = clampPage(entry.page, numPages);
        await renderPage(hintedPage);
        const found = await highlightRenderedPage(hintedPage, [entry], true);
        if (found) hitPage = hintedPage;
      }

      if (hitPage === null) {
        const foundPage = await findQuotePage(entry.quote, entry.page);
        if (foundPage) {
          entry.page = foundPage;
          await renderPage(foundPage);
          const found = await highlightRenderedPage(foundPage, [entry], true);
          if (found) hitPage = foundPage;
        }
      }

      if (hitPage !== null && firstHitPage === null) {
        firstHitPage = hitPage;
      }
    }

    return firstHitPage;
  }, [clearRenderedHighlights, findQuotePage, getPageText, highlightRenderedPage, renderPage]);

  const observePageSlots = useCallback(() => {
    observerRef.current?.disconnect();
    const scrollElement = scrollContainerRef.current;
    if (!scrollElement) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const pageNumber = Number((entry.target as HTMLElement).dataset.pageNumber);
          if (Number.isFinite(pageNumber)) {
            renderPageWindow(pageNumber);
          }
        }
      },
      {
        root: scrollElement,
        rootMargin: "1200px 0px",
        threshold: 0.01,
      },
    );

    pageSlotsRef.current.forEach((slot) => observer.observe(slot.wrapper));
    observerRef.current = observer;
  }, [renderPageWindow]);

  const initializePdfLayout = useCallback(async (
    doc: PdfDocument,
    list: QuoteEntry[],
    preferredPage?: number,
  ) => {
    const container = containerRef.current;
    if (!container) return;

    const requestId = ++layoutRequestIdRef.current;
    observerRef.current?.disconnect();
    observerRef.current = null;

    const lib = await getPdfJs();
    if (requestId !== layoutRequestIdRef.current) return;
    lib.TextLayer.cleanup();

    setNumPages(doc.numPages);
    const targetPage = clampPage(
      preferredPage || list.find((entry) => entry.page)?.page || currentPageRef.current || 1,
      doc.numPages,
    );
    currentPageRef.current = targetPage;
    setCurrentPage(targetPage);

    const panelWidth = Math.max(container.clientWidth, scrollContainerRef.current?.clientWidth ?? 0, 320);
    const firstPage = await doc.getPage(1);
    if (requestId !== layoutRequestIdRef.current) return;

    const naturalViewport = firstPage.getViewport({ scale: 1 });
    const baseScale = Math.max(0.5, (panelWidth - SIDE_PADDING) / naturalViewport.width);
    const scale = baseScale * zoomRef.current;
    scaleRef.current = scale;

    const estimatedWidth = naturalViewport.width * scale;
    const estimatedHeight = naturalViewport.height * scale;
    const fragment = document.createDocumentFragment();
    const slots: PageSlot[] = [];

    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
      const wrapper = createPagePlaceholder(pageNumber, estimatedWidth, estimatedHeight);
      fragment.appendChild(wrapper);
      slots.push({ pageNumber, wrapper, textDivs: [] });
    }

    container.innerHTML = "";
    container.appendChild(fragment);
    pageSlotsRef.current = slots;
    observePageSlots();

    scrollToPage(targetPage);
    renderPageWindow(targetPage);
    setIsLoading(false);

    if (list.length) {
      const hitPage = await applyHighlights(list);
      if (requestId !== layoutRequestIdRef.current) return;
      const fallbackPage = list.find((entry) => entry.page)?.page ?? null;
      const scrollPage = hitPage ?? fallbackPage;
      if (scrollPage) {
        scrollToHighlightOnPage(clampPage(scrollPage, doc.numPages));
      }
    }
  }, [applyHighlights, observePageSlots, renderPageWindow, scrollToHighlightOnPage, scrollToPage]);

  useEffect(() => {
    let cancelled = false;

    const fetchPdf = async () => {
      clearViewer();
      setIsLoading(true);
      setError(null);
      setPdfBuffer(null);
      setNumPages(0);

      try {
        const response = await fetch(pdfUrl, {
          headers: { Authorization: `Bearer ${token}` },
        });

        if (!response.ok) {
          throw new Error(`Failed to load PDF: ${response.statusText || response.status}`);
        }

        const buffer = await response.arrayBuffer();
        if (!cancelled) setPdfBuffer(buffer);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load PDF");
          setIsLoading(false);
        }
      }
    };

    fetchPdf();

    return () => {
      cancelled = true;
    };
  }, [clearViewer, pdfUrl, token]);

  useEffect(() => {
    const element = scrollContainerRef.current;
    if (!element) return;

    const resizeObserver = new ResizeObserver((entries) => {
      const nextWidth = Math.round(entries[0]?.contentRect.width ?? 0);
      if (!nextWidth) return;

      setContainerWidth((currentWidth) => {
        if (!currentWidth) return nextWidth;
        return Math.abs(currentWidth - nextWidth) > 24 ? nextWidth : currentWidth;
      });
    });

    resizeObserver.observe(element);
    return () => resizeObserver.disconnect();
  }, []);

  useEffect(() => {
    const scrollElement = scrollContainerRef.current;
    if (!scrollElement) return;

    const handleScroll = () => {
      const slots = pageSlotsRef.current;
      if (!slots.length) return;

      const scrollCenter = scrollElement.scrollTop + scrollElement.clientHeight / 2;
      let closest = 0;
      let closestDistance = Infinity;

      slots.forEach((slot, index) => {
        const pageCenter = slot.wrapper.offsetTop + slot.wrapper.clientHeight / 2;
        const distance = Math.abs(pageCenter - scrollCenter);
        if (distance < closestDistance) {
          closestDistance = distance;
          closest = index;
        }
      });

      const nextPage = closest + 1;
      currentPageRef.current = nextPage;
      setCurrentPage(nextPage);
      renderPageWindow(nextPage);
    };

    scrollElement.addEventListener("scroll", handleScroll, { passive: true });
    return () => scrollElement.removeEventListener("scroll", handleScroll);
  }, [renderPageWindow]);

  useEffect(() => {
    if (!pdfBuffer) return;

    let cancelled = false;
    pdfDocRef.current = null;
    pageSlotsRef.current = [];
    pageTextCacheRef.current.clear();
    quoteListRef.current = quoteList;
    zoomRef.current = 1;
    setZoom(1);
    setNumPages(0);
    setIsLoading(true);

    (async () => {
      const lib = await getPdfJs();
      if (cancelled) return;

      const pdfDoc = await lib.getDocument({
        data: new Uint8Array(pdfBuffer),
        standardFontDataUrl: STANDARD_FONT_DATA_URL,
      }).promise;

      if (cancelled) return;
      pdfDocRef.current = pdfDoc;
      await initializePdfLayout(pdfDoc, quoteList);
    })().catch((err) => {
      if (!cancelled) {
        setError(err instanceof Error ? err.message : "Failed to render PDF");
        setIsLoading(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [initializePdfLayout, pdfBuffer]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!pdfDocRef.current || !containerWidth) return;

    const timer = setTimeout(() => {
      if (pdfDocRef.current) {
        initializePdfLayout(pdfDocRef.current, quoteListRef.current, currentPageRef.current);
        setTimeout(updateHighlightMarkers, 300);
      }
    }, 150);

    return () => clearTimeout(timer);
  }, [containerWidth, initializePdfLayout, updateHighlightMarkers]);

  useEffect(() => {
    if (!pdfDocRef.current) return;

    quoteListRef.current = quoteList;
    if (quoteList.length === 0) {
      clearRenderedHighlights();
      return;
    }

    applyHighlights(quoteList).then((targetPage) => {
      const fallbackPage = quoteList.find((entry) => entry.page)?.page ?? null;
      const scrollPage = targetPage ?? fallbackPage;
      if (scrollPage && pdfDocRef.current) {
        scrollToHighlightOnPage(clampPage(scrollPage, pdfDocRef.current.numPages));
      }
    });
  }, [applyHighlights, clearRenderedHighlights, quoteKey, quoteList, scrollToHighlightOnPage]);

  useEffect(() => {
    return () => {
      observerRef.current?.disconnect();
      getPdfJs().then((lib) => lib.TextLayer.cleanup());
    };
  }, []);

  async function handleZoomIn() {
    const next = Math.min(ZOOM_MAX, Math.round((zoomRef.current + ZOOM_STEP) * 100) / 100);
    zoomRef.current = next;
    setZoom(next);
    if (pdfDocRef.current) {
      const scrollEl = scrollContainerRef.current;
      const scrollRatio = scrollEl ? scrollEl.scrollTop / Math.max(1, scrollEl.scrollHeight - scrollEl.clientHeight) : 0;
      await initializePdfLayout(pdfDocRef.current, quoteListRef.current, currentPageRef.current);
      if (scrollEl) {
        const newScrollMax = Math.max(0, scrollEl.scrollHeight - scrollEl.clientHeight);
        scrollEl.scrollTop = scrollRatio * newScrollMax;
      }
    }
  }

  async function handleZoomOut() {
    const next = Math.max(ZOOM_MIN, Math.round((zoomRef.current - ZOOM_STEP) * 100) / 100);
    zoomRef.current = next;
    setZoom(next);
    if (pdfDocRef.current) {
      const scrollEl = scrollContainerRef.current;
      const scrollRatio = scrollEl ? scrollEl.scrollTop / Math.max(1, scrollEl.scrollHeight - scrollEl.clientHeight) : 0;
      await initializePdfLayout(pdfDocRef.current, quoteListRef.current, currentPageRef.current);
      if (scrollEl) {
        const newScrollMax = Math.max(0, scrollEl.scrollHeight - scrollEl.clientHeight);
        scrollEl.scrollTop = scrollRatio * newScrollMax;
      }
    }
  }

  return (
    <div className="relative flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-surface-100">
      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-auto bg-surface-100 px-3 pb-3 pt-5 transition-opacity"
      >
        {isLoading && (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-primary-700" />
            <span className="ml-2 text-sm text-fg-700">Loading PDF...</span>
          </div>
        )}

        {error && (
          <div className="flex h-full items-center justify-center p-4 text-sm text-risk-600">
            {error}
          </div>
        )}

        <div ref={containerRef} />
      </div>

      {numPages > 0 && (
        <>
          <div className="pointer-events-none absolute bottom-4 left-4">
            <span className="flex items-center rounded-full border border-surface-0/30 bg-card/25 px-3 py-1.5 text-xs font-medium tabular-nums text-fg-700 shadow-e2 backdrop-blur-md">
              {currentPage}/{numPages}
            </span>
          </div>

          <div className="absolute bottom-4 right-4 flex items-center gap-px rounded-full border border-surface-0/30 bg-card/25 px-1 py-1 shadow-e2 backdrop-blur-md">
            <button
              onClick={handleZoomOut}
              disabled={zoom <= ZOOM_MIN}
              className="flex h-7 w-7 items-center justify-center rounded-full text-fg-700 transition-colors hover:bg-card/80 disabled:opacity-30"
              aria-label="Zoom out"
            >
              <ZoomOut className="h-3.5 w-3.5" />
            </button>
            <span className="w-9 select-none text-center text-xs font-medium tabular-nums text-fg-700">
              {Math.round(zoom * 100)}%
            </span>
            <button
              onClick={handleZoomIn}
              disabled={zoom >= ZOOM_MAX}
              className="flex h-7 w-7 items-center justify-center rounded-full text-fg-700 transition-colors hover:bg-card/80 disabled:opacity-30"
              aria-label="Zoom in"
            >
              <ZoomIn className="h-3.5 w-3.5" />
            </button>
          </div>
        </>
      )}

      {highlightMarkers.length > 0 && (
        <div className="absolute right-0 top-0 bottom-0 w-2.5 z-20 bg-black/[0.02] border-l border-black/[0.04]">
          {highlightMarkers.map((pos, idx) => (
            <button
              key={idx}
              onClick={() => {
                const container = scrollContainerRef.current;
                if (container) {
                  const targetTop = (pos / 100) * container.scrollHeight - container.clientHeight / 2;
                  container.scrollTo({
                    top: Math.max(0, targetTop),
                    behavior: "smooth"
                  });
                }
              }}
              className="absolute left-0 right-0 h-1.5 bg-attention-600 hover:bg-attention-600 rounded-sm opacity-90 shadow-e1 border border-attention-600/30 cursor-pointer transition-all hover:scale-y-150"
              style={{ top: `${pos}%` }}
              title="Click to scroll to highlight"
            />
          ))}
        </div>
      )}
    </div>
  );
}
