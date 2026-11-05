import { eq } from "drizzle-orm";
import { getDb } from "@/server/db";
import * as t from "@/server/schema";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = await getDb();
  const [a] = await db.select().from(t.attachments).where(eq(t.attachments.id, id));
  if (!a) return new Response("Not found", { status: 404 });
  return new Response(Buffer.from(a.data, "base64"), {
    headers: { "content-type": a.mime, "content-disposition": `inline; filename="${a.name.replace(/"/g, "")}"` },
  });
}
