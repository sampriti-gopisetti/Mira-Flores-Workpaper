import { z } from "zod";
import type { Packet } from "./types";

// Versioned packet contract. Each supported version validates the structure the
// app depends on; `upgrade` maps older versions to the current shape so the rest
// of the app only ever sees one format. Unknown versions are rejected up front
// instead of half-loading.

const money = z.number();

const v1 = z.object({
  packet: z.object({ name: z.string(), version: z.string(), generated: z.string(), client_id: z.string() }),
  household: z.object({
    tax_year: z.number().int(),
    people: z.array(z.object({ id: z.string(), role: z.string(), name: z.string(), ssn: z.string() }).passthrough()).min(1),
  }).passthrough(),
  documents: z.array(z.object({
    id: z.string().regex(/^D\d+$/),
    title: z.string(),
    document_type: z.string(),
    issuer: z.string(),
    belongs_to: z.string(),
    tax_year: z.number(),
    received_at: z.string(),
    pages: z.array(z.object({ page: z.number().int(), printed_content: z.string() })),
    extraction: z.object({ status: z.enum(["extracted", "partial", "not_extracted"]) }).passthrough(),
  }).passthrough()),
  extracted_values: z.array(z.object({
    id: z.string().regex(/^ev-\d+$/),
    document_id: z.string(),
    page: z.number().int(),
    field: z.string(),
    value_type: z.string(),
    confidence: z.number().min(0).max(1),
  }).passthrough()),
  return_versions: z.array(z.object({
    version: z.string(),
    computed_at: z.string(),
    summary: z.object({ federal: z.object({ total_tax: money }).passthrough(), california: z.object({ total_tax: money }).passthrough() }),
    tax_effect_rates: z.record(z.object({ federal_per_dollar: z.number(), california_per_dollar: z.number() })),
    lines: z.array(z.object({ key: z.string(), form: z.string(), rule: z.string(), inputs: z.array(z.string()), sources: z.array(z.string()) }).passthrough()),
  }).passthrough()).min(1),
  firm: z.object({ staff: z.array(z.object({ id: z.string(), role: z.string() }).passthrough()) }).passthrough(),
  client: z.object({}).passthrough(),
  prior_years: z.object({}).passthrough(),
  tax_agency_records: z.object({}).passthrough(),
  timeline: z.array(z.object({ id: z.string(), at: z.string(), event: z.string() }).passthrough()),
  engine_reference: z.object({}).passthrough(),
  what_if: z.object({}).passthrough(),
}).passthrough();

const SUPPORTED: Record<string, { schema: z.ZodTypeAny; upgrade: (p: unknown) => unknown }> = {
  "1.0": { schema: v1, upgrade: (p) => p },
};

export class PacketValidationError extends Error {
  constructor(message: string, public issues: string[] = []) {
    super(message);
  }
}

export function parsePacket(raw: unknown): Packet {
  const version = (raw as { packet?: { version?: string } })?.packet?.version;
  const entry = version ? SUPPORTED[version] : undefined;
  if (!entry) throw new PacketValidationError(`Unsupported packet version: ${String(version)}`);
  const res = entry.schema.safeParse(raw);
  if (!res.success) {
    throw new PacketValidationError("Packet failed validation",
      res.error.issues.slice(0, 20).map((i) => `${i.path.join(".")}: ${i.message}`));
  }
  const packet = entry.upgrade(res.data) as Packet;
  const docIds = new Set(packet.documents.map((d) => d.id));
  const orphans = packet.extracted_values.filter((e) => !docIds.has(e.document_id)).map((e) => e.id);
  if (orphans.length) throw new PacketValidationError("Extracted values reference unknown documents", orphans.slice(0, 20));
  return packet;
}
