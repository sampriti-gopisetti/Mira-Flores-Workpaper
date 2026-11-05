"use client";

import clsx from "clsx";
import { useMemo, useState } from "react";
import { Wand2, Gavel } from "lucide-react";
import { useStore } from "@/client/store";
import { AREAS, AREA_BY_ID } from "@/domain/areas";
import type { Check } from "@/domain/checks";
import { Badge, Button, Card, Field, Modal, PageHeader, inputCls } from "@/components/ui";
import { ActorName, Effect, SEVERITY_TONE, STATUS_TONE } from "@/components/wp";
import { CheckCard, suggestionDrafts } from "@/components/CheckCard";

type Filter = "open" | "all" | "closed";

export default function Issues() {
  const { wp, select, emit, allowed } = useStore();
  const [status, setStatus] = useState<Filter>("open");
  const [area, setArea] = useState("");
  const [source, setSource] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<string | null>(null);
  const [dispose, setDispose] = useState(false);
  const [decision, setDecision] = useState("");
  const [authority, setAuthority] = useState("");

  const checks = useMemo(() => wp.checks.filter((c) =>
    (status === "all" || (status === "open" ? c.status === "open" : c.status !== "open"))
    && (!area || c.area === area) && (!source || c.source === source)
  ).sort((a, b) => ["high", "medium", "low", "info"].indexOf(a.severity) - ["high", "medium", "low", "info"].indexOf(b.severity)), [wp.checks, status, area, source]);

  const reviewNotes = wp.notes.filter((n) => n.kind === "review" && !n.resolved);
  const openQuestions = wp.questions.filter((q) => !q.answer);
  const sel = checks.filter((c) => selected.has(c.id));
  const applicable = sel.filter((c) => c.status === "open" && (c.suggestion?.adjustments || c.suggestion?.verify || (c.suggestion?.question && !wp.questions.some((q) => q.target === `check:${c.id}`))));
  const drafts = applicable.flatMap((c) => suggestionDrafts(c, wp));
  const effect = sel.reduce((a, c) => ({ f: a.f + (c.status === "open" ? c.effect?.federal ?? 0 : 0), c: a.c + (c.status === "open" ? c.effect?.california ?? 0 : 0) }), { f: 0, c: 0 });
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  async function bulkDispose() {
    const r = await emit(sel.map((c) => ({ type: "judgment.recorded" as const, target: `check:${c.id}`, payload: { kind: "check_disposition", decision, authority, rationale: "", evidence: [] } })), { label: `Dispositioned ${sel.length} issue(s)`, batch: true });
    if (r) { setDispose(false); setSelected(new Set()); }
  }

  return (
    <div className="space-y-4">
      <PageHeader title="Issues" sub="Independent checks (recomputed from documents, agency records and client answers — not from the engine), engine diagnostics, review notes and open questions." />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title={`Review notes blocking filing (${reviewNotes.length})`}>
          {reviewNotes.length === 0 ? <p className="text-xs text-slate-400">None open.</p> : reviewNotes.map((n) => (
            <button key={n.id} onClick={() => select(n.target)} className="block w-full border-b border-slate-100 py-1.5 text-left text-xs hover:bg-slate-50">
              <span className="font-mono text-[10px] text-slate-400">{n.target}</span> {n.text}<span className="block text-[10px] text-slate-500"><ActorName id={n.author} />{n.assignee && <> → <ActorName id={n.assignee} /></>}</span>
            </button>
          ))}
        </Card>
        <Card title={`Open questions (${openQuestions.length})`}>
          {openQuestions.length === 0 ? <p className="text-xs text-slate-400">None open.</p> : openQuestions.map((q) => (
            <button key={q.id} onClick={() => select(q.target)} className="block w-full border-b border-slate-100 py-1.5 text-left text-xs hover:bg-slate-50">{q.text}<span className="block text-[10px] text-slate-500">to {q.to === "client" ? "client" : <ActorName id={q.to} />}</span></button>
          ))}
        </Card>
        <Card title="Adjustments awaiting partner">
          {wp.adjustments.filter((a) => a.needsPartner && !a.approvals.length).map((a) => (
            <button key={a.event.id} onClick={() => select(a.key)} className="flex w-full items-center justify-between border-b border-slate-100 py-1.5 text-left text-xs hover:bg-slate-50">
              <span><span className="font-mono">{a.key}</span> <span className="text-slate-500">{a.event.payload.reason.slice(0, 50)}</span></span><Effect f={a.effect.federalBalance} c={a.effect.californiaBalance} />
            </button>
          ))}
          {!wp.adjustments.some((a) => a.needsPartner && !a.approvals.length) && <p className="text-xs text-slate-400">None.</p>}
        </Card>
      </div>

      <div data-tour="checks"><Card pad={false} title={`Checks & diagnostics (${checks.length})`} actions={
        <div className="flex flex-wrap items-center gap-2">
          {(["open", "closed", "all"] as Filter[]).map((f) => <button key={f} onClick={() => setStatus(f)} className={clsx("rounded px-2 py-0.5 text-xs", status === f ? "bg-indigo-100 text-indigo-700" : "text-slate-500 hover:bg-slate-100")}>{f}</button>)}
          <select className="rounded border border-slate-300 px-1 py-0.5 text-xs" value={area} onChange={(e) => setArea(e.target.value)}><option value="">All areas</option>{AREAS.map((a) => <option key={a.id} value={a.id}>{a.title}</option>)}</select>
          <select className="rounded border border-slate-300 px-1 py-0.5 text-xs" value={source} onChange={(e) => setSource(e.target.value)}><option value="">All sources</option><option value="workpaper">Independent checks</option><option value="engine">Engine diagnostics</option></select>
        </div>
      }>
        {sel.length > 0 && (
          <div className="sticky top-[45px] z-10 flex flex-wrap items-center gap-2 border-b border-indigo-200 bg-indigo-50 px-3 py-2 text-sm">
            <span className="font-medium">{sel.length} selected</span>
            <Effect f={effect.f} c={effect.c} />
            <Button size="sm" variant="primary" disabled={!drafts.length} decision={drafts[0] ? allowed(drafts[0]) : undefined}
              onClick={() => emit(drafts, { label: `Applied fixes for ${applicable.length} issue(s) — ${drafts.length} change(s)`, batch: true }).then((r) => r && setSelected(new Set()))}>
              <Wand2 size={12} />Apply {drafts.length} suggested change{drafts.length === 1 ? "" : "s"}
            </Button>
            <Button size="sm" onClick={() => setDispose(true)}><Gavel size={12} />Disposition all</Button>
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Clear</Button>
            <span className="text-xs text-slate-500">One undo reverts the whole batch.</span>
          </div>
        )}
        <table className="w-full text-sm">
          <tbody>
            {checks.map((c: Check) => (
              <FragmentRow key={c.id} c={c} checked={selected.has(c.id)} onToggle={() => toggle(c.id)} expanded={expanded === c.id} onExpand={() => setExpanded(expanded === c.id ? null : c.id)} />
            ))}
          </tbody>
        </table>
        {checks.length === 0 && <p className="p-4 text-sm text-slate-400">Nothing here.</p>}
      </Card></div>

      <Modal open={dispose} onClose={() => setDispose(false)} title={`Disposition ${sel.length} issue(s)`}>
        <div className="space-y-3">
          <Field label="Decision"><input className={inputCls} value={decision} onChange={(e) => setDecision(e.target.value)} placeholder="e.g. Reviewed — no change; outside engagement scope" /></Field>
          <Field label="Authority relied on (required by firm standard)"><input className={inputCls} value={authority} onChange={(e) => setAuthority(e.target.value)} /></Field>
          <div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setDispose(false)}>Cancel</Button><Button variant="primary" disabled={!decision || !authority} onClick={bulkDispose}>Record</Button></div>
        </div>
      </Modal>
    </div>
  );
}

