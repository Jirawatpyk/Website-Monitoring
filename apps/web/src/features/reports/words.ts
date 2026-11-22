import {
  formatDay,
  formatDuration,
  formatLocations,
  formatMs,
  formatPercent,
  formatTime,
  PROBE_LOCATIONS,
  TIER_CONFIG,
  type Trigger,
} from '@dxt/shared';
import { needsRootCause, type ReportFigures, type ReportFiguresIncident } from './figures';
import { monthLabel, nextMonth } from './month';

/**
 * The words of the Reports page and the monthly PDF (boards Reports, ReportPDF; spec §5, §12, §13,
 * §14.12), from one client's figures. Pure; the page and the PDF read the same figures.
 */

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** "1 outage, 1 degraded", "3 outages, 1 open", "1 degraded, open"; empty with none. */
export function incidentNote(f: Pick<ReportFigures, 'outages' | 'degraded' | 'open'>): string {
  const parts = [
    f.outages ? plural(f.outages, 'outage') : null,
    f.degraded ? `${f.degraded} degraded` : null,
  ].filter(Boolean);
  if (!parts.length) return '';
  if (f.open) parts.push(f.outages + f.degraded === 1 ? 'open' : `${f.open} open`);
  return parts.join(', ');
}

export const uptimeWord = (u: number | null): string => (u === null ? '—' : formatPercent(u));

/** "Target 99.9% met" when the sites share a tier; otherwise "Every site's target met" (D-073 item 5). */
export function targetWord(f: ReportFigures): string | null {
  if (f.metTarget === null) return null;
  const tiers = [...new Set(f.sites.filter((s) => s.uptime !== null).map((s) => s.tier))];
  const verb = f.metTarget ? 'met' : 'missed';
  if (tiers.length === 1) return `Target ${formatPercent(TIER_CONFIG[tiers[0]!].uptimeTarget)} ${verb}`;
  return f.metTarget ? 'Every site’s target met' : 'A site’s target missed';
}

/** What the client is told a degraded line was (spec §12); an outage is the site being down. */
const WHAT: Partial<Record<Trigger, string>> = {
  slow: 'slow to respond',
  key_page: 'a key page failed',
  regional: 'unreachable from one location',
  intermittent: 'intermittent timeouts',
};

export function whatWord(i: Pick<ReportFiguresIncident, 'kind' | 'trigger'>): string {
  return i.kind === 'outage' ? 'site down' : (WHAT[i.trigger] ?? 'degraded');
}

// ---- the Reports page row

export interface ReportRowWords {
  client: string;
  sites: number;
  /** The sites by name, for the phone sheet (MReports). */
  siteNames: string[];
  uptime: string;
  down: string;
  incidents: string;
  incidentNote: string;
  am: string;
  needsRootCause: boolean;
}

export function rowWords(f: ReportFigures): ReportRowWords {
  return {
    client: f.client.name,
    sites: f.sites.length,
    siteNames: f.sites.map((s) => s.name),
    uptime: uptimeWord(f.uptime),
    down: formatDuration(f.downMinutes),
    incidents: String(f.outages + f.degraded),
    incidentNote: incidentNote(f),
    am: f.client.am ?? '—',
    needsRootCause: needsRootCause(f),
  };
}

// ---- the PDF

const MONTH_SHORT = (d: Date) => formatDay(d).split(' ')[1]!.toUpperCase();

/** "1–31 AUG 2026", "1–25 SEP 2026" while the month runs. */
export function monthRangeWord(f: ReportFigures): string {
  const from = new Date(f.from);
  const last = new Date(Date.parse(f.to) - 1);
  const year = f.month.slice(0, 4);
  return `${formatDay(from).split(' ')[0]}–${formatDay(last).split(' ')[0]} ${MONTH_SHORT(from)} ${year}`;
}

/** "RPT-2608-BA": the month and the client's initials (ENEOS → ENE). */
export function reportId(f: ReportFigures): string {
  const words = f.client.name.match(/[A-Za-z0-9]+/g) ?? [];
  const code = words.length > 1 ? words.map((w) => w[0]).join('') : (words[0] ?? 'X').slice(0, 3);
  return `RPT-${f.month.slice(2, 4)}${f.month.slice(5, 7)}-${code.toUpperCase()}`;
}

const DAY_WORDS = { ok: 'Fully available', degraded: 'Degraded', outage: 'Outage', none: 'Not monitored' };

export interface PdfModel {
  title: string;
  eyebrow: string;
  client: string;
  meta: string;
  tiles: { label: string; value: string; caption: string; positive?: boolean; negative?: boolean }[];
  sites: {
    name: string;
    uptime: string;
    days: { kind: 'ok' | 'degraded' | 'outage' | 'none'; maintenance: boolean; label: string }[];
  }[];
  table: { name: string; uptime: string; down: string; p50: string; p95: string; incidents: string }[];
  incidents: {
    date: string;
    time: string;
    kind: 'outage' | 'degraded';
    kindWord: string;
    duration: string;
    line: string;
    cause: string;
  }[];
  measure: string;
  footer: string;
  header: string;
}

