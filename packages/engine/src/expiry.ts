/**
 * S13 (FR-11, D-066): SSL certificate and domain expiry as PROBLEM triggers. The primary monitor
 * carries its site's latest expiry read (`site_expiry`, read hourly by the sin1 cron); a passing round
 * raises `ssl` when the certificate has under 14 days left, else `domain` under 30, last in the
 * PROBLEM order. A read that failed, or whose last good read is over 36 h old, is no data: it never
 * opens one and holds an open one (as D-042).
 */
import {
  bangkokDayStart,
  daysLeft,
  DOMAIN_ALERT_DAYS,
  isExpiryAlert,
  SSL_ALERT_DAYS,
  type ProblemDetail,
} from '@dxt/shared';

/** A good read older than this is no data (the cron reads every site at least daily). */
export const EXPIRY_FRESH_MS = 36 * 60 * 60_000;

export interface ExpiryHalf {
  /** The last good read's date, null if it never read. */
  expiresAt: Date | null;
  /** When that good read was made. */
  readAt: Date | null;
  /** The latest attempt failed (the last good date may still be there). */
  failed: boolean;
  /**
   * Nothing to read by definition: a site without TLS has no certificate, a hosting platform's
   * subdomain no domain (D-066 item 9). That is evidence of no expiry, so it ends an open one.
   */
  none?: boolean;
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
        // Since the line was crossed (the Bangkok day the count fell under it), never before the read.
        at: new Date(Math.max(d.readAt.getTime(), crossedAt(kind, d.expiresAt).getTime())),
      };
    }
  }
  return null;
}

/** Midnight Bangkok of the day the count first reads under the line (13 days left for SSL). */
function crossedAt(kind: ExpiryKind, expiresAt: Date): Date {
  const line = kind === 'ssl' ? SSL_ALERT_DAYS : DOMAIN_ALERT_DAYS;
  return new Date(bangkokDayStart(expiresAt).getTime() - (line - 1) * 86_400_000);
}

export const isExpiryTrigger = (t: string | null | undefined): t is ExpiryKind =>
  t === 'ssl' || t === 'domain';

/**
 * D-066 item 3 (engine review M2): a half with no evidence now — failed, stale or never read — whose
 * last good date is under its line may be what keeps the site in PROBLEM, so it can't end one. With no
 * row at all, only an open SSL / domain verdict on the primary is held.
 */
export function expiryUnknown(fact: ExpiryFact | undefined, carryTrigger: string | null, now: Date): boolean {
  if (!fact) return isExpiryTrigger(carryTrigger);
  return (['ssl', 'domain'] as const).some((k) => {
    const h = fact[k];
    if (h.none || freshDate(h, now)) return false;
    return h.expiresAt ? isExpiryAlert(k, daysLeft(h.expiresAt, now)) : carryTrigger === k;
  });
}
