import "server-only";
import { randomUUID } from "node:crypto";
import { and, asc, eq, gt, sql } from "drizzle-orm";
import { getDb } from "./db";
import * as t from "./schema";
import { loadReturn } from "./packetStore";
import { NewEventSchema, parsePayload, MUTATING, type WpEvent, type NewEvent } from "@/domain/events";
import { commit, persistSnapshot, rowToEvent, stateAt, syncLog } from "./snapshots";
import { actorsFromPacket, type Actor } from "@/domain/actors";
import { project } from "@/domain/project";
import { can } from "@/domain/policy";
import { lotAggregates } from "@/domain/lots";
import { evAnchor } from "@/domain/anchors";
import { isMasked, sensitiveFields, unmaskFrom } from "@/domain/redact";
import type { LotAggregates } from "@/domain/checks";

export { rowToEvent };

export async function listEvents(returnId: string, since = 0): Promise<WpEvent[]> {
  const db = await getDb();
  const rows = await db.select().from(t.events)
    .where(and(eq(t.events.returnId, returnId), gt(t.events.seq, since))).orderBy(asc(t.events.seq));
  return rows.map(rowToEvent);
}

const lotsCache = new Map<string, LotAggregates>();
export async function context(returnId?: string) {
  const loaded = await loadReturn(returnId);
  let lots = lotsCache.get(loaded.packetId);
  if (!lots) { lots = lotAggregates(loaded.packet); lotsCache.set(loaded.packetId, lots); }
  const actors = actorsFromPacket(loaded.packet);
  return { ...loaded, lots, actors };
}

export function findActor(actors: Actor[], id: string | null): Actor | undefined {
  return actors.find((a) => a.id === id);
}

/** What each audience may see of the log: clients and examiners never get internal notes, view logs or time. */
export function visibleTo(actor: Actor, events: WpEvent[], all: WpEvent[] = events): WpEvent[] {
  if (!["client", "examiner"].includes(actor.role)) return events;
  const internalNotes = new Set(all.filter((e) => e.type === "note.opened" && (e.payload as { visibility?: string }).visibility !== "client")
    .map((e) => (e.payload as { noteId: string }).noteId));
  return events.filter((e) => {
    if (["sensitive.viewed", "time.logged", "standard.changed", "assignment.changed"].includes(e.type)) return false;
    if (e.type.startsWith("note.") && internalNotes.has((e.payload as { noteId: string }).noteId)) return false;
    if (e.type === "question.asked" && actor.role === "client" && (e.payload as { to: string }).to !== "client") return false;
    return true;
  });
}

export class AppendError extends Error {
  constructor(public status: number, message: string, public extra: Record<string, unknown> = {}) { super(message); }
}

/**
 * Append a batch of events atomically. Writes for one return are serialized with an
 * advisory lock; each event is checked against the rules on the state that includes
 * the events before it; a write based on stale data (someone else changed the same
 * target after `baseSeq`) is rejected with 409 so the client can refresh.
 */
