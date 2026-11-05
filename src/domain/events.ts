import { z } from "zod";

// Every human (or replayed agency) action is one of these. Events are only ever
// appended; undo is itself an event (`event.voided`) that the projection honours.

const str = z.string().min(1);
const refs = z.array(z.string()).default([]);

export const PAYLOADS = {
  "verification.recorded": z.object({ method: str, note: z.string().default(""), seenValue: z.any(), version: str, evidence: refs }),
  "adjustment.made": z.object({
    from: z.any(), to: z.any(), reason: str, version: str, evidence: refs,
    checkId: z.string().optional(), kind: z.enum(["amount", "correction"]).default("amount"),
    /** for an item the engine omitted: the existing line it rolls into */
    parent: z.string().optional(),
  }),
  "adjustment.approved": z.object({ adjustmentId: str, note: z.string().default("") }),
  "note.opened": z.object({
    noteId: str, kind: z.enum(["review", "info"]), text: str, assignee: z.string().optional(),
    visibility: z.enum(["internal", "client"]).default("internal"),
  }),
  "note.replied": z.object({ noteId: str, text: str }),
  "note.resolved": z.object({ noteId: str, text: z.string().default("") }),
  "question.asked": z.object({ questionId: str, to: str, text: str, evidence: refs }),
  "question.answered": z.object({ questionId: str, text: str, attachmentIds: refs }),
  "attachment.added": z.object({ attachmentId: str, name: str, note: z.string().default("") }),
  "judgment.recorded": z.object({
    kind: z.enum(["judgment", "election", "penalty", "due_diligence", "outside_filing", "doc_disposition", "variance", "check_disposition"]),
    decision: str, authority: z.string().default(""), rationale: z.string().default(""),
    whatIfId: z.string().optional(), evidence: refs,
  }),
  "signoff.given": z.object({ level: z.enum(["preparer", "reviewer", "partner"]), hash: str, summary: z.string().default("") }),
  "step.completed": z.object({ note: z.string().default(""), evidence: refs }),
  "time.logged": z.object({ hours: z.number().positive().max(24), note: z.string().default("") }),
  "assignment.changed": z.object({ role: z.enum(["preparer", "reviewer", "partner"]), staffId: str, due: z.string().optional() }),
  "standard.changed": z.object({ path: str, value: z.any(), note: z.string().default("") }),
  "sensitive.viewed": z.object({ field: str, purpose: z.string().default("") }),
  "client.approved": z.object({ federalBalance: z.number(), californiaBalance: z.number(), hash: str }),
  "efile.signed": z.object({ form: str, pinLast: z.string().default("") }),
  "return.extension_filed": z.object({ federalPaid: z.number(), californiaPaid: z.number(), note: z.string().default("") }),
  "return.submitted": z.object({ snapshot: z.any(), hash: str, jurisdictions: z.array(z.string()) }),
  "efile.result": z.object({
    jurisdiction: str, status: z.enum(["accepted", "rejected", "not_transmitted"]), submissionId: z.string().default(""),
    errors: z.array(z.object({ code: z.string(), message: z.string() })).default([]),
  }),
  "amendment.opened": z.object({ layer: str, reason: str }),
  "agency.recorded": z.object({ what: str, detail: z.string().default(""), amount: z.number().optional(), timelineId: z.string().optional() }),
  "event.voided": z.object({ eventIds: z.array(str).min(1), reason: z.string().default("Undo") }),
} as const;

export type EventType = keyof typeof PAYLOADS;
export type Payload<T extends EventType> = z.infer<(typeof PAYLOADS)[T]>;

export interface WpEvent<T extends EventType = EventType> {
  seq: number;
  id: string;
  at: string;
  simAt: string;
  actorId: string;
  actorRole: string;
  type: T;
  target: string;
  anchor?: string | null;
  payload: Payload<T>;
  batchId?: string | null;
  layer: string;
  /** set by the projection when re-anchoring moved this event to a renumbered value */
  remappedFrom?: string;
}

export const NewEventSchema = z.object({
  id: str,
  type: z.enum(Object.keys(PAYLOADS) as [EventType, ...EventType[]]),
  target: str,
  anchor: z.string().nullish(),
  payload: z.record(z.any()),
  batchId: z.string().nullish(),
  simAt: str,
});
export type NewEvent = z.infer<typeof NewEventSchema>;

export function parsePayload(type: EventType, payload: unknown) {
  return PAYLOADS[type].parse(payload);
}

export const MUTATING: EventType[] = [
  "verification.recorded", "adjustment.made", "adjustment.approved", "note.opened", "note.replied", "note.resolved",
  "question.asked", "question.answered", "attachment.added", "judgment.recorded", "signoff.given", "step.completed",
  "client.approved", "efile.signed", "return.extension_filed", "return.submitted", "amendment.opened", "event.voided",
];

/** Event types still allowed on the original layer after the return is filed. */
export const ALLOWED_AFTER_FILING: EventType[] = [
  "note.opened", "note.replied", "note.resolved", "question.asked", "question.answered", "attachment.added",
  "time.logged", "sensitive.viewed", "efile.result", "amendment.opened", "agency.recorded", "standard.changed",
  "assignment.changed", "judgment.recorded", "step.completed",
];
