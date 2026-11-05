import "server-only";
import { and, asc, eq, gt, lte, sql } from "drizzle-orm";
import type { DB } from "./db";
import * as t from "./schema";
import type { WpEvent, EventType } from "@/domain/events";
import { project, type WorkpaperState } from "@/domain/project";
import type { PacketIndex } from "@/domain/packetIndex";
import type { LotAggregates } from "@/domain/checks";

// Snapshots, two kinds:
//
// 1. In memory, per server instance: the return's log as of `seq`. A write reads only
//    the rows after `seq` (not the whole log) and reuses the computed state for the
//    log position + season clock it is checked against, so a write costs one
//    projection of the new events, not a replay per request.
// 2. Persisted (`return_snapshots`): the headline state after every write — phase,
//    totals, open issues, blockers. Firm-wide status reads these rows and never
//    replays a log, however long it gets.

type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];

interface Snap {
  packetId: string;
  seq: number;
  events: WpEvent[];
  states: Map<string, WorkpaperState>;
  stats: { incrementalReads: number; rowsRead: number; stateHits: number; stateMisses: number };
}

const g = globalThis as unknown as { __snaps?: Map<string, Snap> };
g.__snaps ??= new Map();

export function rowToEvent(r: typeof t.events.$inferSelect): WpEvent {
  return {
    seq: r.seq, id: r.id, at: r.at.toISOString(), simAt: r.simAt, actorId: r.actorId, actorRole: r.actorRole,
    type: r.type as EventType, target: r.target, anchor: r.anchor, payload: r.payload as never, batchId: r.batchId, layer: r.layer,
  };
}

function snapFor(returnId: string, packetId: string): Snap {
  let s = g.__snaps!.get(returnId);
  if (!s) {
    s = { packetId, seq: 0, events: [], states: new Map(), stats: { incrementalReads: 0, rowsRead: 0, stateHits: 0, stateMisses: 0 } };
    g.__snaps!.set(returnId, s);
  }
  if (s.packetId !== packetId) { s.packetId = packetId; s.states.clear(); } // a new packet changes every derived value
  return s;
}

/** The log for a return, reading only rows newer than the snapshot. Call inside the write lock. */
export async function syncLog(tx: Tx, returnId: string, packetId: string): Promise<{ snap: Snap; events: WpEvent[] }> {
  const s = snapFor(returnId, packetId);
  // The log only grows, except when an operator resets demo data: if it shrank, start over.
  if (s.seq > 0) {
    const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(t.events)
      .where(and(eq(t.events.returnId, returnId), lte(t.events.seq, s.seq)));
    if (n !== s.events.length) { s.seq = 0; s.events = []; s.states.clear(); }
  }
  const rows = await tx.select().from(t.events)
    .where(and(eq(t.events.returnId, returnId), gt(t.events.seq, s.seq))).orderBy(asc(t.events.seq));
  s.stats.incrementalReads++;
  s.stats.rowsRead += rows.length;
  // Not committed to the snapshot yet: the caller's transaction may still fail.
  return { snap: s, events: rows.length ? [...s.events, ...rows.map(rowToEvent)] : s.events };
}

/** Computed state for a log position + clock, reused while nothing changes. */
export function stateAt(s: Snap, events: WpEvent[], asOf: string, ix: PacketIndex, lots: LotAggregates): WorkpaperState {
  const seq = events.at(-1)?.seq ?? 0;
  const key = `${seq}|${asOf}`;
  const hit = s.states.get(key);
  if (hit) { s.stats.stateHits++; return hit; }
  s.stats.stateMisses++;
  const st = project(ix, events, { asOf, lots });
  s.states.set(key, st);
  if (s.states.size > 24) s.states.delete(s.states.keys().next().value!);
  return st;
}

/** After a commit: fold the new rows into the snapshot. */
export function commit(s: Snap, events: WpEvent[]) {
  s.events = events;
  s.seq = events.at(-1)?.seq ?? s.seq;
  for (const k of [...s.states.keys()]) if (!k.startsWith(`${s.seq}|`)) s.states.delete(k);
}

export function snapshotStats(returnId: string) {
  const s = g.__snaps!.get(returnId);
  return s ? { seq: s.seq, events: s.events.length, cachedStates: s.states.size, ...s.stats } : null;
}

/** Persist the headline state for firm-wide status. */
export async function persistSnapshot(db: DB, returnId: string, packetId: string, st: WorkpaperState) {
  const openIssues = st.checks.filter((c) => c.status === "open" && c.severity !== "info" && !c.coveredBy).length
    + st.notes.filter((n) => n.kind === "review" && !n.resolved).length;
  const row = {
    returnId, packetId, seq: st.activeEvents.reduce((m, e) => Math.max(m, e.seq), 0), asOf: st.asOf, phase: st.phase,
    totals: { federal: st.totals.federal, california: st.totals.california, estimated: st.totals.estimated },
    openIssues, blockers: st.gate.blockers, events: st.events.length, updatedAt: new Date(),
  };
  await db.insert(t.returnSnapshots).values(row).onConflictDoUpdate({ target: t.returnSnapshots.returnId, set: row });
}
