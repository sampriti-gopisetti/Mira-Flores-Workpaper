"use client";

import clsx from "clsx";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Bell, Search, LayoutDashboard, AlertCircle, FolderOpen, GitCompare, CalendarClock, History, Settings, Undo2, X, Wifi, WifiOff, FileSearch, Forward, UserCircle, FileText } from "lucide-react";
import { StoreProvider, useStore } from "@/client/store";
import { AREAS } from "@/domain/areas";
import { ROLE_LABEL, isStaff } from "@/domain/actors";
import { shortDateTime } from "@/domain/format";
import { Inspector } from "./Inspector";
import { Tour, TourButton, TourPrompt, useTour } from "./Tour";
import { Badge, Modal, inputCls } from "./ui";

const PHASE_LABEL: Record<string, string> = {
  intake: "Intake", preparation: "Preparation", review: "In review", client_approval: "Ready for client", filing: "Transmitted",
  rejected: "E-file rejected", filed: "Filed (frozen)", amending: "Amending", examination: "Under examination",
};

function SeasonClock() {
  const { asOf, setAsOf, ix } = useStore();
  const marks = useMemo(() => {
    const m = ix.packet.timeline.map((t) => ({ at: new Date(new Date(t.at).getTime() + 60_000).toISOString(), label: `${t.at.slice(0, 10)} · ${t.event.replace(/_/g, " ")}` }));
    return m;
  }, [ix]);
  return (
    <div data-tour="clock" className="flex items-center gap-1.5 text-xs">
      <CalendarClock size={14} className="text-slate-400" />
      <input type="datetime-local" className="rounded border border-slate-300 px-1.5 py-0.5 text-xs" value={asOf.slice(0, 16)}
        onChange={(e) => e.target.value && setAsOf(new Date(`${e.target.value}:00Z`).toISOString())} title="Season clock: replay the season as of this moment (UTC)" />
      <select className="w-6 rounded border border-slate-300 py-0.5 text-xs" value="" onChange={(e) => e.target.value && setAsOf(e.target.value)} title="Jump to a season event">
        <option value="">⋯</option>
        {marks.map((m) => <option key={m.at + m.label} value={m.at}>{m.label}</option>)}
      </select>
    </div>
  );
}

function RoleSwitcher() {
  const { actor, actors, setActor } = useStore();
  return (
    <label data-tour="role" className="flex items-center gap-1.5 text-xs">
      <UserCircle size={15} className="text-slate-400" />
      <select className="rounded border border-slate-300 px-1.5 py-0.5 text-xs font-medium" value={actor.id} onChange={(e) => setActor(e.target.value)}>
        {actors.map((a) => <option key={a.id} value={a.id}>{a.name} — {ROLE_LABEL[a.role]}{a.credential ? `, ${a.credential}` : ""}{isStaff(a) && !a.clearance ? " (no clearance)" : ""}</option>)}
      </select>
    </label>
  );
}

function useInbox() {
  const { wp, actor } = useStore();
  const items: { text: string; target: string; at: string }[] = [];
  for (const n of wp.notes) if (!n.resolved && n.assignee === actor.id) items.push({ text: `Review note assigned to you: ${n.text}`, target: n.target, at: n.simAt });
  for (const q of wp.questions) if (!q.answer && (q.to === actor.id || (q.to === "client" && actor.role === "client"))) items.push({ text: `Question for you: ${q.text}`, target: q.target, at: q.at });
  if (actor.role === "partner") for (const a of wp.adjustments) if (a.needsPartner && !a.approvals.length) items.push({ text: `Adjustment awaiting your approval: ${a.key} (${a.event.payload.reason})`, target: a.key, at: a.event.simAt });
  for (const s of wp.signoffs) if (!s.valid && s.event.actorId === actor.id) items.push({ text: `Your ${s.level} sign-off on ${s.area} reopened: ${s.changes[0]}`, target: s.area, at: s.event.simAt });
  if (actor.role === "client" && wp.gate.canPresent && !wp.filing.approvalValid) items.push({ text: "Your return is ready for review and approval", target: "portal", at: wp.asOf });
  return items;
}

