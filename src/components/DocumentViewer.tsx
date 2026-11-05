"use client";

import clsx from "clsx";
import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, ScanLine } from "lucide-react";
import type { Doc, ExtractedValue } from "@/domain/types";
import { useStore } from "@/client/store";
import { formatValue } from "@/domain/format";
import { Badge } from "./ui";
import { StatusIcon } from "./wp";

/**
 * Document rendering is behind an interface. The prototype renders each page from
 * `printed_content` (SimulatedRenderer). A PdfRenderer would draw the real page
 * image and place the same highlights using `position` boxes; links into a document
 * stay `docId + page + evId`, so nothing else in the app changes.
 */
export interface RendererProps {
  doc: Doc;
  page: number;
  evs: ExtractedValue[];
  focus?: string;
  onPick: (evId: string) => void;
}
export interface DocumentRenderer { name: string; Page: (p: RendererProps) => React.ReactElement }

const money2 = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function candidates(e: ExtractedValue): string[] {
  const out = [e.text_as_read];
  if (typeof e.value === "number") { out.push(money2.format(e.value), new Intl.NumberFormat("en-US").format(e.value), String(e.value)); }
  if (typeof e.value === "string") {
    out.push(e.value);
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(e.value);
    if (m) out.push(`${m[2]}/${m[3]}/${m[1]}`);
  }
  return [...new Set(out.filter((x) => x && x.length > 0 && x !== "X"))];
}

interface Seg { text: string; ev?: ExtractedValue }

function layout(text: string, evs: ExtractedValue[]): { segs: Seg[]; unplaced: ExtractedValue[] } {
  const matches: { start: number; end: number; ev: ExtractedValue }[] = [];
  const nextFrom = new Map<string, number>();
  const unplaced: ExtractedValue[] = [];
  for (const e of evs) {
    let placed = false;
    for (const c of candidates(e)) {
      let from = nextFrom.get(c) ?? 0;
      while (from >= 0) {
        const i = text.indexOf(c, from);
        if (i < 0) break;
        const end = i + c.length;
        // A number must match a whole number in the text, not digits inside a date or a longer number.
        const boundary = !/\d/.test(c[0]) || (!/[\d,./]/.test(text[i - 1] ?? " ") && !/[\d/]/.test(text[end] ?? " ") && !/[.,]\d/.test(text.slice(end, end + 2)));
        if (boundary && !matches.some((m) => i < m.end && end > m.start)) {
          matches.push({ start: i, end, ev: e });
          nextFrom.set(c, end);
          placed = true;
          break;
        }
        from = i + 1;
      }
      if (placed) break;
    }
    if (!placed) unplaced.push(e);
  }
  matches.sort((a, b) => a.start - b.start);
  const segs: Seg[] = [];
  let at = 0;
  for (const m of matches) {
    if (m.start > at) segs.push({ text: text.slice(at, m.start) });
    segs.push({ text: text.slice(m.start, m.end), ev: m.ev });
    at = m.end;
  }
  if (at < text.length) segs.push({ text: text.slice(at) });
  return { segs, unplaced };
}

