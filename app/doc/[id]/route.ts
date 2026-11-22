// Serves one stored attachment (receipt photo) from its Document row.
// Attachments are kept as data URLs; Chrome refuses top-level navigation to a
// data: URL, so "view full size" needs a real URL. Ids are unguessable cuids,
// the same exposure model as the share token.
import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const doc = await db.document.findUnique({ where: { id } });
  if (!doc) return new NextResponse("Not found", { status: 404 });
  const m = /^data:([^;,]*)(;base64)?,([\s\S]*)$/.exec(doc.url);
  if (!m) return new NextResponse("Unsupported", { status: 415 });
  const mime = (m[1] || "").toLowerCase();
  // Stored documents are always compressed photos (JPEG data URLs). Serving
  // anything else (text/html above all) would be a script-injection route on
  // this origin, so only real image types leave here, and never as HTML.
  if (!["image/jpeg", "image/png", "image/webp", "image/gif"].includes(mime)) {
    return new NextResponse("Unsupported", { status: 415 });
  }
  const body = m[2]
    ? Buffer.from(m[3], "base64")
    : Buffer.from(decodeURIComponent(m[3]), "utf8");
  return new NextResponse(new Uint8Array(body), {
    headers: {
      "Content-Type": mime,
      "Content-Disposition": 'inline; filename="receipt"',
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, max-age=86400",
    },
  });
}
