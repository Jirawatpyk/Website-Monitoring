import type { IncidentState, MonitorHeader, Severity, SiteStatus, Tier, Trigger } from '@dxt/shared';
import {
  SITE_LOCATIONS,
  type IncidentLinkData,
  type LocationGlyph,
  type SiteLocation,
} from '@/components/site-cells';

// Shared with the Overview through components/site-cells (S06b).
export type { LocationGlyph };
export const LIST_LOCATIONS = SITE_LOCATIONS;
export type ListLocation = SiteLocation;
/** The open incident shown under a site's status (any state before Resolved). */
export type OpenIncident = IncidentLinkData;

/** A row of the `/sites` list (spec §20). */
export interface SiteListRow {
  id: string;
  name: string;
  tier: Tier;
  /** Monitoring started (false = a Draft). */
  live: boolean;
  client: { id: string; name: string; internal: boolean; amName: string | null };
  owner: { id: string; name: string } | null;
  backup: { id: string; name: string } | null;
  /** Latest status; null for a Draft or before the first round. */
  status: SiteStatus | null;
  checkedAt: string | null;
  /** The primary URL ("Visit site"). */
  url: string | null;
  /** Muted until (D-012); muted while it is in the future. */
  mutedUntil: string | null;
  openIncident: OpenIncident | null;
  locations: Record<ListLocation, LocationGlyph>;
  /** p50 of the primary monitor's passing checks over 24 h; null while down / in maintenance or with no data. */
  p50Ms: number | null;
  /** Uptime 30 d as a ratio (spec §5, window from monitoring start, D-031); null for a Draft never started. */
  uptime30d: number | null;
  /** Days to the sooner of SSL and domain expiry — S13; null until then. */
  expiryDays: number | null;
}

export interface ClientOption {
  id: string;
  name: string;
  internal: boolean;
  amName: string | null;
}

export interface PersonOption {
  id: string;
  name: string;
  /** Has a Google Chat id (D-015). */
  linked: boolean;
}

export interface ExistingUrl {
  url: string;
  siteId: string;
  siteName: string;
}

export interface RegistrationOptions {
  clients: ClientOption[];
  people: PersonOption[];
  existingUrls: ExistingUrl[];
}

export interface MonitorRecord {
  id: string;
  isPrimary: boolean;
  url: string;
  method: 'GET' | 'HEAD';
  timeoutSec: number;
  mustContain: string[];
  mustNotContain: string[];
  allowedRedirectDomains: string[];
  /** Null = the tier's default. */
  slowMs: number | null;
  headers: MonitorHeader[];
  enabled: boolean;
}

export interface SiteRecord {
  id: string;
  name: string;
  tier: Tier;
  clientId: string;
  primaryOwnerId: string | null;
  backupOwnerId: string | null;
  ownerName: string | null;
  backupName: string | null;
  hosting: string;
  credentialRef: string;
  behindWaf: boolean;
  wafAllowlistConfirmed: boolean;
  live: boolean;
  /** Was started at least once (it has, or may have, monitoring history). */
  everStarted: boolean;
  monitors: MonitorRecord[];
}

/** What a Sites action answers: field errors go next to their field, `message` above the form. */
export type SiteActionResult =
  { ok: true; siteId: string } | { ok: false; message: string; fieldErrors?: Record<string, string> };

/** One location's Test check result (nothing stored). */
export interface TestCheckResult {
  location: 'SIN' | 'TYO';
  outcome: 'pass' | 'fail' | 'blocked' | 'refused';
  statusCode: number | null;
  responseMs: number | null;
  keywordMissing: string[] | null;
  keywordForbidden: string[] | null;
  error: string | null;
}

/** One location's latest check on Site detail (the Latest round card). */
export interface RoundCheck {
  location: ListLocation;
  glyph: LocationGlyph;
  outcome: 'pass' | 'fail' | 'blocked';
  statusCode: number | null;
  responseMs: number | null;
  checkedAt: string;
}

/** A row of the Monitors table on Site detail. */
export interface DetailMonitor {
  id: string;
  isPrimary: boolean;
  /** Path shown in the Target column ("/", "/booking"). */
  target: string;
  assertions: string;
  status: SiteStatus | null;
  cause: string | null;
  lastMs: number | null;
}

/** A row of Incident history (90 days). */
export interface DetailIncident {
  id: string;
  number: number;
  startedAt: string;
  /** Minutes down or with a problem (its drops); null while still open. */
  minutes: number | null;
  open: boolean;
  /** The cause worded when it opened, if stored. */
  cause: string | null;
  trigger: Trigger;
  severity: Severity;
  state: IncidentState;
  level: number;
}

/** A row of the Check log. */
export interface CheckLogRow {
  id: string;
  checkedAt: string;
  location: string;
  outcome: 'pass' | 'fail' | 'blocked';
  statusCode: number | null;
  responseMs: number | null;
  ttfbMs: number | null;
  error: string | null;
}

/** `/sites/[siteId]` (boards SiteDetail, MSite). */
export interface SiteDetail {
  id: string;
  name: string;
  tier: Tier;
  live: boolean;
  status: SiteStatus | null;
  statusSince: string | null;
  url: string | null;
  client: { name: string; internal: boolean; amName: string | null };
  owner: string | null;
  backup: string | null;
  /** Owner and backup profile ids (who may mute, S09). */
  ownerIds: string[];
  /** The primary monitor's slow limit (its own or the tier's). */
  slowMs: number;
  hosting: string | null;
  credentialRef: string | null;
  mutedUntil: string | null;
  openIncident: OpenIncident | null;
  /** The open incident's trigger (S09d: the header names a Page change, spec §26.8). */
  openTrigger: Trigger | null;
  stats: {
    uptime: number | null;
    p50: number | null;
    p95: number | null;
    incidents: number;
    caption: string;
  };
  chart: Record<ListLocation, { t: number; ms: number | null }[]>;
  chartFrom: number;
  chartTo: number;
  round: RoundCheck[];
  monitors: DetailMonitor[];
  history: DetailIncident[];
  /** Incidents in the last 90 days (may be more than `history` holds). */
  historyCount: number;
  /** Incidents overlapping the range (the phone list and the Incidents stat). */
  rangeIncidents: DetailIncident[];
  historyMttr: number | null;
  log: CheckLogRow[];
  checksToday: number;
}
