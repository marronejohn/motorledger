# MotorLedger

Your vehicle's whole service history, built from photos. Any vehicle: car, bike,
boat, caravan. Free to run, free to use.

- **Photo-first onboarding.** Point the camera at the vehicle (or its plate or
  rego papers). The app proposes type, make, model and registration; you confirm
  on one screen. No forms on the primary path.
- **Scan-to-build.** Photograph the old paper logbook and receipts once. An
  on-device reading proposes structured entries; every one is human-confirmed
  before it saves, and keeps its source photo beside the transcribed line.
- **Handover transfer.** At sale, one link hands the dossier to the buyer. The
  new owner inherits the history and keeps it going.
- **Login-free buyer view.** The share link reads beautifully without an account.
- **Odometer continuity.** Backwards readings and suspicious gaps are flagged
  quietly, feeding a "history verified" trust line on the dossier.

Same shape as a paper logbook, forever: date, reading, jobs, cost, provider,
receipt photo. Works the same for a Mustang, a motorbike, a tinnie or a caravan.

## Stack

Next.js + free hosting tier, free Postgres (Neon-class), better-auth (structured
to later share one life-paperwork account with YouSignNow), blob storage for
compressed photos, on-device text reading (WASM) so the server never pays for OCR.

## Developing

    cp .env.example .env   # fill in
    npm install
    npx prisma migrate dev
    npm run dev

MIT licensed.
