import { TIER_CONFIG, type Tier, type Trigger } from '@dxt/shared';
import type { Episode } from './lifecycle';
import type { Span } from './maintenance';
import { aggregateUptime, downMinutesIn, downMinutesInside, siteUptime, spanMinutesIn } from './uptime';

/**
 * The monthly client report (FR-15, S20, D-073): what a client sees of a month. Spec §5 for uptime
 * (DOWN minutes only, maintenance out of both sides), §12 for what is shown: DOWN → Outage (counted,
 * listed); slow / key page / regional (and intermittent, §6) → Degraded (listed, not counted); every
 * other PROBLEM is internal (neither listed nor drawn).
 */

const BANGKOK_MS = 7 * 3_600_000;
const DAY_MS = 86_400_000;

/** PROBLEM triggers a client sees as "Degraded" (spec §12, §6 D-050). */
export const CLIENT_DEGRADED_TRIGGERS: readonly Trigger[] = ['slow', 'key_page', 'regional', 'intermittent'];

export type ClientKind = 'outage' | 'degraded';
export type DayKind = ClientKind | 'ok' | 'none';

/**
 * How a client sees an incident (D-073 items 2–3): any DOWN drop in the month makes it an outage —
 * a hand-check DOWN too, and a PROBLEM that became DOWN; otherwise its PROBLEM trigger decides.
 */
export function clientKindOf(problemTrigger: Trigger, hasDown: boolean): ClientKind | null {
  if (hasDown) return 'outage';
  return CLIENT_DEGRADED_TRIGGERS.includes(problemTrigger) ? 'degraded' : null;
}

export interface ReportMonth {
  /** The month's first Bangkok midnight. */
  from: Date;
  /** The next month's first Bangkok midnight, or `now` while the month runs. */
  to: Date;
  running: boolean;
  /** Each day's Bangkok midnight, up to the last day that has begun. */
  days: Date[];
}

/** A calendar month in Bangkok (`YYYY-MM`), cut at `now` while it runs. */
export function bangkokMonth(month: string, now: Date): ReportMonth {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const from = new Date(Date.UTC(y, m - 1, 1) - BANGKOK_MS);
  const end = new Date(Date.UTC(y, m, 1) - BANGKOK_MS);
  const running = now < end;
  const to = running ? now : end;
  const days: Date[] = [];
  // Every day of the month: in a running month the days still to come are drawn empty.
  for (let t = from.getTime(); t < end.getTime(); t += DAY_MS) days.push(new Date(t));
  return { from, to, running, days };
}

export interface ReportIncidentInput {
  number: number;
  /** The incident's drops (`episodesOf`). */
  episodes: readonly Episode[];
  /** What its PROBLEM drops were about: the cause in progress, else the opening trigger. */
  problemTrigger: Trigger;
  rootCauseCategory: string | null;
}

export interface ReportSiteInput {
  name: string;
  tier: Tier;
  monitoringStartedAt: Date | null;
  maintenance: readonly Span[];
  incidents: readonly ReportIncidentInput[];
}

export interface ReportIncidentLine {
  number: number;
  kind: ClientKind;
  startedAt: Date;
  /** Started before the month (the minutes are only the month's). */
  startedBefore: boolean;
  /** An outage's DOWN minutes, a degraded's PROBLEM minutes, inside the month. */
  minutes: number;
  /** Still failing at the report's end. */
  open: boolean;
  rootCauseCategory: string | null;
}

export interface SiteMonthReport {
  name: string;
  tier: Tier;
  /** Null when the site wasn't monitored at all in the month. */
  uptime: number | null;
  downMinutes: number;
  windowMinutes: number;
  maintenanceMinutes: number;
  /** Its tier's target (D-073 item 5); null without figures. */
  metTarget: boolean | null;
  incidents: ReportIncidentLine[];
  /** One cell per day: its worst client-visible event, and a cap when maintenance touched it. */
  days: { kind: DayKind; maintenance: boolean }[];
}

const overlaps = (e: Episode, a: number, b: number, to: Date) =>
  e.start.getTime() < b && (e.end ?? to).getTime() > a;

function clipMinutes(eps: readonly Episode[], from: Date, to: Date): number {
  let ms = 0;
  for (const e of eps) {
    const a = Math.max(e.start.getTime(), from.getTime());
    const b = Math.min((e.end ?? to).getTime(), to.getTime());
    if (b > a) ms += b - a;
  }
  return Math.round(ms / 60_000);
}

