"use client";

import { useStore } from "@/client/store";
import { money } from "@/domain/format";
import { Badge, Card, PageHeader } from "@/components/ui";

export default function RollForward() {
  const { ix, wp, select } = useStore();
  const co = wp.vi.version.carryovers_out;
  const plan = ix.packet.planning_reference_2026 as Record<string, unknown>;
  const fedTax = wp.filing.filedSnapshot?.federal.total_tax ?? wp.totals.federal.total_tax;
  const caTax = wp.filing.filedSnapshot?.california.total_tax ?? wp.totals.california.total_tax;
  const fedQ = Math.ceil((fedTax * 1.1) / 4 / 10) * 10;
  const openNotes = wp.notes.filter((n) => !n.resolved);
  const openChecks = wp.checks.filter((c) => c.status === "open" && c.severity !== "info" && !c.coveredBy);
  const openOutside = wp.outside.filter((o) => !o.disposition);
  return (
    <div className="space-y-4">
      <PageHeader title="Roll forward to 2026" sub="What next year's preparer inherits — carryovers, basis, assets, open items — with their history, and the 2026 estimate plan." />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Federal carryovers out of 2025">
          <table className="w-full text-sm"><tbody>
            {Object.entries(co.federal).map(([k, v]) => <tr key={k} className="border-t border-slate-100"><td className="py-1 text-slate-600">{k.replace(/_/g, " ")}</td><td className="text-right tabular-nums">{typeof v === "number" ? money(v) : v == null ? <span className="text-amber-600">not computed</span> : String(v)}</td></tr>)}
          </tbody></table>
          <p className="mt-2 text-[11px] text-slate-500">From engine {wp.version}. Workpaper adjustments that change carryovers (e.g. AMT credit) need an engine recompute before roll-forward.</p>
        </Card>
        <Card title="California carryovers & basis differences">
          <table className="w-full text-sm"><tbody>
            {Object.entries(co.california).map(([k, v]) => <tr key={k} className="border-t border-slate-100"><td className="py-1 text-slate-600">{k.replace(/_/g, " ")}</td><td className="text-right text-xs tabular-nums">{typeof v === "object" && v ? Object.entries(v).map(([a, b]) => `${a} ${money(Number(b), true)}`).join(" · ") : money(Number(v))}</td></tr>)}
          </tbody></table>
        </Card>
        <Card title="2026 estimated tax plan">
          <p className="text-sm">Federal safe harbor: {String(plan.federal_safe_harbor)}</p>
          <p className="mt-1 text-sm">110% × {money(fedTax)} ÷ 4 ≈ <b>{money(fedQ)}</b> per quarter on {(plan.federal_estimate_due_dates as string[]).join(", ")}.</p>
          <p className="mt-2 text-sm">California: {String(plan.california_safe_harbor)}</p>
          <p className="mt-1 text-xs text-slate-500">2025 CA tax {money(caTax)} — but 2026 CA tax will cover only CA-source income (Sacramento rental, Ridgeline's CA share); size the 30/40/30 installments to the 90%-of-2026 test.</p>
          <ul className="mt-2 list-disc pl-5 text-xs text-slate-600">{(plan.known_2026_changes_for_this_household as string[]).map((c) => <li key={c}>{c}</li>)}</ul>
        </Card>
        <Card title="Carried forward as open">
          <div className="space-y-1 text-sm">
            <p><Badge tone={openChecks.length ? "amber" : "green"}>{openChecks.length}</Badge> open checks</p>
            <p><Badge tone={openNotes.length ? "amber" : "green"}>{openNotes.length}</Badge> unresolved notes</p>
            <p><Badge tone={openOutside.length ? "amber" : "green"}>{openOutside.length}</Badge> outside filings not dispositioned</p>
            <ul className="mt-2 list-disc pl-5 text-xs text-slate-600">
              <li>Ridgeline outside basis never computed (capital account 63,660).</li>
              <li>Minimum tax credit from the 2025 ISO AMT ({money(Number(co.federal.minimum_tax_credit_from_2025_amt))}) — Form 8801.</li>
              <li>ISO shares (1,000 sh, AMT basis 52/sh vs regular 12/sh) — track dual basis on sale.</li>
              <li>SEP excess contribution {money(Number(co.federal.sep_contribution_not_deductible_for_2025))} — confirm withdrawal or carryforward.</li>
              <li>Studio equipment: CA basis differs (FTB 3885A); 2026 CA depreciation continues.</li>
              {openOutside.map((o) => <li key={o.id}><button className="text-indigo-700" onClick={() => select(`outside:${o.id}`)}>{o.title}</button></li>)}
            </ul>
          </div>
        </Card>
      </div>
    </div>
  );
}
