"use client";

import { useState } from "react";
import { useStore } from "@/client/store";
import { money, signedMoney } from "@/domain/format";
import { Badge, Button, Card, PageHeader } from "@/components/ui";
import { LineValue } from "@/components/wp";
import { ActionModal } from "@/components/actions";

const OPEN_ITEM_CHECK = ["pp-k1", "pp-5498", "pp-homeoffice", null];

export default function Prior() {
  const { ix, wp, select } = useStore();
  const [explain, setExplain] = useState<string | null>(null);
  const pp = ix.packet.prior_years.prior_preparer_workpaper;
  const carry = ix.packet.prior_years.carryovers_into_2025 as Record<string, unknown>;
  const changes = wp.adjustments.filter((a) => {
    const py = ix.packet.prior_years.return_2024.lines;
    return a.key in py || a.key.startsWith("SchC") || a.key.startsWith("SchE") || a.key.startsWith("F8606");
  });
  return (
    <div className="space-y-4">
      <PageHeader title="Prior year & prior preparer" sub="What Delta River Tax Services did in 2024, the open items they left, and what we changed." />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Prior preparer's file (D07)">
          <p className="text-sm text-slate-700">{pp.summary_memo}</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-slate-600">{pp.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>
        </Card>
        <Card title="Open items they left → our disposition" pad={false}>
          {pp.open_items_left_by_prior_preparer.map((item, i) => {
            const id = OPEN_ITEM_CHECK[i];
            const c = id ? wp.checks.find((x) => x.id === id) : undefined;
            const outside = i === 3 ? wp.outside.find((o) => o.id === "f3520") : undefined;
            return (
              <button key={i} onClick={() => select(c ? `check:${c.id}` : "outside:f3520")} className="block w-full border-b border-slate-100 px-3 py-2 text-left text-sm hover:bg-slate-50">
                <div>{item}</div>
                <div className="mt-0.5 text-xs">
                  {c && <><Badge tone={c.status === "open" ? "amber" : "green"}>{c.status}</Badge> <span className="text-slate-500">{c.summary}</span></>}
                  {outside && <><Badge tone={outside.disposition ? "green" : "red"}>{outside.disposition ? "dispositioned" : "open — outside filing"}</Badge> <span className="text-slate-500">{outside.detail}</span></>}
                </div>
              </button>
            );
          })}
        </Card>
      </div>

      <Card title={`Variances vs 2024 (${wp.variances.length}; ${wp.variances.filter((v) => !v.explanation).length} unexplained)`} pad={false}>
        <table className="w-full text-sm">
          <thead className="text-[10px] uppercase text-slate-400"><tr><th className="px-3 py-1.5 text-left font-medium">Line</th><th className="text-right font-medium">2024</th><th className="text-right font-medium">2025</th><th className="text-right font-medium">Change</th><th className="px-3 text-left font-medium">Explanation</th></tr></thead>
          <tbody>
            {wp.variances.map((v) => (
              <tr key={v.key} className="border-t border-slate-100 hover:bg-slate-50">
                <td className="px-3 py-1"><button onClick={() => select(v.key)} className="text-left hover:text-indigo-700"><span className="mr-2 font-mono text-[10px] text-slate-400">{v.key}</span>{v.label}</button></td>
                <td className="text-right tabular-nums text-slate-500">{money(v.prior)}</td>
                <td className="text-right"><LineValue k={v.key} /></td>
                <td className="text-right text-xs tabular-nums">{signedMoney(v.delta)} {Number.isFinite(v.pct) && <span className="text-slate-400">({v.pct.toFixed(0)}%)</span>}</td>
                <td className="px-3 text-xs">{v.explanation ? <span className="text-emerald-700">{v.explanation.payload.decision}</span> : <Button size="sm" variant="ghost" onClick={() => setExplain(v.key)}>Explain</Button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Carryovers into 2025 (agreed in checks)">
          <table className="w-full text-sm"><tbody>
            {Object.entries(carry).filter(([, v]) => typeof v === "number").map(([k, v]) => <tr key={k} className="border-t border-slate-100"><td className="py-1 text-slate-600">{k.replace(/_/g, " ")}</td><td className="text-right tabular-nums">{money(v as number)}</td></tr>)}
          </tbody></table>
          <p className="mt-2 text-xs text-slate-500">{String((carry.california as Record<string, unknown>)?.note ?? "")}</p>
        </Card>
        <Card title="What we changed vs the prior preparer's approach">
          <ul className="space-y-1 text-xs text-slate-700">
            <li>• Home office: they used 300 sq ft (“2 rooms combined?”); D24 measures 220 sq ft (Sacramento) and 260 (Austin).</li>
            <li>• S corp basis: they assumed sufficient basis without the 2023 K-1; we rolled it forward with D40 (2,300 at 1/1/2025).</li>
            <li>• IRA basis: confirmed with Form 5498 for 2024 (D42) instead of the client's word.</li>
            <li>• Foreign inheritance: Form 3520 for 2023 was never resolved — raised as an outside filing.</li>
            {changes.map((a) => <li key={a.event.id}>• <button className="font-mono text-indigo-700" onClick={() => select(a.key)}>{a.key}</button>: {a.event.payload.reason}</li>)}
          </ul>
        </Card>
      </div>
      {explain && <ActionModal kind="judgment" target={explain} value={null} onClose={() => setExplain(null)} preset={{ kind: "variance" }} />}
    </div>
  );
}
