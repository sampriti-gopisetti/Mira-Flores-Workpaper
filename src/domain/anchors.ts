import type { Doc, ExtractedValue } from "./types";

// Stable, meaning-based keys. Packet-local ids (ev-0016) change when the pipeline
// re-runs or a corrected document arrives; these keys do not, so human work
// attached to a value can be found again in a later packet or successor document.

export function docFingerprint(d: Pick<Doc, "document_type" | "issuer" | "belongs_to" | "tax_year">): string {
  return [d.document_type, d.issuer, d.belongs_to, d.tax_year].join("|").toLowerCase();
}

export function evAnchor(d: Pick<Doc, "document_type" | "issuer" | "belongs_to" | "tax_year">, e: Pick<ExtractedValue, "page" | "field">): string {
  return `${docFingerprint(d)}#${e.field}`;
}
