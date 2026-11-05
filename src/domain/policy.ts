import type { Actor } from "./actors";
import type { EventType } from "./events";
import { ALLOWED_AFTER_FILING } from "./events";
import type { PacketIndex } from "./packetIndex";
import { approvalHash, targetArea, type WorkpaperState } from "./project";

// One rule book, used by the API (enforced) and by the UI (to disable buttons
// and say why). The firm's standards (starter_standards.rules) are encoded here.

export type Decision = { ok: true } | { ok: false; reason: string };
const yes: Decision = { ok: true };
const no = (reason: string): Decision => ({ ok: false, reason });

export interface Proposed {
  type: EventType;
  target: string;
  payload: Record<string, unknown>;
}

const WORKERS = ["preparer", "reviewer", "partner"];
const CLIENT_TYPES: EventType[] = ["question.answered", "note.replied", "attachment.added", "client.approved", "efile.signed", "sensitive.viewed"];
const ADMIN_TYPES: EventType[] = ["standard.changed", "assignment.changed", "time.logged", "note.opened", "note.replied", "note.resolved",
  "sensitive.viewed", "step.completed", "agency.recorded", "efile.result", "return.extension_filed", "attachment.added"];
const QR_TYPES: EventType[] = ["note.opened", "note.replied", "note.resolved", "time.logged", "sensitive.viewed", "attachment.added"];
const REPLAY: EventType[] = ["agency.recorded", "efile.result", "return.extension_filed"];
const NEEDS_AUTHORITY = ["judgment", "election", "penalty", "check_disposition", "due_diligence"];

