"use client";

// PDF pages to images, entirely in the browser, with pdf.js bundled from
// public/pdfjs (nothing loaded from a CDN). A service-log PDF becomes a stack
// of page images the reading engine can scan like photographs.
declare global {
  interface Window {
    pdfjsLib?: any;
  }
}

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(what)), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

async function injectModule(srcPath: string, workerPath: string, ms: number): Promise<void> {
  await withTimeout<void>(
    new Promise<void>((resolve, reject) => {
      const s = document.createElement("script");
      s.type = "module";
      s.textContent =
        'import * as pdfjsLib from "' + srcPath + '";' +
        'pdfjsLib.GlobalWorkerOptions.workerSrc = "' + workerPath + '";' +
        'window.pdfjsLib = pdfjsLib;';
      s.onload = () => resolve();
      s.onerror = () => reject(new Error("module reader failed"));
      document.head.appendChild(s);
    }),
    ms,
    "module reader timed out"
  );
}

async function injectClassic(srcPath: string, workerPath: string, ms: number): Promise<void> {
  await withTimeout<void>(
    new Promise<void>((resolve, reject) => {
      const s = document.createElement("script");
      s.src = srcPath;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error("classic reader failed"));
      document.head.appendChild(s);
    }),
    ms,
    "classic reader timed out"
  ).then(() => {
    const lib = window.pdfjsLib;
    if (lib && lib.GlobalWorkerOptions) lib.GlobalWorkerOptions.workerSrc = workerPath;
  });
}

async function loadPdfjs(): Promise<any> {
  if (window.pdfjsLib) return window.pdfjsLib;
  // Older phone WebViews can reject the modern pdf.js build (unsupported JS
  // syntax or no ES-module support at all), so load in steps: the legacy
  // pdf.js module build first, then the old pdf.js 3.x classic build, which
  // runs on nearly anything.
  const moduleOk = "noModule" in document.createElement("script");
  if (moduleOk) {
    try {
      await injectModule("/pdfjs/legacy/pdf.min.mjs", "/pdfjs/legacy/pdf.worker.min.mjs", 30000);
      if (window.pdfjsLib) return window.pdfjsLib;
    } catch {
      window.pdfjsLib = undefined;
    }
  }
  await injectClassic("/pdfjs/legacy-umd/pdf.min.js", "/pdfjs/legacy-umd/pdf.worker.min.js", 30000);
  const lib = window.pdfjsLib;
  if (!lib) throw new Error("PDF reader unavailable");
  return lib;
}

export async function pdfToPageDataUrls(
  file: File,
  onProgress?: (pct: number) => void,
  maxPages = 10
): Promise<string[]> {
  const lib = await loadPdfjs();
  const doc = await lib.getDocument({
    data: await file.arrayBuffer(),
    cMapUrl: "/pdfjs/cmaps/",
    cMapPacked: true,
    standardFontDataUrl: "/pdfjs/standard_fonts/",
    isEvalSupported: false,
  }).promise;
  const n = Math.min(doc.numPages, maxPages);
  const pages: string[] = [];
  for (let i = 1; i <= n; i++) {
    const page = await doc.getPage(i);
    const base = page.getViewport({ scale: 1 });
    const scale = Math.min(3, Math.max(1, 1600 / Math.max(base.width, base.height)));
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("could not render the PDF page");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await withTimeout<void>(
      page.render({ canvasContext: ctx, viewport }).promise,
      60000,
      `PDF page ${i} would not render`
    );
    pages.push(canvas.toDataURL("image/jpeg", 0.8));
    onProgress?.(Math.round((i / n) * 100));
  }
  return pages;
}

// The PDF's own embedded text, when it has one (typed invoices do; scans and
// photos don't). Where this is present it beats OCR: exact spelling of dealer
// names, invoice numbers and job lines straight from the file.
export async function pdfTextContent(file: File, maxPages = 10): Promise<string> {
  const lib = await loadPdfjs();
  const doc = await lib.getDocument({
    data: await file.arrayBuffer(),
    cMapUrl: "/pdfjs/cmaps/",
    cMapPacked: true,
    standardFontDataUrl: "/pdfjs/standard_fonts/",
    isEvalSupported: false,
  }).promise;
  const n = Math.min(doc.numPages, maxPages);
  const pages: string[] = [];
  for (let i = 1; i <= n; i++) {
    const page = await doc.getPage(i);
    const viewport = page.getViewport({ scale: 1 });
    const tc = await page.getTextContent();
    // Join runs the way the page lays them out: a run on a new baseline is a
    // new line, a run that starts after a horizontal gap is a new word.
    // Concatenating runs blindly fused adjacent table columns ("1" +
    // "14/06/2024" became "114/06/2024"), which hid dates from every
    // boundary-sensitive regex and glued JOB lines to the next sentence.
    let s = "";
    let px = 0, py = 0, pw = 0, has = false;
    for (const raw of tc.items) {
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
    pages.push(s);
  }
  return pages.join("\n");
}
