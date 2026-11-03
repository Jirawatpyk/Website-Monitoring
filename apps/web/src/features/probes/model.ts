import { MONITOR_GRACE_MS } from '@dxt/engine';
import { formatDuration, formatTime, PROBE_LOCATIONS, type ProbeLocation } from '@dxt/shared';

/**
 * The Probes & heartbeat page's rules (S12a, spec §14.4, §15.3, board Probes), pure so tests drive
 * them: each heartbeat's status from our own timestamps, the probe cards and the summary line.
 * Healthchecks.io is the outside voice; this page reads what the jobs stamped in our database.
 */

/** A job's last beat is older than its period + grace: what Healthchecks would call down. */
export type BeatStatus = 'up' | 'down' | 'waiting';

export interface BeatRow {
  /** The Healthchecks check's name. */
  name: string;
  on: string;
  every: string;
  grace: string;
  /** Spec §15.3 / D-053: only the engine pages (Alerts Space @on-call); the rest email the Admins. */
  pages: boolean;
  lastAt: string | null;
  status: BeatStatus;
}

export interface BeatFacts {
  engineSweep: string | null;
  notifier: string | null;
  crawler: string | null;
  verifier: string | null;
  watchdog: string | null;
  locations: Partial<Record<ProbeLocation, string | null>>;
}

const MIN = 60_000;
const SPECS: {
  name: string;
  on: string;
  periodMin: number;
  graceMin: number;
  pages?: boolean;
  last: (f: BeatFacts) => string | null;
}[] = [
  { name: 'engine', on: 'Vercel Cron', periodMin: 1, graceMin: 3, pages: true, last: (f) => f.engineSweep },
  { name: 'notifier', on: 'Vercel Cron', periodMin: 1, graceMin: 3, last: (f) => f.notifier },
  { name: 'probe-bkk', on: 'Thai VPS', periodMin: 1, graceMin: 3, last: (f) => f.locations.BKK ?? null },
  { name: 'probe-sin', on: 'Vercel · sin1', periodMin: 1, graceMin: 3, last: (f) => f.locations.SIN ?? null },
  { name: 'probe-tyo', on: 'Vercel · hnd1', periodMin: 1, graceMin: 3, last: (f) => f.locations.TYO ?? null },
  { name: 'browser-verifier', on: 'Thai VPS', periodMin: 1, graceMin: 3, last: (f) => f.verifier },
  { name: 'vps-watchdog', on: 'Thai VPS', periodMin: 1, graceMin: 3, last: (f) => f.watchdog },
  { name: 'crawler', on: 'Vercel Cron · sin1', periodMin: 30, graceMin: 15, last: (f) => f.crawler },
];

const every = (min: number) => (min === 1 ? '1 min' : formatDuration(min));

export function beatRowsOf(f: BeatFacts, now: Date): BeatRow[] {
  return SPECS.map((s) => {
    const lastAt = s.last(f);
    // The engine's rule (D-053): a minute check is missed 3 min after its last beat, as the cards and
    // the Overview say; a longer period adds what it has beyond a minute (crawler: 30 + 15 → 44 min).
    const late = lastAt
      ? now.getTime() - new Date(lastAt).getTime() >= (s.periodMin - 1 + s.graceMin) * MIN
      : false;
    return {
      name: s.name,
      on: s.on,
      every: every(s.periodMin),
      grace: formatDuration(s.graceMin),
      pages: !!s.pages,
      lastAt,
      status: !lastAt ? 'waiting' : late ? 'down' : 'up',
    };
  });
}

/** "12 s ago" up to a minute, then "4 min ago" / "1 h 2 min ago" / "1 d 2 h ago" (§13 durations). */
export function agoText(iso: string, now: Date): string {
  const ms = Math.max(0, now.getTime() - new Date(iso).getTime());
  if (ms < MIN) return `${Math.floor(ms / 1000)} s ago`;
  return `${formatDuration(ms / MIN)} ago`;
}

export const LOCATION_FACTS: Record<ProbeLocation, { city: string; host: string; egress: string }> = {
  BKK: { city: 'Bangkok', host: 'Thai VPS · systemd worker', egress: 'Fixed · allowlist' },
  SIN: { city: 'Singapore', host: 'Vercel function · sin1', egress: 'Dynamic · UA + header' },
  TYO: { city: 'Tokyo', host: 'Vercel function · hnd1', egress: 'Dynamic · UA + header' },
};

export interface ProbeCard {
  code: ProbeLocation;
  city: string;
  host: string;
  egress: string;
  lastRunAt: string | null;
  healthy: boolean;
  /** Results in the last complete hour ÷ 60, "8.7"; null with none. */
  rate: string | null;
  /** "0", "1 · 4 min", "2 · 11 min". */
  gaps: string;
  /** Results written per hour, the last 24 h, oldest first (index 23 = this hour). */
  hours: number[];
  /** Same index: the hour holds a gap. */
  gapHours: boolean[];
}

