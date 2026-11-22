"use client";

// PDF pages to images, entirely in the browser, with pdf.js bundled from
// public/pdfjs (nothing loaded from a CDN). A service-log PDF becomes a stack
// of page images the reading engine can scan like photographs.
//
// Performance notes (fix/pdf-hang): a PDF used to be parsed twice — once to
// render every page to images, then again to read its text layer — with up
// to 10 pages at 1600px. On a phone WebView that could take minutes and then
// hang with no way to cancel. Now the document is opened once and reused,
// the text layer is read first, rendering is capped at 4 pages at 1280px,
// and an AbortSignal actually stops work between pages instead of only
// racing a timer while the work kept running underneath.
declare global {
  interface Window {
    pdfjsLib?: any;
  }
}

export const PDF_MAX_PAGES = 4;
export const PDF_MAX_SIDE = 1280;
export const PDF_MAX_SCALE = 2;
export const PDF_JPEG_QUALITY = 0.72;

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException("PDF work was cancelled", "AbortError");
  }
}

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(what)), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

async function loadPdfjs(signal?: AbortSignal): Promise<any> {
  throwIfAborted(signal);
  if (window.pdfjsLib) return window.pdfjsLib;
  // pdf.js 4+ ships only as an ES module, so the library is loaded with a
  // module script that publishes it on the window for the rest of the app.
  await withTimeout<void>(
    new Promise<void>((resolve, reject) => {
      const s = document.createElement("script");
      s.type = "module";
      s.textContent =
        'import * as pdfjsLib from "/pdfjs/pdf.min.mjs";' +
        'pdfjsLib.GlobalWorkerOptions.workerSrc = "/pdfjs/pdf.worker.min.mjs";' +
        'window.pdfjsLib = pdfjsLib;';
      s.onload = () => resolve();
      s.onerror = () => reject(new Error("could not load the PDF reader"));
      document.head.appendChild(s);
      signal?.addEventListener("abort", () => reject(new DOMException("PDF work was cancelled", "AbortError")), { once: true });
    }),
    45000,
    "the PDF reader could not load"
  );
  throwIfAborted(signal);
  const lib = window.pdfjsLib;
  if (!lib) throw new Error("PDF reader unavailable");
  return lib;
}

export type OpenPdfDocument = {
  lib: any;
  doc: any;
  numPages: number;
};

// Open a PDF once and keep the document around so callers can read its text
// layer and render pages from the same parse. The caller owns the document
// and must destroy it (see destroyPdfDocument) when it is done with it —
// the wrappers below do this in a finally block.
export async function openPdfDocument(
  file: File,
  signal?: AbortSignal
): Promise<OpenPdfDocument> {
  throwIfAborted(signal);
  const lib = await loadPdfjs(signal);
  throwIfAborted(signal);
  // Read the bytes exactly once; previously each helper re-read them.
  const data = await file.arrayBuffer();
  throwIfAborted(signal);
  const doc = await lib.getDocument({
    data,
    cMapUrl: "/pdfjs/cmaps/",
    cMapPacked: true,
    standardFontDataUrl: "/pdfjs/standard_fonts/",
    isEvalSupported: false,
  }).promise;
  return { lib, doc, numPages: doc.numPages as number };
}

export async function destroyPdfDocument(doc: any): Promise<void> {
  try {
    if (doc && typeof doc.destroy === "function") await doc.destroy();
  } catch {
    // Destroy is best-effort cleanup; the parse result is already in hand.
  }
}

