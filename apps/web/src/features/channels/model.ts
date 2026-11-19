import { FLAP_CHANGES, FLAP_STABLE_MS, FLAP_WINDOW_MS } from '@dxt/engine';
import {
  formatDay,
  formatDurationSeconds,
  formatIncidentId,
  formatMs,
  formatResponseHours,
  formatTime,
  formatTimeWithSeconds,
  isSameBangkokDay,
  type EscalationStep,
} from '@dxt/shared';

/**
 * Settings › Alert channels (board AlertChannels; spec §10, §14.8, §15.5; S17, D-069): the channel
 * cards, "Who gets what" read-only (D-069 item 3), the three read-only cards and the delivery log.
 * Pure, so the page and the tests share it.
 */

// ── Who gets what ────────────────────────────────────────────────────────

const SHORT: Record<EscalationStep['channels'][number], string> = {
  chat: 'Chat',
  space: 'Space',
  email: 'email',
  voice: 'voice',
};

/** "L0 Chat + Space + email · L1 +15 · L2 +30 · L3 +60" — a policy's ladder in one line (board). */
export function ladderLine(steps: readonly EscalationStep[]): string {
  const sorted = [...steps].sort((a, b) => a.level - b.level);
  const l0 = sorted.find((s) => s.level === 0);
  const head = l0
    ? `L0 ${l0.channels
        .filter((c) => c !== 'voice')
        .map((c) => SHORT[c])
        .join(' + ')}`
    : 'L0';
  return [head, ...sorted.filter((s) => s.level > 0).map((s) => `L${s.level} +${s.delayMin}`)].join(' · ');
}

/** "Tier 1: L2 page · L3 FYI" — the Tier 1 DOWN steps that name the CEO, from the policy (Escalation). */
export function ceoLine(t1Down: readonly EscalationStep[]): string {
  const steps = [...t1Down]
    .filter((s) => s.targets.includes('ceo'))
    .sort((a, b) => a.level - b.level)
    .map((s) => `L${s.level} ${s.fyi ? 'FYI' : 'page'}`);
  return steps.length ? `Tier 1: ${steps.join(' · ')}` : 'Not paged — the daily digest';
}

export interface RoutingRow {
  id: 'down' | 'problem' | 'expiry' | 'recovery' | 'fault';
  event: string;
  tone: 'danger' | 'warning' | 'success' | 'neutral';
  variant: 'solid' | 'soft' | 'outline';
  icon: 'ban' | 'triangle-alert' | 'circle-check' | 'lock' | 'monitor';
  note: string;
  /** Where it is set: Escalation (DOWN, PROBLEM, SSL / domain) or nowhere (fixed). */
  setIn: 'escalation' | 'fixed';
  /** The ladder or the rule, one line. */
  how: string;
  ceo: string;
  /** Monitor fault with one active Admin: whose inbox it reaches (board's warning line). */
  onlyAdmin: string | null;
}

export interface Ladders {
  t1Down: readonly EscalationStep[];
  t2Down: readonly EscalationStep[];
  t3Down: readonly EscalationStep[];
  problem: readonly EscalationStep[];
}

/**
 * The board's five rows, read-only (D-069 item 3): DOWN, PROBLEM and SSL / domain are set per step in
 * Escalation (an expiry is a PROBLEM, D-066); Recovery follows whoever was told; Monitor fault is fixed.
 */
