import type { RateCategory } from "./types";

export interface Area {
  id: string;
  title: string;
  budgetKey?: string;
  blurb: string;
}

export const AREAS: Area[] = [
  { id: "intake", title: "Intake & engagement", budgetKey: "intake_and_engagement", blurb: "Engagement, identity, household, prior year" },
  { id: "wages", title: "Wages & stock compensation", budgetKey: "wages_and_stock_compensation", blurb: "W-2s, RSU/ESPP/ISO, HSA, IRA" },
  { id: "investments", title: "Investments & digital assets", budgetKey: "investments_and_digital_assets", blurb: "Interest, dividends, 8949 sales, crypto, foreign account" },
  { id: "business", title: "Business (Lindqvist Studio)", budgetKey: "business", blurb: "Books to Schedule C, SE tax, SEP, QBI" },
  { id: "rentals", title: "Rentals & sale", budgetKey: "rentals_and_sale", blurb: "Schedule E, depreciation, passive losses, condo sale" },
  { id: "passthroughs", title: "Pass-throughs & basis", budgetKey: "pass_throughs_and_basis", blurb: "K-1s, S corp stock basis, partnership capital" },
  { id: "deductions", title: "Deductions & credits", budgetKey: "deductions_and_credits", blurb: "Itemized, charity, child/education/care credits" },
  { id: "tax", title: "Tax computation", blurb: "AGI to total tax, AMT, NIIT, additional Medicare" },
  { id: "payments", title: "Payments & penalty", blurb: "Withholding, estimates, extension, 2210" },
  { id: "california", title: "California part-year", budgetKey: "california", blurb: "540NR, Schedule CA split, credits, payments" },
];

export const AREA_BY_ID = new Map(AREAS.map((a) => [a.id, a]));

/** Which workpaper area a return line belongs to. */
export function areaForLine(key: string): string {
  const [form, ...rest] = key.split(".");
  const line = rest.join(".");
  if (form === "F540NR" && /^(7[1-9]|9\d)$/.test(line)) return "payments";
  if (["SchCA540NR", "F540NR", "FTB3885A", "ScheduleS", "FTB5805"].includes(form)) return "california";
  if (form === "F1040") {
    if (/^(25|26|31|33|34|35|37|38)/.test(line)) return "payments";
    if (/^1[a-z]?$/.test(line) || /^4/.test(line)) return "wages";
    if (/^(2a|2b|3a|3b|7)$/.test(line)) return "investments";
    if (line === "8") return "business";
    if (/^(12|13|14|19|20)$/.test(line)) return "deductions";
    return "tax";
  }
  if (form === "Sch1") return ["5"].includes(line) ? "rentals" : line === "13" ? "wages" : "business";
  if (form === "Sch3") return ["1", "8"].includes(line) ? "deductions" : "payments";
  if (form === "Sch2") return line === "4" ? "business" : "tax";
  if (["F8889", "F8606", "F8959"].includes(form)) return form === "F8959" ? "tax" : "wages";
  if (["F8949", "SchD", "SchB", "F8938", "F8960"].includes(form)) return form === "F8960" ? "tax" : "investments";
  if (["SchC", "SchSE", "F4562-C", "F8995"].includes(form)) return "business";
  if (form === "SchE") return /^(28|32|41)/.test(line) ? "passthroughs" : "rentals";
  if (["F4562-E", "F4797", "F8582"].includes(form)) return "rentals";
  if (form === "F7203") return "passthroughs";
  if (["SchA", "F8283", "F8812", "F8863", "F2441", "F8867"].includes(form)) return "deductions";
  if (form === "F6251") return line === "2i" ? "wages" : "tax";
  if (form === "F2210") return "payments";
  return "tax";
}

const DOC_AREA: Record<string, string> = {
  engagement_letter: "intake", consent_7216: "intake", irs_ip_pin_notice: "intake", identity_document: "intake",
  prior_year_return: "intake", prior_workpaper: "intake", irs_transcript: "payments", irs_notice: "intake",
  "W-2": "wages", stock_plan_supplement: "investments", "3921": "wages", "3922": "wages", paystub: "california",
  books_profit_loss: "business", books_transaction_detail: "business", "1099-NEC": "business", "1099-K": "business",
  invoice: "business", mileage_log: "business", client_note: "business", insurance_statement: "business",
  retirement_contribution: "business", books_report: "business",
  "1099-composite": "investments", "1099-INT": "investments", "1099-DA": "investments", transaction_export: "investments",
  foreign_bank_statement: "investments", "K-1-1065": "passthroughs", "K-1-state-supplement": "passthroughs", "K-1-1120S": "passthroughs",
  "1099-R": "wages", "5498": "wages", "1099-SA": "wages", "5498-SA": "wages",
  rental_owner_statement: "rentals", "1098": "deductions", property_tax_bill: "rentals", rental_ledger: "rentals",
  closing_statement_seller: "rentals", "1099-S": "rentals", closing_statement_buyer: "deductions", payoff_statement: "deductions",
  property_tax_receipt: "deductions", "1098-T": "deductions", letter: "deductions", dependent_care_statement: "deductions",
  donation_receipt: "deductions", "1098-C": "deductions", payment_confirmation: "payments",
};

