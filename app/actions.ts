"use server";

import { db } from "@/lib/db";
import {
  isOwner,
  unlockOwner,
  setPasscode,
  verifyCurrent,
  removePasscode,
  passcodeConfigured,
} from "@/lib/auth";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

// v1 runs single-owner: no accounts yet, every vehicle belongs to this owner id.
const OWNER = "john";

export async function createVehicle(fd: FormData) {
  if (!(await isOwner())) redirect("/unlock?next=/add");
  const type = (fd.get("type") as string) || null;
  const nickname = (fd.get("nickname") as string) || null;
  const year = fd.get("year") ? parseInt(fd.get("year") as string, 10) : null;
  const make = (fd.get("make") as string) || null;
  const model = (fd.get("model") as string) || null;
  const vin = (fd.get("vin") as string) || null;
  const registration = (fd.get("registration") as string) || null;
  const photoUrl = (fd.get("photoUrl") as string) || null;

  const vehicle = await db.vehicle.create({
    data: {
      ownerId: OWNER,
      type,
      typeConfirmed: Boolean(type),
      nickname,
      year,
      make,
      model,
      vin,
      registration,
      photoUrl,
    },
  });

  // Any logbook page photos taken at onboarding become the first documents.
  const pageUrls = fd.getAll("logbookPages").filter(Boolean) as string[];
  for (const url of pageUrls.slice(0, 8)) {
    await db.document.create({
      data: { vehicleId: vehicle.id, kind: "PHOTO", url },
    });
  }

  revalidatePath("/");
  redirect(`/vehicle/${vehicle.id}`);
}

// Deleting a vehicle removes the profile and, by cascade, its entries,
// documents and handovers. Owner-gated like every write path.
export async function deleteVehicle(fd: FormData) {
  const vehicleId = fd.get("vehicleId") as string;
  if (!(await isOwner())) redirect(`/unlock?next=/`);
  await db.vehicle.delete({ where: { id: vehicleId } });
  revalidatePath("/");
  redirect("/");
}

export async function addServiceEntry(fd: FormData) {
  const vehicleId = fd.get("vehicleId") as string;
  if (!(await isOwner())) redirect(`/unlock?next=/vehicle/${vehicleId}`);
  const dateStr = fd.get("date") as string;
  const odo = fd.get("odometerKm") ? parseInt(fd.get("odometerKm") as string, 10) : null;
  const jobs = ((fd.get("jobs") as string) || "").trim() || "Service entry";
  const cost = fd.get("cost") ? Math.round(parseFloat(fd.get("cost") as string) * 100) : null;
  const provider = (fd.get("provider") as string) || null;
  const notes = (fd.get("notes") as string) || null;
  const source = (fd.get("source") as string) === "SCAN" ? "SCAN" : "MANUAL";

  const entry = await db.serviceEntry.create({
    data: {
      vehicleId,
      date: new Date(dateStr + "T00:00:00"),
      odometerKm: odo,
      jobs,
      costCents: cost,
      provider,
      notes,
      source,
      confirmed: true, // only saved after the human reviews and submits
      ...entryExtras(fd),
    },
  });

  const receiptUrls = fd.getAll("receiptPhotos").filter(Boolean) as string[];
  for (const url of receiptUrls.slice(0, 4)) {
    await db.document.create({
      data: { vehicleId, entryId: entry.id, kind: "PHOTO", url },
    });
  }

  revalidatePath(`/vehicle/${vehicleId}`);
  redirect(`/vehicle/${vehicleId}`);
}

// The common service-invoice fields, read the same way for create and edit so
// both forms stay in step. Money fields arrive in dollars and store cents.
function entryExtras(fd: FormData) {
  const cents = (name: string): number | null => {
    const v = (fd.get(name) as string)?.trim();
    if (!v) return null;
    const n = parseFloat(v);
    return Number.isFinite(n) ? Math.round(n * 100) : null;
  };
  const int = (name: string): number | null => {
    const v = (fd.get(name) as string)?.trim();
    if (!v) return null;
    const n = parseInt(v.replace(/[\s,]/g, ""), 10);
    return Number.isFinite(n) ? n : null;
  };
  const str = (name: string): string | null => ((fd.get(name) as string)?.trim() || null);
  const nextDue = str("nextServiceDue");
  let lineItems: object | null = null;
  try {
    const raw = (fd.get("lineItems") as string)?.trim();
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length) lineItems = parsed;
    }
  } catch {}
  // Json fields take DbNull rather than null, so unset line items just drop out
  const extras: Record<string, unknown> = {
    serviceType: str("serviceType"),
    repairOrderNo: str("repairOrderNo"),
    invoiceNo: str("invoiceNo"),
    partsUsed: str("partsUsed"),
    warranty: str("warranty"),
    adviser: str("adviser"),
    labourCents: cents("labour"),
    partsCents: cents("parts"),
    gstCents: cents("gst"),
    paymentMethod: str("paymentMethod"),
    nextServiceDue: nextDue ? new Date(nextDue + "T00:00:00") : null,
    nextServiceOdometer: int("nextServiceOdometer"),
  };
  if (lineItems) extras.lineItems = lineItems;
  return extras;
}

