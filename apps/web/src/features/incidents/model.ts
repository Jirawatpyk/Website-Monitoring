/**
 * Incidents list, resolve gate and timeline — pure rules for S07 (FR-06, spec §11, §14.3, §15.4,
 * §16.1–5, §19, D-032, D-033). Everything here takes `now` and plain rows, so the table tests can
 * use the boards' samples.
 */
import {
  canResolve,
  mttrMinutes,
  outageMinutes,
  settledOutageMinutes,
  responseKpis,
  UNKNOWN_ROOT_CAUSE,
  type MetricIncident,
  type ResolveBlocker,
} from '@dxt/engine';
import {
  clockMinutes,
  CLOSED_INCIDENT_STATES,
  formatConfirmedBy,
  confirmedByWafOf,
  formatDuration,
  formatTime,
  formatTimeWithSeconds,
  formatWhen,
  ROOT_CAUSE_CATEGORIES,
  ROOT_CAUSE_LABELS,
  TRIGGER_LABELS,
  type IncidentState,
  type RootCauseCategory,
  type Severity,
  type Trigger,
} from '@dxt/shared';

// ── List ─────────────────────────────────────────────────────────────────

/** One incident as the list needs it (`listIncidents`). Times are ISO strings. */
export interface ListIncident {
  id: string;
  number: number;
  siteId: string;
  siteName: string;
  tier: number;
  severity: Severity;
  trigger: Trigger;
  state: IncidentState;
  escalationLevel: number;
  startedAt: string;
  /** When the outage started, for a PROBLEM raised to DOWN (D-021); else null. */
  downStartedAt: string | null;
  detectedAt: string;
  ackedAt: string | null;
  ackedByName: string | null;
  recoveredAt: string | null;
  resolvedAt: string | null;
  autoResolved: boolean;
  isFlapping: boolean;
  isManual: boolean;
  ownerName: string | null;
  /** The site's owners: who may acknowledge it (`mayAcknowledge`, D-016). */
  primaryOwnerId: string | null;
  backupOwnerId: string | null;
  rootCauseCategory: string | null;
  rootCause: string | null;
  rootCauseFix: string | null;
  /** Its drops from the timeline (`episodesFromTimeline`), for how long it was down (`outageMinutes`). */
  drops: { start: string; end: string | null; severity: Severity }[];
}

export type DesktopView = 'needs_action' | 'done' | 'all';
export type PhoneView = 'open' | 'unacked' | 'past';
export type SeverityFilter = 'all' | Severity;
export type PeriodDays = 30 | 7;

export interface ListFilters {
  view: DesktopView | PhoneView;
  severity: SeverityFilter;
  siteId: string | null;
  period: PeriodDays;
}

export const DEFAULT_FILTERS: ListFilters = {
  view: 'needs_action',
  severity: 'all',
  siteId: null,
  period: 30,
};

const CLOSED: readonly IncidentState[] = CLOSED_INCIDENT_STATES;
const WAITING_ACK: readonly IncidentState[] = ['unacked', 'escalated'];

/** Open = any state before Resolved (spec §19, §21.2). */
export const isOpen = (i: Pick<ListIncident, 'state'>) => !CLOSED.includes(i.state);

/** D-032: "Unacked" counts DOWN incidents waiting for an ack — the Overview's banners and card. */
export const isUnackedDown = (i: Pick<ListIncident, 'state' | 'severity'>) =>
  i.severity === 'down' && WAITING_ACK.includes(i.state);

/** Needs action (Incidents) = everything not done: open, Needs root cause, In review. */
const needsAction = (i: ListIncident) => i.state !== 'resolved' && i.state !== 'closed';

/**
 * Sort (Incidents footer, D-033): unacked / escalated DOWN first, then the other open ones, then those
 * waiting for a root cause or review, then the done ones. Inside the first group escalated before
 * unacked, then the longest wait (§21.4, as the Overview); inside the others the newest start first.
 */
export function sortGroup(i: ListIncident): number {
  if (isUnackedDown(i)) return 0;
  if (i.state === 'needs_root_cause' || i.state === 'in_review') return 2;
  if (isOpen(i)) return 1;
  return 3;
}

