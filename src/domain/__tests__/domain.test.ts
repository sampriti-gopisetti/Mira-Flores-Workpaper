import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { parsePacket } from "../packetSchema";
import { buildIndex } from "../packetIndex";
import { resolveRef } from "../refs";
import { project } from "../project";
import { lotAggregates } from "../lots";
import type { WpEvent } from "../events";

const raw = readFileSync(path.join(__dirname, "../../../data/packet.json"), "utf8");
const packet = parsePacket(JSON.parse(raw));
const ix = buildIndex(packet);
const lots = lotAggregates(packet);
const AS_OF = "2026-07-02T00:00:00Z";

let seq = 0;
function ev<T extends WpEvent["type"]>(type: T, target: string, payload: Record<string, unknown>, actorId = "st-01", extra: Partial<WpEvent> = {}): WpEvent {
  seq++;
  return { seq, id: `e${seq}`, at: AS_OF, simAt: AS_OF, actorId, actorRole: "preparer", type, target, payload: payload as never, layer: "original", ...extra };
}

describe("packet", () => {
  it("indexes documents, supersession and duplicates", () => {
    expect(ix.docs.size).toBe(74);
    expect(ix.supersededBy.get("D30")).toBe("D31");
    expect(ix.duplicateOf.get("D10")).toBe("D09");
  });

  it("resolves every reference in v3", () => {
    const unknown = new Set<string>();
    for (const l of ix.versions.get("v3")!.version.lines) for (const s of l.sources) {
      if (resolveRef(ix, s, "v3").kind === "unknown") unknown.add(s);
    }
    expect([...unknown]).toEqual([]);
  });
});

describe("checks", () => {
  const s = project(ix, [], { asOf: AS_OF, lots });
  const byId = new Map(s.checks.map((c) => [c.id, c]));

  it("finds the planted errors", () => {
    for (const id of ["est-fed", "est-ca", "ca-wages", "sehi", "car-donation", "read-ev-1045", "ssn-theo", "hvac",
      "unread-D31", "crypto-c6", "rsu-basis", "mileage-dup", "mixed-use", "mortgage-dup", "property-tax", "schc-gross",
      "int-dup-SchB.1.2", "fx-SchB.1.6"]) {
      expect(byId.get(id)?.status, id).toBe("open");
    }
    expect(byId.get("carryovers")?.status).toBe("passed");
    expect(byId.get("scorp-basis")?.status).toBe("passed");
    expect(byId.get("w2-sums")?.status).toBe("passed");
    expect(byId.get("brightpath")?.status).toBe("passed");
  });

  it("prints a summary", () => {
    for (const c of s.checks) console.log(c.status.padEnd(13), c.severity.padEnd(6), c.id.padEnd(30), JSON.stringify(c.effect ?? {}), c.summary.slice(0, 90));
  });
});

describe("projection", () => {
  it("prices an adjustment, propagates sums, and resolves the check", () => {
    const events = [ev("adjustment.made", "F1040.26", { from: 13000, to: 12000, reason: "transcript", version: "v3", evidence: [] })];
    const s = project(ix, events, { asOf: AS_OF, lots });
    expect(s.value("F1040.26")).toBe(12000);
    expect(s.totals.federal.balance_due).toBe(4220 + 1000);
    expect(s.checks.find((c) => c.id === "est-fed")?.status).toBe("resolved");
  });

  it("undo voids an event, and undoing the undo restores it", () => {
    const a = ev("adjustment.made", "Sch1.17", { from: 14400, to: 0, reason: "x", version: "v3", evidence: [] });
    const u = ev("event.voided", a.id, { eventIds: [a.id] });
    expect(project(ix, [a, u], { asOf: AS_OF, lots }).value("Sch1.17")).toBe(14400);
    const r = ev("event.voided", u.id, { eventIds: [u.id] });
    expect(project(ix, [a, u, r], { asOf: AS_OF, lots }).value("Sch1.17")).toBe(0);
  });

  it("reopens a sign-off when the area changes", () => {
    const s0 = project(ix, [], { asOf: AS_OF, lots });
    const so = ev("signoff.given", "payments", { level: "reviewer", hash: s0.areaHash.get("payments")!, summary: "" }, "st-02");
    expect(project(ix, [so], { asOf: AS_OF, lots }).signoffs[0].valid).toBe(true);
    const adj = ev("adjustment.made", "F540NR.72", { from: 14000, to: 10500, reason: "ftb", version: "v3", evidence: [] });
    const s2 = project(ix, [so, adj], { asOf: AS_OF, lots });
    expect(s2.signoffs[0].valid).toBe(false);
    expect(s2.signoffs[0].changes.join(" ")).toContain("F540NR.72");
  });

  it("carries a verification from a superseded document to its correction", () => {
    const v = ev("verification.recorded", "ev-0544", { method: "agreed_to_source_document", seenValue: 71965, version: "v1", evidence: [] },
      "st-01", { anchor: "1099-composite|meridian|joint|2025#b_summary_proceeds", simAt: "2026-03-10T00:00:00Z" });
    const before = project(ix, [v], { asOf: "2026-03-15T00:00:00Z", lots });
    expect(before.evStatus.get("ev-0544")?.status).toBe("verified");
    const after = project(ix, [v], { asOf: AS_OF, lots });
    expect(after.evStatus.get("ev-0703")?.status).toBe("carried");
  });

  it("verification of a line goes stale when a new version changes it", () => {
    const v = ev("verification.recorded", "F1040.7", { method: "recalculated", seenValue: 177777, version: "v2", evidence: [] }, "st-01", { simAt: "2026-03-20T00:00:00Z" });
    expect(project(ix, [v], { asOf: "2026-04-01T00:00:00Z", lots }).lineStatus.get("F1040.7")?.status).toBe("verified");
    expect(project(ix, [v], { asOf: AS_OF, lots }).lineStatus.get("F1040.7")?.status).toBe("stale");
  });

  it("adds an omitted lot as a virtual line rolling into its box total", () => {
    const a = ev("adjustment.made", "F8949.B.M18", { from: 0, to: -60, reason: "page 32", version: "v3", evidence: [], parent: "F8949.B.total" });
    const s = project(ix, [a], { asOf: AS_OF, lots });
    expect(s.value("F8949.B.total")).toBe(37720 - 60);
    expect(s.checks.find((c) => c.id === "unread-D31")?.status).toBe("resolved");
  });
});
