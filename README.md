# Workpaper: Okafor-Lindqvist 2025

A web-native tax workpaper built for the Miraflores case study.

- `docs/one-pager.md`: the core idea and the data model.
- `docs/errors-found.md`: the errors found and how the design surfaced them.

## Run locally

```bash
pnpm install
pnpm dev            # http://localhost:3000
pnpm test           # domain + full-season tests
```

With no `DATABASE_URL`, the app uses an embedded Postgres (PGlite) stored under `.data/`. On first request it ingests `data/packet.json` exactly as delivered. To start over, delete `.data/`.

## Deploy (Netlify + Neon)

Live: https://miraflores-workpaper-okafor.netlify.app

1. `neon link` creates the Neon project and writes `DATABASE_URL` to `.env.local`.
2. `netlify sites:create`, then `netlify env:set DATABASE_URL … --secret`.
3. `netlify deploy --build --prod` (config in `netlify.toml`).

Tables are created automatically, and the packet is ingested on the first request (idempotent). Any Next.js host works the same way, Vercel included: just set `DATABASE_URL`.

## Using it

- **Role switcher (top right):**
  - preparer Priya
  - preparer Marcus (no clearance: SSNs masked, reveal blocked)
  - reviewer Daniel
  - partner Helen
  - admin Jo
  - quality reviewer Sam
  - client Ngozi or Erik
  - IRS examiner (read-only)
- **Season clock:** replay the season. Documents, engine versions, agency records and messages appear when they arrived (v1 in March, the corrected Meridian 1099 and v2, v3 in June, then filing and the 2028 notice).
- **Clicking any number** opens the Inspector: its source document with the field highlighted, how it was built, verification, adjustments with tax effect, notes, questions and history.
- **Issues:** independent checks plus engine diagnostics. Select several, apply the suggested fixes in one batch, and undo with one click.
- **Season & filing:** transmit, receive the acknowledgment (rejected if Theo's SSN is still wrong), freeze, amend, and record agency events.
- **Notice response:** the self-contained record for the 2028 Letter 566.
- **Tour** (top bar): a 2-minute guided walkthrough for first-time users.
- **Firm admin → Pipeline re-run:** shows that human work survives a re-run of the extraction pipeline (every id renumbered).
- **Firm admin → Firm status:** read from stored snapshots, with no log replay.

Regenerate the re-run demo packet with `npx tsx scripts/make-rerun-packet.ts`.

## How AI was used

The app was built with Claude Code (Anthropic), working from the case study and the packet:
- Read and cross-checked the packet to find the planted errors; every error was confirmed against the printed document text.
- Proposed the architecture; the scaling priorities were chosen together.
- Wrote the code and tests, and drove a headless browser to verify the UI.

All tax treatments in `checks.ts` cite their authority and are meant to be reviewed by a CPA.
