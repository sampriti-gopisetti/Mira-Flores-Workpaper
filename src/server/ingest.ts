import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { sql, eq } from "drizzle-orm";
import type { DB } from "./db";
import * as t from "./schema";
import { parsePacket } from "@/domain/packetSchema";
import { docFingerprint, evAnchor } from "@/domain/anchors";

export const FIRM_ID = "miraflores";

export interface IngestResult {
  status: "ingested" | "duplicate" | "reactivated";
  returnId: string;
  packetId: string;
  counts?: Record<string, number>;
}

function chunks<T>(rows: T[], size = 400): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

/**
 * Ingest one packet: validate -> normalize -> store, all-or-nothing.
 * - Idempotent: the packet's content hash is unique, so re-sending it is a no-op.
 * - Packets for the same return are serialized with a transaction-scoped advisory
 *   lock; packets for different returns ingest in parallel.
 */
export async function ingestPacket(db: DB, rawText: string, opts: { reactivate?: boolean } = {}): Promise<IngestResult> {
  const packetHash = createHash("sha256").update(rawText).digest("hex");
  const packet = parsePacket(JSON.parse(rawText));
  const clientId = packet.packet.client_id;
  const taxYear = packet.household.tax_year;
  const returnId = `${clientId}-${taxYear}`;

  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${returnId}))`);

    const existing = await tx.select({ id: t.packets.id }).from(t.packets).where(eq(t.packets.packetHash, packetHash));
    if (existing.length) {
      // Same content: never stored twice. An explicit re-send makes it the return's current packet again.
      if (opts.reactivate) {
        await tx.update(t.packets).set({ activatedAt: new Date() }).where(eq(t.packets.id, existing[0].id));
        return { status: "reactivated" as const, returnId, packetId: existing[0].id };
      }
      return { status: "duplicate" as const, returnId, packetId: existing[0].id };
    }

    const packetId = randomUUID();
    const owner = packet.household.people.filter((p) => p.role !== "dependent").map((p) => p.name).join(" & ");

    await tx.insert(t.firms).values({ id: FIRM_ID, name: packet.firm.name }).onConflictDoNothing();
    await tx.insert(t.clients).values({ id: clientId, firmId: FIRM_ID, name: owner }).onConflictDoNothing();
    await tx.insert(t.returns).values({ id: returnId, clientId, taxYear }).onConflictDoNothing();

    const { documents, extracted_values, return_versions, ...rest } = packet;
    await tx.insert(t.packets).values({
      id: packetId, returnId, packetHash, schemaVersion: packet.packet.version,
      generated: packet.packet.generated, ingestedAt: new Date(), activatedAt: new Date(), sections: rest,
    });

    const docRows = documents.map((d, ord) => {
      const { pages: _pages, ...meta } = d;
      return { packetId, localId: d.id, fingerprint: docFingerprint(d), ord, meta };
    });
    const pageRows = documents.flatMap((d) =>
      d.pages.map((p) => ({ packetId, documentId: d.id, page: p.page, printedContent: p.printed_content })));
    const docById = new Map(documents.map((d) => [d.id, d]));
    const evRows = extracted_values.map((e, ord) => ({
      packetId, localId: e.id, documentId: e.document_id, page: e.page, field: e.field,
      anchor: evAnchor(docById.get(e.document_id)!, e), label: e.label, value: e.value,
      valueType: e.value_type, textAsRead: e.text_as_read, position: e.position, confidence: e.confidence, ord,
    }));
    const versionRows = return_versions.map((v) => {
      const { lines: _lines, ...meta } = v;
      return { packetId, version: v.version, computedAt: v.computed_at, meta };
    });
    const lineRows = return_versions.flatMap((v) => v.lines.map((l, ord) => ({
      packetId, version: v.version, key: l.key, form: l.form, jurisdiction: l.jurisdiction,
      label: l.label, value: l.value, rule: l.rule, note: l.note ?? null, ord,
    })));
    const edgeRows = return_versions.flatMap((v) => [
      ...v.lines.flatMap((l) => l.sources.map((s) => ({ packetId, version: v.version, fromRef: l.key, toRef: s, kind: "source" }))),
      ...v.lines.flatMap((l) => l.inputs.map((s) => ({ packetId, version: v.version, fromRef: l.key, toRef: s, kind: "input" }))),
      ...v.documents_superseded.map((old) => ({
        packetId, version: v.version, fromRef: supersededBy(documents, old) ?? "", toRef: old, kind: "supersedes",
      })),
    ]);

    for (const c of chunks(docRows)) await tx.insert(t.documents).values(c);
    for (const c of chunks(pageRows)) await tx.insert(t.pages).values(c);
    for (const c of chunks(evRows)) await tx.insert(t.extractedValues).values(c);
    for (const c of chunks(versionRows)) await tx.insert(t.returnVersions).values(c);
    for (const c of chunks(lineRows)) await tx.insert(t.lines).values(c);
    for (const c of chunks(edgeRows)) await tx.insert(t.edges).values(c);

    return {
      status: "ingested" as const, returnId, packetId,
      counts: { documents: docRows.length, pages: pageRows.length, extracted_values: evRows.length, lines: lineRows.length, edges: edgeRows.length },
    };
  });
}

function supersededBy(documents: { id: string; marked_corrected?: boolean; issuer: string; document_type: string; belongs_to: string }[], oldId: string) {
  const old = documents.find((d) => d.id === oldId);
  if (!old) return undefined;
  return documents.find((d) => d.id !== oldId && d.marked_corrected && d.issuer === old.issuer &&
    d.document_type === old.document_type && d.belongs_to === old.belongs_to)?.id;
}
