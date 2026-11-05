# Design notes (detailed companion to the one-pager)

## The idea: every number is a claim with a case file

A workpaper exists to prove the return. So the unit of the design is not a schedule or a cell; it is a **claim**: "line 26 is 12,000". Click any number anywhere in the app and the **Inspector** opens its case file:

- the engine value and the workpaper value
- how it was built: the input tree and the rule
- the exact field on the source document it came from, highlighted
- how it was verified, and by whom
- what changed, who changed it, why, and the tax effect
- the open notes and questions on it
- the independent checks that test it

Everything else is a view over these claims:
- the **Issues inbox**, area workspaces, the document index and the season timeline
- the client portal and the examination record

Nothing is a spreadsheet, and nothing is overwritten.

**The engine is tested, not trusted.** About 25 independent checks recompute figures from documents, agency records and client answers, then compare them with the engine. They catch what the pipeline got confidently wrong (see `errors-found.md`). Each suggestion comes with a priced fix, applied in one click with undo. Checks that *pass* are kept too, as evidence that the reconciliation was done.

## The data model: immutable packet + append-only event log → projection

```
packet (ingested once, never modified)      events (append-only; undo is an event)
  documents, pages, extracted_values          verification.recorded   adjustment.made
  return_versions, lines, edges (trace graph) note.*  question.*      judgment.recorded
  prior years, agency records, firm           signoff.given (with area hash)
                    \                          return.submitted (snapshot)  efile.result
                     \                        sensitive.viewed  time.logged  standard.changed
                      ▼                        /
            project(packet, events, asOf)  ── pure function, runs on server (to enforce) and in the browser (to render)
                      │
   line values (engine → election → adjustments → propagated sums), tax effects, verification status,
   sign-off validity, checks, completeness, variances, filing gate, phase
```

- **Ingestion.** Ingestion runs once per packet:
  - The packet is validated against a versioned schema.
  - It is normalized into Postgres tables (`documents`, `pages`, `extracted_values`, `return_versions`, `lines`, `edges`).
  - The write is one transaction.
  - It is idempotent by content hash, and serialized per return with an advisory lock.

  Packet-local ids (`ev-0016`) are unique only within their packet. Every row carries `packet_id → return → client → firm`.
- **Events** are the only thing people create. One mechanism gives:
  - **Undo:** an `event.voided` event; undoing the undo restores the change.
  - **History** and audit.
  - **"What changed since I last looked":** a read mark per person.
  - **Freeze at filing:** after acceptance, the original layer takes no more changes.
  - **Amend on top:** changes go on an amendment layer while the filed snapshot stays intact.
  - **View logs:** an unmask is an event, written *before* the value is returned.
- **Sign-offs reopen themselves.** A sign-off stores a fingerprint of its area: line values, adjustments, judgments and engine version. If the fingerprint no longer matches, the sign-off shows as reopened, with the reasons.
- **Re-anchoring.** Every action on an extracted value stores a meaning-based anchor (document fingerprint + field) as well as its id, plus the value it was based on.
  - A verification goes **stale** when the value changes: a new engine version, an adjustment, or a corrected document.
  - When D31 supersedes D30, a verification **carries over** to the matching field if the value is unchanged; otherwise it asks to be redone.
  - When the pipeline **re-runs** and renumbers every value (`ev-0016` becomes `ev-2997`), work is re-attached by anchor and the value re-checked. Work whose value no longer exists becomes an issue, never a silent mismatch.
  - Demo: Firm admin → *Pipeline re-run*. It ingests a re-run packet with all 3,012 ids renumbered and one field re-read, and reports what was carried, what needs re-verifying and what was orphaned. *Restore original* switches back.
- **Tax effect without re-running the engine.** An adjustment is priced as Δ × the version's per-dollar rate; payments and credits move 1:1.
  - Changes flow up through linear sums (each sum's signs are solved from the engine's own numbers). They stop at non-linear rules, which are flagged "engine recompute needed".
  - Elections swap in the engine's own what-if numbers.
- **Rules live in one place.** `can(actor, event, state)` implements the firm's standards:
  - no self-review; partner approval over $1,000
  - an authority on every judgment; open review notes block filing
  - masking without clearance; nothing changes after filing

  The server enforces it, and the UI uses the same function to disable buttons and say why.
- **Documents sit behind a renderer interface.** The prototype renders each page from `printed_content` and highlights `text_as_read`. Where the value isn't printed verbatim, it falls back to the synthetic position box. A PDF renderer would use the same `doc + page + ev` links.

## Tradeoffs (prototype vs. scale)

| Built now | At scale |
|---|---|
| Ingest once; packet cached in memory per server instance (immutable). A re-sent packet is a no-op; an explicit re-send makes it current again | Same tables, with packets streamed in by a queue of workers |
| **Snapshots**: each server instance keeps the return's log and reads only rows after its last position on each write; computed state is reused per (log position, clock). After every write the headline state is stored in `return_snapshots`, and firm status reads those rows without replaying any log | Fold events incrementally into a persisted state as well, so a cold instance starts from the latest snapshot instead of the first event |
| Polling every 3 s; optimistic concurrency (409 on a stale write to the same target) | Server push (SSE / LISTEN-NOTIFY) |
| Regex + value-based masking on the server; unmask logged | Field-level encryption; per-return keys destroyed after 7 years (crypto-shredding keeps the log append-only) |
| Lot detail paged from the server (1,826 Brightpath values never shipped to the browser) | Same, with SQL aggregation |
| Role switcher, no passwords (rules are still enforced on the server) | Real auth + row-level security by firm |
| Tax effects estimated with per-dollar rates | Re-run the engine on the workpaper layer |
