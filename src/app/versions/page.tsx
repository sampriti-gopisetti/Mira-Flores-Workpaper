"use client";

import clsx from "clsx";
import { useState } from "react";
import { useStore } from "@/client/store";
import { formatLineValue, money, shortDateTime, signedMoney } from "@/domain/format";
import type { Totals } from "@/domain/types";
import { Badge, Button, Card, PageHeader } from "@/components/ui";
import { ActorName, Effect } from "@/components/wp";
import { ActionModal } from "@/components/actions";

function delta(a: Totals, b: Totals, k: keyof Totals) { return (b[k] ?? 0) - (a[k] ?? 0); }

export default function Versions() {
  const { ix, wp, select } = useStore();
  const [left, setLeft] = useState("v2");
  const [right, setRight] = useState("v3");
  const [elect, setElect] = useState<string | null>(null);
  const L = ix.versions.get(left)!, R = ix.versions.get(right)!;
  const keys = new Set([...L.lines.keys(), ...R.lines.keys()]);
  const diffs = [...keys].filter((k) => JSON.stringify(L.lines.get(k)?.value) !== JSON.stringify(R.lines.get(k)?.value));
  const visible = (v: string) => (ix.versions.get(v)!.version.computed_at <= wp.asOf);
  return (
    <div className="space-y-4">
      <PageHeader title="Versions & what-ifs" sub="The engine computed the return three times as documents arrived. The workpaper layer sits on top: adjustments and elections, each with who, why and tax effect." />
      <div className="grid gap-4 lg:grid-cols-4">
        {ix.packet.return_versions.map((v) => (
          <Card key={v.version} className={clsx(!visible(v.version) && "opacity-50", v.version === wp.version && "ring-2 ring-indigo-300")} title={<span>{v.version} {v.version === wp.version && <Badge tone="indigo">current</Badge>}</span>}>
            <p className="text-xs text-slate-500">{shortDateTime(v.computed_at)}</p>
            <p className="mt-1 text-xs">{v.trigger}</p>
            <div className="mt-2 grid grid-cols-2 gap-1 text-xs">
              <span className="text-slate-500">Fed total tax</span><span className="text-right tabular-nums">{money(v.summary.federal.total_tax)}</span>
              <span className="text-slate-500">Fed balance</span><span className="text-right tabular-nums">{money(v.summary.federal.balance_due)}</span>
              <span className="text-slate-500">CA total tax</span><span className="text-right tabular-nums">{money(v.summary.california.total_tax)}</span>
              <span className="text-slate-500">CA balance</span><span className="text-right tabular-nums">{money(v.summary.california.balance_due)}</span>
            </div>
            {v.documents_superseded.length > 0 && <p className="mt-2 text-[11px] text-slate-500">Superseded: {v.documents_superseded.join(", ")}</p>}
          </Card>
        ))}
        <Card title={<span>Workpaper <Badge tone="violet">layer</Badge></span>}>
          <p className="text-xs text-slate-500">{wp.version} + {wp.adjustmentsByKey.size} adjustment(s), {wp.correctionsByTarget.size} correction(s), {wp.elections.size} election(s)</p>
          <div className="mt-2 grid grid-cols-2 gap-1 text-xs">
            <span className="text-slate-500">Fed total tax</span><span className="text-right tabular-nums">{money(wp.totals.federal.total_tax)}</span>
            <span className="text-slate-500">Fed balance</span><span className="text-right tabular-nums">{money(wp.totals.federal.balance_due)}</span>
            <span className="text-slate-500">CA total tax</span><span className="text-right tabular-nums">{money(wp.totals.california.total_tax)}</span>
            <span className="text-slate-500">CA balance</span><span className="text-right tabular-nums">{money(wp.totals.california.balance_due)}</span>
          </div>
        </Card>
      </div>

      <Card title="Workpaper adjustments (the original engine value is never overwritten)" pad={false}>
        <table className="w-full text-sm">
          <thead className="text-[10px] uppercase text-slate-400"><tr><th className="px-3 py-1.5 text-left font-medium">Line</th><th className="text-right font-medium">Engine</th><th className="text-right font-medium">Workpaper</th><th className="px-3 text-left font-medium">Why</th><th className="text-left font-medium">Who</th><th className="text-right font-medium">Tax effect</th><th className="px-3 text-left font-medium">Approval</th></tr></thead>
          <tbody>
            {wp.adjustments.map((a) => (
              <tr key={a.event.id} onClick={() => select(a.key)} className="cursor-pointer border-t border-slate-100 hover:bg-slate-50">
                <td className="px-3 py-1.5 font-mono text-xs">{a.key}</td>
                <td className="text-right tabular-nums text-slate-500">{formatLineValue(a.key, a.from)}</td>
                <td className="text-right font-medium tabular-nums text-indigo-700">{typeof a.to === "number" ? formatLineValue(a.key, a.to) : String(a.to)}</td>
                <td className="max-w-md px-3 text-xs text-slate-600">{a.event.payload.reason}</td>
                <td className="text-xs"><ActorName id={a.event.actorId} /></td>
                <td className="text-right"><Effect f={a.effect.federalBalance} c={a.effect.californiaBalance} /></td>
                <td className="px-3">{a.needsPartner ? (a.approvals.length ? <Badge tone="green">partner ✓</Badge> : <Badge tone="amber">needs partner</Badge>) : <Badge>—</Badge>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {wp.adjustments.length === 0 && <p className="p-4 text-sm text-slate-400">No adjustments yet.</p>}
      </Card>

      <Card title="Compare engine versions" actions={
        <span className="flex items-center gap-1 text-xs">
          <select className="rounded border border-slate-300 px-1" value={left} onChange={(e) => setLeft(e.target.value)}>{ix.versionOrder.map((v) => <option key={v}>{v}</option>)}</select>→
          <select className="rounded border border-slate-300 px-1" value={right} onChange={(e) => setRight(e.target.value)}>{ix.versionOrder.map((v) => <option key={v}>{v}</option>)}</select>
        </span>
      } pad={false}>
        <div className="flex flex-wrap gap-4 px-3 py-2 text-xs">
          <span>Fed total tax <b className="tabular-nums">{signedMoney(delta(L.version.summary.federal, R.version.summary.federal, "total_tax"))}</b></span>
          <span>Fed balance <b className="tabular-nums">{signedMoney(delta(L.version.summary.federal, R.version.summary.federal, "balance_due"))}</b></span>
          <span>CA total tax <b className="tabular-nums">{signedMoney(delta(L.version.summary.california, R.version.summary.california, "total_tax"))}</b></span>
          <span className="text-slate-500">{diffs.length} lines differ</span>
        </div>
        <div className="max-h-96 overflow-y-auto">
          <table className="w-full text-xs">
            <tbody>
              {diffs.map((k) => (
                <tr key={k} onClick={() => select(k)} className="cursor-pointer border-t border-slate-100 hover:bg-slate-50">
                  <td className="px-3 py-1 font-mono text-slate-500">{k}</td>
                  <td className="truncate">{(R.lines.get(k) ?? L.lines.get(k))?.label}</td>
                  <td className="text-right tabular-nums text-slate-500">{formatLineValue(k, L.lines.get(k)?.value ?? null)}</td>
                  <td className="px-1 text-slate-300">→</td>
                  <td className="px-3 text-right tabular-nums">{formatLineValue(k, R.lines.get(k)?.value ?? null)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="What-ifs (engine-computed alternatives)" pad={false}>
        <table className="w-full text-sm">
          <tbody>
            {ix.packet.what_if.alternatives.map((w) => {
              const elected = wp.elections.get(w.id);
              return (
                <tr key={w.id} className="border-t border-slate-100">
                  <td className="px-3 py-2"><div className="font-medium">{w.description}</div><div className="text-[11px] text-slate-500">{w.changed_lines.length} lines change · base {w.base_version}</div></td>
                  <td className="text-right"><Effect f={w.federal.total_tax_change + (w.federal.penalty_change ?? 0)} c={w.california.total_tax_change} /></td>
                  <td className="px-3 text-right">
                    {elected ? <Badge tone="violet">elected by {elected.actorId}</Badge> : <Button size="sm" onClick={() => setElect(w.id)} disabled={w.base_version !== wp.version} title={w.base_version !== wp.version ? `Computed on ${w.base_version}` : undefined}>Elect…</Button>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="px-3 py-2 text-[11px] text-slate-500">Electing records a judgment (with authority) and swaps in the engine's own numbers for that alternative. Extension estimate (from v2): federal paid {money(Number((ix.packet.what_if.extension.federal as Record<string, number>).paid_with_form_4868))} with Form 4868.</p>
      </Card>
      {elect && <ActionModal kind="judgment" target={ix.packet.what_if.alternatives.find((w) => w.id === elect)!.changed_lines[0]?.key ?? "F1040.24"} value={null} onClose={() => setElect(null)} preset={{ kind: "election", whatIfId: elect, decision: `Elect: ${ix.packet.what_if.alternatives.find((w) => w.id === elect)!.description}` }} />}
    </div>
  );
}
