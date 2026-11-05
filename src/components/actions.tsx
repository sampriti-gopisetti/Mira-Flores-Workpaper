"use client";

import { useState } from "react";
import { CheckCircle2, Pencil, MessageSquarePlus, HelpCircle, Paperclip, Scale } from "lucide-react";
import { useStore, uid, type Draft } from "@/client/store";
import { taxEffect } from "@/domain/taxEffect";
import { num, formatLineValue, signedMoney } from "@/domain/format";
import type { Json } from "@/domain/types";
import { Button, Field, Modal, inputCls, Blocked } from "./ui";
import { Effect } from "./wp";

type Kind = "verify" | "adjust" | "correct" | "note" | "ask" | "attach" | "judgment";

const VERIFY_LABEL: Record<string, string> = {
  agreed_to_source_document: "Agreed to source document",
  recalculated: "Recalculated",
  confirmed_with_client: "Confirmed with client",
  agreed_to_prior_year: "Agreed to prior year",
  agreed_to_third_party_record: "Agreed to third-party record (IRS/FTB)",
};
export const verifyLabel = (m: string) => VERIFY_LABEL[m] ?? m.replace(/_/g, " ");

export function ItemActions({ target, value, isLine, isText, defaultEvidence = [] }: {
  target: string; value: Json; isLine: boolean; isText?: boolean; defaultEvidence?: string[];
}) {
  const { allowed } = useStore();
  const [open, setOpen] = useState<Kind | null>(null);
  const probe = (type: Draft["type"], payload: Record<string, unknown> = {}) => allowed({ type, target, payload: { reason: "x", ...payload } });
  return (
    <>
      <div className="flex flex-wrap gap-1.5">
        <Button size="sm" decision={probe("verification.recorded")} onClick={() => setOpen("verify")}><CheckCircle2 size={13} />Verify</Button>
        {isLine && !isText && <Button size="sm" decision={probe("adjustment.made")} onClick={() => setOpen("adjust")}><Pencil size={13} />Adjust</Button>}
        {(!isLine || isText) && <Button size="sm" decision={probe("adjustment.made")} onClick={() => setOpen("correct")}><Pencil size={13} />Correct</Button>}
        <Button size="sm" decision={probe("note.opened")} onClick={() => setOpen("note")}><MessageSquarePlus size={13} />Note</Button>
        <Button size="sm" decision={probe("question.asked")} onClick={() => setOpen("ask")}><HelpCircle size={13} />Ask</Button>
        <Button size="sm" decision={probe("attachment.added")} onClick={() => setOpen("attach")}><Paperclip size={13} />Attach</Button>
        <Button size="sm" decision={probe("judgment.recorded", { kind: "judgment", authority: "x" })} onClick={() => setOpen("judgment")}><Scale size={13} />Judgment</Button>
      </div>
      {open && <ActionModal kind={open} target={target} value={value} defaultEvidence={defaultEvidence} onClose={() => setOpen(null)} />}
    </>
  );
}

