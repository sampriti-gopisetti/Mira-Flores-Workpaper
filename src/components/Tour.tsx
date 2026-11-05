"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Compass, MousePointerClick, Database, X } from "lucide-react";
import { useStore, DEFAULT_AS_OF } from "@/client/store";
import type { WorkpaperState } from "@/domain/project";

// A click-along walkthrough. "Click" steps spotlight something to click and wait for
// the user to click it (or "Do it for me"); "explain" steps describe what opened and
// where its content comes from. The tour only navigates and opens panels — it never
// records anything.

interface Ctx { path: string; selection: string | null; wp: WorkpaperState }

interface Step {
  kind: "click" | "explain";
  page: string;
  pageLabel: string;
  /** data-tour ids; the spotlight covers all of them */
  targets: string[];
  title: string;
  body: string | ((c: Ctx) => string);
  /** where the content on screen comes from */
  source?: string | ((c: Ctx) => string);
  /** click steps: true once the user has done the action */
  done?: (c: Ctx) => boolean;
  /** what "Do it for me" does (click steps) */
  doIt?: { push?: string; select?: string | null };
  /** applied when the step starts */
  enter?: { select?: string | null };
}

const STEPS: Step[] = [
  {
    kind: "explain", page: "/", pageLabel: "Overview", targets: ["sources"], enter: { select: null },
    title: "Start with where the data comes from",
    body: "Everything in this app comes from one packet that Miraflores' software produced for this client: their documents, the values it read off them, the return it computed, the IRS/FTB records, the client's answers and last year's return. The app doesn't invent numbers; people's work (checks, fixes, notes, sign-offs) is recorded on top.",
    source: "The client packet (okafor_lindqvist_2025_packet.json), loaded once into the database.",
  },
  {
    kind: "click", page: "/", pageLabel: "Overview", targets: ["nav-documents"],
    title: "Let's look at the raw material first",
    body: "Click **Documents** in the left menu.",
    done: (c) => c.path === "/documents", doIt: { push: "/documents" },
  },
  {
    kind: "explain", page: "/documents", pageLabel: "Documents", targets: ["docs"],
    title: "The client's documents",
    body: "Each row is one document the client uploaded (W-2s, 1099s, receipts…). “Where it landed” shows which lines of the return use values read from it — or why none do: superseded by a corrected form, a duplicate photo, not received yet (faded rows), or reviewed and set aside.",
    source: "Packet → documents (74) and their extraction status. “Where it landed” is worked out by matching the values read from each document to the return lines that cite them.",
  },
  {
    kind: "click", page: "/documents", pageLabel: "Documents", targets: ["doc-D08"],
    title: "Open a document",
    body: "Click the row **D08 — 2025 Form W-2 – Corvane Systems**.",
    done: (c) => c.selection === "D08", doIt: { select: "D08" },
  },
  {
    kind: "explain", page: "/documents", pageLabel: "Documents", targets: ["insp-document"], enter: { select: "D08" },
    title: "What's printed vs what was read",
    body: "This panel (the Inspector) shows the W-2 as printed. Every highlighted amount is a value the software read off it; the list underneath shows each one with its confidence. Click any highlight to see where that value is used.",
    source: "Packet → the page's printed text (the truth) + extracted values (what the software read, which can be wrong). Real PDFs would drop in here later.",
  },
  {
    kind: "click", page: "/documents", pageLabel: "Documents", targets: ["nav-overview"], enter: { select: null },
    title: "Now the return built from those values",
    body: "Click **Overview** in the left menu.",
    done: (c) => c.path === "/", doIt: { push: "/" },
  },
  {
    kind: "explain", page: "/", pageLabel: "Overview", targets: ["totals"],
    title: "The engine's return vs the workpaper",
    body: "Grey numbers are the return exactly as Miraflores' tax engine computed it. Bold numbers are the workpaper: the same return after any fixes people make here. Fixes never overwrite the engine — both are always visible, and each fix records who, why and its tax effect.",
    source: "Packet → return_versions (the engine ran 3 times as documents arrived; v3 is current). The “open issues” count comes from the checks you'll see in a moment.",
  },
  {
    kind: "explain", page: "/", pageLabel: "Overview", targets: ["summary"],
    title: "Compared with last year",
    body: "Each key line next to 2024. Firm rule: a change over 10% and over $1,000 needs an explanation before filing — that's what “explain” does.",
    source: "Packet → prior_years (the 2024 return as filed) vs this year's engine lines.",
  },
  {
    kind: "click", page: "/", pageLabel: "Overview", targets: ["nav-area-payments"],
    title: "Follow one number all the way through",
    body: "Click **Payments & penalty** under Areas in the left menu.",
    done: (c) => c.path === "/area/payments", doIt: { push: "/area/payments" },
  },
  {
    kind: "click", page: "/area/payments", pageLabel: "Payments & penalty", targets: ["line-F1040.26"],
    title: "Pick a line of the return",
    body: "Each area groups the return's lines by topic. Click the highlighted line **F1040.26 · 2025 estimated tax payments**.",
    done: (c) => c.selection === "F1040.26", doIt: { select: "F1040.26" },
  },
  {
    kind: "explain", page: "/area/payments", pageLabel: "Payments & penalty", targets: ["insp-built", "insp-sources"], enter: { select: "F1040.26" },
    title: "How this number was built",
    body: "The engine's 13,000 is a leaf value built from these sources: three EFTPS payment receipts (3,000 each) and the client's questionnaire answer “Paid January 14, 2026 – 4,000 I think”. The preview below highlights the exact receipt amounts.",
    source: "Packet → the engine's line F1040.26 and the values it cites (its “sources”), which point back into documents and client answers.",
  },
  {
    kind: "explain", page: "/area/payments", pageLabel: "Payments & penalty", targets: ["check-est-fed"], enter: { select: null },
    title: "How the app caught a mistake",
    body: (c) => {
      const chk = c.wp.checks.find((x) => x.id === "est-fed");
      const fixed = chk && chk.status !== "open";
      return `This card comes from one of the app's own checks. It compared the engine's 13,000 with the IRS's own record of payments: 3,000 + 3,000 + 3,000 + 3,000 = 12,000. The engine trusted the client's memory of 4,000. ${fixed ? "Someone already applied the fix, so it shows “resolved”." : "“Apply 1 adjustment” records the fix (with who, why and +1,000 tax effect) — the original 13,000 is kept."} The chips at the bottom are the evidence it used.`;
    },
    source: "Packet → tax_agency_records (the IRS account transcript) compared with the engine's line, by a check written for this app — not by the engine.",
  },
  {
    kind: "explain", page: "/area/payments", pageLabel: "Payments & penalty", targets: ["signoffs"],
    title: "Sign-offs",
    body: "When an area is done, the preparer signs, then a reviewer, then the partner. Each sign-off stores a fingerprint of the area; if anything in it changes later, the sign-off reopens automatically. Nobody can review work they prepared — greyed buttons say why.",
    source: "Created by people in this app (not in the packet). The rules are the firm's standards in the packet.",
  },
  {
    kind: "click", page: "/area/payments", pageLabel: "Payments & penalty", targets: ["nav-issues"],
    title: "All issues in one place",
    body: "Click **Issues** at the top of the left menu.",
    done: (c) => c.path === "/issues", doIt: { push: "/issues" },
  },
  {
    kind: "explain", page: "/issues", pageLabel: "Issues", targets: ["checks"],
    title: "Every comparison across the whole return",
    body: "The same kind of check you just saw, run across the whole return: about 25 written for this app (badge “independent check”) plus the engine's own warnings (badge “engine”). Click a row to see its evidence; tick several to fix them in one batch — one Undo reverts the batch.",
    source: "Each check compares the engine's numbers with something else in the packet — the printed documents, IRS/FTB records, the client's answers or last year — and lists exactly what it compared.",
  },
  {
    kind: "explain", page: "/issues", pageLabel: "Issues", targets: ["role", "clock", "search"],
    title: "Three controls at the top",
    body: "Role switcher: become the preparer, reviewer, partner, a preparer without clearance (SSNs masked), the admin, the client or an IRS examiner. Season clock: replay the year by date. Search (⌘K): find any line, document, check or note. Also worth a look: Season & filing (file, e-file rejection, freeze), Versions & what-ifs, and Firm admin.",
    source: "The clock uses the packet's timeline and the date each document arrived. Roles and the firm's rules come from the packet's firm section.",
  },
];

