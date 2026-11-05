import type { Json } from "./types";

const usd0 = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const usd2 = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function money(n: number, cents = false): string {
  const s = (cents ? usd2 : usd0).format(Math.abs(n));
  return n < 0 ? `(${s})` : s;
}

export function signedMoney(n: number): string {
  if (n === 0) return "0";
  return `${n > 0 ? "+" : "−"}${usd0.format(Math.abs(Math.round(n)))}`;
}

/** Form 8949 lot lines are in cents per the readme; ratios are < 1; other numbers are whole dollars. */
export function formatLineValue(key: string, v: Json | undefined): string {
  if (v == null) return "—";
  if (typeof v === "number") {
    if (/^F8949\.[A-Z]\.(?!total)/.test(key)) return money(v, true);
    if (Math.abs(v) < 1 && v !== 0 && !Number.isInteger(v)) return v.toFixed(4);
    return money(v);
  }
  return String(v);
}

export function formatValue(v: Json | undefined, type?: string): string {
  if (v == null || v === "") return "—";
  if (typeof v === "number") {
    if (type === "money") return money(v, !Number.isInteger(v));
    if (type === "percent") return `${(v * 100).toFixed(1)}%`;
    return String(v);
  }
  if (typeof v === "boolean") return v ? "Yes" : "No";
  return String(v);
}

export function num(v: Json | undefined): number {
  return typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" && !isNaN(Number(v)) ? Number(v) : 0;
}

export function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

export function shortDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "UTC" });
}
