// Builds the "pipeline re-run" demo packet from the delivered packet.
//
// A real re-run of the extraction pipeline renumbers extracted values and can read
// some fields differently. This simulates exactly that, and nothing else:
//   - every ev-NNNN id is renumbered (reverse order), consistently everywhere it is cited;
//   - the misread dependent-care EIN on D62 is now read as printed;
//   - the handwritten St. Brigid amount is read with higher confidence (same value).
// The engine's return lines are otherwise unchanged. The packet is labelled as a demo.

export const RERUN_GENERATED = "2026-10-20";

export function makeRerunPacket(raw: string): string {
  const parsed = JSON.parse(raw) as { extracted_values: { id: string }[] };
  const n = parsed.extracted_values.length;
  const order = parsed.extracted_values.map((e) => e.id);
  const map = new Map(order.map((id, i) => [id, `ev-${String(n - i).padStart(4, "0")}`]));

  // Renumber every citation in one pass so the packet stays internally consistent.
  const renumbered = raw.replace(/\bev-\d{4}\b/g, (m) => map.get(m) ?? m);
  const p = JSON.parse(renumbered);

  p.packet.generated = RERUN_GENERATED;
  p.readme = { ...p.readme, rerun_demo: "Synthetic re-run of the extraction pipeline for the re-anchoring demo: extracted value ids renumbered; D62 EIN re-read as printed; D64 amount re-read at higher confidence." };

  for (const e of p.extracted_values) {
    if (e.document_id === "D62" && e.field === "ein") { e.value = "74-3829156"; e.text_as_read = "74-3829156"; e.confidence = 0.99; }
    if (e.document_id === "D64" && e.field === "amount") e.confidence = 0.86;
  }
  for (const v of p.return_versions) {
    for (const l of v.lines) if (typeof l.label === "string") l.label = l.label.replace("74-3829516", "74-3829156");
  }
  return JSON.stringify(p);
}
