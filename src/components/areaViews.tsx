"use client";

import clsx from "clsx";
import { useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useStore } from "@/client/store";
import { money, num, formatLineValue } from "@/domain/format";
import type { Lot } from "@/domain/lots";
import { Badge, Card, inputCls } from "./ui";
import { LineRow, LineValue, StatusIcon } from "./wp";

// ---------- Business: books to Schedule C ----------

const BRIDGE: { books: string[]; label: string; line?: string; treatment: string }[] = [
  { books: ["Sales - client projects", "Sales - print and licensing"], label: "Revenue", line: "SchC.1", treatment: "Engine adds Form 1099-K amounts it could not match to deposits" },
  { books: ["Advertising"], label: "Advertising", line: "SchC.8", treatment: "As booked" },
  { books: ["Car and truck - fuel"], label: "Car and truck", line: "SchC.9", treatment: "Replaced by standard mileage (business miles × rate)" },
  { books: ["Contract labor"], label: "Contract labor", line: "SchC.11", treatment: "As booked; Forms 1099-NEC not filed" },
  { books: ["Depreciation"], label: "Depreciation", line: "SchC.13", treatment: "Book straight-line replaced by tax method (100% special depreciation)" },
  { books: ["Insurance - business liability"], label: "Insurance", line: "SchC.15", treatment: "As booked" },
  { books: ["Insurance - health (Erik)"], label: "Health insurance", line: "Sch1.17", treatment: "Not a Schedule C expense; moved to SE health insurance (Schedule 1)" },
  { books: ["Legal and professional"], label: "Legal & professional", line: "SchC.17", treatment: "As booked" },
  { books: ["Office expenses"], label: "Office", line: "SchC.18", treatment: "As booked" },
  { books: ["Supplies"], label: "Supplies", line: "SchC.22", treatment: "As booked" },
  { books: ["Travel"], label: "Travel", line: "SchC.24a", treatment: "As booked" },
  { books: ["Meals"], label: "Meals", line: "SchC.24b", treatment: "50% limit" },
  { books: ["Telephone", "Internet"], label: "Utilities", line: "SchC.25", treatment: "Engine: 100% as booked" },
  { books: ["Software and subscriptions"], label: "Software", line: "SchC.27a.1", treatment: "As booked" },
  { books: ["Bank and merchant fees"], label: "Bank fees", line: "SchC.27a.2", treatment: "As booked" },
  { books: [], label: "Home office", line: "SchC.30", treatment: "Not in books; simplified method" },
];

