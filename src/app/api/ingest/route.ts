import { readFile } from "node:fs/promises";
import path from "node:path";
import { actorIdFrom, handle } from "@/server/http";
import { AppendError, context, findActor } from "@/server/eventStore";
import { getDb } from "@/server/db";
import { ingestPacket } from "@/server/ingest";

/** Firm admin: ingest a packet (validated, all-or-nothing, idempotent by content hash). */
export async function POST(req: Request) {
  return handle(async () => {
    const ctx = await context();
    const actor = findActor(ctx.actors, actorIdFrom(req));
    if (actor?.role !== "firm_administrator") throw new AppendError(403, "Only the firm administrator ingests packets.");
    // ?bundled=rerun|original ingests a packet shipped with the app (the re-run demo);
    // otherwise the request body is the packet. An explicit ingest re-activates a known packet.
    const bundled = new URL(req.url).searchParams.get("bundled");
    const file = bundled === "rerun" ? "packet-rerun.json" : bundled === "original" ? "packet.json" : null;
    const text = file ? await readFile(path.join(process.cwd(), "data", file), "utf8") : await req.text();
    const started = Date.now();
    const res = await ingestPacket(await getDb(), text, { reactivate: true });
    return { ...res, ms: Date.now() - started };
  });
}
