import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { isOwner } from "@/lib/auth";
import EditEntry from "@/app/edit-entry";

export const dynamic = "force-dynamic";

const iso = (d: Date) => d.toISOString().slice(0, 10);
const money = (c: number | null) => (c == null ? "" : (c / 100).toFixed(2));

export default async function EditEntryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!(await isOwner())) notFound();
  const entry = await db.serviceEntry.findUnique({
    where: { id },
    include: { vehicle: true, documents: true },
  });
  if (!entry) notFound();

  const items = (entry.lineItems as any[]) ?? [];
  const itemsLine = items.length
    ? items.map((it: any) => `${it.qty ?? ""}${it.no ? ` x ${it.no}` : ""} ${it.desc}`.trim()).join("; ")
    : "";

  return (
    <main className="wrap">
      <EditEntry
        entryId={entry.id}
        vehicleId={entry.vehicleId}
        vehicleName={entry.vehicle.nickname ?? entry.vehicle.registration ?? entry.vehicle.id}
        initial={{
          date: iso(entry.date),
          odometerKm: entry.odometerKm != null ? String(entry.odometerKm) : "",
          jobs: entry.jobs,
          cost: money(entry.costCents),
          provider: entry.provider ?? "",
          notes: entry.notes ?? itemsLine,
          serviceType: entry.serviceType ?? "",
          repairOrderNo: entry.repairOrderNo ?? "",
          invoiceNo: entry.invoiceNo ?? "",
          partsUsed: entry.partsUsed ?? "",
          warranty: entry.warranty ?? "",
          adviser: entry.adviser ?? "",
          nextServiceDue: entry.nextServiceDue ? iso(entry.nextServiceDue) : "",
          nextServiceOdometer: entry.nextServiceOdometer != null ? String(entry.nextServiceOdometer) : "",
          labour: money(entry.labourCents),
          parts: money(entry.partsCents),
          gst: money(entry.gstCents),
          paymentMethod: entry.paymentMethod ?? "",
        }}
        documents={entry.documents.map((d) => ({ id: d.id, url: d.url, created: d.createdAt.toISOString() }))}
      />
    </main>
  );
}
