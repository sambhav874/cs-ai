"use client";

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
  quote: string;
};

type RawQuoteEntry = {
  page?: number | string | null;
  page_number?: number | string | null;
  quote?: string;
  text?: string;
};

type PdfDocument = import("pdfjs-dist").PDFDocumentProxy;
type PdfPage = import("pdfjs-dist").PDFPageProxy;
type PdfViewport = import("pdfjs-dist").PageViewport;
type PdfJs = typeof import("pdfjs-dist");

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
const HIGHLIGHT_STYLE = "background-color: rgba(37, 99, 235, 0.24); border-radius: 2px; color: transparent;";
const PAGE_BREAK_SENTINEL = "[[PAGE_BREAK]]";

async function getPdfJs() {
  if (pdfjsLib) return pdfjsLib;
  pdfjsLib = await import("pdfjs-dist");
  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url
  ).toString();
  return pdfjsLib;
}

function onlyLetters(value: string) {
  return value.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
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

function pageToNumber(value: number | string | null | undefined) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const match = value.match(/\d+/);
    if (match) return Number.parseInt(match[0], 10);
  }
  return null;
}

function quoteSearchKeys(quote: string) {
  return quote
    .split(/\.{3}|…/)
    .map((segment) => onlyLetters(segment))
    .filter((segment) => segment.length > 0)
    .map((segment) => segment.slice(0, Math.min(segment.length, 48)));
}

function quoteMatchesPageText(pageText: string, quote: string) {
  const searchKeys = quoteSearchKeys(quote);
  return searchKeys.length > 0 && searchKeys.some((key) => pageText.includes(key));
}

async function highlightQuote(textDivs: HTMLElement[], quote: string) {
  const segments = quote
    .split(/\.{3}|…/)
    .map((segment) => onlyLetters(segment))
    .filter((segment) => segment.length > 0);

  if (!segments.length) return false;

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

  const divHighlightRanges = new Map<number, [number, number]>();

  for (const segment of segments) {
    const searchKey = segment.slice(0, Math.min(segment.length, 48));
    const matchPos = fullStripped.indexOf(searchKey);
    if (matchPos === -1) continue;

    const matchEnd = matchPos + segment.length;

    for (let i = 0; i < textDivs.length; i++) {
      const divStart = divStartInFull[i];
      const divEnd = divStart + divStripped[i].length;
      if (matchPos >= divEnd || matchEnd <= divStart) continue;

      const localStart = Math.max(0, matchPos - divStart);
      const localEnd = Math.min(divStripped[i].length, matchEnd - divStart);
      divHighlightRanges.set(i, [localStart, localEnd]);
    }
  }

  if (divHighlightRanges.size === 0) return false;

  for (const [index, [strippedStart, strippedEnd]] of divHighlightRanges) {
    const div = textDivs[index];
    const original = divOrigTexts[index];
    const originalStart = strippedPosToOriginal(original, strippedStart);
    const originalEnd = strippedPosToOriginal(original, strippedEnd);

    div.setAttribute(ORIGINAL_TEXT_ATTR, original);
    div.innerHTML =
      escapeHtml(original.slice(0, originalStart)) +
      `<span class="${HIGHLIGHT_CLASS}" style="${HIGHLIGHT_STYLE}">${escapeHtml(original.slice(originalStart, originalEnd))}</span>` +
      escapeHtml(original.slice(originalEnd));
  }

  return true;
}

