import Link from "next/link";
import DeleteVehicleButton from "./delete-button";
import { db } from "@/lib/db";
import { isOwner, passcodeConfigured } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function Home() {
  // When the owner has a passcode on, the list of vehicles is theirs alone:
  // the public surfaces are the buyer share links, not this page.
  if ((await passcodeConfigured()) && !(await isOwner())) {
    return (
      <main className="wrap">
        <header className="head">
          <h1>MotorLedger</h1>
          <p>Your vehicle's whole service history, built from photos.</p>
          <p className="meta"><Link href="/unlock?next=/">Unlock</Link></p>
        </header>
      </main>
    );
  }
  const vehicles = await db.vehicle.findMany({
    orderBy: { createdAt: "desc" },
    include: { entries: { orderBy: { date: "desc" }, take: 1 } },
  });

  return (
    <main className="wrap">
      <header className="head">
        <h1>MotorLedger</h1>
        <p>Your vehicle's whole service history, built from photos.</p>
        <p className="meta">
          <Link href="/settings">Settings</Link>
          {" · "}
          <Link href="/add">Add vehicle</Link>
        </p>
      </header>

      {vehicles.length === 0 ? (
        <section className="empty">
          <p>No vehicles yet.</p>
          <Link className="btn" href="/add">Add your first vehicle</Link>
        </section>
      ) : (
        <section className="grid">
          {vehicles.map((v) => {
            const last = v.entries[0];
            return (
              <div key={v.id} className="card-wrap">
              <Link className="card" href={`/vehicle/${v.id}`}>
                {v.photoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img className="thumb" src={v.photoUrl} alt={v.nickname ?? "Vehicle"} />
                ) : (
                  <div className="thumb thumb-empty">{v.type ?? "Vehicle"}</div>
                )}
                <h2>{v.nickname ?? ([v.year, v.make, v.model].filter(Boolean).join(" ") || v.registration || "Untitled vehicle")}</h2>
                <p className="meta">
                  {v.registration ? `${v.registration} · ` : ""}
                  {last ? `last entry ${last.date.toLocaleDateString("en-AU")}` : "no entries yet"}
                </p>
              </Link>
              <DeleteVehicleButton vehicleId={v.id} />
              </div>
            );
          })}
          <Link className="card card-add" href="/add">
            <span className="plus">+</span>
            <span>Add a vehicle</span>
          </Link>
        </section>
      )}
    </main>
  );
}