export function routingRows(l: Ladders, admins: readonly string[]): RoutingRow[] {
  return [
    {
      id: 'down',
      event: 'Down',
      tone: 'danger',
      variant: 'solid',
      icon: 'ban',
      note: 'Posted at once, any hour · who and how per level',
      setIn: 'escalation',
      // Tier 2 and Tier 3 are stored and edited apart (D-034): one line while they match.
      how:
        ladderLine(l.t2Down) === ladderLine(l.t3Down)
          ? `Tier 1: ${ladderLine(l.t1Down)} · Tier 2–3: ${ladderLine(l.t2Down)}`
          : `Tier 1: ${ladderLine(l.t1Down)} · Tier 2: ${ladderLine(l.t2Down)} · Tier 3: ${ladderLine(l.t3Down)}`,
      ceo: ceoLine(l.t1Down),
    },
    {
      id: 'problem',
      event: 'Problem',
      tone: 'warning',
      variant: 'soft',
      icon: 'triangle-alert',
      note: 'Tier 2–3 held until the response hours open · Tier 1 outside them → on-call',
      setIn: 'escalation',
      how: ladderLine(l.problem),
      ceo: 'Daily digest',
    },
    {
      id: 'expiry',
      event: 'SSL / domain',
      tone: 'neutral',
      variant: 'outline',
      icon: 'lock',
      note: 'SSL < 14 d · domain < 30 d · opens inside response hours',
      setIn: 'escalation',
      how: `Uses the PROBLEM policy · ${ladderLine(l.problem)}`,
      ceo: 'Weekly summary',
    },
    {
      id: 'recovery',
      event: 'Recovery',
      tone: 'success',
      variant: 'soft',
      icon: 'circle-check',
      note: 'Reply in the same thread',
      setIn: 'fixed',
      how: 'Everyone told in that incident: a Chat reply, and an email to whoever was emailed',
      ceo: 'Only if paged in that incident',
    },
    {
      id: 'fault',
      event: 'Monitor fault',
      tone: 'neutral',
      variant: 'outline',
      icon: 'monitor',
      note: 'Engine heartbeat missed > 3 min → email the Admins + Alerts Space post @mentioning on-call. One probe (BKK, SIN or TYO) missing > 3 min → email the Admins only, no page.',
      setIn: 'fixed',
      how: 'Fixed: the Healthchecks email and the VPS watchdog’s Space post',
      ceo: '—',
      onlyAdmin: admins.length === 1 ? admins[0]! : null,
    },
  ].map((r) => ({ onlyAdmin: null, ...r }) as RoutingRow);
}

// ── The three read-only cards ────────────────────────────────────────────

/** "3 or more status changes within 30 min → … stable for 15 min" — the engine's own numbers. */
export const FLAPPING = {
  changes: FLAP_CHANGES,
  windowMin: FLAP_WINDOW_MS / 60_000,
  stableMin: FLAP_STABLE_MS / 60_000,
};

export function hoursLine(h: { startMin: number; endMin: number; days: readonly number[] }): string {
  return formatResponseHours(h);
}

// ── Delivery log ─────────────────────────────────────────────────────────

export interface LogNotification {
  id: string;
  channel: 'google_chat' | 'email' | 'voice';
  template: string;
  status: 'queued' | 'sent' | 'failed' | 'cancelled';
  attempts: number;
  createdAt: string;
  holdUntil: string | null;
  sentAt: string | null;
  incidentNumber: number | null;
  reportKind: 'daily' | 'weekly' | null;
  oncallKind: string | null;
  /** The email's recipient. */
  to: string | null;
  /** A channel test's tester (its Chat card @mentions only them). */
  chatTo?: string | null;
}

export interface LogRow {
  id: string;
  at: string;
  inc: string;
  ch: string;
  to: string;
  tries: string;
  lat: string;
  status: string;
  tone: 'success' | 'warning' | 'danger' | 'neutral';
  icon: 'circle-check' | 'triangle-alert' | 'circle-alert' | 'clock' | 'minus';
}

/** Spec §10 / PRD §9: a Chat post is due within 30 s of the confirm. */
export const LATE_MS = 30_000;

const TEMPLATE_WORDS: Record<string, string> = {
  down: 'DOWN',
  problem: 'PROBLEM',
  down_again: 'DOWN AGAIN',
  problem_again: 'PROBLEM AGAIN',
  new_cause: 'new cause',
  recovered: 'RECOVERED',
  flap_summary: 'flapping summary',
  acknowledged: 'acknowledged',
  resolved: 'RESOLVED',
  step_fired: 'escalation',
  reminder: 'reminder',
  client_update_due: 'client update due',
  note: 'note',
  muted: 'muted',
  daily_digest: 'daily digest',
  weekly_summary: 'weekly summary',
};

/** From when it was due (its hold, or its queueing) to when it went (dispatch.ts counts the same way). */
export function latencyMs(n: Pick<LogNotification, 'createdAt' | 'holdUntil' | 'sentAt'>): number | null {
  if (!n.sentAt) return null;
  const due = Date.parse(n.holdUntil ?? n.createdAt);
  return Math.max(0, Date.parse(n.sentAt) - due);
}