function expandQuoteEntry(entry: RawQuoteEntry): QuoteEntry[] {
  const rawQuote = (entry.quote ?? entry.text ?? "").trim();
  if (!rawQuote) return [];

  const page = pageToNumber(entry.page ?? entry.page_number);
  const quoteParts = rawQuote
    .split(PAGE_BREAK_SENTINEL)
    .map((part) => part.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  if (quoteParts.length <= 1) {
    return [{ page, quote: rawQuote.replace(PAGE_BREAK_SENTINEL, " ").trim() }];
  }

  return quoteParts.map((quote, index) => ({
    page: page ? page + index : null,
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
  wrapper.style.maxWidth = "100%";
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
    pageSlotsRef.current.forEach((slot) => clearHighlights(slot.textDivs));
  }, []);

  const highlightRenderedPage = useCallback(async (pageNumber: number, list: QuoteEntry[]) => {
    const slot = pageSlotsRef.current[pageNumber - 1];
    if (!slot?.textDivs.length) return false;

    clearHighlights(slot.textDivs);

    let found = false;
    const pageEntries = list.filter((entry) => !entry.page || entry.page === pageNumber);
    for (const entry of pageEntries) {
      const hit = await highlightQuote(slot.textDivs, entry.quote);
      found = found || hit;
    }
    return found;
  }, []);

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
      let hitPage: number | null = null;

      if (entry.page) {
        const hintedPage = clampPage(entry.page, pageSlotsRef.current.length);
        await renderPage(hintedPage);
        const found = await highlightRenderedPage(hintedPage, [entry]);
        if (found) hitPage = hintedPage;
      }

      if (hitPage === null) {
        const foundPage = await findQuotePage(entry.quote, entry.page);
        if (foundPage) {
          await renderPage(foundPage);
          const found = await highlightRenderedPage(foundPage, [entry]);
          if (found) hitPage = foundPage;
        }
      }

      if (hitPage !== null && firstHitPage === null) {
        firstHitPage = hitPage;
      }
    }

    return firstHitPage;
  }, [clearRenderedHighlights, findQuotePage, highlightRenderedPage, renderPage]);

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
      }
    }, 150);

    return () => clearTimeout(timer);
  }, [containerWidth, initializePdfLayout]);

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

  function handleZoomIn() {
    const next = Math.min(ZOOM_MAX, Math.round((zoomRef.current + ZOOM_STEP) * 100) / 100);
    zoomRef.current = next;
    setZoom(next);
    if (pdfDocRef.current) {
      initializePdfLayout(pdfDocRef.current, quoteListRef.current, currentPageRef.current);
    }
  }

  function handleZoomOut() {
    const next = Math.max(ZOOM_MIN, Math.round((zoomRef.current - ZOOM_STEP) * 100) / 100);
    zoomRef.current = next;
    setZoom(next);
    if (pdfDocRef.current) {
      initializePdfLayout(pdfDocRef.current, quoteListRef.current, currentPageRef.current);
    }
  }

  return (
    <div className="relative flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-gray-100">
      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-auto bg-gray-100 px-3 pb-3 pt-5 transition-opacity"
      >
        {isLoading && (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-blue-600" />
            <span className="ml-2 text-sm text-gray-600">Loading PDF...</span>
          </div>
        )}

        {error && (
          <div className="flex h-full items-center justify-center p-4 text-sm text-red-500">
            {error}
          </div>
        )}

        <div ref={containerRef} />
      </div>

      {numPages > 0 && (
        <>
          <div className="pointer-events-none absolute bottom-4 left-4">
            <span className="flex items-center rounded-full border border-white/30 bg-white/25 px-3 py-1.5 text-xs font-medium tabular-nums text-gray-700 shadow-md backdrop-blur-md">
              {currentPage}/{numPages}
            </span>
          </div>

          <div className="absolute bottom-4 right-4 flex items-center gap-px rounded-full border border-white/30 bg-white/25 px-1 py-1 shadow-md backdrop-blur-md">
            <button
              onClick={handleZoomOut}
              disabled={zoom <= ZOOM_MIN}
              className="flex h-7 w-7 items-center justify-center rounded-full text-gray-600 transition-colors hover:bg-white/80 disabled:opacity-30"
              aria-label="Zoom out"
            >
              <ZoomOut className="h-3.5 w-3.5" />
            </button>
            <span className="w-9 select-none text-center text-xs font-medium tabular-nums text-gray-600">
              {Math.round(zoom * 100)}%
            </span>
            <button
              onClick={handleZoomIn}
              disabled={zoom >= ZOOM_MAX}
              className="flex h-7 w-7 items-center justify-center rounded-full text-gray-600 transition-colors hover:bg-white/80 disabled:opacity-30"
              aria-label="Zoom in"
            >
              <ZoomIn className="h-3.5 w-3.5" />
            </button>
          </div>
        </>
      )}
    </div>
  );
}
