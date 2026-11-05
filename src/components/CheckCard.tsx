"use client";

import { useState } from "react";
import { Wand2, Gavel, ShieldCheck, Bot } from "lucide-react";
import { useStore, uid, type Draft } from "@/client/store";
import type { Check } from "@/domain/checks";
import type { WorkpaperState } from "@/domain/project";
import { formatLineValue } from "@/domain/format";
import { Badge, Button } from "./ui";
import { Effect, Refs, SEVERITY_TONE, STATUS_TONE } from "./wp";
import { ActionModal } from "./actions";

/** Turn a check's suggestion into concrete events (adjustments, verification or a client question). */
export function suggestionDrafts(c: Check, wp: WorkpaperState): Draft[] {
  const s = c.suggestion;
  if (!s) return [];
  if (s.adjustments?.length) {
    return s.adjustments.map((a) => ({
      type: "adjustment.made" as const, target: a.key,
      payload: {
        from: wp.vi.lines.get(a.key)?.value ?? null, to: a.to, reason: a.reason, version: wp.version, evidence: c.evidence,
        checkId: c.id, kind: a.kind ?? "amount", ...(a.parent ? { parent: a.parent } : {}),
      },
    }));
  }
  if (s.verify) {
    const cur = wp.lineValues.has(s.verify.target) ? wp.value(s.verify.target) : null;
    return [{ type: "verification.recorded", target: s.verify.target, payload: { method: s.verify.method, note: c.title, seenValue: cur ?? undefined, version: wp.version, evidence: s.verify.evidence } }];
  }
  if (s.question) return [{ type: "question.asked", target: `check:${c.id}`, payload: { questionId: uid(), to: s.question.to, text: s.question.text, evidence: c.evidence } }];
  return [];
}

export function CheckCard({ c, compact }: { c: Check; compact?: boolean }) {
  const { wp, ix, emit, allowed, select } = useStore();
  const [modal, setModal] = useState<"dispose" | "elect" | null>(null);
  let drafts = suggestionDrafts(c, wp);
  // verification of an extracted value needs the value itself
  drafts = drafts.map((d) => d.type === "verification.recorded" && ix.evs.has(d.target) ? { ...d, payload: { ...d.payload, seenValue: wp.correctionsByTarget.get(d.target)?.to ?? ix.evs.get(d.target)!.value } } : d);
  const decision = drafts.length ? allowed(drafts[0]) : { ok: true as const };
  const asked = wp.questions.find((q) => q.target === `check:${c.id}`);
  const open = c.status === "open";
  const label = c.suggestion?.adjustments ? `Apply ${c.suggestion.adjustments.length} adjustment${c.suggestion.adjustments.length > 1 ? "s" : ""}`
    : c.suggestion?.verify ? "Record verification" : c.suggestion?.question ? (asked ? "Asked" : "Ask the client") : "";
  return (
    <div data-tour={`check-${c.id}`} className="rounded-lg border border-slate-200 bg-white p-3">
      <div className="flex flex-wrap items-center gap-1.5">
        {c.source === "engine" ? <Badge tone="slate"><Bot size={10} />engine</Badge> : <Badge tone="indigo"><ShieldCheck size={10} />independent check</Badge>}
        <Badge tone={SEVERITY_TONE[c.severity]}>{c.severity}</Badge>
        <Badge tone={STATUS_TONE[c.status]}>{c.status}</Badge>
        <span className="text-sm font-medium text-slate-800">{c.title}</span>
        {c.effect && open && <Effect f={c.effect.federal} c={c.effect.california} className="ml-auto" />}
      </div>
      <p className="mt-1.5 text-sm text-slate-700">{c.summary}</p>
      {!compact && c.detail.length > 0 && (
        <ul className="mt-1.5 list-disc space-y-0.5 pl-5 text-xs text-slate-600">{c.detail.map((d, i) => <li key={i}>{d}</li>)}</ul>
      )}
      {c.statusNote && <p className="mt-1 text-xs text-violet-700">{c.statusNote}</p>}
      {!compact && c.suggestion?.adjustments && open && (
        <table className="mt-2 w-full text-xs">
          <tbody>
            {c.suggestion.adjustments.map((a) => (
              <tr key={a.key} className="border-t border-slate-100">
                <td className="py-1 pr-2"><button className="font-mono text-indigo-700 hover:underline" onClick={() => select(a.key)}>{a.key}</button></td>
                <td className="py-1 pr-2 tabular-nums text-slate-500">{wp.lineValues.has(a.key) ? formatLineValue(a.key, wp.value(a.key)) : a.kind === "correction" ? "—" : "new"}</td>
                <td className="py-1 pr-2">→</td>
                <td className="py-1 pr-2 font-medium tabular-nums">{typeof a.to === "number" ? formatLineValue(a.key, a.to) : String(a.to)}</td>
                <td className="py-1 text-slate-500">{a.reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {!compact && <Refs refs={c.evidence.slice(0, 8)} compact />}
        <div className="ml-auto flex gap-1.5">
          {open && drafts.length > 0 && !(c.suggestion?.question && asked) && (
            <Button size="sm" variant="primary" decision={decision} onClick={() => emit(drafts, { label: `${c.title}: ${label.toLowerCase()}`, batch: true })}><Wand2 size={12} />{label}</Button>
          )}
          {open && c.suggestion?.whatIfId && <Button size="sm" variant="primary" onClick={() => setModal("elect")}><Wand2 size={12} />Elect what-if</Button>}
          {open && <Button size="sm" onClick={() => setModal("dispose")}><Gavel size={12} />Disposition</Button>}
          {compact && <Button size="sm" variant="ghost" onClick={() => select(`check:${c.id}`)}>Details</Button>}
        </div>
      </div>
      {asked && <p className="mt-1.5 text-xs text-slate-600">Question {asked.answer ? <>answered: “{asked.answer.text}”</> : "awaiting answer"}</p>}
      {modal === "dispose" && <ActionModal kind="judgment" target={`check:${c.id}`} value={null} onClose={() => setModal(null)} defaultEvidence={c.evidence.slice(0, 4)} preset={{ kind: "check_disposition" }} />}
      {modal === "elect" && <ActionModal kind="judgment" target={c.lines[0] ?? `check:${c.id}`} value={null} onClose={() => setModal(null)} defaultEvidence={c.evidence.slice(0, 4)} preset={{ kind: "election", whatIfId: c.suggestion!.whatIfId, decision: `Elect ${c.suggestion!.whatIfId}`, authority: "Treas. Reg. §1.263(a)-3" }} />}
    </div>
  );
}
