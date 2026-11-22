import { TIER_CONFIG, clockMinutes, type Tier, type Trigger } from '@dxt/shared';
import type { Episode } from './lifecycle';
import type { Span } from './maintenance';
import { aggregateUptime } from './uptime';

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
 * How a client sees a stretch of an incident (D-073 items 2–3): a DOWN drop is an outage (a hand-check
 * DOWN too); a PROBLEM stretch is degraded when its cause is one a client sees, else internal.
 */
export function clientKindOf(trigger: Trigger, down: boolean): ClientKind | null {
  if (down) return 'outage';
  return CLIENT_DEGRADED_TRIGGERS.includes(trigger) ? 'degraded' : null;
}

export interface ReportMonth {
  /** The month's first Bangkok midnight. */
  from: Date;
  /** The next month's first Bangkok midnight, or `now` while the month runs. */
  to: Date;
  running: boolean;
  /** Every day's Bangkok midnight; in a running month the days still to come are drawn empty. */
  days: Date[];
}

/** A calendar month in Bangkok (`YYYY-MM`, validated by the caller), cut at `now` while it runs. */
export function bangkokMonth(month: string, now: Date): ReportMonth {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const from = new Date(Date.UTC(y, m - 1, 1) - BANGKOK_MS);
  const end = new Date(Date.UTC(y, m, 1) - BANGKOK_MS);
  const running = now < end;
  const to = running ? now : end;
  const days: Date[] = [];
  for (let t = from.getTime(); t < end.getTime(); t += DAY_MS) days.push(new Date(t));
  return { from, to, running, days };
}

/** When a cause took over in an incident: `detected`, `relapsed`, `new_cause`, `cause_back` (D-067). */
export interface CauseChange {
  at: Date;
  trigger: Trigger;
}

export interface ReportIncidentInput {
  number: number;
  /** The incident's drops, as `episodesFromTimeline` reads them (a resolve ends an open drop). */
  episodes: readonly Episode[];
  /**
   * Every cause with when it took over (any order; at least one). A drop's opening event may be stamped
   * when it was confirmed, after the drop began: the cause in force at a drop's confirm covers its start.
   */
  causes: readonly [CauseChange, ...CauseChange[]];
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
  /** Whole clock minutes of what the client sees, outside maintenance, inside the month (D-033). */
  minutes: number;
  /** The part the client sees is still going at the month's end (or now). */
  open: boolean;
  rootCauseCategory: string | null;
}

export interface SiteMonthReport {
  name: string;
  tier: Tier;
  /** Null when the site wasn't watched for any of the month. */
  uptime: number | null;
  /** The outage lines added up — the figure printed beside them. */
  downMinutes: number;
  windowMinutes: number;
  maintenanceMinutes: number;
  /** Its tier's target, judged on the exact uptime (D-073 item 5); null without figures. */
  metTarget: boolean | null;
  incidents: ReportIncidentLine[];
  /** One cell per day: its worst client-visible event, and a cap when maintenance touched it. */
  days: { kind: DayKind; maintenance: boolean }[];
}

interface Piece {
  kind: ClientKind;
  a: number;
  b: number;
  /** When the stretch began, before the month and maintenance cut it. */
  began: number;
  /** Still going past the report's end. */
  ongoing: boolean;
}

/** [a, b) minus the spans, as the parts left. */
function minus(a: number, b: number, spans: readonly Span[]): [number, number][] {
  let parts: [number, number][] = [[a, b]];
  for (const s of spans) {
    const sa = s.start.getTime();
    const sb = s.end.getTime();
    parts = parts.flatMap(([x, y]): [number, number][] =>
      sb <= x || sa >= y
        ? [[x, y]]
        : (
            [
              [x, sa],
              [sb, y],
            ] as [number, number][]
          ).filter(([p, q]) => q > p),
    );
  }
  return parts;
}

function mergedMs(spans: readonly Span[], a: number, b: number): number {
  const parts = spans
    .map((s): [number, number] => [Math.max(s.start.getTime(), a), Math.min(s.end.getTime(), b)])
    .filter(([x, y]) => y > x)
    .sort((x, y) => x[0] - y[0]);
  let ms = 0;
  let end = -Infinity;
  for (const [x, y] of parts) {
    if (y <= end) continue;
    ms += y - Math.max(x, end);
    end = y;
  }
  return ms;
}

/** The client-visible stretches of one incident inside [from, to), outside maintenance. */
function piecesOf(inc: ReportIncidentInput, from: number, to: number, maintenance: readonly Span[]): Piece[] {
  const causes = [...inc.causes].sort((x, y) => x.at.getTime() - y.at.getTime());
  const triggerAt = (t: number): Trigger => {
    let trig = causes[0]!.trigger;
    for (const c of causes) if (c.at.getTime() <= t) trig = c.trigger;
    return trig;
  };
  const out: Piece[] = [];
  for (const e of inc.episodes) {
    const ea = e.start.getTime();
    const eb = e.end?.getTime() ?? Infinity;
    if (e.severity === 'down') {
      out.push(...cut('outage', ea, eb));
      continue;
    }
    // A PROBLEM drop takes each cause in turn (D-067): only a client-visible cause is degraded. Its
    // opening cause is the one in force when it was confirmed (D-050 counts an intermittent "from the 1st").
    const confirmed = Math.max(ea, e.confirmedAt?.getTime() ?? ea);
    const changes = causes.map((c) => c.at.getTime()).filter((t) => t > confirmed && t < eb);
    const bounds = [ea, ...changes, eb];
    for (let i = 0; i + 1 < bounds.length; i++) {
      const sa = bounds[i]!;
      const sb = bounds[i + 1]!;
      if (clientKindOf(triggerAt(i === 0 ? confirmed : sa), false)) out.push(...cut('degraded', sa, sb));
    }
  }
  return out;

  function cut(kind: ClientKind, a: number, b: number): Piece[] {
    const ongoing = a < to && b > to;
    const ca = Math.max(a, from);
    const cb = Math.min(b, to);
    if (cb <= ca) return [];
    const parts = minus(ca, cb, maintenance);
    return parts.map(([x, y], i) => ({
      kind,
      a: x,
      b: y,
      began: a,
      ongoing: ongoing && i === parts.length - 1,
    }));
  }
}

