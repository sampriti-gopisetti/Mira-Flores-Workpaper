import type { Packet } from "./types";

// Sensitive data never leaves the server unmasked by default. Each sensitive
// value gets a field id; revealing one goes through /api/unmask, which logs it.

export const SSN_RE = /\b\d{3}-\d{2}-\d{4}\b/g;
const IBAN_RE = /\b[A-Z]{2}\d{2}(?: ?\d{4}){4,6}\b/g;
const PIN_RE = /\b(PIN|IP PIN|Identity Protection PIN)(:?\s*(?:is|number)?\s*)(\d{5,6})\b/gi;
const ROUTING_RE = /\b(routing(?: number)?\s*)(\d{9})\b/gi;

export const maskSsn = (s: string) => `•••-••-${s.replace(/\D/g, "").slice(-4)}`;
export const maskTail = (s: string) => `${"•".repeat(Math.max(0, Math.min(6, s.length - 4)))}${s.replace(/\s/g, "").slice(-4)}`;
export const isMasked = (s: unknown) => typeof s === "string" && s.includes("•");

/** Extracted values that hold SSNs, account numbers or PINs. */
export function sensitiveKind(e: { value_type: string; field: string }): "ssn" | "tail" | "pin" | null {
  if (e.value_type === "ssn") return "ssn";
  if (e.value_type === "account_number" || /routing|account/i.test(e.field)) return "tail";
  if (/(^|_)pin$/i.test(e.field)) return "pin";
  return null;
}

export function maskEv<T extends { value: unknown; text_as_read: string; value_type: string; field: string }>(e: T): T {
  const k = sensitiveKind(e);
  if (!k || typeof e.value !== "string") return e;
  const m = k === "ssn" ? maskSsn : k === "tail" ? maskTail : () => "••••••";
  return { ...e, value: m(e.value), text_as_read: e.text_as_read ? m(e.text_as_read) : "" };
}

export function maskText(text: string): string {
  return text
    .replace(SSN_RE, (m) => maskSsn(m))
    .replace(IBAN_RE, (m) => maskTail(m))
    .replace(PIN_RE, (_m, a, b) => `${a}${b}••••••`)
    .replace(ROUTING_RE, (_m, a, n) => `${a}${maskTail(n)}`);
}

/** All sensitive raw values by field id (server side only). */
export function sensitiveFields(p: Packet): Map<string, string> {
  const m = new Map<string, string>();
  for (const person of p.household.people) {
    m.set(`household:${person.id}.ssn`, person.ssn);
    if (person.ip_pin) m.set(`household:${person.id}.ip_pin`, person.ip_pin);
  }
  m.set("bank.routing", p.household.bank_account_for_refund_or_payment.routing);
  m.set("bank.account", p.household.bank_account_for_refund_or_payment.account);
  for (const e of p.extracted_values) {
    if (sensitiveKind(e) && typeof e.value === "string") m.set(`ev:${e.id}`, e.value);
  }
  for (const d of p.documents) for (const pg of d.pages) {
    if (maskText(pg.printed_content) !== pg.printed_content) m.set(`page:${d.id}#${pg.page}`, pg.printed_content);
  }
  for (const t of p.timeline) if (t.detail && maskText(t.detail) !== t.detail) m.set(`timeline:${t.id}`, t.detail);
  return m;
}

export function redactPacket(p: Packet): Packet {
  const c = structuredClone(p);
  for (const person of c.household.people) {
    person.ssn = maskSsn(person.ssn);
    if (person.ip_pin) person.ip_pin = "••••••";
  }
  const b = c.household.bank_account_for_refund_or_payment;
  b.routing = maskTail(b.routing);
  b.account = maskTail(b.account);
  const fid = c.firm.firm_identity as Record<string, unknown>;
  if (fid.ero_pin) fid.ero_pin = "•••••";
  for (const d of (c.prior_years.return_2024.dependents as unknown as { ssn: string }[]) ?? []) d.ssn = maskSsn(d.ssn);
  c.extracted_values = c.extracted_values.map((e) => maskEv(e));
  // Value-based masking catches secrets printed in free text (e.g. the IP PIN on CP01A).
  const secrets: [string, string][] = [];
  for (const person of p.household.people) if (person.ip_pin) secrets.push([person.ip_pin, "••••••"]);
  const bank = p.household.bank_account_for_refund_or_payment;
  secrets.push([bank.account, maskTail(bank.account)], [bank.routing, maskTail(bank.routing)]);
  const scrub = (t: string) => secrets.reduce((acc, [raw, m]) => acc.split(raw).join(m), maskText(t));
  for (const d of c.documents) for (const pg of d.pages) pg.printed_content = scrub(pg.printed_content);
  for (const t of c.timeline) if (t.detail) t.detail = t.detail.replace(/PIN (\d{5})/g, "PIN •••••");
  return c;
}

/** Replace a masked value in a payload with the raw value it stands for, among candidate fields. */
export function unmaskFrom(masked: string, candidates: string[]): string | undefined {
  return candidates.find((raw) => maskSsn(raw) === masked || maskTail(raw) === masked);
}
