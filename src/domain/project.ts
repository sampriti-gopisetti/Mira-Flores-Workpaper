import type { Json, Line, Packet, Totals } from "./types";
import type { PacketIndex, VersionIndex } from "./packetIndex";
import { docUse, type DocUse } from "./packetIndex";
import type { WpEvent, Payload } from "./events";
import { AREAS, areaForDoc, areaForLine } from "./areas";
import { taxEffect, type TaxEffect } from "./taxEffect";
import { evAnchor } from "./anchors";
import { num } from "./format";
import { runChecks, type Check, type LotAggregates } from "./checks";

// project(packet, events, asOf) -> everything the UI shows. Pure and deterministic:
// the server runs it to enforce rules, the browser runs it to render.

export interface ProjectOptions {
  asOf: string;
  lots?: LotAggregates;
  actorId?: string;
  lastSeenSeq?: number;
}

export interface Adjustment {
  event: WpEvent<"adjustment.made">;
  key: string;
  from: Json;
  to: Json;
  delta: number;
  effect: TaxEffect;
  approvals: WpEvent<"adjustment.approved">[];
  needsPartner: boolean;
  /** the engine value moved under the adjustment (new version) */
  stale: boolean;
  layer: string;
}

export interface Remap { event: WpEvent; from: string; to: string }

export interface Verification { event: WpEvent<"verification.recorded">; current: boolean; carriedFrom?: string }

export interface ItemStatus {
  status: "unverified" | "verified" | "stale" | "carried";
  verifications: Verification[];
  latest?: Verification;
  reason?: string;
}

export interface Note {
  id: string;
  target: string;
  kind: "review" | "info";
  visibility: "internal" | "client";
  text: string;
  author: string;
  at: string;
  simAt: string;
  assignee?: string;
  replies: { author: string; text: string; at: string }[];
  resolved?: { by: string; text: string; at: string };
  seq: number;
}

export interface Question {
  id: string;
  target: string;
  to: string;
  from: string;
  text: string;
  at: string;
  evidence: string[];
  answer?: { by: string; text: string; at: string; attachmentIds: string[] };
  seq: number;
}

export interface SignoffState {
  area: string;
  level: "preparer" | "reviewer" | "partner";
  event: WpEvent<"signoff.given">;
  valid: boolean;
  changes: string[];
}

export interface LineValue {
  engine: Json;
  workpaper: Json;
  adjusted: boolean;
  propagated: boolean;
  pendingRecompute: boolean;
  election?: string;
}

export interface Step { label: string; done: boolean; auto: boolean; detail: string; target?: string }

export interface OutsideFiling { id: string; title: string; detail: string; evidence: string[]; disposition?: WpEvent<"judgment.recorded"> }

export interface Variance { key: string; label: string; prior: number; current: number; delta: number; pct: number; explanation?: WpEvent<"judgment.recorded"> }

export interface FilingState {
  extension?: WpEvent<"return.extension_filed">;
  clientApproval?: WpEvent<"client.approved">;
  approvalValid: boolean;
  efileSigned: WpEvent<"efile.signed">[];
  submissions: WpEvent<"return.submitted">[];
  results: WpEvent<"efile.result">[];
  accepted: { federal?: WpEvent<"efile.result">; california?: WpEvent<"efile.result"> };
  lastRejection?: WpEvent<"efile.result">;
  inTransit: boolean;
  frozen: boolean;
  filedSnapshot?: Snapshot;
  amendment?: WpEvent<"amendment.opened">;
  agency: WpEvent<"agency.recorded">[];
}

export interface Snapshot {
  version: string;
  federal: Totals;
  california: Totals;
  lines: Record<string, Json>;
  adjustments: string[];
  at: string;
}

export type Phase = "intake" | "preparation" | "review" | "client_approval" | "filing" | "rejected" | "filed" | "amending" | "examination";

