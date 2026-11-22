"use client";

// Edit a past service entry: every field the create form has, prefilled, plus
// the attachments that entry already carries (viewable in a new tab, removable
// one at a time) and an input to attach more.
import { useState } from "react";
import { updateServiceEntry, deleteDocument, deleteServiceEntry } from "@/app/actions";
import { fileToCompressedDataUrl } from "@/lib/image";

export type EditEntryProps = {
  entryId: string;
  vehicleId: string;
  vehicleName: string;
  initial: {
    date: string;
    odometerKm: string;
    jobs: string;
    cost: string;
    provider: string;
    notes: string;
    serviceType: string;
    repairOrderNo: string;
    invoiceNo: string;
    partsUsed: string;
    warranty: string;
    adviser: string;
    nextServiceDue: string;
    nextServiceOdometer: string;
    labour: string;
    parts: string;
    gst: string;
    paymentMethod: string;
  };
  documents: { id: string; url: string; created: string }[];
};

const money = (c: number | null) => (c == null ? "" : (c / 100).toFixed(2));

export default function EditEntry(props: EditEntryProps) {
  const { initial } = props;
  const [docs, setDocs] = useState(props.documents);
  const [newPics, setNewPics] = useState<string[]>([]);
  const [adding, setAdding] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const input = e.currentTarget;
    const files = input.files;
    input.value = ""; // so picking the same file again still fires
    if (!files || files.length === 0) return;
    setAdding(true);
    setErr(null);
    try {
      const urls: string[] = [];
      for (const f of Array.from(files).slice(0, 4)) {
        if (f.type === "application/pdf" || /\.pdf$/i.test(f.name)) {
          throw new Error("PDFs attach through the add-entry scan; photos attach here.");
        }
        urls.push(await fileToCompressedDataUrl(f));
      }
      setNewPics((p) => [...p, ...urls].slice(0, 8));
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Could not attach that file.");
    }
    setAdding(false);
  }

  return (
    <section className="newentry">
      <h2>Edit entry · {props.vehicleName}</h2>
      <form action={updateServiceEntry} className="form">
        <input type="hidden" name="entryId" value={props.entryId} />
        <input type="hidden" name="vehicleId" value={props.vehicleId} />
        {newPics.map((p, i) => (
          <input key={`n${i}`} type="hidden" name="receiptPhotos" value={p} />
        ))}
        <div className="row">
          <label>Date <input type="date" name="date" defaultValue={initial.date} required /></label>
          <label>Odometer (km) <input name="odometerKm" inputMode="numeric" defaultValue={initial.odometerKm} /></label>
        </div>
        <label>What was done <input name="jobs" defaultValue={initial.jobs} /></label>
        <div className="row">
          <label>Cost ($) <input name="cost" inputMode="decimal" defaultValue={initial.cost} /></label>
          <label>Who did it <input name="provider" defaultValue={initial.provider} /></label>
        </div>
        <label>Notes <input name="notes" defaultValue={initial.notes} /></label>
        <div className="row">
          <label>Service type <input name="serviceType" defaultValue={initial.serviceType} placeholder="30,000km/36 month service" /></label>
          <label>Job / repair order no. <input name="repairOrderNo" defaultValue={initial.repairOrderNo} /></label>
          <label>Invoice no. <input name="invoiceNo" defaultValue={initial.invoiceNo} placeholder="wb497666" /></label>
        </div>
        <div className="row">
          <label>Adviser <input name="adviser" defaultValue={initial.adviser} /></label>
          <label>Paid by <input name="paymentMethod" defaultValue={initial.paymentMethod} placeholder="Mastercard, EFTPOS, cash" /></label>
          <label>Parts used <input name="partsUsed" defaultValue={initial.partsUsed} placeholder="4 x 5W-30 oil filter kit" /></label>
          <label>Warranty <input name="warranty" defaultValue={initial.warranty} placeholder="under new-vehicle warranty" /></label>
        </div>
        <div className="row three">
          <label>Parts ($) <input name="parts" inputMode="decimal" defaultValue={initial.parts} /></label>
          <label>Labour ($) <input name="labour" inputMode="decimal" defaultValue={initial.labour} /></label>
          <label>GST ($) <input name="gst" inputMode="decimal" defaultValue={initial.gst} /></label>
        </div>
        <div className="row">
          <label>Next service due <input type="date" name="nextServiceDue" defaultValue={initial.nextServiceDue} /></label>
          <label>Next service at (km) <input name="nextServiceOdometer" inputMode="numeric" defaultValue={initial.nextServiceOdometer} /></label>
        </div>

        <div className="row">
          <label className="shot small">
            <span>🧾 {adding ? "Reading…" : "Attach a receipt photo"}</span>
            <input type="file" accept="image/*" hidden onChange={onFile} disabled={adding} />
          </label>
        </div>
        {newPics.length > 0 && (
          <div className="strip">
            {newPics.map((p, i) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={`np${i}`} src={p} alt={`New attachment ${i + 1}`} className="mini" />
            ))}
          </div>
        )}
        {err && <p className="err">{err}</p>}
        <div className="row">
          <button className="btn" type="submit">Save changes</button>
          <a className="btn btn-ghost" href={`/vehicle/${props.vehicleId}`}>Cancel</a>
        </div>
      </form>
        {docs.length > 0 && (
          <div className="strip">
            {docs.map((d) => (
              <span key={d.id} className="doc-wrap">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <a href={`/doc/${d.id}`} target="_blank" rel="noreferrer">
                  <img src={d.url} alt="Attachment" className="mini" />
                </a>
                <form action={deleteDocument} className="doc-del">
                  <input type="hidden" name="documentId" value={d.id} />
                  <input type="hidden" name="vehicleId" value={props.vehicleId} />
                  <input type="hidden" name="entryId" value={props.entryId} />
                  <input type="hidden" name="back" value="edit" />
                  <button type="submit" className="del" title="Remove attachment">✕</button>
                </form>
              </span>
            ))}
          </div>
        )}
      <form
        action={deleteServiceEntry}
        onSubmit={(e) => {
          if (!confirm("Delete this entry and its attachments? This cannot be undone.")) e.preventDefault();
        }}
      >
        <input type="hidden" name="entryId" value={props.entryId} />
        <input type="hidden" name="vehicleId" value={props.vehicleId} />
        <button type="submit" className="del">Delete this entry</button>
      </form>
    </section>
  );
}