export async function pdfToPageDataUrlsFromDoc(
  doc: any,
  maxPages = PDF_MAX_PAGES,
  onProgress?: (pct: number) => void,
  signal?: AbortSignal
): Promise<string[]> {
  const n = Math.min(doc.numPages as number, maxPages);
  const pages: string[] = [];
  for (let i = 1; i <= n; i++) {
    throwIfAborted(signal);
    const page = await doc.getPage(i);
    try {
      throwIfAborted(signal);
      const base = page.getViewport({ scale: 1 });
      const scale = Math.min(PDF_MAX_SCALE, Math.max(1, PDF_MAX_SIDE / Math.max(base.width, base.height)));
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("could not render the PDF page");
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      // A render timeout / cancel must stop the render task itself, not
      // just stop waiting for it: cancel the task so the worker is freed.
      const renderTask = page.render({ canvasContext: ctx, viewport });
      const renderPromise = renderTask.promise as Promise<void>;
      try {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => {
            try { renderTask.cancel(); } catch { /* already finished */ }
            reject(new Error(`PDF page ${i} would not render`));
          }, 60000);
          const onAbort = () => {
            clearTimeout(timer);
            try { renderTask.cancel(); } catch { /* already finished */ }
            reject(new DOMException("PDF work was cancelled", "AbortError"));
          };
          signal?.addEventListener("abort", onAbort, { once: true });
          renderPromise.then(
            () => { clearTimeout(timer); signal?.removeEventListener("abort", onAbort); resolve(); },
            (e) => { clearTimeout(timer); signal?.removeEventListener("abort", onAbort); reject(e); }
          );
        });
      } finally {
        // Free the canvas backing store promptly; the data URL is a copy.
        canvas.width = 0;
        canvas.height = 0;
      }
      pages.push(canvas.toDataURL("image/jpeg", PDF_JPEG_QUALITY));
      onProgress?.(Math.round((i / n) * 100));
    } finally {
      try { page.cleanup(); } catch { /* cleanup is best-effort */ }
    }
  }
  return pages;
}

export async function pdfToPageDataUrls(
  file: File,
  onProgress?: (pct: number) => void,
  maxPages = PDF_MAX_PAGES
): Promise<string[]> {
  const { doc } = await openPdfDocument(file);
  try {
    return await pdfToPageDataUrlsFromDoc(doc, maxPages, onProgress);
  } finally {
    await destroyPdfDocument(doc);
  }
}

function textFromPageItems(lib: any, viewport: any, items: any[]): string {
  // Join runs the way the page lays them out: a run on a new baseline is a
  // new line, a run that starts after a horizontal gap is a new word.
  // Concatenating runs blindly fused adjacent table columns ("1" +
  // "14/06/2024" became "114/06/2024"), which hid dates from every
  // boundary-sensitive regex and glued JOB lines to the next sentence.
  let s = "";
  let px = 0, py = 0, pw = 0, has = false;
  for (const raw of items) {
    const it = raw as any;
    if (typeof it.str !== "string" || !it.str) continue;
    const tx = lib.Util.transform(viewport.transform, it.transform);
    const x = tx[4] as number, y = tx[5] as number, w = (it.width ?? 0) as number;
    if (has) {
      if (it.hasEOL || Math.abs(y - py) > 3) s += "\n";
      else if (x > px + pw + 0.6) s += " ";
    }
    s += it.str;
    px = x; py = y; pw = w; has = true;
  }
  if (s && !s.endsWith("\n")) s += "\n";
  return s;
}

export async function pdfTextContentFromDoc(
  doc: any,
  maxPages = PDF_MAX_PAGES,
  signal?: AbortSignal
): Promise<string> {
  const lib = window.pdfjsLib;
  if (!lib) throw new Error("PDF reader unavailable");
  const n = Math.min(doc.numPages as number, maxPages);
  const pages: string[] = [];
  for (let i = 1; i <= n; i++) {
    throwIfAborted(signal);
    const page = await doc.getPage(i);
    try {
      const viewport = page.getViewport({ scale: 1 });
      const tc = await page.getTextContent();
      throwIfAborted(signal);
      pages.push(textFromPageItems(lib, viewport, tc.items ?? []));
    } finally {
      try { page.cleanup(); } catch { /* cleanup is best-effort */ }
    }
  }
  return pages.join("\n");
}

// The PDF's own embedded text, when it has one (typed invoices do; scans and
// photos don't). Where this is present it beats OCR: exact spelling of dealer
// names, invoice numbers and job lines straight from the file.
export async function pdfTextContent(file: File, maxPages = PDF_MAX_PAGES): Promise<string> {
  const { doc } = await openPdfDocument(file);
  try {
    return await pdfTextContentFromDoc(doc, maxPages);
  } finally {
    await destroyPdfDocument(doc);
  }
}