export interface WorkpaperState {
  asOf: string;
  version: string;
  vi: VersionIndex;
  phase: Phase;
  events: WpEvent[];
  activeEvents: WpEvent[];
  voided: Set<string>;
  visibleDocs: Set<string>;
  adjustments: Adjustment[];
  adjustmentsByKey: Map<string, Adjustment>;
  correctionsByTarget: Map<string, Adjustment>;
  lineValues: Map<string, LineValue>;
  value: (key: string) => Json;
  lineStatus: Map<string, ItemStatus>;
  evStatus: Map<string, ItemStatus>;
  notes: Note[];
  questions: Question[];
  judgments: WpEvent<"judgment.recorded">[];
  elections: Map<string, WpEvent<"judgment.recorded">>;
  attachments: WpEvent<"attachment.added">[];
  signoffs: SignoffState[];
  areaHash: Map<string, string>;
  areaPreparers: Map<string, Set<string>>;
  totals: { federal: Totals; california: Totals; engineFederal: Totals; engineCalifornia: Totals; estimated: boolean };
  filing: FilingState;
  checks: Check[];
  docUses: Map<string, DocUse>;
  docDispositions: Map<string, WpEvent<"judgment.recorded">>;
  variances: Variance[];
  outside: OutsideFiling[];
  steps: Step[];
  gate: { canPresent: boolean; canSubmit: boolean; blockers: string[] };
  timeByArea: Map<string, number>;
  sensitiveViews: WpEvent<"sensitive.viewed">[];
  standards: Packet["firm"]["starter_standards"] & { partner_threshold: number };
  assignments: { preparer: string; reviewer: string; partner: string; due?: string };
  sinceLastSeen: WpEvent[];
  household: Packet["household"];
  /** work re-attached to a value by its anchor after a pipeline re-run renumbered it */
  remapped: Remap[];
  /** work whose value no longer exists in the current packet */
  orphaned: WpEvent[];
}

// ---------- helpers ----------

export function stableHash(input: unknown): string {
  const s = JSON.stringify(input);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, "0");
}

const same = (a: Json | undefined, b: Json | undefined) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

function setPath(obj: Record<string, unknown>, path: string, value: unknown) {
  const parts = path.split(".");
  let cur = obj;
  for (const p of parts.slice(0, -1)) { cur[p] = { ...(cur[p] as object ?? {}) }; cur = cur[p] as Record<string, unknown>; }
  cur[parts[parts.length - 1]] = value;
}

/** Signs s_i so that sum(s_i * input_i) == value, for linear R-SUM / R-CARRY lines. */
const signCache = new WeakMap<VersionIndex, Map<string, number[] | null>>();
function inputSigns(vi: VersionIndex, line: Line): number[] | null {
  let cache = signCache.get(vi);
  if (!cache) { cache = new Map(); signCache.set(vi, cache); }
  if (cache.has(line.key)) return cache.get(line.key)!;
  let result: number[] | null = null;
  if ((line.rule === "R-SUM" || line.rule === "R-CARRY") && typeof line.value === "number" && line.inputs.length) {
    const vals = line.inputs.map((k) => num(vi.lines.get(k)?.value));
    const n = vals.length;
    const target = line.value;
    const tol = Math.max(1.01, n * 0.51);
    if (Math.abs(vals.reduce((a, b) => a + b, 0) - target) <= tol) result = vals.map(() => 1);
    else if (n <= 12) {
      for (let mask = 1; mask < 1 << n && !result; mask++) {
        let s = 0;
        for (let i = 0; i < n; i++) s += (mask & (1 << i) ? -1 : 1) * vals[i];
        if (Math.abs(s - target) <= tol) result = vals.map((_, i) => (mask & (1 << i) ? -1 : 1));
      }
    }
  }
  cache.set(line.key, result);
  return result;
}

function currentVersion(p: Packet, asOf: string): string {
  const eligible = p.return_versions.filter((v) => v.computed_at <= asOf);
  return (eligible.length ? eligible[eligible.length - 1] : p.return_versions[0]).version;
}

export function targetArea(ix: PacketIndex, target: string, checks?: Check[]): string | undefined {
  if (AREAS.some((a) => a.id === target)) return target;
  if (/^ev-/.test(target)) { const e = ix.evs.get(target); const d = e && ix.docs.get(e.document_id); return d ? areaForDoc(d.document_type, d.id) : undefined; }
  if (/^D\d+$/.test(target)) { const d = ix.docs.get(target); return d ? areaForDoc(d.document_type, d.id) : undefined; }
  if (/^check:/.test(target)) return checks?.find((c) => `check:${c.id}` === target)?.area;
  if (/^household:/.test(target)) return "intake";
  if (/^outside:/.test(target) || /^step:/.test(target)) return undefined;
  if (/^[A-Za-z0-9-]+\./.test(target)) return areaForLine(target);
  return undefined;
}

// ---------- projection ----------

