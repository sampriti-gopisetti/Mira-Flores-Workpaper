import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { parsePacket } from "../packetSchema";
import { buildIndex } from "../packetIndex";
import { project } from "../project";
import { lotAggregates } from "../lots";
import { makeRerunPacket } from "../rerun";
import { evAnchor } from "../anchors";
import type { WpEvent } from "../events";

const raw = readFileSync(path.join(__dirname, "../../../data/packet.json"), "utf8");
const original = parsePacket(JSON.parse(raw));
const rerun = parsePacket(JSON.parse(makeRerunPacket(raw)));
const ix0 = buildIndex(original);
const ix1 = buildIndex(rerun);
const AS_OF = "2026-07-02T00:00:00Z";

// Events are recorded against the original packet, with the anchor the server would store.
function on(evId: string, type: WpEvent["type"], payload: Record<string, unknown>, seq: number): WpEvent {
  const e = ix0.evs.get(evId)!;
  return {
    seq, id: `e${seq}`, at: AS_OF, simAt: AS_OF, actorId: "st-01", actorRole: "preparer", type, target: evId,
    anchor: evAnchor(ix0.docs.get(e.document_id)!, e), payload: payload as never, layer: "original",
  };
}

describe("pipeline re-run re-anchoring", () => {
  const events = [
    on("ev-0016", "verification.recorded", { method: "agreed_to_source_document", seenValue: 104600, version: "v3", evidence: [] }, 1),
    on("ev-1045", "verification.recorded", { method: "agreed_to_source_document", seenValue: "74-3829516", version: "v3", evidence: [] }, 2),
    on("ev-1049", "note.opened", { noteId: "n1", kind: "info", text: "Ambiguous digit", visibility: "internal" }, 3),
  ];

  it("ids really were renumbered", () => {
    expect(ix1.evs.get("ev-0016")?.field).not.toBe("box1");
  });

  it("re-attaches work by anchor and re-checks the value", () => {
    const s = project(ix1, events, { asOf: AS_OF, lots: lotAggregates(rerun) });
    const box1 = ix1.evByDocField.get("D08#box1")!.id;
    const ein = ix1.evByDocField.get("D62#ein")!.id;
    expect(s.remapped.map((r) => r.to).sort()).toEqual([box1, ein, ix1.evByDocField.get("D64#amount")!.id].sort());
    expect(s.evStatus.get(box1)?.status).toBe("verified");   // value unchanged → carried
    expect(s.evStatus.get(ein)?.status).toBe("stale");       // re-run read a different value → re-verify
    expect(s.notes[0].target).toBe(ix1.evByDocField.get("D64#amount")!.id);
    expect(s.orphaned).toEqual([]);
    // Without anchors, the old id would silently point at an unrelated value:
    expect(ix1.evs.get("ev-0016")?.document_id).not.toBe("D08");
  });

  it("flags work whose value no longer exists", () => {
    const ghost = { ...events[0], id: "ghost", seq: 9, target: "ev-0016", anchor: "w-2|nobody|taxpayer|2025#box99" };
    const s = project(ix1, [ghost], { asOf: AS_OF, lots: lotAggregates(rerun) });
    expect(s.orphaned.length).toBe(1);
    expect(s.checks.find((c) => c.id === "orphaned-work")?.status).toBe("open");
  });

  it("the original packet is unaffected", () => {
    const s = project(ix0, events, { asOf: AS_OF, lots: lotAggregates(original) });
    expect(s.remapped).toEqual([]);
    expect(s.evStatus.get("ev-0016")?.status).toBe("verified");
  });
});
