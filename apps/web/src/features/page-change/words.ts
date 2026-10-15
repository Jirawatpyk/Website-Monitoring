import {
  FINGERPRINT_FIELDS,
  formatDay,
  formatDuration,
  formatIncidentId,
  formatTime,
  formatTimeWithSeconds,
} from '@dxt/shared';
import { PAGE_CHANGE_HOLD_FETCHES } from '@dxt/engine';
import { fetchesLeft, type PageChangeView } from './model';

/** The boards' copy for the Page fingerprint and What changed cards (spec §26.4–§26.8). */

const time = (iso: string) => formatTime(new Date(iso));
const day = (iso: string) => formatDay(new Date(iso), { weekday: true });
const CRAWL_MIN = 30;
const HOLD = PAGE_CHANGE_HOLD_FETCHES;

/** "baseline accepted Thu 10 Sep by Tao", or "baseline set Thu 10 Sep" for the first, automatic one. */
export function baselineWords(v: Pick<PageChangeView, 'baseline'>): string {
  const b = v.baseline;
  if (!b) return 'no baseline yet';
  return b.acceptedBy
    ? `baseline accepted ${day(b.acceptedAt)} by ${b.acceptedBy}`
    : `baseline set ${day(b.acceptedAt)}`;
}

/** "held 2 checks (30 min)", "held 2 of 3 checks (30 min)" while it waits. */
export function heldWords(v: Pick<PageChangeView, 'held' | 'newScript'>, ofHold = false): string {
  const span = formatDuration((v.held - 1) * CRAWL_MIN);
  const checks =
    ofHold && fetchesLeft(v) > 0
      ? `${v.held} of ${HOLD} checks`
      : `${v.held} check${v.held === 1 ? '' : 's'}`;
  return v.held > 1 ? `held ${checks} (${span})` : `held ${checks}`;
}

/** The card's footer: "First seen 09:30 · held 2 checks (30 min)" and "From the 10:00:14 fetch · next fetch 10:30". */
export function footerWords(v: PageChangeView, ofHold = false): [string, string] | null {
  if (!v.firstSeenAt || !v.checkedAt) return null;
  return [
    `First seen ${time(v.firstSeenAt)} · ${heldWords(v, ofHold)}`,
    `From the ${formatTimeWithSeconds(new Date(v.checkedAt))} fetch${v.nextFetchAt ? ` · next fetch ${time(v.nextFetchAt)}` : ''}`,
  ];
}

/** "Couldn’t read the page (blocked by bot protection)", "(timed out)", "(HTTP 503)" — or no fetch at all. */
export function noDataWords(n: PageChangeView['noData']): string {
  switch (n?.reason) {
    case 'blocked':
      return 'Couldn’t read the page (blocked by bot protection)';
    case 'timeout':
      return 'Couldn’t read the page (timed out)';
    case 'http':
      return `Couldn’t read the page (HTTP ${n.statusCode})`;
    case 'stale':
      return 'Couldn’t read the page — no fetch got through in the last hour';
    default:
      return 'Couldn’t read the page';
  }
}

/** The Page fingerprint card's status line and its second line (§26.8). */
export function statusWords(v: PageChangeView): { line: string; sub: string | null } {
  switch (v.status) {
    case 'no_fingerprint':
      return { line: 'No fingerprint yet — the first check runs within 30 min', sub: null };
    case 'recording':
      return {
        line: `Recording — alerts start after 2 weeks of clean checks (from ${day(v.recordingUntil!)})`,
        sub: 'Until then it only records — no alerts.',
      };
    case 'no_data':
      return {
        line: `${noDataWords(v.noData)}${v.checkedAt ? ` · last read ${time(v.checkedAt)}` : ''}`,
        sub: 'Uptime checks are unaffected. The last fingerprint read is kept; nothing is compared until a fetch gets through.',
      };
    case 'matches':
      return {
        line: `Matches baseline${v.checkedAt ? ` · checked ${time(v.checkedAt)}` : ''} · ${baselineWords(v)}`,
        sub: null,
      };
    case 'accepted': {
      const by = `Baseline accepted ${time(v.baseline!.acceptedAt)} by ${v.baseline!.acceptedBy}`;
      const next = v.nextFetchAt ? time(v.nextFetchAt) : 'next';
      return {
        line: v.incident
          ? `${by} · ${formatIncidentId(v.incident.number)} recovers when the ${next} fetch matches it`
          : `${by} · the ${next} check compares against it`,
        sub: v.baseline!.reason ? `“${v.baseline!.reason}”` : null,
      };
    }
    case 'waiting': {
      const left = fetchesLeft(v);
      const at = v.checkedAt
        ? time(new Date(Date.parse(v.checkedAt) + left * CRAWL_MIN * 60_000).toISOString())
        : null;
      return {
        line:
          left > 0 && at
            ? `Differs from the baseline · held ${v.held} of ${HOLD} checks — a PROBLEM opens at ${at} if it still differs`
            : `Differs from the baseline · ${heldWords(v)}`,
        sub: v.newScript.length ? null : `No new script domain, so it waits for ${HOLD} fetches (about 1 h).`,
      };
    }
    case 'problem':
      return {
        line: `Differs from the baseline · PROBLEM open since ${time(v.incident!.since)}`,
        sub: v.newScript.length
          ? 'A new script domain raises a PROBLEM on the first fetch.'
          : `It held for ${HOLD} fetches (about 1 h).`,
      };
  }
}

/**
 * The incident card's success line after an accept (§26.6, IncidentPageChange): before the match, after
 * it, or with the resolve.
 */
export function acceptedWords(a: {
  at: string;
  by: string;
  withResolve: boolean;
  matchedAt: string | null;
  nextFetchAt: string | null;
  incidentLabel: string;
}): string {
  if (a.withResolve) return `Accepted as the new baseline with the resolve · ${time(a.at)} by ${a.by}.`;
  const head = `Accepted as the new baseline ${time(a.at)} by ${a.by}`;
  if (a.matchedAt) return `${head} · matched on the ${time(a.matchedAt)} fetch.`;
  return `${head} · the ${a.nextFetchAt ? time(a.nextFetchAt) : 'next'} fetch should match and recover ${a.incidentLabel}.`;
}

/** The line while an accept's Undo is open (§26.6). */
export const pendingWords = (until: string) =>
  `Accepting as the new baseline — Undo is open until ${formatTimeWithSeconds(new Date(until))}.`;

/** The What changed card's line under its title (Incident board). */
export function compareWords(v: PageChangeView, differing: number): string {
  return `Home page / · compared with the ${baselineWords(v)} · ${differing} of ${FINGERPRINT_FIELDS.length} fields differ`;
}

/**
 * The incident header's cause line (§26.3): one change → "Page title changed on /", several → "3 changes
 * on / · new script domain evil-cdn.example" (the domain part only when there is one).
 */
export function headerCause(
  changes: readonly { label: string }[],
  newScript: readonly string[],
  path = '/',
): string {
  if (changes.length === 1) return `${changes[0]!.label} changed on ${path}`;
  return `${changes.length} changes on ${path}${newScript.length ? ` · new script domain ${newScript[0]}` : ''}`;
}
