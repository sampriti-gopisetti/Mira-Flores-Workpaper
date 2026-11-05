import type { PacketIndex } from "./packetIndex";
import type { Json } from "./types";

// One resolver for every reference format the packet uses (readme.reference_formats).

export type RefKind =
  | "ev" | "doc" | "page" | "qa" | "msg" | "call" | "prior" | "agency" | "asset"
  | "household" | "param" | "fx" | "timeline" | "line" | "version" | "unknown";

export interface ResolvedRef {
  ref: string;
  kind: RefKind;
  label: string;
  detail?: string;
  value?: Json;
  docId?: string;
  page?: number;
  evId?: string;
}

function pointer(root: unknown, ptr: string): Json | undefined {
  let cur: unknown = root;
  for (const raw of ptr.split("/").filter(Boolean)) {
    const k = raw.replace(/~1/g, "/").replace(/~0/g, "~");
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[k];
  }
  return cur as Json | undefined;
}

function short(v: unknown): string {
  if (v == null) return "—";
  if (typeof v === "object") return Array.isArray(v) ? `${v.length} items` : "record";
  return String(v);
}

export function resolveRef(ix: PacketIndex, ref: string, version?: string): ResolvedRef {
  const p = ix.packet;
  if (/^ev-\d+$/.test(ref)) {
    const e = ix.evs.get(ref);
    if (!e) return { ref, kind: "unknown", label: ref };
    const d = ix.docs.get(e.document_id);
    return {
      ref, kind: "ev", label: `${e.label}`, detail: `${d?.title ?? e.document_id} · p${e.page} · ${e.field}`,
      value: e.value, docId: e.document_id, page: e.page, evId: e.id,
    };
  }
  if (/^D\d+$/.test(ref)) {
    const d = ix.docs.get(ref);
    return { ref, kind: "doc", label: d?.title ?? ref, docId: ref, page: 1 };
  }
  let m = /^doc:(D\d+)#page(\d+)$/.exec(ref);
  if (m) {
    const d = ix.docs.get(m[1]);
    return { ref, kind: "page", label: `${d?.title ?? m[1]}, page ${m[2]}`, detail: "Page not extracted by the pipeline", docId: m[1], page: Number(m[2]) };
  }
  if (/^qa-\d+$/.test(ref)) {
    const q = ix.qa.get(ref);
    return { ref, kind: "qa", label: q ? `Q: ${q.question}` : ref, detail: q ? `A: ${q.answer}` : undefined, value: q?.answer };
  }
  if (/^msg-\d+$/.test(ref)) {
    const q = ix.msgs.get(ref);
    return { ref, kind: "msg", label: q ? `Message from ${q.from}` : ref, detail: q?.text };
  }
  if (/^call-\d+$/.test(ref)) {
    const c = ix.calls.get(ref);
    return { ref, kind: "call", label: c ? `Call ${c.date.slice(0, 10)} (${c.participants.join(", ")})` : ref, detail: c?.notes.join(" • ") };
  }
  m = /^py:(\/.*)$/.exec(ref);
  if (m) {
    const v = pointer(p.prior_years, m[1]);
    return { ref, kind: "prior", label: `Prior year ${m[1].replace(/\//g, " › ").slice(3)}`, value: v, detail: short(v) };
  }
  m = /^agency:(\/.*)$/.exec(ref);
  if (m) {
    const v = pointer(p.tax_agency_records, m[1]);
    return { ref, kind: "agency", label: `Agency record ${m[1].replace(/\//g, " › ").slice(3)}`, value: v, detail: short(v) };
  }
  m = /^asset:(.+)$/.exec(ref);
  if (m) {
    const vi = version ? ix.versions.get(version) : undefined;
    const a = vi?.version.assets.find((x) => x.asset_id === m![1]);
    return { ref, kind: "asset", label: a ? `${a.asset_id} · ${a.description}` : `Asset ${m[1]}` };
  }
  m = /^household:(.+)$/.exec(ref);
  if (m) {
    const person = p.household.people.find((x) => x.id === m![1]);
    return { ref, kind: "household", label: person ? `${person.name} (${person.role})` : ref };
  }
  m = /^ref:fx\.SEK\.(.+)$/.exec(ref);
  if (m) {
    const fx = (p.engine_reference.parameters.fx as Record<string, Record<string, number>>)?.SEK;
    return { ref, kind: "fx", label: `SEK per USD (${m[1].replace("_", " ")})`, value: fx?.[m[1]] };
  }
  m = /^ref:param\.(.+)$/.exec(ref);
  if (m) {
    const v = p.engine_reference.parameters[m[1]];
    return { ref, kind: "param", label: `Engine parameter ${m[1]}`, value: v, detail: short(v) };
  }
  m = /^timeline:(.+)$/.exec(ref);
  if (m) {
    const ev = p.timeline.find((x) => x.id === m![1]);
    return { ref, kind: "timeline", label: ev ? `${ev.event.replace(/_/g, " ")} · ${ev.at.slice(0, 10)}` : ref, detail: ev?.detail ?? undefined };
  }
  if (/^v\d+$/.test(ref)) return { ref, kind: "version", label: `Return version ${ref}` };
  const vi = version ? ix.versions.get(version) : undefined;
  const line = vi?.lines.get(ref);
  if (line) return { ref, kind: "line", label: `${line.key} · ${line.label}`, value: line.value };
  return { ref, kind: "unknown", label: ref };
}