export function project(ix: PacketIndex, allEvents: WpEvent[], opts: ProjectOptions): WorkpaperState {
  const p = ix.packet;
  const asOf = opts.asOf;
  const events = allEvents.filter((e) => e.simAt <= asOf).sort((a, b) => a.seq - b.seq);

  // Undo = event.voided. Walk voids newest-first so undoing an undo restores the original.
  const voided = new Set<string>();
  for (const e of [...events].reverse()) {
    if (e.type !== "event.voided" || voided.has(e.id)) continue;
    for (const id of (e.payload as Payload<"event.voided">).eventIds) voided.add(id);
  }
  // Re-anchoring. Work on an extracted value stores an anchor (document fingerprint + field).
  // After a pipeline re-run the id may point at a different value or none at all; the anchor
  // finds the same field again. Work whose anchor no longer exists is reported as orphaned.
  const currentByAnchor = new Map<string, string>();
  const anyByAnchor = new Map<string, string>();
  const anchorOfEv = new Map<string, string>();
  for (const x of p.extracted_values) {
    const d = ix.docs.get(x.document_id)!;
    const a = evAnchor(d, x);
    anchorOfEv.set(x.id, a);
    if (!anyByAnchor.has(a)) anyByAnchor.set(a, x.id);
    if (!ix.supersededBy.has(d.id) && !ix.duplicateOf.has(d.id)) currentByAnchor.set(a, x.id);
  }
  const remapped: Remap[] = [];
  const orphaned: WpEvent[] = [];
  const active = events.filter((e) => !voided.has(e.id) && e.type !== "event.voided").map((e) => {
    if (!e.anchor || !/^ev-\d+$/.test(e.target) || anchorOfEv.get(e.target) === e.anchor) return e;
    const to = currentByAnchor.get(e.anchor) ?? anyByAnchor.get(e.anchor);
    if (!to) { orphaned.push(e); return e; }
    remapped.push({ event: e, from: e.target, to });
    return { ...e, target: to, remappedFrom: e.target };
  });
  const of = <T extends WpEvent["type"]>(t: T) => active.filter((e) => e.type === t) as WpEvent<T>[];

  // Standards (admin may change them; changes are events too).
  const standards = { ...structuredClone(p.firm.starter_standards), partner_threshold: 1000 } as WorkpaperState["standards"];
  for (const e of of("standard.changed")) setPath(standards as unknown as Record<string, unknown>, e.payload.path, e.payload.value);

  const version = currentVersion(p, asOf);
  const vi = ix.versions.get(version)!;
  const rv = vi.version;
  const visibleDocs = new Set(p.documents.filter((d) => d.received_at <= asOf).map((d) => d.id));

  // Elections pick a what-if: its engine-computed lines and totals replace the base.
  const elections = new Map<string, WpEvent<"judgment.recorded">>();
  for (const j of of("judgment.recorded")) if (j.payload.kind === "election" && j.payload.whatIfId) elections.set(j.payload.whatIfId, j);
  const activeWhatIfs = p.what_if.alternatives.filter((w) => elections.has(w.id) && w.base_version === version);

  // Adjustments: latest active adjustment per target wins; `from` is always the engine value.
  const adjustments: Adjustment[] = [];
  const adjustmentsByKey = new Map<string, Adjustment>();
  const correctionsByTarget = new Map<string, Adjustment>();
  const approvals = of("adjustment.approved");
  for (const e of of("adjustment.made")) {
    const isLine = vi.lines.has(e.target);
    // An item the engine omitted (e.g. an unread 1099-B lot) is added as a virtual line rolling into `parent`.
    const isVirtual = !isLine && !!e.payload.parent && vi.lines.has(e.payload.parent) && typeof e.payload.to === "number";
    const engine = isLine ? vi.lines.get(e.target)!.value : isVirtual ? 0 : e.payload.from;
    const corr = e.payload.kind === "correction" || (!isLine && !isVirtual) || typeof e.payload.to !== "number";
    const delta = corr ? 0 : num(e.payload.to) - num(engine);
    const effect = corr ? { ...taxEffect(e.target, 0, rv), basis: "Correction (no amount change)" } : taxEffect(e.target, delta, rv);
    const appr = approvals.filter((a) => a.payload.adjustmentId === e.id);
    const thr = standards.partner_threshold;
    const adj: Adjustment = {
      event: e, key: e.target, from: engine, to: e.payload.to, delta, effect, approvals: appr,
      needsPartner: Math.max(Math.abs(effect.federalTax), Math.abs(effect.californiaTax), Math.abs(effect.federalBalance), Math.abs(effect.californiaBalance)) > thr,
      stale: isLine && !same(engine, e.payload.from), layer: e.layer,
    };
    const map = corr ? correctionsByTarget : adjustmentsByKey;
    const prev = map.get(e.target);
    if (prev) adjustments.splice(adjustments.indexOf(prev), 1);
    map.set(e.target, adj);
    adjustments.push(adj);
  }

  // Line values: engine -> election overrides -> adjustments -> propagate through linear sums.
  const lineValues = new Map<string, LineValue>();
  for (const l of rv.lines) lineValues.set(l.key, { engine: l.value, workpaper: l.value, adjusted: false, propagated: false, pendingRecompute: false });
  for (const w of activeWhatIfs) {
    for (const c of w.changed_lines) {
      const lv = lineValues.get(c.key);
      if (lv) { lv.workpaper = c.new ?? null; lv.election = w.id; }
    }
  }
  const deltas = new Map<string, number>();
  const virtualParent = new Map<string, string>();
  for (const a of adjustmentsByKey.values()) {
    if (!lineValues.has(a.key) && a.event.payload.parent) {
      lineValues.set(a.key, { engine: null, workpaper: 0, adjusted: false, propagated: false, pendingRecompute: false });
      virtualParent.set(a.key, a.event.payload.parent);
    }
    const lv = lineValues.get(a.key);
    if (!lv) continue;
    const base = num(lv.workpaper);
    lv.workpaper = a.to;
    lv.adjusted = true;
    deltas.set(a.key, num(a.to) - base);
  }
  const queue = [...deltas.entries()];
  while (queue.length) {
    const [key, d] = queue.shift()!;
    for (const parentKey of vi.usedBy.get(key) ?? (virtualParent.has(key) ? [virtualParent.get(key)!] : [])) {
      const parent = vi.lines.get(parentKey)!;
      const lv = lineValues.get(parentKey)!;
      if (lv.adjusted) continue;
      const signs = inputSigns(vi, parent);
      if (!signs) { lv.pendingRecompute = true; continue; }
      const s = signs[parent.inputs.indexOf(key)] ?? 1;
      lv.workpaper = num(lv.workpaper) + s * d;
      lv.propagated = true;
      queue.push([parentKey, s * d]);
    }
  }
  const value = (key: string) => lineValues.get(key)?.workpaper ?? null;

  // Totals = engine (or elected what-if) totals + priced adjustments.
  const baseF = activeWhatIfs.length ? { ...activeWhatIfs.at(-1)!.federal.alternative } : { ...rv.summary.federal };
  const baseC = activeWhatIfs.length ? { ...activeWhatIfs.at(-1)!.california.alternative } : { ...rv.summary.california };
  if (activeWhatIfs.length > 1) {
    for (const w of activeWhatIfs.slice(0, -1)) {
      baseF.total_tax += w.federal.total_tax_change; baseF.balance_due += w.federal.total_tax_change;
      baseC.total_tax += w.california.total_tax_change; baseC.balance_due += w.california.total_tax_change;
    }
  }
  const federal = { ...baseF };
  const california = { ...baseC };
  for (const a of adjustmentsByKey.values()) {
    federal.total_tax += a.effect.federalTax;
    federal.balance_due += a.effect.federalBalance;
    federal.payments += a.effect.federalTax - a.effect.federalBalance;
    california.total_tax += a.effect.californiaTax;
    california.balance_due += a.effect.californiaBalance;
    california.payments += a.effect.californiaTax - a.effect.californiaBalance;
  }

  // Headline income figures follow the (propagated) workpaper lines where the sums are linear.
  const numOr = (k: string, fallback: number | undefined) => (typeof value(k) === "number" ? (value(k) as number) : fallback);
  federal.agi = numOr("F1040.11", federal.agi);
  federal.taxable_income = numOr("F1040.15", federal.taxable_income);
  california.total_agi = numOr("F540NR.17", california.total_agi);
  california.ca_agi = numOr("F540NR.32", california.ca_agi);

  // Verifications. Line verifications go stale when the value changes (new version or adjustment).
  // Value verifications follow their anchor to a corrected successor document (D30 -> D31).
  const lineStatus = new Map<string, ItemStatus>();
  const evStatus = new Map<string, ItemStatus>();
  const evByAnchor = new Map<string, string>();
  for (const e of p.extracted_values) { const d = ix.docs.get(e.document_id)!; if (!ix.supersededBy.has(d.id)) evByAnchor.set(evAnchor(d, e), e.id); }
  for (const e of of("verification.recorded")) {
    if (vi.lines.has(e.target) || lineValues.has(e.target)) {
      const cur = value(e.target);
      const ok = same(cur, e.payload.seenValue);
      const st = lineStatus.get(e.target) ?? { status: "unverified", verifications: [] };
      const v: Verification = { event: e, current: ok };
      st.verifications.push(v);
      st.latest = v;
      st.status = ok ? "verified" : "stale";
      st.reason = ok ? undefined : `Value changed from ${JSON.stringify(e.payload.seenValue)} to ${JSON.stringify(cur)} since verified`;
      lineStatus.set(e.target, st);
      continue;
    }
    let evId = e.target;
    let carriedFrom: string | undefined;
    const orig = ix.evs.get(e.target);
    const origDoc = orig && ix.docs.get(orig.document_id);
    const succ = origDoc && ix.supersededBy.get(origDoc.id);
    if (succ && visibleDocs.has(succ)) {
      const mapped = (e.anchor && evByAnchor.get(e.anchor)) || ix.evByDocField.get(`${succ}#${orig!.field}`)?.id;
      if (mapped) { carriedFrom = e.target; evId = mapped; }
    } else if (!orig && e.anchor) {
      const mapped = evByAnchor.get(e.anchor);
      if (mapped) { carriedFrom = e.target; evId = mapped; }
    }
    const curEv = ix.evs.get(evId);
    const corr = correctionsByTarget.get(evId);
    const curVal = corr ? corr.to : curEv?.value;
    const ok = same(curVal, e.payload.seenValue);
    const st = evStatus.get(evId) ?? { status: "unverified", verifications: [] };
    const v: Verification = { event: e, current: ok, carriedFrom };
    st.verifications.push(v);
    st.latest = v;
    st.status = !ok ? "stale" : carriedFrom ? "carried" : "verified";
    st.reason = !ok
      ? `${carriedFrom ? `Verified on ${carriedFrom}; the corrected document reads ` : "Value is now "}${JSON.stringify(curVal)} (was ${JSON.stringify(e.payload.seenValue)}) — re-verify`
      : carriedFrom ? `Carried from ${carriedFrom} (superseded document); value unchanged` : undefined;
    evStatus.set(evId, st);
  }

  // Notes and questions.
  const notes = new Map<string, Note>();
  for (const e of active) {
    if (e.type === "note.opened") {
      const pl = e.payload as Payload<"note.opened">;
      notes.set(pl.noteId, { id: pl.noteId, target: e.target, kind: pl.kind, visibility: pl.visibility, text: pl.text, author: e.actorId, at: e.at, simAt: e.simAt, assignee: pl.assignee, replies: [], seq: e.seq });
    } else if (e.type === "note.replied") {
      const pl = e.payload as Payload<"note.replied">;
      notes.get(pl.noteId)?.replies.push({ author: e.actorId, text: pl.text, at: e.simAt });
    } else if (e.type === "note.resolved") {
      const pl = e.payload as Payload<"note.resolved">;
      const n = notes.get(pl.noteId);
      if (n) n.resolved = { by: e.actorId, text: pl.text, at: e.simAt };
    }
  }
  const questions = new Map<string, Question>();
  for (const e of of("question.asked")) questions.set(e.payload.questionId, { id: e.payload.questionId, target: e.target, to: e.payload.to, from: e.actorId, text: e.payload.text, at: e.simAt, evidence: e.payload.evidence, seq: e.seq });
  for (const e of of("question.answered")) {
    const q = questions.get(e.payload.questionId);
    if (q) q.answer = { by: e.actorId, text: e.payload.text, at: e.simAt, attachmentIds: e.payload.attachmentIds };
  }

  // Who prepared each area (anyone who verified/adjusted/judged inside it).
  const areaPreparers = new Map<string, Set<string>>();
  for (const e of active) {
    if (!["verification.recorded", "adjustment.made", "judgment.recorded"].includes(e.type)) continue;
    const a = targetArea(ix, e.target);
    if (!a) continue;
    const s = areaPreparers.get(a) ?? new Set<string>();
    s.add(e.actorId);
    areaPreparers.set(a, s);
  }
  for (const e of of("signoff.given")) if (e.payload.level === "preparer") {
    const s = areaPreparers.get(e.target) ?? new Set<string>();
    s.add(e.actorId);
    areaPreparers.set(e.target, s);
  }

  const judgments = of("judgment.recorded");
  const docDispositions = new Map<string, WpEvent<"judgment.recorded">>();
  for (const j of judgments) if (j.payload.kind === "doc_disposition") docDispositions.set(j.target, j);

  // Filing lifecycle.
  const results = of("efile.result");
  const submissions = of("return.submitted");
  const lastSubmission = submissions.at(-1);
  const after = (e: WpEvent) => !lastSubmission || e.seq > lastSubmission.seq;
  const accepted = {
    federal: results.find((r) => r.payload.jurisdiction === "federal" && r.payload.status === "accepted"),
    california: results.find((r) => r.payload.jurisdiction === "california" && r.payload.status === "accepted"),
  };
  const lastRejection = [...results].reverse().find((r) => r.payload.status === "rejected");
  const pendingResults = lastSubmission ? results.filter((r) => r.seq > lastSubmission.seq) : [];
  const inTransit = !!lastSubmission && !accepted.federal && !pendingResults.some((r) => r.payload.status === "rejected");
  const amendment = of("amendment.opened").at(-1);
  const frozen = !!accepted.federal || inTransit;
  const acceptedSubmission = accepted.federal ? [...submissions].reverse().find((s) => s.seq < accepted.federal!.seq) : undefined;
  const clientApproval = of("client.approved").at(-1);

  // Area content hashes: a sign-off records the hash; any later change to the area reopens it.
  const areaHash = new Map<string, string>();
  for (const area of AREAS) {
    const content = rv.lines.filter((l) => areaForLine(l.key) === area.id).map((l) => [l.key, value(l.key)]);
    const adjIds = adjustments.filter((a) => targetArea(ix, a.key) === area.id).map((a) => a.event.id);
    const judg = judgments.filter((j) => targetArea(ix, j.target) === area.id).map((j) => j.id);
    areaHash.set(area.id, stableHash({ version, content, adjIds, judg }));
  }
  const signoffEvents = of("signoff.given");
  const latestSignoff = new Map<string, WpEvent<"signoff.given">>();
  for (const s of signoffEvents) latestSignoff.set(`${s.target}|${s.payload.level}`, s);
  const signoffs: SignoffState[] = [...latestSignoff.values()].map((s) => {
    const valid = areaHash.get(s.target) === s.payload.hash;
    const changes = valid ? [] : active
      .filter((e) => e.seq > s.seq && ["adjustment.made", "judgment.recorded"].includes(e.type) && targetArea(ix, e.target) === s.target)
      .map((e) => `${e.type === "adjustment.made" ? "Adjusted" : "Judgment on"} ${e.target} by ${e.actorId}`);
    if (!valid && !changes.length) changes.push("Area content changed (new return version or a change was undone)");
    return { area: s.target, level: s.payload.level, event: s, valid, changes };
  });

  const sensitiveViews = of("sensitive.viewed");
  const timeByArea = new Map<string, number>();
  for (const e of of("time.logged")) timeByArea.set(e.target, (timeByArea.get(e.target) ?? 0) + e.payload.hours);

  const assignments: WorkpaperState["assignments"] = { ...p.firm.assignment_at_start };
  for (const e of of("assignment.changed")) { assignments[e.payload.role] = e.payload.staffId; if (e.payload.due) assignments.due = e.payload.due; }

  const docUses = new Map<string, DocUse>();
  for (const d of p.documents) if (visibleDocs.has(d.id)) docUses.set(d.id, docUse(ix, d.id, version));

  const partial: WorkpaperState = {
    asOf, version, vi, phase: "preparation", events: allEvents, activeEvents: active, voided, visibleDocs,
    adjustments, adjustmentsByKey, correctionsByTarget, lineValues, value, lineStatus, evStatus,
    notes: [...notes.values()], questions: [...questions.values()], judgments, elections,
    attachments: of("attachment.added"), signoffs, areaHash, areaPreparers,
    totals: { federal, california, engineFederal: rv.summary.federal, engineCalifornia: rv.summary.california, estimated: adjustmentsByKey.size > 0 },
    filing: {
      extension: of("return.extension_filed").at(-1), clientApproval,
      approvalValid: !!clientApproval && clientApproval.payload.hash === stableHash({ f: federal.balance_due, c: california.balance_due, version }),
      efileSigned: of("efile.signed"), submissions, results, accepted, lastRejection: lastRejection && after(lastRejection) && !accepted.federal ? lastRejection : undefined,
      inTransit, frozen, filedSnapshot: acceptedSubmission?.payload.snapshot as Snapshot | undefined, amendment, agency: of("agency.recorded"),
    },
    checks: [], docUses, docDispositions, variances: [], outside: [], steps: [],
    gate: { canPresent: false, canSubmit: false, blockers: [] },
    timeByArea, sensitiveViews, standards, assignments,
    sinceLastSeen: opts.lastSeenSeq != null ? active.filter((e) => e.seq > opts.lastSeenSeq! && e.actorId !== opts.actorId && e.type !== "sensitive.viewed") : [],
    household: p.household,
    remapped, orphaned,
  };

  partial.checks = runChecks(ix, partial, opts.lots);
  partial.variances = variances(ix, partial);
  partial.outside = outsideFilings(partial);
  const { steps, gate } = stepsAndGate(ix, partial);
  partial.steps = steps;
  partial.gate = gate;
  partial.phase = phaseOf(partial, ix);
  return partial;
}

