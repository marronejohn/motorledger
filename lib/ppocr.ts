"use client";

// On-device text detection + recognition using PaddleOCR models (PP-OCRv4)
// served from /public/models, run through onnxruntime-web's wasm backend so
// the scan stays free-hosting friendly and works offline once the page loads.
// Pipeline: detection runs at two working sizes (the second only when the
// first finds nothing plate-sized), each found region is read by the
// recognition model in several variants, the variants are fused per region
// with per-character confidences, and the reads are pooled upstream.

type Img = { w: number; h: number; data: Uint8ClampedArray }; // RGBA

let ortMod: any = null;
let detS: any = null;
let recS: any = null;
let chars: string[] | null = null;

async function loadEngine() {
  if (detS && recS) return;
  ortMod = await import("onnxruntime-web");
  ortMod.env.wasm.wasmPaths = "/onnx/";
  [detS, recS] = await Promise.all([
    ortMod.InferenceSession.create("/models/ch_PP-OCRv4_det_infer.onnx"),
    ortMod.InferenceSession.create("/models/ch_PP-OCRv4_rec_infer.onnx"),
  ]);
  const r = await fetch("/models/charset.json");
  chars = await r.json();
}

async function loadImage(file: File | Blob, maxSide = 1600): Promise<Img> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * scale));
  const h = Math.max(1, Math.round(bmp.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bmp.close();
    throw new Error("no canvas context");
  }
  ctx.drawImage(bmp, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h).data as unknown as Uint8ClampedArray;
  bmp.close();
  return { w, h, data };
}

// --- detection ---------------------------------------------------------------

type Box = { x0: number; y0: number; x1: number; y1: number; score: number; area: number };

function dilate(mask: Uint8Array, W: number, H: number): Uint8Array {
  const out = new Uint8Array(W * H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (mask[i]) { out[i] = 1; continue; }
      if (x > 0 && mask[i - 1]) { out[i] = 1; continue; }
      if (x < W - 1 && mask[i + 1]) { out[i] = 1; continue; }
      if (y > 0 && mask[i - W]) { out[i] = 1; continue; }
      if (y < H - 1 && mask[i + W]) { out[i] = 1; continue; }
    }
  return out;
}

function components(mask: Uint8Array, W: number, H: number) {
  const lbl = new Int32Array(W * H);
  const boxes: { x0: number; y0: number; x1: number; y1: number }[] = [];
  const stack = new Int32Array(W * H);
  let next = 1;
  for (let i = 0; i < W * H; i++) {
    if (!mask[i] || lbl[i]) continue;
    let sp = 0;
    stack[sp++] = i;
    lbl[i] = next;
    let x0 = W, x1 = -1, y0 = H, y1 = -1;
    while (sp > 0) {
      const p = stack[--sp];
      const px = p % W, py = (p / W) | 0;
      if (px < x0) x0 = px;
      if (px > x1) x1 = px;
      if (py < y0) y0 = py;
      if (py > y1) y1 = py;
      if (px > 0 && mask[p - 1] && !lbl[p - 1]) { lbl[p - 1] = next; stack[sp++] = p - 1; }
      if (px < W - 1 && mask[p + 1] && !lbl[p + 1]) { lbl[p + 1] = next; stack[sp++] = p + 1; }
      if (py > 0 && mask[p - W] && !lbl[p - W]) { lbl[p - W] = next; stack[sp++] = p - W; }
      if (py < H - 1 && mask[p + W] && !lbl[p + W]) { lbl[p + W] = next; stack[sp++] = p + W; }
    }
    boxes.push({ x0, y0, x1, y1 });
    next++;
  }
  return boxes;
}

function cropResize(src: Uint8ClampedArray, w: number, h: number, cx0: number, cy0: number, cx1: number, cy1: number, tw: number, th: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(tw * th * 4);
  const cw = cx1 - cx0, ch = cy1 - cy0;
  for (let y = 0; y < th; y++)
    for (let x = 0; x < tw; x++) {
      const fx = cx0 + (x + 0.5) * (cw / tw) - 0.5, fy = cy0 + (y + 0.5) * (ch / th) - 0.5;
      const xa = Math.max(0, Math.min(w - 1, Math.floor(fx)));
      const ya = Math.max(0, Math.min(h - 1, Math.floor(fy)));
      const xb = Math.min(w - 1, xa + 1), yb = Math.min(h - 1, ya + 1);
      const dx = fx - Math.floor(fx), dy = fy - Math.floor(fy);
      for (let c = 0; c < 3; c++) {
        const p00 = src[(ya * w + xa) * 4 + c], p10 = src[(ya * w + xb) * 4 + c];
        const p01 = src[(yb * w + xa) * 4 + c], p11 = src[(yb * w + xb) * 4 + c];
        out[(y * tw + x) * 4 + c] =
          p00 * (1 - dx) * (1 - dy) + p10 * dx * (1 - dy) + p01 * (1 - dx) * dy + p11 * dx * dy;
      }
      out[(y * tw + x) * 4 + 3] = 255;
    }
  return out;
}

