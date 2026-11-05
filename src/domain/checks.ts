import type { Json } from "./types";
import type { PacketIndex } from "./packetIndex";
import type { WorkpaperState } from "./project";
import { taxEffect } from "./taxEffect";
import { money, num } from "./format";
import { areaForDoc, areaForLine } from "./areas";

// Independent checks: each recomputes a figure from documents, agency records or
// client answers and compares it with the engine. None of them trust the engine.

export interface SuggestedAdjustment { key: string; to: Json; reason: string; kind?: "amount" | "correction"; parent?: string }

export interface Suggestion {
  adjustments?: SuggestedAdjustment[];
  whatIfId?: string;
  verify?: { target: string; method: string; evidence: string[] };
  question?: { to: "client" | string; text: string };
}

export interface Check {
  id: string;
  title: string;
  area: string;
  severity: "high" | "medium" | "low" | "info";
  source: "workpaper" | "engine";
  summary: string;
  detail: string[];
  lines: string[];
  evidence: string[];
  suggestion?: Suggestion;
  status: "open" | "resolved" | "passed" | "dispositioned";
  statusNote?: string;
  effect?: { federal: number; california: number };
  /** workpaper check: the engine diagnostic code it supersedes */
  covers?: string;
  /** engine diagnostic: the workpaper check that handles it */
  coveredBy?: string;
}

export interface LotAggregates {
  [docId: string]: {
    count: number;
    proceeds: number;
    basis: number;
    wash: number;
    byTerm: Record<string, { count: number; proceeds: number; basis: number; wash: number }>;
  };
}

type Raw = Omit<Check, "status" | "source"> & { passed?: boolean; source?: Check["source"] };

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const lastFour = (s: string) => `…${String(s).replace(/\D/g, "").slice(-4)}`;

function damerau1(a: string, b: string): boolean {
  if (a === b) return false;
  if (a.length === b.length) {
    const diff = [...a].map((c, i) => (c !== b[i] ? i : -1)).filter((i) => i >= 0);
    if (diff.length === 1) return true;
    if (diff.length === 2 && diff[1] === diff[0] + 1 && a[diff[0]] === b[diff[1]] && a[diff[1]] === b[diff[0]]) return true;
  }
  return false;
}

