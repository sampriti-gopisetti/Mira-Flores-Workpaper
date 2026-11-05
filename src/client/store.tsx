"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Packet } from "@/domain/types";
import type { Actor } from "@/domain/actors";
import type { WpEvent, EventType } from "@/domain/events";
import type { LotAggregates } from "@/domain/checks";
import { buildIndex, type PacketIndex } from "@/domain/packetIndex";
import { project, type WorkpaperState } from "@/domain/project";
import { can, type Decision } from "@/domain/policy";

interface Boot {
  returnId: string;
  packetId: string;
  packet: Packet;
  lots: LotAggregates;
  actors: Actor[];
  events: WpEvent[];
  lastSeenSeq: number;
}

export interface Draft { type: EventType; target: string; payload: Record<string, unknown>; anchor?: string | null }

export interface Toast { id: number; text: string; kind: "ok" | "error" | "info"; undo?: string[] }

interface Ctx {
  ready: boolean;
  error?: string;
  ix: PacketIndex;
  wp: WorkpaperState;
  actor: Actor;
  actors: Actor[];
  lots: LotAggregates;
  asOf: string;
  setAsOf: (iso: string) => void;
  setActor: (id: string) => void;
  emit: (drafts: Draft[], opts?: { label?: string; batch?: boolean }) => Promise<WpEvent[] | null>;
  allowed: (d: Omit<Draft, "anchor">) => Decision;
  undo: (eventIds: string[]) => Promise<void>;
  selection: string | null;
  select: (target: string | null) => void;
  toasts: Toast[];
  toast: (t: Omit<Toast, "id">) => void;
  dismiss: (id: number) => void;
  markSeen: () => void;
  lastSeenSeq: number;
  live: boolean;
}

const C = createContext<Ctx | null>(null);
export const DEFAULT_AS_OF = "2026-06-24T15:00:00.000Z";

function load(key: string, fallback: string) {
  try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
}
function save(key: string, v: string) { try { localStorage.setItem(key, v); } catch { /* ignore */ } }

