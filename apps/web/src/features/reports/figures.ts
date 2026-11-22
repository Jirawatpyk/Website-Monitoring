import { z } from 'zod';
import {
  bangkokMonth,
  clientKindOf,
  clientMonth,
  episodesFromTimeline,
  siteMonth,
  type CauseChange,
  type Span,
} from '@dxt/engine';
import { TRIGGERS, weightedMedian, type Severity, type Tier, type Trigger } from '@dxt/shared';

/**
 * A client's month as the report prints it (S20, FR-15, D-073): built from the database rows by the
 * engine's `siteMonth` / `clientMonth`, stored as `client_reports.figures` on the 1st and read back
 * by the page and the PDF. Kept forever (item 11), so it is versioned and parsed when read.
 */

const iso = z.iso.datetime({ offset: true });
const triggerSchema = z.enum(TRIGGERS);

const daySchema = z.object({
  kind: z.enum(['outage', 'degraded', 'ok', 'none']),
  maintenance: z.boolean(),
});

const incidentSchema = z.object({
  number: z.number().int(),
  site: z.string(),
  kind: z.enum(['outage', 'degraded']),
  startedAt: iso,
  startedBefore: z.boolean(),
  minutes: z.number().int().nonnegative(),
  open: z.boolean(),
  /** The client-visible cause the line is worded by (a degraded line's PROBLEM). */
  trigger: triggerSchema,
  rootCauseCategory: z.string().nullable(),
  rootCause: z.string().nullable(),
});

const siteSchema = z.object({
  name: z.string(),
  tier: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  uptime: z.number().nullable(),
  downMinutes: z.number().int().nonnegative(),
  /** The watched minutes and the maintenance inside them: what the uptime is worked out over. */
  windowMinutes: z.number().nonnegative(),
  maintenanceMinutes: z.number().nonnegative(),
  metTarget: z.boolean().nullable(),
  p50: z.number().nullable(),
  p95: z.number().nullable(),
  days: z.array(daySchema),
});

export const reportFiguresSchema = z.object({
  v: z.literal(1),
  month: z.string(),
  from: iso,
  to: iso,
  running: z.boolean(),
  generatedAt: iso,
  client: z.object({ name: z.string(), am: z.string().nullable() }),
  uptime: z.number().nullable(),
  downMinutes: z.number().int().nonnegative(),
  outages: z.number().int().nonnegative(),
  degraded: z.number().int().nonnegative(),
  open: z.number().int().nonnegative(),
  metTarget: z.boolean().nullable(),
  p50: z.number().nullable(),
  /** Planned maintenance that touched the month on any of the client's sites, merged. */
  maintenance: z.array(z.object({ start: iso, end: iso })),
  sites: z.array(siteSchema),
  incidents: z.array(incidentSchema),
});

export type ReportFigures = z.infer<typeof reportFiguresSchema>;
export type ReportFiguresIncident = z.infer<typeof incidentSchema>;

/** A stored draft's figures, or null when they don't parse (an older shape; the page then says so). */
export function parseFigures(v: unknown): ReportFigures | null {
  const r = reportFiguresSchema.safeParse(v);
  return r.success ? r.data : null;
}

// ---- the rows the figures are built from (queries.ts loads them; RLS as staff, or the service role)

export interface FigureSite {
  id: string;
  name: string;
  tier: Tier;
  monitoringStartedAt: Date | null;
}

export interface FigureEvent {
  type: string;
  at: string;
  payload: unknown;
}

export interface FigureIncident {
  siteId: string;
  number: number;
  severity: Severity;
  trigger: Trigger;
  startedAt: string;
  resolvedAt: string | null;
  rootCauseCategory: string | null;
  rootCause: string | null;
  events: readonly FigureEvent[];
}

export interface FigureResponseDay {
  siteId: string;
  checks: number;
  p50: number | null;
  p95: number | null;
}

export interface FigureInputs {
  monthKey: string;
  now: Date;
  client: { name: string; am: string | null };
  sites: readonly FigureSite[];
  incidents: readonly FigureIncident[];
  maintenance: ReadonlyMap<string, readonly Span[]>;
  stopped: ReadonlyMap<string, readonly Span[]>;
  response: readonly FigureResponseDay[];
}

const isTrigger = (v: unknown): v is Trigger =>
  typeof v === 'string' && (TRIGGERS as readonly string[]).includes(v);

const payloadOf = (e: FigureEvent): Record<string, unknown> =>
  e.payload && typeof e.payload === 'object' ? (e.payload as Record<string, unknown>) : {};

/**
 * When each cause took over (D-067): `relapsed` and `new_cause` (written by both the new-cause and the
 * cause-back functions) carry the new trigger; `detected` carries it on newer rows only — before that,
 * the first change's `was` names the opening cause, else the incident's own trigger.
 */