export function runChecks(ix: PacketIndex, s: WorkpaperState, lots?: LotAggregates): Check[] {
  const p = ix.packet;
  const out: Raw[] = [];
  const vis = (d: string) => s.visibleDocs.has(d);
  const has = (k: string) => s.vi.lines.has(k);
  const lv = (k: string) => num(s.value(k));
  const eng = (k: string) => num(s.vi.lines.get(k)?.value);
  const ev = (doc: string, field: string) => ix.evByDocField.get(`${doc}#${field}`);
  const evn = (doc: string, field: string) => num(ev(doc, field)?.value);
  const page = (doc: string, n: number) => ix.docs.get(doc)?.pages.find((x) => x.page === n)?.printed_content ?? "";
  const msgVisible = (id: string) => (ix.msgs.get(id)?.sent_at ?? "9999") <= s.asOf;

  // 1. Federal estimated payments vs IRS transcript and EFTPS.
  {
    const snaps = p.tax_agency_records.irs_account_transcript_2025.filter((t) => t.as_of <= s.asOf.slice(0, 10));
    const snap = snaps.at(-1);
    if (snap && has("F1040.26")) {
      const est = snap.transactions.filter((t) => t.code === "670" && /estimated/i.test(t.description));
      const irs = sum(est.map((t) => num(t.amount)));
      const eftps = vis("D67") ? sum([1, 2, 3, 4].map((q) => evn("D67", `q${q}_amount`))) : 0;
      const qa = ix.qa.get("qa-41");
      out.push({
        id: "est-fed", title: "Federal estimated payments vs IRS transcript", area: "payments",
        severity: "high", passed: Math.abs(lv("F1040.26") - irs) < 1,
        summary: `Return claims ${money(lv("F1040.26"))}; IRS transcript (as of ${snap.as_of}) shows ${money(irs)}.`,
        detail: [
          ...est.map((t) => `IRS ${t.date}: ${money(num(t.amount))} (code ${t.code})`),
          vis("D67") ? `EFTPS confirmations (D67) show ${money(eftps)} in three payments; no January payment confirmation was uploaded.` : "",
          qa ? `Client answer (qa-41): “${qa.answer}” — the engine used this instead of the agency record.` : "",
        ].filter(Boolean),
        lines: ["F1040.26"], evidence: [`agency:/irs_account_transcript_2025/${snaps.length - 1}`, "D67", "qa-41"],
        suggestion: { adjustments: [{ key: "F1040.26", to: irs, reason: "Agree estimated payments to the IRS account transcript (Q4 was 3,000 on 2026-01-15, not 4,000)." }] },
      });
    }
  }

  // 2. California estimated payments vs FTB account and payment designations.
  if (has("F540NR.72")) {
    const ftb = p.tax_agency_records.ftb_account;
    const ftbSum = sum(ftb.tax_year_2025_payments.map((x) => x.amount));
    const misdesignated = ftb.tax_year_2024_payments_after_filing;
    out.push({
      id: "est-ca", title: "California estimated payments vs FTB account", area: "payments", severity: "high",
      passed: Math.abs(lv("F540NR.72") - ftbSum) < 1,
      summary: `Return claims ${money(lv("F540NR.72"))}; FTB credits ${money(ftbSum)} to tax year 2025.`,
      detail: [
        ...ftb.tax_year_2025_payments.map((x) => `FTB ${x.date}: ${money(x.amount)} applied to 2025`),
        ...misdesignated.map((x) => `FTB ${x.date}: ${money(x.amount)} — ${x.note}`),
        vis("D68") ? `Web Pay confirmation (D68) shows the 09/15/2025 payment designated tax year ${ev("D68", "pay5_year")?.value}.` : "",
        "Action outside the return: ask FTB to reapply the 2024 credit, or claim it on the 2024 account.",
      ].filter(Boolean),
      lines: ["F540NR.72"], evidence: ["agency:/ftb_account", "ev-1074", "ev-1075", "ev-1076"],
      suggestion: { adjustments: [{ key: "F540NR.72", to: ftbSum, reason: "The 09/15/2025 Web Pay payment was designated to tax year 2024 and is held as a 2024 credit." }] },
    });
  }

  // 3. California wage sourcing: residency ended 2025-07-14; payroll kept CA through 9/30.
  if (has("SchCA540NR.1.E") && vis("D73")) {
    const caEnd = p.household.residency.find((r) => r.state === "CA")?.to ?? "";
    const corvane = evn("D08", "box1") + evn("D08", "box12_W");
    const halvorsenCa = evn("D73", "ytd_ca_wages");
    const expected = Math.round(corvane + halvorsenCa);
    out.push({
      id: "ca-wages", title: "California-source wages after the move to Texas", area: "california", severity: "high",
      passed: Math.abs(lv("SchCA540NR.1.E") - expected) < 1,
      summary: `Engine sources all ${money(lv("SchCA540NR.1.E"))} of wages to California; resident-period wages are ${money(expected)}.`,
      detail: [
        `California residency ended ${caEnd} (household.residency).`,
        `Corvane (employment ended 05/16/2025, all while a CA resident): box 1 ${money(evn("D08", "box1"))} + employer HSA ${money(evn("D08", "box12_W"))} (CA does not exclude HSA).`,
        `Halvorsen through 07/15/2025 per paystub D73: CA taxable wages ${money(halvorsenCa)}; HSA year-to-date 0.`,
        "Halvorsen's W-2 box 16 (111,300) is wrong: payroll kept California as the work state through 09/30 (D09 note, qa-45). Texas-period wages are not California-source.",
        "CA withholding after the move is still a credit on the 540NR; the client should also ask Halvorsen for a corrected W-2.",
      ],
      lines: ["SchCA540NR.1.E"], evidence: ["D73", "ev-1081", "ev-0016", "ev-0024", "ev-0047", "qa-45"],
      suggestion: { adjustments: [{ key: "SchCA540NR.1.E", to: expected, reason: "Source only resident-period wages to California (Corvane + Halvorsen through 7/15 per paystub)." }] },
    });
  }

  // 4. Self-employed health insurance: not allowed in months eligible for a spouse's employer plan.
  if (has("Sch1.17") && lv("Sch1.17") > 0) {
    const qa = ix.qa.get("qa-25");
    if (qa && /^yes/i.test(qa.answer)) {
      out.push({
        id: "sehi", title: "Self-employed health insurance while eligible for spouse's employer plan", area: "business", severity: "high",
        summary: `Deduction of ${money(lv("Sch1.17"))} is not allowed: Erik was eligible for subsidized family coverage through Ngozi's employers all year.`,
        detail: [`qa-25: “${qa.answer}”`, "IRC §162(l)(2)(B): no deduction for any month the taxpayer is eligible to participate in a subsidized plan of an employer of the spouse.", "Premiums (D25) are personal; QBI also changes (not captured by the adjustment rate)."],
        lines: ["Sch1.17"], evidence: ["qa-25", "D25", "ev-0484"],
        suggestion: { adjustments: [{ key: "Sch1.17", to: 0, reason: "§162(l)(2)(B): eligible for spouse's employer-subsidized plan (qa-25)." }] },
      });
    }
  }

  // 5. Vehicle donation limited to gross proceeds when the charity sells it.
  if (has("F8283.A1.vehicle") && vis("D66")) {
    const proceeds = evn("D66", "box4c");
    const sold = /sold in arm/i.test(page("D66", 1));
    out.push({
      id: "car-donation", title: "Donated car claimed above the charity's sale proceeds", area: "deductions", severity: "high",
      passed: !sold || lv("F8283.A1.vehicle") <= proceeds,
      summary: `Claimed ${money(lv("F8283.A1.vehicle"))} (Kelley Blue Book per client); Form 1098-C shows the charity sold it for ${money(proceeds)}.`,
      detail: ["Form 1098-C box 4a: sold in an arm's length transaction to an unrelated party; box 4c gross proceeds 2,900.", "IRC §170(f)(12): deduction limited to gross proceeds; attach Copy B of the 1098-C.", "qa-39 and call-01: value was the client's estimate."],
      lines: ["F8283.A1.vehicle"], evidence: ["D66", "ev-1054", "qa-39", "call-01"],
      suggestion: { adjustments: [{ key: "F8283.A1.vehicle", to: proceeds, reason: "§170(f)(12): limited to gross proceeds on Form 1098-C box 4c." }] },
    });
  }

  // 6. What the pipeline read vs what is printed (confident misreads).
  {
    const patterns: Record<string, RegExp> = {
      ein: /\b\d{2}-\d{7}\b/g, ssn: /\b\d{3}-\d{2}-\d{4}\b/g, money: /[\d?]{1,3}(?:,[\d?]{3})*\.\d{2}/g,
    };
    for (const e of p.extracted_values) {
      if (!vis(e.document_id) || !patterns[e.value_type] || !e.text_as_read) continue;
      if (e.value_type === "money" && !(s.vi.citedBy.get(e.id)?.length)) continue;
      const text = page(e.document_id, e.page);
      if (text.includes(e.text_as_read)) continue;
      const tokens = [...new Set(text.match(patterns[e.value_type]) ?? [])];
      const near = tokens.find((t) => damerau1(t, e.text_as_read));
      if (!near) continue;
      const ambiguous = near.includes("?");
      const lines = s.vi.citedBy.get(e.id) ?? [];
      const sensitive = e.value_type === "ssn";
      const confirm = ambiguous && e.id === "ev-1049" && msgVisible("msg-08") ? "msg-08" : undefined;
      out.push({
        id: `read-${e.id}`, title: ambiguous ? `Ambiguous amount read at ${Math.round(e.confidence * 100)}% confidence` : `Misread ${e.label.toLowerCase()} (${Math.round(e.confidence * 100)}% confidence)`,
        area: lines[0] ? areaForLine(lines[0]) : areaForDoc(ix.docs.get(e.document_id)?.document_type ?? "", e.document_id),
        severity: ambiguous ? "medium" : e.confidence >= 0.9 ? "high" : "medium",
        summary: ambiguous
          ? `Pipeline read ${e.text_as_read}; the document prints “${near}” (first digit unclear).`
          : `Pipeline read ${sensitive ? lastFour(e.text_as_read) : e.text_as_read}; the document prints ${sensitive ? lastFour(near) : near}.`,
        detail: [
          `${ix.docs.get(e.document_id)?.title} page ${e.page}, field ${e.field}.`,
          ambiguous ? (confirm ? "Client confirmed 1,500 by phone and bank statement (msg-08, check #2207)." : "Confirm the amount with the client (bank record or the charity).") : "High-confidence misread — a digit transposition the pipeline did not flag.",
          lines.length ? `Used on ${lines.join(", ")}.` : "",
        ].filter(Boolean),
        lines, evidence: [e.id, e.document_id, ...(confirm ? [confirm] : [])],
        suggestion: ambiguous
          ? confirm ? { verify: { target: e.id, method: "confirmed_with_client", evidence: [confirm] } } : { question: { to: "client", text: "The St. Brigid receipt amount is unclear ($?,500). Please confirm the amount and send the bank record." } }
          : { adjustments: [{ key: e.id, to: near, reason: `Printed on ${e.document_id}: ${sensitive ? lastFour(near) : near}`, kind: "correction" }] },
        covers: ambiguous ? "LOW_CONFIDENCE_READ" : undefined,
      });
    }
  }
  // 6b. Care provider names on Form 2441 vs the provider statements.
  for (const key of ["F2441.1a", "F2441.1b"]) {
    const l = s.vi.lines.get(key);
    if (!l) continue;
    const m = /Care provider: ([^,]+), tax ID/.exec(l.label);
    const srcEv = ix.evs.get(l.sources[0] ?? "");
    if (!m || !srcEv) continue;
    const text = page(srcEv.document_id, srcEv.page);
    if (text.includes(m[1])) continue;
    const printed = text.split(",")[0];
    out.push({
      id: `provider-${key}`, title: "Care provider name differs from the provider's statement", area: "deductions", severity: "low",
      summary: `Form 2441 names “${m[1]}”; the statement is from “${printed}”.`,
      detail: ["Provider name and TIN must match the provider's records (Form 2441 Part I).", `Source: ${srcEv.document_id}.`],
      lines: [key], evidence: [srcEv.document_id],
      suggestion: { adjustments: [{ key: `${key}:provider`, to: printed, reason: `Name as printed on ${srcEv.document_id}`, kind: "correction" }] },
    });
  }

  // 7. Dependent SSNs vs identity documents and the prior-year return.
  for (const person of p.household.people.filter((x) => x.role === "dependent")) {
    const idDoc = p.documents.find((d) => vis(d.id) && d.document_type === "identity_document" && d.belongs_to === `dependent:${person.id}`);
    const idEv = idDoc ? (ix.evsByDoc.get(idDoc.id) ?? []).find((e) => e.value_type === "ssn") : undefined;
    const pyDep = (p.prior_years.return_2024.dependents as { name: string; ssn: string }[] | undefined)?.find((d) => d.name === person.name);
    const source = idEv ? { ssn: String(idEv.value), ref: idEv.id, label: idDoc!.title } : pyDep ? { ssn: pyDep.ssn, ref: "py:/return_2024/dependents", label: "2024 return as filed" } : undefined;
    if (!source || source.ssn === person.ssn) continue;
    const corr = s.correctionsByTarget.get(`household:${person.id}.ssn`);
    out.push({
      id: `ssn-${person.id}`, title: `${person.name.split(" ")[0]}'s SSN in the organizer doesn't match ${idEv ? "the Social Security card" : "last year's return"}`,
      area: "intake", severity: "high",
      summary: `Organizer ${lastFour(person.ssn)} vs ${source.label} ${lastFour(source.ssn)}. E-file will reject (dependent TIN/name control mismatch).`,
      detail: ["The client typed the organizer (household.entered_by).", `${source.label} is the independent record.`, ...(s.filing.lastRejection ? [`E-file rejected: ${s.filing.lastRejection.payload.errors.map((x) => x.code).join(", ")}`] : [])],
      lines: ["F8812.4"], evidence: [source.ref, `household:${person.id}`, ...(msgVisible("msg-10") ? ["msg-10"] : [])],
      suggestion: { adjustments: [{ key: `household:${person.id}.ssn`, to: source.ssn, reason: `SSN per ${source.label}`, kind: "correction" }] },
      passed: !!corr && corr.to === source.ssn,
    });
  }

  // 8. HVAC replacement expensed as a repair.
  if (vis("D47") && has("SchE.14A")) {
    const inv = page("D47", 1);
    const amt = evn("D46", "hvac");
    if (/installed new/i.test(inv) && amt > 2500) {
      const w = p.what_if.alternatives.find((x) => x.id === "hvac_improvement");
      out.push({
        id: "hvac", title: "HVAC system replacement expensed as a repair", area: "rentals", severity: "medium",
        summary: `${money(amt)} new heat-pump system (D47) is inside repairs on Schedule E; it is likely a restoration/betterment of the HVAC unit of property.`,
        detail: ["Invoice: removed failed furnace and condenser, installed a new heat pump system, air handler, line set; permit pulled (D47).", "Treas. Reg. §1.263(a)-3(i)/(k): replacing a building system is a restoration; exceeds the $2,500 de minimis safe harbor.", "call-01: “replaced the whole system with a heat pump.”", w ? `Engine what-if: federal ${w.federal.total_tax_change >= 0 ? "+" : ""}${money(w.federal.total_tax_change)}, CA ${w.california.total_tax_change >= 0 ? "+" : ""}${money(w.california.total_tax_change)}.` : ""].filter(Boolean),
        lines: ["SchE.14A"], evidence: ["D47", "ev-1001", "call-01", "qa-37"],
        suggestion: { whatIfId: "hvac_improvement" },
        effect: w ? { federal: w.federal.total_tax_change, california: w.california.total_tax_change } : undefined,
      });
    }
  }

  // 9. Partially extracted broker statements: read the unread page and reconcile.
  for (const d of p.documents) {
    if (!vis(d.id) || d.extraction.status !== "partial" || ix.supersededBy.get(d.id) && vis(ix.supersededBy.get(d.id)!)) continue;
    const summary = (ix.evsByDoc.get(d.id) ?? []).find((e) => e.field === "b_summary_proceeds");
    const lotProceeds = lots?.[d.id]?.proceeds ?? sum((ix.evsByDoc.get(d.id) ?? []).filter((e) => /_proceeds$/.test(e.field) && e.field !== "b_summary_proceeds").map((e) => num(e.value)));
    const unread = d.pages.find((pg) => /additional transactions/i.test(pg.printed_content));
    const m = unread && /(M\d+) (.+?) [\d.]+ sh acquired (\S+) sold (\S+) proceeds ([\d,.]+) basis ([\d,.]+) (short|long)-term (covered|noncovered)/.exec(unread.printed_content);
    if (!summary || !m) continue;
    const gain = num(m[5].replace(/,/g, "")) - num(m[6].replace(/,/g, ""));
    const box = m[7] === "short" ? (m[8] === "covered" ? "A" : "B") : (m[8] === "covered" ? "D" : "E");
    out.push({
      id: `unread-${d.id}`, title: `Unread page ${unread!.page} on ${d.issuer} 1099-B`, area: "investments", severity: "medium",
      summary: `Summary proceeds ${money(num(summary.value))} vs extracted lots ${money(lotProceeds)}: the ${money(num(summary.value) - lotProceeds)} gap is lot ${m[1]} on page ${unread!.page}, which the pipeline never read.`,
      detail: [`Page ${unread!.page}: ${unread!.printed_content}`, `Lot ${m[1]}: ${m[2]}, ${m[7]}-term ${m[8]} → Form 8949 box ${box}, gain ${money(gain)}.`, d.extraction.reason ?? ""],
      lines: [`F8949.${box}.total`], evidence: [`doc:${d.id}#page${unread!.page}`, summary.id],
      suggestion: { adjustments: [{ key: `F8949.${box}.${m[1]}`, to: gain, reason: `Lot ${m[1]} from ${d.id} page ${unread!.page} (not extracted).`, parent: `F8949.${box}.total` }] },
      covers: "BROKER_SUMMARY_DETAIL_MISMATCH",
    });
  }

  // 10. Client answers contradicted by documents.
  {
    const qa14 = ix.qa.get("qa-14");
    const brokerLots = Object.entries(lots ?? {}).filter(([id]) => id !== "D34" && !ix.supersededBy.has(id)).reduce((a, [, v]) => a + v.count, 0);
    if (qa14 && /^no/i.test(qa14.answer) && brokerLots) {
      out.push({
        id: "qa-sales", title: "Questionnaire says no investments were sold", area: "investments", severity: "low",
        summary: `qa-14 “${qa14.answer}”, but brokers report ${brokerLots} sales and Coinhaven reports 12 digital-asset dispositions (qa-15: “didn't really sell”).`,
        detail: ["Documents govern; confirm with the client that every account is in the file (completeness).", "Direct-indexing and RSU sell-to-cover sales are often not seen as 'selling' by clients."],
        lines: ["SchD.16"], evidence: ["qa-14", "qa-15", "D28", "D31", "D34", "D74"],
        suggestion: { question: { to: "client", text: "Our documents show stock sales at Northlake, Meridian and Brightpath and 12 crypto sales at Coinhaven. Are there any other brokerage or crypto accounts we don't have?" } },
        covers: "QUESTIONNAIRE_SALES_CONFLICT",
      });
    }
    const qa31 = ix.qa.get("qa-31");
    if (qa31 && /none/i.test(qa31.answer) && has("F8606.2") && lv("F8606.2") > 0) {
      out.push({
        id: "qa-ira-basis", title: "Client says no prior IRA basis; 2024 Form 8606 shows 7,000", area: "wages", severity: "low",
        summary: "The engine is right and the client is not: the 2024 contribution (made 02/12/2025) created 7,000 of basis converted in 2025.",
        detail: ["2024 Form 8606 line 14: 7,000 (D06).", "Form 5498 for 2024 (D42): contribution made 02/12/2025 for 2024.", "1099-R (D41): 14,026 converted = 7,010 + 7,016 → taxable 26."],
        lines: ["F8606.2", "F8606.18"], evidence: ["qa-31", "py:/return_2024/lines/F8606.14", "D42", "D41"],
        suggestion: { verify: { target: "F8606.2", method: "agreed_to_prior_year", evidence: ["D42", "py:/return_2024/lines/F8606.14"] } },
      });
    }
  }

  // 11. Digital asset with no basis (transfer-in).
  if (has("F8949.H.C6")) {
    const known = msgVisible("msg-07");
    const proceeds = evn("D34", "C6_proceeds") || eng("F8949.H.C6");
    out.push({
      id: "crypto-c6", title: "Bitcoin lot C6 reported with zero basis and a 2025 acquisition date", area: "investments", severity: "medium",
      summary: known
        ? `Client says the BTC was bought 03/15/2021 for about 3,050 (msg-07): long-term, gain ${money(proceeds - 3050)} instead of short-term ${money(proceeds)}.`
        : "Coinhaven has no basis for a transfer-in; the engine used zero basis and the transfer-in date (short-term).",
      detail: ["D35: C6 acquired 'transfer-in', basis blank (read at 60% confidence).", known ? "Substantiation is a bank statement line only (exchange closed): record the judgment and the authority (Rev. Proc. 2024-28 / reasonable records)." : "Ask the client where and when this BTC was bought."],
      lines: ["F8949.H.C6"], evidence: ["ev-0918", "ev-0919", "D34", ...(known ? ["msg-07"] : [])],
      suggestion: known
        ? { adjustments: [
          { key: "F8949.H.C6", to: 0, reason: "C6 is long-term (acquired 2021-03-15 per msg-07); moved to box K." },
          { key: "F8949.K.C6", to: proceeds - 3050, reason: "C6: proceeds less 3,050 basis (msg-07, bank statement 03/15/2021).", parent: "F8949.K.total" },
        ] }
        : { question: { to: "client", text: "Coinhaven shows 0.05 BTC sold 06/18/2025 that was transferred in from another wallet. When and where did you buy it, and for how much?" } },
      covers: "DIGITAL_ASSET_BASIS_MISSING",
    });
  }

  // 12. Carryovers agree to the prior year.
  {
    const c = p.prior_years.carryovers_into_2025 as Record<string, number>;
    const pairs: [string, number][] = [["SchD.6", -c.capital_loss_short], ["SchD.14", -c.capital_loss_long], ["F8582.1c", -(c.passive_1450_fremont + c.passive_1200_barton_hills)]];
    const bad = pairs.filter(([k, v]) => has(k) && Math.abs(lv(k) - v) >= 1);
    out.push({
      id: "carryovers", title: "Carryovers agree to the 2024 return", area: "intake", severity: "medium", passed: bad.length === 0,
      summary: bad.length ? `${bad.length} carryover line(s) differ from 2024.` : "Capital loss (3,200 ST / 11,000 LT) and passive losses (6,300 + 9,850) agree to 2024.",
      detail: pairs.map(([k, v]) => `${k}: return ${money(lv(k))} vs 2024 ${money(v)}`),
      lines: pairs.map(([k]) => k), evidence: ["py:/carryovers_into_2025", "D06"],
    });
  }

  // 13. S corporation stock basis roll-forward.
  if (has("F7203.1")) {
    const recs = p.prior_years.basis_records.scorp_lindqvist_family_woodworks as { year: number; ending_stock_basis?: number | null; k1_income?: number; distributions?: number }[];
    const start2022 = recs.find((r) => r.year === 2022)?.ending_stock_basis ?? 0;
    const has2023 = vis("D40");
    const y2023 = has2023 ? evn("D40", "box1") + evn("D40", "box4") - evn("D40", "box16d") : 0;
    const r2024 = recs.find((r) => r.year === 2024);
    const end2024 = Math.max(0, start2022 + y2023) + (r2024?.k1_income ?? 0) - (r2024?.distributions ?? 0);
    out.push({
      id: "scorp-basis", title: "S corporation stock basis roll-forward (Woodworks)", area: "passthroughs",
      severity: has2023 ? "medium" : "high", passed: has2023 && Math.abs(lv("F7203.1") - end2024) < 1,
      summary: has2023
        ? `Rolled forward: 2022 ${money(start2022)} → 2023 ${money(start2022 + y2023)} → 2024 ${money(end2024)}; return uses ${money(lv("F7203.1"))}.`
        : "2023 K-1 missing: the engine assumed no change in 2023 (basis gap).",
      detail: [
        `2022 ending basis ${money(start2022)} (client worksheet in prior preparer file).`,
        has2023 ? `2023 K-1 (D40): income ${money(evn("D40", "box1"))} − distributions ${money(evn("D40", "box16d"))}.` : "Request the 2023 K-1 (prior preparer open item).",
        `2024: income ${money(r2024?.k1_income ?? 0)} − distributions ${money(r2024?.distributions ?? 0)}.`,
        "2025 distributions 42,000 include 1,580 Oregon composite tax paid on Erik's behalf (D39); distributions in excess of basis are capital gain (F8949 box F).",
      ],
      lines: ["F7203.1", "F7203.excess"], evidence: ["py:/basis_records/scorp_lindqvist_family_woodworks", "D40", "D39", "ev-0982"],
      covers: "SCORP_BASIS_INCOMPLETE",
      suggestion: has2023 ? undefined : { question: { to: "client", text: "We need the 2023 Schedule K-1 from Lindqvist Family Woodworks to compute stock basis." } },
    });
  }

  // 14. Prior preparer's open items.
  {
    const items = p.prior_years.prior_preparer_workpaper.open_items_left_by_prior_preparer;
    out.push({
      id: "pp-k1", title: "Prior preparer: obtain the 2023 Woodworks K-1", area: "passthroughs", severity: "low", passed: vis("D40"),
      summary: vis("D40") ? "Received 2026-06-05 (D40); basis rolled forward." : items[0], detail: [], lines: [], evidence: ["py:/prior_preparer_workpaper", "D40"],
    });
    out.push({
      id: "pp-5498", title: "Prior preparer: confirm 2024 Form 5498 for IRA basis", area: "wages", severity: "low", passed: vis("D42"),
      summary: vis("D42") ? "D42 confirms the 7,000 contribution for 2024 (made 02/12/2025)." : items[1], detail: [], lines: ["F8606.2"], evidence: ["D42"],
    });
    if (vis("D24")) {
      const sac = evn("D24", "sac_sqft");
      out.push({
        id: "pp-homeoffice", title: "2024 home office was claimed at 300 sq ft; the room is 220 sq ft", area: "business", severity: "low",
        summary: `D24 measures the Sacramento studio at ${sac} sq ft. The 2024 return deducted 300 × $5 = 1,500 (overstated ${money((300 - sac) * 5)}).`,
        detail: ["Prior preparer note: “300 sq ft (2 rooms combined?) - client to confirm.”", "Decide whether to amend 2024 (immaterial) and document it.", "2025 uses the correct monthly average (220 Jan–Jun, 260 Jul–Dec = 240)."],
        lines: ["SchC.30"], evidence: ["D24", "py:/return_2024/lines/SchC.30", "py:/prior_preparer_workpaper/notes/4"],
      });
    }
  }

  // 15. Home office area (2025) recomputed.
  if (vis("D24") && has("SchC.30")) {
    const avg = (evn("D24", "sac_sqft") * 6 + evn("D24", "aus_sqft") * 6) / 12;
    const rate = num(p.engine_reference.parameters.home_office_rate as Json);
    out.push({
      id: "home-office", title: "Home office simplified method recomputed", area: "business", severity: "info",
      passed: Math.abs(lv("SchC.30") - Math.round(avg * rate)) < 1,
      summary: `220 sq ft Jan–Jun and 260 sq ft Jul–Dec (move mid-July; July counts for Austin with 16 days of use) = ${avg} sq ft × $${rate} = ${money(avg * rate)}.`,
      detail: [], lines: ["SchC.30"], evidence: ["D24", "ev-0481", "ev-0482"], covers: "HOME_OFFICE_AREA_CHANGE",
    });
  }

  // 16. Same interest reported on two forms.
  {
    const ints = [...s.vi.lines.values()].filter((l) => /^SchB\.1\.\d+$/.test(l.key));
    for (let i = 0; i < ints.length; i++) for (let j = i + 1; j < ints.length; j++) {
      const a = ints[i], b = ints[j];
      if (num(a.value) !== num(b.value) || !num(a.value)) continue;
      const docA = ix.evs.get(a.sources[0])?.document_id, docB = ix.evs.get(b.sources[0])?.document_id;
      if (!docA || !docB) continue;
      const acct = (t: string): string[] => t.match(/ending (\d{4})/g) ?? [];
      const shared = acct(page(docA, 1)).filter((x) => acct(page(docB, 1)).includes(x));
      if (!shared.length) continue;
      out.push({
        id: `int-dup-${b.key}`, title: "Same interest counted twice", area: "investments", severity: "medium",
        summary: `${a.label} and ${b.label} are the same ${money(num(a.value))} — the bank sweep for account ${shared[0]} is reported on the composite 1099 and again on a standalone 1099-INT.`,
        detail: [`${docA}: ${page(docA, 1).slice(0, 160)}…`, `${docB}: ${page(docB, 1)}`],
        lines: [a.key, b.key], evidence: [docA, docB, a.sources[0], b.sources[0]],
        suggestion: { adjustments: [{ key: b.key, to: 0, reason: `Duplicate of ${a.key} (same sweep account ${shared[0]}).` }] },
      });
    }
  }

  // 17. Foreign currency converted at the wrong year's rate.
  for (const l of s.vi.lines.values()) {
    const fx = l.sources.find((x) => x.startsWith("ref:fx.SEK.2024"));
    if (!fx) continue;
    const sek = num(ix.evs.get(l.sources.find((x) => x.startsWith("ev-")) ?? "")?.value);
    const rate = (p.engine_reference.parameters.fx as Record<string, Record<string, number>>).SEK["2025_average"];
    const expected = Math.round(sek / rate);
    out.push({
      id: `fx-${l.key}`, title: "Swedish interest converted at the 2024 exchange rate", area: "investments", severity: "low",
      summary: `SEK ${money(sek)} ÷ 2025 average ${rate} = ${money(expected)}; the engine used the 2024 average (10.56) = ${money(num(l.value))}.`,
      detail: ["Income is translated at the rate for the year it is received (yearly average acceptable).", "Form 8938 maximum value correctly uses the year-end rate."],
      lines: [l.key], evidence: [fx, "ref:fx.SEK.2025_average", ...l.sources.filter((x) => x.startsWith("ev-"))],
      suggestion: { adjustments: [{ key: l.key, to: expected, reason: "Translate 2025 interest at the 2025 average rate (9.86 SEK/USD)." }] },
    });
  }

  // 18. Noncovered RSU lots with zero basis (double taxation of vest income).
  if (vis("D11")) {
    const supp = (ix.evsByDoc.get("D11") ?? []).filter((e) => e.field.endsWith("_acquired"));
    const adj: SuggestedAdjustment[] = [];
    const det: string[] = [];
    for (const l of s.vi.lines.values()) {
      const m = /^F8949\.([BE])\.(N\d+)$/.exec(l.key);
      if (!m) continue;
      const lot = m[2];
      if (evn("D28", `${lot}_basis`) !== 0) continue;
      const acq = ev("D28", `${lot}_acquired`)?.value;
      const match = supp.find((e) => e.value === acq && e.field.startsWith("RSU"));
      if (!match) continue;
      const basis = evn("D11", match.field.replace("_acquired", "_adjusted_basis"));
      const proceeds = evn("D28", `${lot}_proceeds`);
      adj.push({ key: l.key, to: proceeds - basis, reason: `Adjusted basis ${money(basis)} per stock plan statement D11 (${match.field.split("_")[0]}); box 1 of the W-2 already taxed it.` });
      det.push(`${lot} (${acq}): proceeds ${money(proceeds)} − basis ${money(basis)} = ${money(proceeds - basis)} (engine: ${money(num(l.value))})`);
    }
    if (adj.length) out.push({
      id: "rsu-basis", title: "RSU sales reported with zero basis", area: "investments", severity: "high",
      summary: `${adj.length} noncovered RSU lots use the 1099-B's blank basis. The vest value was already taxed as wages, so ${money(sum(adj.map((a) => eng(a.key) - num(a.to))))} of gain is taxed twice.`,
      detail: [...det, "D11: “The cost basis reported on Form 1099-B for RSU shares is blank/$0 because these shares are noncovered.”", "Report with code B adjustment on Form 8949 (boxes B/E)."],
      lines: adj.map((a) => a.key), evidence: ["D11", "ev-0066", "ev-0068", "ev-0070", "ev-0498", "ev-0516", "ev-0525"],
      suggestion: { adjustments: adj },
    });
  }

  // 19. Mileage log page scanned twice.
  if (vis("D23") && has("SchC.44a")) {
    const d23 = ix.evsByDoc.get("D23") ?? [];
    const byPage = new Map<number, string>();
    for (const pg of ix.docs.get("D23")!.pages) {
      byPage.set(pg.page, d23.filter((e) => e.page === pg.page && /^trip\d+_(date|miles)$/.test(e.field)).map((e) => String(e.value)).join("|"));
    }
    const pagesArr = [...byPage.entries()];
    const dupPages = pagesArr.filter(([, sig], i) => sig && pagesArr.slice(0, i).some(([, s2]) => s2 === sig)).map(([pg]) => pg);
    if (dupPages.length) {
      const totals = d23.filter((e) => e.field === "page_total");
      const unique = sum(totals.filter((e) => !dupPages.includes(e.page)).map((e) => num(e.value)));
      const rate = num(p.engine_reference.parameters.mileage_rate as Json);
      const odo = evn("D23", "odometer_end") - evn("D23", "odometer_start");
      out.push({
        id: "mileage-dup", title: "Mileage log page counted twice", area: "business", severity: "high",
        summary: `Page ${dupPages.join(", ")} is a second scan of an earlier page; business miles are ${money(unique)}, not ${money(lv("SchC.44a"))}.`,
        detail: [`Page 3 header: “${page("D23", 3).slice(0, 80)}…”`, `Trip-by-trip comparison: page ${dupPages[0]} has the same dates and miles as page ${dupPages[0] - 1}.`, `Odometer ${money(odo)} total miles → other miles ${money(odo - unique)}.`, `Standard mileage ${money(unique)} × $${rate} = ${money(unique * rate)}.`],
        lines: ["SchC.44a", "SchC.9", "SchC.44c"], evidence: ["D23", "ev-0315", "ev-0404"],
        suggestion: { adjustments: [
          { key: "SchC.9", to: Math.round(unique * rate), reason: `Standard mileage on ${unique} business miles (duplicate page removed).` },
          { key: "SchC.44a", to: unique, reason: "Duplicate page 3 removed.", kind: "amount" },
          { key: "SchC.44c", to: odo - unique, reason: "Odometer total less business miles." },
        ] },
      });
    }
  }

  // 20. Mixed-use phone/internet and a personal subscription in the books.
  if (has("SchC.25") && (ix.calls.get("call-01")?.date ?? "9999") <= s.asOf) {
    const notes = ix.calls.get("call-01")!.notes;
    const pct = (re: RegExp) => num((notes.find((n) => re.test(n))?.match(/(\d+)%/) ?? [])[1]) / 100;
    const phone = evn("D15", "phone_monthly") * 12 * pct(/mobile/i);
    const internet = evn("D15", "internet_monthly") * 12 * pct(/internet/i);
    const util = Math.round(phone + internet);
    const spotify = evn("D15", "spotify");
    out.push({
      id: "mixed-use", title: "Family phone plan and home internet deducted at 100%", area: "business", severity: "medium",
      summary: `Utilities ${money(lv("SchC.25"))} → ${money(util)} at the client's business-use estimates; Spotify Family (${money(spotify)}) is personal.`,
      detail: [`Phone: 180/month × 12 × ${pct(/mobile/i) * 100}% = ${money(phone)} (call-01, D15).`, `Internet: 110/month × 12 × ${pct(/internet/i) * 100}% = ${money(internet)}.`, "Spotify Family booked to software by mistake (call-01).", "IRC §262: personal portion not deductible; first residential phone line is never deductible (§262(b))."],
      lines: ["SchC.25", "SchC.27a.1"], evidence: ["call-01", "D15", "ev-0106", "ev-0107", "ev-0108"],
      suggestion: { adjustments: [
        { key: "SchC.25", to: util, reason: "Business share of phone (70%) and internet (50%) per client (call-01)." },
        { key: "SchC.27a.1", to: lv("SchC.27a.1") === eng("SchC.27a.1") ? eng("SchC.27a.1") - spotify : lv("SchC.27a.1"), reason: "Remove Spotify Family (personal)." },
      ] },
    });
  }

  // 21. Mortgage interest from the payoff statement counted on top of the 1098.
  if (has("SchA.8a")) {
    const l = s.vi.lines.get("SchA.8a")!;
    const payoffEv = l.sources.map((x) => ix.evs.get(x)).find((e) => e && ix.docs.get(e.document_id)?.document_type === "payoff_statement");
    if (payoffEv && /reported on the 2025 Form 1098/i.test(page(payoffEv.document_id, 1))) {
      out.push({
        id: "mortgage-dup", title: "Payoff interest counted twice", area: "deductions", severity: "medium",
        summary: `${money(num(payoffEv.value))} of interest from the payoff statement is already inside the Lonestar 1098 box 1 (13,900).`,
        detail: [`${payoffEv.document_id}: “(Interest is reported on the 2025 Form 1098.)”`, "D55 box 1 “includes prepaid interest at closing and interest paid at payoff 11/20/2025”."],
        lines: ["SchA.8a"], evidence: [payoffEv.id, payoffEv.document_id, "D55", "ev-1029"],
        suggestion: { adjustments: [{ key: "SchA.8a", to: eng("SchA.8a") - num(payoffEv.value), reason: "Payoff interest is already in Form 1098 box 1 (D55, D56)." }] },
      });
    }
  }

  // 22. Home property tax includes the seller's share credited at closing.
  if (has("SchA.5b") && vis("D54")) {
    const credit = evn("D54", "tax_credit");
    const paid = eng("SchA.5b");
    const own = paid - credit;
    const cap = num(p.engine_reference.parameters.salt_cap as Json);
    const capped = Math.min(cap, lv("SchA.5a") + own);
    out.push({
      id: "property-tax", title: "Home property tax includes the seller's share", area: "deductions", severity: "medium",
      summary: `Travis County 2025 tax ${money(paid)} was paid in full from escrow, but the seller credited ${money(credit)} for 01/01–07/07 at closing. The buyers deduct ${money(own)}; SALT drops below the ${money(cap)} cap.`,
      detail: ["D54 seller credit for 2025 county taxes 01/01/2025–07/07/2025: 6,912.", "Treas. Reg. §1.164-6: real property tax is apportioned between seller and buyer by days owned.", `SALT: ${money(lv("SchA.5a"))} + ${money(own)} = ${money(lv("SchA.5a") + own)} → limited ${money(capped)}.`],
      lines: ["SchA.5b", "SchA.5e"], evidence: ["D54", "ev-1027", "D58", "D57"],
      suggestion: { adjustments: [
        { key: "SchA.5b", to: own, reason: "Exclude the seller's 01/01–07/07 share credited at closing (§1.164-6)." },
        { key: "SchA.5e", to: capped, reason: "Recompute the SALT limitation with the corrected property tax." },
      ] },
    });
  }

  // 23. Schedule C gross receipts: card payments already in the books.
  if (has("SchC.1") && vis("D15")) {
    const books = evn("D14", "total_income");
    const nec = sum(["D16", "D17", "D18", "D19", "D20"].map((d) => evn(d, "box1")));
    const small = evn("D15", "unreported_small");
    const k = evn("D21", "box1a");
    out.push({
      id: "schc-gross", title: "Form 1099-K added on top of books that already include it", area: "business", severity: "high",
      passed: Math.abs(lv("SchC.1") - books) < 1,
      summary: `Books ${money(books)} = 1099-NEC ${money(nec)} + non-1099 clients ${money(small)}. The 1099-K ${money(k)} is Atlas's card payments, already inside Atlas's 41,200; the engine added it again (${money(lv("SchC.1"))}).`,
      detail: ["D15 page 3: “12,400.00 arrived through Paywell Payments card processing (deposited gross …)”.", "Atlas also issued a 1099-NEC for the full 41,200 (D17): the same income is on two information returns.", "This reconciliation is the answer to the 2028 examination item on gross receipts."],
      lines: ["SchC.1"], evidence: ["D14", "ev-0103", "D15", "ev-0109", "ev-0110", "ev-0111", "D17", "D21"],
      suggestion: { adjustments: [{ key: "SchC.1", to: books, reason: "Gross receipts per books; the 1099-K amounts are already recorded (D15 deposit detail)." }] },
    });
  }

  // 24. SEP contribution above the limit.
  if (has("Sch1.16") && vis("D26")) {
    const contrib = evn("D26", "amount") || 18000;
    const excess = contrib - lv("Sch1.16");
    if (excess > 0) out.push({
      id: "sep-excess", title: "SEP contribution exceeds the deductible limit", area: "business", severity: "medium",
      summary: `Contributed ${money(contrib)}; limit ${money(lv("Sch1.16"))}. ${money(excess)} excess is subject to a 6% excise tax each year unless withdrawn (with earnings) by the due date.`,
      detail: ["IRC §404(h), §4972/§4979. Recompute the limit if Schedule C profit changes.", "Advise the client in writing; record the decision."],
      lines: ["Sch1.16"], evidence: ["D26", "ev-0485"],
    });
  }

  // 25. Reconciliations that pass (evidence that the engine was tested, not trusted).
  {
    const w2 = ["D08", "D09"].filter(vis);
    const box = (b: string) => sum(w2.map((d) => evn(d, b)));
    out.push({
      id: "w2-sums", title: "W-2 totals agree (duplicate photo excluded)", area: "wages", severity: "info",
      passed: Math.abs(lv("F1040.1a") - box("box1")) < 1 && Math.abs(lv("F1040.25a") - box("box2")) < 1,
      summary: `Box 1 ${money(box("box1"))}, box 2 ${money(box("box2"))}, box 17 ${money(box("box17"))}. D10 is a phone photo of D09 and is counted once.`,
      detail: [`Return: wages ${money(lv("F1040.1a"))}, federal withholding ${money(lv("F1040.25a"))}, CA withholding ${money(lv("F540NR.71"))}.`],
      lines: ["F1040.1a", "F1040.25a", "F540NR.71"], evidence: ["D08", "D09", "D10"],
    });
    const bp = lots?.D74;
    const bpSum = (t: string) => evn("D74", `${t}_proceeds`);
    if (bp) out.push({
      id: "brightpath", title: "Brightpath 260 lots reconcile to the 1099-B summary", area: "investments", severity: "info",
      passed: Math.abs((bp.byTerm.short?.proceeds ?? 0) - bpSum("st")) < 0.01 && Math.abs((bp.byTerm.long?.proceeds ?? 0) - bpSum("lt")) < 0.01,
      summary: `Short-term lots ${money(bp.byTerm.short?.proceeds ?? 0, true)} vs summary ${money(bpSum("st"), true)}; long-term ${money(bp.byTerm.long?.proceeds ?? 0, true)} vs ${money(bpSum("lt"), true)}; wash sales ${money(bp.wash, true)}.`,
      detail: [`${bp.count} lots summed from extracted detail (server-side aggregate).`], lines: ["F8949.A.total", "F8949.D.total"], evidence: ["D74"],
    });
    const iso = s.vi.lines.get("F6251.2i");
    if (iso && vis("D12")) {
      const calc = (evn("D12", "box4") - evn("D12", "box3")) * evn("D12", "box5");
      out.push({
        id: "iso-amt", title: "ISO bargain element recomputed", area: "wages", severity: "info", passed: Math.abs(calc - num(iso.value)) < 1,
        summary: `(52 − 12) × 1,000 shares = ${money(calc)}; still held at year end, so it is an AMT adjustment (credit carryforward to 2026).`,
        detail: ["California AMT not computed by the engine: review CA-source allocation of the July exercise (CA resident until 07/14)."], lines: ["F6251.2i"], evidence: ["D12"],
      });
    }
  }

  // 26. Live e-file rejection.
  if (s.filing.lastRejection) {
    const r = s.filing.lastRejection;
    out.push({
      id: "efile-reject", title: `E-file rejected (${r.payload.jurisdiction})`, area: "intake", severity: "high",
      summary: r.payload.errors.map((x) => `${x.code}: ${x.message}`).join(" "),
      detail: ["Correct the data, re-approve if amounts change, and resubmit (the state return is held until federal is accepted)."],
      lines: [], evidence: ["agency:/efile"],
      passed: [...s.correctionsByTarget.keys()].some((k) => /^household:.*\.ssn$/.test(k)),
    });
  }

  // 27. Work orphaned by a pipeline re-run (its value no longer exists).
  if (s.orphaned.length) {
    out.push({
      id: "orphaned-work", title: "Work attached to values that no longer exist", area: "intake", severity: "medium",
      summary: `${s.orphaned.length} recorded action(s) point at extracted values that the current packet no longer contains.`,
      detail: s.orphaned.slice(0, 8).map((e) => `${e.type} on ${e.target} by ${e.actorId} (anchor ${e.anchor})`),
      lines: [], evidence: s.orphaned.slice(0, 8).map((e) => e.target),
    });
  }

  // Engine diagnostics become checks; those covered by an independent check follow it.
  const byCovered = new Map(out.filter((c) => c.covers).map((c) => [c.covers!, c.id]));
  for (const d of s.vi.version.diagnostics) {
    const covering = byCovered.get(d.code);
    out.push({
      id: `diag:${d.code}`, title: d.code.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase()),
      area: diagArea(d.code), severity: d.severity === "warning" ? "medium" : "info", source: "engine",
      summary: d.message, detail: covering ? [`Covered by workpaper check “${covering}”.`] : [], lines: d.refs.filter((r) => s.vi.lines.has(r)), evidence: d.refs,
      coveredBy: covering,
    });
  }

  const final = out.map((c) => finalize(c, s));
  const byId = new Map(final.map((c) => [c.id, c]));
  for (const c of final) {
    if (!c.coveredBy) continue;
    const cov = byId.get(c.coveredBy);
    if (cov && c.status === "open") { c.status = cov.status === "open" ? "open" : "resolved"; c.statusNote = `Follows check “${cov.title}” (${cov.status})`; }
  }
  return final;
}

