import { actorIdFrom, handle } from "@/server/http";
import { AppendError, appendEvents, context, findActor, listEvents, visibleTo } from "@/server/eventStore";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return handle(async () => {
    const ctx = await context();
    const actor = findActor(ctx.actors, actorIdFrom(req));
    if (!actor) throw new AppendError(400, "Unknown actor");
    const since = Number(new URL(req.url).searchParams.get("since") ?? 0);
    const all = await listEvents(ctx.returnId);
    return { events: visibleTo(actor, all.filter((e) => e.seq > since), all) };
  });
}

export async function POST(req: Request) {
  return handle(async () => {
    const body = await req.json();
    const actorId = actorIdFrom(req) ?? body.actorId;
    const events = await appendEvents(actorId, body.events ?? [], Number(body.baseSeq ?? 0));
    return { events };
  });
}