// ---------- completeness, variance, gate ----------

function variances(ix: PacketIndex, s: WorkpaperState): Variance[] {
  const py = ix.packet.prior_years.return_2024;
  const vr = s.standards.variance_review;
  const out: Variance[] = [];
  for (const [key, priorRaw] of Object.entries(py.lines)) {
    if (typeof priorRaw !== "number" || key.startsWith("CA540")) continue;
    const curRaw = s.value(key);
    if (curRaw == null || typeof curRaw !== "number") continue;
    const delta = curRaw - priorRaw;
    const pct = priorRaw === 0 ? (delta === 0 ? 0 : Infinity) : (delta / Math.abs(priorRaw)) * 100;
    if (Math.abs(delta) > vr.and_over_amount && Math.abs(pct) > vr.flag_if_change_over_percent) {
      out.push({
        key, label: py.line_labels[key] ?? key, prior: priorRaw, current: curRaw, delta, pct,
        explanation: s.judgments.filter((j) => j.payload.kind === "variance" && j.target === key).at(-1),
      });
    }
  }
  return out;
}

function outsideFilings(s: WorkpaperState): OutsideFiling[] {
  const list: Omit<OutsideFiling, "disposition">[] = [
    { id: "fbar", title: "FinCEN 114 (FBAR) for the Sparbanken account", detail: "Maximum balance exceeds $10,000. Due 2026-10-15 (automatic extension); outside the engagement. Client files separately (per prior preparer).", evidence: ["D36", "ev-0962"] },
    { id: "1099nec", title: "Forms 1099-NEC to two contractors (late)", detail: "Mara Quintero 4,800 and Dev Patel 2,600 paid by ACH; due 2026-02-02; not filed (qa-23). Late-filing penalties apply.", evidence: ["D27", "qa-22", "qa-23", "call-01"] },
    { id: "f3520", title: "Form 3520 for the 2023 foreign inheritance", detail: "Erik inherited the Swedish account in 2023 (over $100,000 from a foreign person). The prior preparer left this open; no evidence it was filed. Penalty exposure is significant.", evidence: ["D36", "qa-07", "py:/prior_preparer_workpaper/open_items_left_by_prior_preparer/3"] },
    { id: "ada", title: "Ada's own 2025 Form 1040", detail: "Must check 'can be claimed as a dependent' and must not claim the education credit (claimed, then phased out, on this return).", evidence: ["household:ada", "D59"] },
    { id: "woodworks", title: "Lindqvist Family Woodworks 1120-S and Oregon composite", detail: "Prepared by Willamette CPA Group. Oregon tax 1,580 paid on Erik's behalf; included in distributions.", evidence: ["D39", "D40"] },
    { id: "ridgeline", title: "Ridgeline Real Estate Fund III 1065 and Arizona composite", detail: "Fund administrator filed the Arizona composite; no Arizona filing required by the partner.", evidence: ["D37", "D38"] },
    { id: "estimates2026", title: "2026 estimated payments (federal; California only for CA-source income)", detail: "Safe harbor 110% of 2025 tax. See the roll-forward plan.", evidence: [] },
  ];
  return list.map((o) => ({ ...o, disposition: s.judgments.filter((j) => j.payload.kind === "outside_filing" && j.target === `outside:${o.id}`).at(-1) }));
}

