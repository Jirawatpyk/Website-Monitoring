import { formatIncidentId, formatTime } from '@dxt/shared';
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
  | { kind: 'ok'; text: string }
  | { kind: 'incident'; text: string; incidentId: string };

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
  /** Who may press, when this person can't: "Read only" / "Only Arm, the person on call or an Admin". */
  readOnly: string | null;
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
  const downs = checks.filter((c) => c.outcome === 'down');
  const rest = asOf ? `as of ${asOf}` : 'not in yet';
  if (!downs.length) return asOf ? `As of ${asOf} · hand-check Tier 1 below` : 'Hand-check Tier 1 below';
  // Newest first: the first is the latest press.
  return `${downs.length} down by hand check ${formatTime(new Date(downs[0]!.at))} · the rest ${rest}`;
}

export function handCheckOf(
  sites: readonly OverviewSite[],
  checks: readonly HandCheckEntry[],
  viewer: OverviewViewer,
  fault: MonitorFault,
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
    const line: HandCheckLine =
      last?.outcome === 'down' && last.incidentId && last.incidentNumber !== null
        ? {
            kind: 'incident',
            text: `${formatIncidentId(last.incidentNumber)} opened · ${last.by} ${formatTime(new Date(last.at))}`,
            incidentId: last.incidentId,
          }
        : last?.outcome === 'ok'
          ? { kind: 'ok', text: `Checked OK · ${last.by} ${formatTime(new Date(last.at))}` }
          : { kind: 'none', text: 'Not checked yet' };
    const openedByHand = line.kind === 'incident';
    return {
      siteId: s.id,
      name: s.name,
      url: s.url ?? null,
      ownerName: s.ownerName,
      status: s.status,
      line,
      // Once opened by hand the row's buttons go (§30.2).
      canCheck: may && !openedByHand,
      canOpen: may && !openedByHand && !open,
      readOnly: may
        ? null
        : staff && s.ownerName
          ? `Only ${s.ownerName}, the person on call or an Admin`
          : 'Read only',
    };
  });

  const checked = rows.filter((r) => r.line.kind !== 'none').length;
  const since = formatTime(new Date(fault.sweepAt));
  // The next round of checks: 30 min after the oldest of each site's latest check.
  const oldest = [...latest.values()]
    .filter((c) => tier1.some((s) => s.id === c.siteId))
    .map((c) => new Date(c.at).getTime())
    .sort((a, b) => a - b)[0];
  const footer =
    oldest === undefined
      ? `Nothing checked yet${fault.onCallName ? ` — ${fault.onCallName} (on call) was @mentioned at ${formatTime(new Date(fault.alertedAt))}` : ''}.`
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
