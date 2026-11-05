import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { parsePacket } from "../packetSchema";
import { buildIndex } from "../packetIndex";
import { approvalHash, project, snapshotOf, stableHash, type WorkpaperState } from "../project";
import { lotAggregates } from "../lots";
import { actorsFromPacket } from "../actors";
import { can } from "../policy";
import { AREAS } from "../areas";
import type { WpEvent, EventType } from "../events";
import { redactPacket, SSN_RE } from "../redact";

const packet = parsePacket(JSON.parse(readFileSync(path.join(__dirname, "../../../data/packet.json"), "utf8")));
const ix = buildIndex(packet);
const lots = lotAggregates(packet);
const actors = actorsFromPacket(packet);

class Season {
  events: WpEvent[] = [];
  seq = 0;
  constructor(public asOf: string) {}
  state(): WorkpaperState { return project(ix, this.events, { asOf: this.asOf, lots }); }
  try(actorId: string, type: EventType, target: string, payload: Record<string, unknown>) {
    const actor = actors.find((a) => a.id === actorId)!;
    const d = can(actor, { type, target, payload }, this.state(), ix);
    if (!d.ok) return d;
    this.seq++;
    this.events.push({ seq: this.seq, id: `e${this.seq}`, at: this.asOf, simAt: this.asOf, actorId, actorRole: actor.role, type, target, payload: payload as never, layer: this.state().filing.amendment ? "amended-1" : "original" });
    return d;
  }
  do(actorId: string, type: EventType, target: string, payload: Record<string, unknown>) {
    const d = this.try(actorId, type, target, payload);
    if (!d.ok) throw new Error(`${actorId} ${type} ${target}: ${d.reason}`);
  }
}