// Editing a past entry: every field the create form has is editable here too,
// and the human confirm never lapses (edits are owner-gated like every write).
export async function updateServiceEntry(fd: FormData) {
  const entryId = fd.get("entryId") as string;
  if (!(await isOwner())) redirect(`/unlock?next=/entry/${entryId}/edit`);
  const dateStr = fd.get("date") as string;
  const odo = fd.get("odometerKm") ? parseInt(fd.get("odometerKm") as string, 10) : null;
  const jobs = ((fd.get("jobs") as string) || "").trim() || "Service entry";
  const cost = fd.get("cost") ? Math.round(parseFloat(fd.get("cost") as string) * 100) : null;

  await db.serviceEntry.update({
    where: { id: entryId },
    data: {
      date: new Date(dateStr + "T00:00:00"),
      odometerKm: odo,
      jobs,
      costCents: cost,
      provider: (fd.get("provider") as string) || null,
      notes: (fd.get("notes") as string) || null,
      ...entryExtras(fd),
    },
  });

  const receiptUrls = fd.getAll("receiptPhotos").filter(Boolean) as string[];
  for (const url of receiptUrls.slice(0, 8)) {
    await db.document.create({
      data: { entryId, kind: "PHOTO", url },
    });
  }

  const vehicleId = (fd.get("vehicleId") as string) || "";
  revalidatePath(`/vehicle/${vehicleId}`);
  redirect(`/vehicle/${vehicleId}`);
}

// Removing an entry takes its attachments with it (documents cascade).
export async function deleteServiceEntry(fd: FormData) {
  const entryId = fd.get("entryId") as string;
  if (!(await isOwner())) redirect(`/unlock?next=/entry/${entryId}/edit`);
  const vehicleId = (fd.get("vehicleId") as string) || "";
  await db.serviceEntry.delete({ where: { id: entryId } });
  revalidatePath(`/vehicle/${vehicleId}`);
  redirect(`/vehicle/${vehicleId}`);
}

// Remove one attachment from an entry.
export async function deleteDocument(fd: FormData) {
  const docId = fd.get("documentId") as string;
  const vehicleId = (fd.get("vehicleId") as string) || "";
  if (!(await isOwner())) redirect(`/unlock?next=/vehicle/${vehicleId}`);
  await db.document.delete({ where: { id: docId } });
  revalidatePath(`/vehicle/${vehicleId}`);
  redirect(fd.get("back") === "edit" && fd.get("entryId") ? `/entry/${fd.get("entryId")}/edit` : `/vehicle/${vehicleId}`);
}

export async function doUnlock(fd: FormData) {
  const ok = await unlockOwner(((fd.get("passcode") as string) ?? "").trim());
  const next = (fd.get("next") as string) || "/";
  if (!ok) redirect(`/unlock?bad=1&next=${encodeURIComponent(next)}`);
  redirect(next);
}

// Passcode is the app user's own choice: they turn it on, change it, or
// remove it here. Turning it on or changing it needs the current passcode
// whenever one is already set.
export async function changePasscode(fd: FormData) {
  const current = ((fd.get("current") as string) ?? "").trim();
  const next = ((fd.get("next") as string) ?? "").trim();
  if (!next) redirect("/settings");
  if (await passcodeConfigured()) {
    if (!(await verifyCurrent(current))) redirect("/settings?bad=1");
  } else {
    // First passcode claim on a public deployment: if the operator set a
    // SETUP_TOKEN env var, it is required here, so a stranger who finds the
    // URL cannot claim the app and lock the owner out before they set theirs.
    const setupToken = process.env.SETUP_TOKEN;
    if (setupToken && ((fd.get("setupToken") as string) ?? "").trim() !== setupToken) {
      redirect("/settings?bad=1");
    }
  }
  await setPasscode(next);
  revalidatePath("/settings");
  redirect("/settings?saved=1");
}

export async function removePasscodeAction(fd: FormData) {
  const current = ((fd.get("current") as string) ?? "").trim();
  if (await passcodeConfigured()) {
    if (!(await verifyCurrent(current))) redirect("/settings?bad=1");
  }
  await removePasscode();
  revalidatePath("/settings");
  redirect("/settings?removed=1");
}
