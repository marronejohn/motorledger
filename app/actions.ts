"use server";

import { db } from "@/lib/db";
import { requireUser, signUp, signIn, signOut } from "@/lib/auth";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

// Every vehicle belongs to the signed-in account: writes are owner-gated and
// every read filters on ownerId, so accounts never see each other's data.
// The share and buyer views stay login-free on their shareToken.

export async function createVehicle(fd: FormData) {
  const user = await requireUser("/add");
  const type = (fd.get("type") as string) || null;
  const nickname = (fd.get("nickname") as string) || null;
  const year = fd.get("year") ? parseInt(fd.get("year") as string, 10) : null;
  const make = (fd.get("make") as string) || null;
  const model = (fd.get("model") as string) || null;
  const vin = (fd.get("vin") as string) || null;
  const registration = (fd.get("registration") as string) || null;
  const regoExpiryRaw = fd.get("regoExpiry") as string;
  const insurer = (fd.get("insurer") as string) || null;
  const insuranceExpiryRaw = fd.get("insuranceExpiry") as string;
  const photoUrl = (fd.get("photoUrl") as string) || null;

  const vehicle = await db.vehicle.create({
    data: {
      ownerId: user.id,
      type,
      typeConfirmed: Boolean(type),
      nickname,
      year,
      make,
      model,
      vin,
      registration,
      regoExpiry: regoExpiryRaw ? new Date(`${regoExpiryRaw}T00:00:00`) : null,
      insurer,
      insuranceExpiry: insuranceExpiryRaw ? new Date(`${insuranceExpiryRaw}T00:00:00`) : null,
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

// Editing a vehicle's reminder dates: rego expiry, insurer, insurance
// expiry. Owner-gated like every write path.
export async function updateVehicle(fd: FormData) {
  const id = fd.get("vehicleId") as string;
  const user = await requireUser(`/vehicle/${id}`);
  const dateFrom = (name: string) => {
    const raw = fd.get(name) as string;
    return raw ? new Date(`${raw}T00:00:00`) : null;
  };
  const res = await db.vehicle.updateMany({
    where: { id, ownerId: user.id },
    data: {
      regoExpiry: dateFrom("regoExpiry"),
      insurer: (fd.get("insurer") as string) || null,
      insuranceExpiry: dateFrom("insuranceExpiry"),
    },
  });
  if (res.count === 0) redirect("/");
  revalidatePath(`/vehicle/${id}`);
  redirect(`/vehicle/${id}`);
}

// Deleting a vehicle removes the profile and, by cascade, its entries,
// documents and handovers. Owner-gated like every write path.
export async function deleteVehicle(fd: FormData) {
  const vehicleId = fd.get("vehicleId") as string;
  const user = await requireUser("/");
  await db.vehicle.deleteMany({ where: { id: vehicleId, ownerId: user.id } });
  revalidatePath("/");
  redirect("/");
}

export async function addServiceEntry(fd: FormData) {
  const vehicleId = fd.get("vehicleId") as string;
  const user = await requireUser(`/vehicle/${vehicleId}`);
  const vehicle = await db.vehicle.findFirst({
    where: { id: vehicleId, ownerId: user.id },
    select: { id: true },
  });
  if (!vehicle) redirect("/");
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
  const user = await requireUser(`/entry/${entryId}/edit`);
  const dateStr = fd.get("date") as string;
  const odo = fd.get("odometerKm") ? parseInt(fd.get("odometerKm") as string, 10) : null;
  const jobs = ((fd.get("jobs") as string) || "").trim() || "Service entry";
  const cost = fd.get("cost") ? Math.round(parseFloat(fd.get("cost") as string) * 100) : null;

  const res = await db.serviceEntry.updateMany({
    where: { id: entryId, vehicle: { ownerId: user.id } },
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
  if (res.count === 0) redirect("/");

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
  const user = await requireUser(`/entry/${entryId}/edit`);
  const res = await db.serviceEntry.deleteMany({
    where: { id: entryId, vehicle: { ownerId: user.id } },
  });
  if (res.count === 0) redirect("/");
  const vehicleId = (fd.get("vehicleId") as string) || "";
  revalidatePath(`/vehicle/${vehicleId}`);
  redirect(`/vehicle/${vehicleId}`);
}

// Remove one attachment from an entry.
export async function deleteDocument(fd: FormData) {
  const docId = fd.get("documentId") as string;
  const vehicleId = (fd.get("vehicleId") as string) || "";
  const user = await requireUser(`/vehicle/${vehicleId}`);
  await db.document.deleteMany({
    where: {
      id: docId,
      OR: [
        { vehicle: { ownerId: user.id } },
        { entry: { vehicle: { ownerId: user.id } } },
      ],
    },
  });
  revalidatePath(`/vehicle/${vehicleId}`);
  redirect(fd.get("back") === "edit" && fd.get("entryId") ? `/entry/${fd.get("entryId")}/edit` : `/vehicle/${vehicleId}`);
}

export async function signUpAction(fd: FormData) {
  const next = (fd.get("next") as string) || "/";
  const err = await signUp(
    (fd.get("email") as string) ?? "",
    (fd.get("password") as string) ?? "",
    (fd.get("name") as string) ?? ""
  );
  if (err) {
    redirect(`/signin?mode=signup&err=${encodeURIComponent(err)}&next=${encodeURIComponent(next)}`);
  }
  redirect(next);
}

export async function signInAction(fd: FormData) {
  const next = (fd.get("next") as string) || "/";
  const err = await signIn((fd.get("email") as string) ?? "", (fd.get("password") as string) ?? "");
  if (err) {
    redirect(`/signin?err=${encodeURIComponent(err)}&next=${encodeURIComponent(next)}`);
  }
  redirect(next);
}

export async function signOutAction() {
  await signOut();
  redirect("/signin");
}
