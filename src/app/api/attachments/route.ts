import { randomUUID } from "node:crypto";
import { actorIdFrom, handle } from "@/server/http";
import { AppendError, context, findActor } from "@/server/eventStore";
import { getDb } from "@/server/db";
import * as t from "@/server/schema";

const MAX = 4 * 1024 * 1024;

/** Store an uploaded file; the caller then records an attachment.added / question.answered event that cites it. */
export async function POST(req: Request) {
  return handle(async () => {
    const ctx = await context();
    const actor = findActor(ctx.actors, actorIdFrom(req));
    if (!actor || actor.role === "examiner") throw new AppendError(403, "Not allowed to upload");
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new AppendError(400, "No file");
    if (file.size > MAX) throw new AppendError(413, "File too large (4 MB limit in this prototype)");
    const id = randomUUID();
    const data = Buffer.from(await file.arrayBuffer()).toString("base64");
    const db = await getDb();
    await db.insert(t.attachments).values({ id, returnId: ctx.returnId, name: file.name, mime: file.type || "application/octet-stream", size: file.size, data, createdAt: new Date() });
    return { id, name: file.name, size: file.size, mime: file.type };
  });
}