/** Touching stretches as one, so a cause change inside a drop doesn't add a minute (D-033's floor of 1). */
function joined(pieces: readonly Piece[]): [number, number][] {
  const out: [number, number][] = [];
  for (const p of [...pieces].sort((x, y) => x.a - y.a)) {
    const last = out[out.length - 1];
    if (last && p.a <= last[1]) last[1] = Math.max(last[1], p.b);
    else out.push([p.a, p.b]);
  }
  return out;
}

/** One site's month (spec §5, §12; D-073). */
export function siteMonth(site: ReportSiteInput, month: ReportMonth): SiteMonthReport {
  const start = site.monitoringStartedAt;
  const fromMs = Math.max(month.from.getTime(), start?.getTime() ?? Infinity);
  const toMs = month.to.getTime();
  const watched = start !== null && toMs > fromMs;
  const windowMs = watched ? toMs - fromMs : 0;
  const maintenanceMs = watched ? mergedMs(site.maintenance, fromMs, toMs) : 0;

  const lines: ReportIncidentLine[] = [];
  const pieces: Piece[] = [];
  if (watched) {
    for (const inc of site.incidents) {
      // D-073 item 4: a false alarm is left out of the report, minutes and all (a category is set only
      // when the incident is resolved, or saved as Unknown).
      if (inc.rootCauseCategory === 'false_alarm') continue;
      const mine = piecesOf(inc, fromMs, toMs, site.maintenance);
      const kind: ClientKind | null = mine.some((p) => p.kind === 'outage')
        ? 'outage'
        : mine.length
          ? 'degraded'
          : null;
      if (!kind) continue;
      pieces.push(...mine);
      const shown = mine.filter((p) => p.kind === kind);
      // When what the client sees began, not the drop it sits in (an SSL drop's key-page stretch).
      const startedAt = new Date(Math.min(...shown.map((p) => p.began)));
      lines.push({
        number: inc.number,
        kind,
        startedAt,
        startedBefore: startedAt.getTime() < fromMs,
        minutes: joined(shown).reduce((n, [a, b]) => n + clockMinutes(new Date(a), new Date(b)), 0),
        // D-073 item 9: any client-visible stretch still going (a DOWN back up to a failing key page, D-023)
        open: mine.some((p) => p.ongoing),
        rootCauseCategory: inc.rootCauseCategory,
      });
    }
  }
  lines.sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime());

  const downMs = pieces.filter((p) => p.kind === 'outage').reduce((n, p) => n + (p.b - p.a), 0);
  const countedMs = windowMs - maintenanceMs;
  const uptime = !watched ? null : countedMs <= 0 ? 1 : 1 - Math.min(downMs, countedMs) / countedMs;

  const days = month.days.map((d) => {
    const a = d.getTime();
    const b = Math.min(a + DAY_MS, toMs);
    if (!watched || b <= a || b <= fromMs) return { kind: 'none' as const, maintenance: false };
    const maintenance = site.maintenance.some((s) => s.start.getTime() < b && s.end.getTime() > a);
    const on = (k: ClientKind) => pieces.some((p) => p.kind === k && p.a < b && p.b > a);
    const kind: DayKind = on('outage') ? 'outage' : on('degraded') ? 'degraded' : 'ok';
    return { kind, maintenance };
  });

  return {
    name: site.name,
    tier: site.tier,
    uptime,
    downMinutes: lines.filter((l) => l.kind === 'outage').reduce((n, l) => n + l.minutes, 0),
    windowMinutes: windowMs / 60_000,
    maintenanceMinutes: maintenanceMs / 60_000,
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
    uptime: watched.length
      ? aggregateUptime(
          watched.map((s) => ({
            windowMinutes: s.windowMinutes,
            maintenanceMinutes: s.maintenanceMinutes,
            // the exact DOWN share, so the client figure agrees with its sites' (D-073 item 9)
            downMinutes: (1 - s.uptime!) * (s.windowMinutes - s.maintenanceMinutes),
          })),
        )
      : null,
    downMinutes: sites.reduce((n, s) => n + s.downMinutes, 0),
    incidents: lines.length,
    outages: lines.filter((l) => l.kind === 'outage').length,
    degraded: lines.filter((l) => l.kind === 'degraded').length,
    open: lines.filter((l) => l.open).length,
    metTarget: watched.length ? watched.every((s) => s.metTarget) : null,
  };
}
