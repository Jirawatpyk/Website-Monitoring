/**
 * The Expiry page (board Expiry, spec §14.12, §15.8; S13, D-066) as pure words and numbers, so the
 * rules have tests: days left in Bangkok calendar days, the day tone, the certificate's kind, the KPIs.
 */
import { EXPIRY_FRESH_MS } from '@dxt/engine';
import { expiryCounts, formatDay, formatTime, formatWhen, type ExpiryCount } from '@dxt/shared';

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
  /** When the site was added: the meta line names a new one ("added today 08:40"). */
  created_at?: string;
}

/** Red under the alert line, amber when due soon, plain otherwise; `none` when there is no date. */
export type DayTone = 'alert' | 'soon' | 'plain' | 'none';

export interface ExpiryHalf {
  /** "19 Nov 2026", or null when it never read. */
  date: string | null;
  days: number | null;
  tone: DayTone;
  /** The latest read failed: the page says "Couldn't read" with this, the last good date greyed. */
  error: string | null;
  /**
   * The date is evidence now — the latest read good and the last good one within 36 h — so under the
   * alert line it would open a PROBLEM (D-066 item 3, the engine's own rule).
   */
  evidence: boolean;
}

export interface ExpiryRowView {
  siteId: string;
  name: string;
  ssl: ExpiryHalf;
  /** "Auto-renew · 90 d", "Paid · 1 year", "Renewed Thu · 90 d"; null without a certificate. */
  certificate: string | null;
  domain: ExpiryHalf;
  /** A good half under 60 days (an auto-renew certificate under 30) or under its alert line. */
  soon: boolean;
  /** Not checked yet or couldn't read: nobody can say it is fine, so it sorts first (§39.4). */
  attention: boolean;
  /** Not checked yet › couldn't read › expired › due soon › OK: the Status column (§39.4). */
  status: 'unchecked' | 'failed' | 'expired' | 'soon' | 'ok';
  /** The sooner of the two good halves, for the sort (null last). */
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
  /** For the Sites list's phone row: halves due within 60 days, sites whose read failed. */
  summary: { due: number; failed: number; unchecked: number };
}

/**
 * A read failure in words (spec §13): the reader's own messages are already words; a socket code
 * (ECONNRESET) or an RDAP status (RDAP 503) is not.
 */
export function readWords(error: string): string {
  if (/^RDAP 5\d\d$|^WHOIS unreachable$/.test(error)) return 'Registry unavailable';
  if (/^RDAP \d{3}$/.test(error)) return 'Registry refused the lookup';
  if (/^E[A-Z_]+/.test(error) || /^Read failed$/.test(error)) return "Couldn't connect";
  return error;
}

function half(
  at: string | null,
  readAt: string | null,
  count: ExpiryCount | null,
  error: string | null,
  now: Date,
): ExpiryHalf {
  if (!at || !count) return { date: null, days: null, tone: 'none', error, evidence: false };
  // A failed or stale read still lists its last good date (due soon, the filter), but it can't open
  // a PROBLEM, so it isn't counted under "Would open a PROBLEM".
  const evidence = !error && !!readAt && now.getTime() - Date.parse(readAt) <= EXPIRY_FRESH_MS;
  return {
    date: formatDay(new Date(at), { year: true }),
    days: count.days,
    tone: count.tone,
    error,
    evidence,
  };
}

/** A half that tells something now: a date whose latest read worked. */
const good = (h: ExpiryHalf) => h.days !== null && !h.error;
const due = (h: ExpiryHalf) => good(h) && (h.tone === 'alert' || h.tone === 'soon');

/**
 * The page's rows, KPIs and meta line (§39). Only live sites are listed (drafts aren't monitored).
 * Not checked yet and couldn't read come first, then soonest expiry. A failed half keeps its last
 * date, greyed, and counts nowhere until a read works.
 */