export function sortIncidents(list: readonly ListIncident[]): ListIncident[] {
  const escalated = (i: ListIncident) => (i.state === 'escalated' ? 0 : 1);
  return [...list].sort((a, b) => {
    const group = sortGroup(a) - sortGroup(b);
    if (group) return group;
    if (sortGroup(a) === 0) {
      return escalated(a) - escalated(b) || a.detectedAt.localeCompare(b.detectedAt) || a.number - b.number;
    }
    return b.startedAt.localeCompare(a.startedAt) || b.number - a.number;
  });
}

const inView = (i: ListIncident, view: ListFilters['view']) => {
  switch (view) {
    case 'needs_action':
      return needsAction(i);
    case 'done':
      return !needsAction(i);
    case 'open':
      return isOpen(i);
    case 'unacked':
      return isUnackedDown(i);
    case 'past':
      return !isOpen(i);
    default:
      return true;
  }
};

/** In the period: started in it, or still open (an old incident still waiting stays on the list). */
const inPeriod = (i: ListIncident, days: PeriodDays, now: Date) =>
  isOpen(i) || new Date(i.startedAt).getTime() >= now.getTime() - days * 86_400_000;

export interface FilteredList {
  rows: ListIncident[];
  /** Short PROBLEMs that resolved on their own (§16.1, D-024), left out of every view. */
  hiddenAutoResolved: number;
}

export function filterIncidents(list: readonly ListIncident[], f: ListFilters, now: Date): FilteredList {
  const matching = list.filter(
    (i) =>
      inPeriod(i, f.period, now) &&
      (f.severity === 'all' || i.severity === f.severity) &&
      (!f.siteId || i.siteId === f.siteId) &&
      inView(i, f.view),
  );
  return {
    rows: sortIncidents(matching.filter((i) => !i.autoResolved)),
    hiddenAutoResolved: matching.filter((i) => i.autoResolved).length,
  };
}

export const isDefaultFilter = (f: ListFilters) => f.severity === 'all' && !f.siteId && f.period === 30;

/** Desktop view options with their counts ("Needs action · 4"). */
export function desktopViewCounts(list: readonly ListIncident[], f: ListFilters, now: Date) {
  const count = (view: DesktopView) => filterIncidents(list, { ...f, view }, now).rows.length;
  return { needs_action: count('needs_action'), done: count('done'), all: count('all') };
}

