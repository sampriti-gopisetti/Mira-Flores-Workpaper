import type { Packet } from "./types";

export type Role = "preparer" | "reviewer" | "partner" | "firm_administrator" | "quality_reviewer" | "client" | "examiner" | "system";

export interface Actor {
  id: string;
  name: string;
  role: Role;
  credential?: string | null;
  clearance: boolean;
  activeFrom?: string;
  note?: string;
}

export const SYSTEM: Actor = { id: "system", name: "Agency / timeline replay", role: "system", clearance: false };
export const EXAMINER: Actor = {
  id: "irs-exam", name: "IRS examiner (read-only)", role: "examiner", clearance: false,
  note: "External read-only view of the filed record and the exam response.",
};

export function actorsFromPacket(p: Packet): Actor[] {
  const staff: Actor[] = p.firm.staff.map((s) => ({
    id: s.id, name: s.name, role: s.role as Role, credential: s.credential,
    clearance: s.sensitive_data_clearance, activeFrom: s.active_from, note: s.note,
  }));
  const clients: Actor[] = p.firm.client_users.map((c) => ({ id: c.id, name: c.name, role: "client", clearance: false }));
  return [...staff, ...clients, EXAMINER];
}

export const ROLE_LABEL: Record<Role, string> = {
  preparer: "Preparer", reviewer: "Reviewer", partner: "Partner", firm_administrator: "Firm admin",
  quality_reviewer: "Quality reviewer", client: "Client", examiner: "IRS examiner", system: "System",
};

export const isStaff = (a: Actor) => ["preparer", "reviewer", "partner", "firm_administrator", "quality_reviewer"].includes(a.role);
export const canWork = (a: Actor) => ["preparer", "reviewer", "partner"].includes(a.role);