function Notifications() {
  const { wp, select, markSeen } = useStore();
  const router = useRouter();
  const items = useInbox();
  const [open, setOpen] = useState(false);
  const since = wp.sinceLastSeen;
  const count = items.length + (since.length ? 1 : 0);
  return (
    <div className="relative">
      <button onClick={() => setOpen(!open)} className="relative rounded p-1 text-slate-500 hover:bg-slate-100">
        <Bell size={16} />
        {count > 0 && <span className="absolute -right-0.5 -top-0.5 rounded-full bg-rose-500 px-1 text-[9px] font-bold text-white">{count}</span>}
      </button>
      {open && (
        <div className="absolute right-0 top-8 z-50 w-96 rounded-lg border border-slate-200 bg-white p-2 shadow-xl">
          <p className="px-2 pb-1 text-[11px] font-semibold uppercase text-slate-500">For you</p>
          {items.length === 0 && <p className="px-2 py-1 text-xs text-slate-400">Nothing waiting on you.</p>}
          {items.map((i, n) => (
            <button key={n} onClick={() => { setOpen(false); if (i.target === "portal") router.push("/portal"); else if (AREAS.some((a) => a.id === i.target)) router.push(`/area/${i.target}`); else select(i.target); }}
              className="block w-full rounded px-2 py-1.5 text-left text-xs hover:bg-slate-50">{i.text}<span className="block text-[10px] text-slate-400">{shortDateTime(i.at)}</span></button>
          ))}
          {since.length > 0 && (
            <div className="mt-1 border-t border-slate-100 pt-1">
              <p className="px-2 pb-1 text-[11px] font-semibold uppercase text-slate-500">{since.length} change(s) since you last looked</p>
              <button className="px-2 text-xs text-indigo-700 hover:underline" onClick={() => { setOpen(false); router.push("/"); }}>See them on the overview</button>
              <button className="ml-3 text-xs text-slate-500 hover:underline" onClick={() => { markSeen(); setOpen(false); }}>Mark all seen</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SearchBox() {
  const { wp, ix, select } = useStore();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key === "k") { e.preventDefault(); setOpen(true); } };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);
  const results = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (s.length < 2) return [];
    const out: { label: string; sub: string; go: () => void }[] = [];
    for (const l of wp.vi.version.lines) if (l.key.toLowerCase().includes(s) || l.label.toLowerCase().includes(s)) out.push({ label: `${l.key} · ${l.label}`, sub: "return line", go: () => select(l.key) });
    for (const d of ix.packet.documents) if (d.id.toLowerCase() === s || d.title.toLowerCase().includes(s) || d.issuer.toLowerCase().includes(s)) out.push({ label: `${d.id} · ${d.title}`, sub: "document", go: () => select(d.id) });
    for (const c of wp.checks) if (c.title.toLowerCase().includes(s) || c.summary.toLowerCase().includes(s)) out.push({ label: c.title, sub: `check · ${c.status}`, go: () => select(`check:${c.id}`) });
    for (const n of wp.notes) if (n.text.toLowerCase().includes(s)) out.push({ label: n.text, sub: `note on ${n.target}`, go: () => select(n.target) });
    for (const qa of ix.packet.client.questionnaire) if (qa.question.toLowerCase().includes(s) || qa.answer.toLowerCase().includes(s)) out.push({ label: `${qa.question} — ${qa.answer}`, sub: qa.id, go: () => select(qa.id) });
    for (const p of ix.packet.household.people) if (p.name.toLowerCase().includes(s)) out.push({ label: p.name, sub: p.role, go: () => select(`household:${p.id}`) });
    for (const a of AREAS) if (a.title.toLowerCase().includes(s)) out.push({ label: a.title, sub: "area", go: () => router.push(`/area/${a.id}`) });
    if (/^ev-\d+$/.test(s)) out.unshift({ label: s, sub: "extracted value", go: () => select(s) });
    return out.slice(0, 40);
  }, [q, wp, ix, select, router]);
  return (
    <>
      <button data-tour="search" onClick={() => setOpen(true)} className="flex items-center gap-2 rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-500 hover:bg-slate-50">
        <Search size={13} /> Search <kbd className="rounded bg-slate-100 px-1 text-[10px]">⌘K</kbd>
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="Search lines, documents, checks, notes, client answers" wide>
        <input autoFocus className={inputCls} value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. mortgage, D31, SchC.1, Theo, ev-1045" />
        <div className="mt-2">
          {results.map((r, i) => (
            <button key={i} onClick={() => { r.go(); setOpen(false); }} className="flex w-full items-center justify-between gap-3 rounded px-2 py-1.5 text-left text-sm hover:bg-indigo-50">
              <span className="truncate">{r.label}</span><span className="shrink-0 text-[11px] text-slate-400">{r.sub}</span>
            </button>
          ))}
          {q.length >= 2 && !results.length && <p className="p-2 text-sm text-slate-400">No matches.</p>}
        </div>
      </Modal>
    </>
  );
}

function Toasts() {
  const { toasts, dismiss, undo } = useStore();
  return (
    <div className="fixed bottom-4 left-1/2 z-[60] flex -translate-x-1/2 flex-col gap-2">
      {toasts.map((t) => (
        <div key={t.id} className={clsx("flex items-center gap-3 rounded-lg px-3 py-2 text-sm shadow-lg", t.kind === "error" ? "bg-rose-600 text-white" : "bg-slate-900 text-white")}>
          <span className="max-w-md">{t.text}</span>
          {t.undo && t.undo.length > 0 && <button onClick={() => { undo(t.undo!); dismiss(t.id); }} className="flex items-center gap-1 font-medium text-indigo-300 hover:text-indigo-200"><Undo2 size={13} />Undo</button>}
          <button onClick={() => dismiss(t.id)} className="text-white/60 hover:text-white"><X size={13} /></button>
        </div>
      ))}
    </div>
  );
}

function NavLink({ href, icon: Icon, children, badge }: { href: string; icon?: typeof LayoutDashboard; children: ReactNode; badge?: ReactNode }) {
  const path = usePathname();
  const active = path === href || (href !== "/" && path.startsWith(href));
  return (
    <Link href={href} data-tour={`nav-${href === "/" ? "overview" : href.slice(1).replace(/\//g, "-")}`} className={clsx("flex items-center gap-2 rounded-md px-2 py-1.5 text-sm", active ? "bg-indigo-50 font-medium text-indigo-700" : "text-slate-600 hover:bg-slate-100")}>
      {Icon && <Icon size={15} className="shrink-0" />}<span className="flex-1 truncate">{children}</span>{badge}
    </Link>
  );
}

function Nav() {
  const { wp, actor } = useStore();
  const openIssues = wp.checks.filter((c) => c.status === "open" && c.severity !== "info" && !c.coveredBy).length + wp.notes.filter((n) => n.kind === "review" && !n.resolved).length;
  if (actor.role === "client") return (
    <nav className="space-y-0.5">
      <NavLink href="/portal" icon={UserCircle}>Your return</NavLink>
      <NavLink href="/client-copy" icon={FileText}>Return summary</NavLink>
    </nav>
  );
  if (actor.role === "examiner") return (
    <nav className="space-y-0.5">
      <NavLink href="/exam" icon={FileSearch}>Examination record</NavLink>
      <NavLink href="/client-copy" icon={FileText}>Return as filed</NavLink>
    </nav>
  );
  return (
    <nav className="space-y-0.5">
      <NavLink href="/" icon={LayoutDashboard}>Overview</NavLink>
      <NavLink href="/issues" icon={AlertCircle} badge={openIssues ? <Badge tone="amber">{openIssues}</Badge> : null}>Issues</NavLink>
      <p className="px-2 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Areas</p>
      {AREAS.map((a) => {
        const sig = (lvl: string) => wp.signoffs.find((s) => s.area === a.id && s.level === lvl);
        const open = wp.checks.filter((c) => c.area === a.id && c.status === "open" && c.severity !== "info" && !c.coveredBy).length;
        const dots = ["preparer", "reviewer", "partner"].map((l) => { const s = sig(l); return s ? (s.valid ? "bg-emerald-500" : "bg-amber-500") : "bg-slate-200"; });
        return (
          <NavLink key={a.id} href={`/area/${a.id}`} badge={<span className="flex items-center gap-1">{open > 0 && <span className="text-[10px] text-amber-600">{open}</span>}<span className="flex gap-0.5">{dots.map((d, i) => <span key={i} className={clsx("h-1.5 w-1.5 rounded-full", d)} />)}</span></span>}>
            {a.title}
          </NavLink>
        );
      })}
      <p className="px-2 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Records</p>
      <NavLink href="/documents" icon={FolderOpen}>Documents</NavLink>
      <NavLink href="/versions" icon={GitCompare}>Versions & what-ifs</NavLink>
      <NavLink href="/season" icon={CalendarClock}>Season & filing</NavLink>
      <NavLink href="/prior" icon={History}>Prior year & preparer</NavLink>
      <NavLink href="/rollforward" icon={Forward}>Roll forward to 2026</NavLink>
      <NavLink href="/exam" icon={FileSearch}>Notice response</NavLink>
      <NavLink href="/portal" icon={UserCircle}>Client view</NavLink>
      <NavLink href="/admin" icon={Settings}>Firm admin</NavLink>
    </nav>
  );
}

function Frame({ children }: { children: ReactNode }) {
  const { wp, live, actor, selection } = useStore();
  const tour = useTour();
  const staff = !["client", "examiner"].includes(actor.role);
  const router = useRouter();
  const path = usePathname();
  useEffect(() => {
    if (actor.role === "client" && !["/portal", "/client-copy"].includes(path)) router.replace("/portal");
    if (actor.role === "examiner" && !["/exam", "/client-copy"].includes(path)) router.replace("/exam");
  }, [actor.role, path, router]);
  const phaseTone = wp.phase === "rejected" ? "red" : wp.phase === "filed" || wp.phase === "examination" ? "green" : wp.phase === "client_approval" ? "indigo" : "slate";
  return (
    <div className="min-h-screen bg-slate-50">
      <header className="sticky top-0 z-30 flex flex-wrap items-center gap-3 border-b border-slate-200 bg-white px-4 py-2">
        <Link href="/" className="flex items-center gap-2">
          <span className="rounded bg-indigo-600 px-1.5 py-0.5 text-xs font-bold text-white">M</span>
          <span className="text-sm font-semibold text-slate-900">Okafor-Lindqvist · 2025</span>
        </Link>
        <Badge tone={phaseTone}>{PHASE_LABEL[wp.phase]}</Badge>
        <Badge tone="slate" title={wp.vi.version.trigger}>engine {wp.version}</Badge>
        {wp.totals.estimated && <Badge tone="indigo" title="Workpaper adjustments priced with the engine's per-dollar rates">estimated totals</Badge>}
        <div className="ml-auto flex flex-wrap items-center gap-3">
          {staff && <TourButton onStart={tour.start} />}
          <SearchBox />
          <SeasonClock />
          <RoleSwitcher />
          <Notifications />
          <span title={live ? "Live: updates every 3 s" : "Offline"}>{live ? <Wifi size={14} className="text-emerald-500" /> : <WifiOff size={14} className="text-rose-500" />}</span>
        </div>
      </header>
      <div className="flex">
        <aside className="sticky top-[45px] hidden h-[calc(100vh-45px)] w-60 shrink-0 overflow-y-auto border-r border-slate-200 bg-white p-3 md:block"><Nav /></aside>
        <main className={clsx("@container min-w-0 flex-1 p-5 transition-[margin]", selection && "lg:mr-[560px]")}>{children}</main>
      </div>
      <Inspector />
      <Toasts />
      {staff && <TourPrompt onStart={tour.start} />}
      <Tour open={tour.open} onClose={tour.close} />
    </div>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  return <StoreProvider><Frame>{children}</Frame></StoreProvider>;
}