export function BooksBridge() {
  const { ix, wp, select } = useStore();
  const books = new Map((ix.evsByDoc.get("D14") ?? []).map((e) => [e.field, e]));
  const amt = (fs: string[]) => fs.reduce((a, f) => a + num(books.get(f)?.value), 0);
  const netBooks = num(books.get("net_income")?.value);
  const net = num(wp.value("SchC.31"));
  let sumDiff = 0;
  return (
    <Card title="Books to taxable income (Lindqvist Studio, cash basis)" pad={false}>
      <table className="w-full text-sm">
        <thead className="text-[11px] uppercase text-slate-400"><tr><th className="px-3 py-1.5 text-left font-medium">Books (D14)</th><th className="text-right font-medium">Books</th><th className="px-3 text-left font-medium">Tax treatment</th><th className="text-left font-medium">Line</th><th className="text-right font-medium">Tax</th><th className="px-3 text-right font-medium">Difference</th></tr></thead>
        <tbody>
          {BRIDGE.map((r) => {
            const b = amt(r.books);
            const t = r.line ? num(wp.value(r.line)) : 0;
            const isIncome = r.line === "SchC.1";
            const diffProfit = r.line === "Sch1.17" ? b : isIncome ? t - b : b - t;
            sumDiff += diffProfit;
            return (
              <tr key={r.label} className="border-t border-slate-100 hover:bg-slate-50">
                <td className="px-3 py-1">{r.books.length ? r.books.map((f) => <button key={f} onClick={() => books.get(f) && select(books.get(f)!.id)} className="mr-1 text-left hover:text-indigo-700">{f}</button>) : <span className="text-slate-400">—</span>}</td>
                <td className="text-right tabular-nums text-slate-500">{r.books.length ? money(b) : ""}</td>
                <td className="px-3 text-xs text-slate-500">{r.treatment}</td>
                <td>{r.line && <button onClick={() => select(r.line!)} className="font-mono text-[11px] text-indigo-700 hover:underline">{r.line}</button>}</td>
                <td className="text-right">{r.line && <LineValue k={r.line} />}</td>
                <td className={clsx("px-3 text-right text-xs tabular-nums", diffProfit > 0 ? "text-emerald-700" : diffProfit < 0 ? "text-rose-600" : "text-slate-300")}>{diffProfit ? `${diffProfit > 0 ? "+" : "−"}${money(Math.abs(diffProfit))}` : "0"}</td>
              </tr>
            );
          })}
          <tr className="border-t-2 border-slate-200 font-semibold">
            <td className="px-3 py-1.5">Book net income</td><td className="text-right tabular-nums">{money(netBooks)}</td>
            <td className="px-3 text-xs font-normal text-slate-500">+ differences (effect on profit; health insurance moves to Schedule 1)</td>
            <td className="font-mono text-[11px]">SchC.31</td><td className="text-right"><LineValue k="SchC.31" /></td>
            <td className={clsx("px-3 text-right text-xs tabular-nums", Math.round(netBooks + sumDiff - 14400 * 0) === net ? "text-emerald-700" : "text-slate-500")}>{money(netBooks + sumDiff)} {Math.abs(netBooks + sumDiff - net) < 2 ? "✓ ties" : `(Δ ${money(net - netBooks - sumDiff)})`}</td>
          </tr>
        </tbody>
      </table>
    </Card>
  );
}

// ---------- Investments: Form 8949 boxes and lot explorer ----------

export function Form8949Summary() {
  const { wp } = useStore();
  const totals = wp.vi.version.lines.filter((l) => /^F8949\.[A-Z]\.total$/.test(l.key));
  const lotsPer = (box: string) => [...wp.lineValues.keys()].filter((k) => k.startsWith(`F8949.${box}.`) && !k.endsWith(".total"));
  return (
    <Card title="Form 8949 by box — totals first; detail on demand" pad={false}>
      {totals.map((t) => {
        const box = t.key.split(".")[1];
        return (
          <details key={t.key} className="group border-b border-slate-100">
            <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-1.5 text-sm hover:bg-slate-50">
              <span className="w-6 font-mono text-xs text-slate-400 group-open:text-indigo-600">{box}</span>
              <span className="flex-1 truncate text-slate-700">{t.label}</span>
              <Badge>{lotsPer(box).length} lots</Badge>
              <LineValue k={t.key} className="w-32 text-right" />
            </summary>
            <div className="max-h-72 overflow-y-auto bg-slate-50/50">
              {lotsPer(box).slice(0, 80).map((k) => <LineRow key={k} k={k} indent={1} />)}
              {lotsPer(box).length > 80 && <p className="px-6 py-2 text-xs text-slate-500">{lotsPer(box).length - 80} more lots — use the lot explorer below (server-paged).</p>}
            </div>
          </details>
        );
      })}
    </Card>
  );
}

