"use client";

import { use, useMemo, useState } from "react";
import { notFound } from "next/navigation";
import { CheckCircle2, AlertTriangle, Clock } from "lucide-react";
import { useStore } from "@/client/store";
import { AREA_BY_ID, areaForDoc, areaForLine } from "@/domain/areas";
import { shortDateTime } from "@/domain/format";
import { Badge, Button, Card, Empty, PageHeader, inputCls, Blocked } from "@/components/ui";
import { ActorName, LineRow } from "@/components/wp";
import { CheckCard } from "@/components/CheckCard";
import { BasisByYear, BooksBridge, DepreciationTable, Form8949Summary, LotExplorer, PaymentsRecon, StateSplit, W2Table } from "@/components/areaViews";

function SignoffPanel({ area }: { area: string }) {
  const { wp, emit, allowed } = useStore();
  const hash = wp.areaHash.get(area)!;
  return (
    <Card title="Sign-offs" actions={<span className="text-[10px] text-slate-400" title="Content fingerprint of this area; a sign-off stays valid only while it matches">#{hash}</span>}>
      <div className="space-y-2">
        {(["preparer", "reviewer", "partner"] as const).map((level) => {
          const s = wp.signoffs.find((x) => x.area === area && x.level === level);
          const d = allowed({ type: "signoff.given", target: area, payload: { level, hash } });
          return (
            <div key={level} className="flex flex-wrap items-start gap-2 text-sm">
              <span className="w-20 capitalize text-slate-500">{level}</span>
              <div className="min-w-0 flex-1">
                {s ? (
                  s.valid
                    ? <span className="flex items-center gap-1 text-emerald-700"><CheckCircle2 size={14} /><ActorName id={s.event.actorId} /> · {shortDateTime(s.event.simAt)}</span>
                    : <span className="text-amber-700"><span className="flex items-center gap-1"><AlertTriangle size={14} />Reopened — <ActorName id={s.event.actorId} /> signed {shortDateTime(s.event.simAt)}</span><ul className="ml-5 list-disc text-xs">{s.changes.slice(0, 4).map((c, i) => <li key={i}>{c}</li>)}</ul></span>
                ) : <span className="text-slate-400">Not signed</span>}
                {!d.ok && (!s || !s.valid) && <Blocked decision={d} />}
              </div>
              {(!s || !s.valid) && (
                <Button size="sm" variant={level === "preparer" ? "default" : "primary"} decision={d}
                  onClick={() => emit([{ type: "signoff.given", target: area, payload: { level, hash, summary: "" } }], { label: `${level} sign-off recorded` })}>Sign off</Button>
              )}
            </div>
          );
        })}
      </div>
      <p className="mt-3 text-[11px] text-slate-500">A sign-off records a fingerprint of the area (line values, adjustments, judgments, engine version). Any later change reopens it automatically. Reviewers cannot sign areas they prepared.</p>
    </Card>
  );
}

function TimePanel({ area, budget }: { area: string; budget?: number }) {
  const { wp, emit, allowed } = useStore();
  const [h, setH] = useState("0.5");
  const [note, setNote] = useState("");
  const spent = wp.timeByArea.get(area) ?? 0;
  const d = allowed({ type: "time.logged", target: area, payload: { hours: 1 } });
  return (
    <Card title="Time vs budget">
      <div className="flex items-baseline gap-2"><span className={spent > (budget ?? Infinity) ? "text-2xl font-semibold text-rose-600" : "text-2xl font-semibold"}>{spent}h</span><span className="text-sm text-slate-500">of {budget ?? "—"}h budget</span></div>
      {budget != null && <div className="mt-1 h-1.5 overflow-hidden rounded bg-slate-100"><div className={spent > budget ? "h-full bg-rose-500" : "h-full bg-indigo-500"} style={{ width: `${Math.min(100, (spent / budget) * 100)}%` }} /></div>}
      <div className="mt-3 flex gap-1.5">
        <input className={inputCls + " w-16 py-1"} value={h} onChange={(e) => setH(e.target.value)} />
        <input className={inputCls + " py-1"} placeholder="What for?" value={note} onChange={(e) => setNote(e.target.value)} />
        <Button size="sm" decision={d} onClick={() => emit([{ type: "time.logged", target: area, payload: { hours: Number(h), note } }], { label: "Time logged" }).then(() => setNote(""))}><Clock size={12} />Log</Button>
      </div>
    </Card>
  );
}

export default function AreaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { wp, ix, select } = useStore();
  const area = AREA_BY_ID.get(id);
  const lines = useMemo(() => [...wp.lineValues.keys()].filter((k) => areaForLine(k) === id), [wp.lineValues, id]);
  if (!area) notFound();
  const byForm = new Map<string, string[]>();
  for (const k of lines) {
    if (/^F8949\.[A-Z]\.(?!total)/.test(k)) continue; // lot detail lives in the 8949 view
    const f = k.split(".")[0];
    byForm.set(f, [...(byForm.get(f) ?? []), k]);
  }
  const checks = wp.checks.filter((c) => c.area === id && !c.coveredBy);
  const open = checks.filter((c) => c.status === "open");
  const docs = ix.packet.documents.filter((d) => wp.visibleDocs.has(d.id) && areaForDoc(d.document_type, d.id) === id);
  const budget = area.budgetKey ? ix.packet.firm.budget_hours[area.budgetKey] : undefined;

  return (
    <div className="space-y-4">
      <PageHeader title={area.title} sub={area.blurb} actions={<><Badge tone="amber">{open.length} open</Badge><Badge tone="green">{checks.filter((c) => c.status !== "open").length} closed</Badge></>} />
      <div className="grid gap-4 @4xl:grid-cols-[1fr_340px]">
        <div className="min-w-0 space-y-4">
          {open.length > 0 && <div className="space-y-2">{open.map((c) => <CheckCard key={c.id} c={c} />)}</div>}
          {id === "business" && <BooksBridge />}
          {id === "investments" && <><Form8949Summary /><LotExplorer /></>}
          {id === "rentals" && <DepreciationTable />}
          {id === "passthroughs" && <BasisByYear />}
          {id === "california" && <StateSplit />}
          {id === "payments" && <PaymentsRecon />}
          {id === "wages" && <W2Table />}
          {id === "intake" && (
            <Card title="Household (as entered by the client)">
              {wp.household.people.map((p) => (
                <button key={p.id} onClick={() => select(`household:${p.id}`)} className="flex w-full items-center gap-3 border-b border-slate-100 py-1.5 text-left text-sm hover:bg-slate-50">
                  <span className="w-48 font-medium">{p.name}</span><span className="w-24 text-slate-500">{p.role}</span><span className="font-mono text-xs">{p.ssn}</span>
                  {wp.correctionsByTarget.has(`household:${p.id}.ssn`) && <Badge tone="indigo">SSN corrected</Badge>}
                  <span className="ml-auto text-xs text-slate-500">{p.dob}</span>
                </button>
              ))}
            </Card>
          )}
          <Card title="Return lines" pad={false}>
            {[...byForm.entries()].map(([form, keys]) => (
              <div key={form}>
                <div className="bg-slate-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">{form}</div>
                {keys.map((k) => <LineRow key={k} k={k} />)}
              </div>
            ))}
            {byForm.size === 0 && <Empty>No return lines in this area.</Empty>}
          </Card>
          {checks.filter((c) => c.status !== "open").length > 0 && (
            <Card title="Closed and passing checks (evidence the engine was tested, not trusted)">
              <div className="space-y-2">{checks.filter((c) => c.status !== "open").map((c) => <CheckCard key={c.id} c={c} compact />)}</div>
            </Card>
          )}
        </div>
        <div className="space-y-4">
          <div data-tour="signoffs"><SignoffPanel area={id} /></div>
          <TimePanel area={id} budget={budget} />
          <Card title={`Documents (${docs.length})`} pad={false}>
            {docs.map((d) => {
              const u = wp.docUses.get(d.id);
              return (
                <button key={d.id} onClick={() => select(d.id)} className="flex w-full items-center gap-2 border-b border-slate-100 px-3 py-1.5 text-left text-xs hover:bg-slate-50">
                  <span className="w-8 font-mono text-slate-400">{d.id}</span><span className="flex-1 truncate">{d.title}</span>
                  <Badge tone={u?.kind === "used" ? "green" : u?.kind === "not_used" ? "amber" : "slate"}>{u?.kind.replace("_", " ")}</Badge>
                </button>
              );
            })}
          </Card>
        </div>
      </div>
    </div>
  );
}