function statusOf(n: LogNotification, now: Date): Pick<LogRow, 'status' | 'tone' | 'icon'> {
  const lat = latencyMs(n);
  if (n.status === 'sent') {
    if (n.attempts > 1) return { status: 'Late · retried', tone: 'warning', icon: 'triangle-alert' };
    if (lat !== null && lat > LATE_MS) return { status: 'Late', tone: 'warning', icon: 'triangle-alert' };
    return { status: 'Delivered', tone: 'success', icon: 'circle-check' };
  }
  if (n.status === 'failed') return { status: 'Failed', tone: 'danger', icon: 'circle-alert' };
  if (n.status === 'cancelled') return { status: 'Not sent', tone: 'neutral', icon: 'minus' };
  if (n.holdUntil && Date.parse(n.holdUntil) > now.getTime()) {
    const until = new Date(n.holdUntil);
    const when = isSameBangkokDay(until, now)
      ? formatTime(until)
      : `${formatDay(until, { weekday: true })} ${formatTime(until)}`;
    return { status: `Held until ${when}`, tone: 'neutral', icon: 'clock' };
  }
  return { status: n.attempts > 0 ? 'Retrying' : 'Queued', tone: 'neutral', icon: 'clock' };
}

/** What a row was and to whom: "DOWN · Alerts Space thread", "Bua · client update due", "Tao · test". */
function toWords(n: LogNotification): string {
  if (n.oncallKind === 'channel_test')
    return n.channel === 'email'
      ? `${n.to ?? '—'} · “TEST — no action”`
      : `@${n.chatTo ?? 'them'} · “TEST — no action” thread`;
  if (n.reportKind)
    return n.channel === 'email'
      ? `${n.to ?? '—'} · ${n.reportKind === 'daily' ? 'daily digest' : 'weekly summary'}`
      : 'DxT Website Reports Space';
  const what = TEMPLATE_WORDS[n.template] ?? n.template.replaceAll('_', ' ');
  return n.channel === 'email' ? `${n.to ?? '—'} · ${what}` : `${what} · incident thread`;
}

/**
 * The log (board, "Filtered: today's open incidents, digest and retried sends"): today's (Bangkok)
 * incident messages, reports, channel tests and any send that needed a retry, newest first; set-aside
 * messages (cancelled) are left out unless they were retried.
 */
export function logRows(rows: readonly LogNotification[], now: Date, limit = 50): LogRow[] {
  return rows
    .filter(
      (n) =>
        (n.incidentNumber !== null ||
          n.reportKind !== null ||
          n.oncallKind === 'channel_test' ||
          n.attempts > 1) &&
        (n.status !== 'cancelled' || n.attempts > 1),
    )
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))
    .slice(0, limit)
    .map((n) => {
      const at = new Date(n.sentAt ?? n.createdAt);
      const lat = latencyMs(n);
      return {
        id: n.id,
        // The log is today only (the query starts at Bangkok midnight).
        at: formatTimeWithSeconds(at),
        inc:
          n.incidentNumber !== null
            ? formatIncidentId(n.incidentNumber)
            : n.reportKind === 'daily'
              ? 'Digest'
              : n.reportKind === 'weekly'
                ? 'Weekly'
                : n.oncallKind === 'channel_test'
                  ? 'Test'
                  : 'On-call',
        ch: n.channel === 'google_chat' ? 'Google Chat' : n.channel === 'email' ? 'Email' : 'Voice',
        to: toWords(n),
        tries: String(Math.max(n.attempts, n.status === 'sent' ? 1 : 0)),
        lat: lat === null ? '—' : lat < 60_000 ? formatMs(lat) : formatDurationSeconds(lat / 1000),
        ...statusOf(n, now),
      };
    });
}

// ── Channel cards ────────────────────────────────────────────────────────

export interface ChannelFacts {
  chatConnected: boolean;
  emailConnected: boolean;
  /** The sender address ("DxT Monitor <alerts@…>"), never a key. */
  emailFrom: string | null;
  lastChat: { at: string; latencyMs: number | null } | null;
  email24h: { sent: number; failed: number };
}

/** "10:03:44 · 1.2 s" — the newest Chat post, as the board's "Last sent". */
export function lastSentLine(last: ChannelFacts['lastChat'], now: Date): string {
  if (!last) return 'Nothing sent yet';
  const at = new Date(last.at);
  // Spec §13: a time today, "Fri 25 Sep 16:40" otherwise.
  const when = isSameBangkokDay(at, now)
    ? formatTimeWithSeconds(at)
    : `${formatDay(at, { weekday: true })} ${formatTime(at)}`;
  return last.latencyMs === null ? when : `${when} · ${formatMs(last.latencyMs)}`;
}
