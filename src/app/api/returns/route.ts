import { eq } from "drizzle-orm";
import { handle } from "@/server/http";
import { getDb } from "@/server/db";
import * as t from "@/server/schema";
import { ensureBundledPacket } from "@/server/packetStore";
import { snapshotStats } from "@/server/snapshots";

export const dynamic = "force-dynamic";

/** Firm-wide status: one row per return from the persisted snapshots — no log is replayed. */
export async function GET() {
  return handle(async () => {
    const returnId = await ensureBundledPacket();
    const db = await getDb();
    const started = Date.now();
    const rows = await db.select({ s: t.returnSnapshots, client: t.clients.name, year: t.returns.taxYear })
      .from(t.returnSnapshots)
      .innerJoin(t.returns, eq(t.returns.id, t.returnSnapshots.returnId))
      .innerJoin(t.clients, eq(t.clients.id, t.returns.clientId));
    return { ms: Date.now() - started, returns: rows.map((r) => ({ ...r.s, client: r.client, year: r.year })), instance: snapshotStats(returnId) };
  });
}
