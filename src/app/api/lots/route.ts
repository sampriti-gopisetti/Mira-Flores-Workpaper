import { handle } from "@/server/http";
import { context } from "@/server/eventStore";
import { lotsForDoc, type Lot } from "@/domain/lots";

export const dynamic = "force-dynamic";
const cache = new Map<string, Lot[]>();

/** Paged, filtered, sorted lot detail for one broker document — the browser never holds all of it. */
export async function GET(req: Request) {
  return handle(async () => {
    const ctx = await context();
    const u = new URL(req.url).searchParams;
    const doc = u.get("doc") ?? "D74";
    const key = `${ctx.packetId}:${doc}`;
    let lots = cache.get(key);
    if (!lots) { lots = lotsForDoc(ctx.packet.extracted_values, doc); cache.set(key, lots); }
    const q = (u.get("q") ?? "").toLowerCase();
    const term = u.get("term");
    const only = u.get("only");
    let rows = lots.filter((l) => (!q || l.description.toLowerCase().includes(q) || l.lot.toLowerCase() === q)
      && (!term || l.term === term) && (only !== "wash" || l.wash > 0) && (only !== "loss" || l.gain < 0));
    const sort = u.get("sort") ?? "sold";
    const dir = u.get("dir") === "desc" ? -1 : 1;
    rows = [...rows].sort((a, b) => {
      const av = a[sort as keyof Lot], bv = b[sort as keyof Lot];
      return (typeof av === "number" ? (av as number) - (bv as number) : String(av).localeCompare(String(bv))) * dir;
    });
    const offset = Number(u.get("offset") ?? 0), limit = Math.min(500, Number(u.get("limit") ?? 200));
    const totals = rows.reduce((acc, l) => ({ proceeds: acc.proceeds + l.proceeds, basis: acc.basis + l.basis, wash: acc.wash + l.wash, gain: acc.gain + l.gain }), { proceeds: 0, basis: 0, wash: 0, gain: 0 });
    return { total: rows.length, totals, rows: rows.slice(offset, offset + limit) };
  });
}
