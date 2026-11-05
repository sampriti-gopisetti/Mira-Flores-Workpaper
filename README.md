# Miraflores Workpaper

A web-native tax workpaper for one complex household's 2025 return (the invented Okafor-Lindqvist family, federal 1040 and California 540NR), built for the Miraflores *Redesign the Tax Workpaper* case study.

It proves the return: where every number came from, what was done to it, who checked it, and what is still open. It serves preparers, reviewers, partners, the client, the firm administrator and an IRS examiner.

**Live app:** https://miraflores-workpaper-okafor.netlify.app · **Walkthrough video:** [Google Drive](https://drive.google.com/file/d/1qMb3L_GRZx5AiRfim7UbqZrDQUnGBN8C/view?usp=drive_link)

**Documents:**
- [One-pager: core idea & data model](docs/one-pager.pdf)
- [Errors found and how they surfaced](docs/errors-found.pdf)
- [Design notes](docs/design-notes.md)

> New here? Open the app and click **Tour** in the top bar for a 3-minute click-along walkthrough.

---

## Core idea

**Every number is a claim with its own case file.** Click any number and the Inspector shows:
- the engine value next to the workpaper value
- how it was built, and the exact field on the source document it came from
- how it was verified and by whom
- every change, with who, why and the tax effect
- the notes, questions and checks on it

**The engine is tested, not trusted.** About 25 independent checks recompute figures from the printed documents, IRS/FTB records, client answers and the prior year, then compare them with the engine. They surfaced 21 errors in the packet, including RSU sales reported with $0 basis (about $47,600 of gain taxed twice) and card income counted twice on Schedule C.

## Architecture

```
client packet (ingested once, never changed)  +  events (append-only; undo is an event too)
                          └──────────►  project(packet, events, as-of date)  ◄──────────┘
                 pure TypeScript: the server runs it to enforce rules, the browser to render
```

| Decision | Why |
|---|---|
| **Immutable packet + append-only event log** | A workpaper is evidence. Undo, history, "changed since I last looked", freeze at filing, amendments and audit all come from one mechanism |
| **Ingest once into normalized Postgres** | Versioned schema validation, one transaction, idempotent by content hash, serialized per return; indexed tracing in both directions |
| **One rule book (`can()`) on server and client** | The firm's standards (no self-review, partner approval over $1,000, open review notes block filing…) are enforced on the server and explained in the UI |
| **Sign-offs store an area fingerprint** | Any later change reopens them automatically |
| **Anchors, not ids** | Work is tied to document + field, so it survives corrected documents and pipeline re-runs that renumber every value |
| **Server-side masking + view log** | SSNs, bank numbers and IP PINs never reach a browser unmasked; every reveal is logged first |
| **Snapshots** | Writes read only new log rows; firm status reads stored headline state without replaying any log |

Tradeoffs and the path to scale are in the [one-pager](docs/one-pager.pdf) and the [design notes](docs/design-notes.md).

## Tech stack

- **Next.js 15** (App Router) + **TypeScript**: one codebase, so the server and the browser share the domain code
- **PostgreSQL** on **Neon** via **Drizzle ORM**; embedded **PGlite** for local development without a database
- **Tailwind CSS**, **TanStack Virtual** (large lot tables), **Zod** (packet and event validation)
- **Vitest**: domain, policy, re-anchoring and full-season lifecycle tests
- Deployed on **Netlify**

## Getting started

Requires Node 20+ and pnpm.

```bash
pnpm install
pnpm dev          # http://localhost:3000
```

Without `DATABASE_URL`, the app uses an embedded Postgres stored in `.data/`. On the first request it ingests `data/packet.json` exactly as delivered. Delete `.data/` to start over.

To use a real database, set `DATABASE_URL` (e.g. a Neon connection string) in `.env.local`. Tables are created automatically.

| Command | Purpose |
|---|---|
| `pnpm dev` | Development server |
| `pnpm build` / `pnpm start` | Production build / serve |
| `pnpm test` | Run the test suite |
| `pnpm typecheck` | TypeScript check |
| `pnpm lint` | ESLint |
| `pnpm rerun-packet` | Regenerate `data/packet-rerun.json` (the pipeline re-run demo packet) |

## Project structure

```
data/                 client packet (as delivered) + generated re-run demo packet
docs/                 one-pager, errors found, design notes
scripts/              re-run packet generator
src/
  domain/             pure logic shared by server and browser
    packetSchema.ts   versioned packet validation
    packetIndex.ts    indexes, trace graph, "where it landed"
    project.ts        projection: packet + events → workpaper state
    checks.ts         independent checks
    policy.ts         the firm's rules (can)
    taxEffect.ts      pricing changes with the engine's per-dollar rates
    redact.ts         sensitive-data masking
    __tests__/        tests
  server/             database schema, ingestion, event store, snapshots
  app/                pages and API routes
  components/         Inspector, document viewer, issue cards, guided tour, UI kit
  client/             browser state, live polling, undo
```

## Using the app

- **Role switcher** (top right): preparer, preparer without clearance, reviewer, partner, firm admin, quality reviewer, client, IRS examiner.
- **Season clock**: replay the 2026 season by date, from documents arriving through e-file rejection to the 2028 examination letter.
- **Firm admin → Pipeline re-run**: shows human work surviving a re-run that renumbers all 3,012 extracted values.

## How AI was used

Built with Claude Code (Anthropic) as the engineer. I set the requirements, chose the architecture's scaling priorities (including re-anchoring work across pipeline re-runs), and verified every error it found against the printed document text. All tax treatments in `checks.ts` cite their authority and are intended for CPA review.

## Note on data

All people, companies, numbers, SSNs (the 666 prefix is never issued) and accounts in the packet are fictional.
