import {
  formatDuration,
  formatIncidentId,
  formatPercent,
  formatTime,
  formatWhen,
  isSameBangkokDay,
  TRIGGER_LABELS,
  type Role,
} from '@dxt/shared';
import { mayAcknowledge } from '@/features/incidents';
import {
  OVERVIEW_LOCATIONS,
  type OverviewEvent,
  type OverviewLocation,
  type OverviewSite,
  type OverviewViewer,
  type ViewerKind,
} from './types';

/**
 * The Overview's rules (spec §21, D-032), pure so the desktop and phone views share them and tests
 * drive them from the boards' states: which sites are live issues, their one reason, Since and Next
 * step, the banners, counts, chips and the Recent events wording.
 */

const MIN = 60_000;
const minutesBetween = (from: string | Date, to: Date) =>
  Math.max(0, Math.floor((to.getTime() - new Date(from).getTime()) / MIN));

export const isMuted = (s: Pick<OverviewSite, 'mutedUntil'>, now: Date) =>
  s.mutedUntil !== null && new Date(s.mutedUntil) > now;

/** Locations whose latest check is a TLS chain error — a location warning; the status is unchanged (§11). */
export const chainLocations = (s: Pick<OverviewSite, 'locations'>): OverviewLocation[] =>
  OVERVIEW_LOCATIONS.filter((l) => s.locations[l] === 'chain');

const UNACKED: readonly string[] = ['unacked', 'escalated'];
const RECOVERED: readonly string[] = ['monitoring', 'needs_root_cause'];

export type ReasonKind = 'down' | 'problem' | 'maintenance' | 'root_cause' | 'location' | 'muted';

export interface Reason {
  kind: ReasonKind;
  /** When this reason started; null when nothing records it (a mute until S09, D-032). */
  since: string | null;
}

/**
 * The one reason a site is listed (§21.4), in this order: Down › Problem › Maintenance › incident
 * waiting for root cause › location warning › muted. Null = not a live issue. "Blocked by bot
 * protection, verified OK" is not an issue, and this is not the Sites list's "Needs attention" rule.
 */
export function reasonOf(s: OverviewSite, now: Date): Reason | null {
  const inc = s.incident;
  // the incident's current drop, when it is the same kind as the status (D-023: a PROBLEM drop on a
  // DOWN incident starts with that drop)
  const incidentSince = (severity: 'down' | 'problem') =>
    inc && inc.dropSeverity === severity && !RECOVERED.includes(inc.state) ? inc.startedAt : s.statusSince;
  if (s.status === 'down') return { kind: 'down', since: incidentSince('down') };
  if (s.status === 'problem') return { kind: 'problem', since: incidentSince('problem') };
  if (s.status === 'maintenance') return { kind: 'maintenance', since: s.statusSince };
  if (inc) {
    if (RECOVERED.includes(inc.state)) return { kind: 'root_cause', since: inc.recoveredAt };
    // an open incident whose site already reads OK (between rounds): its own severity
    return { kind: inc.dropSeverity, since: inc.startedAt };
  }
  if (chainLocations(s).length) return { kind: 'location', since: s.chainSince };
  if (isMuted(s, now)) return { kind: 'muted', since: null };
  return null;
}

const GROUP: Record<ReasonKind, number> = {
  down: 0,
  problem: 1,
  maintenance: 2,
  root_cause: 3,
  location: 3,
  muted: 3,
};

/** Inside Down: escalated, then unacked, then acked (§21.4). */
const ackRank = (s: OverviewSite) =>
  s.incident?.state === 'escalated' ? 0 : s.incident?.state === 'unacked' ? 1 : 2;

export interface LiveIssue {
  site: OverviewSite;
  reason: Reason;
}

/**
 * Live issues (§21.4), sorted: Down first — escalated, unacked, acked — then Problem, Maintenance,
 * the rest (OK sites listed for a root cause, a location warning or a mute); inside each group
 * Tier 1 → 3, then the longest Since, then name.
 */
