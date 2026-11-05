import type { Doc, ExtractedValue, Line, Packet, ReturnVersion } from "./types";
import { docFingerprint } from "./anchors";

export interface VersionIndex {
  version: ReturnVersion;
  lines: Map<string, Line>;
  /** ref (ev id, py:/..., qa-..) -> line keys that cite it as a source */
  citedBy: Map<string, string[]>;
  /** line key -> line keys that use it as an input */
  usedBy: Map<string, string[]>;
  /** document id -> line keys that cite any of its values */
  linesByDoc: Map<string, string[]>;
}

export type DocUse =
  | { kind: "used"; lines: string[] }
  | { kind: "superseded"; by: string }
  | { kind: "duplicate"; of: string; lines: string[] }
  | { kind: "not_extracted"; reason: string }
  | { kind: "supporting" }
  | { kind: "not_used" };

export interface PacketIndex {
  packet: Packet;
  docs: Map<string, Doc>;
  evs: Map<string, ExtractedValue>;
  evsByDoc: Map<string, ExtractedValue[]>;
  evByDocField: Map<string, ExtractedValue>;
  versions: Map<string, VersionIndex>;
  versionOrder: string[];
  supersededBy: Map<string, string>;
  duplicateOf: Map<string, string>;
  qa: Map<string, Packet["client"]["questionnaire"][number]>;
  msgs: Map<string, Packet["client"]["messages"][number]>;
  calls: Map<string, Packet["client"]["call_notes"][number]>;
  staff: Map<string, Packet["firm"]["staff"][number]>;
}

function push<K, V>(m: Map<K, V[]>, k: K, v: V) {
  const a = m.get(k);
  if (a) { if (!a.includes(v)) a.push(v); } else m.set(k, [v]);
}

export function buildIndex(packet: Packet): PacketIndex {
  const docs = new Map(packet.documents.map((d) => [d.id, d]));
  const evs = new Map(packet.extracted_values.map((e) => [e.id, e]));
  const evsByDoc = new Map<string, ExtractedValue[]>();
  const evByDocField = new Map<string, ExtractedValue>();
  for (const e of packet.extracted_values) {
    push(evsByDoc, e.document_id, e);
    evByDocField.set(`${e.document_id}#${e.field}`, e);
  }

  // A corrected document supersedes the earlier one from the same issuer.
  const supersededBy = new Map<string, string>();
  for (const v of packet.return_versions) {
    for (const old of v.documents_superseded) {
      const o = docs.get(old);
      const successor = packet.documents.find((d) => d.id !== old && d.marked_corrected && o && docFingerprint(d) === docFingerprint(o));
      if (successor) supersededBy.set(old, successor.id);
    }
  }
  // Same document uploaded twice (same fingerprint, same values, not a correction).
  const duplicateOf = new Map<string, string>();
  const byFp = new Map<string, Doc[]>();
  for (const d of packet.documents) push(byFp, docFingerprint(d), d);
  for (const group of byFp.values()) {
    if (group.length < 2) continue;
    const sorted = [...group].sort((a, b) => a.received_at.localeCompare(b.received_at));
    const first = sorted[0];
    for (const d of sorted.slice(1)) {
      if (d.marked_corrected || supersededBy.has(first.id)) continue;
      const a = evsByDoc.get(first.id) ?? [];
      const b = new Map((evsByDoc.get(d.id) ?? []).map((e) => [e.field, JSON.stringify(e.value)]));
      if (a.length && a.every((e) => !b.has(e.field) || b.get(e.field) === JSON.stringify(e.value))) duplicateOf.set(d.id, first.id);
    }
  }

  const versions = new Map<string, VersionIndex>();
  for (const v of packet.return_versions) {
    const lines = new Map(v.lines.map((l) => [l.key, l]));
    const citedBy = new Map<string, string[]>();
    const usedBy = new Map<string, string[]>();
    const linesByDoc = new Map<string, string[]>();
    for (const l of v.lines) {
      for (const s of l.sources) {
        push(citedBy, s, l.key);
        const e = evs.get(s);
        if (e) push(linesByDoc, e.document_id, l.key);
        const m = /^doc:(D\d+)/.exec(s);
        if (m) push(linesByDoc, m[1], l.key);
      }
      for (const i of l.inputs) push(usedBy, i, l.key);
    }
    versions.set(v.version, { version: v, lines, citedBy, usedBy, linesByDoc });
  }

  return {
    packet, docs, evs, evsByDoc, evByDocField, versions,
    versionOrder: packet.return_versions.map((v) => v.version),
    supersededBy, duplicateOf,
    qa: new Map(packet.client.questionnaire.map((q) => [q.id, q])),
    msgs: new Map(packet.client.messages.map((m) => [m.id, m])),
    calls: new Map(packet.client.call_notes.map((c) => [c.id, c])),
    staff: new Map(packet.firm.staff.map((s) => [s.id, s])),
  };
}

/** Where a document landed in a given version, or why it didn't. */
export function docUse(ix: PacketIndex, docId: string, version: string): DocUse {
  const vi = ix.versions.get(version)!;
  const d = ix.docs.get(docId)!;
  const sup = ix.supersededBy.get(docId);
  if (sup && vi.version.documents_superseded.includes(docId)) return { kind: "superseded", by: sup };
  const lines = vi.linesByDoc.get(docId) ?? [];
  const dup = ix.duplicateOf.get(docId);
  if (dup) return { kind: "duplicate", of: dup, lines };
  if (lines.length) return { kind: "used", lines };
  if (d.extraction.status === "not_extracted") return { kind: "not_extracted", reason: d.extraction.reason ?? "" };
  if (vi.version.documents_used.includes(docId)) return { kind: "supporting" };
  return { kind: "not_used" };
}

/** Walk the input tree below a line (bounded, cycle-safe). */
export function inputTree(vi: VersionIndex, key: string, depth = 0, seen = new Set<string>()): { key: string; children: ReturnType<typeof inputTree>[] } {
  if (seen.has(key) || depth > 6) return { key, children: [] };
  seen.add(key);
  const l = vi.lines.get(key);
  return { key, children: (l?.inputs ?? []).map((k) => inputTree(vi, k, depth + 1, seen)) };
}