function autocontrast(data: Uint8ClampedArray, n: number): Uint8ClampedArray {
  const mn = [255, 255, 255], mx = [0, 0, 0];
  for (let i = 0; i < n; i++)
    for (let c = 0; c < 3; c++) {
      const v = data[i * 4 + c];
      if (v < mn[c]) mn[c] = v;
      if (v > mx[c]) mx[c] = v;
    }
  const d2 = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++)
    for (let c = 0; c < 3; c++)
      d2[i * 4 + c] = Math.round(((data[i * 4 + c] - mn[c]) / Math.max(1, mx[c] - mn[c])) * 255);
  return d2;
}

function rotateCrop(rgba: Uint8ClampedArray, w: number, h: number, angleDeg: number) {
  const rad = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(rad), sin = Math.sin(rad);
  const nw = Math.ceil(Math.abs(w * cos) + Math.abs(h * sin));
  const nh = Math.ceil(Math.abs(w * sin) + Math.abs(h * cos));
  const out = new Uint8ClampedArray(nw * nh * 4);
  for (let y = 0; y < nh; y++)
    for (let x = 0; x < nw; x++) {
      const ox = x - nw / 2 + 0.5, oy = y - nh / 2 + 0.5;
      const ix = ox * cos + oy * sin + w / 2 - 0.5;
      const iy = -ox * sin + oy * cos + h / 2 - 0.5;
      const x0 = Math.floor(ix), y0 = Math.floor(iy);
      const fx = ix - x0, fy = iy - y0;
      let v: [number, number, number] = [255, 255, 255];
      if (x0 >= 0 && x0 < w && y0 >= 0 && y0 < h) {
        const xa = Math.max(0, x0), ya = Math.max(0, y0);
        const xb = Math.min(w - 1, xa + 1), yb = Math.min(h - 1, ya + 1);
        for (let c = 0; c < 3; c++) {
          const p00 = rgba[(ya * w + xa) * 4 + c], p10 = rgba[(ya * w + xb) * 4 + c];
          const p01 = rgba[(yb * w + xa) * 4 + c], p11 = rgba[(yb * w + xb) * 4 + c];
          v[c] = p00 * (1 - fx) * (1 - fy) + p10 * fx * (1 - fy) + p01 * (1 - fx) * fy + p11 * fx * fy;
        }
      }
      for (let c = 0; c < 3; c++) out[(y * nw + x) * 4 + c] = v[c];
      out[(y * nw + x) * 4 + 3] = 255;
    }
  return { data: out, w: nw, h: nh };
}

function pcaAngle(rgba: Uint8ClampedArray, w: number, h: number): number {
  const n = w * h;
  const gray = new Float32Array(n);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const v = (rgba[i * 4] + rgba[i * 4 + 1] + rgba[i * 4 + 2]) / 3;
    gray[i] = v;
    sum += v;
  }
  const mean = sum / n;
  const xs: number[] = [], ys: number[] = [];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) if (gray[y * w + x] < mean * 0.8) { xs.push(x); ys.push(y); }
  if (xs.length < 12) return 0;
  let mx = 0, my = 0;
  for (let i = 0; i < xs.length; i++) { mx += xs[i]; my += ys[i]; }
  mx /= xs.length; my /= ys.length;
  let sxx = 0, syy = 0, sxy = 0;
  for (let i = 0; i < xs.length; i++) {
    const dx = xs[i] - mx, dy = ys[i] - my;
    sxx += dx * dx; syy += dy * dy; sxy += dx * dy;
  }
  let ang = (0.5 * Math.atan2(2 * sxy, sxx - syy) * 180) / Math.PI;
  if (ang > 90) ang -= 180;
  if (ang < -90) ang += 180;
  if (Math.abs(ang) < 2.5 || Math.abs(ang) > 35) return 0;
  return ang;
}

