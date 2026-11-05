import { actorIdFrom, handle } from "@/server/http";
import { AppendError, context, findActor, setSeen } from "@/server/eventStore";

export async function POST(req: Request) {
  return handle(async () => {
    const ctx = await context();
    const actor = findActor(ctx.actors, actorIdFrom(req));
    if (!actor) throw new AppendError(400, "Unknown actor");
    const { seq } = await req.json();
    await setSeen(actor.id, Number(seq), ctx.returnId);
    return { ok: true };
  });
}
