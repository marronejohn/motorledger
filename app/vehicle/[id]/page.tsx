import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import NewEntry from "@/app/new-entry";
import { updateVehicle } from "@/app/actions";

export const dynamic = "force-dynamic";

export default async function VehiclePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // The timeline belongs to the signed-in account: strangers get the sign-in
  // screen, and only /share/<token> stays public.
  const user = await requireUser(`/vehicle/${id}`);
  const vehicle = await db.vehicle.findFirst({
    where: { id, ownerId: user.id },
    include: { entries: { orderBy: { date: "asc" }, include: { documents: true } } },
  });
  if (!vehicle) notFound();

  // Odometer continuity is computed at read time: backwards readings and
  // suspicious gaps feed the dossier's "history verified" line.
  const odoEntries = vehicle.entries.filter((e) => e.odometerKm != null);
  let continuity: "good" | "check" | "unknown" = "unknown";
  let flags: string[] = [];
  if (odoEntries.length >= 2) {
    continuity = "good";
    for (let i = 1; i < odoEntries.length; i++) {
      const prev = odoEntries[i - 1].odometerKm as number;
      const cur = odoEntries[i].odometerKm as number;
      if (cur < prev) {
        continuity = "check";
        flags.push(`Readings go backwards: ${prev.toLocaleString()} km → ${cur.toLocaleString()} km.`);
      }
    }
  }

  const name = vehicle.nickname ?? ([vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(" ") || vehicle.registration || "Untitled vehicle");
  const shareUrl = `/share/${vehicle.shareToken}`;

  // Headline numbers a buyer (and the owner) ask first: total logged spend and
  // when the next visit is due, from whatever entries say.
  const totalSpend = vehicle.entries.reduce((sum, e) => sum + (e.costCents ?? 0), 0);
  const nextDue = vehicle.entries
    .filter((e) => e.nextServiceDue && e.nextServiceDue.getTime() > Date.now() - 14 * 86400000)
    .sort((a, b) => (a.nextServiceDue as Date).getTime() - (b.nextServiceDue as Date).getTime())[0];
  const nextOdo = vehicle.entries
    .filter((e) => e.nextServiceOdometer != null)
    .sort((a, b) => (b.nextServiceOdometer as number) - (a.nextServiceOdometer as number))[0];
  // Summary lines: most recent visit, how the spend splits between scheduled
  // services and other work, and this year's running total.
  const byDate = [...vehicle.entries].sort((a, b) => b.date.getTime() - a.date.getTime());
  const lastEntry = byDate[0];
  const isService = (e: (typeof vehicle.entries)[number]) => /service/i.test(e.serviceType ?? "");
  const services = vehicle.entries.filter(isService);
  const repairs = vehicle.entries.filter((e) => !isService(e));
  const servicesCents = services.reduce((sum, e) => sum + (e.costCents ?? 0), 0);
  const repairsCents = repairs.reduce((sum, e) => sum + (e.costCents ?? 0), 0);
  const avgService = services.length > 0 ? Math.round(servicesCents / services.length) : null;
  const biggest = [...vehicle.entries]
    .filter((e) => (e.costCents ?? 0) > 0)
    .sort((a, b) => (b.costCents ?? 0) - (a.costCents ?? 0))[0];
  const thisYear = new Date().getFullYear();
  const yearEntries = vehicle.entries.filter((e) => e.date.getFullYear() === thisYear);
  const yearSpend = yearEntries.reduce((sum, e) => sum + (e.costCents ?? 0), 0);
  const money = (c: number) => `$${(c / 100).toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  // Where the work gets done: the workshop that appears most often, and the
  // km/year pace implied by the first and last odometer readings.
  const providerCounts = new Map<string, number>();
  for (const e of vehicle.entries) {
    const pv = (e.provider ?? "").trim();
    if (!pv) continue;
    providerCounts.set(pv, (providerCounts.get(pv) ?? 0) + 1);
  }
  const topProvider = [...providerCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
  const chrono = [...vehicle.entries].sort((a, b) => a.date.getTime() - b.date.getTime());
  let avgKmYear: number | null = null;
  if (chrono.length >= 2) {
    const first = chrono[0];
    const last = chrono[chrono.length - 1];
    if (first.odometerKm != null && last.odometerKm != null && last.odometerKm > first.odometerKm) {
      const years = Math.max(0.25, (last.date.getTime() - first.date.getTime()) / (365.25 * 86400000));
      avgKmYear = Math.round((last.odometerKm - first.odometerKm) / years / 100) * 100;
    }
  }

  // Reminder dates on the vehicle itself: the page reads them back with the
  // days until (or since) each, so nobody does date maths in their head.
  const dueTxt = (d: Date) => {
    const days = Math.ceil((d.getTime() - Date.now()) / 86400000);
    const when = d.toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
    if (days < 0) return `${when} (${Math.abs(days)} ${Math.abs(days) === 1 ? "day" : "days"} ago)`;
    if (days === 0) return `${when} (today)`;
    return `${when} (in ${days} ${days === 1 ? "day" : "days"})`;
  };

  return (
    <main className="wrap">
      <p><Link href="/">← All vehicles</Link></p>
      <header className="vhead">
        {vehicle.photoUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={vehicle.photoUrl} alt={name} className="big" />
        )}
        <div>
          <h1>{name}</h1>
          <p className="meta">
            {vehicle.type ?? "vehicle"} {vehicle.year ?? ""} {vehicle.make ?? ""} {vehicle.model ?? ""}
            {vehicle.registration ? ` · ${vehicle.registration}` : ""}
            {vehicle.vin ? ` · VIN ${vehicle.vin}` : ""}
          </p>
          <p className="meta">
            {continuity === "good" && "✅ Odometer readings run forward"}
            {continuity === "check" && "⚠️ Odometer needs a look"}
            {continuity === "unknown" && "Odometer history starts with two readings"}
          </p>
          {flags.map((f) => (
            <p key={f} className="err">{f}</p>
          ))}
          <p className="meta">
            {totalSpend > 0 && <>Logged so far: <strong>${(totalSpend / 100).toFixed(2)}</strong> across {vehicle.entries.length} {vehicle.entries.length === 1 ? "entry" : "entries"}. </>}
            {nextDue?.nextServiceDue && (
              <>Next service due {nextDue.nextServiceDue.toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" })}{nextDue.serviceType ? ` (${nextDue.serviceType.toLowerCase()})` : ""}. </>
            )}
            {!nextDue?.nextServiceDue && nextOdo?.nextServiceOdometer != null && (
              <>Next service at {nextOdo.nextServiceOdometer.toLocaleString()} km. </>
            )}
          </p>
          {(vehicle.regoExpiry || vehicle.insuranceExpiry || vehicle.insurer) && (
            <p className="meta">
              {vehicle.regoExpiry && <>Rego expires {dueTxt(vehicle.regoExpiry)}. </>}
              {vehicle.insuranceExpiry && (
                <>Insurance{vehicle.insurer ? ` (${vehicle.insurer})` : ""} expires {dueTxt(vehicle.insuranceExpiry)}. </>
              )}
              {vehicle.insurer && !vehicle.insuranceExpiry && <>Insured with {vehicle.insurer}. </>}
            </p>
          )}
          <details>
            <summary className="meta">Edit reminder dates</summary>
            <form action={updateVehicle} className="form">
              <input type="hidden" name="vehicleId" value={vehicle.id} />
              <label>Rego expires <input type="date" name="regoExpiry" defaultValue={vehicle.regoExpiry ? vehicle.regoExpiry.toISOString().slice(0, 10) : ""} /></label>
              <label>Insurer <input name="insurer" defaultValue={vehicle.insurer ?? ""} placeholder="e.g. AAMI" /></label>
              <label>Insurance expires <input type="date" name="insuranceExpiry" defaultValue={vehicle.insuranceExpiry ? vehicle.insuranceExpiry.toISOString().slice(0, 10) : ""} /></label>
              <button className="btn" type="submit">Save reminder dates</button>
            </form>
          </details>
          {vehicle.entries.length > 0 && (
            <p className="meta">
              {lastEntry && (
                <>
                  Last visit{" "}
                  {lastEntry.date.toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" })}
                  {lastEntry.odometerKm != null ? ` at ${lastEntry.odometerKm.toLocaleString()} km` : ""}
                  {lastEntry.provider ? ` at ${lastEntry.provider}` : ""}.{" "}
                </>
              )}
              {topProvider && topProvider[1] >= 2 && (
                <>
                  Serviced mostly by {topProvider[0]} ({topProvider[1]} {topProvider[1] === 1 ? "visit" : "visits"}).{" "}
                </>
              )}
              {avgKmYear != null && (
                <>
                  That pace is about {avgKmYear.toLocaleString()} km a year.{" "}
                </>
              )}
              {services.length > 0 && (
                <>
                  Services so far: {services.length} ({money(servicesCents)}).{" "}
                </>
              )}
              {repairs.length > 0 && (
                <>
                  Repairs so far: {repairs.length} ({money(repairsCents)}).{" "}
                </>
              )}
              {avgService != null && (
                <>
                  Averaging {money(avgService)} a service.{" "}
                </>
              )}
              {biggest && (
                <>
                  Biggest bill {money(biggest.costCents ?? 0)} in{" "}
                  {biggest.date.toLocaleDateString("en-AU", { month: "short", year: "numeric" })}.{" "}
                </>
              )}
              {yearSpend > 0 && (
                <>
                  This year: {money(yearSpend)} across {yearEntries.length} {yearEntries.length === 1 ? "visit" : "visits"}.
                </>
              )}
            </p>
          )}
          <p className="meta">
            Buyer view: <Link href={shareUrl}>{shareUrl}</Link> (no login needed)
          </p>
        </div>
      </header>

      <NewEntry vehicleId={vehicle.id} lastOdo={odoEntries.at(-1)?.odometerKm ?? null} />

      <section className="timeline">
        <h2>Service history</h2>
        {vehicle.entries.length === 0 && <p className="meta">Nothing logged yet. Photograph the logbook and the first entries write themselves.</p>}
        <ul>
          {[...vehicle.entries].reverse().map((e) => (
            <li key={e.id} className="entry">
              <div className="entry-date">
                {e.date.toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" })}
                {e.source === "SCAN" && <span className="badge">scanned</span>}
              </div>
              <div>
                <p className="jobs">{e.jobs}</p>
                <p className="meta">
                  {e.odometerKm != null && `${e.odometerKm.toLocaleString()} km · `}
                  {e.costCents != null && `$${(e.costCents / 100).toFixed(2)} · `}
                  {e.provider ?? ""}
                </p>
                <p className="meta">
                  {e.serviceType && <>Service: {e.serviceType}. </>}
                  {e.repairOrderNo && <>Job no. {e.repairOrderNo}. </>}
                  {e.invoiceNo && e.invoiceNo !== e.repairOrderNo && <>Invoice no. {e.invoiceNo}. </>}
                  {e.partsUsed && <>Parts: {e.partsUsed}. </>}
                  {e.warranty && <>Warranty: {e.warranty}. </>}
                  {e.adviser && <>Adviser: {e.adviser}. </>}
                </p>
                <p className="meta">
                  {e.labourCents != null && <>Labour ${(e.labourCents / 100).toFixed(2)}. </>}
                  {e.partsCents != null && <>Parts ${(e.partsCents / 100).toFixed(2)}. </>}
                  {e.gstCents != null && <>GST ${(e.gstCents / 100).toFixed(2)}. </>}
                  {e.paymentMethod && <>Paid by {e.paymentMethod}. </>}
                </p>
                {e.nextServiceDue && (
                  <p className="meta">
                    Next service due {e.nextServiceDue.toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" })}
                    {e.nextServiceOdometer != null && ` or ${e.nextServiceOdometer.toLocaleString()} km`}.
                  </p>
                )}
                {(e.lineItems as { desc?: string }[] | null)?.length ? (
                  <p className="meta">Items: {(e.lineItems as { desc?: string }[]).map((it) => it.desc).join("; ")}</p>
                ) : null}
                {e.notes && <p className="notes">{e.notes}</p>}
                {e.documents.length > 0 && (
                  <div className="strip">
                    {e.documents.map((d) => (
                      // eslint-disable-next-line @next/next/no-img-element
                      <a key={d.id} href={`/doc/${d.id}`} target="_blank" rel="noreferrer" title="View full size">
                        <img src={d.url} alt="Receipt" className="mini" />
                      </a>
                    ))}
                  </div>
                )}
                <p><Link href={`/entry/${e.id}/edit`} className="editlink">Edit this entry</Link></p>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
