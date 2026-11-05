import { actorIdFrom, handle } from "@/server/http";
import { AppendError, context, findActor, getSeen, listEvents, visibleTo } from "@/server/eventStore";
import { redactPacket } from "@/domain/redact";
import type { Packet } from "@/domain/types";

export const dynamic = "force-dynamic";

const redactedCache = new Map<string, Packet>();

/** Large lot-level detail (Brightpath's 1,820 values) stays on the server; the UI pages through /api/lots. */
function slim(p: Packet): Packet {
  const heavy = new Set(["D74"]);
  return { ...p, extracted_values: p.extracted_values.filter((e) => !heavy.has(e.document_id) || e.page === 1) };
}

export async function GET(req: Request) {
  return handle(async () => {
    const ctx = await context();
    const actor = findActor(ctx.actors, actorIdFrom(req));
    if (!actor) throw new AppendError(400, "Unknown actor");
    let packet = redactedCache.get(ctx.packetId);
    if (!packet) { packet = slim(redactPacket(ctx.packet)); redactedCache.set(ctx.packetId, packet); }
    const all = await listEvents(ctx.returnId);
    return {
      returnId: ctx.returnId, packetId: ctx.packetId, packet, lots: ctx.lots, actors: ctx.actors,
      events: visibleTo(actor, all), lastSeenSeq: await getSeen(actor.id, ctx.returnId),
    };
  });
}
