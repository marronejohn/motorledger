"use client";

// Scan-to-build prototype: OCR a logbook page fully in the browser with
// tesseract.js loaded from CDN on demand (nothing bundled, nothing server-side),
// then pull out the dates and odometer readings the form can prefill.
// Everything it finds is a SUGGESTION: the entry only saves after a human
// reviews and confirms it.

export type ScanResult = {
  text: string;
  dates: string[]; // ISO yyyy-mm-dd candidates
  odos: number[]; // odometer candidates, km
  jobs: string[]; // non-trivial text lines that may be job descriptions
  costs: number[]; // dollar-amount candidates (receipt totals etc.)
};

declare global {
  interface Window {
    Tesseract?: any;
  }
}

async function loadTesseract(): Promise<any> {
  if (window.Tesseract) return window.Tesseract;
  await new Promise<void>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "/tesseract/tesseract.min.js";
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("could not load the reading engine"));
    document.head.appendChild(s);
  });
  if (!window.Tesseract) throw new Error("reading engine unavailable");
  return window.Tesseract;
}

const MONTHS: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

function normaliseDate(raw: string): string | null {
  let m = raw.match(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = raw.match(/(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
  if (m) {
    let y = m[3];
    if (y.length === 2) y = "20" + y;
    return `${y}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  }
  m = raw.match(/(\d{1,2})\s*([A-Za-z]{3,9})\s*(\d{2,4})/);
  if (m) {
    const mm = MONTHS[m[2].slice(0, 3).toLowerCase()];
    if (!mm) return null;
    let y = m[3];
    if (y.length === 2) y = "20" + y;
    return `${y}-${mm}-${m[1].padStart(2, "0")}`;
  }
  return null;
}

function extract(text: string): Omit<ScanResult, "text"> {
  const dates: string[] = [];
  const odos: number[] = [];
  const jobs: string[] = [];
  const costs: number[] = [];
  const dateRe = /(\d{4}[-/.]\d{1,2}[-/.]\d{1,2})|(\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4})|(\d{1,2}\s*[A-Za-z]{3,9}\s*\d{2,4})/g;
  for (const m of text.matchAll(dateRe)) {
    const iso = normaliseDate(m[0]);
    if (iso && !dates.includes(iso)) dates.push(iso);
  }
  const odoRe = /(\d[\d\s,]{2,9})\s*(?:km|kms|klm|odometer)?/gi;
  for (const m of text.matchAll(odoRe)) {
    const n = parseInt(m[1].replace(/[\s,]/g, ""), 10);
    if (!Number.isNaN(n) && n >= 100 && n <= 9999999 && !odos.includes(n)) odos.push(n);
  }
  for (const line of text.split(/\n+/)) {
    const t = line.trim();
    if (t.length >= 4 && /[A-Za-z]{3}/.test(t) && !jobs.includes(t)) jobs.push(t);
  }
  // dollar amounts: $-prefixed always count; bare two-decimal numbers only when
  // they are big enough to be money, not a date fragment like 21.11
  const costRe = /\$\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)|\b([0-9]{2,6}\.[0-9]{2})\b/g;
  for (const m of text.matchAll(costRe)) {
    const raw = (m[1] ?? m[2]).replace(/[\s,]/g, "");
    const n = parseFloat(raw);
    if (!Number.isNaN(n) && n > 0 && n < 1000000 && !costs.includes(n)) costs.push(n);
  }
  return { dates, odos: odos.sort((a, b) => b - a), jobs: jobs.slice(0, 8), costs: costs.sort((a, b) => b - a) };
}

export async function scanLogbookImage(
  dataUrl: string,
  onProgress?: (pct: number) => void
): Promise<ScanResult> {
  const T = await loadTesseract();
  const res = await T.recognize(dataUrl, "eng", {
    logger: (m: any) => {
      if (m.progress != null && onProgress) onProgress(Math.round(m.progress * 100));
    },
  });
  const text: string = res?.data?.text ?? "";
  return { text, ...extract(text) };
}

import { ppocrRead } from "./ppocr";

const MAKES = [
  "toyota", "mazda", "ford", "holden", "hyundai", "mitsubishi", "nissan",
  "volkswagen", "bmw", "mercedes", "subaru", "kia", "audi", "suzuki",
  "isuzu", "porsche", "tesla", "skoda", "peugeot", "renault", "volvo",
  "jaguar", "jeep", "chrysler", "ferrari", "lamborghini", "honda", "lexus",
];

const MODELS: [RegExp, string][] = [
  [/X[\s-]?TRAIL\b/i, "X-Trail"],
  [/\bMUSTANG\b/i, "Mustang"],
  [/\bRANGER\b/i, "Ranger"],
  [/\bHILUX\b/i, "Hilux"],
  [/\bLANDCRUISER\b/i, "Landcruiser"],
  [/\bCOROLLA\b/i, "Corolla"],
  [/\bCAMRY\b/i, "Camry"],
  [/\bCOMMODORE\b/i, "Commodore"],
  [/\bCRUISER\b/i, "Cruiser"],
  [/\bCOLORADO\b/i, "Colorado"],
  [/\bTRITON\b/i, "Triton"],
  [/\bOUTBACK\b/i, "Outback"],
  [/\bFORESTER\b/i, "Forester"],
  [/\bIMPREZA\b/i, "Impreza"],
  [/\bCIVIC\b/i, "Civic"],
  [/\bCRV\b/i, "CR-V"],
  [/\bTUCSON\b/i, "Tucson"],
  [/\bIX35\b/i, "ix35"],
  [/\bCLUB ?WAGON\b/i, "Club Wagon"],
  [/\bKODIAQ\b/i, "Kodiaq"],
  [/\bMEGANE\b/i, "Megane"],
  [/\bYARIS\b/i, "Yaris"],
  [/\bSONIC\b/i, "Sonic"],
  [/\bACCENT\b/i, "Accent"],
  [/\bFIESTA\b/i, "Fiesta"],
  [/\bVERSA\b/i, "Versa"],
  [/\bSPORTAGE\b/i, "Sportage"],
  [/\bC3 ?AIRCROSS\b/i, "C3 Aircross"],
  [/\bC3\b/i, "C3"],
  [/\bC4\b/i, "C4"],
  [/\bC5\b/i, "C5"],
  [/\bRS ?3\b/i, "RS3"],
  [/\bTANK\b/i, "Tank"],
  [/\bGRANTA\b/i, "Granta"],
  [/\bRANGE ?ROVER\b/i, "Range Rover"],
];

export type VehicleScan = { rego: string | null; make: string | null; model: string | null; error?: string };

// Australian plate series: mainland ABC-123, Tasmania's current A 00 AA,
// older AA-0000, Queensland's 123-ABC, NSW's new ABC-12-A, WA's 1ABC-234,
// ACT's A-00-000 and Tasmania's X-000-AA.
// Australian plates first. Current standard-issue formats by state/territory
// (Wikipedia, "Vehicle registration plates of Australia", current series):
//   ACT  Yaa*nna   YTH*00A    NSW  Da*nn*aa  DT*00*LZ  (+ premium Gaa*nna)
//   NT   Ca*nn*aa  CG*77*AA   QLD  nnn*San   000*SA4
//   SA   Snnn*Daa  S000*DOY   TAS  N nn aa   N 00 QL
//   VIC  2Ga*naa   2GJ*1AA    WA   1Jaa*nnn  1JEK*000
// then the legacy national series, then everything else at a lower weight so
// Australian shapes win ties.
const AU_PATTERNS: RegExp[] = [
  /^[A-Z]{2}\d{2}[A-Z]{2}$/, // NSW / NT standard
  /^[A-Z]{3}\d{2}[A-Z]$/, // NSW / NT premium slimline
  /^Y[A-Z]{2}\d{2}[A-Z]$/, // ACT
  /^\d{3}[A-Z]{2}\d$/, // QLD
  /^S\d{3}[A-Z]{3}$/, // SA
  /^N\d{2}[A-Z]{2}$/, // TAS
  /^\d[A-Z]{2}\d[A-Z]{2}$/, // VIC
  /^\d[A-Z]{3}\d{3}$/, // WA
  /^[A-Z]{3}\d{3}$/, // legacy AAA*nnn
  /^\d{3}[A-Z]{3}$/, // legacy nnn*AAA
  /^[A-Z]{2}\d{3}$/, // legacy aa*nnn
  /^\d{3}[A-Z]{2}$/, // legacy nnn*aa
];
const OTHER_PATTERNS: RegExp[] = [
  /^[A-Z]{3}\d{4}$/, /^[A-Z]{2}\d{2}[A-Z]{3}$/, /^[A-Z]{3}\d{2}$/,
  /^[A-Z]{2}\d{4}$/, /^\d{2}[A-Z]{3}$/, /^[A-Z]{4}\d{3}$/,
  /^[A-Z]\d{2}[A-Z]\d{2}[A-Z]$/, /^\d{3}[A-Z]{2}\d[A-Z]$/,
  /^[A-Z]\d{3}[A-Z]{2}$/, /^\d[A-Z]{3}\d{2}$/, /^\d{2}[A-Z]\d{5}$/,
  /^\d{2}[A-Z]\d{3}[A-Z]\d$/, /^\d{2}[A-Z]{2}\d{4}$/,
  /^[A-Z]\d{2}[A-Z]{3}$/, /^[A-Z]\d{2}[A-Z]{2}$/, /^[A-Z]{2}\d{2}[A-Z]$/,
  /^[A-Z]\d{3}[A-Z]$/, /^[A-Z]\d{2}[A-Z]\d{2}$/,
];

function patternScore(t: string): number {
  if (AU_PATTERNS.some((p) => p.test(t))) return 2.5;
  if (OTHER_PATTERNS.some((p) => p.test(t))) return 1.2;
  return 0;
}

function normRego(s: string): string {
  return (s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

// Every read of every text box feeds a pool; substrings are scored by how
// plate-like they look and how confident the reader was, and the best wins.
// Second opinion at one weak character: if a single substitution turns a
// non-plate read into a plate-shaped one, keep the corrected form as a
// candidate, weighted below what the reader saw unedited.
function editToPattern(t: string, confs: number[] | undefined): { t: string; score: number } | null {
  const L = t.length;
  const tries: { t: string; score: number }[] = [];
  const cf = (i: number) => (confs && confs[i] !== undefined ? confs[i] : 1);
  for (let i = 0; i < L; i++) {
    if ((i < 2 || i > L - 3) && cf(i) < 0.6) {
      const d = t.slice(0, i) + t.slice(i + 1);
      if (patternScore(d) > 0) tries.push({ t: d, score: 1 - 0.15 * cf(i) });
    }
  }
  const idx = [...Array(L).keys()].sort((a, b) => cf(a) - cf(b)).slice(0, 3);
  for (const i of idx) {
    if (cf(i) >= 0.6) continue;
    for (const c of "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789") {
      if (c === t[i]) continue;
      const s2 = t.slice(0, i) + c + t.slice(i + 1);
      if (patternScore(s2) > 0) tries.push({ t: s2, score: 1 - 0.2 * cf(i) });
    }
  }
  if (!tries.length) return null;
  tries.sort((a, b) => b.score - a.score);
  return tries[0];
}

function bestRego(reads: { t: string; c: number; confs?: number[] }[]): string | null {
  const cands = new Map<string, number>();
  const put = (sub: string, w: number) => {
    if (w && (!cands.has(sub) || cands.get(sub)! < w)) cands.set(sub, w);
  };
  for (const r of reads) {
    const nt = normRego(r.t);
    // the read itself, when it already looks like a plate, outranks its own
    // substrings (a truncation must not beat the full read it came from)
    const pf = patternScore(nt);
    if (pf) put(nt, pf + r.c * 0.5 + 0.6);
    const confs = r.confs;
    for (let L = Math.min(9, nt.length); L > 4; L--) {
      for (let i = 0; i + L <= nt.length; i++) {
        const sub = nt.slice(i, i + L);
        const ps = patternScore(sub);
        if (ps) put(sub, ps + r.c * 0.5);
        else if (sub.length >= 5 && sub.length <= 8 && /[A-Z]/.test(sub) && /\d/.test(sub)) put(sub, 1);
      }
    }
    // correction pass, only when the read itself is not already plate-shaped
    if (confs && confs.length === nt.length && !patternScore(nt)) {
      const fix = editToPattern(nt, confs);
      if (fix)
        for (let L = Math.min(9, fix.t.length); L > 4; L--)
          for (let i = 0; i + L <= fix.t.length; i++) {
            const sub = fix.t.slice(i, i + L);
            const ps2 = patternScore(sub); if (ps2) put(sub, ps2 + fix.score * 0.5 + r.c * 0.3);
          }
    }
  }
  const ranked = [...cands.entries()].sort((a, b) => b[1] - a[1] || b[0].length - a[0].length);
  for (const c of ranked) {
    if (ranked.some((d) => d[0] !== c[0] && d[0].includes(c[0]) && d[0].length > c[0].length && d[1] >= c[1] - 1.5))
      continue;
    return c[0];
  }
  return null;
}

function findMake(text: string): string | null {
  const up = text.toUpperCase();
  for (const w of MAKES) {
    const re = w.length < 5
      ? new RegExp(`\\b${w.toUpperCase()}\\b`)
      : new RegExp(w.toUpperCase());
    if (re.test(up)) return w[0].toUpperCase() + w.slice(1);
  }
  return null;
}

function findModel(text: string): string | null {
  for (const [re, name] of MODELS) {
    if (re.test(text)) return name;
  }
  return null;
}

// The whole photo goes through the detector once and every found region is
// read in a handful of variants; plates, badges and model names all surface
// as text reads. Runs entirely on-device.
export async function scanVehiclePhoto(file: File): Promise<VehicleScan> {
  try {
    const reads = await ppocrRead(file);
    const joined = reads.map((r) => r.t).join("\n");
    return { rego: bestRego(reads), make: findMake(joined), model: findModel(joined) };
  } catch (e) {
    return { rego: null, make: null, model: null, error: (e as any)?.message ?? String(e) };
  }
}

import { fileToCompressedDataUrl } from "./image";
import { pdfToPageDataUrls, pdfTextContent } from "./pdf";

export function isPdfFile(file: File): boolean {
  return file.type === "application/pdf" || /\.pdf$/i.test(file.name || "");
}

export type InvoiceRead = {
  serviceType: string | null; // e.g. "60,000KM LOGBOOK SERVICE"
  repairOrderNo: string | null;
  invoiceNo: string | null;
  provider: string | null; // workshop / dealership that did the work
  adviser: string | null;
  nextServiceDue: string | null; // ISO yyyy-mm-dd
  nextServiceOdometer: number | null;
  labour: number | null;
  gst: number | null;
  items: { qty: number | null; no: string | null; desc: string; amount: number | null }[];
};

export type LogScan = {
  pages: string[]; // page images, also what gets attached as receipts
  text: string;
  dates: string[];
  odos: number[];
  jobs: string[];
  costs: number[];
  invoice: InvoiceRead; // dealership-invoice fields, best effort
};

// Invoice OCR shouts. An ALL-CAPS business name reads better in title case;
// anything already mixed-case is left alone.
function titleIfCaps(s: string): string {
  const v = s.replace(/\s+/g, " ").trim();
  if (!v || v !== v.toUpperCase()) return v;
  return v.toLowerCase().replace(/(^|[\s&'.-])([a-z])/g, (_, p, c) => p + c.toUpperCase());
}

// Dealership "service tax invoice" headers, the same fields workshop invoices
// carry everywhere. Every field here is a suggestion the human confirms.
export function readInvoice(text: string): InvoiceRead {
  const t = text.toUpperCase();
  const inv: InvoiceRead = {
    serviceType: null, repairOrderNo: null, invoiceNo: null, provider: null, adviser: null,
    nextServiceDue: null, nextServiceOdometer: null, labour: null, gst: null, items: [],
  };

  let m = t.match(/CARRY\s+OUT\s+([0-9,]+\s?K?M?\s*\/\s*[0-9,]+\s?\w*(?:MONTHS?|MONTH))/);
  if (m) inv.serviceType = m[1].replace(/\s+/g, " ").trim();
  if (!inv.serviceType) {
    m = t.match(/([0-9,]{4,7})\s?KM\s*\/\s*[0-9,]{1,3}\s?MONTH/);
    if (m) inv.serviceType = m[0].replace(/\s+/g, " ").trim();
  }

  m = t.match(/REPAIR\s+ORDER(?:\s+NO|\s+NUMBER|\.?\s*NO)?\s*[:#]?\s*([A-Z0-9][A-Z0-9-]{4,})/);
  if (m) inv.repairOrderNo = m[1];

  // "Tax Invoice No. 987654" / "Invoice #: 1234567" / "INVOICE NO 987654".
  // Guarded so a "Repair Order No." label right before it never reads as the invoice number.
  m = t.match(/(?:TAX\s+)?INVOICE\s*(?:NO|NUMBER|NUM|#|ID)?\.?\s*[:#]?\s*([A-Z]{0,3}[0-9][A-Z0-9-]{3,})/);
  if (m && !/REPAIR\s+ORDER\s*[\s\S]{0,20}$/.test(t.slice(0, m.index).slice(-30))) inv.invoiceNo = m[1];

  // Who did the work: the workshop or dealership name, sourced in order from
  // the invoice's own SELLING DEALER field, the payment footer's account name,
  // then the letterhead at the top of the page. A suggestion the human confirms.
  // A real workshop name: at least two letter runs, no long digit run (that is
  // a rego or odometer the OCR merged into the line, e.g. "ABC123 185000").
  const nameOk = (v: string) =>
    (v.match(/[A-Z]{2,}/g) ?? []).length >= 2 && !/\d{3}/.test(v);
  m = t.match(/SELLING\s+DEALER\s*:?\s*(?:\n\s*)?([A-Z][A-Z0-9& .,'\/-]{2,45})/);
  if (m && nameOk(m[1]) && !/^(REG\.?|STOCK|CUSTOMER|VIN|ENGINE|CONTACT|ORDER|COLOUR|MONTH|YEAR|AIR)\b/.test(m[1])) {
    inv.provider = titleIfCaps(m[1]);
  }
  if (!inv.provider) {
    m = t.match(/ACCOUNT\s+NAME\s*:?\s*([A-Z][A-Z0-9& .,'\/-]{2,45})/);
    if (m && nameOk(m[1])) inv.provider = titleIfCaps(m[1]);
  }
  if (!inv.provider) {
    for (const line of t.split(/\n+/).slice(0, 8)) {
      const L = line.trim();
      if (L.length < 4 || L.length > 45) continue;
      if (!/[A-Z]{3}/.test(L)) continue; // needs real words, not a lone code
      if (/\d{3}/.test(L)) continue; // codes, phones, dates
      if (/INVOICE|STATEMENT|CUSTOMER|DATE:|TIME|REPAIR ORDER|PAGE:|VEHICLE|REG\.?\b|ADVISER|ABN\b|TAX/.test(L)) continue;
      inv.provider = titleIfCaps(L);
      break;
    }
  }

  m = t.match(/ADVISER\s*:?\s*([A-Z][A-Z ]{1,29})/);
  if (m) inv.adviser = m[1].trim();

  m = t.match(/NEXT\s+SERVICE\s+DUE[\s\S]{0,60}?([0-9]{1,2}[\/.-][0-9]{1,2}[\/.-][0-9]{2,4})/);
  if (m) {
    const parts = m[1].split(/[\/.-]/).map((p) => parseInt(p, 10));
    if (parts.length === 3 && parts[0] >= 1 && parts[0] <= 31 && parts[1] >= 1 && parts[1] <= 12) {
      const y = parts[2] < 100 ? 2000 + parts[2] : parts[2];
      inv.nextServiceDue = `${y}-${String(parts[1]).padStart(2, "0")}-${String(parts[0]).padStart(2, "0")}`;
    }
  }
  m = t.match(/NEXT\s+SERVICE[\s\S]{0,100}?(?:ODOMETER(?:\s+READING)?|READING)[\s\S]{0,20}?([0-9][0-9,]{2,7})\s*(?:KM|KMS)?/);
  if (!m) m = t.match(/NEXT\s+SERVICE[\s\S]{0,100}?([0-9][0-9,]{2,7})\s*(?:KM|KMS)\b/);
  if (m) {
    const n = parseInt(m[1].replace(/[\s,]/g, ""), 10);
    if (!Number.isNaN(n) && n >= 100 && n <= 9999999) inv.nextServiceOdometer = n;
  }

  m = t.match(/\bLABOUR\b[\s\S]{0,30}?\$\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/);
  if (m) {
    const n = parseFloat(m[1].replace(/[\s,]/g, ""));
    if (!Number.isNaN(n)) inv.labour = n;
  }
  m = t.match(/(?:^|\n)\s*GST\s*\$?\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/m);
  if (m) {
    const n = parseFloat(m[1].replace(/[\s,]/g, ""));
    if (!Number.isNaN(n)) inv.gst = n;
  }

  // Part rows: "QTY PARTNO DESCRIPTION ... AMOUNT" as the invoice lays them
  // out. Best effort; everything lands as a suggestion line the human keeps
  // or edits in the notes.
  for (const line of t.split(/\n+/)) {
    const L = line.trim();
    const row = L.match(/^(\d{1,2})\s+([A-Z0-9]{5,})\s+(.+?)(?:\s+(?:\d+\s+)?(?:\$?\s*[0-9,]+\.[0-9]{2}|NO CHARGE))\s*$/);
    if (row && !/TOTAL|SUBTOTAL|GST|LABOUR|BALANCE/.test(row[3])) {
      const desc = row[3].replace(/\s+/g, " ").trim();
      if (desc.length >= 3 && !inv.items.some((i) => i.desc === desc)) {
        inv.items.push({ qty: parseInt(row[1], 10) || null, no: row[2], desc, amount: null });
      }
    }
    if (inv.items.length >= 12) break;
  }
  return inv;
}

function mergeInvoice(a: InvoiceRead, b: InvoiceRead): InvoiceRead {
  const pick = <T,>(x: T, y: T): T => (x ?? y) as T;
  return {
    serviceType: pick(a.serviceType, b.serviceType),
    repairOrderNo: pick(a.repairOrderNo, b.repairOrderNo),
    invoiceNo: pick(a.invoiceNo, b.invoiceNo),
    provider: pick(a.provider, b.provider),
    adviser: pick(a.adviser, b.adviser),
    nextServiceDue: pick(a.nextServiceDue, b.nextServiceDue),
    nextServiceOdometer: a.nextServiceOdometer ?? b.nextServiceOdometer,
    labour: a.labour ?? b.labour,
    gst: a.gst ?? b.gst,
    items: a.items.length ? a.items : b.items,
  };
}

// One entry point for both buttons: an image (photo of a page or receipt) or a
// PDF of a whole service log. PDFs are rendered to page images in the browser,
// every page is read, and the fields are merged across pages.

// Straight-regex read of the fields a typed service invoice repeats in its own
// text layer. Prefer dates that sit next to a time (the visit's own stamp),
// skip the "next service" one, and pull the JOB lines for "What was done".
export function readLogTextLayer(text: string): { dates: string[]; jobs: string[]; costs: number[] } {
  const dates: string[] = [];
  const seenDate = new Set<string>();
  const timed: string[] = [];
  const all: string[] = [];
  let m: RegExpExecArray | null;
  const dre = /\b(\d{2})[\/.-](\d{2})[\/.-](\d{4})\b/g;
  while ((m = dre.exec(text))) {
    const day = parseInt(m[1], 10);
    const mon = parseInt(m[2], 10);
    if (day < 1 || day > 31 || mon < 1 || mon > 12) continue;
    const iso = `${m[3]}-${m[2]}-${m[1]}`;
    if (!seenDate.has(iso)) { seenDate.add(iso); all.push(iso); }
    if (/NEXT\s+SERVICE/i.test(text.slice(Math.max(0, m.index - 60), m.index))) continue;
    if (/EXT\.?\s*WAR|WARRANTY|EXPIR/i.test(text.slice(Math.max(0, m.index - 60), m.index))) continue;
    if (/\d{1,2}:\d{2}/.test(text.slice(m.index, m.index + 16)) && !timed.includes(iso)) timed.push(iso);
  }
  for (const iso of timed.length ? timed : all) if (!dates.includes(iso)) dates.push(iso);

  const jobs: string[] = [];
  const seenJob = new Set<string>();
  const jre = /JOB\s+\d{1,2}\s+([A-Z][A-Z0-9 ,&'/.()-]{4,110})/g;
  while ((m = jre.exec(text))) {
    // Only a glued continuation (the next document character is lowercase,
    // so the capture swallowed the next word's first capital) loses its last
    // letter; a job line that simply ends in capitals is left whole.
    const raw = m[1].replace(/\s*SUBTOTAL[\s\S]*$/i, "").replace(/\s+/g, " ").trim();
    const nextCh = text[m.index + m[0].length] ?? "";
    const j = /[a-z]/.test(nextCh) ? raw.replace(/[A-Z]$/, "") : raw;
    if (j.length < 4 || seenJob.has(j)) continue;
    seenJob.add(j);
    jobs.push(j);
  }

  const costs: number[] = [];
  const cre = /TOTAL[^\n]{0,40}?\$\s*([\d,]+\.\d{2})/g;
  while ((m = cre.exec(text))) {
    const n = parseFloat(m[1].replace(/,/g, ""));
    if (!Number.isNaN(n) && n > 0) costs.push(n);
  }
  return { dates, jobs, costs };
}

export async function scanLogFile(
  file: File,
  onProgress?: (pct: number) => void
): Promise<LogScan> {
  const isPdf = isPdfFile(file);
  const pages = isPdf
    ? await pdfToPageDataUrls(file, onProgress)
    : [await fileToCompressedDataUrl(file)];
  let dates: string[] = [];
  let odos: number[] = [];
  let jobs: string[] = [];
  let costs: number[] = [];
  let text = "";
  let invoice: InvoiceRead = {
    serviceType: null, repairOrderNo: null, invoiceNo: null, provider: null, adviser: null,
    nextServiceDue: null, nextServiceOdometer: null, labour: null, gst: null, items: [],
  };
  for (let i = 0; i < pages.length; i++) {
    const res = await scanLogbookImage(pages[i], (p) =>
      onProgress?.(Math.round(((i + p / 100) / pages.length) * 100))
    );
    text += (text ? "\n" : "") + res.text;
    invoice = mergeInvoice(invoice, readInvoice(res.text));
    for (const d of res.dates) if (!dates.includes(d)) dates.push(d);
    for (const o of res.odos) if (!odos.includes(o)) odos.push(o);
    for (const j of res.jobs) if (!jobs.includes(j)) jobs.push(j);
    for (const c of res.costs) if (!costs.includes(c)) costs.push(c);
  }
  // A typed PDF carries its own text layer; where it has real content it beats
  // OCR for the fields that matter: the dealer name, invoice number, job lines.
  // OCR stays the source for anything the text layer omits (odometer labels
  // whose values sit in separate runs, for instance).
  if (isPdf) {
    try {
      const tl = await pdfTextContent(file);
      if (tl.replace(/\s/g, "").length > 150) {
        const tlInv = readInvoice(tl);
        invoice = mergeInvoice(tlInv, invoice);
        const tlRead = readLogTextLayer(tl);
        const goodDates = tlInv.nextServiceDue
          ? tlRead.dates.filter((d) => d !== tlInv.nextServiceDue)
          : tlRead.dates;
        const uniq = (arr: string[]) => arr.filter((v, i) => arr.indexOf(v) === i);
        dates = uniq([...goodDates, ...dates]);
        jobs = uniq([...tlRead.jobs, ...jobs]);
        costs = Array.from(new Set([...tlRead.costs, ...costs]));
      }
    } catch {
      // no usable text layer; the OCR read stands
    }
  }
  odos.sort((a, b) => b - a);
  costs.sort((a, b) => b - a);
  return {
    pages, text, dates, odos: odos.slice(0, 10), jobs: jobs.slice(0, 12),
    costs: costs.slice(0, 5), invoice,
  };
}
