import {
  windowEnd,
  windowState,
  type MaintenanceWindow,
  type WindowKind,
  type WindowState,
} from '@dxt/engine';
import { formatTime } from '@dxt/shared';
import { whenText } from './model';

/**
 * The Overview "Maintenance & mutes" card (board Main, spec §15.1, D-036): its rows, End now and Edit /
 * cancel wording, and the Recent events lines. Pure — the loader hands it plain rows.
 */

/** One window or mute as the card reads it. Times are ISO strings (server → client). */
export interface WindowRow {
  id: string;
  siteId: string;
  siteName: string;
  kind: WindowKind;
  startsAt: string;
  endsAt: string;
  approvedAt: string | null;
  endedAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
  reason: string;
  endReason: string | null;
  byName: string | null;
  endedByName: string | null;
  ownerName: string | null;
  /** The site's owner and backup (who may change it besides an Admin). */
  ownerIds: string[];
}

export const asWindow = (r: WindowRow): MaintenanceWindow => ({
  kind: r.kind,
  startsAt: new Date(r.startsAt),
  endsAt: new Date(r.endsAt),
  approvedAt: r.approvedAt ? new Date(r.approvedAt) : null,
  endedAt: r.endedAt ? new Date(r.endedAt) : null,
  cancelledAt: r.cancelledAt ? new Date(r.cancelledAt) : null,
});

export const stateOf = (r: WindowRow, now: Date): WindowState => windowState(asWindow(r), now);
export const nounOf = (kind: WindowKind) => (kind === 'mute' ? 'mute' : 'maintenance');

/** Rows the card lists: running first, then waiting for approval, then scheduled, soonest first. */
export function cardRows(rows: readonly WindowRow[], now: Date): WindowRow[] {
  const rank: Partial<Record<WindowState, number>> = { active: 0, waiting: 1, scheduled: 2 };
  return rows
    .filter((r) => rank[stateOf(r, now)] !== undefined)
    .sort(
      (a, b) =>
        rank[stateOf(a, now)]! - rank[stateOf(b, now)]! || Date.parse(a.startsAt) - Date.parse(b.startsAt),
    );
}

/** "WeCare Studio — maintenance", "DxT Games — muted", "… — maintenance · waiting for approval". */
export function rowTitle(r: WindowRow, now: Date): string {
  const word = r.kind === 'mute' ? 'muted' : 'maintenance';
  return `${r.siteName} — ${word}${stateOf(r, now) === 'waiting' ? ' · waiting for approval' : ''}`;
}

/** "09:30 → 14:00 · CMS upgrade · by Nok · not counted in uptime" / "until 18:00 (max 24 h) · …". */
export function rowDetail(r: WindowRow, now: Date): string {
  const end = new Date(r.endsAt);
  const span =
    r.kind === 'mute'
      ? `until ${whenText(end, now)} (max 24 h)`
      : `${whenText(new Date(r.startsAt), now)} → ${whenText(end, now)}`;
  const by = r.byName ? ` · by ${r.byName}` : '';
  const uptime = r.kind === 'mute' ? ' · still counted in uptime' : ' · not counted in uptime';
  return `${span} · ${r.reason}${by}${uptime}`;
}

/** The End now confirm's description, without the uptime part: "Muted until 18:00 · redeploying build · by Tao". */
export function confirmDescription(r: WindowRow, now: Date): string {
  const end = new Date(r.endsAt);
  const span =
    r.kind === 'mute'
      ? `Muted until ${whenText(end, now)}`
      : `${whenText(new Date(r.startsAt), now)} → ${whenText(end, now)}`;
  return `${span} · ${r.reason}${r.byName ? ` · by ${r.byName}` : ''}`;
}

