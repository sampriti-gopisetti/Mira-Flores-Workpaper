import "server-only";
import { NextResponse } from "next/server";
import { AppendError } from "./eventStore";
import { PacketValidationError } from "@/domain/packetSchema";

export function actorIdFrom(req: Request): string | null {
  return req.headers.get("x-actor") ?? new URL(req.url).searchParams.get("actor");
}

export async function handle(fn: () => Promise<unknown>) {
  try {
    const body = await fn();
    return NextResponse.json(body, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    if (e instanceof AppendError) return NextResponse.json({ error: e.message, ...e.extra }, { status: e.status });
    if (e instanceof PacketValidationError) return NextResponse.json({ error: e.message, issues: e.issues }, { status: 422 });
    console.error(e);
    return NextResponse.json({ error: (e as Error).message ?? "Server error" }, { status: 500 });
  }
}