function stepsAndGate(ix: PacketIndex, s: WorkpaperState) {
  const stepDone = (id: string) => s.activeEvents.some((e) => e.type === "step.completed" && e.target === `step:${id}`);
  const docsOpen = [...s.docUses.entries()].filter(([id, u]) => (u.kind === "not_used" || u.kind === "supporting") && !s.docDispositions.has(id) && u.kind === "not_used");
  const variancesOpen = s.variances.filter((v) => !v.explanation);
  const checksOpen = s.checks.filter((c) => c.status === "open" && c.severity !== "info" && !c.coveredBy);
  const estChecks = s.checks.filter((c) => c.id === "est-fed" || c.id === "est-ca");
  const carry = s.checks.find((c) => c.id === "carryovers");
  const signedAll = (level: SignoffState["level"]) => AREAS.every((a) => s.signoffs.some((x) => x.area === a.id && x.level === level && x.valid));
  const missing = (level: SignoffState["level"]) => AREAS.filter((a) => !s.signoffs.some((x) => x.area === a.id && x.level === level && x.valid)).length;
  const bigUnapproved = s.adjustments.filter((a) => a.needsPartner && !a.approvals.length);
  const dd = s.judgments.some((j) => j.payload.kind === "due_diligence");
  const openReview = s.notes.filter((n) => n.kind === "review" && !n.resolved);
  const outsideOpen = s.outside.filter((o) => !o.disposition);

  const steps: Step[] = [
    { label: "Engagement letter and consents signed", done: s.visibleDocs.has("D01") && s.visibleDocs.has("D02"), auto: true, detail: "D01 engagement letter, D02 §7216 consent", target: "D01" },
    { label: "Identity verified", done: stepDone("identity"), auto: false, detail: "Driver licenses D04/D05, IP PIN notice D03", target: "step:identity" },
    { label: "Prior-year return reviewed", done: stepDone("prior-year"), auto: false, detail: "2024 return (D06) and prior preparer file (D07)", target: "step:prior-year" },
    { label: "All documents accounted for", done: docsOpen.length === 0, auto: true, detail: docsOpen.length ? `${docsOpen.length} document(s) not used and not dispositioned` : "Every document used, superseded, duplicate or dispositioned" },
    { label: "Prior-year variances explained", done: variancesOpen.length === 0, auto: true, detail: `${variancesOpen.length} of ${s.variances.length} unexplained` },
    { label: "Carryovers agreed to prior year", done: !!carry && carry.status !== "open", auto: true, detail: carry?.summary ?? "" },
    { label: "Estimated payments agreed to IRS and FTB records", done: estChecks.length > 0 && estChecks.every((c) => c.status !== "open"), auto: true, detail: estChecks.map((c) => `${c.title}: ${c.status}`).join("; ") },
    { label: "Due diligence completed", done: dd, auto: true, detail: "Form 8867 for CTC/ODC (record as a due-diligence judgment)", target: "F8867.status" },
    { label: "Diagnostics resolved", done: checksOpen.length === 0, auto: true, detail: `${checksOpen.length} open check(s)/diagnostic(s)` },
    { label: "Reviewer sign-off", done: signedAll("reviewer"), auto: true, detail: `${missing("reviewer")} area(s) without a current reviewer sign-off` },
    { label: "Partner sign-off", done: signedAll("partner") && bigUnapproved.length === 0, auto: true, detail: `${missing("partner")} area(s) unsigned; ${bigUnapproved.length} adjustment(s) over threshold awaiting partner` },
    { label: "Client approval and e-file authorization", done: s.filing.approvalValid && s.filing.efileSigned.length > 0, auto: true, detail: s.filing.clientApproval && !s.filing.approvalValid ? "Return changed after the client approved: re-approval required" : "Client approves the return and signs Forms 8879" },
  ];
  const blockers: string[] = [];
  steps.slice(0, 11).forEach((st) => { if (!st.done) blockers.push(st.label); });
  if (openReview.length) blockers.push(`${openReview.length} open review note(s)`);
  if (outsideOpen.length) blockers.push(`${outsideOpen.length} outside filing(s) not dispositioned`);
  const canPresent = blockers.length === 0;
  const canSubmit = canPresent && steps[11].done;
  if (canPresent && !steps[11].done) blockers.push("Client approval and e-file authorization");
  void ix;
  return { steps, gate: { canPresent, canSubmit, blockers } };
}

