"use client";

import Link from "next/link";
import clsx from "clsx";
import { useState } from "react";
import { CheckCircle2, Circle, AlertTriangle, Eye } from "lucide-react";
import { useStore } from "@/client/store";
import { AREAS, areaForLine } from "@/domain/areas";
import { money, signedMoney, shortDateTime } from "@/domain/format";
import type { Totals } from "@/domain/types";
import { Badge, Button, Card, PageHeader } from "@/components/ui";
import { ActorName, Effect, LineValue } from "@/components/wp";
import { describe } from "@/components/Inspector";
import { ActionModal } from "@/components/actions";

const SUMMARY_KEYS = ["F1040.1a", "F1040.2b", "F1040.3b", "F1040.7", "F1040.8", "Sch1.3", "Sch1.5", "F1040.10", "F1040.11", "F1040.12", "F1040.13", "F1040.15", "F1040.16", "F1040.23", "F1040.24", "F1040.33", "F1040.37"];

function TotalsCard({ title, eng, wp, ca }: { title: string; eng: Totals; wp: Totals; ca?: boolean }) {
  const rows: [string, number, number][] = [
    [ca ? "Total AGI (CA law)" : "AGI", (ca ? eng.total_agi : eng.agi) ?? 0, (ca ? wp.total_agi : wp.agi) ?? 0],
    ["Total tax", eng.total_tax, wp.total_tax],
    ["Payments", eng.payments, wp.payments],
    [eng.balance_due < 0 ? "Refund" : "Balance due", eng.balance_due, wp.balance_due],
  ];
  return (
    <Card title={title} actions={<span className="text-[11px] text-slate-400">engine → workpaper</span>}>
      <table className="w-full text-sm">
        <tbody>
          {rows.map(([l, e, w]) => (
            <tr key={l}>
              <td className="py-1 text-slate-600">{l}</td>
              <td className="py-1 text-right tabular-nums text-slate-400">{money(Math.abs(e))}</td>
              <td className={clsx("py-1 text-right font-semibold tabular-nums", e !== w && "text-indigo-700")}>{money(Math.abs(w))}</td>
              <td className={clsx("w-20 py-1 text-right text-xs tabular-nums", w - e > 0 ? "text-rose-600" : "text-emerald-600")}>{e !== w ? signedMoney(w - e) : ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

/** Where every figure in the app originates: one packet from Miraflores' pipeline. */
function DataSources() {
  const { ix, wp, select } = useStore();
  const p = ix.packet;
  const values = p.documents.reduce((n, d) => n + d.extraction.values, 0);
  const received = p.documents.filter((d) => wp.visibleDocs.has(d.id)).length;
  const items: { label: string; detail: string; href?: string; ref?: string }[] = [
    { label: `${p.documents.length} documents`, detail: `${received} received as of the clock`, href: "/documents" },
    { label: `${values.toLocaleString()} values read`, detail: "what the software read off them", href: "/documents" },
    { label: `Engine return ${wp.version}`, detail: `${p.return_versions.length} computed versions`, href: "/versions" },
    { label: "IRS & FTB records", detail: "transcript, payments, notices", ref: "agency:/irs_account_transcript_2025" },
    { label: `${p.client.questionnaire.length} client answers`, detail: `+ ${p.client.messages.length} messages, 1 call`, ref: "qa-01" },
    { label: "2024 return", detail: "prior year & prior preparer", href: "/prior" },
  ];
  return (
    <div data-tour="sources" className="flex flex-wrap items-center gap-x-1 gap-y-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs">
      <span className="mr-1 font-semibold text-slate-700">Where the data comes from:</span>
      <span className="mr-1 text-slate-500">one packet from Miraflores&apos; pipeline —</span>
      {items.map((it) => {
        const inner = <><span className="font-medium text-slate-800">{it.label}</span> <span className="text-slate-500">{it.detail}</span></>;
        return it.href
          ? <Link key={it.label} href={it.href} className="rounded-md bg-slate-50 px-2 py-1 ring-1 ring-slate-200 hover:bg-indigo-50 hover:ring-indigo-200">{inner}</Link>
          : <button key={it.label} onClick={() => select(it.ref!)} className="rounded-md bg-slate-50 px-2 py-1 text-left ring-1 ring-slate-200 hover:bg-indigo-50 hover:ring-indigo-200">{inner}</button>;
      })}
      <span className="ml-1 text-slate-400">Nothing is typed in by the app; everything people do is recorded on top.</span>
    </div>
  );
}

export default function Overview() {
  const { wp, ix, select, markSeen, actors } = useStore();
  const [explain, setExplain] = useState<string | null>(null);
  const py = ix.packet.prior_years.return_2024;
  const openChecks = wp.checks.filter((c) => c.status === "open" && c.severity !== "info" && !c.coveredBy);
  const openEffect = openChecks.reduce((a, c) => ({ f: a.f + (c.effect?.federal ?? 0), c: a.c + (c.effect?.california ?? 0) }), { f: 0, c: 0 });
  const name = (id: string) => actors.find((a) => a.id === id)?.name ?? id;
  const variance = new Map(wp.variances.map((v) => [v.key, v]));
  return (
    <div className="space-y-4">
      <PageHeader
        title="Okafor-Lindqvist household — 2025 Form 1040 & CA 540NR"
        sub={<>Married filing jointly · CA resident to 07/14, TX from 07/15 · preparer {name(wp.assignments.preparer)}, reviewer {name(wp.assignments.reviewer)}, partner {name(wp.assignments.partner)} · as of {shortDateTime(wp.asOf)}</>}
      />
      <DataSources />
      <div data-tour="totals" className="grid gap-4 lg:grid-cols-3">
        <TotalsCard title="Federal" eng={wp.totals.engineFederal} wp={wp.totals.federal} />
        <TotalsCard title="California (part-year)" eng={wp.totals.engineCalifornia} wp={wp.totals.california} ca />
        <Card title="Open issues" actions={<Link href="/issues" className="text-xs text-indigo-700 hover:underline">Inbox →</Link>}>
          <div className="text-3xl font-semibold tabular-nums">{openChecks.length}</div>
          <p className="text-xs text-slate-500">independent checks and engine diagnostics still open</p>
          <div className="mt-2 text-sm">If all suggested fixes are applied: <Effect f={openEffect.f} c={openEffect.c} /></div>
          <div className="mt-2 flex flex-wrap gap-1">
            {(["high", "medium", "low"] as const).map((s) => <Badge key={s} tone={s === "high" ? "red" : s === "medium" ? "amber" : "blue"}>{openChecks.filter((c) => c.severity === s).length} {s}</Badge>)}
            <Badge tone="green">{wp.checks.filter((c) => c.status === "passed").length} passed</Badge>
            <Badge tone="green">{wp.checks.filter((c) => c.status === "resolved").length} resolved</Badge>
          </div>
        </Card>
      </div>

      <div className="grid gap-4 @5xl:grid-cols-[1.4fr_1fr]">
        <div data-tour="summary"><Card title="Return summary vs 2024" pad={false} actions={<span className="text-[11px] text-slate-400">variance standard: &gt;{wp.standards.variance_review.flag_if_change_over_percent}% and &gt;{money(wp.standards.variance_review.and_over_amount)}</span>}>
          <table className="w-full text-sm">
            <thead className="text-[11px] uppercase text-slate-400"><tr><th className="px-3 py-1.5 text-left font-medium">Line</th><th className="px-2 text-right font-medium">2024</th><th className="px-2 text-right font-medium">2025</th><th className="px-2 text-right font-medium">Change</th><th className="px-3 text-left font-medium">Variance</th></tr></thead>
            <tbody>
              {SUMMARY_KEYS.filter((k) => wp.lineValues.has(k)).map((k) => {
                const prior = py.lines[k];
                const v = variance.get(k);
                const cur = wp.value(k);
                return (
                  <tr key={k} className="border-t border-slate-100 hover:bg-slate-50">
                    <td className="px-3 py-1"><button onClick={() => select(k)} className="text-left hover:text-indigo-700"><span className="mr-2 font-mono text-[10px] text-slate-400">{k}</span>{wp.vi.lines.get(k)?.label}</button></td>
                    <td className="px-2 text-right tabular-nums text-slate-500">{typeof prior === "number" ? money(prior) : "—"}</td>
                    <td className="px-2 text-right"><LineValue k={k} /></td>
                    <td className="px-2 text-right text-xs tabular-nums text-slate-500">{typeof prior === "number" && typeof cur === "number" ? signedMoney(cur - prior) : ""}</td>
                    <td className="px-3 text-xs">
                      {v ? (v.explanation
                        ? <span className="text-emerald-700" title={v.explanation.payload.decision}>explained</span>
                        : <button onClick={() => setExplain(k)} className="text-amber-700 hover:underline">{Number.isFinite(v.pct) ? `${v.pct > 0 ? "+" : ""}${v.pct.toFixed(0)}%` : "new"} · explain</button>) : ""}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="px-3 py-2 text-xs text-slate-500">{wp.variances.length} lines across the return exceed the variance standard; {wp.variances.filter((v) => !v.explanation).length} unexplained. <Link href="/prior" className="text-indigo-700 hover:underline">All variances →</Link></p>
        </Card></div>

        <div className="space-y-4">
          <div data-tour="gate"><Card title="Ready to file?" actions={wp.gate.canSubmit ? <Badge tone="green">ready to transmit</Badge> : wp.gate.canPresent ? <Badge tone="indigo">ready for client</Badge> : <Badge tone="amber">{wp.gate.blockers.length} blockers</Badge>}>
            <ul className="space-y-1 text-sm">
              {wp.steps.map((s) => (
                <li key={s.label} className="flex items-start gap-2">
                  {s.done ? <CheckCircle2 size={15} className="mt-0.5 shrink-0 text-emerald-600" /> : <Circle size={15} className="mt-0.5 shrink-0 text-slate-300" />}
                  <span className="min-w-0"><button onClick={() => s.target && select(s.target)} className={clsx("text-left", s.done ? "text-slate-600" : "text-slate-900", s.target && "hover:text-indigo-700")}>{s.label}</button>{!s.done && s.detail && <span className="block text-[11px] text-slate-500">{s.detail}</span>}</span>
                </li>
              ))}
            </ul>
            {wp.gate.blockers.filter((b) => !wp.steps.some((s) => s.label === b)).map((b) => <p key={b} className="mt-1 flex items-center gap-1 text-xs text-amber-700"><AlertTriangle size={12} />{b}</p>)}
          </Card></div>
          <Card title="Completeness: outside filings">
            <ul className="space-y-1 text-sm">
              {wp.outside.map((o) => (
                <li key={o.id}><button onClick={() => select(`outside:${o.id}`)} className="flex w-full items-start gap-2 text-left hover:text-indigo-700">
                  {o.disposition ? <CheckCircle2 size={15} className="mt-0.5 shrink-0 text-emerald-600" /> : <Circle size={15} className="mt-0.5 shrink-0 text-amber-400" />}
                  <span>{o.title}{o.disposition && <span className="block text-[11px] text-slate-500">{o.disposition.payload.decision}</span>}</span>
                </button></li>
              ))}
            </ul>
          </Card>
          <Card title={`Since you last looked (${wp.sinceLastSeen.length})`} actions={wp.sinceLastSeen.length > 0 && <Button size="sm" variant="ghost" onClick={markSeen}><Eye size={12} />Mark seen</Button>}>
            {wp.sinceLastSeen.length === 0 ? <p className="text-xs text-slate-400">No changes by others since your last visit.</p> : (
              <ul className="max-h-64 space-y-1 overflow-y-auto text-xs">
                {wp.sinceLastSeen.slice().reverse().slice(0, 40).map((e) => (
                  <li key={e.id}><button onClick={() => select(e.target)} className="text-left hover:text-indigo-700"><ActorName id={e.actorId} /> {describe(e)} <span className="font-mono text-slate-400">{e.target}</span></button></li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>

      <Card title="Areas" pad={false}>
        <div className="grid divide-y divide-slate-100 md:grid-cols-2 md:divide-x xl:grid-cols-5">
          {AREAS.map((a) => {
            const lines = wp.vi.version.lines.filter((l) => areaForLine(l.key) === a.id);
            const verified = lines.filter((l) => wp.lineStatus.get(l.key)?.status === "verified").length;
            const open = wp.checks.filter((c) => c.area === a.id && c.status === "open" && c.severity !== "info" && !c.coveredBy).length;
            const hours = wp.timeByArea.get(a.id) ?? 0;
            const budget = a.budgetKey ? ix.packet.firm.budget_hours[a.budgetKey] : undefined;
            return (
              <Link key={a.id} href={`/area/${a.id}`} className="block p-3 hover:bg-slate-50">
                <div className="text-sm font-medium text-slate-800">{a.title}</div>
                <div className="mt-1 h-1.5 overflow-hidden rounded bg-slate-100"><div className="h-full bg-emerald-500" style={{ width: `${lines.length ? (verified / lines.length) * 100 : 0}%` }} /></div>
                <div className="mt-1 flex flex-wrap items-center gap-1 text-[11px] text-slate-500">
                  <span>{verified}/{lines.length} verified</span>
                  {open > 0 && <Badge tone="amber">{open} open</Badge>}
                  {(["preparer", "reviewer", "partner"] as const).map((l) => {
                    const s = wp.signoffs.find((x) => x.area === a.id && x.level === l);
                    return <Badge key={l} tone={s ? (s.valid ? "green" : "amber") : "slate"}>{l[0].toUpperCase()}{s && !s.valid ? " reopened" : ""}</Badge>;
                  })}
                  {budget != null && <span className={clsx(hours > budget && "text-rose-600")}>{hours}/{budget}h</span>}
                </div>
              </Link>
            );
          })}
        </div>
      </Card>
      {explain && <ActionModal kind="judgment" target={explain} value={null} onClose={() => setExplain(null)} preset={{ kind: "variance" }} />}
    </div>
  );
}