export function areaForDoc(docType: string, docId?: string): string {
  if (docId === "D47") return "rentals";
  if (docId === "D48" || docId === "D53") return "rentals";
  return DOC_AREA[docType] ?? "intake";
}

/**
 * How a change to a line moves tax, for estimating with tax_effect_rates.
 * sign: +1 when the line moves the rate base in the same direction (income),
 * -1 when it moves it the opposite way (an expense lowering Schedule C profit).
 */
export type EffectKind =
  | { kind: "rate"; category: RateCategory; sign: 1 | -1; only?: "federal" | "california" }
  | { kind: "payment"; jurisdiction: "federal" | "california" }
  | { kind: "credit"; jurisdiction: "federal" | "california" }
  | { kind: "none"; why: string };

export function effectForLine(key: string): EffectKind {
  const [form, ...rest] = key.split(".");
  const line = rest.join(".");
  if (form === "F1040") {
    if (["25a", "25b", "25d", "26"].includes(line)) return { kind: "payment", jurisdiction: "federal" };
    if (["1a", "1z"].includes(line)) return { kind: "rate", category: "wages", sign: 1 };
    if (["2b", "3b"].includes(line)) return { kind: "rate", category: "interest", sign: 1 };
    if (line === "19") return { kind: "credit", jurisdiction: "federal" };
  }
  if (form === "Sch3") {
    if (["10", "11"].includes(line)) return { kind: "payment", jurisdiction: "federal" };
    if (line === "1") return { kind: "credit", jurisdiction: "federal" };
  }
  if (form === "F540NR") {
    if (["71", "72", "73"].includes(line)) return { kind: "payment", jurisdiction: "california" };
    if (line === "18") return { kind: "rate", category: "itemized", sign: 1 };
  }
  if (form === "ScheduleS") return { kind: "credit", jurisdiction: "california" };
  if (form === "SchCA540NR" && line.endsWith(".E")) return { kind: "rate", category: "ca_source_income", sign: 1 };
  if (form === "SchB") return { kind: "rate", category: "interest", sign: 1 };
  if (form === "SchC") {
    if (["1", "5", "7"].includes(line)) return { kind: "rate", category: "schc_profit", sign: 1 };
    if (["29", "31"].includes(line)) return { kind: "rate", category: "schc_profit", sign: 1 };
    if (/^(8|9|1\d|2\d|30)/.test(line) && !["44a", "44b", "44c", "43"].includes(line)) return { kind: "rate", category: "schc_profit", sign: -1 };
  }
  if (form === "F4562-C") return { kind: "rate", category: "schc_profit", sign: -1 };
  if (form === "F8949") {
    const box = line.split(".")[0];
    const lt = ["D", "E", "F", "J", "K", "L"].includes(box);
    return { kind: "rate", category: lt ? "ltcg" : "stcg", sign: 1 };
  }
  if (form === "SchD") return { kind: "rate", category: ["1b", "2", "3", "6", "7"].includes(line) ? "stcg" : "ltcg", sign: 1 };
  if (form === "SchE") {
    if (/^3/.test(line) || /^(21|22|26|28|32|41)/.test(line)) return { kind: "rate", category: "ordinary_income", sign: 1 };
    return { kind: "rate", category: "ordinary_income", sign: -1 };
  }
  if (form === "Sch1" && ["13", "15", "16", "17"].includes(line)) return { kind: "rate", category: "adjustment", sign: 1 };
  if (form === "SchA") {
    // 5e is the capped amount: a change there moves federal itemized deductions only
    // (California has no SALT cap; its effect is taken on the 5a-5d inputs).
    if (line === "5e" || line === "7") return { kind: "rate", category: "itemized", sign: 1, only: "federal" };
    if (/^5/.test(line)) return { kind: "rate", category: "salt", sign: 1 };
    return { kind: "rate", category: "itemized", sign: 1 };
  }
  if (form === "F8283") return { kind: "rate", category: "itemized", sign: 1 };
  if (form === "F2441" && line === "31") return { kind: "credit", jurisdiction: "federal" };
  return { kind: "none", why: "No per-dollar rate maps to this line; the engine must recompute." };
}
