"use client";

// Add-entry form with the scan-to-build wedge: photograph a logbook page or a
// receipt, or open a PDF of the whole service log, and the reading engine
// (browser-side OCR) proposes date, odometer, jobs and cost. PDF pages render
// in the browser. Nothing saves from a scan until the human reviews the form.
import { useRef, useState } from "react";
import { isPdfFile, scanLogFile } from "@/lib/scan";
import { addServiceEntry } from "@/app/actions";

export default function NewEntry({ vehicleId, lastOdo }: { vehicleId: string; lastOdo: number | null }) {
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [odo, setOdo] = useState("");
  const [jobs, setJobs] = useState("");
  const [cost, setCost] = useState("");
  const [provider, setProvider] = useState("");
  const [notes, setNotes] = useState("");
  const [serviceType, setServiceType] = useState("");
  const [roNo, setRoNo] = useState("");
  const [invoiceNo, setInvoiceNo] = useState("");
  const [partsUsed, setPartsUsed] = useState("");
  const [warranty, setWarranty] = useState("");
  const [adviser, setAdviser] = useState("");
  const [nextDue, setNextDue] = useState("");
  const [nextOdo, setNextOdo] = useState("");
  const [labour, setLabour] = useState("");
  const [gst, setGst] = useState("");
  const [payment, setPayment] = useState("");
  const [more, setMore] = useState(false);
  const [receipts, setReceipts] = useState<string[]>([]);
  const [source, setSource] = useState("MANUAL");
  const [scanMsg, setScanMsg] = useState<string | null>(null);
  // A scan proposes, it never overwrites: fields the human already typed keep their values.
  // useRef: a plain object here would be rebuilt on every render and the
  // typed flags would reset before the scan callback ever reads them.
  const touched = useRef({ date: false, odo: false, jobs: false }).current;
  const [scanning, setScanning] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const input = e.currentTarget;
    const file = input.files?.[0];
    input.value = ""; // so picking the same file again still fires
    if (!file) return;
    const kind = isPdfFile(file) ? "PDF" : "photo";
    setScanning(true);
    setScanMsg(kind === "PDF" ? "Opening the PDF…" : "Reading the page…");
    setErr(null);
    try {
      const res = await scanLogFile(file, (pct) =>
        setScanMsg(kind === "PDF" ? `Reading the PDF… ${pct}%` : `Reading the page… ${pct}%`)
      );
      if (res.pages.length) setReceipts((r) => [...r, ...res.pages].slice(0, 4));
      const picked = res.dates[0];
      if (picked && !touched.date) setDate(picked);
      if (res.odos.length > 0 && !touched.odo) setOdo(String(res.odos[0]));
      if (res.jobs.length > 0 && !touched.jobs)
        setJobs(res.jobs.filter((j) => !/^\d+$/.test(j))[0] ?? "");
      if (res.costs.length > 0 && !cost) setCost(res.costs[0].toFixed(2));
      const inv = res.invoice;
      if (inv.serviceType && !serviceType) setServiceType(inv.serviceType);
      if (inv.repairOrderNo && !roNo) setRoNo(inv.repairOrderNo);
      if (inv.invoiceNo && !invoiceNo) setInvoiceNo(inv.invoiceNo);
      if (inv.provider && !provider) setProvider(inv.provider);
      if (inv.adviser && !adviser) setAdviser(inv.adviser);
      if (inv.nextServiceDue && !nextDue) setNextDue(inv.nextServiceDue);
      if (inv.nextServiceOdometer && !nextOdo) setNextOdo(String(inv.nextServiceOdometer));
      if (inv.labour != null && !labour) setLabour(inv.labour.toFixed(2));
      if (inv.gst != null && !gst) setGst(inv.gst.toFixed(2));
      if (inv.items.length > 0) {
        const line = inv.items.map((it) => `${it.qty ?? ""}${it.no ? ` x ${it.no}` : ""} ${it.desc}`.trim()).join("; ");
        if (line && !partsUsed) setPartsUsed(line);
      }
      setSource("SCAN");
      const invHits = [res.invoice.serviceType, res.invoice.repairOrderNo, res.invoice.invoiceNo, res.invoice.provider, res.invoice.adviser, res.invoice.nextServiceDue, res.invoice.labour != null ? "y" : "", res.invoice.items.length ? "y" : ""].filter(Boolean).length;
      const found = picked || res.odos.length || res.costs.length || invHits;
      setScanMsg(
        found
          ? `Read from the ${kind}${res.pages.length > 1 ? ` (${res.pages.length} pages)` : ""}${invHits ? `, including ${invHits} service-invoice detail${invHits > 1 ? "s" : ""}` : ""}. Check everything before saving.`
          : `Could not read a date or amount from that ${kind}. Type it in and attach it anyway.`
      );
    } catch (e) {
      const why = e instanceof Error ? e.message : "";
      setScanMsg(null);
      setErr(why ? `Could not read that ${kind}: ${why}` : `Could not read that ${kind}.`);
    }
    setScanning(false);
  }

  if (!open) {
    return (
      <section className="newentry">
        <button className="btn" onClick={() => setOpen(true)}>+ Add a service entry</button>
      </section>
    );
  }

  return (
    <section className="newentry">
      <form action={addServiceEntry} className="form">
        <input type="hidden" name="vehicleId" value={vehicleId} />
        <input type="hidden" name="source" value={source} />
        {receipts.map((p, i) => (
          <input key={i} type="hidden" name="receiptPhotos" value={p} />
        ))}

        <div className="row">
          <label>Date <input type="date" name="date" value={date} onChange={(e) => { touched.date = true; setDate(e.target.value); }} required /></label>
          <label>Odometer (km)
            <input name="odometerKm" inputMode="numeric" value={odo} onChange={(e) => { touched.odo = true; setOdo(e.target.value); }} placeholder={lastOdo ? `last was ${lastOdo.toLocaleString()}` : "e.g. 145000"} />
          </label>
        </div>
        {odo && lastOdo != null && Number(odo) < lastOdo && (
          <p className="err">That reading is lower than the last one ({lastOdo.toLocaleString()} km). Check it.</p>
        )}
        <label>What was done <input name="jobs" value={jobs} onChange={(e) => { touched.jobs = true; setJobs(e.target.value); }} placeholder="Oil and filter, brakes" /></label>
        <div className="row">
          <label>Cost ($) <input name="cost" inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} placeholder="185.00" /></label>
          <label>Who did it <input name="provider" value={provider} onChange={(e) => setProvider(e.target.value)} placeholder="Hobart Auto Care" /></label>
        </div>
        <label>Notes <input name="notes" value={notes} onChange={(e) => setNotes(e.target.value)} /></label>

        <button className="btn btn-ghost more-toggle" type="button" onClick={() => setMore((m) => !m)}>
          {more ? "Hide service-invoice details" : "More: service type, job and invoice numbers, parts, warranty, next service, cost split"}
        </button>
        {more && (
          <>
            <div className="row">
              <label>Service type <input name="serviceType" value={serviceType} onChange={(e) => setServiceType(e.target.value)} placeholder="30,000km/36 month service" /></label>
              <label>Job / repair order no. <input name="repairOrderNo" value={roNo} onChange={(e) => setRoNo(e.target.value)} placeholder="JCS4040697" /></label>
              <label>Invoice no. <input name="invoiceNo" value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} placeholder="wb497666" /></label>
            </div>
            <div className="row">
              <label>Adviser <input name="adviser" value={adviser} onChange={(e) => setAdviser(e.target.value)} placeholder="DAN" /></label>
              <label>Paid by <input name="paymentMethod" value={payment} onChange={(e) => setPayment(e.target.value)} placeholder="Mastercard, EFTPOS, cash" /></label>
              <label>Parts used <input name="partsUsed" value={partsUsed} onChange={(e) => setPartsUsed(e.target.value)} placeholder="4 x 5W-30 oil filter kit" /></label>
              <label>Warranty <input name="warranty" value={warranty} onChange={(e) => setWarranty(e.target.value)} placeholder="under new-vehicle warranty" /></label>
            </div>
            <div className="row three">
              <label>Parts ($) <input name="parts" inputMode="decimal" placeholder="0.00" /></label>
              <label>Labour ($) <input name="labour" inputMode="decimal" value={labour} onChange={(e) => setLabour(e.target.value)} placeholder="136.36" /></label>
              <label>GST ($) <input name="gst" inputMode="decimal" value={gst} onChange={(e) => setGst(e.target.value)} placeholder="13.64" /></label>
            </div>
            <div className="row">
              <label>Next service due <input type="date" name="nextServiceDue" value={nextDue} onChange={(e) => setNextDue(e.target.value)} /></label>
              <label>Next service at (km) <input name="nextServiceOdometer" inputMode="numeric" value={nextOdo} onChange={(e) => setNextOdo(e.target.value)} placeholder="40000" /></label>
            </div>
          </>
        )}

        <div className="row">
          <label className="shot small">
            <span>📋 {scanning ? (scanMsg ?? "Reading…") : "Scan a logbook page"}</span>
            <input type="file" accept="image/*,.pdf,application/pdf" hidden onChange={onFile} disabled={scanning} />
          </label>
          <label className="shot small">
            <span>🧾 {receipts.length ? `Receipts (${receipts.length}/4)` : "Receipt photo / PDF"}</span>
            <input type="file" accept="image/*,.pdf,application/pdf" hidden onChange={onFile} disabled={scanning} />
          </label>
        </div>
        {source === "SCAN" && scanMsg && <p className="meta">{scanMsg}</p>}
        {receipts.length > 0 && (
          <div className="strip">
            {receipts.map((p, i) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={i} src={p} alt={`Receipt ${i + 1}`} className="mini" />
            ))}
          </div>
        )}
        {err && <p className="err">{err}</p>}
        <div className="row">
          <button className="btn" type="submit">Save entry</button>
          <button className="btn btn-ghost" type="button" onClick={() => setOpen(false)}>Cancel</button>
        </div>
      </form>
    </section>
  );
}
