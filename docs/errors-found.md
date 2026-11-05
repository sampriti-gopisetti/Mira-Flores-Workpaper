# Errors found, and how the design surfaced them

Every item below is an **independent check** in `src/domain/checks.ts`. It recomputes the figure from the documents, the agency records or the client's answers, and never from the engine. It appears in the Issues inbox, on its area page and in the Inspector of every line it touches. Tax effects are the app's estimates (Δ × the v3 per-dollar rates; payments and credits 1:1). A positive number means more tax or a larger balance due.

| # | Error (engine v3) | Evidence that exposes it | How the design surfaced it | Est. effect (Fed / CA) |
|---|---|---|---|---|
| 1 | **RSU sales reported with $0 basis.** Three noncovered lots (N1, N3, N4) use the 1099-B's blank basis, so $47,620 of vest income is taxed twice | D11 stock plan supplement (adjusted basis 19,100 / 19,100 / 9,420), matched by acquisition date to the D28 lots | `rsu-basis`: lot-by-lot match, three adjustments suggested | −15,536 / −1,618 |
| 2 | **Schedule C gross receipts double count the 1099-K.** 163,700 should be 151,300 | D15 deposit detail: the 12,400 Paywell card payments are Atlas's, deposited gross and already in books. Books = 1099-NEC 142,000 + non-1099 clients 9,300 | `schc-gross` reconciliation; it is also the answer to the 2028 exam item | −4,402 / −384 |
| 3 | **California wages over-sourced.** All 218,400 was sourced to CA; resident-period wages are 129,569 | Residency ended 07/14; Halvorsen payroll kept CA as the work state through 9/30 (D09 note, qa-45); paystub D73 gives CA wages through 7/15 | `ca-wages` (appears once D73 arrives in the replay) | 0 / −5,685 |
| 4 | **Self-employed health insurance 14,400 not allowed** | qa-25: Erik was eligible for subsidized family coverage through Ngozi's employers (§162(l)(2)(B)) | `sehi` | +4,464 / +605 |
| 5 | **HVAC replacement (11,000) expensed as a repair** | D47 invoice: new heat-pump system, air handler, line set, permit; call-01 | `hvac` → elect the engine's `hvac_improvement` what-if | +3,633 / +896 |
| 6 | **California estimated payments overstated by 3,500.** 14,000 should be 10,500 | The FTB account and Web Pay confirmation D68 show the 9/15/2025 payment designated to tax year 2024 | `est-ca` | 0 / +3,500 |
| 7 | **Mileage log page counted twice.** 11,800 miles should be 8,100 | D23 page 3 is a second scan of page 2 (same trips; “coffee stain”); odometer also checked | `mileage-dup`: page-by-page trip comparison | +919 / +80 |
| 8 | **Home property tax includes the seller's share.** 13,420 should be 6,508, which pulls SALT under the 40,000 cap | D54: seller credited 6,912 for 01/01–07/07 (§1.164-6) | `property-tax` | +1,462 / +332 |
| 9 | **Federal estimated payments overstated by 1,000.** 13,000 should be 12,000 | IRS transcript: Q4 was 3,000 on 1/15/2026; EFTPS D67 shows three payments; the engine took the client's memory (qa-41: “4,000 I think”) | `est-fed` | +1,000 / 0 |
| 10 | **Car donation claimed at 6,000 (Kelley Blue Book)** | Form 1098-C: sold in an arm's-length sale for 2,900, so the deduction is limited to proceeds (§170(f)(12)) | `car-donation` (also exam item 1) | +806 / +149 |
| 11 | **Payoff interest counted twice** (2,150) | D56: “Interest is reported on the 2025 Form 1098”; D55 box 1 includes payoff interest | `mortgage-dup` | +559 / +103 |
| 12 | **Interest counted twice** (1,840) | The Northlake sweep interest appears on the composite (D28) and again on a standalone 1099-INT (D29) for the same account ending 7731 | `int-dup` | −640 / −127 |
| 13 | **Family phone and internet deducted at 100%; Spotify Family in software** | call-01: 70% and 50% business use; Spotify is personal | `mixed-use` | +541 / +48 |
| 14 | **Bitcoin lot C6: zero basis, short-term** | msg-07: bought 03/15/2021 for about 3,050, so long-term, gain 2,275; substantiation is weak and recorded as a judgment | `crypto-c6` (before msg-07 it asks the client) | −1,312 / −104 |
| 15 | **Theo's SSN mistyped in the organizer** (…3309 vs …3390) | The 2024 return as filed, and later the SS card D71 | `ssn-theo` fires from day one. **The design predicts the July e-file rejection**: in the season replay, the agency rejects only if this wasn't corrected | — |
| 16 | **Dependent-care provider EIN misread at 97% confidence** (74-3829516 vs printed 74-3829156) | D62 printed text | Generic “read vs printed” check (near-match / transposition) on every extracted value; the document viewer also shows it as “not printed verbatim” | — |
| 17 | **Care provider name wrong** (“Bright Oak Preschool” vs “Bright Oak Kids Club”) | D61 | `provider-F2441.1a` | — |
| 18 | **Meridian page 32 never read**: lot M18, −60 | The 250 gap between the D31 summary and its lots; the page text | `unread-D31`: adds the lot as a virtual line rolling into box B | −21 / −2 |
| 19 | **Swedish interest converted at the 2024 rate** | 18,450 SEK ÷ 9.86 (2025 average) = 1,871, not 1,747 | `fx-SchB.1.6` | +43 / +9 |
| 20 | **St. Brigid receipt ambiguous** (“$?,500”, read 1,500 at 41%) | msg-08: the client confirmed 1,500 by phone and bank statement | Low-confidence check → verification “confirmed with client” | — |
| 21 | **SEP contribution over the limit** (2,786 excess) | D26 vs the 20% limit | `sep-excess`: advise withdrawal (6% excise) | — |

**Client answers contradicted by documents** (recorded and dispositioned, not adjusted):
- qa-14 says “no sales” but there are 282 brokerage sales plus 12 crypto disposals.
- qa-31 says “no prior IRA basis”, but the 2024 Form 8606 and the 2024 Form 5498 (D42) show 7,000. Here the engine is right and the client is wrong.

**Prior preparer items:**
- The 2024 home office was claimed at 300 sq ft; the room is 220 (D24).
- The 2023 Form 3520 for the Swedish inheritance was never resolved. It is raised as an outside filing that must be dispositioned before filing.

**What the checks confirmed is right:**
- Carryovers agree to 2024.
- S-corp basis rolls forward to 2,300 once the 2023 K-1 arrives.
- W-2 totals agree (D10 is a duplicate photo).
- Brightpath's 260 lots tie to its 1099-B summary.
- The ISO AMT adjustment is 40,000.
- The 2025 home office average is 240 sq ft.

**Net:** with all fixes and the HVAC election, the federal return moves from a 4,220 balance due to about a **4,264 refund** (estimated; most of the swing is the RSU basis). California's refund moves from 8,256 to about 10,454.
