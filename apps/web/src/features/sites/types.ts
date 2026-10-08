import type { MonitorHeader, SiteStatus, Tier } from '@dxt/shared';

/** What one location's latest check looks like on the Sites list (spec §20, the §11 legend). */
export type LocationGlyph = 'pass' | 'fail' | 'blocked' | 'slow' | 'chain' | 'none';

export const LIST_LOCATIONS = ['BKK', 'SIN', 'TYO'] as const;
export type ListLocation = (typeof LIST_LOCATIONS)[number];

/** The open incident shown under a site's status (any state before Resolved). */
export interface OpenIncident {
  id: string;
  number: number;
  state: 'unacked' | 'escalated' | 'acknowledged' | 'monitoring' | 'needs_root_cause';
  level: number;
  detectedAt: string;
  ackedBy: string | null;
}

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
  /** p50 of the primary monitor over 24 h — S06 rollups; null until then. */
  p50Ms: number | null;
  /** Uptime 30 d as a ratio — S06 rollups; null until then. */
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
