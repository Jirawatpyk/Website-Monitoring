import 'server-only';
import { episodesFromTimeline, type Episode, type IncidentEventRow } from '@dxt/engine';
import { shortCause, type MonitorFacts, type ReportIncident, type ReportPerson } from '@dxt/notifier';
import { clockMinutes, TRIGGER_LABELS, type IncidentState, type Severity, type Trigger } from '@dxt/shared';

/**
 * Turning stored rows into what the reports say (S14, D-056) — pure, so the rules have tests:
 * which incidents a period lists and how long they were down, the engine's share of rounds.
 */

export interface IncidentRow {
  number: number;
  state: IncidentState;
  severity: Severity;
  trigger: Trigger;
  started_at: string;
  resolved_at: string | null;
  acked_at: string | null;
  escalation_level: number;
  client_updated_at: string | null;
  client_update_not_needed?: boolean | null;
  root_cause_category?: string | null;
  root_cause?: string | null;
  root_cause_fix?: string | null;
  site: { name: string; tier: number; owner: ReportPerson | null };
  acker: { display_name: string } | null;
  updater: { display_name: string } | null;
  events: readonly IncidentEventRow[];
}

const clipMinutes = (e: Episode, from: Date, to: Date, now: Date) => {
  const start = e.start < from ? from : e.start;
  const endAt = e.end ?? now;
  const end = endAt > to ? to : endAt;
  return end > start ? clockMinutes(start, end) : 0;
};

const ROOT_CAUSE_WORDS = 60;

/**
 * The root cause in a few words, as the board's "cert renewed", "provider reboot": what fixed it, else
 * what happened, cut at a word to about 60 characters. None while the category is unknown or unset.
 */
export function rootCauseOf(row: IncidentRow): string | null {
  if (!row.root_cause_category || row.root_cause_category === 'unknown') return null;
  const words = (row.root_cause_fix?.trim() || row.root_cause?.trim() || '').split(/\s+/).join(' ');
  if (!words) return null;
  const first = words.split(/(?<=[.!?])\s/)[0]!.replace(/[.!?]$/, '');
  if (first.length <= ROOT_CAUSE_WORDS) return first;
  const cut = first.slice(0, ROOT_CAUSE_WORDS);
  return `${cut.slice(0, cut.lastIndexOf(' ') > 20 ? cut.lastIndexOf(' ') : ROOT_CAUSE_WORDS)}…`;
}

const payloadOf = (e: IncidentEventRow) =>
  e.payload && typeof e.payload === 'object' ? (e.payload as Record<string, unknown>) : {};

/**
 * The cause of a drop of `severity`, in its short form ("Timeout ×2 · 504 ×1", "Slow, p50 5.8 s"): the
 * drop that started at `dropStart` (its opening event is the first one confirmed at or after it), or with
 * no `dropStart` the newest (the digest's "now" rows). Only events that opened a drop of that severity
 * count: a PROBLEM raised to DOWN is worded by its `escalated_to_down`, never by the PROBLEM's
 * `detected` (engine review S14, M1). Events are sorted here: the embed has no order.
 */
export function causeOf(row: IncidentRow, severity: Severity, dropStart?: Date): string {
  if (row.trigger === 'manual') return TRIGGER_LABELS.manual;
  const raised = row.events.some((e) => e.type === 'escalated_to_down');
  const opened = row.events
    .filter((e) => {
      if (e.type === 'escalated_to_down') return severity === 'down';
      if (e.type === 'relapsed') return payloadOf(e).severity === severity;
      if (e.type === 'detected') return (raised ? 'problem' : row.severity) === severity;
      return false;
    })
    .sort((a, b) => (a.at ?? '').localeCompare(b.at ?? ''));
  const pick = dropStart
    ? (opened.find((e) => !!e.at && new Date(e.at) >= dropStart) ?? opened.at(-1))
    : opened.at(-1);
  const p = pick ? payloadOf(pick) : {};
  if (severity === 'problem' && typeof p.summary === 'string' && p.summary.trim()) return p.summary.trim();
  if (severity === 'down' && typeof p.cause === 'string' && p.cause.trim()) return shortCause(p.cause);
  return severity === 'down' ? TRIGGER_LABELS.hard_fail : TRIGGER_LABELS[row.trigger];
}

/**
 * One incident as a report lists it, or null when none of its drops touch [from, to). An incident that
 * was ever DOWN in the period counts its DOWN drops only (as uptime does, §5); a DOWN counts once
 * however many times it flapped — `drops` says how often.
 */
export function reportIncident(
  row: IncidentRow,
  from: Date,
  to: Date,
  now: Date,
  inside: (at: Date) => boolean,
): ReportIncident | null {
  const all = episodesFromTimeline(row, row.events).filter((e) => e.start < to && (e.end ?? now) > from);
  if (!all.length) return null;
  const severity: 'down' | 'problem' = all.some((e) => e.severity === 'down') ? 'down' : 'problem';
  const drops = all
    .filter((e) => e.severity === severity)
    .sort((a, b) => a.start.getTime() - b.start.getTime());
  const first = drops[0]!;
  const last = drops.at(-1)!;
  return {
    site: row.site.name,
    number: row.number,
    severity,
    startedAt: first.start,
    startedBefore: first.start < from,
    minutes: drops.reduce((sum, e) => sum + clipMinutes(e, from, to, now), 0),
    drops: drops.length,
    failing: last.end === null,
    cause: causeOf(row, severity, first.start),
    outsideHours: !inside(first.start),
    rootCause: rootCauseOf(row),
    state: row.state,
    owner: row.site.owner,
    level: row.escalation_level,
    acked: row.acked_at && row.acker ? { by: row.acker.display_name, at: new Date(row.acked_at) } : null,
    clientUpdate:
      row.client_updated_at && row.updater && !row.client_update_not_needed
        ? { by: row.updater.display_name, at: new Date(row.client_updated_at) }
        : null,
  };
}

/**
 * "Monitor ran 99.7% of rounds on time": 1 − the engine's silences over 3 min / the period, counted from
 * when the record began (null before it did). Silences under the grace aren't gaps, so a sweep that ran
 * across a minute boundary costs nothing (db review S14, Medium).
 */
export function roundsOf(
  rows: readonly { first_minute: string | null; gap_start: string | null; gap_end: string | null }[],
  from: Date,
  to: Date,
): Pick<MonitorFacts, 'roundsShare' | 'engineGaps'> {
  const first = rows[0]?.first_minute ? new Date(rows[0].first_minute) : null;
  if (!first || first >= to) return { roundsShare: null, engineGaps: [] };
  const start = first > from ? first : from;
  const engineGaps = rows.flatMap((r) =>
    r.gap_start && r.gap_end ? [{ start: new Date(r.gap_start), end: new Date(r.gap_end) }] : [],
  );
  const total = to.getTime() - start.getTime();
  const silent = engineGaps.reduce(
    (s, g) => s + Math.max(0, g.end.getTime() - Math.max(g.start.getTime(), start.getTime())),
    0,
  );
  return { roundsShare: total > 0 ? Math.max(0, 1 - silent / total) : null, engineGaps };
}