export function ActionModal({ kind, target, value, onClose, defaultEvidence = [], preset }: {
  kind: Kind; target: string; value: Json; onClose: () => void; defaultEvidence?: string[];
  preset?: { kind?: string; decision?: string; authority?: string; whatIfId?: string; text?: string; to?: string };
}) {
  const { wp, emit, actors, allowed, actor, toast } = useStore();
  const [method, setMethod] = useState(wp.standards.verification_types[0]);
  const [note, setNote] = useState(preset?.text ?? "");
  const [to, setTo] = useState(preset?.to ?? (typeof value === "number" ? String(value) : String(value ?? "")));
  const [evidence, setEvidence] = useState(defaultEvidence.join(", "));
  const [noteKind, setNoteKind] = useState<"review" | "info">("review");
  const [visibility, setVisibility] = useState<"internal" | "client">("internal");
  const [assignee, setAssignee] = useState("");
  const [askTo, setAskTo] = useState("client");
  const [jKind, setJKind] = useState(preset?.kind ?? "judgment");
  const [decision, setDecision] = useState(preset?.decision ?? "");
  const [authority, setAuthority] = useState(preset?.authority ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const refs = evidence.split(",").map((s) => s.trim()).filter(Boolean);
  const line = wp.vi.lines.get(target);
  const engine = line?.value ?? value;
  const effect = kind === "adjust" ? taxEffect(target, num(to) - num(engine), wp.vi.version) : null;
  const needsPartner = effect && Math.max(Math.abs(effect.federalBalance), Math.abs(effect.californiaBalance), Math.abs(effect.federalTax), Math.abs(effect.californiaTax)) > wp.standards.partner_threshold;

  let draft: Draft | null = null;
  if (kind === "verify") draft = { type: "verification.recorded", target, payload: { method, note, seenValue: value, version: wp.version, evidence: refs } };
  if (kind === "adjust") draft = { type: "adjustment.made", target, payload: { from: engine, to: num(to), reason: note, version: wp.version, evidence: refs } };
  if (kind === "correct") draft = { type: "adjustment.made", target, payload: { from: value, to, reason: note, version: wp.version, evidence: refs, kind: "correction" } };
  if (kind === "note") draft = { type: "note.opened", target, payload: { noteId: uid(), kind: noteKind, text: note, visibility, ...(assignee ? { assignee } : {}) } };
  if (kind === "ask") draft = { type: "question.asked", target, payload: { questionId: uid(), to: askTo, text: note, evidence: refs } };
  if (kind === "judgment") draft = { type: "judgment.recorded", target, payload: { kind: jKind, decision, authority, rationale: note, evidence: refs, ...(preset?.whatIfId ? { whatIfId: preset.whatIfId } : {}) } };
  if (kind === "attach") draft = { type: "attachment.added", target, payload: { attachmentId: "pending", name: file?.name ?? "file", note } };
  const d = draft ? allowed(draft) : { ok: false as const, reason: "" };

  async function submit() {
    if (!draft) return;
    setBusy(true);
    try {
      let final = draft;
      if (kind === "attach") {
        if (!file) return;
        const fd = new FormData();
        fd.append("file", file);
        const r = await fetch("/api/attachments", { method: "POST", body: fd, headers: { "x-actor": actor.id } });
        const body = await r.json();
        if (!r.ok) { toast({ text: body.error ?? "Upload failed", kind: "error" }); return; }
        final = { ...draft, payload: { ...draft.payload, attachmentId: body.id, name: body.name } };
      }
      const ok = await emit([final], { label: { verify: "Verified", adjust: "Adjustment recorded", correct: "Correction recorded", note: "Note added", ask: "Question sent", judgment: "Judgment recorded", attach: "File attached" }[kind] });
      if (ok) onClose();
    } finally { setBusy(false); }
  }

  const title = { verify: "Record verification", adjust: "Adjust (original kept)", correct: "Correct a value (original kept)", note: "Add a note", ask: "Ask a question", attach: "Attach evidence", judgment: "Record a judgment" }[kind];
  return (
    <Modal open onClose={onClose} title={`${title} · ${target}`}>
      <div className="space-y-3">
        {kind === "verify" && (
          <>
            <Field label="How was it verified?">
              <select className={inputCls} value={method} onChange={(e) => setMethod(e.target.value)}>
                {wp.standards.verification_types.map((m) => <option key={m} value={m}>{verifyLabel(m)}</option>)}
              </select>
            </Field>
            <p className="text-xs text-slate-500">Records the value you saw ({formatLineValue(target, value)}). If it changes later — a new engine version, an adjustment, a corrected document — this verification goes stale and asks to be redone.</p>
          </>
        )}
        {kind === "adjust" && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Engine value"><div className="rounded-md bg-slate-50 px-2.5 py-1.5 text-sm tabular-nums">{formatLineValue(target, engine)}</div></Field>
              <Field label="Workpaper value"><input className={inputCls} value={to} onChange={(e) => setTo(e.target.value)} inputMode="decimal" autoFocus /></Field>
            </div>
            {effect && (
              <div className="rounded-md bg-slate-50 p-2 text-xs">
                <div className="flex items-center justify-between"><span>Change {signedMoney(num(to) - num(engine))}</span><Effect f={effect.federalBalance} c={effect.californiaBalance} /></div>
                <div className="mt-1 text-slate-500">{effect.basis}{effect.large && " · large change: thresholds may be crossed; the engine should recompute"}</div>
                {needsPartner && <div className="mt-1 font-medium text-amber-700">Over {wp.standards.partner_threshold}: requires partner approval before filing.</div>}
              </div>
            )}
          </>
        )}
        {kind === "correct" && <Field label="Correct value"><input className={inputCls} value={to} onChange={(e) => setTo(e.target.value)} autoFocus /></Field>}
        {kind === "note" && (
          <div className="grid grid-cols-3 gap-2">
            <Field label="Type">
              <select className={inputCls} value={noteKind} onChange={(e) => setNoteKind(e.target.value as "review" | "info")}>
                <option value="review">Review note (blocks filing)</option><option value="info">Info</option>
              </select>
            </Field>
            <Field label="Assign to">
              <select className={inputCls} value={assignee} onChange={(e) => setAssignee(e.target.value)}>
                <option value="">—</option>{actors.filter((a) => ["preparer", "reviewer", "partner"].includes(a.role)).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </Field>
            <Field label="Visible to">
              <select className={inputCls} value={visibility} onChange={(e) => setVisibility(e.target.value as "internal" | "client")}>
                <option value="internal">Firm only</option><option value="client">Client too</option>
              </select>
            </Field>
          </div>
        )}
        {kind === "ask" && (
          <Field label="To">
            <select className={inputCls} value={askTo} onChange={(e) => setAskTo(e.target.value)}>
              <option value="client">Client (Ngozi & Erik)</option>
              {actors.filter((a) => ["preparer", "reviewer", "partner", "firm_administrator"].includes(a.role)).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </Field>
        )}
        {kind === "judgment" && (
          <>
            <Field label="Kind">
              <select className={inputCls} value={jKind} onChange={(e) => setJKind(e.target.value)}>
                {["judgment", "election", "penalty", "due_diligence", "check_disposition", "doc_disposition", "variance", "outside_filing"].map((k) => <option key={k} value={k}>{k.replace("_", " ")}</option>)}
              </select>
            </Field>
            <Field label="Decision"><input className={inputCls} value={decision} onChange={(e) => setDecision(e.target.value)} autoFocus /></Field>
            <Field label="Authority relied on" hint="Firm standard: every judgment call records its authority (code section, regulation, ruling, form instructions).">
              <input className={inputCls} value={authority} onChange={(e) => setAuthority(e.target.value)} placeholder="e.g. Treas. Reg. §1.263(a)-3(k)" />
            </Field>
          </>
        )}
        {kind === "attach" && <Field label="File"><input type="file" className="text-sm" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></Field>}
        <Field label={kind === "adjust" || kind === "correct" ? "Reason (required)" : kind === "judgment" ? "Rationale" : kind === "verify" ? "Note" : "Text"}>
          <textarea className={inputCls} rows={3} value={note} onChange={(e) => setNote(e.target.value)} autoFocus={["note", "ask"].includes(kind)} />
        </Field>
        {["verify", "adjust", "correct", "ask", "judgment"].includes(kind) && (
          <Field label="Evidence (references, comma-separated)" hint="ev-0016, D08, qa-25, msg-07, agency:/ftb_account, py:/…">
            <input className={inputCls} value={evidence} onChange={(e) => setEvidence(e.target.value)} />
          </Field>
        )}
        <div className="flex items-center justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={busy || (kind === "attach" && !file)} decision={d} onClick={submit}>Save</Button>
        </div>
        <Blocked decision={d} />
      </div>
    </Modal>
  );
}
