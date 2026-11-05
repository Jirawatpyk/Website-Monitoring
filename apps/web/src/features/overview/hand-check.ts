import { CLIENT_UPDATE_MIN } from '@dxt/engine';
import { formatIncidentId, formatTime, INCIDENT_STATE_LABELS, TRIGGER_LABELS } from '@dxt/shared';
import { canAck } from './model';
import type { HandCheckEntry, MonitorFault, OverviewSite, OverviewViewer } from './types';

/**
 * The hand check (S12b, spec §30.2–4, MainFault / MOverview4 FAULT): while the engine's sweep is stale,
 * one row per live Tier 1 site — record "Loads OK", or "Down — open incident". Who presses is the
 * Acknowledge rule (§30.3); everyone else reads it.
 */

/** Ask for a check again every 30 min while monitoring is degraded (§30.2). */
export const HAND_CHECK_EVERY_MIN = 30;

export type HandCheckLine =
  | { kind: 'none'; text: 'Not checked yet' }
  /** "Checked OK · Tao 02:31", with a small "Open INC-0142" when the site has an open incident (§31.1). */
  | { kind: 'ok'; text: string; incident?: { id: string; text: string } }
  /** "INC-0143 opened · Tao 02:31" / "INC-0142 reported down · Tao 02:40": a drop reported here. */
  | { kind: 'incident'; text: string; incidentId: string }
  /** "Open INC-0142 · Needs root cause" / "Open INC-0150 · Problem · Slow": the site's open incident. */
  | {
      kind: 'open';
      text: string;
      incidentId: string;
      tone: 'warning' | 'danger';
    };

export interface HandCheckRow {
  siteId: string;
  name: string;
  url: string | null;
  ownerName: string | null;
  status: OverviewSite['status'];
  line: HandCheckLine;
  /** Loads OK can be pressed (again). */
  canCheck: boolean;
  /** "Down — open incident": none once the site has an open incident. */
  canOpen: boolean;
  /** Who may press, when this person can't: "Read only" / "Only Arm or Ploy, the person on call or an Admin". */
  readOnly: string | null;
  /** Under the status: "as of 02:17", or "by hand 02:31" once reported down by hand. */
  statusNote: string | null;
  /** Down can't be pressed on a muted site or one in maintenance (§15.1): why. */
  paused: string | null;
  /** The site's open incident (the row's line links it, §31.1). */
  openIncident: {
    id: string;
    /** "INC-0142". */
    ref: string;
    /** Down again by hand (D-055 item 7): a recovered incident relapses, a PROBLEM is raised; null = no button. */
    downAgain: 'relapse' | 'raise' | null;
    /** The confirm's info lines (§31.2–3): who is @mentioned, what happens to the ladder. */
    info: string[];
  } | null;
}
export interface HandCheckCard {
  rows: HandCheckRow[];
  /** "2 of 5 checked since 02:17". */
  count: string;
  /** Phones: "2 of 5 checked". */
  shortCount: string;
  /** "Nothing checked yet — Ploy (on call) was @mentioned at 02:20." / "Next check due by 03:01 — …". */
  footer: string;
  /** "Tier 2–3 (6 sites): not needed — the hand check covers Tier 1 only."; null with none. */
  otherTiers: string | null;
}

/**
 * The Sites OK caption during the hand check (§30.1): "As of 02:17 · hand-check Tier 1 below", then
 * "1 down by hand check 02:31 · the rest as of 02:17".
 */
export function sitesOkByHand(checks: readonly HandCheckEntry[], asOf: string | null): string {
  const latest = new Map<string, HandCheckEntry>();
  for (const c of checks) if (!latest.has(c.siteId)) latest.set(c.siteId, c);
  const downs = [...latest.values()].filter((c) => c.outcome === 'down');
  const rest = asOf ? `as of ${asOf}` : 'not in yet';
  if (!downs.length) return asOf ? `As of ${asOf} · hand-check Tier 1 below` : 'Hand-check Tier 1 below';
  // Newest first: the first is the latest press.
  return `${downs.length} down by hand check ${formatTime(new Date(downs[0]!.at))} · the rest ${rest}`;
}