export function useTour() {
  const [open, setOpen] = useState(false);
  return { open, start: () => setOpen(true), close: () => setOpen(false) };
}

export function TourButton({ onStart }: { onStart: () => void }) {
  return (
    <button onClick={onStart} data-tour="tour" className="flex items-center gap-1 rounded-md border border-indigo-200 bg-indigo-50 px-2 py-1 text-xs font-medium text-indigo-700 hover:bg-indigo-100">
      <Compass size={13} />Tour
    </button>
  );
}

export function TourPrompt({ onStart }: { onStart: () => void }) {
  const [show, setShow] = useState(false);
  useEffect(() => { try { setShow(!localStorage.getItem("wp.tourSeen")); } catch { /* ignore */ } }, []);
  if (!show) return null;
  const dismiss = () => { setShow(false); try { localStorage.setItem("wp.tourSeen", "1"); } catch { /* ignore */ } };
  return (
    <div className="fixed bottom-4 left-4 z-[55] w-80 rounded-lg border border-indigo-200 bg-white p-4 shadow-xl">
      <p className="text-sm font-semibold text-slate-900">New here?</p>
      <p className="mt-1 text-xs text-slate-600">A 3-minute click-along tour: where the data comes from, how to trace a number, and how issues are caught.</p>
      <div className="mt-3 flex gap-2">
        <button onClick={() => { dismiss(); onStart(); }} className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700">Start the tour</button>
        <button onClick={dismiss} className="rounded-md px-3 py-1.5 text-xs text-slate-500 hover:bg-slate-100">Not now</button>
      </div>
    </div>
  );
}

