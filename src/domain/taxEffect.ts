import type { ReturnVersion } from "./types";
import { effectForLine } from "./areas";

export interface TaxEffect {
  /** change in total tax */
  federalTax: number;
  californiaTax: number;
  /** change in balance due (tax change minus payment change) */
  federalBalance: number;
  californiaBalance: number;
  basis: string;
  estimable: boolean;
  large: boolean;
}

export const ZERO_EFFECT: TaxEffect = {
  federalTax: 0, californiaTax: 0, federalBalance: 0, californiaBalance: 0, basis: "No tax effect", estimable: true, large: false,
};

/**
 * The engine cannot be re-run, so a change is priced with the version's
 * per-dollar rates (readme.engine_and_recomputing). Payments and credits move
 * balance/tax 1:1. Large changes are flagged because they can cross thresholds.
 */
export function taxEffect(key: string, delta: number, rv: ReturnVersion): TaxEffect {
  if (!delta) return ZERO_EFFECT;
  const e = effectForLine(key);
  const large = Math.abs(delta) >= 25000;
  if (e.kind === "payment") {
    const fed = e.jurisdiction === "federal";
    return {
      federalTax: 0, californiaTax: 0,
      federalBalance: fed ? -delta : 0, californiaBalance: fed ? 0 : -delta,
      basis: `Payment: balance due moves 1:1 (${fed ? "federal" : "California"})`, estimable: true, large: false,
    };
  }
  if (e.kind === "credit") {
    const fed = e.jurisdiction === "federal";
    return {
      federalTax: fed ? -delta : 0, californiaTax: fed ? 0 : -delta,
      federalBalance: fed ? -delta : 0, californiaBalance: fed ? 0 : -delta,
      basis: "Credit: tax moves 1:1", estimable: true, large: false,
    };
  }
  if (e.kind === "rate") {
    const r = rv.tax_effect_rates[e.category];
    const f = e.only === "california" ? 0 : delta * e.sign * r.federal_per_dollar;
    const c = e.only === "federal" ? 0 : delta * e.sign * r.california_per_dollar;
    const fedR = e.only === "california" ? "—" : r.federal_per_dollar.toFixed(3);
    const caR = e.only === "federal" ? "—" : r.california_per_dollar.toFixed(3);
    return {
      federalTax: Math.round(f), californiaTax: Math.round(c), federalBalance: Math.round(f), californiaBalance: Math.round(c),
      basis: `${e.sign < 0 ? "−" : ""}Δ × ${e.category} rate (fed ${fedR}, CA ${caR}) from ${rv.version}`,
      estimable: true, large,
    };
  }
  return { ...ZERO_EFFECT, basis: e.why, estimable: false, large };
}

export function addEffects(a: TaxEffect, b: TaxEffect): TaxEffect {
  return {
    federalTax: a.federalTax + b.federalTax, californiaTax: a.californiaTax + b.californiaTax,
    federalBalance: a.federalBalance + b.federalBalance, californiaBalance: a.californiaBalance + b.californiaBalance,
    basis: "Sum", estimable: a.estimable && b.estimable, large: a.large || b.large,
  };
}
