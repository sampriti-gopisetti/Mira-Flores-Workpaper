"use client";

import { useEffect, useState } from "react";
import { Upload } from "lucide-react";
import { useStore } from "@/client/store";
import { AREAS } from "@/domain/areas";
import { ROLE_LABEL } from "@/domain/actors";
import { shortDateTime } from "@/domain/format";
import { Badge, Button, Card, Field, PageHeader, inputCls } from "@/components/ui";
import { ActorName } from "@/components/wp";

export default function Admin() {
  const { wp, ix, actors, actor, emit, allowed, toast } = useStore();
  const vr = wp.standards.variance_review;
  const [pct, setPct] = useState(String(vr.flag_if_change_over_percent));
  const [amt, setAmt] = useState(String(vr.and_over_amount));
  const [thr, setThr] = useState(String(wp.standards.partner_threshold));
  const [newType, setNewType] = useState("");
  const [ingest, setIngest] = useState<string>("");
  const d = allowed({ type: "standard.changed", target: "standards", payload: { path: "x", value: 1 } });

  async function save() {
    await emit([
      { type: "standard.changed", target: "standards", payload: { path: "variance_review.flag_if_change_over_percent", value: Number(pct), note: "" } },
      { type: "standard.changed", target: "standards", payload: { path: "variance_review.and_over_amount", value: Number(amt), note: "" } },
      { type: "standard.changed", target: "standards", payload: { path: "partner_threshold", value: Number(thr), note: "" } },
    ], { label: "Firm standards updated" });
  }
  async function upload(file: File) {
    const r = await fetch("/api/ingest", { method: "POST", headers: { "x-actor": actor.id }, body: await file.text() });
    const b = await r.json();
    setIngest(r.ok ? `${b.status} · return ${b.returnId} · packet ${b.packetId.slice(0, 8)}… · ${b.ms} ms${b.counts ? ` · ${Object.entries(b.counts).map(([k, v]) => `${v} ${k}`).join(", ")}` : ""}` : `Rejected: ${b.error}${b.issues ? ` — ${b.issues.join("; ")}` : ""}`);
    if (!r.ok) toast({ text: b.error, kind: "error" });
  }
  async function bundled(which: "rerun" | "original") {
    setIngest(which === "rerun" ? "Ingesting the re-run packet…" : "Restoring the original packet…");
    const r = await fetch(`/api/ingest?bundled=${which}`, { method: "POST", headers: { "x-actor": actor.id } });
    const b = await r.json();
    if (!r.ok) { setIngest(`Rejected: ${b.error}`); toast({ text: b.error, kind: "error" }); return; }
    toast({ text: `${which === "rerun" ? "Re-run" : "Original"} packet is now current (${b.status}, ${b.ms} ms) — reloading`, kind: "ok" });
    setTimeout(() => window.location.reload(), 900);
  }
  const isRerun = Boolean((ix.packet.readme as Record<string, unknown>).rerun_demo);
  const views = wp.sensitiveViews;
  return (
    <div className="space-y-4">
      <PageHeader title="Firm administration" sub="Standards, people and access, time against budget, and packet intake. Standards changes are events too — fully audited." />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Firm standards" actions={!d.ok && <span className="text-[11px] text-amber-700">{d.reason}</span>}>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Variance: flag over %"><input className={inputCls} value={pct} onChange={(e) => setPct(e.target.value)} /></Field>
            <Field label="…and over amount"><input className={inputCls} value={amt} onChange={(e) => setAmt(e.target.value)} /></Field>
            <Field label="Partner sign-off over"><input className={inputCls} value={thr} onChange={(e) => setThr(e.target.value)} /></Field>
          </div>
          <Button className="mt-3" variant="primary" decision={d} onClick={save}>Save standards</Button>
          <div className="mt-4">
            <p className="text-xs font-medium text-slate-600">Verification types</p>
            <div className="mt-1 flex flex-wrap gap-1">{wp.standards.verification_types.map((v) => <Badge key={v}>{v.replace(/_/g, " ")}</Badge>)}</div>
            <div className="mt-2 flex gap-1.5">
              <input className={inputCls + " py-1"} placeholder="add a type, e.g. inspected_original" value={newType} onChange={(e) => setNewType(e.target.value)} />
              <Button size="sm" decision={d} disabled={!newType} onClick={() => emit([{ type: "standard.changed", target: "standards", payload: { path: "verification_types", value: [...wp.standards.verification_types, newType.trim().replace(/\s+/g, "_")], note: "" } }], { label: "Verification type added" }).then(() => setNewType(""))}>Add</Button>
            </div>
          </div>
          <div className="mt-4">
            <p className="text-xs font-medium text-slate-600">Rules (enforced by the policy engine)</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-slate-600">{wp.standards.rules.map((r) => <li key={r}>{r}</li>)}</ul>
          </div>
        </Card>

        <Card title="People & access" pad={false}>
          <table className="w-full text-sm">
            <tbody>
              {actors.filter((a) => a.role !== "examiner").map((a) => (
                <tr key={a.id} className="border-t border-slate-100">
                  <td className="px-3 py-1.5">{a.name}<span className="block text-[11px] text-slate-500">{ROLE_LABEL[a.role]}{a.credential ? `, ${a.credential}` : ""}</span></td>
                  <td>{a.role !== "client" && (a.clearance ? <Badge tone="green">clearance</Badge> : <Badge tone="amber">masked</Badge>)}</td>
                  <td className="text-xs text-slate-500">{a.activeFrom ? `from ${a.activeFrom}` : ""}</td>
                  <td className="px-3 text-xs text-slate-500">{[wp.assignments.preparer === a.id && "preparer", wp.assignments.reviewer === a.id && "reviewer", wp.assignments.partner === a.id && "partner"].filter(Boolean).join(", ")}{a.note && <span className="block text-amber-700">{a.note}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="border-t border-slate-200 p-3 text-xs">
            <p className="font-medium text-slate-600">Deadlines</p>
            <ul className="mt-1 space-y-0.5">{ix.packet.firm.deadlines.map((dl) => <li key={dl.what} className={dl.date < wp.asOf.slice(0, 10) ? "text-slate-400" : ""}><span className="tabular-nums">{dl.date}</span> — {dl.what}</li>)}</ul>
          </div>
        </Card>

        <Card title={`Sensitive data view log (${views.length})`} pad={false}>
          {views.length === 0 ? <p className="p-3 text-xs text-slate-400">No unmasked views yet. Every reveal of an SSN, IP PIN or bank number is logged here before the value is returned.</p> : (
            <table className="w-full text-xs"><tbody>
              {views.slice().reverse().map((v) => <tr key={v.id} className="border-t border-slate-100"><td className="px-3 py-1">{shortDateTime(v.at)}</td><td><ActorName id={v.actorId} /></td><td className="font-mono">{v.payload.field}</td><td className="px-3 text-slate-500">{v.payload.purpose}</td></tr>)}
            </tbody></table>
          )}
          <p className="border-t border-slate-100 p-3 text-[11px] text-slate-500">Retention: records retained 7 years after filing, then destroyed (at scale: per-return encryption keys are destroyed — crypto-shredding — so the append-only log stays intact).</p>
        </Card>

        <Card title="Time vs budget" pad={false}>
          <table className="w-full text-sm"><tbody>
            {AREAS.map((a) => {
              const spent = wp.timeByArea.get(a.id) ?? 0;
              const budget = a.budgetKey ? ix.packet.firm.budget_hours[a.budgetKey] : undefined;
              return <tr key={a.id} className="border-t border-slate-100"><td className="px-3 py-1">{a.title}</td><td className={`px-3 text-right tabular-nums ${budget != null && spent > budget ? "text-rose-600" : ""}`}>{spent} / {budget ?? "—"} h</td></tr>;
            })}
            <tr className="border-t border-slate-100"><td className="px-3 py-1">Partner review</td><td className="px-3 text-right tabular-nums">{wp.timeByArea.get("partner_review") ?? 0} / {ix.packet.firm.budget_hours.partner_review} h</td></tr>
          </tbody></table>
        </Card>

        <Card title="Packet intake">
          <p className="text-xs text-slate-600">Ingest a pipeline packet: validated against the versioned schema, written in one transaction, serialized per return, and idempotent by content hash (re-sending the same packet is a no-op).</p>
          <label className="mt-2 inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50"><Upload size={14} />Upload packet JSON<input type="file" accept="application/json" className="hidden" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} /></label>
          {ingest && <p className="mt-2 rounded bg-slate-50 p-2 font-mono text-[11px]">{ingest}</p>}
          <p className="mt-2 text-[11px] text-slate-500">Loaded packet: {ix.packet.packet.name} v{ix.packet.packet.version}, generated {ix.packet.packet.generated}.</p>
        </Card>

        <FirmStatus refreshKey={wp.events.length} />

        <Card title="Pipeline re-run: does human work survive?" className="lg:col-span-2" actions={<Badge tone={isRerun ? "violet" : "slate"}>{isRerun ? "re-run packet is current" : "original packet is current"}</Badge>}>
          <p className="text-sm text-slate-700">When the extraction pipeline runs again, every extracted value gets a new id (<span className="font-mono">ev-0016</span> may become <span className="font-mono">ev-2997</span>). Work recorded against the old id would silently point at the wrong value. Every action on a value therefore also stores an <b>anchor</b> — document fingerprint + field — and the workpaper re-attaches it by meaning, then re-checks the value it was based on.</p>
          <p className="mt-1 text-xs text-slate-500">Demo: verify or correct a few values (e.g. Corvane W-2 box 1, the Little Sprouts EIN), then ingest the re-run packet. It renumbers all {ix.packet.documents.reduce((n, d) => n + d.extraction.values, 0).toLocaleString()} ids, re-reads the D62 EIN as printed, and leaves everything else the same.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="primary" decision={allowed({ type: "standard.changed", target: "standards", payload: { path: "x", value: 1 } })} disabled={isRerun} onClick={() => bundled("rerun")}><Upload size={14} />Ingest re-run packet</Button>
            <Button decision={allowed({ type: "standard.changed", target: "standards", payload: { path: "x", value: 1 } })} disabled={!isRerun} onClick={() => bundled("original")}>Restore original packet</Button>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <div className="rounded-md bg-slate-50 p-3"><div className="text-2xl font-semibold">{wp.remapped.length}</div><div className="text-xs text-slate-500">actions re-attached by anchor</div></div>
            <div className="rounded-md bg-slate-50 p-3"><div className="text-2xl font-semibold">{wp.remapped.filter((r) => wp.evStatus.get(r.to)?.status === "stale").length}</div><div className="text-xs text-slate-500">re-attached, but the value changed → re-verify</div></div>
            <div className="rounded-md bg-slate-50 p-3"><div className={wp.orphaned.length ? "text-2xl font-semibold text-rose-600" : "text-2xl font-semibold"}>{wp.orphaned.length}</div><div className="text-xs text-slate-500">orphaned (value no longer exists) → flagged as an issue</div></div>
          </div>
          {wp.remapped.length > 0 && (
            <table className="mt-3 w-full text-xs">
              <thead className="text-[10px] uppercase text-slate-400"><tr><th className="text-left font-medium">Action</th><th className="text-left font-medium">By</th><th className="text-left font-medium">Value</th><th className="text-left font-medium">Old id → new id</th><th className="text-left font-medium">Status</th></tr></thead>
              <tbody>
                {wp.remapped.map((r) => {
                  const e = ix.evs.get(r.to);
                  const st = wp.evStatus.get(r.to);
                  return (
                    <tr key={r.event.id} className="border-t border-slate-100">
                      <td className="py-1">{r.event.type.replace(".", " ")}</td>
                      <td><ActorName id={r.event.actorId} /></td>
                      <td>{e?.label} <span className="text-slate-400">({e?.document_id})</span></td>
                      <td className="font-mono">{r.from} → {r.to}</td>
                      <td>{r.event.type === "verification.recorded" ? (st?.status === "stale" ? <Badge tone="amber">value changed — re-verify</Badge> : <Badge tone="green">carried, value unchanged</Badge>) : <Badge tone="slate">re-attached</Badge>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </Card>
      </div>
    </div>
  );
}

interface StatusRow { returnId: string; client: string; year: number; phase: string; seq: number; events: number; openIssues: number; blockers: string[]; asOf: string; updatedAt: string; totals: { federal: { balance_due: number }; california: { balance_due: number }; estimated: boolean } }
interface Instance { seq: number; events: number; cachedStates: number; incrementalReads: number; rowsRead: number; stateHits: number; stateMisses: number }

/** Firm-wide status from persisted snapshots: no return's log is replayed to draw this. */
function FirmStatus({ refreshKey }: { refreshKey: number }) {
  const [data, setData] = useState<{ ms: number; returns: StatusRow[]; instance: Instance | null } | null>(null);
  useEffect(() => { fetch("/api/returns").then((r) => r.json()).then(setData).catch(() => {}); }, [refreshKey]);
  return (
    <Card title="Firm status (from snapshots)" className="lg:col-span-2" actions={data && <span className="text-[11px] text-slate-400">{data.returns.length} return(s) · read in {data.ms} ms</span>}>
      <p className="text-xs text-slate-600">After every change the server stores the return's headline state (phase, balances, open issues, blockers) as a snapshot row. Firm-wide status and search read these rows instead of replaying each return's action log, so they stay fast however long the logs grow.</p>
      {data && data.returns.length === 0 && <p className="mt-2 text-xs text-slate-400">No snapshot yet — the first recorded action writes one.</p>}
      {data && data.returns.length > 0 && (
        <table className="mt-2 w-full text-xs">
          <thead className="text-[10px] uppercase text-slate-400"><tr><th className="text-left font-medium">Client</th><th className="text-left font-medium">Phase</th><th className="text-right font-medium">Fed balance</th><th className="text-right font-medium">CA balance</th><th className="text-right font-medium">Open issues</th><th className="text-right font-medium">Log position</th><th className="px-2 text-left font-medium">Updated</th></tr></thead>
          <tbody>
            {data.returns.map((r) => (
              <tr key={r.returnId} className="border-t border-slate-100">
                <td className="py-1">{r.client} · {r.year}</td><td>{r.phase.replace("_", " ")}</td>
                <td className="text-right tabular-nums">{r.totals.federal.balance_due.toLocaleString()}</td>
                <td className="text-right tabular-nums">{r.totals.california.balance_due.toLocaleString()}</td>
                <td className="text-right tabular-nums">{r.openIssues}</td>
                <td className="text-right tabular-nums">#{r.seq} ({r.events} events)</td>
                <td className="px-2 text-slate-500">{new Date(r.updatedAt).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {data?.instance && (
        <p className="mt-2 text-[11px] text-slate-500">This server instance: log cached to #{data.instance.seq} ({data.instance.events} events); {data.instance.incrementalReads} incremental reads fetched {data.instance.rowsRead} new row(s) in total; computed-state cache {data.instance.stateHits} hits / {data.instance.stateMisses} misses.</p>
      )}
    </Card>
  );
}