export function LotExplorer() {
  const { lots, select } = useStore();
  const [doc, setDoc] = useState("D74");
  const [q, setQ] = useState("");
  const [term, setTerm] = useState("");
  const [only, setOnly] = useState("");
  const [sort, setSort] = useState("sold");
  const [data, setData] = useState<{ total: number; totals: { proceeds: number; basis: number; wash: number; gain: number }; rows: Lot[] } | null>(null);
  const parent = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const p = new URLSearchParams({ doc, q, term, only, sort, limit: "500" });
    fetch(`/api/lots?${p}`).then((r) => r.json()).then(setData);
  }, [doc, q, term, only, sort]);
  const rows = data?.rows ?? [];
  const v = useVirtualizer({ count: rows.length, getScrollElement: () => parent.current, estimateSize: () => 28, overscan: 12 });
  const agg = lots[doc];
  return (
    <Card title="Lot explorer (paged from the server)" actions={
      <select className="rounded border border-slate-300 px-1 py-0.5 text-xs" value={doc} onChange={(e) => setDoc(e.target.value)}>
        {Object.keys(lots).map((d) => <option key={d} value={d}>{d} · {lots[d].count} lots</option>)}
      </select>
    }>
      <div className="mb-2 grid grid-cols-2 gap-2 text-xs md:grid-cols-5">
        <input className={clsx(inputCls, "py-1 text-xs")} placeholder="Search security / lot" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className={clsx(inputCls, "py-1 text-xs")} value={term} onChange={(e) => setTerm(e.target.value)}><option value="">All terms</option><option value="short">Short-term</option><option value="long">Long-term</option></select>
        <select className={clsx(inputCls, "py-1 text-xs")} value={only} onChange={(e) => setOnly(e.target.value)}><option value="">All lots</option><option value="wash">Wash sales only</option><option value="loss">Losses only</option></select>
        <select className={clsx(inputCls, "py-1 text-xs")} value={sort} onChange={(e) => setSort(e.target.value)}><option value="sold">Sort: date sold</option><option value="gain">Sort: gain</option><option value="proceeds">Sort: proceeds</option><option value="wash">Sort: wash</option></select>
        <div className="self-center text-slate-500">{data ? `${data.total} lots · gain ${money(data.totals.gain, true)}` : "…"}</div>
      </div>
      {agg && <p className="mb-2 text-[11px] text-slate-500">Document aggregate: proceeds {money(agg.proceeds, true)}, basis {money(agg.basis, true)}, wash sales disallowed {money(agg.wash, true)} — reconciled to the 1099-B summary in the checks.</p>}
      <div className="grid grid-cols-[70px_1fr_90px_90px_100px_100px_80px_90px] border-b border-slate-200 px-2 py-1 text-[10px] font-medium uppercase text-slate-400">
        <span>Lot</span><span>Security</span><span>Acquired</span><span>Sold</span><span className="text-right">Proceeds</span><span className="text-right">Basis</span><span className="text-right">Wash</span><span className="text-right">Gain</span>
      </div>
      <div ref={parent} className="h-80 overflow-y-auto">
        <div style={{ height: v.getTotalSize(), position: "relative" }}>
          {v.getVirtualItems().map((it) => {
            const l = rows[it.index];
            return (
              <button key={l.lot} onClick={() => select(l.evIds.find((id) => id.length) ?? l.docId)} style={{ position: "absolute", top: 0, left: 0, right: 0, height: it.size, transform: `translateY(${it.start}px)` }}
                className="grid grid-cols-[70px_1fr_90px_90px_100px_100px_80px_90px] items-center px-2 text-left text-xs tabular-nums hover:bg-indigo-50">
                <span className="font-mono text-slate-500">{l.lot}</span><span className="truncate">{l.description}</span><span>{l.acquired}</span><span>{l.sold}</span>
                <span className="text-right">{money(l.proceeds, true)}</span><span className="text-right">{money(l.basis, true)}</span>
                <span className={clsx("text-right", l.wash > 0 && "text-amber-700")}>{l.wash ? money(l.wash, true) : ""}</span>
                <span className={clsx("text-right", l.gain < 0 ? "text-rose-600" : "text-emerald-700")}>{money(l.gain, true)}</span>
              </button>
            );
          })}
        </div>
      </div>
    </Card>
  );
}

// ---------- Rentals: depreciation by asset ----------