export function expiryView(
  records: readonly ExpiryRecord[],
  sites: readonly ExpirySiteRef[],
  now: Date,
): ExpiryData {
  const bySite = new Map(records.map((r) => [r.site_id, r]));
  const rows = sites.map((s): ExpiryRowView => {
    const r = bySite.get(s.id);
    const c = r ? expiryCounts(r, now) : { ssl: null, certificate: null, domain: null };
    const ssl = half(r?.ssl_expires_at ?? null, r?.ssl_read_at ?? null, c.ssl, r?.ssl_error ?? null, now);
    const domain = half(
      r?.domain_expires_at ?? null,
      r?.domain_read_at ?? null,
      c.domain,
      r?.domain_error ?? null,
      now,
    );
    const failed = !!ssl.error || !!domain.error;
    const unchecked = !failed && ssl.days === null && domain.days === null;
    const goodDays = [ssl, domain].filter(good).map((h) => h.days!);
    const soon = due(ssl) || due(domain);
    const expired = goodDays.some((d) => d < 0);
    return {
      siteId: s.id,
      name: s.name,
      ssl,
      certificate: c.certificate?.label ?? null,
      domain,
      soon,
      attention: unchecked || failed,
      status: unchecked ? 'unchecked' : failed ? 'failed' : expired ? 'expired' : soon ? 'soon' : 'ok',
      soonest: goodDays.length ? Math.min(...goodDays) : null,
    };
  });
  rows.sort(
    (a, b) =>
      Number(b.attention) - Number(a.attention) ||
      (a.soonest ?? Number.POSITIVE_INFINITY) - (b.soonest ?? Number.POSITIVE_INFINITY) ||
      a.name.localeCompare(b.name),
  );

  // "Would open a PROBLEM": under the alert line on a read that is evidence now (D-066 item 3).
  const alerting = (kind: 'ssl' | 'domain') =>
    rows.filter((r) => r[kind].tone === 'alert' && r[kind].evidence && good(r[kind]));
  const caption = (list: ExpiryRowView[], kind: 'ssl' | 'domain', word: string) => {
    const gone = list.filter((r) => r[kind].days! < 0);
    if (!gone.length) return 'Would open a PROBLEM';
    const rest = list.length - gone.length;
    return [
      ...gone.map((r) => `${r.name} ${word} expired`),
      ...(rest ? [`${rest} would open a PROBLEM`] : []),
    ].join(' · ');
  };
  const ssl14 = alerting('ssl');
  const dom30 = alerting('domain');
  // An expired half is named under its alert card, not repeated here (§39.4).
  const soonList: { name: string; kind: 'SSL' | 'domain'; days: number }[] = [];
  for (const r of rows) {
    if (due(r.ssl) && r.ssl.days! >= 0) soonList.push({ name: r.name, kind: 'SSL', days: r.ssl.days! });
    if (due(r.domain) && r.domain.days! >= 0)
      soonList.push({ name: r.name, kind: 'domain', days: r.domain.days! });
  }
  soonList.sort((a, b) => a.days - b.days);
  const kpis: ExpiryKpi[] = [
    { label: 'SSL under 14 days', value: String(ssl14.length), caption: caption(ssl14, 'ssl', 'SSL') },
    {
      label: 'Domains under 30 days',
      value: String(dom30.length),
      caption: caption(dom30, 'domain', 'domain'),
    },
    {
      label: 'Due within 60 days',
      value: String(soonList.length),
      unit: soonList.length === 1 ? 'item' : 'items',
      caption: soonList.length
        ? soonList.map((d) => `${d.name} ${d.kind} ${d.days}\u00a0d`).join(' · ')
        : 'Nothing due',
    },
  ];

  const live = new Set(sites.map((s) => s.id));
  const mine = records.filter((r) => live.has(r.site_id));
  const checked = mine
    .flatMap((r) => [r.ssl_checked_at, r.domain_checked_at])
    .filter((v): v is string => !!v)
    .sort()
    .at(-1);
  // A site served without TLS has no certificate to read (checked, no date, no error): one half only.
  const byId = new Map(mine.map((r) => [r.site_id, r]));
  const noTls = sites.filter((s) => {
    const r = byId.get(s.id);
    return !!r && !r.ssl_checked_at && !r.ssl_error && !!r.domain_checked_at;
  }).length;
  // A hosting platform's subdomain has no domain of its own (the read leaves the half empty, unchecked).
  const noDomain = sites.filter((s) => {
    const r = byId.get(s.id);
    return !!r && !r.domain_checked_at && !r.domain_error && !!r.ssl_checked_at;
  }).length;
  const halves = sites.length * 2 - noTls - noDomain;
  const read = mine.reduce(
    (n, r) => n + (r.ssl_read_at && !r.ssl_error ? 1 : 0) + (r.domain_read_at && !r.domain_error ? 1 : 0),
    0,
  );
  const failedHalves = mine.reduce((n, r) => n + (r.ssl_error ? 1 : 0) + (r.domain_error ? 1 : 0), 0);
  const fresh = rows.filter((r) => r.status === 'unchecked');
  const newSite = (r: ExpiryRowView) => {
    const at = sites.find((s) => s.id === r.siteId)?.created_at;
    return at
      ? `${r.name} not checked yet (added ${formatWhen(new Date(at), now, { midSentence: true })})`
      : `${r.name} not checked yet`;
  };
  const parts = [
    'Checked daily 06:00',
    checked
      ? `last check ${formatDay(new Date(checked), { weekday: true })} ${formatTime(new Date(checked))}`
      : 'not checked yet',
    `${read} of ${halves} read`,
    ...(failedHalves ? [`${failedHalves} couldn't be read`] : []),
    ...(checked && fresh.length === 1 ? [newSite(fresh[0]!)] : []),
    ...(checked && fresh.length > 1 ? [`${fresh.length} sites not checked yet`] : []),
  ];
  return {
    rows,
    kpis,
    meta: parts.join(' · '),
    certificates: sites.length - noTls,
    domains: sites.length - noDomain,
    summary: {
      due: soonList.length,
      failed: rows.filter((r) => r.status === 'failed').length,
      unchecked: fresh.length,
    },
  };
}