export function liveIssues(sites: readonly OverviewSite[], now: Date): LiveIssue[] {
  const issues = sites.flatMap((site) => {
    const reason = reasonOf(site, now);
    return reason ? [{ site, reason }] : [];
  });
  const since = (i: LiveIssue) => (i.reason.since ? new Date(i.reason.since).getTime() : Infinity);
  return issues.sort(
    (a, b) =>
      GROUP[a.reason.kind] - GROUP[b.reason.kind] ||
      (a.reason.kind === 'down' ? ackRank(a.site) - ackRank(b.site) : 0) ||
      a.site.tier - b.site.tier ||
      since(a) - since(b) ||
      a.site.name.localeCompare(b.site.name),
  );
}

/** Duration over "since HH:MM" (§21.4); null when the start isn't known. */
export function sinceText(since: string | null, now: Date): { duration: string; at: string } | null {
  if (!since) return null;
  const start = new Date(since);
  // "since 08:12" today; "since yesterday 16:40" / "since Mon 14 Sep 21:18" before (spec §13)
  const at = isSameBangkokDay(start, now) ? formatTime(start) : formatWhen(start, now, { midSentence: true });
  return { duration: durationText(minutesBetween(since, now)), at: `since ${at}` };
}

/**
 * A duration on the Overview: "19 min", "1 h 2 min"; under a minute "just now", as the incident line
 * says ("INC-0142 · unacked just now", `formatIncidentLine`) — "0 min" reads like a glitch.
 * With a word: "18 min unacked" / "unacked just now".
 */
export function durationText(minutes: number, word?: string): string {
  if (minutes < 1) return word ? `${word} just now` : 'just now';
  const d = formatDuration(minutes);
  return word ? `${d} ${word}` : d;
}

const capitalise = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

/** The reason in words: the desktop "why" line, or the phone note (with the ack state first for a DOWN). */
export function reasonLine(issue: LiveIssue, options: { phone?: boolean } = {}): string {
  const { site, reason } = issue;
  const inc = site.incident;
  const cause = inc?.cause ? capitalise(inc.cause) : inc ? TRIGGER_LABELS[inc.trigger] : null;
  switch (reason.kind) {
    case 'down': {
      const what = cause ?? 'Down';
      if (!options.phone || !inc) return what;
      const ack =
        inc.state === 'escalated'
          ? `Escalated L${inc.level}`
          : inc.state === 'unacked'
            ? 'Unacked'
            : inc.ackedBy
              ? `Acked by ${inc.ackedBy}`
              : 'Acknowledged';
      return `${ack} · ${what}`;
    }
    case 'problem':
      return cause ?? 'Problem';
    case 'maintenance':
      return 'Planned maintenance';
    case 'root_cause':
      return options.phone ? 'Root cause not added yet' : 'Back up — root cause not added yet';
    case 'location': {
      const warned = chainLocations(site);
      const ok = OVERVIEW_LOCATIONS.filter((l) => site.locations[l] === 'pass');
      const line = `TLS chain error at ${warned.join(', ')}`;
      return options.phone || !ok.length ? line : `${line} · ${ok.join(', ')} OK`;
    }
    case 'muted': {
      const until = site.mutedUntil ? `until ${formatTime(new Date(site.mutedUntil))}` : '';
      if (options.phone) return `Muted ${until}`.trim();
      return site.muteReason ? `Muted · ${site.muteReason}` : `Muted ${until}`.trim();
    }
  }
}

/** The ownership chip (§21.8, §11): neutral outline, never accent. */
export type Chip = { label: 'Yours' | 'Backup'; icon: 'user' } | { label: 'Your client'; icon: 'users' };

export function chipOf(viewer: OverviewViewer, site: OverviewSite): Chip | null {
  if (viewer.kind === 'admin' || viewer.kind === 'responder') {
    if (site.ownerId === viewer.id) return { label: 'Yours', icon: 'user' };
    if (site.backupId === viewer.id) return { label: 'Backup', icon: 'user' };
    return null;
  }
  if (viewer.kind === 'am' && site.amId === viewer.id) return { label: 'Your client', icon: 'users' };
  return null;
}