export interface ActivityRow {
  location: string;
  hour: string;
  results: number;
}
export interface GapRow {
  location: string;
  gap_start: string;
  gap_end: string;
}

const HOUR = 60 * MIN;

export function probeCardsOf(
  activity: readonly ActivityRow[],
  gaps: readonly GapRow[],
  lastBeat: Partial<Record<ProbeLocation, string | null>>,
  now: Date,
): ProbeCard[] {
  const thisHour = Math.floor(now.getTime() / HOUR) * HOUR;
  const slot = (iso: string) =>
    23 - Math.round((thisHour - Math.floor(new Date(iso).getTime() / HOUR) * HOUR) / HOUR);
  return PROBE_LOCATIONS.map((code) => {
    const hours = Array.from({ length: 24 }, () => 0);
    for (const a of activity) {
      const i = slot(a.hour);
      if (a.location === code && i >= 0 && i < 24) hours[i] = a.results;
    }
    const lastRunAt = lastBeat[code] ?? null;
    const silent = !lastRunAt || now.getTime() - new Date(lastRunAt).getTime() >= MONITOR_GRACE_MS;
    // A silence still going on is a gap too (the SQL lists only closed ones).
    const mine = [
      ...gaps.filter((g) => g.location === code),
      ...(silent && lastRunAt ? [{ location: code, gap_start: lastRunAt, gap_end: now.toISOString() }] : []),
    ];
    const gapHours = Array.from({ length: 24 }, () => false);
    let minutes = 0;
    for (const g of mine) {
      minutes += (new Date(g.gap_end).getTime() - new Date(g.gap_start).getTime()) / MIN;
      for (let i = Math.max(0, slot(g.gap_start)); i <= Math.min(23, slot(g.gap_end)); i++)
        gapHours[i] = true;
    }
    const lastFull = hours[22] ?? 0;
    return {
      code,
      ...LOCATION_FACTS[code],
      lastRunAt,
      healthy: !silent,
      rate: lastFull ? (lastFull / 60).toFixed(1) : null,
      gaps: mine.length ? `${mine.length} · ${formatDuration(minutes)}` : '0',
      hours,
      gapHours,
    };
  });
}

/** A probe_location_missing alert (Admin-read): when the Admins' email went for a location. */
export interface MissingAlertRow {
  context: unknown;
  opened_at: string;
}

/**
 * The 24 h gaps as lines, newest first (§15.3): "SIN reported nothing 03:12–03:16 (4 min) → one email to
 * the Admins at 03:15, no page". The email part only when the alert is readable (Admins) and one opened
 * inside the gap; else nothing is claimed (none goes during an engine fault, D-053).
 */
export function gapLinesOf(
  gaps: readonly GapRow[],
  alerts: readonly MissingAlertRow[] | null = null,
): { at: string; text: string }[] {
  return [...gaps]
    .sort((a, b) => b.gap_end.localeCompare(a.gap_end))
    .map((g) => {
      const start = new Date(g.gap_start);
      const end = new Date(g.gap_end);
      const minutes = (end.getTime() - start.getTime()) / MIN;
      const mail = alerts?.find((a) => {
        const at = new Date(a.opened_at).getTime();
        const loc = (a.context as { location?: unknown } | null)?.location;
        return loc === g.location && at >= start.getTime() && at <= end.getTime();
      });
      const told = mail
        ? ` → one email to the Admins at ${formatTime(new Date(mail.opened_at))}, no page`
        : alerts
          ? ' → no email (the status engine was down, or another location was missing too)'
          : '';
      return {
        at: g.gap_end,
        text: `${g.location} reported nothing ${formatTime(start)}–${formatTime(end)} (${formatDuration(minutes)})${told}`,
      };
    });
}

/** The line at the top: healthy, or which heartbeats missed. */
export interface Summary {
  healthy: boolean;
  /** Nothing has pinged yet (a fresh environment): no claim either way. */
  empty?: boolean;
  title: string;
}

export function summaryOf(rows: readonly BeatRow[]): Summary {
  const counted = rows.filter((r) => r.status !== 'waiting');
  if (!counted.length) return { healthy: false, empty: true, title: 'No heartbeats yet' };
  const down = counted.filter((r) => r.status === 'down');
  if (!down.length)
    return {
      healthy: true,
      title: `Monitor healthy · ${counted.length}/${counted.length} heartbeats on time`,
    };
  return {
    healthy: false,
    title: `${down.length === 1 ? '1 heartbeat' : `${down.length} heartbeats`} missed · ${down.map((r) => r.name).join(', ')}`,
  };
}
