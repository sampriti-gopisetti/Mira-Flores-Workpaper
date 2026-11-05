import { randomUUID } from "node:crypto";
import { actorIdFrom, handle } from "@/server/http";
import { AppendError, appendEvents, context } from "@/server/eventStore";
import { sensitiveFields } from "@/domain/redact";

/** Reveal one sensitive value. The view is logged first (as an event); no log, no value. */
export async function POST(req: Request) {
  return handle(async () => {
    const ctx = await context();
    const { field, purpose, simAt } = await req.json();
    const raw = sensitiveFields(ctx.packet).get(String(field));
    if (raw == null) throw new AppendError(404, "No such sensitive field");
    await appendEvents(actorIdFrom(req) ?? "", [{
      id: randomUUID(), type: "sensitive.viewed", target: String(field), payload: { field: String(field), purpose: String(purpose ?? "") }, simAt,
    }], Number.MAX_SAFE_INTEGER);
    return { value: raw };
  });
}