function SimulatedPage({ doc, page, evs, focus, onPick }: RendererProps) {
  const { wp } = useStore();
  const raw = doc.pages.find((p) => p.page === page)?.printed_content ?? "(page not provided)";
  const text = raw.replace(/; /g, ";\n").replace(/\. (?=[A-Z(])/g, ".\n");
  const { segs, unplaced } = useMemo(() => layout(text, evs), [text, evs]);
  const focusEv = evs.find((e) => e.id === focus);
  return (
    <div>
      <div className="relative rounded-sm border border-slate-300 bg-[#fffdf7] px-6 py-5 font-mono text-[12.5px] leading-6 text-slate-800 shadow-sm">
        <div className="whitespace-pre-wrap">
          {segs.map((s, i) => s.ev ? (
            <mark
              key={i}
              onClick={() => onPick(s.ev!.id)}
              title={`${s.ev.label} · ${s.ev.id} · confidence ${Math.round(s.ev.confidence * 100)}%`}
              className={clsx(
                "cursor-pointer rounded-sm px-0.5",
                s.ev.id === focus ? "bg-indigo-300 ring-2 ring-indigo-600" : s.ev.confidence < 0.7 ? "bg-rose-200" : wp.evStatus.get(s.ev.id)?.status === "verified" ? "bg-emerald-100" : "bg-amber-100 hover:bg-amber-200",
              )}
            >{s.text}</mark>
          ) : <span key={i}>{s.text}</span>)}
        </div>
      </div>
      {(unplaced.length > 0 || (focusEv && unplaced.includes(focusEv))) && (
        <div className="mt-3">
          <p className="mb-1 flex items-center gap-1 text-[11px] text-slate-500"><ScanLine size={12} /> Values the pipeline read that are not printed verbatim (shown at their synthetic position):</p>
          <div className="flex gap-3">
            <div className="relative h-40 w-32 shrink-0 rounded-sm border border-slate-300 bg-[#fffdf7]">
              {unplaced.map((e) => (
                <div key={e.id} onClick={() => onPick(e.id)} title={e.label}
                  className={clsx("absolute cursor-pointer border", e.id === focus ? "border-indigo-600 bg-indigo-300/60" : "border-amber-500 bg-amber-200/50")}
                  style={{ left: `${e.position.x0 * 100}%`, top: `${e.position.y0 * 100}%`, width: `${Math.max(4, (e.position.x1 - e.position.x0) * 100)}%`, height: `${Math.max(3, (e.position.y1 - e.position.y0) * 100)}%` }} />
              ))}
            </div>
            <ul className="min-w-0 flex-1 space-y-0.5 text-xs">
              {unplaced.slice(0, 12).map((e) => (
                <li key={e.id}>
                  <button onClick={() => onPick(e.id)} className={clsx("text-left hover:underline", e.id === focus && "font-semibold text-indigo-700")}>
                    {e.label}: <span className="font-mono">{formatValue(e.value, e.value_type)}</span>{e.text_as_read ? <span className="text-slate-400"> (read “{e.text_as_read}”)</span> : <span className="text-rose-500"> (nothing printed)</span>}
                  </button>
                </li>
              ))}
              {unplaced.length > 12 && <li className="text-slate-400">+{unplaced.length - 12} more</li>}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}

export const SimulatedRenderer: DocumentRenderer = { name: "Simulated from printed_content", Page: SimulatedPage };

export function DocumentViewer({ docId, page: initialPage, focus, renderer = SimulatedRenderer }: { docId: string; page?: number; focus?: string; renderer?: DocumentRenderer }) {
  const { ix, wp, select } = useStore();
  const doc = ix.docs.get(docId);
  const focusEv = focus ? ix.evs.get(focus) : undefined;
  const [page, setPage] = useState(initialPage ?? focusEv?.page ?? 1);
  const [remote, setRemote] = useState<ExtractedValue[] | null>(null);
  useEffect(() => { setPage(initialPage ?? focusEv?.page ?? 1); }, [docId, initialPage, focusEv?.page]);

  const local = useMemo(() => (ix.evsByDoc.get(docId) ?? []).filter((e) => e.page === page), [ix, docId, page]);
  const needsRemote = doc && doc.extraction.values > (ix.evsByDoc.get(docId)?.length ?? 0) && local.length === 0;
  useEffect(() => {
    setRemote(null);
    if (!needsRemote) return;
    fetch(`/api/evs?doc=${docId}&page=${page}`).then((r) => r.json()).then((b) => setRemote(b.evs));
  }, [docId, page, needsRemote]);
  if (!doc) return <p className="text-sm text-slate-500">Unknown document {docId}</p>;
  const evs = remote ?? local;
  const use = wp.docUses.get(docId);
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs text-slate-500">{doc.id}</span>
        <span className="text-sm font-medium text-slate-800">{doc.title}</span>
        {doc.marked_corrected && <Badge tone="violet">CORRECTED</Badge>}
        {use && <Badge tone={use.kind === "used" ? "green" : use.kind === "superseded" || use.kind === "duplicate" ? "slate" : "amber"}>{use.kind.replace("_", " ")}</Badge>}
        <Badge tone={doc.extraction.status === "extracted" ? "slate" : "amber"}>{doc.extraction.status}</Badge>
      </div>
      <div className="mb-2 flex items-center justify-between text-[11px] text-slate-500">
        <span>{doc.issuer} · {doc.file_name} · received {doc.received_at.slice(0, 10)} by {doc.uploaded_by}</span>
        {doc.page_count > 1 && (
          <span className="flex items-center gap-1">
            <button disabled={page <= 1} onClick={() => setPage(page - 1)} className="rounded p-0.5 hover:bg-slate-100 disabled:opacity-30"><ChevronLeft size={14} /></button>
            page {page} / {doc.page_count}
            <button disabled={page >= doc.page_count} onClick={() => setPage(page + 1)} className="rounded p-0.5 hover:bg-slate-100 disabled:opacity-30"><ChevronRight size={14} /></button>
          </span>
        )}
      </div>
      <renderer.Page doc={doc} page={page} evs={evs} focus={focus} onPick={(id) => select(id)} />
      <p className="mt-2 text-[10px] uppercase tracking-wide text-slate-400">Rendered by: {renderer.name} · highlights: <span className="bg-amber-100 px-1">read</span> <span className="bg-emerald-100 px-1">verified</span> <span className="bg-rose-200 px-1">low confidence</span></p>
      {doc.extraction.reason && <p className="mt-1 text-xs text-amber-700">Pipeline: {doc.extraction.reason}</p>}
      {evs.length > 0 && evs.length <= 40 && (
        <div className="mt-3 rounded border border-slate-100">
          {evs.map((e) => (
            <button key={e.id} onClick={() => select(e.id)} className={clsx("flex w-full items-center gap-2 border-b border-slate-50 px-2 py-1 text-left text-xs hover:bg-slate-50", e.id === focus && "bg-indigo-50")}>
              <StatusIcon status={wp.evStatus.get(e.id)?.status} size={12} />
              <span className="w-16 font-mono text-[10px] text-slate-400">{e.id}</span>
              <span className="flex-1 truncate">{e.label}</span>
              <span className={clsx("font-mono", e.confidence < 0.7 && "text-rose-600")}>{formatValue(wp.correctionsByTarget.get(e.id)?.to ?? e.value, e.value_type)}</span>
              <span className="w-10 text-right text-[10px] text-slate-400">{Math.round(e.confidence * 100)}%</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
