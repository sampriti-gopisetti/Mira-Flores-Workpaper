"use client";

import { Printer } from "lucide-react";
import { useStore } from "@/client/store";
import { formatLineValue, money, shortDateTime } from "@/domain/format";
import { Button, Card, PageHeader } from "@/components/ui";

const LINES = ["F1040.1z", "F1040.2b", "F1040.3b", "F1040.4b", "F1040.7", "F1040.8", "F1040.9", "F1040.10", "F1040.11", "F1040.12", "F1040.13", "F1040.15", "F1040.16", "F1040.17", "F1040.19", "F1040.20", "F1040.23", "F1040.24", "F1040.25d", "F1040.26", "F1040.31", "F1040.33", "F1040.37", "F1040.38",
  "F540NR.17", "F540NR.32", "F540NR.35", "F540NR.40", "F540NR.64", "F540NR.71", "F540NR.72", "F540NR.78", "F540NR.97"];

export default function ClientCopy() {
  const { wp } = useStore();
  const snap = wp.filing.filedSnapshot;
  const v = (k: string) => (snap ? snap.lines[k] : wp.value(k));
  const t = snap ?? { federal: wp.totals.federal, california: wp.totals.california };
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <PageHeader title="Client copy — 2025 returns" sub={snap ? `As filed ${wp.filing.accepted.federal ? shortDateTime(wp.filing.accepted.federal.simAt) : ""}` : "Draft — not yet filed"} actions={<Button onClick={() => window.print()} className="no-print"><Printer size={14} />Print</Button>} />
      <Card title="Taxpayers">
        <p className="text-sm">{wp.household.people.filter((p) => p.role !== "dependent").map((p) => `${p.name} (${p.ssn})`).join(" & ")} — married filing jointly</p>
        <p className="text-xs text-slate-500">Dependents: {wp.household.people.filter((p) => p.role === "dependent").map((p) => p.name).join(", ")} · Residency: California to 07/14/2025, Texas from 07/15/2025</p>
      </Card>
      <div className="grid grid-cols-2 gap-4">
        <Card title="Federal"><p className="text-2xl font-semibold">{t.federal.balance_due >= 0 ? `${money(t.federal.balance_due)} owed` : `${money(-t.federal.balance_due)} refund`}</p><p className="text-xs text-slate-500">Total tax {money(t.federal.total_tax)}</p></Card>
        <Card title="California"><p className="text-2xl font-semibold">{t.california.balance_due >= 0 ? `${money(t.california.balance_due)} owed` : `${money(-t.california.balance_due)} refund`}</p><p className="text-xs text-slate-500">Total tax {money(t.california.total_tax)}</p></Card>
      </div>
      <Card title="Key lines" pad={false}>
        <table className="w-full text-sm"><tbody>
          {LINES.filter((k) => wp.vi.lines.has(k)).map((k) => <tr key={k} className="border-t border-slate-100"><td className="px-3 py-1 font-mono text-xs text-slate-400">{k}</td><td>{wp.vi.lines.get(k)!.label}</td><td className="px-3 text-right tabular-nums">{formatLineValue(k, v(k) ?? null)}</td></tr>)}
        </tbody></table>
      </Card>
      <p className="text-xs text-slate-500">Keep this copy and your records for at least 7 years. FBAR (FinCEN 114) and the Forms 1099-NEC for your contractors are filed separately.</p>
    </div>
  );
}