function FragmentRow({ c, checked, onToggle, expanded, onExpand }: { c: Check; checked: boolean; onToggle: () => void; expanded: boolean; onExpand: () => void }) {
  return (
    <>
      <tr className={clsx("border-t border-slate-100 hover:bg-slate-50", checked && "bg-indigo-50/40")}>
        <td className="w-8 px-3 py-2 align-top"><input type="checkbox" checked={checked} onChange={onToggle} /></td>
        <td className="cursor-pointer py-2 pr-3 align-top" onClick={onExpand}>
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge tone={SEVERITY_TONE[c.severity]}>{c.severity}</Badge>
            <Badge tone={STATUS_TONE[c.status]}>{c.status}</Badge>
            {c.source === "engine" && <Badge>engine</Badge>}
            <span className="font-medium text-slate-800">{c.title}</span>
            <span className="text-[11px] text-slate-400">{AREA_BY_ID.get(c.area)?.title}</span>
          </div>
          <p className="mt-0.5 text-xs text-slate-600">{c.summary}</p>
          {c.coveredBy && <p className="text-[11px] text-slate-400">Handled by workpaper check {c.coveredBy}</p>}
        </td>
        <td className="w-48 px-3 py-2 text-right align-top">{c.effect && c.status === "open" && <Effect f={c.effect.federal} c={c.effect.california} />}</td>
      </tr>
      {expanded && <tr><td /><td colSpan={2} className="pb-3 pr-3"><CheckCard c={c} /></td></tr>}
    </>
  );
}