/** A recovered DOWN relapses, a PROBLEM is raised to DOWN; a DOWN still down is the alert already. */
function downAgainOf(inc: NonNullable<OverviewSite['incident']>): 'relapse' | 'raise' | null {
  if (inc.severity === 'problem') return 'raise';
  if (inc.state === 'monitoring' || inc.state === 'needs_root_cause' || inc.dropSeverity === 'problem')
    return 'relapse';
  return null;
}

/** "Needs root cause", "Problem · Slow", "Unacked" — the open incident on the row's line (§31.1). */
function openLabel(inc: NonNullable<OverviewSite['incident']>): string {
  return inc.severity === 'problem'
    ? `Problem · ${TRIGGER_LABELS[inc.trigger]}`
    : INCIDENT_STATE_LABELS[inc.state];
}

/**
 * The confirm's info lines (§31.2–3). A relapse @mentions whoever acknowledged it, else the L0 person
 * (§19.3); a raise pages L0 — the person on call outside response hours, else the owner.
 */
function infoOf(
  s: OverviewSite,
  inc: NonNullable<OverviewSite['incident']>,
  kind: 'relapse' | 'raise',
  fault: MonitorFault,
  now: Date,
): string[] {
  const ref = formatIncidentId(inc.number);
  const onCall = fault.onCallName ? `${fault.onCallName} (on call)` : 'the person on call';
  const owner = s.ownerName ? `${s.ownerName} (owner)` : 'the owner';
  if (kind === 'relapse') {
    const who = inc.ackedBy ? `${inc.ackedBy} — who acknowledged it` : inc.l0UserId ? onCall : owner;
    return [
      `Posts DOWN AGAIN in ${ref}’s thread now, @mentioning ${who}.`,
      `Levels already reached stay: it goes back to ${inc.ackedBy ? 'Acknowledged' : inc.level > 0 ? 'Escalated' : 'Unacked'} and doesn’t start over at L0.`,
    ];
  }
  // An acknowledged PROBLEM stays acknowledged when raised: no ladder restart (engine_escalate_incident).
  const lines = inc.ackedBy
    ? [
        `Raises ${ref} to DOWN and posts the DOWN alert now.`,
        `${inc.ackedBy} acknowledged it, so it stays Acknowledged and no DOWN ladder starts.`,
      ]
    : [
        `Raises ${ref} to DOWN and posts the DOWN alert now, @mentioning ${fault.outsideHours ? onCall : owner}.`,
        'The DOWN ladder starts from now — while the engine is down, send each level with Escalate now on the incident.',
      ];
  const minutes = CLIENT_UPDATE_MIN[s.tier];
  if (s.clientSite && minutes !== undefined)
    lines.push(
      `Client site: the client-update clock starts now (due ${formatTime(new Date(now.getTime() + minutes * 60_000))}).`,
    );
  return lines;
}

