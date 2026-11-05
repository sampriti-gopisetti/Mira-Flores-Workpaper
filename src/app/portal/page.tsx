"use client";

import { useState } from "react";
import { Upload, CheckCircle2, PenLine } from "lucide-react";
import { useStore } from "@/client/store";
import { approvalHash } from "@/domain/project";
import { money } from "@/domain/format";
import { Badge, Button, Card, Field, PageHeader, inputCls, Blocked } from "@/components/ui";
import { ActorName } from "@/components/wp";

export default function Portal() {
  const { wp, ix, actor, emit, allowed, toast } = useStore();
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [files, setFiles] = useState<Record<string, File | null>>({});
  const [pin, setPin] = useState("");
  const staffPreview = actor.role !== "client";
  const qs = wp.questions.filter((q) => q.to === "client");
  const notes = wp.notes.filter((n) => n.visibility === "client");
  const f = wp.totals.federal, c = wp.totals.california;
  const approveDraft = { type: "client.approved" as const, target: "return", payload: { federalBalance: f.balance_due, californiaBalance: c.balance_due, hash: approvalHash(wp) } };
  const dApprove = allowed(approveDraft);
  const signDraft = { type: "efile.signed" as const, target: "return", payload: { form: "8879 + FTB 8879", pinLast: pin.slice(-2) } };
  const dSign = allowed(signDraft);

  async function upload(file: File) {
    const fd = new FormData();
    fd.append("file", file);
    const r = await fetch("/api/attachments", { method: "POST", body: fd, headers: { "x-actor": actor.id } });
    const b = await r.json();
    if (!r.ok) { toast({ text: b.error, kind: "error" }); return null; }
    return b as { id: string; name: string };
  }
  async function answer(qid: string, target: string) {
    const file = files[qid];
    const att = file ? await upload(file) : null;
    const evs = [{ type: "question.answered" as const, target, payload: { questionId: qid, text: answers[qid] ?? "", attachmentIds: att ? [att.id] : [] } }];
    if (att) evs.push({ type: "attachment.added", target, payload: { attachmentId: att.id, name: att.name, note: "Uploaded with answer" } } as never);
    await emit(evs, { label: "Answer sent — it becomes evidence in the workpaper" });
  }
  const py = ix.packet.prior_years.return_2024.lines;
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <PageHeader title={`Hi ${actor.role === "client" ? actor.name.split(" ")[0] : "— client view preview"}`} sub="Your 2025 federal and California returns with Miraflores." />
      {staffPreview && <p className="rounded bg-sky-50 p-2 text-xs text-sky-800">You are previewing what the client sees. Internal notes, view logs and time are never sent to the client's browser.</p>}
      <Card title="Where things stand">
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div><div className="text-xs text-slate-500">Federal</div><div className="text-xl font-semibold">{f.balance_due >= 0 ? `${money(f.balance_due)} due` : `${money(-f.balance_due)} refund`}</div><div className="text-xs text-slate-500">2024: total tax {money(Number(py["F1040.24"]))}</div></div>
          <div><div className="text-xs text-slate-500">California</div><div className="text-xl font-semibold">{c.balance_due >= 0 ? `${money(c.balance_due)} due` : `${money(-c.balance_due)} refund`}</div></div>
        </div>
        <p className="mt-2 text-xs text-slate-500">Status: {wp.filing.accepted.federal ? "filed and accepted" : wp.gate.canPresent ? "ready for your review and approval" : "your preparer is still working on it"}{wp.totals.estimated ? " · amounts are estimates until final review" : ""}.</p>
      </Card>

      <Card title={`Questions for you (${qs.filter((q) => !q.answer).length} open)`}>
        {qs.length === 0 && <p className="text-sm text-slate-400">No questions right now.</p>}
        <div className="space-y-3">
          {qs.map((q) => (
            <div key={q.id} className="rounded-md border border-slate-200 p-3">
              <p className="text-sm">{q.text}</p>
              <p className="text-[11px] text-slate-400">from <ActorName id={q.from} /></p>
              {q.answer ? <p className="mt-1 flex items-center gap-1 text-sm text-emerald-700"><CheckCircle2 size={14} />You answered: {q.answer.text}</p> : (
                <div className="mt-2 space-y-2">
                  <textarea className={inputCls} rows={2} value={answers[q.id] ?? ""} onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })} />
                  <div className="flex items-center gap-2">
                    <input type="file" className="text-xs" onChange={(e) => setFiles({ ...files, [q.id]: e.target.files?.[0] ?? null })} />
                    <Button size="sm" variant="primary" className="ml-auto" disabled={!answers[q.id]} decision={allowed({ type: "question.answered", target: q.target, payload: { questionId: q.id } })} onClick={() => answer(q.id, q.target)}><Upload size={12} />Send</Button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </Card>

      {notes.length > 0 && (
        <Card title="Messages from your team">
          {notes.map((n) => <p key={n.id} className="border-b border-slate-100 py-1.5 text-sm">{n.text} <span className="text-[11px] text-slate-400">— <ActorName id={n.author} /></span></p>)}
        </Card>
      )}

      <Card title="What changed from the first draft">
        {wp.adjustments.length === 0 ? <p className="text-sm text-slate-400">No changes yet.</p> : (
          <ul className="space-y-1 text-sm">{wp.adjustments.filter((a) => typeof a.to === "number").map((a) => <li key={a.event.id}>• {a.event.payload.reason}</li>)}</ul>
        )}
      </Card>

      <Card title="Approve and sign">
        {wp.filing.approvalValid ? <p className="flex items-center gap-1 text-sm text-emerald-700"><CheckCircle2 size={14} />Approved {wp.filing.clientApproval && <>by <ActorName id={wp.filing.clientApproval.actorId} /></>}</p> : (
          <>
            {wp.filing.clientApproval && <Badge tone="amber">The return changed after your approval — please review again</Badge>}
            <Button className="mt-2" variant="primary" decision={dApprove} onClick={() => emit([approveDraft], { label: "Return approved" })}>Approve these amounts</Button>
            {!dApprove.ok && (actor.role === "client" ? <p className="mt-1 text-[11px] text-slate-500">Your team is finishing their review; we'll let you know when it's ready to approve.</p> : <Blocked decision={dApprove} />)}
          </>
        )}
        <div className="mt-3 flex items-end gap-2">
          <Field label="Your 5-digit e-file PIN (Form 8879)"><input className={inputCls + " w-32"} value={pin} maxLength={5} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} /></Field>
          <Button decision={dSign} disabled={pin.length !== 5 || wp.filing.efileSigned.some((e) => e.actorId === actor.id)} onClick={() => emit([signDraft], { label: "Form 8879 signed" })}><PenLine size={13} />Sign</Button>
        </div>
        <p className="mt-1 text-[11px] text-slate-500">Signed: {wp.filing.efileSigned.map((e) => e.actorId).join(", ") || "—"} (only the last two PIN digits are stored)</p>
        <Blocked decision={dSign} />
      </Card>
    </div>
  );
}