const roleOf = (kind: ViewerKind): Role =>
  kind === 'admin' || kind === 'responder' ? kind : kind === 'viewer' ? 'viewer' : 'stakeholder';

/** Whether this person may acknowledge on this site (D-016 / D-031: never AM, CEO or Viewer). */
export function canAck(viewer: OverviewViewer, site: OverviewSite): boolean {
  return mayAcknowledge(
    { id: viewer.id, role: roleOf(viewer.kind) },
    { primaryOwnerId: site.ownerId, backupOwnerId: site.backupId },
  );
}

export type NextStep =
  | { kind: 'ack'; incidentId: string; number: number }
  | { kind: 'incident'; incidentId: string; label: string }
  | { kind: 'site'; label: 'View checks' | 'View site' };

/**
 * Next step (§21.4, D-032): an unacknowledged DOWN → Acknowledge for those who may, otherwise "Open
 * INC-…"; acked DOWN, PROBLEM and an incident waiting for its root cause → "Open INC-…" ("Add root
 * cause" waits for Resolve, S07); a location warning → "View checks"; a mute → "View site".
 */
export function nextStep(viewer: OverviewViewer, issue: LiveIssue): NextStep {
  const { site, reason } = issue;
  const inc = site.incident;
  if (reason.kind === 'location') return { kind: 'site', label: 'View checks' };
  if (reason.kind === 'muted' || !inc) return { kind: 'site', label: 'View site' };
  if (reason.kind === 'down' && UNACKED.includes(inc.state) && canAck(viewer, site)) {
    return { kind: 'ack', incidentId: inc.id, number: inc.number };
  }
  return { kind: 'incident', incidentId: inc.id, label: `Open ${formatIncidentId(inc.number)}` };
}

/** Where a phone row goes (§17, MOverview4): an incident row → that incident, the rest → Site detail. */
export function phoneHref(issue: LiveIssue): string {
  const inc = issue.site.incident;
  const toIncident = inc && ['down', 'problem', 'root_cause', 'maintenance'].includes(issue.reason.kind);
  return toIncident ? `/incidents/${inc.id}` : `/sites/${issue.site.id}`;
}

export interface Banner {
  site: OverviewSite;
  incidentId: string;
  number: number;
  escalated: boolean;
  level: number;
  /** Down for, from the first failed check (§14.3). */
  downMinutes: number;
  /** Unacked for, from "Confirmed down" (§14.3). */
  unackedMinutes: number;
  cause: string | null;
}

/**
 * Incident banners (§21.1): one per DOWN incident not yet acknowledged; escalated first, then Tier
 * 1 → 3, then longest down. At most `max` are shown; `more` counts the rest. A PROBLEM never gets one.
 */
export function bannersOf(
  sites: readonly OverviewSite[],
  now: Date,
  max = 2,
): { shown: Banner[]; more: number } {
  const all = sites
    .flatMap((site): Banner[] => {
      const inc = site.incident;
      if (!inc || inc.severity !== 'down' || !UNACKED.includes(inc.state) || site.status !== 'down')
        return [];
      return [
        {
          site,
          incidentId: inc.id,
          number: inc.number,
          escalated: inc.state === 'escalated',
          level: inc.level,
          downMinutes: minutesBetween(inc.startedAt, now),
          unackedMinutes: minutesBetween(inc.detectedAt, now),
          cause: inc.cause,
        },
      ];
    })
    .sort(
      (a, b) =>
        Number(b.escalated) - Number(a.escalated) ||
        a.site.tier - b.site.tier ||
        b.downMinutes - a.downMinutes ||
        a.site.name.localeCompare(b.site.name),
    );
  return { shown: all.slice(0, max), more: Math.max(0, all.length - max) };
}

export interface Counts {
  monitored: number;
  ok: number;
  down: number;
  problem: number;
  open: number;
  unacked: number;
  escalated: number;
}