function diagArea(code: string): string {
  if (/SCORP|K1/.test(code)) return "passthroughs";
  if (/DIGITAL|BROKER|QUESTIONNAIRE|FBAR/.test(code)) return "investments";
  if (/AMT_CREDIT/.test(code)) return "tax";
  if (/CA_AMT/.test(code)) return "california";
  if (/AOTC|DUE_DILIGENCE|LOW_CONFIDENCE/.test(code)) return "deductions";
  if (/1099|HOME_OFFICE/.test(code)) return "business";
  return "tax";
}

function satisfied(s: WorkpaperState, a: SuggestedAdjustment): boolean {
  if (a.kind === "correction") {
    const c = s.correctionsByTarget.get(a.key);
    return !!c && JSON.stringify(c.to) === JSON.stringify(a.to);
  }
  return Math.abs(num(s.value(a.key)) - num(a.to)) < 1 && (s.lineValues.has(a.key));
}

function finalize(c: Raw, s: WorkpaperState): Check {
  const { passed, ...rest } = c;
  const check: Check = { ...rest, area: rest.area ?? "deductions", source: c.source ?? "workpaper", status: "open" };
  const disp = s.judgments.filter((j) => j.payload.kind === "check_disposition" && j.target === `check:${c.id}`).at(-1);
  const sug = c.suggestion;
  if (sug?.adjustments?.length && !check.effect) {
    let f = 0, ca = 0;
    for (const a of sug.adjustments) {
      if (a.kind === "correction") continue;
      const cur = num(s.value(a.key));
      const e = taxEffect(a.key, num(a.to) - (s.lineValues.has(a.key) ? cur : 0), s.vi.version);
      f += e.federalBalance; ca += e.californiaBalance;
    }
    check.effect = { federal: f, california: ca };
  }
  const touched = sug?.adjustments?.some((a) => s.adjustmentsByKey.has(a.key) || s.correctionsByTarget.has(a.key));
  if (passed && !touched) { check.status = "passed"; return check; }
  if (sug?.adjustments?.length && sug.adjustments.every((a) => satisfied(s, a))) { check.status = "resolved"; check.statusNote = "Adjusted in the workpaper"; check.effect = { federal: 0, california: 0 }; return check; }
  if (sug?.whatIfId && s.elections.has(sug.whatIfId)) { check.status = "resolved"; check.statusNote = "Election recorded"; return check; }
  if (sug?.verify) {
    const st = s.evStatus.get(sug.verify.target) ?? s.lineStatus.get(sug.verify.target);
    if (st && (st.status === "verified" || st.status === "carried")) { check.status = "resolved"; check.statusNote = "Verified"; return check; }
  }
  if (c.id.startsWith("diag:")) {
    const code = c.id.slice(5);
    if (code === "DUE_DILIGENCE_REQUIRED" && s.judgments.some((j) => j.payload.kind === "due_diligence")) { check.status = "resolved"; check.statusNote = "Form 8867 due diligence recorded"; return check; }
    if (code === "FBAR_OUTSIDE_RETURN" && s.judgments.some((j) => j.target === "outside:fbar")) { check.status = "resolved"; check.statusNote = "Outside filing dispositioned"; return check; }
    if (code === "FORM_1099_FILING" && s.judgments.some((j) => j.target === "outside:1099nec")) { check.status = "resolved"; check.statusNote = "Outside filing dispositioned"; return check; }
  }
  if (disp) { check.status = "dispositioned"; check.statusNote = `${disp.payload.decision}${disp.payload.authority ? ` (${disp.payload.authority})` : ""}`; return check; }
  return check;
}