export function can(actor: Actor, ev: Proposed, s: WorkpaperState, ix: PacketIndex): Decision {
  const t = ev.type;
  if (actor.role === "examiner") return no("The examiner view is read-only.");
  if (actor.activeFrom && s.asOf.slice(0, 10) < actor.activeFrom) return no(`${actor.name} joins the firm on ${actor.activeFrom}.`);

  // Role gates
  if (actor.role === "client" && !CLIENT_TYPES.includes(t)) return no("Clients can answer questions, reply to shared notes, upload files and approve the return.");
  if (actor.role === "firm_administrator" && !ADMIN_TYPES.includes(t)) return no("The firm administrator manages standards, assignments and access; return work is done by the engagement team.");
  if (actor.role === "quality_reviewer" && !QR_TYPES.includes(t)) return no("Quality review can comment but not change the return.");
  if (WORKERS.includes(actor.role) && ["standard.changed", "assignment.changed"].includes(t) && actor.role !== "partner") return no("Only the firm administrator or partner manages standards and assignments.");

  // Frozen at filing: only post-filing work on the original layer.
  if (s.filing.frozen && !s.filing.amendment && !ALLOWED_AFTER_FILING.includes(t) && !REPLAY.includes(t) && t !== "event.voided") {
    return no(s.filing.inTransit ? "The return is with the agencies; wait for the acknowledgment." : "The return is filed and frozen. Open an amendment to change it.");
  }

  switch (t) {
    case "sensitive.viewed":
      if (actor.role === "client") return ev.target.startsWith("household:") || ev.target.startsWith("bank") ? yes : no("Clients can view their own household details only.");
      return actor.clearance ? yes : no(`${actor.name} has no sensitive-data clearance; SSNs, bank numbers and IP PINs stay masked.`);

    case "verification.recorded":
    case "adjustment.made":
      if (!WORKERS.includes(actor.role)) return no("Only the engagement team changes or verifies the return.");
      if (t === "adjustment.made" && !String(ev.payload.reason ?? "").trim()) return no("Every adjustment needs a reason.");
      return yes;

    case "adjustment.approved": {
      if (actor.role !== "partner") return no("Adjustments over the threshold need partner approval.");
      const adj = s.adjustments.find((a) => a.event.id === ev.payload.adjustmentId);
      if (!adj) return no("Adjustment not found (it may have been undone).");
      if (adj.event.actorId === actor.id) return no("A person may not approve their own adjustment.");
      return yes;
    }

    case "judgment.recorded": {
      if (!WORKERS.includes(actor.role)) return no("Only the engagement team records judgments.");
      const kind = String(ev.payload.kind);
      if (NEEDS_AUTHORITY.includes(kind) && !String(ev.payload.authority ?? "").trim()) return no("Every judgment call records the authority relied on (firm standard).");
      return yes;
    }

    case "signoff.given": {
      const level = String(ev.payload.level);
      const area = ev.target;
      const preparers = s.areaPreparers.get(area) ?? new Set<string>();
      const openReview = s.notes.filter((n) => n.kind === "review" && !n.resolved && targetArea(ix, n.target, s.checks) === area);
      if (openReview.length) return no(`${openReview.length} open review note(s) in this area.`);
      if (ev.payload.hash !== s.areaHash.get(area)) return no("The area changed since you loaded it; review the changes and sign again.");
      const valid = (lvl: string) => s.signoffs.some((x) => x.area === area && x.level === lvl && x.valid);
      if (level === "preparer") return WORKERS.includes(actor.role) ? yes : no("Only the engagement team can mark an area prepared.");
      if (level === "reviewer") {
        if (!["reviewer", "partner"].includes(actor.role)) return no("Reviewer sign-off needs a reviewer or partner.");
        if (preparers.has(actor.id)) return no("A person may not review or sign off on work they prepared (firm standard).");
        if (!valid("preparer")) return no("The preparer has not marked this area prepared (or it reopened).");
        return yes;
      }
      if (level === "partner") {
        if (actor.role !== "partner") return no("Partner sign-off needs the partner.");
        if (preparers.has(actor.id)) return no("A person may not review or sign off on work they prepared (firm standard).");
        if (!valid("reviewer")) return no("Reviewer sign-off is missing or reopened.");
        return yes;
      }
      return no("Unknown sign-off level.");
    }

    case "note.resolved": {
      const n = s.notes.find((x) => x.id === ev.payload.noteId);
      if (!n) return no("Note not found.");
      if (n.kind === "review" && n.author !== actor.id && actor.role !== "partner") return no("Review notes are cleared by the reviewer who raised them (or the partner).");
      return yes;
    }

    case "note.replied": {
      const n = s.notes.find((x) => x.id === ev.payload.noteId);
      if (!n) return no("Note not found.");
      if (actor.role === "client" && n.visibility !== "client") return no("Not visible to the client.");
      return yes;
    }

    case "question.answered": {
      const q = s.questions.find((x) => x.id === ev.payload.questionId);
      if (!q) return no("Question not found.");
      if (q.to === "client" ? actor.role !== "client" : q.to !== actor.id) return no("This question is addressed to someone else.");
      return yes;
    }

    case "client.approved":
      if (actor.role !== "client") return no("Only the client approves the return.");
      if (!s.gate.canPresent) return no("Your team is still reviewing the return; it isn't ready for approval yet.");
      if (ev.payload.hash !== approvalHash(s)) return no("The return changed; reload and review the new amounts.");
      return yes;

    case "efile.signed":
      if (actor.role !== "client") return no("Only taxpayers sign Form 8879.");
      if (!s.filing.approvalValid) return no("Approve the current return first.");
      return yes;

    case "return.submitted":
      if (!["reviewer", "partner"].includes(actor.role)) return no("The reviewer or partner transmits the return.");
      if (!s.gate.canSubmit) return no(`Cannot transmit: ${s.gate.blockers.join("; ") || "client approval and e-file authorization missing"}`);
      return yes;

    case "amendment.opened":
      if (actor.role !== "partner" && actor.role !== "reviewer") return no("Opening an amendment needs a reviewer or partner.");
      if (!s.filing.accepted.federal) return no("Only a filed return can be amended.");
      return yes;

    case "event.voided": {
      const ids = (ev.payload.eventIds as string[]) ?? [];
      const targets = s.events.filter((e) => ids.includes(e.id));
      if (!targets.length) return no("Nothing to undo.");
      if (targets.some((e) => e.type === "sensitive.viewed" || e.type === "return.submitted" || e.type === "efile.result")) return no("View logs and filings cannot be undone.");
      if (targets.some((e) => e.actorId !== actor.id) && actor.role !== "partner") return no("You can only undo your own actions.");
      if (s.filing.frozen && !s.filing.amendment) return no("The return is filed; history is frozen.");
      return yes;
    }

    case "step.completed":
    case "note.opened":
    case "question.asked":
    case "attachment.added":
    case "time.logged":
      return actor.role === "client" && t !== "attachment.added" ? no("Not available to clients.") : yes;

    default:
      return REPLAY.includes(t) && !["reviewer", "partner", "firm_administrator", "preparer"].includes(actor.role) ? no("Not permitted.") : yes;
  }
}