/** Phone views: "Open 3" · "Unacked 1" · "Past". */
export function phoneViewCounts(list: readonly ListIncident[], now: Date) {
  const f = { ...DEFAULT_FILTERS };
  const count = (view: PhoneView) => filterIncidents(list, { ...f, view }, now).rows.length;
  return { open: count('open'), unacked: count('unacked'), past: count('past') };
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The count line next to the view control (Incidents, MIncidents). */
export function countLabel(list: readonly ListIncident[], f: ListFilters, now: Date): string {
  const { rows, hiddenAutoResolved } = filterIncidents(list, f, now);
  const period = `last ${f.period} days`;
  switch (f.view) {
    case 'needs_action': {
      if (!isDefaultFilter(f)) return `${plural(rows.length, 'incident')} · ${period}`;
      const open = rows.filter(isOpen).length;
      const review = rows.filter((i) => i.state === 'in_review').length;
      return review ? `${open} open + ${review} review awaiting sign-off` : `${open} open`;
    }
    case 'open':
      return `${rows.length} open · unacknowledged first`;
    case 'unacked':
      return `${rows.length} not acknowledged`;
    case 'past': {
      const hidden = hiddenAutoResolved
        ? ` · ${plural(hiddenAutoResolved, 'short PROBLEM')} auto-resolved (hidden)`
        : '';
      return `Last ${f.period} days · all ${rows.length} resolved, in review or closed${hidden}`;
    }
    default:
      return `${plural(rows.length, 'incident')} · ${period}`;
  }
}

/** "N shown · M short PROBLEMs auto-resolved in < 5 min are hidden." (§16.1) — none in Needs action. */
export function hiddenNote(list: readonly ListIncident[], f: ListFilters, now: Date): string | null {
  if (f.view === 'needs_action' || f.view === 'open' || f.view === 'unacked') return null;
  const { rows, hiddenAutoResolved } = filterIncidents(list, f, now);
  if (!hiddenAutoResolved) return null;
  return `${rows.length} shown · ${plural(hiddenAutoResolved, 'short PROBLEM')} auto-resolved in < 5 min ${hiddenAutoResolved === 1 ? 'is' : 'are'} hidden.`;
}

/** Elapsed whole minutes, at least 1 (how long someone has waited). */
const minutesBetween = (from: string, to: Date) =>
  Math.max(1, Math.floor((to.getTime() - new Date(from).getTime()) / 60_000));

/**
 * How long it was down (D-033): the sum of its drops, DOWN ones only for a DOWN incident, in whole clock
 * minutes — the number Site detail, MTTR and the Chat / email messages use. Without drops (no timeline
 * read) it falls back to first failed check → recovered, or now while still down.
 */
export function durationMinutes(
  i: Pick<ListIncident, 'startedAt' | 'recoveredAt' | 'resolvedAt' | 'drops'>,
  now: Date,
): number {
  const fromDrops = outageMinutes(
    i.drops.map((d) => ({
      start: new Date(d.start),
      end: d.end ? new Date(d.end) : null,
      severity: d.severity,
    })),
    now,
  );
  if (fromDrops !== null) return fromDrops;
  const end = i.recoveredAt ?? i.resolvedAt;
  return clockMinutes(new Date(i.startedAt), end ? new Date(end) : now);
}

/** The trigger as the list writes it: "Hard fail", "Slow, flapped". */
export function triggerWords(i: Pick<ListIncident, 'trigger' | 'isFlapping'>): string {
  return `${TRIGGER_LABELS[i.trigger]}${i.isFlapping ? ', flapped' : ''}`;
}

export const rootCauseLabel = (category: string | null) =>
  category && (ROOT_CAUSE_CATEGORIES as readonly string[]).includes(category)
    ? ROOT_CAUSE_LABELS[category as RootCauseCategory]
    : null;

const shorten = (text: string, max = 60) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/** The "Next / ack" cell (desktop) and the card's last line (phone): what happens or happened next. */
export function nextLine(
  i: ListIncident,
  now: Date,
  /** MIncidents writes "Acknowledged by Ploy 09:58"; the desktop column "Acked by …". */
  long = false,
): { text: string; tone: 'danger' | 'warning' | 'secondary' } {
  if (WAITING_ACK.includes(i.state)) {
    const waited = minutesBetween(i.detectedAt, now);
    return { text: `${formatDuration(waited)} unacked`, tone: i.severity === 'down' ? 'danger' : 'warning' };
  }
  if (i.state === 'acknowledged') {
    return {
      text: [
        i.ackedByName ? `${long ? 'Acknowledged' : 'Acked'} by ${i.ackedByName}` : 'Acknowledged',
        i.ackedAt ? formatTime(new Date(i.ackedAt)) : null,
      ]
        .filter(Boolean)
        .join(' '),
      tone: 'secondary',
    };
  }
  if (i.state === 'monitoring') {
    const when = i.recoveredAt ? ` ${formatTime(new Date(i.recoveredAt))}` : '';
    return { text: `Recovered${when} — watching for 2 OK rounds`, tone: 'secondary' };
  }
  if (i.state === 'needs_root_cause') {
    return { text: 'Recovered — add a root cause to resolve', tone: 'warning' };
  }
  const summary = i.rootCauseFix ?? i.rootCause;
  return {
    text: summary ? shorten(summary) : (rootCauseLabel(i.rootCauseCategory) ?? 'Resolved'),
    tone: 'secondary',
  };
}

/** EmptyStates panel 2: with nothing open, what was last true ("Last one: …, N in the last 7 days"). */
export function lastOneLine(all: readonly ListIncident[], now: Date): string {
  // auto-resolved PROBLEMs are hidden everywhere (D-033): not the "last one", not in the count
  const list = all.filter((i) => !i.autoResolved);
  const last = [...list].sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
  if (!last) return 'No incidents in the last 30 days.';
  const week = list.filter((i) => Date.parse(i.startedAt) >= now.getTime() - 7 * 86_400_000).length;
  const what = `${last.siteName}, ${last.severity === 'down' ? 'Down' : 'Problem'} ${formatDuration(durationMinutes(last, now))}`;
  const back = last.recoveredAt
    ? `, recovered ${formatWhen(new Date(last.recoveredAt), now, { midSentence: true })}`
    : '';
  return `Last one: ${what}${back}. ${week} ${week === 1 ? 'incident' : 'incidents'} in the last 7 days.`;
}

// ── KPIs ─────────────────────────────────────────────────────────────────

export interface ListKpis {
  open: number;
  openCaption: string;
  unacked: number;
  unackedCaption: string;
  /** Escalated (a step paged someone, S08) and still not acknowledged. */
  escalated: number;
  escalatedCaption: string;
  needsRootCause: number;
  needsRootCauseCaption: string;
  /** MTTA as the Overview counts it (D-032): null until 3 DOWN incidents in 30 days. */
  mttaSeconds: number | null;
  mttaEnough: boolean;
  /** MTTR · DOWN only · median (D-033). */
  mttrMinutes: number | null;
}

const toMetric = (i: ListIncident): MetricIncident => ({
  severity: i.severity,
  tier: i.tier,
  startedAt: new Date(i.startedAt),
  downStartedAt: i.downStartedAt ? new Date(i.downStartedAt) : null,
  detectedAt: new Date(i.detectedAt),
  ackedAt: i.ackedAt ? new Date(i.ackedAt) : null,
  isManual: i.isManual,
});

export function listKpis(list: readonly ListIncident[], now: Date): ListKpis {
  const open = list.filter(isOpen);
  // What each is now: failing (DOWN / PROBLEM), recovered and being watched, or waiting for a root cause.
  const failing = open.filter((i) => !['monitoring', 'needs_root_cause', 'in_review'].includes(i.state));
  const down = failing.filter((i) => i.severity === 'down').length;
  const problem = failing.filter((i) => i.severity === 'problem').length;
  const watching = open.filter((i) => i.state === 'monitoring').length;
  const rc = open.filter((i) => i.state === 'needs_root_cause');
  const unacked = sortIncidents(open.filter(isUnackedDown));
  const from = new Date(now.getTime() - 30 * 86_400_000);
  const kpis = responseKpis(list.map(toMetric), from, now);
  const recent = list.filter((i) => new Date(i.downStartedAt ?? i.startedAt) >= from);
  const first = unacked[0];
  const escalated = sortIncidents(open.filter((i) => i.state === 'escalated'));
  const firstEscalated = escalated[0];
  return {
    open: open.length,
    openCaption: open.length
      ? [
          down ? `${down} DOWN` : null,
          problem ? `${problem} PROBLEM` : null,
          watching ? `${watching} recovering` : null,
          rc.length ? `${rc.length} needs root cause` : null,
        ]
          .filter(Boolean)
          .join(' · ')
      : 'Nothing open',
    unacked: unacked.length,
    unackedCaption: first
      ? `${first.siteName} · ${formatDuration(minutesBetween(first.detectedAt, now))} unacked`
      : 'Nobody waiting',
    escalated: escalated.length,
    escalatedCaption: firstEscalated
      ? `${firstEscalated.siteName} · ${formatDuration(minutesBetween(firstEscalated.detectedAt, now))} unacked`
      : 'None escalated',
    needsRootCause: rc.length,
    needsRootCauseCaption: rc[0] ? `${rc[0].siteName} · recovered, not resolved` : 'None waiting',
    mttaSeconds: kpis.mttaSeconds,
    mttaEnough: kpis.enough,
    mttrMinutes: kpis.enough
      ? mttrMinutes(
          recent.map((i) => ({
            severity: i.severity,
            minutes: settledOutageMinutes(
              i.drops.map((d) => ({
                start: new Date(d.start),
                end: d.end ? new Date(d.end) : null,
                severity: d.severity,
              })),
              !isOpen(i),
              now,
            ),
          })),
        )
      : null,
  };
}

// ── Detail: events, the resolve gate, the timeline ───────────────────────

export interface EventRow {
  type: string;
  at: string;
  actor_id: string | null;
  payload: Record<string, unknown>;
}

const str = (v: unknown) => (typeof v === 'string' ? v : null);
const num = (v: unknown) => (typeof v === 'number' ? v : null);

/** The gate's view of the incident (the same facts `resolve_incident` reads). */
export interface GateIncident {
  state: IncidentState;
  recoveredAt: string | null;
  clientUpdateRequired: boolean;
  clientUpdatedAt: string | null;
  rootCauseCategory: string | null;
}

/**
 * OK for 2 rounds (D-033): an `ok_two_rounds` event since the latest recovery, in Monitoring or Needs
 * root cause — exactly what `resolve_incident` checks, so the button and the database agree.
 */
export function okTwoRoundsAt(i: GateIncident, events: readonly EventRow[]): string | null {
  // Still in a drop (Unacked / Escalated / Acknowledged): an earlier recovery's rounds don't count.
  if (!i.recoveredAt || i.state === 'unacked' || i.state === 'escalated' || i.state === 'acknowledged') {
    return null;
  }
  const since = new Date(i.recoveredAt).getTime();
  const ok = events
    .filter((e) => e.type === 'ok_two_rounds' && new Date(e.at).getTime() >= since)
    .map((e) => e.at)
    .sort();
  return ok[0] ?? null;
}

export interface Condition {
  key: ResolveBlocker;
  label: string;
  met: boolean;
  detail: string;
}

export interface Gate {
  conditions: Condition[];
  metCount: number;
  /** All three met (`canResolve`). */
  ok: boolean;
  /** Recovery and the client update met: the Resolve dialog may open (the root cause is in it). */
  canOpenDialog: boolean;
  /** Why the page's Resolve button is disabled, or null when it isn't. */
  lockedReason: string | null;
}

/** The three conditions in the boards' words (Incident, MIncident, Resolve; §15.4, §16.1–3). */
export function resolveGate(
  i: GateIncident & { siteName: string },
  events: readonly EventRow[],
  nameOf: (id: string | null) => string,
): Gate {
  const okAt = okTwoRoundsAt(i, events);
  const recovered =
    !!i.recoveredAt && i.state !== 'unacked' && i.state !== 'escalated' && i.state !== 'acknowledged';
  const clientPending = i.clientUpdateRequired && !i.clientUpdatedAt;
  const category = i.rootCauseCategory?.trim().toLowerCase() ?? null;
  const lastRc = [...events]
    .filter((e) => e.type === 'root_cause')
    .sort((a, b) => b.at.localeCompare(a.at))[0];

  const recovery: Condition = {
    key: 'recovery',
    label: 'OK for 2 rounds',
    met: !!okAt,
    detail: okAt
      ? `OK since ${formatTime(new Date(i.recoveredAt!))} · 2 rounds done ${formatTime(new Date(okAt))}`
      : recovered
        ? `OK since ${formatTime(new Date(i.recoveredAt!))} · waiting for the second OK round`
        : 'Still down · needs 2 OK rounds once it recovers',
  };
  const client: Condition = {
    key: 'client_update',
    label: 'Client update marked',
    met: !clientPending,
    detail: clientPending
      ? 'Required — Tier 1 down 15 min or more · not marked yet'
      : i.clientUpdateRequired
        ? 'Marked'
        : 'Not required — the client-update track didn’t fire',
  };
  const rcLabel = rootCauseLabel(category);
  const root: Condition = {
    key: 'root_cause',
    label: 'Root cause written',
    met: !!category && category !== UNKNOWN_ROOT_CAUSE,
    detail: !category
      ? 'Not written yet · needed before Resolve'
      : category === UNKNOWN_ROOT_CAUSE
        ? 'Unknown keeps the incident open'
        : `${lastRc ? `${nameOf(lastRc.actor_id)} · ${formatTime(new Date(lastRc.at))} · ` : ''}${rcLabel ?? category}`,
  };
  const conditions = [recovery, client, root];
  const verdict = canResolve({
    okRounds: okAt ? 2 : 0,
    clientUpdate: clientPending ? 'pending' : i.clientUpdateRequired ? 'marked' : 'not_required',
    rootCauseCategory: i.rootCauseCategory,
  });
  const metCount = conditions.filter((c) => c.met).length;
  const canOpenDialog = recovery.met && client.met;
  return {
    conditions,
    metCount,
    ok: verdict.ok,
    canOpenDialog,
    lockedReason: canOpenDialog
      ? null
      : !recovery.met
        ? recovered
          ? `Resolve locked · ${metCount} of 3 met — waiting for the second OK round`
          : `Resolve locked · ${metCount} of 3 met — ${i.siteName} is still down`
        : `Resolve locked · ${metCount} of 3 met — mark the client update first`,
  };
}

/** One line of the timeline. */
export interface TimelineItem {
  at: string;
  time: string;
  kind:
    | 'failed'
    | 'down'
    | 'problem'
    | 'alert'
    | 'ack'
    | 'evidence'
    | 'recovered'
    | 'ok'
    | 'note'
    | 'root_cause'
    | 'resolved'
    | 'escalated'
    | 'undone';
  title: string;
  detail: string | null;
}

/** Same `at`: RECOVERED before PROBLEM AGAIN (§19.7, D-023). */
const TIE: Record<string, number> = { recovered: 0, ok_two_rounds: 1, relapsed: 2 };

const TEMPLATE_WORDS: Record<string, string> = {
  down: 'DOWN',
  problem: 'PROBLEM',
  acknowledged: 'ACKNOWLEDGED',
  recovered: 'RECOVERED',
  down_again: 'DOWN AGAIN',
  problem_again: 'PROBLEM AGAIN',
  flap_summary: 'Flapping summary',
  resolved: 'RESOLVED',
  note: 'NOTE',
};

export interface TimelineIncident {
  severity: Severity;
  trigger: Trigger;
  startedAt: string;
  recoveredAt: string | null;
}

/**
 * Every event in words (§16.11: rows never disappear), oldest first; the phone shows it reversed
 * (MIncident "Newest first"). `nameOf` maps profile ids to names.
 */
export function timelineOf(
  i: TimelineIncident,
  events: readonly EventRow[],
  nameOf: (id: string | null) => string,
  now: Date,
): TimelineItem[] {
  const sorted = [...events].sort(
    (a, b) => a.at.localeCompare(b.at) || (TIE[a.type] ?? 1) - (TIE[b.type] ?? 1),
  );
  const detected = sorted.find((e) => e.type === 'detected');
  const items: TimelineItem[] = [];
  const item = (e: { at: string }, kind: TimelineItem['kind'], title: string, detail: string | null = null) =>
    items.push({ at: e.at, time: formatTimeWithSeconds(new Date(e.at)), kind, title, detail });

  // The first failed check comes from the incident itself (no event of its own).
  item(
    { at: i.startedAt },
    'failed',
    'First failed check',
    str(detected?.payload.cause) ?? TRIGGER_LABELS[i.trigger],
  );

  sorted.forEach((e, n) => {
    const by = nameOf(e.actor_id);
    const later = sorted.slice(n + 1);
    switch (e.type) {
      case 'detected': {
        const time = formatTimeWithSeconds(new Date(e.at));
        if (
          typeof e.payload.summary === 'string' ||
          (i.severity === 'problem' && !e.payload.confirmingLocations)
        ) {
          item(e, 'problem', `PROBLEM detected ${time}`, str(e.payload.summary) ?? str(e.payload.cause));
        } else {
          const locations = num(e.payload.confirmingLocations) ?? 2;
          item(
            e,
            'down',
            `Confirmed down ${time}`,
            `Confirmed by ${formatConfirmedBy(locations, confirmedByWafOf(e.payload))}. Incident opened.`,
          );
        }
        return;
      }
      case 'alerted': {
        const word = TEMPLATE_WORDS[str(e.payload.template) ?? ''] ?? 'Alert';
        item(
          e,
          'alert',
          e.payload.channel === 'email'
            ? `${word} emailed to ${nameOf(str(e.payload.user_id))}`
            : `${word} posted in Chat`,
        );
        return;
      }
      case 'acknowledged':
      case 'resolved': {
        const isAck = e.type === 'acknowledged';
        const postsAt = str(e.payload.posts_at);
        const undone = later.some((l) => l.type === (isAck ? 'ack_undone' : 'resolve_undone'));
        const template = isAck ? 'acknowledged' : 'resolved';
        const posted = undone
          ? undefined
          : later.filter((l) => l.type === 'alerted' && l.payload.template === template).map((l) => l.at)[0];
        const holding = postsAt && !undone && new Date(postsAt) > now && e.payload.notifies !== false;
        const head = `${isAck ? 'Acknowledged' : 'Resolved'} by ${by}`;
        const title = posted
          ? `${head} (posted ${formatTimeWithSeconds(new Date(posted))})`
          : holding
            ? `${head} (posts ${formatTimeWithSeconds(new Date(postsAt))} unless undone)`
            : head;
        if (isAck) {
          item(e, 'ack', title);
        } else {
          const label = rootCauseLabel(str(e.payload.category));
          const what = str(e.payload.what);
          item(e, 'resolved', title, [label, what ? `“${what}”` : null].filter(Boolean).join(' · ') || null);
        }
        return;
      }
      case 'ack_undone':
        item(e, 'undone', `Acknowledgement undone by ${by}`);
        return;
      case 'resolve_undone':
        item(e, 'undone', `Resolve undone by ${by}`, 'Back to waiting for a resolve');
        return;
      case 'evidence': {
        const after = i.recoveredAt && new Date(e.at) > new Date(i.recoveredAt);
        item(
          e,
          'evidence',
          'Screenshot attached',
          `Browser verifier, Bangkok — evidence only${after ? ' · taken after recovery' : ''}.`,
        );
        return;
      }
      case 'recovered': {
        const auto = e.payload.autoResolved === true;
        item(
          e,
          'recovered',
          auto ? 'Recovered' : 'Recovered → Monitoring',
          `First OK round · OK from ${num(e.payload.okLocations) ?? 2} locations`,
        );
        return;
      }
      case 'ok_two_rounds':
        // D-033 / engine re-review M2: Monitoring here means the root cause was already written.
        item(
          e,
          'ok',
          e.payload.state === 'monitoring' ? 'OK for 2 rounds' : 'OK for 2 rounds → Needs root cause',
          e.payload.state === 'monitoring'
            ? 'Root cause already written — ready to resolve'
            : 'Needs a root cause before it can be resolved',
        );
        return;
      case 'auto_resolved':
        item(
          e,
          'resolved',
          'Resolved automatically',
          'Short PROBLEM, never acknowledged — no root cause needed',
        );
        return;
      case 'relapsed': {
        const down = e.payload.severity === 'down';
        item(
          e,
          down ? 'down' : 'problem',
          `${down ? 'Down' : 'Problem'} again${e.payload.flapping === true ? ' · flapping' : ''}`,
          str(e.payload.summary) ?? str(e.payload.cause),
        );
        return;
      }
      case 'escalated_to_down':
        item(e, 'down', 'PROBLEM became DOWN', str(e.payload.cause));
        return;
      case 'step_fired': {
        // S08 (D-034): who the step asked (@mentioned) and told FYI, in the thread and by email.
        const ids = (k: string) =>
          (Array.isArray(e.payload[k]) ? (e.payload[k] as unknown[]) : []).filter(
            (x): x is string => typeof x === 'string',
          );
        const asked = ids('mentioned').map((id) => nameOf(id));
        const fyi = ids('fyi').map((id) => nameOf(id));
        const level = num(e.payload.level) ?? 1;
        if (!ids('notified').length) {
          item(
            e,
            'escalated',
            `L${level} reached — nobody new to tell`,
            'Everyone on this step was already told, or the step names no one for this site.',
          );
          return;
        }
        const words = [
          ...asked.map((n) => `@${n}`),
          ...(asked.length ? ['please acknowledge'] : []),
          ...(fyi.length ? [`${fyi.join(' and ')} FYI`] : []),
        ].join(' · ');
        item(e, 'escalated', `Escalated to L${level} — not acknowledged`, `“${words}” in the thread + email`);
        return;
      }
      case 'note':
        item(e, 'note', `Note by ${by}`, str(e.payload.text));
        return;
      case 'root_cause': {
        const category = str(e.payload.category);
        const unknown = category === UNKNOWN_ROOT_CAUSE;
        const stillDown = ['unacked', 'escalated', 'acknowledged'].includes(str(e.payload.state) ?? '');
        const verb = unknown
          ? 'Root cause note'
          : e.payload.first === true
            ? stillDown
              ? 'Root cause draft'
              : 'Root cause written'
            : 'Root cause edited';
        const suffix = unknown
          ? ' · doesn’t count — incident stays open'
          : stillDown
            ? ' · incident kept open (still down)'
            : '';
        const what = str(e.payload.what);
        const fix = str(e.payload.fix);
        item(
          e,
          'root_cause',
          `${verb} by ${by}${suffix}`,
          [rootCauseLabel(category), what ? `“${what}”` : null, fix ? `Fix: ${fix}` : null]
            .filter(Boolean)
            .join(' · ') || null,
        );
        return;
      }
      default:
        return;
    }
  });
  return items;
}