/**
 * The line under "SSL & domains" at the foot of the phone Sites list (MSites, §39.6): "2 due within
 * 60 days" (amber) or "Nothing due within 60 days", then in secondary "· 1 couldn't be read" and
 * "· 2 not checked yet" — a read that didn't happen is never amber (§39.4).
 */
export function expirySummaryLine(s: ExpiryData['summary']): { due: string | null; rest: string } {
  const extra = [
    ...(s.failed ? [`${s.failed} couldn't be read`] : []),
    ...(s.unchecked ? [`${s.unchecked} not checked yet`] : []),
  ];
  if (!s.due) return { due: null, rest: ['Nothing due within 60 days', ...extra].join(' · ') };
  return { due: `${s.due} due within 60 days`, rest: extra.map((e) => ` · ${e}`).join('') };
}

const halfWords = (kind: 'SSL' | 'domain', h: ExpiryHalf, unchecked: boolean) => {
  if (unchecked) return `${kind} not checked yet`;
  if (h.error) return `${kind} couldn't be read, ${readWords(h.error)}${h.date ? `, last ${h.date}` : ''}`;
  if (h.days === null || !h.date) return `${kind} —`;
  return `${kind} ${h.date}, ${h.days < 0 ? 'expired' : h.days === 1 ? '1 day' : `${h.days} days`}`;
};

/** A card's name for a screen reader (MExpiry): "Cando Asia, Due soon, SSL 19 Nov 2026, 55 days, domain 5 Nov 2026, 41 days". */
export function cardLabel(r: ExpiryRowView): string {
  const status = {
    unchecked: 'Not checked yet',
    failed: "Couldn't read",
    expired: 'Expired',
    soon: 'Due soon',
    ok: 'OK',
  }[r.status];
  const unchecked = r.status === 'unchecked';
  return [r.name, status, halfWords('SSL', r.ssl, unchecked), halfWords('domain', r.domain, unchecked)].join(
    ', ',
  );
}
