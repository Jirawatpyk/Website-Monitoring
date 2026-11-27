import 'server-only';
import { episodesFromTimeline, type Episode, type IncidentEventRow } from '@dxt/engine';
import {
  expiryNow,
  shortCause,
  type MonitorFacts,
  type ReportIncident,
  type ReportExpiry,
  type ReportPerson,
} from '@dxt/notifier';
import {
  clockMinutes,
  expiryCounts,
  formatDay,
  TRIGGER_LABELS,
  type ExpiryDates,
  type IncidentState,
  type Severity,
  type Trigger,
} from '@dxt/shared';

/**
 * NEEDS SOMEONE rows for a DOWN back with something still failing (§19.7, WeeklyEmail §36.7): open, so
 * not in the "DOWN without a root cause" list, yet it needs someone while nobody has written why.
 */
export function stillFailingRows(list: readonly ReportIncident[]) {
  return list
    .filter((r) => r.stillProblem && !r.rootCause)
    .map((r) => ({
      kind: 'root_cause' as const,
      text: `${r.site} — still failing since ${formatDay(r.startedAt, { weekday: true })} (${r.stillProblem}), no root cause yet`,
      who: r.owner ? [r.owner] : [],
    }));
}

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
  preventive_action?: string | null;
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
  return fewWords(row.root_cause_fix?.trim() || row.root_cause?.trim() || '');
}

/** D-077: the preventive action for the weekly summary, cut like the root cause; null with none. */
export function preventionOf(row: IncidentRow): string | null {
  return fewWords(row.preventive_action?.trim() ?? '');
}

/** The first sentence, cut at a word to about 60 characters; null when empty. */
function fewWords(text: string): string | null {
  const words = text.split(/\s+/).join(' ');
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
export function causeOf(row: IncidentRow, severity: Severity, dropStart?: Date, now = new Date()): string {
  if (row.trigger === 'manual') return TRIGGER_LABELS.manual;
  const raised = row.events.some((e) => e.type === 'escalated_to_down');
  const opened = row.events
    .filter((e) => {
      if (e.type === 'escalated_to_down') return severity === 'down';
      if (e.type === 'relapsed') return payloadOf(e).severity === severity;
      if (e.type === 'detected') return (raised ? 'problem' : row.severity) === severity;
      // D-067: a new cause words the PROBLEM drop it joined from then on.
      if (e.type === 'new_cause') return severity === 'problem';
      return false;
    })
    .sort((a, b) => (a.at ?? '').localeCompare(b.at ?? ''));
  // The drop's opening event, then any new cause it took (D-067: message-checker M2 — the digest names
  // the defacement that took over, not the SSL it opened with).
  let at = dropStart ? opened.findIndex((e) => !!e.at && new Date(e.at) >= dropStart) : -1;
  if (at < 0) at = opened.length - 1;
  // A new cause names the drop, even once it went back to the expiry (the defacement was the news).
  let pickAt = at;
  while (dropStart && opened[at + 1]?.type === 'new_cause') {
    at += 1;
    // …and from one expiry to the other (SSL renewed, the domain still due — Tao, 17 Nov).
    const p = payloadOf(opened[at]!);
    if (p.back !== true || p.was === 'ssl' || p.was === 'domain') pickAt = at;
  }
  const pick = opened[pickAt];
  const p = pick ? payloadOf(pick) : {};
  // Reported down by hand (D-055 item 7): no probe cause, so never "Hard fail" (/verify S14).
  if (p.manual === true) return TRIGGER_LABELS.manual;
  // S13 (spec §36, D-066 item 2): "SSL expiring — 8 days left", counted at the report's time.
  // Counted to the recovery once it recovered: a renewed certificate never reads "expired".
  // The first `recovered` after the drop's opening event ends the count.
  const recoveredAt = row.events
    .filter((e) => e.type === 'recovered' && !!e.at && (!pick?.at || e.at >= pick.at))
    .map((e) => Date.parse(e.at!))
    .sort((a, b) => a - b)[0];
  const asOf = recoveredAt !== undefined ? new Date(Math.min(now.getTime(), recoveredAt)) : now;
  const expiry = severity === 'problem' ? expiryNow(p.detail, asOf) : null;
  if (expiry) return expiry.label;
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
  const timeline = episodesFromTimeline(row, row.events);
  const all = timeline.filter((e) => e.start < to && (e.end ?? now) > from);
  if (!all.length) return null;
  const severity: 'down' | 'problem' = all.some((e) => e.severity === 'down') ? 'down' : 'problem';
  const drops = all
    .filter((e) => e.severity === severity)
    .sort((a, b) => a.start.getTime() - b.start.getTime());
  const first = drops[0]!;
  const last = drops.at(-1)!;
  // §19.7 / D-023: the home page came back but something still fails — the DOWN minutes stand, and the
  // PROBLEM drop still open keeps it from reading as recovered — even one opened after the period ended
  // (Monday 05:00 before the 09:00 weekly), so the newest drop of the whole timeline.
  const open = timeline.at(-1)!;
  // A DOWN of an earlier week still failing this week shows only its PROBLEM drop here: the incident's
  // record says it came back from a DOWN (message-checker).
  const stillProblem =
    (severity === 'down' || row.severity === 'down') && open.severity === 'problem' && open.end === null
      ? causeOf(row, 'problem', open.start, now)
      : null;
  return {
    site: row.site.name,
    number: row.number,
    severity,
    startedAt: first.start,
    startedBefore: first.start < from,
    minutes: drops.reduce((sum, e) => sum + clipMinutes(e, from, to, now), 0),
    drops: drops.length,
    // As of the report (09:00), not the period's midnight: DOWN AGAIN after `to` is still down (engine review).
    failing: last.end === null || (open.end === null && open.severity === 'down'),
    stillProblem,
    cause: causeOf(row, severity, first.start, now),
    outsideHours: !inside(first.start),
    rootCause: rootCauseOf(row),
    prevention: preventionOf(row),
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

/**
 * The weekly COMING UP expiry lines (S13, D-066): each site's halves due soon (`expiryCounts`, the
 * Expiry page's amber and red), soonest first within a site and across sites.
 */
export function expiringOf(
  sites: readonly { site: string; dates: ExpiryDates | null }[],
  now: Date,
): ReportExpiry[] {
  const out: ReportExpiry[] = [];
  for (const s of sites) {
    if (!s.dates) continue;
    const c = expiryCounts(s.dates, now);
    const halves = [
      ...(c.ssl && c.ssl.tone !== 'plain' ? [{ kind: 'ssl' as const, days: c.ssl.days }] : []),
      ...(c.domain && c.domain.tone !== 'plain' ? [{ kind: 'domain' as const, days: c.domain.days }] : []),
    ].sort((x, y) => x.days - y.days);
    if (halves.length) out.push({ site: s.site, halves });
  }
  return out.sort((x, y) => x.halves[0]!.days - y.halves[0]!.days || x.site.localeCompare(y.site));
}