export function pdfModel(f: ReportFigures): PdfModel {
  const from = new Date(f.from);
  const label = monthLabel(f.month);
  const draft = f.running ? 'PREVIEW · ' : '';
  const outageSites = [...new Set(f.incidents.filter((i) => i.kind === 'outage').map((i) => i.site))];
  const watchedSites = f.sites.filter((s) => s.uptime !== null).length;
  const maint = f.maintenance.map(
    (m) => `${formatDay(new Date(m.start))} ${formatTime(new Date(m.start))}–${formatTime(new Date(m.end))}`,
  );
  return {
    title: `Monthly uptime report — ${f.client.name}, ${label}`,
    eyebrow: `${draft}MONTHLY UPTIME REPORT · ${monthRangeWord(f)} · THAILAND TIME (UTC+7)`,
    client: f.client.name,
    meta: [
      plural(f.sites.length, 'website'),
      'Prepared by DxT Solutions',
      f.client.am ? `Account manager: ${f.client.am}` : null,
    ]
      .filter(Boolean)
      .join(' · '),
    tiles: [
      {
        label: 'Overall uptime',
        value: uptimeWord(f.uptime),
        caption: targetWord(f) ?? 'Not monitored this month',
        positive: f.metTarget === true,
        negative: f.metTarget === false,
      },
      {
        label: 'Downtime',
        value: formatDuration(f.downMinutes),
        caption: f.outages
          ? `${plural(f.outages, 'outage')}${outageSites.length === 1 && f.sites.length > 1 ? `, ${outageSites[0]}` : ''}`
          : 'No outages',
      },
      {
        label: 'Incidents',
        value: String(f.outages + f.degraded),
        caption: incidentNote(f).split(', ').join(' · ') || 'None',
      },
      {
        label: 'Typical response',
        value: f.p50 === null ? '—' : formatMs(f.p50),
        // "Both sites, 3 locations" (the board), "From 3 locations" for one site
        caption: `${watchedSites > 1 ? `${watchedSites === 2 ? 'Both sites' : `All ${watchedSites} sites`},` : 'From'} ${formatLocations(PROBE_LOCATIONS.length)}`,
      },
    ],
    sites: f.sites.map((s) => ({
      name: s.name,
      uptime: uptimeWord(s.uptime),
      days: s.days.map((d, i) => {
        const day = new Date(from.getTime() + i * 86_400_000);
        return {
          ...d,
          label: `${formatDay(day, { weekday: true })} · ${DAY_WORDS[d.kind]}${d.maintenance ? ' · Planned maintenance (not counted)' : ''}`,
        };
      }),
    })),
    table: f.sites.map((s) => {
      const lines = f.incidents.filter((i) => i.site === s.name);
      const out = lines.filter((i) => i.kind === 'outage').length;
      const deg = lines.length - out;
      return {
        name: s.name,
        uptime: uptimeWord(s.uptime),
        down: formatDuration(s.downMinutes),
        p50: s.p50 === null ? '—' : formatMs(s.p50),
        p95: s.p95 === null ? '—' : formatMs(s.p95),
        incidents: incidentNote({ outages: out, degraded: deg, open: 0 }) || '—',
      };
    }),
    incidents: f.incidents.map((i) => {
      const at = new Date(i.startedAt);
      return {
        date: formatDay(at),
        time: `${formatTime(at)} (UTC+7)`,
        kind: i.kind,
        kindWord: i.kind === 'outage' ? 'Outage' : 'Degraded',
        duration: `${formatDuration(i.minutes)}${i.startedBefore ? ' this month' : ''}${i.open ? ' · still ongoing' : ''}`,
        line: `${i.site} — ${whatWord(i)}`,
        cause:
          i.rootCause?.trim() ||
          (i.kind === 'degraded'
            ? 'The site stayed up, so this does not reduce uptime.'
            : 'Root cause under review.'),
      };
    }),
    measure: [
      `Each website is checked every 1–5 minutes from Bangkok, Singapore and Tokyo. We count an outage only when at least 2 of 3 locations fail two checks in a row.`,
      `"Degraded" means the site stayed up but was slow, unreachable from one location, timing out now and then, or showed an error on a key page — it does not reduce uptime.`,
      maint.length
        ? `Planned maintenance (${plural(maint.length, 'window')}, ${maint.join(', ')}) is excluded.`
        : null,
    ]
      .filter(Boolean)
      .join(' '),
    footer: `DxT SOLUTIONS · REPORT ${reportId(f)} · ${draft}GENERATED ${formatDay(new Date(f.generatedAt), { year: true }).toUpperCase()} ${formatTime(new Date(f.generatedAt))}`,
    header: `${f.client.name} · ${label}`,
  };
}

// ---- the Reports page (spec §42 item 8)

/** The report's state on the page (page-data.ts). */
export type ReportStatus = 'draft' | 'not_drafted' | 'running' | 'unreadable';

/** The report status (spec §42 item 8): words and a tone, so the pill carries its icon too (§11). */
export const REPORT_STATUS: Record<ReportStatus, { words: string; tone: 'ready' | 'neutral' | 'warning' }> = {
  draft: { words: 'Draft ready', tone: 'ready' },
  not_drafted: { words: 'No draft yet', tone: 'neutral' },
  running: { words: 'Month running', tone: 'neutral' },
  unreadable: { words: 'Draft out of date', tone: 'warning' },
};

/** The sheet's line under the status, where it helps (MReports). */
export function statusNote(status: ReportStatus, month: string): string | null {
  if (status === 'running')
    return `Generated on demand from live figures — nothing is stored or sent until the 1 ${monthLabel(nextMonth(month), { short: true }).split(' ')[0]} draft.`;
  if (status === 'unreadable')
    return 'The stored draft is being made again — it refreshes on its own within a few minutes.';
  if (status === 'not_drafted')
    return 'Figures worked out now; the draft is made on its own within a few minutes.';
  return null;
}

/** "1 incident", "3 incidents" (MReports card). */
export const incidentsShort = (n: string) => `${n} incident${n === '1' ? '' : 's'}`;