export function handCheckOf(
  sites: readonly OverviewSite[],
  checks: readonly HandCheckEntry[],
  viewer: OverviewViewer,
  fault: MonitorFault,
  now: Date = new Date(),
): HandCheckCard {
  const tier1 = sites.filter((s) => s.tier === 1);
  // Newest first: the first entry per site is its latest (the row keeps the latest, §30.2).
  const latest = new Map<string, HandCheckEntry>();
  for (const c of checks) if (!latest.has(c.siteId)) latest.set(c.siteId, c);
  const staff = viewer.kind === 'admin' || viewer.kind === 'responder';

  const rows = tier1.map((s): HandCheckRow => {
    const last = latest.get(s.id);
    const may = canAck(viewer, s);
    const open = s.incident;
    const at = (t: string) => formatTime(new Date(t));
    const reportedHere =
      last?.outcome === 'down' && last.incidentId && last.incidentNumber !== null ? last : null;
    // Down by hand and still down: the row's buttons go (§30.2, §31.4). Once that incident recovers or
    // closes they come back, so a later drop can be reported again.
    const openedByHand =
      !!reportedHere && !!open && reportedHere.incidentId === open.id && downAgainOf(open) === null;
    const openRef = open ? formatIncidentId(open.number) : null;
    const line: HandCheckLine =
      openedByHand && reportedHere
        ? {
            kind: 'incident',
            text: `${formatIncidentId(reportedHere.incidentNumber!)} ${reportedHere.reported ? 'reported down' : 'opened'} · ${reportedHere.by} ${at(reportedHere.at)}`,
            incidentId: reportedHere.incidentId!,
          }
        : last?.outcome === 'ok'
          ? {
              kind: 'ok',
              text: `Checked OK · ${last.by} ${at(last.at)}`,
              ...(open && openRef ? { incident: { id: open.id, text: `Open ${openRef}` } } : {}),
            }
          : open && openRef
            ? {
                kind: 'open',
                text: `Open ${openRef} · ${openLabel(open)}`,
                incidentId: open.id,
                tone: downAgainOf(open) === null ? 'danger' : 'warning',
              }
            : reportedHere
              ? {
                  kind: 'incident',
                  text: `${formatIncidentId(reportedHere.incidentNumber!)} ${reportedHere.reported ? 'reported down' : 'opened'} · ${reportedHere.by} ${at(reportedHere.at)}`,
                  incidentId: reportedHere.incidentId!,
                }
              : { kind: 'none', text: 'Not checked yet' };
    const paused =
      s.status === 'maintenance'
        ? 'In maintenance — no alert goes out'
        : s.mutedUntil && new Date(s.mutedUntil) > now
          ? `Muted until ${formatTime(new Date(s.mutedUntil))} — no alert goes out`
          : null;
    // "Down · by hand 02:40" while a drop reported by hand is still down (§31.4, also a manual open).
    const downByHand = open?.byHand && downAgainOf(open) === null ? open.byHand : null;
    const kind = open && may && !paused ? downAgainOf(open) : null;
    return {
      siteId: s.id,
      name: s.name,
      url: s.url ?? null,
      ownerName: s.ownerName,
      status: s.status,
      line,
      canCheck: may && !openedByHand,
      canOpen: may && !openedByHand && !open && !paused,
      statusNote: downByHand
        ? `by hand ${at(downByHand.at)}`
        : openedByHand && last
          ? `by hand ${at(last.at)}`
          : fault.asOf
            ? `as of ${at(fault.asOf)}`
            : null,
      paused: may && !openedByHand ? paused : null,
      openIncident:
        open && openRef && !openedByHand
          ? {
              id: open.id,
              ref: openRef,
              downAgain: kind,
              info: kind ? infoOf(s, open, kind, fault, now) : [],
            }
          : null,
      readOnly: may
        ? null
        : staff && s.ownerName
          ? `Only ${s.ownerName}${s.backupName ? ` or ${s.backupName}` : ''}, the person on call or an Admin`
          : 'Read only',
    };
  });

  // Real hand checks only: an open incident's line is not a check (§30.2, §31.1).
  const checked = tier1.filter((s) => latest.has(s.id)).length;
  const since = formatTime(new Date(fault.sweepAt));
  // The next round of checks: 30 min after the oldest of each site's latest check.
  const oldest = [...latest.values()]
    .filter((c) => tier1.some((s) => s.id === c.siteId))
    .map((c) => new Date(c.at).getTime())
    .sort((a, b) => a - b)[0];
  const footer =
    oldest === undefined
      ? `Nothing checked yet${fault.onCallName ? ` — ${fault.onCallName} (on call) was @mentioned at ${formatTime(new Date(fault.alertedAt))}` : ''}.`
      : oldest + HAND_CHECK_EVERY_MIN * 60_000 <= now.getTime()
        ? `Check overdue since ${formatTime(new Date(oldest + HAND_CHECK_EVERY_MIN * 60_000))} — every ${HAND_CHECK_EVERY_MIN} min while monitoring is degraded.`
        : `Next check due by ${formatTime(new Date(oldest + HAND_CHECK_EVERY_MIN * 60_000))} — every ${HAND_CHECK_EVERY_MIN} min while monitoring is degraded.`;
  const others = sites.length - tier1.length;
  return {
    rows,
    count: `${checked} of ${rows.length} checked since ${since}`,
    shortCount: `${checked} of ${rows.length} checked`,
    footer,
    otherTiers: others
      ? `Tier 2–3 (${others} ${others === 1 ? 'site' : 'sites'}): not needed — the hand check covers Tier 1 only.`
      : null,
  };
}