/** What ending it early does (board Main, End early confirm). */
export function endEffects(r: WindowRow, viewer: string, now: Date): string[] {
  const resume = `Alerts resume now${r.ownerName ? ` for ${r.ownerName} (owner)` : ''} and the Alerts Space.`;
  if (r.kind === 'mute')
    return [
      resume,
      'Uptime is unaffected — muted time was already counted.',
      `Logged in the audit log as ${viewer}.`,
    ];
  return [
    resume,
    `Checks from ${formatTime(now)} count in uptime again; ${whenText(new Date(r.startsAt), now)}–${formatTime(now)} stays excluded.`,
    `Logged in the audit log as ${viewer}.`,
  ];
}

/** What cancelling does: a running one ends now (its time stays excluded), a scheduled one never happens. */
export function cancelText(r: WindowRow, viewer: string, now: Date): string {
  const owner = r.ownerName ? ` for ${r.ownerName}` : '';
  if (r.kind === 'mute')
    return `Cancelling ends the mute now and marks it Cancelled. Alerts resume${owner} and the Alerts Space. Logged as ${viewer}.`;
  if (stateOf(r, now) === 'active')
    return `It has already started, so cancelling ends it now and marks it Cancelled; ${whenText(new Date(r.startsAt), now)}–${formatTime(now)} stays excluded from uptime. Alerts resume${owner} and the Alerts Space. Logged as ${viewer}.`;
  return `It hasn’t started, so it won’t happen and alerts carry on as usual. Logged as ${viewer}.`;
}

const H = 3_600_000;

/** The "Ends" choices: the current end, and earlier / later hours that keep it valid (a mute ≤ 24 h). */
export function endChoices(r: WindowRow, now: Date): { value: string; label: string }[] {
  const start = Date.parse(r.startsAt);
  const current = Date.parse(r.endsAt);
  const floor = Math.max(now.getTime(), start);
  const cap = r.kind === 'mute' ? start + 24 * H : start + 31 * 24 * H;
  const offsets = [-4, -2, -1, 0, 1, 2, 4, 8, 24];
  const ends = [...new Set(offsets.map((h) => current + h * H))].filter(
    (t) => t === current || (t > floor && t <= cap),
  );
  return ends
    .sort((a, b) => a - b)
    .map((t) => {
      const at = new Date(t);
      return { value: at.toISOString(), label: `${whenText(at, now)}${t === current ? ' (current)' : ''}` };
    });
}

export interface WindowEvent {
  id: string;
  at: string;
  text: string;
}

/** Recent events lines from the last day's windows (Main3: "DxT Games muted until 18:00 — Tao"). */
export function windowEvents(rows: readonly WindowRow[], now: Date): WindowEvent[] {
  const since = now.getTime() - 24 * H;
  const out: WindowEvent[] = [];
  for (const r of rows) {
    const noun = nounOf(r.kind);
    const created = Date.parse(r.createdAt);
    if (created >= since) {
      const text =
        r.kind === 'mute'
          ? `${r.siteName} muted until ${whenText(new Date(r.endsAt), now)}`
          : `${r.siteName} maintenance ${whenText(new Date(r.startsAt), now)} → ${whenText(new Date(r.endsAt), now)}`;
      out.push({ id: `${r.id}:c`, at: r.createdAt, text: `${text}${r.byName ? ` — ${r.byName}` : ''}` });
    }
    const by = r.endedByName ? ` — ${r.endedByName}` : '';
    if (r.cancelledAt && Date.parse(r.cancelledAt) >= since) {
      out.push({ id: `${r.id}:x`, at: r.cancelledAt, text: `${r.siteName} ${noun} cancelled${by}` });
    } else if (r.endedAt && Date.parse(r.endedAt) >= since) {
      out.push({ id: `${r.id}:e`, at: r.endedAt, text: `${r.siteName} ${noun} ended early${by}` });
    }
  }
  return out;
}

/** May this person change the row: an Admin, or the site's owner or backup (D-012, D-036). */
export const mayChange = (r: WindowRow, viewer: { id: string; isAdmin: boolean }) =>
  viewer.isAdmin || r.ownerIds.includes(viewer.id);

/** The window's real end, for "ended at" lines. */
export const realEnd = (r: WindowRow) => windowEnd(asWindow(r));
