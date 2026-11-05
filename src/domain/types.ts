// Shapes of the packet as delivered (see packet.readme). Sections the app only
// displays are kept loosely typed; sections it computes on are typed precisely.

export type Json = string | number | boolean | null | Json[] | { [k: string]: Json };

export interface Person {
  id: string;
  role: "taxpayer" | "spouse" | "dependent";
  name: string;
  ssn: string;
  dob: string;
  ip_pin?: string | null;
  phone?: string;
  email?: string;
  occupation?: string;
  relationship?: string;
  months_lived_with_you?: number;
  full_time_student?: boolean;
  note?: string;
  own_income?: string;
}

export interface Household {
  filing_status: string;
  tax_year: number;
  entered_by: string;
  people: Person[];
  addresses: { from: string; to: string | null; address: string; type: string }[];
  residency: { state: string; from: string; to: string; status: string }[];
  bank_account_for_refund_or_payment: { routing: string; account: string; type: string; bank: string };
  prior_year_agi_for_esignature: number;
  related_returns: { who: string; return: string; prepared_by: string; in_this_packet: boolean | string }[];
}

export interface DocPage {
  page: number;
  printed_content: string;
}

export interface Doc {
  id: string;
  title: string;
  document_type: string;
  issuer: string;
  belongs_to: string;
  tax_year: number;
  received_at: string;
  uploaded_by: string;
  file_name: string;
  page_count: number;
  pages: DocPage[];
  marked_corrected?: boolean;
  extraction: { status: "extracted" | "partial" | "not_extracted"; values: number; reason: string | null };
}

export interface ExtractedValue {
  id: string;
  document_id: string;
  page: number;
  field: string;
  label: string;
  value: Json;
  value_type: string;
  text_as_read: string;
  position: { x0: number; y0: number; x1: number; y1: number };
  confidence: number;
}

export interface Line {
  key: string;
  jurisdiction: "federal" | "california";
  form: string;
  line: string;
  label: string;
  value: Json;
  rule: string;
  inputs: string[];
  sources: string[];
  note?: string;
}

export interface Totals {
  agi?: number;
  taxable_income?: number;
  total_agi?: number;
  ca_agi?: number;
  total_tax: number;
  payments: number;
  balance_due: number;
  penalty: number;
}

export type RateCategory =
  | "wages"
  | "interest"
  | "schc_profit"
  | "stcg"
  | "ltcg"
  | "ordinary_income"
  | "adjustment"
  | "salt"
  | "itemized"
  | "ca_source_income";

export interface Diagnostic {
  code: string;
  severity: "info" | "warning";
  message: string;
  refs: string[];
}

export interface Asset {
  asset_id: string;
  description: string;
  activity: string;
  cost: number;
  land_value_not_depreciated?: number;
  placed_in_service: string;
  method: string;
  life_years: number;
  federal: Record<string, number | null>;
  california: Record<string, number | null>;
  amt: Record<string, number | null>;
  disposed: Json;
  sources: string[];
}

export interface ReturnVersion {
  version: string;
  computed_at: string;
  trigger: string;
  documents_used: string[];
  documents_superseded: string[];
  summary: { federal: Totals; california: Totals };
  tax_effect_rates: Record<RateCategory, { federal_per_dollar: number; california_per_dollar: number }>;
  carryovers_out: { federal: Record<string, Json>; california: Record<string, Json> };
  assets: Asset[];
  diagnostics: Diagnostic[];
  changes_from_previous: { key: string; change: "added" | "changed" | "removed"; old?: Json; new?: Json }[];
  lines: Line[];
}

export interface WhatIf {
  id: string;
  description: string;
  base_version: string;
  choices: Record<string, string>;
  federal: { base: Totals; alternative: Totals; total_tax_change: number; penalty_change?: number };
  california: { base: Totals; alternative: Totals; total_tax_change: number };
  changed_lines: { key: string; change: string; old?: Json; new?: Json }[];
}

export interface Staff {
  id: string;
  name: string;
  role: string;
  credential: string | null;
  sensitive_data_clearance: boolean;
  active_from: string;
  note?: string;
}

export interface Firm {
  name: string;
  staff: Staff[];
  firm_identity: Record<string, Json>;
  client_users: { id: string; name: string; role: string }[];
  assignment_at_start: { preparer: string; reviewer: string; partner: string };
  deadlines: { what: string; date: string }[];
  budget_hours: Record<string, number>;
  starter_standards: {
    note: string;
    verification_types: string[];
    variance_review: { compare_to: string; flag_if_change_over_percent: number; and_over_amount: number };
    review_levels: string[];
    rules: string[];
    required_steps: string[];
  };
}

export interface TimelineEvent {
  id: string;
  at: string;
  event: string;
  actor: string | null;
  detail: string | null;
  refs: string[];
}

export interface Packet {
  packet: { name: string; version: string; generated: string; client_id: string };
  readme: Record<string, Json>;
  household: Household;
  documents: Doc[];
  extracted_values: ExtractedValue[];
  client: {
    questionnaire: { id: string; question: string; answer: string; answered_by: string; answered_at: string }[];
    messages: { id: string; sent_at: string; from: string; to: string; text: string }[];
    call_notes: { id: string; date: string; participants: string[]; notes: string[] }[];
  };
  firm: Firm;
  prior_years: {
    return_2024: {
      lines: Record<string, Json>;
      line_labels: Record<string, string>;
      line_sources: Record<string, string>;
      notes: Record<string, string>;
      [k: string]: Json;
    };
    prior_preparer_workpaper: {
      source_document: string;
      summary_memo: string;
      notes: string[];
      open_items_left_by_prior_preparer: string[];
      depreciation_schedule: string;
    };
    asset_records: Json[];
    basis_records: Record<string, Json>;
    carryovers_into_2025: Record<string, Json>;
  };
  tax_agency_records: {
    irs_account_transcript_2025: {
      as_of: string;
      transactions: { date: string; code: string; description: string; amount: number | string }[];
    }[];
    ftb_account: {
      as_of: string;
      tax_year_2025_payments: { date: string; amount: number }[];
      tax_year_2024_payments_after_filing: { date: string; amount: number; note: string }[];
    };
    notices: Record<string, Json>[];
    efile: { date: string; jurisdiction: string; submission_id: string; status: string; errors?: { code: string; message: string }[] }[];
  };
  timeline: TimelineEvent[];
  engine_reference: { parameters: Record<string, Json>; rules: Record<string, string> };
  return_versions: ReturnVersion[];
  what_if: { alternatives: WhatIf[]; extension: Record<string, Json> };
  planning_reference_2026: Record<string, Json>;
  post_filing_rates: Record<string, Json>;
  fx_rates: Record<string, Json>;
}