/** Computed, never typed (§21.2): monitored sites only; a muted site counts by its real status. */
export function countsOf(sites: readonly OverviewSite[]): Counts {
  const c: Counts = {
    monitored: sites.length,
    ok: 0,
    down: 0,
    problem: 0,
    open: 0,
    unacked: 0,
    escalated: 0,
  };
  for (const s of sites) {
    if (s.status === 'ok') c.ok += 1;
    if (s.status === 'down') c.down += 1;
    if (s.status === 'problem') c.problem += 1;
    if (s.incident) {
      c.open += 1;
      // Unacked = DOWN incidents waiting for an ack, the ones with banners (MOverview4, D-032); a PROBLEM
      // waits in Live issues without turning the count red
      if (s.incident.severity === 'down' && UNACKED.includes(s.incident.state)) c.unacked += 1;
      if (s.incident.severity === 'down' && s.incident.state === 'escalated') c.escalated += 1;
    }
  }
  return c;
}

/** "3 unacked (1 escalated)"; escalated is a subset of unacked (§21.2). */
export const unackedText = (c: Pick<Counts, 'unacked' | 'escalated'>) =>
  c.unacked ? `${c.unacked} unacked${c.escalated ? ` (${c.escalated} escalated)` : ''}` : null;

/** KPI captions (Main3). */
export function sitesOkCaption(c: Counts): string {
  const parts = [c.down ? `${c.down} down` : null, c.problem ? `${c.problem} problem` : null].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'Nothing down or in problem';
}

export function openCaption(c: Counts): string {
  return unackedText(c) ?? (c.open ? 'All acknowledged' : 'None open');
}

/** How many live issues carry this viewer's chip ("2 yours", the phone's third card). */
export const mineCount = (viewer: OverviewViewer, issues: readonly LiveIssue[]) =>
  issues.filter((i) => chipOf(viewer, i.site)).length;

/** The Live issues header line (Main3): "8 of 11 monitored sites · 3 unacked (1 escalated) · 2 yours". */
export function attnMeta(viewer: OverviewViewer, issues: readonly LiveIssue[], c: Counts): string {
  const parts = [`${issues.length} of ${c.monitored} monitored sites`];
  const unacked = unackedText(c);
  if (unacked) parts.push(unacked);
  const mine = mineCount(viewer, issues);
  if (mine && (viewer.kind === 'admin' || viewer.kind === 'responder')) parts.push(`${mine} yours`);
  if (mine && viewer.kind === 'am') parts.push(`${mine} ${mine === 1 ? 'your client' : 'your clients'}`);
  return parts.join(' · ');
}

/** The phone's third count card (§21.8): Yours · Your clients · Uptime 30 d. */
export function thirdCard(
  viewer: OverviewViewer,
  issues: readonly LiveIssue[],
  uptime30d: number,
): { value: string; label: string } {
  if (viewer.kind === 'admin' || viewer.kind === 'responder') {
    return { value: String(mineCount(viewer, issues)), label: 'Yours' };
  }
  if (viewer.kind === 'am') return { value: String(mineCount(viewer, issues)), label: 'Your clients' };
  return { value: formatPercent(uptime30d), label: 'Uptime 30 d' };
}

/** A tile's second line and markers (§21.6). */
export function tileState(
  site: OverviewSite,
  now: Date,
): { state: string; markers: { icon: 'shield-alert' | 'bell' | 'eye-off'; label: string }[] } {
  const inc = site.incident;
  const markers: { icon: 'shield-alert' | 'bell' | 'eye-off'; label: string }[] = [];
  const chain = chainLocations(site);
  if (chain.length) markers.push({ icon: 'shield-alert', label: 'TLS chain error' });
  if (inc) markers.push({ icon: 'bell', label: 'Open incident' });
  if (isMuted(site, now) && site.mutedUntil) {
    markers.push({ icon: 'eye-off', label: `Muted until ${formatTime(new Date(site.mutedUntil))}` });
  }
  let state = '';
  if (site.status === null) state = 'No data yet';
  else if (site.status === 'down' && inc) {
    state =
      inc.state === 'escalated'
        ? `Escalated L${inc.level} · unacked`
        : inc.state === 'unacked'
          ? 'Unacked'
          : `Acked · ${inc.ackedBy ?? 'acknowledged'}`;
  } else if (site.status === 'problem') {
    const since = inc?.startedAt ?? site.statusSince;
    const label = inc ? TRIGGER_LABELS[inc.trigger] : 'Problem';
    state = since ? `${label} · ${formatDuration(minutesBetween(since, now))}` : label;
  } else if (site.status === 'maintenance') state = 'Maintenance';
  else if (inc && RECOVERED.includes(inc.state)) state = 'Root cause due';
  else if (chain.length) state = `TLS chain · ${chain.join(', ')}`;
  else if (isMuted(site, now)) state = 'Muted';
  else if (OVERVIEW_LOCATIONS.some((l) => site.locations[l] === 'blocked')) {
    state = 'Blocked by bot protection · verified';
  }
  return { state, markers };
}