function phaseOf(s: WorkpaperState, ix: PacketIndex): Phase {
  const notice = ix.packet.tax_agency_records.notices.find((n) => n.tax_year === 2025) as { dated?: string } | undefined;
  if (s.filing.amendment) return "amending";
  if (s.filing.accepted.federal) return notice?.dated && s.asOf >= notice.dated ? "examination" : "filed";
  if (s.filing.inTransit) return "filing";
  if (s.filing.lastRejection) return "rejected";
  if (s.gate.canPresent) return "client_approval";
  if (s.signoffs.some((x) => x.level === "preparer")) return "review";
  if (s.asOf < (ix.packet.return_versions[0]?.computed_at ?? "")) return "intake";
  return "preparation";
}

export function snapshotOf(s: WorkpaperState): Snapshot {
  const lines: Record<string, Json> = {};
  for (const [k, v] of s.lineValues) lines[k] = v.workpaper;
  return {
    version: s.version, federal: s.totals.federal, california: s.totals.california, lines,
    adjustments: [...s.adjustmentsByKey.values()].map((a) => a.event.id), at: s.asOf,
  };
}

export function approvalHash(s: WorkpaperState): string {
  return stableHash({ f: s.totals.federal.balance_due, c: s.totals.california.balance_due, version: s.version });
}