export async function appendEvents(actorId: string, incoming: unknown[], baseSeq: number, returnId?: string): Promise<WpEvent[]> {
  const ctx = await context(returnId);
  const actor = findActor(ctx.actors, actorId);
  if (!actor) throw new AppendError(400, `Unknown actor ${actorId}`);
  const parsed: NewEvent[] = incoming.map((x) => {
    const r = NewEventSchema.safeParse(x);
    if (!r.success) throw new AppendError(400, `Invalid event: ${r.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`);
    return r.data;
  });
  const secrets = [...sensitiveFields(ctx.packet).entries()].filter(([k]) => !/^(page|timeline):/.test(k)).map(([, v]) => v);

  const db = await getDb();
  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${"events:" + ctx.returnId}))`);
    // Only rows newer than this instance's snapshot are read; the rest of the log is already in memory.
    const { snap, events: existing } = await syncLog(tx, ctx.returnId, ctx.packetId);

    // Idempotent retries: a batch whose ids are already stored returns the stored events.
    const known = parsed.filter((n) => existing.some((e) => e.id === n.id));
    if (known.length === parsed.length) { commit(snap, existing); return { snap, events: existing, inserted: existing.filter((e) => parsed.some((n) => n.id === e.id)), fresh: false }; }
    if (known.length) throw new AppendError(409, "Part of this batch was already recorded; reload.");

    const conflicts = existing.filter((e) => e.seq > baseSeq && e.actorId !== actor.id && MUTATING.includes(e.type)
      && parsed.some((n) => MUTATING.includes(n.type) && n.type !== "event.voided" && n.target === e.target));
    if (conflicts.length) throw new AppendError(409, `${conflicts[0].actorId} changed ${conflicts[0].target} after you loaded it.`, { conflicts });

    const working = [...existing];
    const out: WpEvent[] = [];
    let nextSeq = (existing.at(-1)?.seq ?? 0) + 1;
    for (const n of parsed) {
      let payload: Record<string, unknown>;
      try { payload = parsePayload(n.type, n.payload) as Record<string, unknown>; } catch (e) {
        throw new AppendError(400, `Invalid ${n.type} payload: ${(e as Error).message}`);
      }
      // A correction typed against a masked value (e.g. a dependent SSN) stores the real value it refers to.
      if (n.type === "adjustment.made" && isMasked(payload.to)) {
        const raw = unmaskFrom(String(payload.to), secrets);
        if (!raw) throw new AppendError(400, "Masked value could not be matched to a source record.");
        payload.to = raw;
      }
      // The first event is checked against the cached state; later events in a batch see the ones before them.
      const state = out.length === 0 ? stateAt(snap, working, n.simAt, ctx.index, ctx.lots) : project(ctx.index, working, { asOf: n.simAt, lots: ctx.lots });
      const d = can(actor, { type: n.type, target: n.target, payload }, state, ctx.index);
      if (!d.ok) throw new AppendError(403, d.reason);
      const evv = ctx.index.evs.get(n.target);
      const anchor = n.anchor ?? (evv ? evAnchor(ctx.index.docs.get(evv.document_id)!, evv) : null);
      const layer = state.filing.amendment ? state.filing.amendment.payload.layer : "original";
      const e: WpEvent = {
        seq: nextSeq++, id: n.id || randomUUID(), at: new Date().toISOString(), simAt: n.simAt, actorId: actor.id, actorRole: actor.role,
        type: n.type, target: n.target, anchor, payload: payload as never, batchId: n.batchId ?? null, layer,
      };
      working.push(e);
      out.push(e);
    }
    const inserted = await tx.insert(t.events).values(out.map((e) => ({
      id: e.id, returnId: ctx.returnId, at: new Date(e.at), simAt: e.simAt, actorId: e.actorId, actorRole: e.actorRole,
      type: e.type, target: e.target, anchor: e.anchor ?? null, payload: e.payload, batchId: e.batchId ?? null, layer: e.layer,
    }))).returning();
    const stored = inserted.map(rowToEvent);
    return { snap, events: [...existing, ...stored], inserted: stored, fresh: true };
  });
  commit(result.snap, result.events);
  if (result.fresh) {
    // Best effort: a failed status write never fails the user's action.
    const last = result.inserted.at(-1)!;
    await persistSnapshot(db, ctx.returnId, ctx.packetId, stateAt(result.snap, result.events, last.simAt, ctx.index, ctx.lots)).catch((e) => console.error("snapshot", e));
  }
  return result.inserted;
}

export async function setSeen(actorId: string, seq: number, returnId: string) {
  const db = await getDb();
  await db.insert(t.readMarks).values({ returnId, actorId, lastSeenSeq: seq })
    .onConflictDoUpdate({ target: [t.readMarks.returnId, t.readMarks.actorId], set: { lastSeenSeq: seq } });
}

export async function getSeen(actorId: string, returnId: string): Promise<number> {
  const db = await getDb();
  const [r] = await db.select().from(t.readMarks).where(and(eq(t.readMarks.returnId, returnId), eq(t.readMarks.actorId, actorId)));
  return r?.lastSeenSeq ?? 0;
}