interface Box { left: number; top: number; width: number; height: number }

/** Union of the targets' boxes, or null when none is on the page yet. */
function measure(ids: string[]): Box | null {
  const rects = ids.map((id) => document.querySelector(`[data-tour="${id}"]`)?.getBoundingClientRect()).filter((r): r is DOMRect => !!r && r.width > 0);
  if (!rects.length) return null;
  const left = Math.min(...rects.map((r) => r.left)), top = Math.min(...rects.map((r) => r.top));
  const right = Math.max(...rects.map((r) => r.right)), bottom = Math.max(...rects.map((r) => r.bottom));
  return { left, top, width: right - left, height: bottom - top };
}

function rich(text: string) {
  return text.split(/(\*\*[^*]+\*\*)/).map((part, i) => part.startsWith("**") ? <b key={i} className="text-slate-900">{part.slice(2, -2)}</b> : <span key={i}>{part}</span>);
}

export function Tour({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [i, setI] = useState(0);
  const [box, setBox] = useState<Box | null>(null);
  const [popH, setPopH] = useState(260);
  const popRef = useRef<HTMLDivElement>(null);
  const prevClock = useRef<string | null>(null);
  const router = useRouter();
  const path = usePathname();
  const { select, selection, wp, asOf, setAsOf } = useStore();
  const step = STEPS[i];
  const ctx: Ctx = { path, selection, wp };

  // Fixed starting point: the tour is written for 24 Jun 2026; restore the user's clock afterwards.
  useEffect(() => {
    if (!open) return;
    setI(0);
    prevClock.current = asOf;
    if (asOf !== DEFAULT_AS_OF) setAsOf(DEFAULT_AS_OF);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const finish = useCallback(() => {
    try { localStorage.setItem("wp.tourSeen", "1"); } catch { /* ignore */ }
    if (prevClock.current && prevClock.current !== DEFAULT_AS_OF) setAsOf(prevClock.current);
    setI(0); setBox(null); select(null); onClose();
  }, [onClose, select, setAsOf]);

  // Entering a step: be on its page, apply its panel state, bring the target into view.
  useEffect(() => {
    if (!open) return;
    if (path !== step.page && !(step.kind === "click" && step.done?.(ctx))) { router.push(step.page); return; }
    if (step.enter && "select" in step.enter) select(step.enter.select ?? null);
    let tries = 0;
    const t = setInterval(() => {
      const el = document.querySelector(`[data-tour="${step.targets[0]}"]`);
      if (el || ++tries > 40) {
        clearInterval(t);
        if (el && !step.targets[0].startsWith("insp-") && !step.targets[0].startsWith("nav-")) el.scrollIntoView({ block: "center" });
        if (el && step.targets[0].startsWith("insp-")) el.scrollIntoView({ block: "start" });
      }
    }, 80);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, i, path === step.page]);

  // Click steps advance on their own once the user has done the action.
  useEffect(() => {
    if (!open || step.kind !== "click" || !step.done?.(ctx)) return;
    const t = setTimeout(() => setI((x) => Math.min(STEPS.length - 1, x + 1)), 450);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, i, path, selection]);

  // Follow the target every frame: panels animate, pages scroll, windows resize.
  useLayoutEffect(() => {
    if (!open) return;
    let raf = 0;
    let last = "";
    const loop = () => {
      const b = measure(step.targets);
      const key = b ? `${Math.round(b.left)},${Math.round(b.top)},${Math.round(b.width)},${Math.round(b.height)}` : "none";
      if (key !== last) { last = key; setBox(b); }
      if (popRef.current) { const h = popRef.current.offsetHeight; if (Math.abs(h - popH) > 4) setPopH(h); }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [open, step, popH]);

  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") finish(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, finish]);

  if (!open) return null;

  const next = () => setI((x) => Math.min(STEPS.length - 1, x + 1));
  // Back skips over click steps (they'd immediately count as done again).
  const back = () => setI((x) => { let k = x - 1; while (k > 0 && STEPS[k].kind === "click") k--; return Math.max(0, k); });
  const doIt = () => {
    if (step.doIt?.push) router.push(step.doIt.push);
    if (step.doIt && "select" in step.doIt) select(step.doIt.select ?? null);
  };

  const vw = window.innerWidth, vh = window.innerHeight;
  const W = 390, pad = 6, gap = 14, badge = { w: 260, h: 90 };
  const fits = (l: number, t: number) => l >= 8 && t >= 52 && l + W <= vw - 8 && t + popH <= vh - 8
    && !(l + W > vw - badge.w && t + popH > vh - badge.h);
  let pos = { left: (vw - W) / 2, top: Math.max(60, (vh - popH) / 2) };
  if (box) {
    const midY = Math.min(Math.max(60, box.top + box.height / 2 - popH / 2), vh - popH - 8);
    const midX = Math.min(Math.max(8, box.left + box.width / 2 - W / 2), vw - W - 8);
    const candidates = [
      { left: box.left + box.width + gap + pad, top: midY },
      { left: box.left - W - gap - pad, top: midY },
      { left: midX, top: box.top + box.height + gap + pad },
      { left: midX, top: box.top - popH - gap - pad },
    ];
    pos = candidates.find((c) => fits(c.left, c.top)) ?? { left: 16, top: vh - popH - 16 };
  }
  const hole = box ? { l: box.left - pad, t: box.top - pad, r: box.left + box.width + pad, b: box.top + box.height + pad } : null;
  const block = "pointer-events-auto fixed";
  const text = typeof step.body === "function" ? step.body(ctx) : step.body;
  const source = typeof step.source === "function" ? step.source(ctx) : step.source;
  const waiting = step.kind === "click" && !step.done?.(ctx);

  return (
    <div className="pointer-events-none fixed inset-0 z-[70]" role="dialog" aria-label="Guided tour">
      {hole ? (
        <>
          <div className="pointer-events-none fixed rounded-lg ring-2 ring-indigo-400"
            style={{ left: hole.l, top: hole.t, width: hole.r - hole.l, height: hole.b - hole.t, boxShadow: "0 0 0 9999px rgba(15, 23, 42, 0.55)" }} />
          {step.kind === "click" && <div className="pointer-events-none fixed animate-pulse rounded-lg ring-4 ring-indigo-300/70" style={{ left: hole.l - 3, top: hole.t - 3, width: hole.r - hole.l + 6, height: hole.b - hole.t + 6 }} />}
          {/* Clicks outside the spotlight are blocked; inside it only on click steps. */}
          <div className={block} style={{ left: 0, top: 0, width: vw, height: Math.max(0, hole.t) }} />
          <div className={block} style={{ left: 0, top: hole.b, width: vw, height: Math.max(0, vh - hole.b) }} />
          <div className={block} style={{ left: 0, top: hole.t, width: Math.max(0, hole.l), height: hole.b - hole.t }} />
          <div className={block} style={{ left: hole.r, top: hole.t, width: Math.max(0, vw - hole.r), height: hole.b - hole.t }} />
          {step.kind === "explain" && <div className={block} style={{ left: hole.l, top: hole.t, width: hole.r - hole.l, height: hole.b - hole.t }} />}
        </>
      ) : <div className="pointer-events-auto fixed inset-0 bg-slate-900/55" />}

      <div ref={popRef} className="pointer-events-auto fixed rounded-lg bg-white p-4 shadow-2xl ring-1 ring-slate-200" style={{ width: W, ...pos }}>
        <div className="flex items-start justify-between gap-2">
          <p className="text-[11px] font-medium uppercase tracking-wide text-indigo-600">Step {i + 1} of {STEPS.length} · {step.pageLabel}</p>
          <button onClick={finish} className="text-slate-400 hover:text-slate-700" aria-label="Close tour"><X size={15} /></button>
        </div>
        <h3 className="mt-1 text-base font-semibold text-slate-900">{step.title}</h3>
        {step.kind === "click"
          ? <p className="mt-2 flex items-start gap-2 rounded-md bg-indigo-50 p-2 text-sm text-indigo-900"><MousePointerClick size={16} className="mt-0.5 shrink-0" /><span>{rich(text)}</span></p>
          : <p className="mt-1 text-sm leading-relaxed text-slate-600">{rich(text)}</p>}
        {source && (
          <p className="mt-2 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">
            <Database size={14} className="mt-0.5 shrink-0" /><span><b>Where this comes from:</b> {source}</span>
          </p>
        )}
        {!box && step.targets.length > 0 && <p className="mt-2 text-xs text-slate-400">Finding it on the page…</p>}
        <div className="mt-3 flex items-center justify-between">
          <div className="flex gap-1">{STEPS.map((s, k) => <span key={k} className={`h-1.5 w-1.5 rounded-full ${k === i ? "bg-indigo-600" : k < i ? "bg-indigo-200" : "bg-slate-200"}`} />)}</div>
          <div className="flex gap-1.5">
            {i > 0 && <button onClick={back} className="rounded-md px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100">Back</button>}
            {waiting
              ? <button onClick={doIt} className="rounded-md border border-indigo-200 px-3 py-1.5 text-xs font-medium text-indigo-700 hover:bg-indigo-50">Do it for me</button>
              : i < STEPS.length - 1
                ? <button onClick={next} className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700">Next</button>
                : <button onClick={finish} className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700">Finish</button>}
          </div>
        </div>
      </div>
    </div>
  );
}
