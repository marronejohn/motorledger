import { notFound } from "next/navigation";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

// Login-free buyer view: one link, the whole dossier, no account anywhere.
export default async function Share({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const vehicle = await db.vehicle.findUnique({
    where: { shareToken: token },
    include: { entries: { orderBy: { date: "asc" }, include: { documents: true } } },
  });
  if (!vehicle) notFound();

  const odoEntries = vehicle.entries.filter((e) => e.odometerKm != null);
  let verified = "History is building";
  if (odoEntries.length >= 2) {
    const backwards = odoEntries.some((e, i) => i > 0 && (e.odometerKm as number) < (odoEntries[i - 1].odometerKm as number));
    verified = backwards ? "Odometer readings need a look" : "Odometer history reads clean";
  }

  const name = vehicle.nickname ?? ([vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(" ") || vehicle.registration || "Untitled vehicle");

  return (
    <main className="wrap">
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
          </p>
          <p className="meta">{verified}</p>
        </div>
      </header>

      <section className="timeline">
        <h2>Service history</h2>
        {vehicle.entries.length === 0 && <p className="meta">No entries yet.</p>}
        <ul>
          {[...vehicle.entries].reverse().map((e) => (
            <li key={e.id} className="entry">
              <div className="entry-date">
                {e.date.toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" })}
              </div>
              <div>
                <p className="jobs">{e.jobs}</p>
                <p className="meta">
                  {e.odometerKm != null && `${e.odometerKm.toLocaleString()} km · `}
                  {e.costCents != null && `$${(e.costCents / 100).toFixed(2)} · `}
                  {e.provider ?? ""}
                </p>
                {e.notes && <p className="notes">{e.notes}</p>}
                {e.documents.length > 0 && (
                  <div className="strip">
                    {e.documents.map((d) => (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img key={d.id} src={d.url} alt="Receipt" className="mini" />
                    ))}
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      </section>
      <p className="meta footer">Shared with MotorLedger. No account needed to read this.</p>
    </main>
  );
}
