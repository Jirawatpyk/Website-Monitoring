/**
 * Domain vocabulary shared by every app and package.
 * Values mirror the database enums (PRD §11) — change both together.
 */

export const TIERS = [1, 2, 3] as const;
export type Tier = (typeof TIERS)[number];

/** Site status (severity). Mute is an overlay, never a status (spec §11). */
export const SITE_STATUSES = ['ok', 'problem', 'down', 'maintenance'] as const;
export type SiteStatus = (typeof SITE_STATUSES)[number];

export const SEVERITIES = ['problem', 'down'] as const;
export type Severity = (typeof SEVERITIES)[number];

/** Incident lifecycle (spec §15.4). PROBLEM ends at `resolved`; only DOWN reaches `in_review` / `closed`. */
export const INCIDENT_STATES = [
  'unacked',
  'escalated',
  'acknowledged',
  'monitoring',
  'needs_root_cause',
  'resolved',
  'in_review',
  'closed',
] as const;
export type IncidentState = (typeof INCIDENT_STATES)[number];

/** The words each state's badge shows (spec §11); the CSV export uses them too. */
export const INCIDENT_STATE_LABELS: Record<IncidentState, string> = {
  unacked: 'Unacked',
  escalated: 'Escalated',
  acknowledged: 'Acknowledged',
  monitoring: 'Monitoring',
  needs_root_cause: 'Needs root cause',
  resolved: 'Resolved',
  in_review: 'In review',
  closed: 'Closed',
};

/** States after which an incident is no longer open (spec §19: open = any state before Resolved). */
export const CLOSED_INCIDENT_STATES = [
  'resolved',
  'in_review',
  'closed',
] as const satisfies readonly IncidentState[];

/** The closed states as a PostgREST `in` list: `("resolved","in_review","closed")`. */
export const CLOSED_INCIDENT_STATES_IN = `(${CLOSED_INCIDENT_STATES.map((s) => `"${s}"`).join(',')})`;

export const TRIGGERS = [
  'hard_fail',
  'blocked_unverified',
  'slow',
  'keyword',
  'key_page',
  'ssl',
  'domain',
  'redirect',
  'regional',
  'manual',
  'tls_chain',
  'content_change',
  'intermittent',
] as const;
export type Trigger = (typeof TRIGGERS)[number];

/** Triggers as people read them (spec §13, §14.6). Never show the raw code in the UI. */
export const TRIGGER_LABELS: Record<Trigger, string> = {
  hard_fail: 'Hard fail',
  blocked_unverified: 'Blocked, not verified',
  slow: 'Slow',
  keyword: 'Keyword',
  key_page: 'Key page',
  ssl: 'SSL expiring',
  domain: 'Domain expiring',
  redirect: 'Redirect',
  regional: 'Regional',
  manual: 'Manual (hand check)',
  tls_chain: 'TLS chain',
  content_change: 'Page change',
  intermittent: 'Intermittent',
};

/**
 * Root-cause categories of the Incident / Resolve boards (D-033), in board order; mirrors the check
 * on `incidents.root_cause_category`. `unknown` never meets the resolve condition (spec §16.3).
 */
export const ROOT_CAUSE_CATEGORIES = [
  'hosting',
  'deploy',
  'dns',
  'ssl',
  'third_party',
  'traffic',
  'client_change',
  'false_alarm',
  'unknown',
] as const;
export type RootCauseCategory = (typeof ROOT_CAUSE_CATEGORIES)[number];

export const ROOT_CAUSE_LABELS: Record<RootCauseCategory, string> = {
  hosting: 'Hosting / server',
  deploy: 'Deploy / code change',
  dns: 'DNS / domain',
  ssl: 'SSL certificate',
  third_party: 'Third-party / CDN',
  traffic: 'Traffic / capacity',
  client_change: 'Client-side change',
  false_alarm: 'False alarm (monitor)',
  unknown: 'Unknown — keep investigating',
};

export const CHECK_OUTCOMES = ['pass', 'fail', 'blocked'] as const;
export type CheckOutcome = (typeof CHECK_OUTCOMES)[number];

/** `check_rollups.bucket` (D-031): hour rows kept 90 days, day rows (Bangkok days) 2 years. */
export const ROLLUP_BUCKETS = ['hour', 'day'] as const;
export type RollupBucket = (typeof ROLLUP_BUCKETS)[number];

/**
 * A blocked check's header-level WAF signature (D-027). Only these let a location abstain on a site
 * behind a WAF; a body-only match (a "captcha" page) stays an ordinary blocked result.
 */
export const WAF_VENDORS = ['akamai', 'cloudflare', 'sucuri'] as const;
export type WafVendor = (typeof WAF_VENDORS)[number];

export const PROBE_LOCATIONS = ['BKK', 'SIN', 'TYO'] as const;
export type ProbeLocation = (typeof PROBE_LOCATIONS)[number];

/** RBAC roles (PRD §3). "On-call" is a duty, not a role. */
export const ROLES = ['admin', 'responder', 'stakeholder', 'viewer', 'client'] as const;
export type Role = (typeof ROLES)[number];

/** Roles as people read them (PRD §3). */
export const ROLE_LABELS: Record<Role, string> = {
  admin: 'Admin',
  responder: 'Responder',
  stakeholder: 'Stakeholder',
  viewer: 'Viewer',
  client: 'Client',
};

export interface TierConfig {
  /** Check interval per location. */
  intervalSec: number;
  /** Results from each location count toward one round when they land inside this window (PRD §5). */
  roundWindowSec: number;
  /** p50 above this for 3 rounds in a row → PROBLEM (slow). */
  slowThresholdMs: number;
  /** Tier 1 responds 24/7; Tier 2–3 share one response-hours setting (spec §7, §14.14). */
  alwaysOn: boolean;
}

export const TIER_CONFIG: Record<Tier, TierConfig> = {
  1: { intervalSec: 60, roundWindowSec: 90, slowThresholdMs: 3_000, alwaysOn: true },
  2: { intervalSec: 180, roundWindowSec: 210, slowThresholdMs: 5_000, alwaysOn: false },
  3: { intervalSec: 300, roundWindowSec: 330, slowThresholdMs: 5_000, alwaysOn: false },
};

/** Identifying User-Agent every probe sends (PRD §9). */
export const PROBE_USER_AGENT = 'DxT-Monitor/1.0';

/** Undo window for ack / resolve; Chat, email and webhooks are held until it closes (spec §14.3, §16.8). */
export const UNDO_WINDOW_SEC = 10;