export function causesOf(inc: FigureIncident): [CauseChange, ...CauseChange[]] {
  const sorted = [...inc.events].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const firstChange = sorted.find((e) => e.type === 'new_cause');
  const was = firstChange ? payloadOf(firstChange).was : undefined;
  const detected = sorted.find((e) => e.type === 'detected');
  const opening = detected ? payloadOf(detected).trigger : undefined;
  const first: CauseChange = {
    at: new Date(detected?.at ?? inc.startedAt),
    trigger: isTrigger(opening) ? opening : isTrigger(was) ? was : inc.trigger,
  };
  const rest: CauseChange[] = [];
  for (const e of sorted) {
    if (e.type !== 'relapsed' && e.type !== 'new_cause') continue;
    const t = payloadOf(e).trigger;
    if (isTrigger(t)) rest.push({ at: new Date(e.at), trigger: t });
  }
  return [first, ...rest];
}

/** The cause a degraded line is worded by: the latest client-visible one (D-073 item 3). */
function visibleTrigger(causes: readonly CauseChange[], kind: 'outage' | 'degraded'): Trigger {
  if (kind === 'outage') return 'hard_fail';
  const seen = causes.filter((c) => clientKindOf(c.trigger, false));
  return (seen.at(-1) ?? causes[0]!).trigger;
}

/** A client's month (D-073): the engine's figures plus the response medians (item 10). */
export function buildFigures(input: FigureInputs): ReportFigures {
  const month = bangkokMonth(input.monthKey, input.now);
  const byNumber = new Map(input.incidents.map((i) => [i.number, i] as const));
  const causesByNumber = new Map(input.incidents.map((i) => [i.number, causesOf(i)] as const));

  const sites = [...input.sites]
    .sort((a, b) => a.tier - b.tier || a.name.localeCompare(b.name))
    .map((s) => {
      const report = siteMonth(
        {
          name: s.name,
          tier: s.tier,
          monitoringStartedAt: s.monitoringStartedAt,
          maintenance: input.maintenance.get(s.id) ?? [],
          stopped: input.stopped.get(s.id) ?? [],
          incidents: input.incidents
            .filter((i) => i.siteId === s.id)
            .map((i) => ({
              number: i.number,
              episodes: episodesFromTimeline(
                { started_at: i.startedAt, severity: i.severity, resolved_at: i.resolvedAt },
                i.events.map((e) => ({ type: e.type, at: e.at, payload: e.payload as never })),
              ),
              causes: causesByNumber.get(i.number)!,
              rootCauseCategory: i.rootCauseCategory,
            })),
        },
        month,
      );
      const days = input.response.filter((r) => r.siteId === s.id);
      return {
        report,
        p50: weightedMedian(days.map((d) => [d.p50, d.checks])),
        p95: weightedMedian(days.map((d) => [d.p95, d.checks])),
      };
    });

  // a site stopped all month (or started after it) has nothing to report (D-073 items 6, 12)
  sites.splice(0, sites.length, ...sites.filter((s) => s.report.uptime !== null));
  const all = clientMonth(sites.map((s) => s.report));
  const incidents = sites
    .flatMap((s) =>
      s.report.incidents.map((line) => {
        const row = byNumber.get(line.number)!;
        return {
          number: line.number,
          site: s.report.name,
          kind: line.kind,
          startedAt: line.startedAt.toISOString(),
          startedBefore: line.startedBefore,
          minutes: line.minutes,
          open: line.open,
          trigger: visibleTrigger(causesByNumber.get(line.number)!, line.kind),
          rootCauseCategory: line.rootCauseCategory,
          rootCause: row.rootCause,
        };
      }),
    )
    .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));

  return {
    v: 1,
    month: input.monthKey,
    from: month.from.toISOString(),
    to: month.to.toISOString(),
    running: month.running,
    generatedAt: input.now.toISOString(),
    client: input.client,
    uptime: all.uptime,
    downMinutes: all.downMinutes,
    outages: all.outages,
    degraded: all.degraded,
    open: all.open,
    metTarget: all.metTarget,
    p50: weightedMedian(input.response.map((d) => [d.p50, d.checks])),
    maintenance: mergedSpans(
      input.sites.flatMap((s) => input.maintenance.get(s.id) ?? []),
      month.from,
      month.to,
    ),
    sites: sites.map(({ report, p50, p95 }) => ({
      name: report.name,
      tier: report.tier,
      uptime: report.uptime,
      downMinutes: report.downMinutes,
      windowMinutes: report.windowMinutes,
      maintenanceMinutes: report.maintenanceMinutes,
      metTarget: report.metTarget,
      p50,
      p95,
      days: report.days,
    })),
    incidents,
  };
}

/** Spans clipped to [from, to) and merged where they touch. */
function mergedSpans(spans: readonly Span[], from: Date, to: Date): { start: string; end: string }[] {
  const parts = spans
    .map((s) => [Math.max(s.start.getTime(), from.getTime()), Math.min(s.end.getTime(), to.getTime())])
    .filter(([a, b]) => b! > a!)
    .sort((x, y) => x[0]! - y[0]!) as [number, number][];
  const out: [number, number][] = [];
  for (const [a, b] of parts) {
    const last = out.at(-1);
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out.map(([a, b]) => ({ start: new Date(a).toISOString(), end: new Date(b).toISOString() }));
}

/** A visible incident has no root cause yet (or "Unknown"): the report can't go out (D-073 item 7). */
export function needsRootCause(f: ReportFigures): boolean {
  return f.incidents.some((i) => i.rootCauseCategory === null || i.rootCauseCategory === 'unknown');
}
