"use client";

// Compress a photo client-side before it is stored: max dimension, JPEG quality.
// Keeps photos small enough to live in Postgres on a free tier for v1.
// Decoding has a fallback because some phone photos (very large JPEGs, or
// odd files handed over by the camera) fail createImageBitmap inside the
// WebView: fall back to an <img> element before giving up, and say what failed.
export async function fileToCompressedDataUrl(
  file: File,
  maxDim = 1280,
  quality = 0.72
): Promise<string> {
  if (!file || file.size === 0) {
    throw new Error("that file came through empty, try taking or picking it again");
  }
  try {
    const bitmap = await createImageBitmap(file);
    const url = draw(bitmap, bitmap.width, bitmap.height, maxDim, quality);
    bitmap.close();
    return url;
  } catch {
    // fall through to the <img> fallback
  }
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    const url = URL.createObjectURL(file);
    el.onload = () => {
      URL.revokeObjectURL(url);
      resolve(el);
    };
    el.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("no"));
    };
    el.src = url;
  }).catch(() => {
    throw new Error("that photo's format will not open here, try a JPG or PNG");
  });
  if (!img.naturalWidth || !img.naturalHeight) {
    throw new Error("that photo's format will not open here, try a JPG or PNG");
  }
  return draw(img, img.naturalWidth, img.naturalHeight, maxDim, quality);
}

function draw(
  source: CanvasImageSource,
  w: number,
  h: number,
  maxDim: number,
  quality: number
): string {
  const scale = Math.min(1, maxDim / Math.max(w, h));
  const cw = Math.max(1, Math.round(w * scale));
  const ch = Math.max(1, Math.round(h * scale));
  const canvas = document.createElement("canvas");
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("could not prepare the canvas");
  ctx.drawImage(source, 0, 0, cw, ch);
  return canvas.toDataURL("image/jpeg", quality);
}
