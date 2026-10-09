import { isTlsChainError, type Role } from '@dxt/shared';
import type { ProbeHealth, ViewerKind } from './types';

/**
 * Pure helpers that turn query rows into the Overview's shape (D-032), apart from the queries so
 * tests can drive them.
 */

const BUCKET_MS = 15 * 60_000;
export const SERIES_POINTS = 96;

/**
 * Response 24h (§21.5): 96 closed 15-minute buckets ending at the current (open) one — a bucket
 * gains its point once it closes; no point for a bucket with no passing check (the line breaks) or
 * no check at all. `failed` marks buckets with a hard fail (Sparkline draws them only if asked).
 */
export function seriesOf(
  row: { bucket_starts: string[]; p50_ms: (number | null)[]; hard_fails: number[] } | undefined,
  now: Date,
): { series: (number | null)[]; failed: boolean[] } {
  const open = Math.floor(now.getTime() / BUCKET_MS) * BUCKET_MS;
  const first = open - SERIES_POINTS * BUCKET_MS;
  const series: (number | null)[] = Array.from({ length: SERIES_POINTS }, () => null);
  const failed: boolean[] = Array.from({ length: SERIES_POINTS }, () => false);
  row?.bucket_starts.forEach((start, n) => {
    const k = (new Date(start).getTime() - first) / BUCKET_MS;
    if (!Number.isInteger(k) || k < 0 || k >= SERIES_POINTS) return;
    series[k] = row.p50_ms[n] ?? null;
    failed[k] = (row.hard_fails[n] ?? 0) > 0;
  });
  return { series, failed };
}

/** p50 of the last round (§21.5): the median of each location's latest passing check. */
export function lastRoundP50(responseMs: readonly (number | null)[]): number | null {
  const v = responseMs.filter((x): x is number => x !== null).sort((a, b) => a - b);
  if (!v.length) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid]! : Math.round((v[mid - 1]! + v[mid]!) / 2);
}

/**
 * When a location's current TLS chain streak started: newest-first checks of one location, walked
 * back while each is a chain error. Null when the newest isn't one.
 */
export function chainStreakStart(
  newestFirst: readonly { checked_at: string; outcome: string; error: string | null }[],
): string | null {
  let start: string | null = null;
  for (const c of newestFirst) {
    if (c.outcome !== 'fail' || !isTlsChainError(c.error)) break;
    start = c.checked_at;
  }
  return start;
}

/**
 * The drop an open incident is in now (code review S06b): its newest `detected`, `escalated_to_down`
 * (D-021) or `relapsed` (D-004) event says when it started and why — not the incident's first drop.
 * A relapse carries its own `startedAt` and `severity`; an escalation is a DOWN from its
 * `downStartedAt` (the outage's first failed check, as uptime counts it, D-021); the first drop is the
 * incident's own start and severity.
 */
export function currentDrop(
  events: readonly { type: string; at: string; payload: unknown }[],
  incident: { startedAt: string; severity: 'down' | 'problem' },
): { startedAt: string; severity: 'down' | 'problem'; cause: string | null; summary: string | null } {
  const newest = [...events]
    .filter((e) => e.type === 'detected' || e.type === 'escalated_to_down' || e.type === 'relapsed')
    .sort((a, b) => b.at.localeCompare(a.at))[0];
  const p = (newest?.payload && typeof newest.payload === 'object' ? newest.payload : {}) as Record<
    string,
    unknown
  >;
  const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v : null);
  const base = { cause: text(p.cause), summary: text(p.summary) };
  if (!newest || newest.type === 'detected') {
    return { startedAt: incident.startedAt, severity: incident.severity, ...base };
  }
  if (newest.type === 'escalated_to_down') {
    return { startedAt: text(p.downStartedAt) ?? newest.at, severity: 'down', ...base };
  }
  const severity = p.severity === 'down' || p.severity === 'problem' ? p.severity : incident.severity;
  return { startedAt: text(p.startedAt) ?? newest.at, severity, ...base };
}

const PROBE_GRACE_MS = 3 * 60_000;
const VERIFIER_GRACE_MS = 2 * 60_000;

/**
 * The header pill (D-032): active locations that beat in the last 3 min; the verifier is offline
 * with no poll for 2 min (D-019), busy while jobs are queued or leased, otherwise idle.
 */
export function probeHealth(
  locations: readonly { code: string; is_active: boolean; last_heartbeat_at: string | null }[],
  verifierSeenAt: string | null,
  openJobs: number,
  now: Date,
): ProbeHealth {
  const order = ['BKK', 'SIN', 'TYO'];
  const active = locations.filter((l) => l.is_active);
  const beating = active
    .filter(
      (l) => l.last_heartbeat_at && now.getTime() - new Date(l.last_heartbeat_at).getTime() <= PROBE_GRACE_MS,
    )
    .map((l) => l.code)
    .sort((a, b) => order.indexOf(a) - order.indexOf(b));
  const verifier =
    !verifierSeenAt || now.getTime() - new Date(verifierSeenAt).getTime() > VERIFIER_GRACE_MS
      ? 'offline'
      : openJobs > 0
        ? 'busy'
        : 'idle';
  return { beating, total: active.length, verifier };
}

/** Who is looking (D-032): an AM is a stakeholder who manages at least one client; any other is the CEO. */
export function viewerKindOf(role: Role, managesClients: boolean): ViewerKind {
  if (role === 'admin' || role === 'responder' || role === 'viewer') return role;
  if (role === 'stakeholder') return managesClients ? 'am' : 'ceo';
  // a client account never reaches the app's pages (RLS, `is_staff`); read-only if it ever did
  return 'viewer';
}
