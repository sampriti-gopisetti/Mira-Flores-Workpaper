"use client";

import Link from "next/link";
import clsx from "clsx";
import { useState } from "react";
import { Send, Lock, FilePlus2, Radio, CheckCircle2, Circle } from "lucide-react";
import { useStore, type Draft } from "@/client/store";
import { snapshotOf, stableHash, type Snapshot } from "@/domain/project";
import { money, shortDateTime } from "@/domain/format";
import { Badge, Button, Card, Field, Modal, PageHeader, inputCls, Blocked } from "@/components/ui";
import { ActorName, RefChip } from "@/components/wp";

function daysBetween(a: string, b: string) { return Math.max(0, Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86_400_000)); }

export default function Season() {
  const { ix, wp, emit, allowed, asOf, setAsOf } = useStore();
  const [amend, setAmend] = useState(false);
  const [reason, setReason] = useState("");
  const tl = ix.packet.timeline;
  const efile = ix.packet.tax_agency_records.efile;
  const theoFixed = [...wp.correctionsByTarget.keys()].some((k) => /^household:.*\.ssn$/.test(k));
  const ssnCheck = wp.checks.find((c) => c.id.startsWith("ssn-"));
  const lastSub = wp.filing.submissions.at(-1);
  const resultsForLast = lastSub ? wp.filing.results.filter((r) => r.seq > lastSub.seq) : [];
  const snap = (wp.filing.filedSnapshot ?? (lastSub?.payload.snapshot as Snapshot | undefined));

  const submitDraft: Draft = { type: "return.submitted", target: "return", payload: { snapshot: snapshotOf(wp), hash: stableHash(snapshotOf(wp)), jurisdictions: ["federal", "california"] } };
  const canSubmit = allowed(submitDraft);

  function acknowledge() {
    // The agencies' answer depends on the return as transmitted: a dependent TIN mismatch rejects.
    const fedReject = !theoFixed && !!ssnCheck;
    const f = efile.find((e) => e.jurisdiction === "federal" && e.status === (fedReject ? "rejected" : "accepted"))!;
    const c = efile.find((e) => e.jurisdiction === "california" && e.status === (fedReject ? "not_transmitted" : "accepted"))!;
    emit([
      { type: "efile.result", target: "return", payload: { jurisdiction: "federal", status: f.status, submissionId: f.submission_id, errors: f.errors ?? [] } },
      { type: "efile.result", target: "return", payload: { jurisdiction: "california", status: c.status, submissionId: c.submission_id, errors: c.errors ?? [] } },
    ], { label: fedReject ? "Federal e-file rejected (dependent TIN); state held" : "Both returns accepted — the return is frozen" });
  }

  const replayed = (id: string) => wp.filing.agency.some((a) => a.payload.timelineId === id) || (id === "extension-2026-04-14" && !!wp.filing.extension);
  const balance = snap?.federal.balance_due ?? wp.totals.federal.balance_due;
  const paidOn = tl.find((t) => t.event === "federal_balance_paid")?.at ?? "2026-07-20";
  const days = daysBetween("2026-04-15", paidOn);
  const months = Math.ceil(days / 30.44);
  const rate = Number(ix.packet.post_filing_rates.irs_underpayment_interest_rate_annual);
  const ftp = Number(ix.packet.post_filing_rates.irs_failure_to_pay_penalty_per_month);

  function replay(id: string) {
    const t = tl.find((x) => x.id === id)!;
    if (t.event === "extension_filed_with_payment") {
      return emit([{ type: "return.extension_filed", target: "return", payload: { federalPaid: 36000, californiaPaid: 0, note: t.detail ?? "" } }], { label: "Extension recorded (Form 4868 with 36,000)" });
    }
    const amount = t.event === "federal_balance_paid" ? Math.max(0, balance) : t.event === "california_refund_issued" ? Math.max(0, -(snap?.california.balance_due ?? wp.totals.california.balance_due)) : undefined;
    return emit([{ type: "agency.recorded", target: "return", payload: { what: t.event, detail: t.detail ?? "", ...(amount != null ? { amount } : {}), timelineId: id } }], { label: `${t.event.replace(/_/g, " ")} recorded` });
  }
  const REPLAYABLE = ["extension_filed_with_payment", "federal_balance_paid", "california_refund_issued", "notice_received", "irs_transcript_pulled", "quality_review_selected_return"];

  return (
    <div className="space-y-4">
      <PageHeader title="Season & filing" sub="Replay the season with the clock in the header. Filing freezes the return; changes after that go on an amendment layer." />
      <div className="grid gap-4 @4xl:grid-cols-[1fr_380px]">
        <Card title="Season timeline" pad={false}>
          <ol>
            {tl.map((t) => {
              const past = t.at <= asOf;
              return (
                <li key={t.id} className={clsx("flex items-start gap-3 border-b border-slate-100 px-3 py-2 text-sm", !past && "opacity-50")}>
                  {past ? <CheckCircle2 size={15} className="mt-0.5 text-emerald-600" /> : <Circle size={15} className="mt-0.5 text-slate-300" />}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="w-36 text-xs tabular-nums text-slate-500">{shortDateTime(t.at)}</span>
                      <span className="font-medium">{t.event.replace(/_/g, " ")}</span>
                      {t.actor && <span className="text-xs"><ActorName id={t.actor} /></span>}
                      {t.refs.map((r) => <RefChip key={r} r={r} compact />)}
                    </div>
                    {t.detail && <p className="mt-0.5 text-xs text-slate-500">{t.detail}</p>}
                  </div>
                  {!past && <Button size="sm" variant="ghost" onClick={() => setAsOf(new Date(new Date(t.at).getTime() + 60_000).toISOString())}>Jump</Button>}
                  {past && REPLAYABLE.includes(t.event) && (replayed(t.id) ? <Badge tone="green">recorded</Badge> :
                    <Button size="sm" decision={allowed({ type: t.event === "extension_filed_with_payment" ? "return.extension_filed" : "agency.recorded", target: "return", payload: {} })} onClick={() => replay(t.id)}><Radio size={12} />Record</Button>)}
                </li>
              );
            })}
          </ol>
        </Card>

        <div className="space-y-4">
          <div data-tour="filing"><Card title="Filing">
            <div className="space-y-2 text-sm">
              <div className="flex items-center justify-between"><span>Client approval</span>{wp.filing.approvalValid ? <Badge tone="green">approved</Badge> : wp.filing.clientApproval ? <Badge tone="amber">stale — re-approve</Badge> : <Badge>pending</Badge>}</div>
              <div className="flex items-center justify-between"><span>Form 8879 signatures</span><Badge tone={wp.filing.efileSigned.length ? "green" : "slate"}>{wp.filing.efileSigned.length ? "signed" : "pending"}</Badge></div>
              <div className="flex items-center justify-between"><span>Status</span><Badge tone={wp.filing.frozen ? "green" : wp.filing.lastRejection ? "red" : "slate"}>{wp.filing.accepted.federal ? "accepted · frozen" : wp.filing.inTransit ? "transmitted" : wp.filing.lastRejection ? "rejected" : "not filed"}</Badge></div>
            </div>
            {!wp.filing.inTransit && !wp.filing.accepted.federal && (
              <div className="mt-3">
                <Button variant="primary" decision={canSubmit} onClick={() => emit([submitDraft], { label: "Return transmitted (snapshot frozen)" })}><Send size={14} />Transmit federal & California</Button>
                <Blocked decision={canSubmit} />
                {!theoFixed && ssnCheck && <p className="mt-2 text-xs text-rose-700">Open check: {ssnCheck.summary}</p>}
              </div>
            )}
            {wp.filing.inTransit && resultsForLast.length === 0 && (
              <div className="mt-3">
                <p className="text-xs text-slate-500">Transmitted {shortDateTime(lastSub!.simAt)} by <ActorName id={lastSub!.actorId} />. Awaiting acknowledgment.</p>
                <Button className="mt-2" decision={allowed({ type: "efile.result", target: "return", payload: {} })} onClick={acknowledge}><Radio size={14} />Receive acknowledgment</Button>
              </div>
            )}
            {wp.filing.lastRejection && (
              <div className="mt-3 rounded-md border border-rose-200 bg-rose-50 p-2 text-xs">
                <p className="font-medium text-rose-800">Rejected: {wp.filing.lastRejection.payload.errors.map((e) => `${e.code} — ${e.message}`).join("; ")}</p>
                <p className="mt-1 text-rose-700">Fix it (Intake → Theo's SSN, per the Social Security card D71 or last year's return) and transmit again. Amounts unchanged, so the client's approval stands.</p>
              </div>
            )}
            {wp.filing.accepted.federal && (
              <div className="mt-3 space-y-2">
                <p className="flex items-center gap-1 text-xs text-emerald-700"><Lock size={12} />Frozen at filing. Federal {wp.filing.accepted.federal.payload.submissionId}{wp.filing.accepted.california && `, California ${wp.filing.accepted.california.payload.submissionId}`}.</p>
                {!wp.filing.amendment && <Button size="sm" decision={allowed({ type: "amendment.opened", target: "return", payload: {} })} onClick={() => setAmend(true)}><FilePlus2 size={12} />Open amendment</Button>}
                {wp.filing.amendment && <Badge tone="violet">Amendment open: {wp.filing.amendment.payload.layer} — {wp.filing.amendment.payload.reason}</Badge>}
              </div>
            )}
          </Card></div>
          {snap && (
            <Card title="As filed">
              <div className="grid grid-cols-2 gap-1 text-sm">
                <span className="text-slate-500">Federal total tax</span><span className="text-right tabular-nums">{money(snap.federal.total_tax)}</span>
                <span className="text-slate-500">Federal balance due</span><span className="text-right tabular-nums">{money(snap.federal.balance_due)}</span>
                <span className="text-slate-500">CA total tax</span><span className="text-right tabular-nums">{money(snap.california.total_tax)}</span>
                <span className="text-slate-500">CA {snap.california.balance_due < 0 ? "refund" : "balance"}</span><span className="text-right tabular-nums">{money(Math.abs(snap.california.balance_due))}</span>
              </div>
              {balance > 0 && (
                <p className="mt-2 rounded bg-amber-50 p-2 text-xs text-amber-800">
                  Extension of time to file is not an extension to pay. Balance {money(balance)} paid {paidOn.slice(0, 10)}: est. interest {money(balance * rate * days / 365)} ({days} days at {rate * 100}%) + failure-to-pay {money(balance * ftp * months)} ({months} months × {ftp * 100}%). The IRS computes the exact amount (transcript code 196/276).
                </p>
              )}
              <div className="mt-2 flex flex-wrap gap-2 text-xs"><Link href="/client-copy" className="text-indigo-700 hover:underline">Client copy →</Link><Link href="/exam" className="text-indigo-700 hover:underline">Notice response →</Link><Link href="/rollforward" className="text-indigo-700 hover:underline">Roll forward →</Link></div>
            </Card>
          )}
        </div>
      </div>
      <Modal open={amend} onClose={() => setAmend(false)} title="Open an amendment">
        <Field label="Reason"><textarea className={inputCls} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        <div className="mt-3 flex justify-end gap-2"><Button variant="ghost" onClick={() => setAmend(false)}>Cancel</Button>
          <Button variant="primary" disabled={!reason} onClick={() => emit([{ type: "amendment.opened", target: "return", payload: { layer: "amended-1", reason } }], { label: "Amendment layer opened" }).then(() => setAmend(false))}>Open</Button></div>
      </Modal>
    </div>
  );
}