// Detection at one working size: threshold the heat map, keep components,
// merge fragments into text lines, unclip the boxes back to source scale.
async function detOnce(img: Img, minSide: number): Promise<Box[]> {
  const min = Math.min(img.w, img.h);
  let tw = img.w, th = img.h;
  if (min < minSide) {
    const s = minSide / min;
    tw = Math.max(32, Math.round(img.w * s));
    th = Math.max(32, Math.round(img.h * s));
  } else if (min > minSide * 1.6) {
    const s = minSide / min;
    tw = Math.max(32, Math.round(img.w * s));
    th = Math.max(32, Math.round(img.h * s));
  }
  const resized = cropResize(img.data, img.w, img.h, 0, 0, img.w, img.h, tw, th);
  const ph = (32 - (th % 32)) % 32, pw = (32 - (tw % 32)) % 32;
  const ph2 = th + ph, pw2 = tw + pw;
  const plane = ph2 * pw2;
  const bgr = new Float32Array(3 * plane);
  for (let y = 0; y < th; y++)
    for (let x = 0; x < tw; x++) {
      const si = (y * tw + x) * 4, di = y * pw2 + x;
      bgr[di] = resized[si + 2] / 255;
      bgr[plane + di] = resized[si + 1] / 255;
      bgr[2 * plane + di] = resized[si] / 255;
    }
  const n = new Float32Array(bgr.length);
  for (let i = 0; i < bgr.length; i++) n[i] = (bgr[i] - 0.5) / 0.5;
  const t = new ortMod.Tensor("float32", n, [1, 3, ph2, pw2]);
  const r = await detS.run({ [detS.inputNames[0]]: t });
  const out = r[detS.outputNames[0]];
  const H = out.dims[2], W = out.dims[3];
  const map = out.data as Float32Array;
  const mask = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) mask[i] = map[i] > 0.2 ? 1 : 0;
  const dm = dilate(mask, W, H);
  const comps = components(dm, W, H);
  const items: Box[] = [];
  for (const b of comps) {
    const bw = b.x1 - b.x0 + 1, bh = b.y1 - b.y0 + 1;
    if (bw < 3 || bh < 3) continue;
    let s = 0;
    for (let y = b.y0; y <= b.y1; y++) for (let x = b.x0; x <= b.x1; x++) s += map[y * W + x];
    const score = s / (bw * bh);
    if (score < 0.3) continue;
    items.push({ x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1, score, area: bw * bh });
  }
  let changed = true;
  while (changed) {
    changed = false;
    items.sort((a, b) => a.y0 - b.y0);
    outer: for (let a = 0; a < items.length; a++)
      for (let b = a + 1; b < items.length; b++) {
        const A = items[a], B = items[b];
        const ov = Math.min(A.y1, B.y1) - Math.max(A.y0, B.y0);
        const mh = Math.min(A.y1 - A.y0, B.y1 - B.y0);
        const gapx = Math.max(A.x0, B.x0) - Math.min(A.x1, B.x1);
        const ovx = Math.min(A.x1, B.x1) - Math.max(A.x0, B.x0);
        const mw = Math.min(A.x1 - A.x0, B.x1 - B.x0);
        const gapy = Math.max(A.y0, B.y0) - Math.min(A.y1, B.y1);
        if ((ov >= 0.35 * mh && gapx <= 1.6 * mh) || (ovx >= 0.5 * mw && gapy <= 0.6 * Math.max(mh, 4))) {
          A.x0 = Math.min(A.x0, B.x0);
          A.y0 = Math.min(A.y0, B.y0);
          A.x1 = Math.max(A.x1, B.x1);
          A.y1 = Math.max(A.y1, B.y1);
          A.score = Math.max(A.score, B.score);
          A.area += B.area;
          items.splice(b, 1);
          changed = true;
          break outer;
        }
      }
  }
  const out2: Box[] = [];
  for (const b of items) {
    const w = b.x1 - b.x0, h = b.y1 - b.y0;
    const off = (b.area * 1.6) / (2 * (w + h));
    out2.push({
      x0: Math.max(0, (b.x0 - off) * (tw / W)),
      y0: Math.max(0, (b.y0 - off) * (th / H)),
      x1: Math.min(img.w, (b.x1 + off) * (tw / W)),
      y1: Math.min(img.h, (b.y1 + off) * (th / H)),
      score: b.score,
      area: b.area,
    });
  }
  return out2;
}

