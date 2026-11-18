/**
 * The Expiry page (board Expiry, spec §14.12, §15.8; S13, D-066) as pure words and numbers, so the
 * rules have tests: days left in Bangkok calendar days, the day tone, the certificate's kind, the KPIs.
 */
import { certificateKind, daysLeft, formatDay, formatTime, isDueSoon, isExpiryAlert } from '@dxt/shared';

/** One `site_expiry` row, as the page reads it. */
export interface ExpiryRecord {
  site_id: string;
  ssl_expires_at: string | null;
  ssl_valid_from: string | null;
  ssl_read_at: string | null;
  ssl_checked_at: string | null;
  ssl_error: string | null;
  domain_expires_at: string | null;
  domain_read_at: string | null;
  domain_checked_at: string | null;
  domain_error: string | null;
}

export interface ExpirySiteRef {
  id: string;
  name: string;
}

/** Red under the alert line, amber when due soon, plain otherwise; `none` when there is no date. */
export type DayTone = 'alert' | 'soon' | 'plain' | 'none';

export interface ExpiryHalf {
  /** "19 Nov 2026", or null when it never read. */
  date: string | null;
  days: number | null;
  tone: DayTone;
  /** The latest read failed: the page says "Couldn't read" with this in its tooltip. */
  error: string | null;
}

export interface ExpiryRowView {
  siteId: string;
  name: string;
  ssl: ExpiryHalf;
  /** "Auto-renew · 90 d", "Paid · 1 year", "Renewed Thu · 90 d"; null without a certificate. */
  certificate: string | null;
  domain: ExpiryHalf;
  soon: boolean;
  /** The sooner of the two, for the sort (null last). */
  soonest: number | null;
}

export interface ExpiryKpi {
  label: string;
  value: string;
  unit?: string;
  caption: string;
}

export interface ExpiryData {
  rows: ExpiryRowView[];
  kpis: ExpiryKpi[];
  /** "Checked daily 06:00 · last check Wed 18 Nov 06:00 · 34 of 34 read". */
  meta: string;
  /** Halves to read now (for "Checking 17 certificates and 17 domains now"). */
  certificates: number;
  domains: number;
}

const date = (v: string | null) => (v ? new Date(v) : null);

function half(
  kind: 'ssl' | 'domain',
  expiresAt: Date | null,
  error: string | null,
  now: Date,
  autoRenew = false,
): ExpiryHalf {
  if (!expiresAt) return { date: null, days: null, tone: 'none', error };
  const days = daysLeft(expiresAt, now);
  const tone: DayTone = isExpiryAlert(kind, days)
    ? 'alert'
    : isDueSoon(kind, days, autoRenew)
      ? 'soon'
      : 'plain';
  return { date: formatDay(expiresAt, { year: true }), days, tone, error };
}

/**
 * The page's rows, KPIs and meta line. Only live sites are listed (drafts aren't monitored); a site
 * with no row yet shows dashes until its first read. Soonest expiry first.
 */
export function expiryView(
  records: readonly ExpiryRecord[],
  sites: readonly ExpirySiteRef[],
  now: Date,
): ExpiryData {
  const bySite = new Map(records.map((r) => [r.site_id, r]));
  const rows = sites.map((s): ExpiryRowView => {
    const r = bySite.get(s.id);
    const sslAt = date(r?.ssl_expires_at ?? null);
    const from = date(r?.ssl_valid_from ?? null);
    const cert = sslAt && from ? certificateKind(from, sslAt, now) : null;
    const ssl = half('ssl', sslAt, r?.ssl_error ?? null, now, cert?.autoRenew ?? false);
    const domain = half('domain', date(r?.domain_expires_at ?? null), r?.domain_error ?? null, now);
    const days = [ssl.days, domain.days].filter((d): d is number => d !== null);
    return {
      siteId: s.id,
      name: s.name,
      ssl,
      certificate: cert?.label ?? null,
      domain,
      soon: ssl.tone === 'alert' || ssl.tone === 'soon' || domain.tone === 'alert' || domain.tone === 'soon',
      soonest: days.length ? Math.min(...days) : null,
    };
  });
  rows.sort(
    (a, b) =>
      (a.soonest ?? Number.POSITIVE_INFINITY) - (b.soonest ?? Number.POSITIVE_INFINITY) ||
      a.name.localeCompare(b.name),
  );

  const ssl14 = rows.filter((r) => r.ssl.tone === 'alert').length;
  const dom30 = rows.filter((r) => r.domain.tone === 'alert').length;
  const due: { name: string; days: number }[] = [];
  for (const r of rows) {
    if (r.ssl.days !== null && (r.ssl.tone === 'alert' || r.ssl.tone === 'soon'))
      due.push({ name: r.name, days: r.ssl.days });
    if (r.domain.days !== null && (r.domain.tone === 'alert' || r.domain.tone === 'soon'))
      due.push({ name: r.name, days: r.domain.days });
  }
  due.sort((a, b) => a.days - b.days);
  const kpis: ExpiryKpi[] = [
    { label: 'SSL under 14 days', value: String(ssl14), caption: 'Would open a PROBLEM' },
    { label: 'Domains under 30 days', value: String(dom30), caption: 'Would open a PROBLEM' },
    {
      label: 'Due within 60 days',
      value: String(due.length),
      unit: due.length === 1 ? 'item' : 'items',
      caption: due.length ? due.map((d) => `${d.name} ${d.days} d`).join(' · ') : 'Nothing due',
    },
  ];

  const live = new Set(sites.map((s) => s.id));
  const mine = records.filter((r) => live.has(r.site_id));
  const checked = mine
    .flatMap((r) => [r.ssl_checked_at, r.domain_checked_at])
    .filter((v): v is string => !!v)
    .sort()
    .at(-1);
  const halves = sites.length * 2;
  const read = mine.reduce(
    (n, r) => n + (r.ssl_read_at && !r.ssl_error ? 1 : 0) + (r.domain_read_at && !r.domain_error ? 1 : 0),
    0,
  );
  const last = checked
    ? ` · last check ${formatDay(new Date(checked), { weekday: true })} ${formatTime(new Date(checked))}`
    : ' · not checked yet';
  return {
    rows,
    kpis,
    meta: `Checked daily 06:00${last} · ${read} of ${halves} read`,
    certificates: sites.length,
    domains: sites.length,
  };
}
