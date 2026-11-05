import type { ExtractedValue, Packet } from "./types";
import type { LotAggregates } from "./checks";
import { num } from "./format";

export interface Lot {
  docId: string;
  lot: string;
  description: string;
  acquired: string;
  sold: string;
  proceeds: number;
  basis: number;
  wash: number;
  term: string;
  gain: number;
  evIds: string[];
}

const LOT_FIELD = /^([A-Z]+\d+)_(desc|description|asset|acq|acquired|sold|proceeds|basis|wash|term|covered|quantity|units)$/;

/** Group a broker document's per-lot extracted values into lots. */
export function lotsForDoc(evs: ExtractedValue[], docId: string): Lot[] {
  const by = new Map<string, Record<string, ExtractedValue>>();
  for (const e of evs) {
    if (e.document_id !== docId) continue;
    const m = LOT_FIELD.exec(e.field);
    if (!m) continue;
    const r = by.get(m[1]) ?? {};
    r[m[2]] = e;
    by.set(m[1], r);
  }
  return [...by.entries()].filter(([, r]) => r.proceeds).map(([lot, r]) => {
    const proceeds = num(r.proceeds?.value), basis = num(r.basis?.value), wash = num(r.wash?.value);
    return {
      docId, lot,
      description: String((r.desc ?? r.description ?? r.asset)?.value ?? ""),
      acquired: String((r.acq ?? r.acquired)?.value ?? ""),
      sold: String(r.sold?.value ?? ""),
      proceeds, basis, wash,
      term: String(r.term?.value ?? ""),
      gain: Math.round((proceeds - basis + wash) * 100) / 100,
      evIds: Object.values(r).map((e) => e.id),
    };
  });
}

export function lotAggregates(p: Packet): LotAggregates {
  const out: LotAggregates = {};
  const brokerDocs = p.documents.filter((d) => ["1099-composite", "1099-DA"].includes(d.document_type));
  for (const d of brokerDocs) {
    const lots = lotsForDoc(p.extracted_values, d.id);
    if (!lots.length) continue;
    const agg = { count: 0, proceeds: 0, basis: 0, wash: 0, byTerm: {} as LotAggregates[string]["byTerm"] };
    for (const l of lots) {
      agg.count++; agg.proceeds += l.proceeds; agg.basis += l.basis; agg.wash += l.wash;
      const t = (agg.byTerm[l.term || "unknown"] ??= { count: 0, proceeds: 0, basis: 0, wash: 0 });
      t.count++; t.proceeds += l.proceeds; t.basis += l.basis; t.wash += l.wash;
    }
    const r = (n: number) => Math.round(n * 100) / 100;
    agg.proceeds = r(agg.proceeds); agg.basis = r(agg.basis); agg.wash = r(agg.wash);
    for (const t of Object.values(agg.byTerm)) { t.proceeds = r(t.proceeds); t.basis = r(t.basis); t.wash = r(t.wash); }
    out[d.id] = agg;
  }
  return out;
}
