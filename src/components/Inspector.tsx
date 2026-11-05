"use client";

import clsx from "clsx";
import { useState, type ReactNode } from "react";
import { X, Undo2, CheckCircle2, MessageSquare, Eye, CornerDownRight } from "lucide-react";
import { useStore } from "@/client/store";
import { inputTree } from "@/domain/packetIndex";
import { resolveRef } from "@/domain/refs";
import { formatLineValue, formatValue, shortDateTime, signedMoney } from "@/domain/format";
import { AREA_BY_ID, areaForLine } from "@/domain/areas";
import type { WpEvent } from "@/domain/events";
import type { Json } from "@/domain/types";
import { Badge, Button, Empty, inputCls } from "./ui";
import { ActorName, Effect, LineValue, Refs, StatusIcon } from "./wp";
import { ActionModal, ItemActions, verifyLabel } from "./actions";
import { DocumentViewer } from "./DocumentViewer";
import { CheckCard } from "./CheckCard";

function Section({ title, children, right, tour }: { title: string; children: ReactNode; right?: ReactNode; tour?: string }) {
  return (
    <div data-tour={tour} className="border-b border-slate-100 px-4 py-3">
      <div className="mb-2 flex items-center justify-between"><h4 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{title}</h4>{right}</div>
      {children}
    </div>
  );
}

export function describe(e: WpEvent): string {
  const p = e.payload as Record<string, unknown>;
  switch (e.type) {
    case "verification.recorded": return `verified (${verifyLabel(String(p.method))}) at ${JSON.stringify(p.seenValue)}`;
    case "adjustment.made": return p.kind === "correction" ? `corrected to “${p.to}”: ${p.reason}` : `adjusted ${JSON.stringify(p.from)} → ${JSON.stringify(p.to)}: ${p.reason}`;
    case "adjustment.approved": return "approved adjustment (partner)";
    case "note.opened": return `${p.kind} note: ${p.text}`;
    case "note.replied": return `replied: ${p.text}`;
    case "note.resolved": return `cleared note${p.text ? `: ${p.text}` : ""}`;
    case "question.asked": return `asked ${p.to === "client" ? "the client" : p.to}: ${p.text}`;
    case "question.answered": return `answered: ${p.text}`;
    case "judgment.recorded": return `${String(p.kind).replace("_", " ")}: ${p.decision}${p.authority ? ` — ${p.authority}` : ""}`;
    case "signoff.given": return `${p.level} sign-off`;
    case "attachment.added": return `attached ${p.name}`;
    case "event.voided": return `undid ${(p.eventIds as string[]).length} change(s)`;
    case "sensitive.viewed": return `viewed ${p.field}`;
    default: return e.type;
  }
}

