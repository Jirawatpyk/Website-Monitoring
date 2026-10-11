import type { SiteStatus, Tier, Trigger } from '@dxt/shared';
import { SITE_LOCATIONS, type LocationGlyph, type SiteLocation } from '@/components/site-cells';

/** BKK / SIN / TYO glyphs, as the Sites list draws them (spec §11 legend). */
export type { LocationGlyph };
export const OVERVIEW_LOCATIONS = SITE_LOCATIONS;
export type OverviewLocation = SiteLocation;

/** Who is looking (spec §21.8): an AM is a stakeholder who manages a client; any other stakeholder is the CEO (D-032). */
export type ViewerKind = 'admin' | 'responder' | 'am' | 'ceo' | 'viewer';

export interface OverviewViewer {
  id: string;
  name: string;
  kind: ViewerKind;
}

/** A site's open incident (any state before Resolved). */
export interface OverviewIncident {
  id: string;
  number: number;
  state: 'unacked' | 'escalated' | 'acknowledged' | 'monitoring' | 'needs_root_cause';
  /** The incident's severity (it only goes up, D-021). */
  severity: 'down' | 'problem';
  /** The severity of the drop it is in now — a key page still failing after the home page came back is a
   * PROBLEM drop on a DOWN incident (D-023). */
  dropSeverity: 'down' | 'problem';
  trigger: Trigger;
  level: number;
  /** First failed check of the drop it is in now — a relapse or an escalation starts its own (spec
   * §14.3: duration counts from here; D-004, D-021). */
  startedAt: string;
  /** Confirmed down / flagged (the unacked wait counts from here, spec §14.3). */
  detectedAt: string;
  recoveredAt: string | null;
  ackedBy: string | null;
  /** The cause in words: DOWN in short form ("Timeout ×2 · 504 ×1"), PROBLEM its summary. */
  cause: string | null;
}

/** One monitored site as the Overview sees it. Drafts never reach the Overview (§21.2). */
export interface OverviewSite {
  id: string;
  name: string;
  tier: Tier;
  /** Null before the first round. */
  status: SiteStatus | null;
  /** When the current status started (`site_status.since`). */
  statusSince: string | null;
  /** The last complete round. */
  checkedAt: string | null;
  ownerId: string | null;
  ownerName: string | null;
  backupId: string | null;
  /** The client's AM (for "Your client"). */
  amId: string | null;
  mutedUntil: string | null;
  muteReason: string | null;
  incident: OverviewIncident | null;
  locations: Record<OverviewLocation, LocationGlyph>;
  /** When the current TLS chain error started at the first warned location (oldest of the streak). */
  chainSince: string | null;
  /** p50 of the last round's passing checks (§21.5); null while down or with no pass. */
  p50Ms: number | null;
  /** 96 × 15-min p50, oldest first; null = no point (the line breaks). */
  series: (number | null)[];
  /** Same index as `series`: the bucket had a hard fail. */
  failed: boolean[];
  /** The 30-day uptime window (spec §5, D-031); null for a site never monitored. */
  uptime: { uptime: number; windowMinutes: number; downMinutes: number; maintenanceMinutes: number } | null;
}

/** An incident event for Recent events (§21.6), joined to its incident and site. */
export interface OverviewEvent {
  id: string;
  type: string;
  at: string;
  actorName: string | null;
  payload: Record<string, unknown>;
  incidentNumber: number;
  severity: 'down' | 'problem';
  trigger: Trigger;
  siteName: string;
  /** The incident resolved itself (a short PROBLEM, §19.6): its RECOVERED and auto-resolve share one line. */
  autoResolved: boolean;
}

/** The header pill (D-032): probe locations beating and the verifier. */
export interface ProbeHealth {
  beating: string[];
  total: number;
  verifier: 'idle' | 'busy' | 'offline';
}

export interface OverviewKpis {
  mttaSeconds: number | null;
  mttdSeconds: number | null;
  enough: boolean;
  mttaChange: { seconds: number; direction: 'up' | 'down' | 'flat' } | null;
  mttdChange: { seconds: number; direction: 'up' | 'down' | 'flat' } | null;
  /** All monitored sites, time-weighted (spec §5). */
  uptime30d: number;
}

/** Everything `/` renders. */
export interface OverviewData {
  nowIso: string;
  viewer: OverviewViewer;
  sites: OverviewSite[];
  drafts: number;
  events: OverviewEvent[];
  kpis: OverviewKpis;
  probes: ProbeHealth;
  /** The latest complete round across sites, for "last full round 10:07:10". */
  lastRoundAt: string | null;
  /** The "Maintenance & mutes" card (§23.8); null = nothing active, waiting or scheduled. */
  maintenance?: (OverviewMaintenanceCard & { phoneLine: string | null }) | null;
  /** Recent events lines from windows and mutes (Main3). */
  windowEvents?: { id: string; at: string; text: string }[];
}

export interface OverviewMaintenanceCard {
  active: { id: string; kind: 'maintenance' | 'mute'; title: string; detail: string }[];
  waiting: number;
  scheduled: number;
  nextScheduled: string | null;
}