export function DepreciationTable() {
  const { wp, ix } = useStore();
  const assets = wp.vi.version.assets;
  const prior = new Map((ix.packet.prior_years.asset_records as { asset_id: string; federal: Record<string, number> }[]).map((a) => [a.asset_id, a]));
  const val = (o: Record<string, number | null>, k: string) => num(o?.[k] ?? 0);
  return (
    <Card title="Depreciation by asset — federal vs California vs AMT" pad={false}>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="text-[10px] uppercase text-slate-400">
            <tr><th className="px-3 py-1.5 text-left font-medium">Asset</th><th className="text-left font-medium">Activity</th><th className="text-right font-medium">Cost</th><th className="px-2 text-left font-medium">Method / life</th><th className="text-left font-medium">In service</th><th className="text-right font-medium">Fed 2025</th><th className="text-right font-medium">Fed accum.</th><th className="text-right font-medium">CA 2025</th><th className="text-right font-medium">CA accum.</th><th className="text-right font-medium">AMT diff</th><th className="px-3 text-left font-medium">Disposal</th></tr>
          </thead>
          <tbody>
            {assets.map((a) => (
              <tr key={a.asset_id} className="border-t border-slate-100">
                <td className="px-3 py-1"><span className="font-mono text-slate-500">{a.asset_id}</span> {a.description}{prior.has(a.asset_id) ? "" : <Badge tone="indigo" className="ml-1">new 2025</Badge>}</td>
                <td className="text-slate-500">{a.activity}</td>
                <td className="text-right tabular-nums">{money(a.cost)}{a.land_value_not_depreciated ? <span className="block text-[10px] text-slate-400">land {money(a.land_value_not_depreciated)}</span> : null}</td>
                <td className="px-2">{a.method} · {a.life_years}y</td>
                <td>{a.placed_in_service}</td>
                <td className="text-right tabular-nums">{money(val(a.federal, "depreciation_2025"), true)}</td>
                <td className="text-right tabular-nums text-slate-500">{money(val(a.federal, "accumulated_end"), true)}</td>
                <td className={clsx("text-right tabular-nums", val(a.california, "depreciation_2025") !== val(a.federal, "depreciation_2025") && "text-violet-700")}>{money(val(a.california, "depreciation_2025"), true)}</td>
                <td className="text-right tabular-nums text-slate-500">{money(val(a.california, "accumulated_end"), true)}</td>
                <td className="text-right tabular-nums">{val(a.amt, "difference_from_regular") ? money(val(a.amt, "difference_from_regular"), true) : "—"}</td>
                <td className="px-3">{a.disposed ? <span className="text-amber-700">{typeof a.disposed === "object" ? Object.entries(a.disposed as Record<string, unknown>).map(([k, v]) => `${k}: ${v}`).join(" · ") : String(a.disposed)}</span> : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="px-3 py-2 text-[11px] text-slate-500">California differences carried forward: {Object.entries(wp.vi.version.carryovers_out.california.depreciation_basis_differences as Record<string, number> ?? {}).map(([k, v]) => `${k} ${money(v, true)}`).join(" · ")}</p>
    </Card>
  );
}

// ---------- Pass-throughs: basis by year ----------

export function BasisByYear() {
  const { ix, wp, select } = useStore();
  const recs = ix.packet.prior_years.basis_records.scorp_lindqvist_family_woodworks as { year: number; ending_stock_basis?: number | null; k1_income?: number; distributions?: number; source: string }[];
  const d40 = wp.visibleDocs.has("D40");
  const ev = (d: string, f: string) => num(ix.evByDocField.get(`${d}#${f}`)?.value);
  const rows = [
    { year: 2022, inc: null, dist: null, end: recs[0]?.ending_stock_basis ?? 0, src: recs[0]?.source, ref: "py:/basis_records/scorp_lindqvist_family_woodworks/0" },
    { year: 2023, inc: d40 ? ev("D40", "box1") : null, dist: d40 ? ev("D40", "box16d") : null, end: d40 ? (recs[0]?.ending_stock_basis ?? 0) + ev("D40", "box1") - ev("D40", "box16d") : null, src: d40 ? "2023 K-1 (D40, found June 2026)" : "missing — 2023 K-1 not in file", ref: d40 ? "D40" : "" },
    { year: 2024, inc: recs[2]?.k1_income ?? null, dist: recs[2]?.distributions ?? null, end: null as number | null, src: recs[2]?.source, ref: "py:/basis_records/scorp_lindqvist_family_woodworks/2" },
    { year: 2025, inc: ev("D39", "box1") + ev("D39", "box4"), dist: ev("D39", "box16d"), end: num(wp.value("F7203.15")), src: "2025 K-1 (D39); Form 7203", ref: "F7203.1" },
  ];
  rows[2].end = rows[1].end != null ? rows[1].end + (rows[2].inc ?? 0) - (rows[2].dist ?? 0) : null;
  return (
    <Card title="S corporation stock basis by year — Lindqvist Family Woodworks (20%)" pad={false}>
      <table className="w-full text-sm">
        <thead className="text-[10px] uppercase text-slate-400"><tr><th className="px-3 py-1.5 text-left font-medium">Year</th><th className="text-right font-medium">Income</th><th className="text-right font-medium">Distributions</th><th className="text-right font-medium">Ending basis</th><th className="px-3 text-left font-medium">Source</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.year} className="border-t border-slate-100">
              <td className="px-3 py-1">{r.year}</td>
              <td className="text-right tabular-nums">{r.inc != null ? money(r.inc) : "—"}</td>
              <td className="text-right tabular-nums">{r.dist != null ? money(r.dist) : "—"}</td>
              <td className={clsx("text-right font-medium tabular-nums", r.end == null && "text-rose-600")}>{r.end != null ? money(Math.max(0, r.end)) : "gap"}</td>
              <td className="px-3 text-xs text-slate-500">{r.ref ? <button onClick={() => select(r.ref)} className="hover:text-indigo-700">{r.src}</button> : r.src}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="px-3 py-2 text-xs text-slate-500">2025: distributions {money(ev("D39", "box16d"))} exceed basis before distributions (<LineValue k="F7203.5" />) by <LineValue k="F7203.excess" /> → capital gain (Form 8949 box F). Distributions include Oregon composite tax 1,580. Ridgeline LP capital: 60,000 → 63,660 (outside basis never computed — carried forward as an open item).</p>
    </Card>
  );
}

// ---------- California: Schedule CA (540NR) split ----------

export function StateSplit() {
  const { wp, select } = useStore();
  const rows = useMemo(() => {
    const by = new Map<string, Record<string, string>>();
    for (const l of wp.vi.version.lines) {
      const m = /^SchCA540NR\.(\w+)\.([A-E])$/.exec(l.key);
      if (!m) continue;
      const r = by.get(m[1]) ?? {};
      r[m[2]] = l.key;
      r.label = l.label.replace(/ - (federal|CA additions|CA subtractions|total using CA law|California amount)$/, "");
      by.set(m[1], r);
    }
    return [...by.entries()];
  }, [wp.vi]);
  return (
    <Card title="Schedule CA (540NR): federal → California law → California source" pad={false}>
      <table className="w-full text-xs">
        <thead className="text-[10px] uppercase text-slate-400"><tr><th className="px-3 py-1.5 text-left font-medium">Line</th><th className="text-right font-medium">A Federal</th><th className="text-right font-medium">B Subtractions</th><th className="text-right font-medium">C Additions</th><th className="text-right font-medium">D CA law</th><th className="px-3 text-right font-medium">E CA source</th><th className="px-2 text-right font-medium">E / D</th></tr></thead>
        <tbody>
          {rows.map(([n, r]) => (
            <tr key={n} className="border-t border-slate-100">
              <td className="px-3 py-1">{n} · {r.label}</td>
              {(["A", "B", "C", "D", "E"] as const).map((c) => <td key={c} className={clsx("text-right", c === "E" && "px-3")}>{r[c] ? <button onClick={() => select(r[c])}><LineValue k={r[c]} /></button> : <span className="text-slate-300">—</span>}</td>)}
              <td className="px-2 text-right text-slate-400">{r.D && r.E && num(wp.value(r.D)) ? `${Math.round((num(wp.value(r.E)) / num(wp.value(r.D))) * 100)}%` : ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="px-3 py-2 text-[11px] text-slate-500">Residency: CA 01/01–07/14 ({wp.household.residency[0].to}), TX from 07/15. Engine prorates interest, gains, business income and adjustments by residency days ({String((wp.vi.version.lines.find((l) => l.key === "F540NR.34")?.value) ?? "")} deduction ratio); fully California-source items (Sacramento rental, Ridgeline 22% CA share) are sourced directly.</p>
    </Card>
  );
}

// ---------- Payments vs agency records ----------

export function PaymentsRecon() {
  const { ix, wp } = useStore();
  const snaps = ix.packet.tax_agency_records.irs_account_transcript_2025.filter((t) => t.as_of <= wp.asOf.slice(0, 10));
  const snap = snaps.at(-1);
  const ftb = ix.packet.tax_agency_records.ftb_account;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title={`IRS account transcript${snap ? ` (as of ${snap.as_of})` : " — not yet pulled"}`} pad={false}>
        <table className="w-full text-xs">
          <tbody>
            {(snap?.transactions ?? []).map((t, i) => (
              <tr key={i} className="border-t border-slate-100"><td className="px-3 py-1">{t.date}</td><td className="font-mono">{t.code}</td><td>{t.description}</td><td className="px-3 text-right tabular-nums">{typeof t.amount === "number" ? money(t.amount) : <span className="text-slate-400">{t.amount}</span>}</td></tr>
            ))}
          </tbody>
        </table>
        <div className="border-t border-slate-200 px-3 py-2 text-xs">Return line 26 (estimates): <LineValue k="F1040.26" /> · extension payment <LineValue k="Sch3.10" /></div>
      </Card>
      <Card title={`FTB account (as of ${ftb.as_of})`} pad={false}>
        <table className="w-full text-xs">
          <tbody>
            {ftb.tax_year_2025_payments.map((t, i) => <tr key={i} className="border-t border-slate-100"><td className="px-3 py-1">{t.date}</td><td>Applied to 2025</td><td className="px-3 text-right tabular-nums">{money(t.amount)}</td></tr>)}
            {ftb.tax_year_2024_payments_after_filing.map((t, i) => <tr key={`x${i}`} className="border-t border-slate-100 bg-amber-50/60"><td className="px-3 py-1">{t.date}</td><td className="text-amber-800">{t.note}</td><td className="px-3 text-right tabular-nums">{money(t.amount)}</td></tr>)}
          </tbody>
        </table>
        <div className="border-t border-slate-200 px-3 py-2 text-xs">540NR line 72 (estimates): <LineValue k="F540NR.72" /> · withholding <LineValue k="F540NR.71" /></div>
      </Card>
    </div>
  );
}

export function W2Table() {
  const { ix, wp, select } = useStore();
  const fields = ["box1", "box2", "box3", "box4", "box5", "box6", "box10", "box12_D", "box12_W", "box16", "box17"];
  const docs = ["D08", "D09", "D10"].filter((d) => wp.visibleDocs.has(d));
  return (
    <Card title="W-2s side by side (D10 is a phone photo of D09)" pad={false}>
      <table className="w-full text-xs">
        <thead className="text-[10px] uppercase text-slate-400"><tr><th className="px-3 py-1.5 text-left font-medium">Box</th>{docs.map((d) => <th key={d} className="px-2 text-right font-medium">{d} {ix.duplicateOf.has(d) && "(dup)"}</th>)}</tr></thead>
        <tbody>
          {fields.map((f) => (
            <tr key={f} className="border-t border-slate-100">
              <td className="px-3 py-1 font-mono text-slate-500">{f}</td>
              {docs.map((d) => {
                const e = ix.evByDocField.get(`${d}#${f}`);
                return <td key={d} className={clsx("px-2 text-right tabular-nums", ix.duplicateOf.has(d) && "text-slate-400")}>{e ? <button onClick={() => select(e.id)} className="inline-flex items-center gap-1 hover:text-indigo-700"><StatusIcon status={wp.evStatus.get(e.id)?.status} size={10} />{formatLineValue("", e.value)}</button> : "—"}</td>;
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