export function History({ target, extra = [] }: { target: string; extra?: string[] }) {
  const { wp, actor, undo } = useStore();
  const targets = new Set([target, ...extra]);
  const evs = wp.events.filter((e) => targets.has(e.target) && e.simAt <= wp.asOf && e.type !== "event.voided");
  if (!evs.length) return <p className="text-xs text-slate-400">No activity yet.</p>;
  return (
    <ol className="space-y-1.5">
      {evs.slice().reverse().map((e) => {
        const voided = wp.voided.has(e.id);
        return (
          <li key={e.id} className={clsx("text-xs", voided && "text-slate-400 line-through")}>
            <div className="flex items-start gap-2">
              <span className="w-28 shrink-0 text-[10px] text-slate-400">{shortDateTime(e.simAt)}</span>
              <span className="min-w-0 flex-1"><ActorName id={e.actorId} /> {describe(e)}{e.layer !== "original" && <Badge tone="violet" className="ml-1">{e.layer}</Badge>}</span>
              {!voided && e.actorId === actor.id && !["sensitive.viewed", "signoff.given"].includes(e.type) && !wp.filing.frozen && (
                <button title="Undo" onClick={() => undo([e.id])} className="text-slate-400 hover:text-indigo-600"><Undo2 size={12} /></button>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export function NotesThread({ target }: { target: string }) {
  const { wp, emit, allowed, actor } = useStore();
  const [reply, setReply] = useState<Record<string, string>>({});
  const notes = wp.notes.filter((n) => n.target === target && (actor.role !== "client" || n.visibility === "client"));
  const qs = wp.questions.filter((q) => q.target === target);
  if (!notes.length && !qs.length) return <p className="text-xs text-slate-400">No notes or questions.</p>;
  return (
    <div className="space-y-2">
      {notes.map((n) => (
        <div key={n.id} className={clsx("rounded-md border p-2 text-xs", n.kind === "review" && !n.resolved ? "border-amber-300 bg-amber-50" : "border-slate-200")}>
          <div className="mb-1 flex items-center gap-1.5">
            <Badge tone={n.kind === "review" ? (n.resolved ? "green" : "amber") : "slate"}>{n.kind}{n.resolved ? " · cleared" : n.kind === "review" ? " · blocks filing" : ""}</Badge>
            {n.visibility === "client" && <Badge tone="blue">shared with client</Badge>}
            <ActorName id={n.author} />{n.assignee && <> → <ActorName id={n.assignee} /></>}
            <span className="ml-auto text-[10px] text-slate-400">{shortDateTime(n.simAt)}</span>
          </div>
          <p className="text-slate-800">{n.text}</p>
          {n.replies.map((r, i) => <p key={i} className="mt-1 flex gap-1 text-slate-700"><CornerDownRight size={12} className="mt-0.5 text-slate-400" /><span><ActorName id={r.author} />: {r.text}</span></p>)}
          {n.resolved && <p className="mt-1 text-emerald-700">Cleared by <ActorName id={n.resolved.by} />{n.resolved.text && `: ${n.resolved.text}`}</p>}
          {!n.resolved && (
            <div className="mt-1.5 flex gap-1">
              <input className={clsx(inputCls, "py-1 text-xs")} placeholder="Reply…" value={reply[n.id] ?? ""} onChange={(e) => setReply({ ...reply, [n.id]: e.target.value })} />
              <Button size="sm" decision={allowed({ type: "note.replied", target, payload: { noteId: n.id, text: "x" } })} disabled={!reply[n.id]}
                onClick={() => emit([{ type: "note.replied", target, payload: { noteId: n.id, text: reply[n.id] } }]).then(() => setReply({ ...reply, [n.id]: "" }))}>Reply</Button>
              <Button size="sm" decision={allowed({ type: "note.resolved", target, payload: { noteId: n.id } })}
                onClick={() => emit([{ type: "note.resolved", target, payload: { noteId: n.id, text: reply[n.id] ?? "" } }], { label: "Note cleared" })}><CheckCircle2 size={12} />Clear</Button>
            </div>
          )}
        </div>
      ))}
      {qs.map((q) => (
        <div key={q.id} className="rounded-md border border-sky-200 bg-sky-50 p-2 text-xs">
          <div className="mb-1 flex items-center gap-1.5"><Badge tone="blue">question</Badge><ActorName id={q.from} /> → {q.to === "client" ? "client" : <ActorName id={q.to} />}<span className="ml-auto text-[10px] text-slate-400">{shortDateTime(q.at)}</span></div>
          <p>{q.text}</p>
          {q.answer ? <p className="mt-1 font-medium text-slate-800">Answer (<ActorName id={q.answer.by} />): {q.answer.text} <Badge tone="green">evidence</Badge></p> : <p className="mt-1 text-slate-500">Awaiting answer</p>}
        </div>
      ))}
    </div>
  );
}

function Tree({ node, depth = 0 }: { node: ReturnType<typeof inputTree>; depth?: number }) {
  const { wp, select, ix } = useStore();
  const l = wp.vi.lines.get(node.key);
  const rule = l ? ix.packet.engine_reference.rules[l.rule] : undefined;
  return (
    <div>
      <button onClick={() => select(node.key)} className="flex w-full items-center gap-2 rounded px-1 py-0.5 text-left text-xs hover:bg-slate-50" style={{ paddingLeft: depth * 14 + 4 }}>
        <StatusIcon status={wp.lineStatus.get(node.key)?.status} size={11} />
        <span className="w-24 shrink-0 font-mono text-[10px] text-slate-500">{node.key}</span>
        <span className="min-w-0 flex-1 truncate" title={rule}>{l?.label}</span>
        <LineValue k={node.key} className="shrink-0" />
      </button>
      {node.children.slice(0, 40).map((c) => <Tree key={c.key} node={c} depth={depth + 1} />)}
      {node.children.length > 40 && <p className="pl-8 text-[10px] text-slate-400">+{node.children.length - 40} more inputs (see the area's detail view)</p>}
    </div>
  );
}

function LineInspector({ k }: { k: string }) {
  const { wp, ix, select, emit, allowed } = useStore();
  const line = wp.vi.lines.get(k);
  const lv = wp.lineValues.get(k)!;
  const adj = wp.adjustmentsByKey.get(k);
  const st = wp.lineStatus.get(k);
  const area = areaForLine(k);
  const checks = wp.checks.filter((c) => c.lines.includes(k));
  const usedBy = wp.vi.usedBy.get(k) ?? [];
  const history = ix.versionOrder.map((v) => ({ v, val: ix.versions.get(v)!.lines.get(k)?.value }));
  const py = ix.packet.prior_years.return_2024.lines[k];
  const rule = line ? ix.packet.engine_reference.rules[line.rule] : undefined;
  const firstEv = line?.sources.find((s) => s.startsWith("ev-") && ix.evs.has(s));
  const [doc, setDoc] = useState<string | undefined>(firstEv);
  return (
    <>
      <Section title={`${line?.form ?? "Added"} · ${AREA_BY_ID.get(area)?.title ?? area}`}>
        <h3 className="text-base font-semibold text-slate-900">{line?.label ?? "Item added by the workpaper"}</h3>
        <div className="mt-2 grid grid-cols-3 gap-3 text-sm">
          <div><div className="text-[11px] text-slate-500">Engine ({wp.version})</div><div className="tabular-nums">{formatLineValue(k, lv.engine)}</div></div>
          <div><div className="text-[11px] text-slate-500">Workpaper</div><LineValue k={k} className="font-semibold" /></div>
          <div><div className="text-[11px] text-slate-500">2024</div><div className="tabular-nums text-slate-600">{py != null ? formatLineValue(k, py as Json) : "—"}</div></div>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
          <StatusIcon status={st?.status} />
          {st?.latest ? <span>{st.status === "stale" ? st.reason : <>Verified by <ActorName id={st.latest.event.actorId} /> · {verifyLabel(String(st.latest.event.payload.method))}</>}</span> : <span className="text-slate-500">Not verified</span>}
          {lv.propagated && <Badge tone="indigo">rolled up from an adjusted input</Badge>}
          {lv.pendingRecompute && <Badge tone="amber">engine recompute needed</Badge>}
          {lv.election && <Badge tone="violet">election: {lv.election}</Badge>}
        </div>
        {line?.note && <p className="mt-2 rounded bg-slate-50 p-2 text-xs text-slate-600">Engine note: {line.note}</p>}
        <div className="mt-3"><ItemActions target={k} value={lv.workpaper} isLine isText={typeof lv.engine === "string"} defaultEvidence={line?.sources.slice(0, 3)} /></div>
      </Section>

      {adj && (
        <Section title="Adjustment">
          <div className="rounded-md border border-indigo-200 bg-indigo-50/50 p-2 text-xs">
            <div className="flex items-center justify-between"><span><ActorName id={adj.event.actorId} /> · {shortDateTime(adj.event.simAt)} · {signedMoney(adj.delta)}</span><Effect f={adj.effect.federalBalance} c={adj.effect.californiaBalance} /></div>
            <p className="mt-1 text-slate-800">{adj.event.payload.reason}</p>
            <p className="mt-0.5 text-slate-500">{adj.effect.basis}</p>
            {adj.stale && <p className="mt-1 text-amber-700">The engine value changed since this adjustment was made — confirm it still applies.</p>}
            <div className="mt-1.5 flex items-center gap-2">
              {adj.needsPartner ? (adj.approvals.length ? <Badge tone="green">partner approved</Badge> : <Badge tone="amber">needs partner approval</Badge>) : <Badge tone="slate">under threshold</Badge>}
              {adj.needsPartner && !adj.approvals.length && (
                <Button size="sm" decision={allowed({ type: "adjustment.approved", target: k, payload: { adjustmentId: adj.event.id } })}
                  onClick={() => emit([{ type: "adjustment.approved", target: k, payload: { adjustmentId: adj.event.id, note: "" } }], { label: "Adjustment approved" })}>Approve</Button>
              )}
            </div>
            {adj.event.payload.evidence?.length ? <div className="mt-1.5"><Refs refs={adj.event.payload.evidence} compact /></div> : null}
          </div>
        </Section>
      )}

      {checks.length > 0 && <Section title={`Checks (${checks.length})`}><div className="space-y-2">{checks.map((c) => <CheckCard key={c.id} c={c} compact />)}</div></Section>}

      <Section tour="insp-built" title="How it was built" right={line && <span className="font-mono text-[10px] text-slate-400" title={rule}>{line.rule}</span>}>
        {rule && <p className="mb-2 text-xs text-slate-600">{rule}</p>}
        {line?.inputs.length ? <Tree node={inputTree(wp.vi, k)} /> : <p className="text-xs text-slate-500">Leaf value — taken from the sources below.</p>}
        {usedBy.length > 0 && <p className="mt-2 text-xs text-slate-500">Flows into: {usedBy.map((u) => <button key={u} onClick={() => select(u)} className="mr-1 font-mono text-indigo-700 hover:underline">{u}</button>)}</p>}
      </Section>

      <Section tour="insp-sources" title={`Sources (${line?.sources.length ?? 0})`}>
        <Refs refs={line?.sources ?? []} />
        {line && line.sources.filter((s) => s.startsWith("ev-")).length > 1 && (
          <div className="mt-2 flex flex-wrap gap-1 text-[11px]">
            Preview: {[...new Set(line.sources.filter((s) => ix.evs.has(s)).map((s) => ix.evs.get(s)!.document_id))].map((d) => (
              <button key={d} onClick={() => setDoc(line.sources.find((s) => ix.evs.get(s)?.document_id === d))} className={clsx("rounded px-1.5", ix.evs.get(doc ?? "")?.document_id === d ? "bg-indigo-100 text-indigo-700" : "bg-slate-100")}>{d}</button>
            ))}
          </div>
        )}
        {doc && <div className="mt-3"><DocumentViewer docId={ix.evs.get(doc)!.document_id} focus={doc} /></div>}
      </Section>

      <Section title="Across versions">
        <div className="flex gap-4 text-xs">
          {history.map((h) => <div key={h.v}><span className="text-slate-500">{h.v}</span> <span className="tabular-nums">{formatLineValue(k, h.val ?? null)}</span></div>)}
        </div>
      </Section>
      <Section title="Notes & questions"><NotesThread target={k} /></Section>
      <Section title="History"><History target={k} /></Section>
    </>
  );
}

function EvInspector({ id }: { id: string }) {
  const { wp, ix, select } = useStore();
  const e = ix.evs.get(id);
  if (!e) return <Section title="Value"><p className="text-sm text-slate-500">{id} is lot detail held on the server — open it from its document.</p></Section>;
  const doc = ix.docs.get(e.document_id)!;
  const st = wp.evStatus.get(id);
  const corr = wp.correctionsByTarget.get(id);
  const lines = wp.vi.citedBy.get(id) ?? [];
  const checks = wp.checks.filter((c) => c.evidence.includes(id) || c.suggestion?.adjustments?.some((a) => a.key === id));
  return (
    <>
      <Section title={`Extracted value · ${doc.title}`}>
        <h3 className="text-base font-semibold">{e.label}</h3>
        <div className="mt-2 grid grid-cols-3 gap-3 text-sm">
          <div><div className="text-[11px] text-slate-500">Read</div><div className="font-mono">{formatValue(e.value, e.value_type)}</div></div>
          <div><div className="text-[11px] text-slate-500">Text seen</div><div className="font-mono">{e.text_as_read || <span className="text-rose-500">nothing printed</span>}</div></div>
          <div><div className="text-[11px] text-slate-500">Confidence</div><div className={clsx(e.confidence < 0.7 && "font-semibold text-rose-600")}>{Math.round(e.confidence * 100)}%</div></div>
        </div>
        {corr && <p className="mt-2 text-sm">Corrected to <span className="font-mono font-semibold text-indigo-700">{String(corr.to)}</span> by <ActorName id={corr.event.actorId} /> — {corr.event.payload.reason}</p>}
        <div className="mt-2 flex items-center gap-2 text-xs"><StatusIcon status={st?.status} />{st?.reason ?? (st?.latest ? `Verified by ${st.latest.event.actorId}` : "Not verified")}</div>
        <div className="mt-3"><ItemActions target={id} value={corr?.to ?? e.value} isLine={false} defaultEvidence={[e.document_id]} /></div>
      </Section>
      <Section title={`Where it landed (${wp.version})`}>
        {lines.length ? <div className="flex flex-wrap gap-1">{lines.map((l) => <button key={l} onClick={() => select(l)} className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-indigo-700 hover:bg-indigo-50">{l}</button>)}</div>
          : <p className="text-xs text-slate-500">Not used on the return directly{ix.supersededBy.has(e.document_id) ? ` — document superseded by ${ix.supersededBy.get(e.document_id)}` : ""}.</p>}
      </Section>
      {checks.length > 0 && <Section title="Checks"><div className="space-y-2">{checks.map((c) => <CheckCard key={c.id} c={c} compact />)}</div></Section>}
      <Section title="On the document"><DocumentViewer docId={e.document_id} focus={id} /></Section>
      <Section title="Notes & questions"><NotesThread target={id} /></Section>
      <Section title="History"><History target={id} extra={wp.remapped.filter((r) => r.to === id).map((r) => r.from)} /></Section>
    </>
  );
}

function DocInspector({ id, page }: { id: string; page?: number }) {
  const { wp, ix, select } = useStore();
  const use = wp.docUses.get(id);
  const disp = wp.docDispositions.get(id);
  return (
    <>
      <Section tour="insp-document" title="Document">
        <DocumentViewer docId={id} page={page} />
      </Section>
      <Section title="Where it landed">
        {!use ? <p className="text-xs text-slate-500">Not received as of the season clock.</p> : (
          <div className="text-xs">
            {use.kind === "used" && <div className="flex flex-wrap gap-1">{use.lines.map((l) => <button key={l} onClick={() => select(l)} className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-indigo-700">{l}</button>)}</div>}
            {use.kind === "superseded" && <p>Superseded by <button className="text-indigo-700 underline" onClick={() => select(use.by)}>{use.by}</button> (corrected form). Verifications on it carry to the matching fields of {use.by} when unchanged.</p>}
            {use.kind === "duplicate" && <p>Duplicate of <button className="text-indigo-700 underline" onClick={() => select(use.of)}>{use.of}</button> — same issuer and values; counted once.</p>}
            {use.kind === "not_extracted" && <p>Not extracted: {use.reason}</p>}
            {use.kind === "supporting" && <p>Supporting document (identity, engagement or reference); no return line cites it.</p>}
            {use.kind === "not_used" && <p className="text-amber-700">Not used by the return in {wp.version}. Disposition it (why it doesn't matter, or what to do) to prove completeness.</p>}
            {disp && <p className="mt-1 text-violet-700">Disposition: {disp.payload.decision} — <ActorName id={disp.actorId} /></p>}
          </div>
        )}
        <div className="mt-2"><ItemActions target={id} value={null} isLine={false} /></div>
      </Section>
      {wp.checks.some((c) => c.evidence.includes(id)) && <Section title="Checks citing this document"><div className="space-y-2">{wp.checks.filter((c) => c.evidence.includes(id)).map((c) => <CheckCard key={c.id} c={c} compact />)}</div></Section>}
      <Section title="Notes & questions"><NotesThread target={id} /></Section>
      <Section title="History"><History target={id} /></Section>
      {void ix}
    </>
  );
}

function SensitiveField({ field, masked }: { field: string; masked: string }) {
  const { actor, asOf, toast, allowed } = useStore();
  const [val, setVal] = useState<string | null>(null);
  const d = allowed({ type: "sensitive.viewed", target: field, payload: { field } });
  async function reveal() {
    const r = await fetch("/api/unmask", { method: "POST", headers: { "content-type": "application/json", "x-actor": actor.id }, body: JSON.stringify({ field, simAt: asOf, purpose: "inspector" }) });
    const b = await r.json();
    if (!r.ok) return toast({ text: b.error, kind: "error" });
    setVal(b.value);
    toast({ text: "Unmasked view logged", kind: "info" });
  }
  return (
    <span className="inline-flex items-center gap-1 font-mono">
      {val ?? masked}
      {!val && <button onClick={reveal} disabled={!d.ok} title={d.ok ? "Reveal (logged)" : d.reason} className="text-slate-400 hover:text-indigo-600 disabled:opacity-30"><Eye size={12} /></button>}
    </span>
  );
}

function PersonInspector({ id }: { id: string }) {
  const { wp, ix } = useStore();
  const pid = id.replace(/^household:/, "").split(".")[0];
  const p = wp.household.people.find((x) => x.id === pid);
  if (!p) return null;
  const corr = wp.correctionsByTarget.get(`household:${pid}.ssn`);
  return (
    <>
      <Section title={p.role}>
        <h3 className="text-base font-semibold">{p.name}</h3>
        <dl className="mt-2 grid grid-cols-[120px_1fr] gap-y-1 text-sm">
          <dt className="text-slate-500">SSN</dt><dd><SensitiveField field={`household:${pid}.ssn`} masked={p.ssn} />{corr && <Badge tone="indigo" className="ml-2">corrected → {String(corr.to).replace(/^\d{3}-\d{2}/, "•••-••")}</Badge>}</dd>
          <dt className="text-slate-500">Date of birth</dt><dd>{p.dob}</dd>
          {p.ip_pin && <><dt className="text-slate-500">IP PIN</dt><dd><SensitiveField field={`household:${pid}.ip_pin`} masked={p.ip_pin} /></dd></>}
          {p.relationship && <><dt className="text-slate-500">Relationship</dt><dd>{p.relationship}, {p.months_lived_with_you} months{p.full_time_student ? ", full-time student" : ""}</dd></>}
          {p.occupation && <><dt className="text-slate-500">Occupation</dt><dd>{p.occupation}</dd></>}
          {p.note && <><dt className="text-slate-500">Note</dt><dd>{p.note}</dd></>}
          {p.own_income && <><dt className="text-slate-500">Own income</dt><dd>{p.own_income}</dd></>}
        </dl>
        <p className="mt-2 text-xs text-slate-500">Entered by {ix.packet.household.entered_by}. Every unmasked view is logged.</p>
        <div className="mt-3"><ItemActions target={`household:${pid}.ssn`} value={p.ssn} isLine={false} /></div>
      </Section>
      <Section title="History"><History target={`household:${pid}.ssn`} /></Section>
    </>
  );
}

function RefInspector({ r }: { r: string }) {
  const { ix, wp, select } = useStore();
  const res = resolveRef(ix, r, wp.version);
  const cited = wp.vi.citedBy.get(r) ?? [];
  return (
    <>
      <Section title={res.kind}>
        <h3 className="text-sm font-semibold">{res.label}</h3>
        {res.detail && <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{res.detail}</p>}
        {res.value !== undefined && typeof res.value === "object" && <pre className="mt-2 max-h-72 overflow-auto rounded bg-slate-50 p-2 text-[11px]">{JSON.stringify(res.value, null, 2)}</pre>}
        {res.value !== undefined && typeof res.value !== "object" && <p className="mt-1 font-mono text-sm">{String(res.value)}</p>}
      </Section>
      <Section title="Cited by">{cited.length ? <div className="flex flex-wrap gap-1">{cited.map((l) => <button key={l} onClick={() => select(l)} className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-indigo-700">{l}</button>)}</div> : <p className="text-xs text-slate-400">Not cited by a return line.</p>}</Section>
      <Section title="Notes & questions"><NotesThread target={r} /></Section>
    </>
  );
}

function OutsideInspector({ id }: { id: string }) {
  const { wp } = useStore();
  const o = wp.outside.find((x) => `outside:${x.id}` === id);
  const [open, setOpen] = useState(false);
  if (!o) return <Empty>Unknown outside filing.</Empty>;
  return (
    <>
      <Section title="Outside filing (not part of this return)">
        <h3 className="text-base font-semibold">{o.title}</h3>
        <p className="mt-1 text-sm text-slate-700">{o.detail}</p>
        <div className="mt-2"><Refs refs={o.evidence} /></div>
        {o.disposition ? <p className="mt-2 text-sm text-violet-700">Disposition: {o.disposition.payload.decision} — <ActorName id={o.disposition.actorId} /></p>
          : <Button className="mt-3" size="sm" variant="primary" onClick={() => setOpen(true)}>Record disposition</Button>}
      </Section>
      <Section title="Notes & questions"><NotesThread target={id} /></Section>
      <Section title="History"><History target={id} /></Section>
      {open && <ActionModal kind="judgment" target={id} value={null} onClose={() => setOpen(false)} defaultEvidence={o.evidence} preset={{ kind: "outside_filing" }} />}
    </>
  );
}

function StepInspector({ id }: { id: string }) {
  const { wp, emit, allowed } = useStore();
  const step = wp.steps.find((s) => s.target === id);
  const [note, setNote] = useState("");
  const done = wp.activeEvents.some((e) => e.type === "step.completed" && e.target === id);
  return (
    <>
      <Section title="Required step">
        <h3 className="text-base font-semibold">{step?.label ?? id}</h3>
        <p className="mt-1 text-sm text-slate-600">{step?.detail}</p>
        {done ? <p className="mt-2 text-sm text-emerald-700">Completed.</p> : (
          <div className="mt-2 flex gap-1.5">
            <input className={inputCls} placeholder="How (e.g. matched licenses to SSNs and DOB; IP PIN notice on file)" value={note} onChange={(e) => setNote(e.target.value)} />
            <Button variant="primary" decision={allowed({ type: "step.completed", target: id, payload: {} })} onClick={() => emit([{ type: "step.completed", target: id, payload: { note, evidence: [] } }], { label: "Step completed" })}>Complete</Button>
          </div>
        )}
      </Section>
      <Section title="History"><History target={id} /></Section>
    </>
  );
}

export function Inspector() {
  const { selection, select, wp, ix } = useStore();
  if (!selection) return null;
  let body: ReactNode;
  const pageSel = /^(D\d+)#(\d+)$/.exec(selection);
  if (selection.startsWith("check:")) {
    const c = wp.checks.find((x) => `check:${x.id}` === selection);
    body = c ? <><Section title="Check"><CheckCard c={c} /></Section><Section title="Notes & questions"><NotesThread target={selection} /></Section><Section title="History"><History target={selection} extra={c.suggestion?.adjustments?.map((a) => a.key) ?? []} /></Section></> : <Empty>Check no longer applies.</Empty>;
  } else if (wp.lineValues.has(selection)) body = <LineInspector k={selection} />;
  else if (/^ev-\d+$/.test(selection)) body = <EvInspector id={selection} />;
  else if (pageSel) body = <DocInspector id={pageSel[1]} page={Number(pageSel[2])} />;
  else if (/^D\d+$/.test(selection)) body = <DocInspector id={selection} />;
  else if (selection.startsWith("household:")) body = <PersonInspector id={selection} />;
  else if (selection.startsWith("outside:")) body = <OutsideInspector id={selection} />;
  else if (selection.startsWith("step:")) body = <StepInspector id={selection} />;
  else body = <RefInspector r={selection} />;
  void ix;
  return (
    <aside data-tour="inspector" className="fixed inset-y-0 right-0 z-40 flex w-[min(560px,100vw)] flex-col border-l border-slate-200 bg-white shadow-xl">
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2">
        <span className="flex items-center gap-2 text-xs text-slate-500"><MessageSquare size={12} />Inspector · <span className="font-mono">{selection}</span></span>
        <button onClick={() => select(null)} className="text-slate-400 hover:text-slate-700"><X size={16} /></button>
      </div>
      <div className="flex-1 overflow-y-auto">{body}</div>
    </aside>
  );
}