// Two working sizes: the normal pass, and a larger one only when nothing
// plate-sized turned up (small or distant plates).
async function detBoxes(img: Img): Promise<Box[]> {
  const pass1 = await detOnce(img, 736);
  const minW = Math.min(img.w, img.h) * 0.12;
  if (pass1.some((b) => b.x1 - b.x0 >= minW)) return pass1.slice(0, 12);
  const pass2 = await detOnce(img, 1216);
  const all = pass1.concat(pass2);
  all.sort((a, b) => b.area - a.area);
  const kept: Box[] = [];
  for (const b of all) {
    let dup = false;
    for (const k of kept) {
      const ix = Math.min(k.x1, b.x1) - Math.max(k.x0, b.x0);
      const iy = Math.min(k.y1, b.y1) - Math.max(k.y0, b.y0);
      if (ix > 0 && iy > 0) {
        const inter = ix * iy;
        const areaA = (k.x1 - k.x0) * (k.y1 - k.y0);
        const areaB = (b.x1 - b.x0) * (b.y1 - b.y0);
        if (inter / Math.min(areaA, areaB) > 0.6) { dup = true; break; }
      }
    }
    if (!dup) kept.push(b);
  }
  return kept.slice(0, 12);
}

// --- recognition -------------------------------------------------------------

// Per-timestep top-3 class probabilities from the recognition model.
async function recSteps(rgba: Uint8ClampedArray, cw: number, ch: number, scale = 1, contrast = false) {
  let data = rgba, w = cw, h = ch;
  if (scale !== 1) {
    w = Math.max(8, Math.round(cw * scale));
    h = Math.max(8, Math.round(ch * scale));
    data = cropResize(rgba, cw, ch, 0, 0, cw, ch, w, h);
  }
  if (contrast) data = autocontrast(data, w * h);
  const ratio = w / h;
  const rw = Math.max(16, Math.min(320, Math.ceil(48 * ratio)));
  const small = cropResize(data, w, h, 0, 0, w, h, rw, 48);
  const bgr = new Float32Array(3 * 48 * 320);
  for (let y = 0; y < 48; y++)
    for (let x = 0; x < rw; x++) {
      const si = (y * rw + x) * 4, di = y * 320 + x;
      bgr[di] = (small[si + 2] / 255 - 0.5) / 0.5;
      bgr[48 * 320 + di] = (small[si + 1] / 255 - 0.5) / 0.5;
      bgr[2 * 48 * 320 + di] = (small[si] / 255 - 0.5) / 0.5;
    }
  const t = new ortMod.Tensor("float32", bgr, [1, 3, 48, 320]);
  const r = await recS.run({ [recS.inputNames[0]]: t });
  const p = r[recS.outputNames[0]];
  const T = p.dims[1], C = p.dims[2];
  const pd = p.data as Float32Array;
  const steps: number[][][] = [];
  for (let i = 0; i < T; i++) {
    const arr: number[][] = [];
    for (let c = 0; c < C; c++) arr.push([pd[i * C + c], c]);
    arr.sort((a, b) => b[0] - a[0]);
    steps.push(arr.slice(0, 3));
  }
  return { steps, T, C };
}

// CTC greedy decode with a per-character confidence in (0, 1].
function ctcDecode(steps: number[][][]): { text: string; confs: number[] } {
  const cs = chars ?? [];
  let s = "", prev = -1;
  const confs: number[] = [];
  for (const [b1, b2] of steps) {
    const best = b1[1];
    if (best !== prev && best !== 0 && best - 1 < cs.length) {
      s += cs[best - 1];
      const p1 = Math.max(1e-9, b1[0]);
      const p2 = Math.max(1e-9, b2 ? b2[0] : 0);
      confs.push(p1 / (p1 + p2));
    }
    prev = best;
  }
  return { text: s.trim(), confs };
}

export type Read = { t: string; c: number; confs?: number[] };

// Fuse the crop variants of one region: keep the majority length, vote each
// position weighted by variant confidence, keep the vote share as a per-char
// confidence.
function fuseReads(reads: Read[]): Read[] {
  if (reads.length <= 1) return reads;
  const lens = new Map<number, number>();
  for (const r of reads) lens.set(r.t.length, (lens.get(r.t.length) || 0) + r.c);
  let bestL = 0, bw = -1;
  for (const [L, w] of lens) if (w > bw) { bw = w; bestL = L; }
  const bucket = reads.filter((r) => Math.abs(r.t.length - bestL) <= 1);
  if (!bucket.length) return reads;
  let fused = "";
  const posConfs: number[] = [];
  for (let i = 0; i < bestL; i++) {
    const tally = new Map<string, number>();
    for (const r of bucket) {
      const ch = r.t[i];
      if (!ch) continue;
      tally.set(ch, (tally.get(ch) || 0) + r.c);
    }
    if (!tally.size) { fused += "?"; posConfs.push(0); continue; }
    const ranked = [...tally.entries()].sort((a, b) => b[1] - a[1]);
    fused += ranked[0][0];
    const total = [...tally.values()].reduce((a, b) => a + b, 0);
    posConfs.push(ranked[0][1] / total);
  }
  return [{ t: fused, c: bucket.reduce((a, r) => a + r.c, 0) / bucket.length, confs: posConfs }];
}