/** One site's month (spec §5, §12; D-073). */
export function siteMonth(site: ReportSiteInput, month: ReportMonth): SiteMonthReport {
  const start = site.monitoringStartedAt;
  const from = start && start > month.from ? start : month.from;
  const watched = start !== null && start < month.to;
  const windowMinutes = watched ? (month.to.getTime() - from.getTime()) / 60_000 : 0;

  // D-073 item 4: a false alarm is left out of the report, minutes and all.
  const counted = site.incidents.filter((i) => i.rootCauseCategory !== 'false_alarm');
  const inMonth = (e: Episode) => overlaps(e, from.getTime(), month.to.getTime(), month.to);

  const lines: ReportIncidentLine[] = [];
  const outageDrops: Episode[] = [];
  const degradedDrops: Episode[] = [];
  for (const inc of counted) {
    const drops = inc.episodes.filter(inMonth);
    if (!drops.length) continue;
    const downs = drops.filter((e) => e.severity === 'down');
    const kind = clientKindOf(inc.problemTrigger, downs.length > 0);
    if (!kind) continue;
    const mine = kind === 'outage' ? downs : drops.filter((e) => e.severity === 'problem');
    (kind === 'outage' ? outageDrops : degradedDrops).push(...mine);
    // An outage's PROBLEM drops of a client-visible cause still colour their days amber.
    if (kind === 'outage' && CLIENT_DEGRADED_TRIGGERS.includes(inc.problemTrigger))
      degradedDrops.push(...drops.filter((e) => e.severity === 'problem'));
    const first = mine.reduce((a, b) => (b.start < a.start ? b : a));
    const last = inc.episodes.reduce((a, b) => (b.start > a.start ? b : a));
    lines.push({
      number: inc.number,
      kind,
      startedAt: first.start,
      startedBefore: first.start < from,
      minutes: clipMinutes(mine, from, month.to),
      open: last.end === null || last.end > month.to,
      rootCauseCategory: inc.rootCauseCategory,
    });
  }
  lines.sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime());

  const maintenanceMinutes = watched ? spanMinutesIn(site.maintenance, from, month.to) : 0;
  const downMinutes = watched
    ? Math.round(
        downMinutesIn(outageDrops, from, month.to) -
          downMinutesInside(outageDrops, site.maintenance, from, month.to),
      )
    : 0;
  const uptime = watched ? siteUptime({ windowMinutes, downMinutes, maintenanceMinutes }) : null;

  const minutesInside = (e: Episode, a: number, b: number) =>
    spanMinutesIn(
      site.maintenance.map((s) => ({
        start: new Date(Math.max(s.start.getTime(), e.start.getTime())),
        end: new Date(Math.min(s.end.getTime(), (e.end ?? month.to).getTime())),
      })),
      new Date(a),
      new Date(b),
    );
  const days = month.days.map((d) => {
    const a = d.getTime();
    const b = Math.min(a + DAY_MS, month.to.getTime());
    const maintenance = b > a && site.maintenance.some((s) => s.start.getTime() < b && s.end.getTime() > a);
    if (!watched || b <= a || b <= from.getTime()) return { kind: 'none' as const, maintenance };
    // Only what fell outside maintenance colours a day (§5: maintenance isn't counted).
    const shows = (e: Episode) => clipMinutes([e], new Date(a), new Date(b)) > minutesInside(e, a, b);
    const kind: DayKind = outageDrops.some(shows) ? 'outage' : degradedDrops.some(shows) ? 'degraded' : 'ok';
    return { kind, maintenance };
  });

  return {
    name: site.name,
    tier: site.tier,
    uptime,
    downMinutes,
    windowMinutes,
    maintenanceMinutes,
    metTarget: uptime === null ? null : uptime >= TIER_CONFIG[site.tier].uptimeTarget,
    incidents: lines,
    days,
  };
}

export interface ClientMonthReport {
  /** Time-weighted across the client's watched sites; null when none was watched. */
  uptime: number | null;
  downMinutes: number;
  incidents: number;
  outages: number;
  degraded: number;
  open: number;
  /** Every watched site met its own target (D-073 item 5). */
  metTarget: boolean | null;
}

/** A client's month from its sites' (spec §5: all sites = time-weighted). */
export function clientMonth(sites: readonly SiteMonthReport[]): ClientMonthReport {
  const watched = sites.filter((s) => s.uptime !== null);
  const lines = sites.flatMap((s) => s.incidents);
  return {
    uptime: watched.length ? aggregateUptime(watched) : null,
    downMinutes: sites.reduce((n, s) => n + s.downMinutes, 0),
    incidents: lines.length,
    outages: lines.filter((l) => l.kind === 'outage').length,
    degraded: lines.filter((l) => l.kind === 'degraded').length,
    open: lines.filter((l) => l.open).length,
    metTarget: watched.length ? watched.every((s) => s.metTarget) : null,
  };
}
