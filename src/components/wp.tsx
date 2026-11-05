"use client";

import clsx from "clsx";
import { CheckCircle2, CircleDashed, AlertTriangle, MessageSquare, FileText, Hash, User, Landmark, History, Calculator, HelpCircle, Link2, Package, Clock } from "lucide-react";
import { useStore } from "@/client/store";
import { resolveRef, type RefKind } from "@/domain/refs";
import { formatLineValue, signedMoney } from "@/domain/format";
import type { Check } from "@/domain/checks";
import { Badge, type Tone } from "./ui";

export function ActorName({ id }: { id: string }) {
  const { actors } = useStore();
  const a = actors.find((x) => x.id === id);
  return <span className="font-medium text-slate-700">{a?.name ?? (id === "system" ? "Agency replay" : id)}</span>;
}

export function StatusIcon({ status, size = 14 }: { status?: string; size?: number }) {
  if (status === "verified" || status === "carried") return <span title={status === "carried" ? "Verification carried from a superseded document" : "Verified"}><CheckCircle2 size={size} className="text-emerald-600" /></span>;
  if (status === "stale") return <span title="Changed since verified — re-verify"><AlertTriangle size={size} className="text-amber-500" /></span>;
  return <span title="Not verified"><CircleDashed size={size} className="text-slate-300" /></span>;
}

const REF_ICON: Record<RefKind, typeof FileText> = {
  ev: Hash, doc: FileText, page: FileText, qa: HelpCircle, msg: MessageSquare, call: MessageSquare, prior: History, agency: Landmark,
  asset: Package, household: User, param: Calculator, fx: Calculator, timeline: Clock, line: Calculator, version: History, unknown: Link2,
};

export function RefChip({ r, compact }: { r: string; compact?: boolean }) {
  const { ix, wp, select } = useStore();
  const res = resolveRef(ix, r, wp.version);
  const Icon = REF_ICON[res.kind];
  const clickable = ["ev", "doc", "page", "line", "household", "qa", "msg", "call", "prior", "agency", "timeline", "asset", "param", "fx"].includes(res.kind);
  return (
    <button
      onClick={() => clickable && select(res.kind === "page" ? `${res.docId}#${res.page}` : r)}
      title={[res.label, res.detail].filter(Boolean).join(" — ")}
      className="inline-flex max-w-full items-center gap-1 rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-left text-[11px] text-slate-700 hover:border-indigo-300 hover:bg-indigo-50"
    >
      <Icon size={11} className="shrink-0 text-slate-400" />
      <span className="font-mono text-[10px] text-slate-500">{r.length > 22 ? `${r.slice(0, 20)}…` : r}</span>
      {!compact && <span className="truncate">{res.label.length > 60 ? `${res.label.slice(0, 58)}…` : res.label}</span>}
    </button>
  );
}

export function Refs({ refs, compact }: { refs: string[]; compact?: boolean }) {
  if (!refs.length) return null;
  return <div className="flex flex-wrap gap-1">{refs.map((r) => <RefChip key={r} r={r} compact={compact} />)}</div>;
}

export function LineValue({ k, className }: { k: string; className?: string }) {
  const { wp } = useStore();
  const lv = wp.lineValues.get(k);
  if (!lv) return <span className="text-slate-400">—</span>;
  const changed = JSON.stringify(lv.engine) !== JSON.stringify(lv.workpaper);
  return (
    <span className={clsx("tabular-nums", className)}>
      {changed && <span className="mr-1.5 text-xs text-slate-400 line-through">{formatLineValue(k, lv.engine)}</span>}
      <span className={clsx(changed && (lv.adjusted ? "font-semibold text-indigo-700" : lv.election ? "font-semibold text-violet-700" : "text-indigo-600"))}>{formatLineValue(k, lv.workpaper)}</span>
      {lv.pendingRecompute && <span title="Depends on an adjusted line through a non-linear rule; the engine must recompute" className="ml-1 text-[10px] text-amber-600">≈</span>}
    </span>
  );
}

/** One return line: click anywhere to inspect. */
export function LineRow({ k, indent = 0, showKey = true }: { k: string; indent?: number; showKey?: boolean }) {
  const { wp, select, selection } = useStore();
  const line = wp.vi.lines.get(k);
  const st = wp.lineStatus.get(k);
  const notes = wp.notes.filter((n) => n.target === k && !n.resolved).length;
  const checks = wp.checks.filter((c) => c.lines.includes(k) && c.status === "open" && c.severity !== "info");
  if (!line && !wp.lineValues.has(k)) return null;
  return (
    <button
      onClick={() => select(k)}
      data-tour={`line-${k}`}
      className={clsx("group flex w-full items-center gap-2 border-b border-slate-100 px-3 py-1.5 text-left text-sm hover:bg-indigo-50/50", selection === k && "bg-indigo-50")}
      style={{ paddingLeft: 12 + indent * 16 }}
    >
      <StatusIcon status={st?.status} />
      {showKey && <span className="w-28 shrink-0 font-mono text-[11px] text-slate-500">{k}</span>}
      <span className="min-w-0 flex-1 truncate text-slate-700">{line?.label ?? "Added by workpaper"}</span>
      {checks.length > 0 && <Badge tone={checks.some((c) => c.severity === "high") ? "red" : "amber"}>{checks.length} issue{checks.length > 1 ? "s" : ""}</Badge>}
      {notes > 0 && <span className="flex items-center gap-0.5 text-[11px] text-slate-500"><MessageSquare size={11} />{notes}</span>}
      <LineValue k={k} className="w-36 shrink-0 text-right" />
    </button>
  );
}

export const SEVERITY_TONE: Record<Check["severity"], Tone> = { high: "red", medium: "amber", low: "blue", info: "slate" };
export const STATUS_TONE: Record<Check["status"], Tone> = { open: "amber", resolved: "green", passed: "green", dispositioned: "violet" };

export function Effect({ f, c, className }: { f: number; c: number; className?: string }) {
  if (!f && !c) return <span className={clsx("text-xs text-slate-400", className)}>no tax effect</span>;
  return (
    <span className={clsx("tabular-nums text-xs", className)}>
      <span className={f > 0 ? "text-rose-600" : f < 0 ? "text-emerald-600" : "text-slate-400"}>Fed {signedMoney(f)}</span>
      <span className="mx-1 text-slate-300">·</span>
      <span className={c > 0 ? "text-rose-600" : c < 0 ? "text-emerald-600" : "text-slate-400"}>CA {signedMoney(c)}</span>
    </span>
  );
}