describe("a full season", () => {
  it("prepares, reviews, approves, rejects, fixes, files, freezes and amends", () => {
    const s = new Season("2026-07-02T12:00:00Z");
    const st = () => s.state();

    // Preparer applies every suggested fix and dispositions the rest.
    for (const c of st().checks.filter((c) => c.status === "open")) {
      for (const a of c.suggestion?.adjustments ?? []) {
        s.do("st-01", "adjustment.made", a.key, { from: st().vi.lines.get(a.key)?.value ?? null, to: a.to, reason: a.reason, version: st().version, evidence: c.evidence, kind: a.kind ?? "amount", ...(a.parent ? { parent: a.parent } : {}) });
      }
      if (c.suggestion?.verify) {
        const t = c.suggestion.verify.target;
        s.do("st-01", "verification.recorded", t, { method: c.suggestion.verify.method, seenValue: ix.evs.get(t)?.value ?? st().value(t), version: st().version, evidence: [] });
      }
      if (c.suggestion?.whatIfId) s.do("st-01", "judgment.recorded", c.lines[0], { kind: "election", whatIfId: c.suggestion.whatIfId, decision: "Capitalize HVAC", authority: "Treas. Reg. §1.263(a)-3(k)", evidence: [] });
    }
    for (const c of st().checks.filter((c) => c.status === "open" && c.severity !== "info" && !c.coveredBy)) {
      s.do("st-01", "judgment.recorded", `check:${c.id}`, { kind: "check_disposition", decision: "Reviewed; documented", authority: "Firm standard", evidence: [] });
    }
    const left = st().checks.filter((c) => c.status === "open" && c.severity !== "info" && !c.coveredBy);
    expect(left.map((c) => c.id)).toEqual([]);

    // Judgment without authority is refused (firm standard).
    expect(s.try("st-01", "judgment.recorded", "F8867.status", { kind: "due_diligence", decision: "done", authority: "" }).ok).toBe(false);
    s.do("st-01", "judgment.recorded", "F8867.status", { kind: "due_diligence", decision: "Form 8867 completed for CTC/ODC", authority: "IRC §6695(g)", evidence: [] });
    for (const id of ["identity", "prior-year"]) s.do("st-01", "step.completed", `step:${id}`, { note: "", evidence: [] });
    for (const v of st().variances) s.do("st-01", "judgment.recorded", v.key, { kind: "variance", decision: "Explained", authority: "", evidence: [] });
    for (const o of st().outside) s.do("st-01", "judgment.recorded", `outside:${o.id}`, { kind: "outside_filing", decision: "Client advised in writing", authority: "", evidence: [] });
    for (const [id, u] of st().docUses) if (u.kind === "not_used") s.do("st-01", "judgment.recorded", id, { kind: "doc_disposition", decision: "Reviewed", authority: "", evidence: [] });

    // Sign-offs: the preparer cannot review her own work.
    for (const a of AREAS) s.do("st-01", "signoff.given", a.id, { level: "preparer", hash: st().areaHash.get(a.id) });
    expect(s.try("st-01", "signoff.given", "payments", { level: "reviewer", hash: st().areaHash.get("payments") }).ok).toBe(false);
    for (const a of AREAS) s.do("st-02", "signoff.given", a.id, { level: "reviewer", hash: st().areaHash.get(a.id) });

    // Large adjustments need the partner; the author cannot approve her own.
    const big = st().adjustments.filter((a) => a.needsPartner);
    expect(big.length).toBeGreaterThan(0);
    for (const a of big) s.do("st-03", "adjustment.approved", a.key, { adjustmentId: a.event.id });
    for (const a of AREAS) s.do("st-03", "signoff.given", a.id, { level: "partner", hash: st().areaHash.get(a.id) });
    expect(st().gate.blockers).toEqual(["Client approval and e-file authorization"]);
    expect(st().gate.canPresent).toBe(true);

    // A later change reopens the sign-offs in that area.
    s.do("st-01", "adjustment.made", "SchB.1.4", { from: 312, to: 313, reason: "typo test", version: "v3", evidence: [] });
    expect(st().signoffs.filter((x) => x.area === "investments").every((x) => !x.valid)).toBe(true);
    const lastAdj = s.events.at(-1)!;
    s.do("st-01", "event.voided", lastAdj.id, { eventIds: [lastAdj.id] });
    expect(st().signoffs.every((x) => x.valid)).toBe(true);

    // Client approves and signs; reviewer transmits a frozen snapshot.
    s.do("cu-01", "client.approved", "return", { federalBalance: st().totals.federal.balance_due, californiaBalance: st().totals.california.balance_due, hash: approvalHash(st()) });
    s.do("cu-01", "efile.signed", "return", { form: "8879" });
    s.do("st-02", "return.submitted", "return", { snapshot: snapshotOf(st()), hash: stableHash(snapshotOf(st())), jurisdictions: ["federal", "california"] });
    expect(st().filing.frozen).toBe(true);
    expect(s.try("st-01", "adjustment.made", "SchB.1.4", { from: 312, to: 1, reason: "x", version: "v3" }).ok).toBe(false);

    // Theo's SSN was fixed by the check, so the agency accepts.
    s.do("st-02", "efile.result", "return", { jurisdiction: "federal", status: "accepted", submissionId: "x", errors: [] });
    s.do("st-02", "efile.result", "return", { jurisdiction: "california", status: "accepted", submissionId: "y", errors: [] });
    expect(st().phase).toBe("filed");
    expect(st().filing.filedSnapshot?.federal.balance_due).toBe(st().totals.federal.balance_due);
    expect(s.try("st-01", "adjustment.made", "SchB.1.4", { from: 312, to: 1, reason: "x", version: "v3" }).ok).toBe(false);

    // Amend on top: the filed snapshot stays, new work is layered.
    s.do("st-03", "amendment.opened", "return", { layer: "amended-1", reason: "Corrected 1099" });
    s.do("st-01", "adjustment.made", "SchB.1.4", { from: 312, to: 400, reason: "Corrected 1099-INT", version: "v3", evidence: [] });
    expect(st().value("SchB.1.4")).toBe(400);
    expect(st().filing.filedSnapshot?.lines["SchB.1.4"]).toBe(312);
    console.log("filed totals", JSON.stringify(st().filing.filedSnapshot?.federal), JSON.stringify(st().filing.filedSnapshot?.california));
  });

  it("an uncorrected dependent SSN is visible before filing (rejection predicted)", () => {
    const s = new Season("2026-03-15T00:00:00Z");
    expect(s.state().checks.find((c) => c.id === "ssn-theo")?.status).toBe("open");
  });

  it("redaction leaves no full SSN in anything sent to the browser", () => {
    const red = JSON.stringify(redactPacket(packet));
    expect(red.match(SSN_RE)).toBeNull();
    expect(red).not.toContain("482915");
    expect(red).not.toContain("4483019276");
  });

  it("Marcus cannot unmask and cannot act before he joins", () => {
    const marcus = actors.find((a) => a.id === "st-04")!;
    const early = project(ix, [], { asOf: "2026-03-10T00:00:00Z", lots });
    expect(can(marcus, { type: "verification.recorded", target: "F1040.1a", payload: {} }, early, ix).ok).toBe(false);
    const later = project(ix, [], { asOf: "2026-04-01T00:00:00Z", lots });
    expect(can(marcus, { type: "verification.recorded", target: "F1040.1a", payload: {} }, later, ix).ok).toBe(true);
    expect(can(marcus, { type: "sensitive.viewed", target: "household:ngozi.ssn", payload: {} }, later, ix).ok).toBe(false);
  });
});