/** The severity of the drop an event is about: a relapse carries its own (D-023), else the incident's. */
const dropSeverity = (e: OverviewEvent) =>
  e.payload.severity === 'down' || e.payload.severity === 'problem' ? e.payload.severity : e.severity;

/** Recent events wording (Main3); null = not shown. No escalation copy until S08 (D-032). */
export function eventLine(e: OverviewEvent): string | null {
  const inc = formatIncidentId(e.incidentNumber);
  const where = typeof e.payload.confirmingLocations === 'number' ? e.payload.confirmingLocations : null;
  const confirmed = `${e.siteName} DOWN confirmed${where ? ` — ${where}/3 locations` : ''}`;
  switch (e.type) {
    case 'detected':
      // a PROBLEM opens with its summary; without one (a script-made incident), one never raised to DOWN
      if (typeof e.payload.summary === 'string')
        return `${e.siteName} PROBLEM — ${capitalise(e.payload.summary)}`;
      return e.severity === 'problem' ? `${e.siteName} PROBLEM — ${TRIGGER_LABELS[e.trigger]}` : confirmed;
    case 'escalated_to_down':
      return confirmed;
    case 'acknowledged':
      return `${inc} acked by ${e.actorName ?? 'someone'}`;
    case 'ack_undone':
      return `${inc} acknowledgement undone by ${e.actorName ?? 'someone'}`;
    case 'recovered':
      // a short PROBLEM that resolved itself says so once, on its auto_resolved line
      if (e.autoResolved) return null;
      return dropSeverity(e) === 'down'
        ? `${e.siteName} back up — root cause needed`
        : `${e.siteName} back to OK`;
    case 'auto_resolved':
      return `${e.siteName} back to OK — resolved automatically`;
    case 'relapsed':
      return `${e.siteName} ${dropSeverity(e) === 'down' ? 'DOWN' : 'PROBLEM'} again`;
    default:
      return null;
  }
}

/** The event types Recent events words, for the query. */
export const EVENT_TYPES = [
  'detected',
  'escalated_to_down',
  'acknowledged',
  'ack_undone',
  'recovered',
  'auto_resolved',
  'relapsed',
] as const;

/** Newest first, at most `max` (Main3: 7); events only grow (§16.11). */
export function recentEvents(
  events: readonly OverviewEvent[],
  now: Date,
  max = 7,
): { id: string; time: string; text: string }[] {
  return [...events]
    .sort((a, b) => b.at.localeCompare(a.at))
    .flatMap((e) => {
      const text = eventLine(e);
      const at = new Date(e.at);
      return text
        ? [{ id: e.id, time: isSameBangkokDay(at, now) ? formatTime(at) : formatWhen(at, now), text }]
        : [];
    })
    .slice(0, max);
}

/** An acknowledgement on screen at once (§21.1): the banner goes, the row reads "Acked by …". */
export function withAck(sites: readonly OverviewSite[], incidentId: string, by: string): OverviewSite[] {
  return sites.map((s) =>
    s.incident?.id === incidentId
      ? { ...s, incident: { ...s.incident, state: 'acknowledged', ackedBy: by } }
      : s,
  );
}
