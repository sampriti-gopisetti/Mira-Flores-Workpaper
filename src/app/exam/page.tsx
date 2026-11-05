"use client";

import { Printer } from "lucide-react";
import { useStore } from "@/client/store";
import { formatLineValue, money, shortDateTime } from "@/domain/format";
import type { Json } from "@/domain/types";
import { Badge, Button, Card, PageHeader } from "@/components/ui";
import { ActorName } from "@/components/wp";
import { DocumentViewer } from "@/components/DocumentViewer";
import { describe } from "@/components/Inspector";

interface Item { title: string; lines: string[]; docs: string[]; checks: string[] }

const ITEMS: Item[] = [
  { title: "Noncash charitable contributions (Schedule A line 12, Form 8283)", lines: ["F8283.A1.stock", "F8283.A1.vehicle", "SchA.12"], docs: ["D65", "D66"], checks: ["car-donation"] },
  { title: "Schedule C gross receipts vs Forms 1099-NEC (142,000) and 1099-K (12,400)", lines: ["SchC.1"], docs: ["D14", "D15", "D16", "D17", "D18", "D19", "D20", "D21"], checks: ["schc-gross"] },
];

export default function Exam() {
  const { ix, wp, actors } = useStore();
  const notice = ix.packet.tax_agency_records.notices.find((n) => n.id === "N-2025-L566") as Record<string, Json> | undefined;
  const snap = wp.filing.filedSnapshot;
  const val = (k: string) => (snap ? snap.lines[k] : wp.value(k));
  const nec = ["D16", "D17", "D18", "D19", "D20"].map((d) => ({ d, payer: String(ix.evByDocField.get(`${d}#payer`)?.value ?? d), amt: Number(ix.evByDocField.get(`${d}#box1`)?.value ?? 0) }));
  const partner = actors.find((a) => a.id === ix.packet.firm.firm_identity.paid_preparer_signing_returns);
  const relevant = (targets: string[]) => wp.events.filter((e) => targets.includes(e.target) && !wp.voided.has(e.id) && e.type !== "sensitive.viewed");
  return (
    <div className="space-y-4">
      <PageHeader title="Notice response — IRS Letter 566 (2025 correspondence examination)"
        sub={notice ? `Dated ${notice.dated}; response due ${notice.response_due}. Self-contained: the return as filed, the evidence, how each figure was verified, and every judgment — exactly as recorded.` : "No notice yet."}
        actions={<Button onClick={() => window.print()} className="no-print"><Printer size={14} />Print / save PDF</Button>} />
      {!snap && <p className="rounded bg-amber-50 p-2 text-sm text-amber-800">The return has not been filed in this replay; figures below are the current workpaper values. Move the season clock past filing for the as-filed record.</p>}
      <Card title="Record">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm md:grid-cols-4">
          <dt className="text-slate-500">Taxpayers</dt><dd>{wp.household.people.filter((p) => p.role !== "dependent").map((p) => `${p.name} (${p.ssn})`).join(", ")}</dd>
          <dt className="text-slate-500">Paid preparer</dt><dd>{partner?.name}, {partner?.credential} · {ix.packet.firm.name}</dd>
          <dt className="text-slate-500">Filed</dt><dd>{wp.filing.accepted.federal ? `${shortDateTime(wp.filing.accepted.federal.simAt)} · ${wp.filing.accepted.federal.payload.submissionId}` : "—"}</dd>
          <dt className="text-slate-500">Engine version</dt><dd>{snap?.version ?? wp.version} + {snap?.adjustments.length ?? wp.adjustmentsByKey.size} workpaper adjustments</dd>
        </dl>
        <p className="mt-2 text-xs text-slate-500">Items under examination: {(notice?.items_under_examination as string[] | undefined)?.join(" · ")}</p>
      </Card>

      {ITEMS.map((it) => (
        <Card key={it.title} title={it.title}>
          <table className="mb-3 w-full text-sm">
            <tbody>
              {it.lines.map((k) => (
                <tr key={k} className="border-t border-slate-100">
                  <td className="py-1 font-mono text-xs text-slate-500">{k}</td><td>{wp.vi.lines.get(k)?.label}</td>
                  <td className="text-right tabular-nums text-slate-400">engine {formatLineValue(k, wp.lineValues.get(k)?.engine ?? null)}</td>
                  <td className="text-right font-semibold tabular-nums">as filed {formatLineValue(k, val(k) ?? null)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {it.checks.map((id) => {
            const c = wp.checks.find((x) => x.id === id);
            return c ? <div key={id} className="mb-3 rounded border border-slate-200 p-2 text-sm"><Badge tone={c.status === "open" ? "amber" : "green"}>{c.status}</Badge> <b>{c.title}.</b> {c.summary}<ul className="ml-5 mt-1 list-disc text-xs text-slate-600">{c.detail.map((d, i) => <li key={i}>{d}</li>)}</ul></div> : null;
          })}
          {it.title.startsWith("Schedule C") && (
            <table className="mb-3 w-full text-sm">
              <thead className="text-[10px] uppercase text-slate-400"><tr><th className="text-left font-medium">Reconciliation</th><th className="text-right font-medium">Amount</th></tr></thead>
              <tbody>
                {nec.map((n) => <tr key={n.d} className="border-t border-slate-100"><td>Form 1099-NEC — {n.payer} ({n.d})</td><td className="text-right tabular-nums">{money(n.amt)}</td></tr>)}
                <tr className="border-t border-slate-100"><td>Clients who issued no Form 1099 (11 small clients, D15)</td><td className="text-right tabular-nums">{money(Number(ix.evByDocField.get("D15#unreported_small")?.value ?? 0))}</td></tr>
                <tr className="border-t-2 border-slate-300 font-semibold"><td>Gross receipts per books (D14)</td><td className="text-right tabular-nums">{money(Number(ix.evByDocField.get("D14#total_income")?.value ?? 0))}</td></tr>
                <tr className="border-t border-slate-100 text-slate-600"><td>Form 1099-K (Paywell) — Atlas card payments, already within Atlas's 1099-NEC of 41,200 and deposited gross (D15)</td><td className="text-right tabular-nums">({money(Number(ix.evByDocField.get("D21#box1a")?.value ?? 0))}) included above</td></tr>
              </tbody>
            </table>
          )}
          <h4 className="mb-1 mt-2 text-xs font-semibold uppercase text-slate-500">How each figure was handled</h4>
          <ul className="mb-3 space-y-0.5 text-xs">
            {relevant([...it.lines, ...it.docs, ...it.checks.map((c) => `check:${c}`), ...it.docs.flatMap((d) => (ix.evsByDoc.get(d) ?? []).map((e) => e.id))]).map((e) => (
              <li key={e.id}>{shortDateTime(e.simAt)} · <ActorName id={e.actorId} /> {describe(e)} <span className="font-mono text-slate-400">{e.target}</span></li>
            ))}
            {relevant(it.lines).length === 0 && <li className="text-slate-400">No workpaper actions recorded on these lines.</li>}
          </ul>
          <h4 className="mb-1 text-xs font-semibold uppercase text-slate-500">Source documents</h4>
          <div className="grid gap-4 lg:grid-cols-2">
            {it.docs.map((d) => <div key={d} className="break-inside-avoid"><DocumentViewer docId={d} /></div>)}
          </div>
        </Card>
      ))}
    </div>
  );
}
