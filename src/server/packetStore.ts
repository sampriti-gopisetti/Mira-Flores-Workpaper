import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { asc, desc, eq, sql } from "drizzle-orm";
import { getDb, type DB } from "./db";
import * as t from "./schema";
import { ingestPacket } from "./ingest";
import type { Doc, ExtractedValue, Line, Packet, ReturnVersion } from "@/domain/types";
import { buildIndex, type PacketIndex } from "@/domain/packetIndex";

// Packets are immutable once ingested, so an assembled packet + index can be
// cached per packet id for the life of the server instance.

interface Loaded { packetId: string; returnId: string; packet: Packet; index: PacketIndex }
const g = globalThis as unknown as { __packets?: Map<string, Promise<Loaded>>; __bootstrapped?: Promise<string> };
g.__packets ??= new Map();

/** Ingest the packet bundled with the app (as delivered). Idempotent. */
export function ensureBundledPacket(): Promise<string> {
  g.__bootstrapped ??= (async () => {
    const db = await getDb();
    const raw = await readFile(path.join(process.cwd(), "data", "packet.json"), "utf8");
    const res = await ingestPacket(db, raw);
    return res.returnId;
  })().catch((e) => { g.__bootstrapped = undefined; throw e; });
  return g.__bootstrapped;
}

async function assemble(db: DB, packetId: string, returnId: string): Promise<Loaded> {
  const [p] = await db.select().from(t.packets).where(eq(t.packets.id, packetId));
  const docRows = await db.select().from(t.documents).where(eq(t.documents.packetId, packetId)).orderBy(asc(t.documents.ord));
  const pageRows = await db.select().from(t.pages).where(eq(t.pages.packetId, packetId));
  const evRows = await db.select().from(t.extractedValues).where(eq(t.extractedValues.packetId, packetId)).orderBy(asc(t.extractedValues.ord));
  const verRows = await db.select().from(t.returnVersions).where(eq(t.returnVersions.packetId, packetId)).orderBy(asc(t.returnVersions.computedAt));
  const lineRows = await db.select().from(t.lines).where(eq(t.lines.packetId, packetId)).orderBy(asc(t.lines.ord));

  const pagesByDoc = new Map<string, { page: number; printed_content: string }[]>();
  for (const r of pageRows) {
    const arr = pagesByDoc.get(r.documentId) ?? [];
    arr.push({ page: r.page, printed_content: r.printedContent });
    pagesByDoc.set(r.documentId, arr);
  }
  const documents: Doc[] = docRows.map((r) => ({
    ...(r.meta as Omit<Doc, "pages">),
    pages: (pagesByDoc.get(r.localId) ?? []).sort((a, b) => a.page - b.page),
  }));
  const extracted_values: ExtractedValue[] = evRows.map((r) => ({
    id: r.localId, document_id: r.documentId, page: r.page, field: r.field, label: r.label,
    value: r.value as ExtractedValue["value"], value_type: r.valueType, text_as_read: r.textAsRead,
    position: r.position as ExtractedValue["position"], confidence: r.confidence,
  }));
  const linesByVersion = new Map<string, Line[]>();
  // Re-hydrate inputs/sources from the edge table so the trace graph has one source of truth.
  const edgeRows = await db.select().from(t.edges).where(eq(t.edges.packetId, packetId));
  const edgeMap = new Map<string, { inputs: string[]; sources: string[] }>();
  for (const e of edgeRows) {
    if (e.kind === "supersedes") continue;
    const k = `${e.version}|${e.fromRef}`;
    const m = edgeMap.get(k) ?? { inputs: [], sources: [] };
    (e.kind === "input" ? m.inputs : m.sources).push(e.toRef);
    edgeMap.set(k, m);
  }
  for (const r of lineRows) {
    const m = edgeMap.get(`${r.version}|${r.key}`) ?? { inputs: [], sources: [] };
    const arr = linesByVersion.get(r.version) ?? [];
    arr.push({
      key: r.key, jurisdiction: r.jurisdiction as Line["jurisdiction"], form: r.form,
      line: r.key.slice(r.form.length + 1), label: r.label, value: r.value as Line["value"], rule: r.rule,
      inputs: m.inputs, sources: m.sources, ...(r.note ? { note: r.note } : {}),
    });
    linesByVersion.set(r.version, arr);
  }
  const return_versions: ReturnVersion[] = verRows.map((r) => ({
    ...(r.meta as Omit<ReturnVersion, "lines">),
    lines: linesByVersion.get(r.version) ?? [],
  }));
  const packet = { ...(p.sections as object), documents, extracted_values, return_versions } as Packet;
  return { packetId, returnId, packet, index: buildIndex(packet) };
}

export async function loadReturn(returnId?: string): Promise<Loaded> {
  const rid = returnId ?? (await ensureBundledPacket());
  const db = await getDb();
  const [latest] = await db.select({ id: t.packets.id }).from(t.packets)
    .where(eq(t.packets.returnId, rid)).orderBy(desc(sql`coalesce(${t.packets.activatedAt}, ${t.packets.ingestedAt})`)).limit(1);
  if (!latest) throw new Error(`No packet for return ${rid}`);
  let entry = g.__packets!.get(latest.id);
  if (!entry) {
    entry = assemble(db, latest.id, rid);
    g.__packets!.set(latest.id, entry);
    entry.catch(() => g.__packets!.delete(latest.id));
  }
  return entry;
}
