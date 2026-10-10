import type { PolicyDraft, PolicyKey } from './model';

/** A live site as the preview resolves its role tokens (Escalation board, MEscalation "Show names for"). */
export interface PreviewSite {
  id: string;
  name: string;
  tier: number;
  owner: string | null;
  backup: string | null;
  /** The client's account manager; null for an internal site. */
  am: string | null;
}

/** Everything the Escalation page draws (S08, D-034). */
export interface EscalationPageData {
  policies: PolicyDraft[];
  downReminder: number;
  problemReminder: number;
  /** Tier 2–3 response hours in Bangkok minutes; holidays as `YYYY-MM-DD`. */
  hours: { startMin: number; endMin: number; days: number[]; holidays: string[] };
  sites: PreviewSite[];
  /** Every active Admin ("Admin" in a step). */
  admins: string[];
  /** Open incidents that keep the policy they opened with, by policy (the save dialog). */
  openIncidents: { number: number; key: PolicyKey }[];
}

export type EscalationSaveResult = { ok: true } | { ok: false; message: string };
