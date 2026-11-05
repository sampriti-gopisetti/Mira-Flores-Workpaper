"use client";

import clsx from "clsx";
import { useState } from "react";
import { useStore } from "@/client/store";
import { AREA_BY_ID, areaForDoc } from "@/domain/areas";
import { Badge, Button, Card, PageHeader } from "@/components/ui";
import { ActionModal } from "@/components/actions";

const KIND_TONE = { used: "green", superseded: "slate", duplicate: "slate", not_extracted: "blue", supporting: "slate", not_used: "amber" } as const;

export default function Documents() {
  const { ix, wp, select, selection } = useStore();
  const [filter, setFilter] = useState("");
  const [dispose, setDispose] = useState<string | null>(null);
  const docs = ix.packet.documents;
  const rows = docs.map((d) => ({ d, use: wp.docUses.get(d.id), disp: wp.docDispositions.get(d.id) }));
  const counts = rows.reduce<Record<string, number>>((a, r) => { const k = r.use ? (r.disp ? "dispositioned" : r.use.kind) : "not_received"; a[k] = (a[k] ?? 0) + 1; return a; }, {});
  const shown = rows.filter((r) => !filter || (filter === "not_received" ? !r.use : filter === "dispositioned" ? !!r.disp : r.use?.kind === filter && !r.disp));
  return (
    <div className="space-y-4">
      <PageHeader title="Document index" sub="Every document, where it landed on the return (or why it didn't), and how it was dispositioned. Completeness is proven here." />
      <div className="flex flex-wrap gap-2">
        <button onClick={() => setFilter("")} className={clsx("rounded-full px-3 py-1 text-xs", !filter ? "bg-indigo-600 text-white" : "bg-white ring-1 ring-slate-200")}>All {docs.length}</button>
        {Object.entries(counts).map(([k, n]) => (
          <button key={k} onClick={() => setFilter(k)} className={clsx("rounded-full px-3 py-1 text-xs", filter === k ? "bg-indigo-600 text-white" : "bg-white ring-1 ring-slate-200")}>{k.replace("_", " ")} {n}</button>
        ))}
      </div>
      <div data-tour="docs"><Card pad={false}>
        <table className="w-full text-sm">
          <thead className="text-[10px] uppercase text-slate-400"><tr><th className="px-3 py-2 text-left font-medium">ID</th><th className="text-left font-medium">Document</th><th className="text-left font-medium">Area</th><th className="text-left font-medium">Received</th><th className="text-left font-medium">Extraction</th><th className="text-left font-medium">Where it landed</th><th /></tr></thead>
          <tbody>
            {shown.map(({ d, use, disp }) => (
              <tr key={d.id} data-tour={`doc-${d.id}`} onClick={() => select(d.id)} className={clsx("cursor-pointer border-t border-slate-100 hover:bg-indigo-50/40", selection === d.id && "bg-indigo-50", !use && "opacity-50")}>
                <td className="px-3 py-1.5 font-mono text-xs text-slate-500">{d.id}</td>
                <td className="py-1.5">{d.title}{d.marked_corrected && <Badge tone="violet" className="ml-1">corrected</Badge>}</td>
                <td className="text-xs text-slate-500">{AREA_BY_ID.get(areaForDoc(d.document_type, d.id))?.title}</td>
                <td className="text-xs tabular-nums text-slate-500">{d.received_at.slice(0, 10)}</td>
                <td><Badge tone={d.extraction.status === "extracted" ? "slate" : "amber"}>{d.extraction.status} · {d.extraction.values}</Badge></td>
                <td className="text-xs">
                  {!use ? <span className="text-slate-400">not received yet</span> : (
                    <span className="flex flex-wrap items-center gap-1">
                      <Badge tone={KIND_TONE[use.kind]}>{use.kind.replace("_", " ")}</Badge>
                      {use.kind === "used" && <span className="text-slate-500">{use.lines.length} line{use.lines.length > 1 ? "s" : ""}: {use.lines.slice(0, 3).join(", ")}{use.lines.length > 3 ? "…" : ""}</span>}
                      {use.kind === "superseded" && <span className="text-slate-500">by {use.by}</span>}
                      {use.kind === "duplicate" && <span className="text-slate-500">of {use.of}</span>}
                      {use.kind === "not_extracted" && <span className="text-slate-500">{use.reason.slice(0, 60)}</span>}
                      {disp && <Badge tone="violet">{disp.payload.decision.slice(0, 40)}</Badge>}
                    </span>
                  )}
                </td>
                <td className="px-3 text-right" onClick={(e) => e.stopPropagation()}>{use && (use.kind === "not_used" || use.kind === "supporting") && !disp && <Button size="sm" variant="ghost" onClick={() => setDispose(d.id)}>Disposition</Button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card></div>
      {dispose && <ActionModal kind="judgment" target={dispose} value={null} onClose={() => setDispose(null)} preset={{ kind: "doc_disposition" }} />}
    </div>
  );
}