export function uid() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [actorId, setActorId] = useState<string>("st-01");
  const [asOf, setAsOfState] = useState<string>(DEFAULT_AS_OF);
  const [boot, setBoot] = useState<Boot | null>(null);
  const [events, setEvents] = useState<WpEvent[]>([]);
  const [error, setError] = useState<string>();
  const [selection, setSelection] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [lastSeenSeq, setLastSeenSeq] = useState(0);
  const [live, setLive] = useState(true);
  const eventsRef = useRef<WpEvent[]>([]);
  eventsRef.current = events;

  useEffect(() => {
    setActorId(load("wp.actor", "st-01"));
    setAsOfState(load("wp.asOf", DEFAULT_AS_OF));
  }, []);

  const toast = useCallback((t: Omit<Toast, "id">) => {
    const id = Date.now() + Math.random();
    setToasts((x) => [...x.slice(-3), { ...t, id }]);
    setTimeout(() => setToasts((x) => x.filter((y) => y.id !== id)), t.undo ? 9000 : 5000);
  }, []);
  const dismiss = useCallback((id: number) => setToasts((x) => x.filter((y) => y.id !== id)), []);

  // Bootstrap (re-run on actor change: what the server sends depends on who is looking).
  useEffect(() => {
    let cancelled = false;
    setError(undefined);
    fetch(`/api/bootstrap?actor=${encodeURIComponent(actorId)}`).then(async (r) => {
      const body = await r.json();
      if (!r.ok) throw new Error(body.error ?? r.statusText);
      if (cancelled) return;
      setBoot(body);
      setEvents(body.events);
      setLastSeenSeq(body.lastSeenSeq);
    }).catch((e) => !cancelled && setError(String(e.message ?? e)));
    return () => { cancelled = true; };
  }, [actorId]);

  // Live updates: poll for events after the newest one we hold.
  const refresh = useCallback(async () => {
    const since = eventsRef.current.at(-1)?.seq ?? 0;
    try {
      const r = await fetch(`/api/events?actor=${encodeURIComponent(actorId)}&since=${since}`);
      const body = await r.json();
      setLive(r.ok);
      if (r.ok && body.events.length) {
        setEvents((cur) => {
          const have = new Set(cur.map((e) => e.id));
          return [...cur, ...body.events.filter((e: WpEvent) => !have.has(e.id))].sort((a, b) => a.seq - b.seq);
        });
      }
    } catch { setLive(false); }
  }, [actorId]);
  useEffect(() => {
    if (!boot) return;
    const t = setInterval(refresh, 3000);
    return () => clearInterval(t);
  }, [boot, refresh]);

  const ix = useMemo(() => (boot ? buildIndex(boot.packet) : null), [boot]);
  const actor = useMemo(() => boot?.actors.find((a) => a.id === actorId) ?? boot?.actors[0], [boot, actorId]);
  const wp = useMemo(() => (ix && boot ? project(ix, events, { asOf, lots: boot.lots, actorId, lastSeenSeq }) : null), [ix, boot, events, asOf, actorId, lastSeenSeq]);

  const allowed = useCallback((d: Omit<Draft, "anchor">): Decision => {
    if (!actor || !wp || !ix) return { ok: false, reason: "Loading" };
    return can(actor, d, wp, ix);
  }, [actor, wp, ix]);

  const emit = useCallback(async (drafts: Draft[], opts?: { label?: string; batch?: boolean }) => {
    if (!actor) return null;
    const batchId = opts?.batch || drafts.length > 1 ? uid() : undefined;
    const body = {
      baseSeq: eventsRef.current.at(-1)?.seq ?? 0,
      events: drafts.map((d) => ({ id: uid(), simAt: asOf, batchId, ...d })),
    };
    const r = await fetch("/api/events", { method: "POST", headers: { "content-type": "application/json", "x-actor": actor.id }, body: JSON.stringify(body) });
    const res = await r.json();
    if (!r.ok) {
      toast({ text: res.error ?? "Failed", kind: "error" });
      if (r.status === 409) await refresh();
      return null;
    }
    setEvents((cur) => {
      const have = new Set(cur.map((e) => e.id));
      return [...cur, ...res.events.filter((e: WpEvent) => !have.has(e.id))].sort((a, b) => a.seq - b.seq);
    });
    if (opts?.label) toast({ text: opts.label, kind: "ok", undo: res.events.filter((e: WpEvent) => e.type !== "sensitive.viewed").map((e: WpEvent) => e.id) });
    return res.events as WpEvent[];
  }, [actor, asOf, refresh, toast]);

  const undo = useCallback(async (eventIds: string[]) => {
    const r = await emit([{ type: "event.voided", target: eventIds[0], payload: { eventIds, reason: "Undo" } }]);
    if (r) toast({ text: `Undid ${eventIds.length} change${eventIds.length > 1 ? "s" : ""}`, kind: "info", undo: r.map((e) => e.id) });
  }, [emit, toast]);

  const markSeen = useCallback(() => {
    const seq = eventsRef.current.at(-1)?.seq ?? 0;
    setLastSeenSeq(seq);
    fetch("/api/seen", { method: "POST", headers: { "content-type": "application/json", "x-actor": actorId }, body: JSON.stringify({ seq }) });
  }, [actorId]);

  const value: Ctx | null = boot && ix && wp && actor ? {
    ready: true, error, ix, wp, actor, actors: boot.actors, lots: boot.lots, asOf,
    setAsOf: (iso) => { setAsOfState(iso); save("wp.asOf", iso); },
    setActor: (id) => { setActorId(id); save("wp.actor", id); setSelection(null); },
    emit, allowed, undo, selection, select: setSelection, toasts, toast, dismiss, markSeen, lastSeenSeq, live,
  } : null;

  if (!value) {
    return (
      <div className="flex h-screen items-center justify-center text-sm text-slate-500">
        {error ? <span className="text-rose-600">Could not load: {error}</span> : "Loading the workpaper…"}
      </div>
    );
  }
  return <C.Provider value={value}>{children}</C.Provider>;
}

export function useStore(): Ctx {
  const c = useContext(C);
  if (!c) throw new Error("useStore outside provider");
  return c;
}
