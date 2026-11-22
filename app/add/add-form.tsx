"use client";

import { useState } from "react";
import { fileToCompressedDataUrl } from "@/lib/image";
import { scanVehiclePhoto } from "@/lib/scan";
import { createVehicle } from "@/app/actions";

const TYPES = ["car", "bike", "boat", "caravan", "other"];

export default function AddForm() {
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [pages, setPages] = useState<string[]>([]);
  const [type, setType] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [suggestion, setSuggestion] = useState<string | null>(null);

  async function takePhoto(e: React.ChangeEvent<HTMLInputElement>, target: "vehicle" | "logbook") {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setErr(null);
    try {
      const url = await fileToCompressedDataUrl(file);
      if (target === "vehicle") {
        setPhotoUrl(url);
        // Read the plate and badges off the ORIGINAL photo (not the compressed
        // one) and prefill as suggestions the user checks before saving.
        const found = await scanVehiclePhoto(file);
        const picks: string[] = [];
        if (found.rego) {
          const el = document.querySelector<HTMLInputElement>('input[name="registration"]');
          if (el && !el.value) {
            el.value = found.rego;
            picks.push(`rego ${found.rego}`);
          }
        }
        if (found.make) {
          const el = document.querySelector<HTMLInputElement>('input[name="make"]');
          if (el && !el.value) {
            el.value = found.make;
            picks.push(`make ${found.make}`);
          }
        }
        if (found.model) {
          const el = document.querySelector<HTMLInputElement>('input[name="model"]');
          if (el && !el.value) {
            el.value = found.model;
            picks.push(`model ${found.model}`);
          }
        }
        setSuggestion(
          picks.length
            ? `Read from your photo: ${picks.join(" \u00b7 ")}. Check it before saving.`
            : found.error
              ? `Photo reader problem: ${found.error}. Type the details below.`
              : "Could not read a rego or make off that photo, type the details below."
        );
      } else {
        setPages((p) => [...p, url].slice(0, 8));
      }
    } catch {
      setErr("Could not read that photo, try again.");
    }
    setBusy(false);
  }

  return (
    <main className="wrap">
      <h1>Add a vehicle</h1>
      <p className="lead">Point your camera at the vehicle first. The history builds itself from there.</p>

      <form action={createVehicle} className="form">
        <input type="hidden" name="photoUrl" value={photoUrl ?? ""} />
        {pages.map((p, i) => (
          <input key={i} type="hidden" name="logbookPages" value={p} />
        ))}

        <label className="shot">
          {photoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={photoUrl} alt="Vehicle" className="preview" />
          ) : (
            <span>📸 {photoUrl ? "Retake or upload a photo" : "Take or upload a photo of the vehicle"}</span>
          )}
          <input type="file" accept="image/*" hidden onChange={(e) => takePhoto(e, "vehicle")} />
        </label>

        <p className="lbl">What is it?</p>
        <div className="chips">
          {TYPES.map((t) => (
            <button
              type="button"
              key={t}
              className={type === t ? "chip chip-on" : "chip"}
              onClick={() => setType(t)}
            >
              {t}
            </button>
          ))}
        </div>
        <input type="hidden" name="type" value={type ?? ""} />

        <div className="row">
          <label>Year <input name="year" inputMode="numeric" placeholder="2003" /></label>
          <label>Make <input name="make" placeholder="Ford" /></label>
        </div>
        <div className="row">
          <label>Model <input name="model" placeholder="Mustang" /></label>
          <label>Rego <input name="registration" placeholder="ABC123" /></label>
        </div>
        <label>Nickname <input name="nickname" placeholder="The Mach 1" /></label>
        <label>VIN (optional) <input name="vin" /></label>

        <div className="row">
          <label>Rego expires <input type="date" name="regoExpiry" /></label>
          <label>Insurance expires <input type="date" name="insuranceExpiry" /></label>
        </div>
        <label>Insurer (optional) <input name="insurer" placeholder="e.g. AAMI" /></label>

        <label className="shot small">
          <span>📷 {pages.length ? `Add logbook page (${pages.length}/8)` : "Photograph the old logbook (optional)"}</span>
          <input type="file" accept="image/*" capture="environment" hidden onChange={(e) => takePhoto(e, "logbook")} />
        </label>
        {pages.length > 0 && (
          <div className="strip">
            {pages.map((p, i) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={i} src={p} alt={`Logbook page ${i + 1}`} className="mini" />
            ))}
          </div>
        )}

        {suggestion && <p className="meta">{suggestion}</p>}
        {err && <p className="err">{err}</p>}
        <button className="btn" type="submit" disabled={busy}>
          {busy ? "Working…" : "Save vehicle"}
        </button>
      </form>
    </main>
  );
}
