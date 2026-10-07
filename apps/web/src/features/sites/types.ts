import type { MonitorHeader, SiteStatus, Tier } from '@dxt/shared';

/** A row of the `/sites` table. */
export interface SiteListRow {
  id: string;
  name: string;
  tier: Tier;
  /** Monitoring started (false = a Draft). */
  live: boolean;
  client: { id: string; name: string; internal: boolean };
  owner: { id: string; name: string } | null;
  /** Latest status; null for a Draft or before the first round. */
  status: SiteStatus | null;
  checkedAt: string | null;
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