// Read every text region on the photo. Returns fused reads with confidences.
export async function ppocrRead(file: File | Blob): Promise<Read[]> {
  await loadEngine();
  const img = await loadImage(file);
  const boxes = await detBoxes(img);
  const texts: Read[] = [];
  for (const b of boxes) {
    const x0 = Math.round(b.x0), y0 = Math.round(b.y0), x1 = Math.round(b.x1), y1 = Math.round(b.y1);
    const cw = x1 - x0, ch = y1 - y0;
    if (cw < 8 || ch < 6) continue;
    const pad = (p: number) => ({
      x0: Math.max(0, x0 - Math.round(p * cw)),
      y0: Math.max(0, y0 - Math.round(p * ch)),
      x1: Math.min(img.w, x1 + Math.round(p * cw)),
      y1: Math.min(img.h, y1 + Math.round(p * ch)),
    });
    const reads: Read[] = [];
    const run = async (px: number, py: number, pw: number, ph: number, scale: number, contrast: boolean) => {
      if (pw < 8 || ph < 6) return;
      const crop = cropResize(img.data, img.w, img.h, px, py, px + pw, py + ph, pw, ph);
      const rp = await recSteps(crop, pw, ph, scale, contrast);
      const dec = ctcDecode(rp.steps);
      if (dec.text) reads.push({ t: dec.text, c: 0.8, confs: dec.confs });
      // second opinion: at the weakest characters, try the runner-up class
      if (dec.text && dec.confs) {
        const L = dec.text.length;
        const idxOf: number[] = [];
        rp.steps.forEach((st: number[][], k: number) => {
          const best = st[0][1];
          if (best !== 0 && best - 1 < (chars?.length ?? 0)) idxOf.push(k);
        });
        const weak = [...Array(L).keys()].filter((i) => dec.confs[i] < 0.75).slice(0, 2);
        for (const i of weak) {
          const st = rp.steps[idxOf[i]];
          if (!st) continue;
          const alts = st.slice(1, 3).filter(
            (a: number[]) => a[1] !== 0 && a[1] - 1 < (chars?.length ?? 0) && chars![a[1] - 1] !== dec.text[i]
          );
          for (const a of alts.slice(0, 1)) {
            const alt = dec.text.slice(0, i) + chars![a[1] - 1] + dec.text.slice(i + 1);
            if (alt && alt !== dec.text)
              reads.push({
                t: alt,
                c: 0.55,
                confs: dec.confs.map((v, j) => (j === i ? Math.min(v, 0.5) : v)),
              });
          }
        }
      }
    };
    const pads = [0.04, 0.1, 0.2, 0.3];
    for (const p of pads) {
      const a = pad(p);
      await run(a.x0, a.y0, a.x1 - a.x0, a.y1 - a.y0, 1, false);
      await run(a.x0, a.y0, a.x1 - a.x0, a.y1 - a.y0, 2, false);
    }
    const a = pad(0.1);
    await run(a.x0, a.y0, a.x1 - a.x0, a.y1 - a.y0, 1, true);
    // straighten tilted text (plate brackets and skewed photos)
    const wide = cropResize(img.data, img.w, img.h, a.x0, a.y0, a.x1, a.y1, a.x1 - a.x0, a.y1 - a.y0);
    const ang = pcaAngle(wide, a.x1 - a.x0, a.y1 - a.y0);
    if (ang) {
      const rc = rotateCrop(wide, a.x1 - a.x0, a.y1 - a.y0, ang);
      for (const scale of [1, 2]) {
        const rp = await recSteps(rc.data, rc.w, rc.h, scale, false);
        const dec = ctcDecode(rp.steps);
        if (dec.text) reads.push({ t: dec.text, c: 0.8, confs: dec.confs });
      }
    }
    for (const f of fuseReads(reads)) texts.push(f);
  }
  return texts;
}
