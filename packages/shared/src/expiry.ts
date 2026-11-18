/**
 * S13 (FR-11, D-066): SSL certificate and domain expiry — the thresholds and the days-left count every
 * surface shares (the engine's trigger, the Expiry page, the cause line, the weekly summary).
 */
import { bangkokDayStart, formatDay } from './format';

/** Under this many days left, a certificate opens PROBLEM "SSL expiring" (PRD §5). */
export const SSL_ALERT_DAYS = 14;
/** Under this many days left, a domain opens PROBLEM "Domain expiring" (PRD §5). */
export const DOMAIN_ALERT_DAYS = 30;
/** Listed as due soon (amber) under this many days: domains and paid certificates (spec §20, Expiry). */
export const DUE_SOON_DAYS = 60;
/** An auto-renewing certificate is due soon only under this many days (spec §14.12). */
export const AUTO_RENEW_SOON_DAYS = 30;
/** A certificate issued for at most this many days renews itself (Let's Encrypt, Google: 90). */
export const AUTO_RENEW_MAX_LIFETIME_DAYS = 100;
/** A certificate issued within this many days reads "Renewed {weekday}". */
export const RENEWED_RECENTLY_DAYS = 7;

const DAY_MS = 86_400_000;

/**
 * Days left = Bangkok calendar days from today to the expiry's Bangkok date (D-066 item 2): a
 * certificate that expires on 19 Nov has 55 days left on Fri 25 Sep, whatever the hour. Negative once
 * it is past.
 */
export function daysLeft(expiresAt: Date, now: Date): number {
  return Math.round((bangkokDayStart(expiresAt).getTime() - bangkokDayStart(now).getTime()) / DAY_MS);
}

export interface CertificateKind {
  /** Renews itself (a short-lived certificate): due soon only under 30 days. */
  autoRenew: boolean;
  /** "Auto-renew · 90 d", "Paid · 1 year", "Renewed Thu · 90 d" (D-066 item 5). */
  label: string;
}

/** What kind of certificate it is, read from the certificate itself (D-066 item 5). */
export function certificateKind(validFrom: Date, expiresAt: Date, now: Date): CertificateKind {
  const lifetime = Math.round((expiresAt.getTime() - validFrom.getTime()) / DAY_MS);
  const autoRenew = lifetime <= AUTO_RENEW_MAX_LIFETIME_DAYS;
  const length = autoRenew
    ? `${lifetime} d`
    : lifetime >= 360
      ? `${Math.round(lifetime / 365) || 1} year`
      : `${lifetime} d`;
  const issued = now.getTime() - validFrom.getTime();
  if (issued >= 0 && issued < RENEWED_RECENTLY_DAYS * DAY_MS) {
    const weekday = formatDay(validFrom, { weekday: true }).split(' ')[0];
    return { autoRenew, label: `Renewed ${weekday} · ${length}` };
  }
  return { autoRenew, label: autoRenew ? `Auto-renew · ${length}` : `Paid · ${length}` };
}

/** The days-left count is under its alert line: the PROBLEM's threshold. */
export function isExpiryAlert(kind: 'ssl' | 'domain', days: number): boolean {
  return days < (kind === 'ssl' ? SSL_ALERT_DAYS : DOMAIN_ALERT_DAYS);
}

/** Listed as due soon (amber): within 60 days, an auto-renewing certificate within 30 (§14.12). */
export function isDueSoon(kind: 'ssl' | 'domain', days: number, autoRenew = false): boolean {
  return days < (kind === 'ssl' && autoRenew ? AUTO_RENEW_SOON_DAYS : DUE_SOON_DAYS);
}

/** Red under the alert line, amber when due soon, plain otherwise. */
export type ExpiryTone = 'alert' | 'soon' | 'plain';

export interface ExpiryCount {
  days: number;
  tone: ExpiryTone;
}

/** The dates a `site_expiry` row holds (the last good read's, kept through a failed one). */
export interface ExpiryDates {
  ssl_expires_at: string | null;
  ssl_valid_from: string | null;
  domain_expires_at: string | null;
}

/**
 * Days left and tone for each half of a site's expiry — the Expiry page, the Sites list column and the
 * weekly "Coming up" lines read the same numbers. A half with no date is null.
 */
export function expiryCounts(
  r: ExpiryDates,
  now: Date,
): { ssl: ExpiryCount | null; certificate: CertificateKind | null; domain: ExpiryCount | null } {
  const count = (kind: 'ssl' | 'domain', at: string | null, autoRenew = false): ExpiryCount | null => {
    if (!at) return null;
    const days = daysLeft(new Date(at), now);
    const tone = isExpiryAlert(kind, days) ? 'alert' : isDueSoon(kind, days, autoRenew) ? 'soon' : 'plain';
    return { days, tone };
  };
  const certificate =
    r.ssl_expires_at && r.ssl_valid_from
      ? certificateKind(new Date(r.ssl_valid_from), new Date(r.ssl_expires_at), now)
      : null;
  return {
    ssl: count('ssl', r.ssl_expires_at, certificate?.autoRenew ?? false),
    certificate,
    domain: count('domain', r.domain_expires_at),
  };
}
