/**
 * S13 (FR-11, D-066): SSL certificate and domain expiry as PROBLEM triggers. The primary monitor
 * carries its site's latest expiry read (`site_expiry`, read hourly by the sin1 cron); a passing round
 * raises `ssl` when the certificate has under 14 days left, else `domain` under 30, last in the
 * PROBLEM order. A read that failed, or whose last good read is over 36 h old, is no data: it never
 * opens one and holds an open one (as D-042).
 */
import { daysLeft, isExpiryAlert, type ProblemDetail } from '@dxt/shared';

/** A good read older than this is no data (the cron reads every site at least daily). */
export const EXPIRY_FRESH_MS = 36 * 60 * 60_000;

export interface ExpiryHalf {
  /** The last good read's date, null if it never read. */
  expiresAt: Date | null;
  /** When that good read was made. */
  readAt: Date | null;
  /** The latest attempt failed (the last good date may still be there). */
  failed: boolean;
}

export interface ExpiryFact {
  ssl: ExpiryHalf;
  domain: ExpiryHalf;
}

export type ExpiryKind = 'ssl' | 'domain';

/** The half's date when it is evidence now: read, the latest attempt good, within 36 h. */
function freshDate(h: ExpiryHalf | undefined, now: Date): { expiresAt: Date; readAt: Date } | null {
  if (!h?.expiresAt || !h.readAt || h.failed) return null;
  if (now.getTime() - h.readAt.getTime() > EXPIRY_FRESH_MS) return null;
  return { expiresAt: h.expiresAt, readAt: h.readAt };
}

/** The expiry PROBLEM a fresh read raises now — SSL first, then the domain — or null. */
export function expiryIssue(
  fact: ExpiryFact | undefined,
  now: Date,
): { trigger: ExpiryKind; detail: ProblemDetail; at: Date } | null {
  for (const kind of ['ssl', 'domain'] as const) {
    const d = freshDate(fact?.[kind], now);
    if (!d) continue;
    const days = daysLeft(d.expiresAt, now);
    if (isExpiryAlert(kind, days)) {
      return {
        trigger: kind,
        detail: { kind, expiresAt: d.expiresAt.toISOString(), daysLeft: days },
        at: d.readAt,
      };
    }
  }
  return null;
}

/** The half behind an open `ssl` / `domain` PROBLEM has no evidence now (failed, stale or missing). */
export function expiryNoData(fact: ExpiryFact | undefined, kind: ExpiryKind, now: Date): boolean {
  return freshDate(fact?.[kind], now) === null;
}
