import { handle } from "@/server/http";
import { context } from "@/server/eventStore";
import { maskEv } from "@/domain/redact";

export const dynamic = "force-dynamic";

/** Fetch extracted values not shipped in the bootstrap (lot detail), redacted. */
export async function GET(req: Request) {
  return handle(async () => {
    const ctx = await context();
    const u = new URL(req.url).searchParams;
    const ids = (u.get("ids") ?? "").split(",").filter(Boolean).slice(0, 200);
    const doc = u.get("doc"), page = Number(u.get("page") ?? 0);
    const picked = doc
      ? (ctx.index.evsByDoc.get(doc) ?? []).filter((e) => !page || e.page === page).slice(0, 600)
      : ids.map((id) => ctx.index.evs.get(id)).filter(Boolean);
    return {
      evs: picked.map((e) => maskEv(e!)),
    };
  });
}
