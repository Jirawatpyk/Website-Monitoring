import {
  formatDay,
  formatDuration,
  formatIncidentId,
  formatTier,
  formatTime,
  formatConfirmedBy,
  formatTimeWithSeconds,
  isSameBangkokDay,
  PROBE_LOCATIONS,
  TRIGGER_LABELS,
  type ProbeLocation,
  type Trigger,
  formatLocations,
} from '@dxt/shared';
import type { ProblemFacts } from './chat-alerts';
import { downtime } from './downtime';
import {
  formatResume,
  nextRow,
  stoppedWords,
  type LadderFacts,
  type LadderStopped,
} from './escalation-alerts';
import { flapCounts, timesWord, type Drop, type KeyPageFacts } from './relapse-alerts';
import { resolvedLasted } from './resolve-alerts';

/**
 * Alert emails — EmailAlert board, spec §10, PRD §7, cut to what exists today (D-013 / D-016: no
 * client-update buttons until S11; escalation from S08 is L1 only, D-034).
 *
 * One email per event and per person, all under one subject per incident ("MuvMi · Tier 1 ·
 * INC-0142"), so a mail client stacks them like the Chat thread. The provider assigns each
 * email's Message-ID (Resend/SES replaces any we set), so the thread hangs on a stable id of the
 * incident instead: every email carries it in `References`, and every email after a person's first
 * also in `In-Reply-To` — the way GitHub threads its notifications. The status word leads the preheader
 * and the body (it shows in a phone notification); the footer says why this person got it.
 * Table layout, inline styles, 600 px, system fonts, plain-text part, no tracking.
 */

export interface EmailMessage {
  subject: string;
  html: string;
  text: string;
  headers: Record<string, string>;
}

/** Why the recipient got the email — one footer line each (EmailAlert board). */
export type EmailReason = 'owner' | 'acked' | 'fallback' | 'emailed' | 'step';

export interface EmailBaseInput {
  incidentId: string;
  incidentNumber: number;
  site: string;
  tier: number;
  recipientId: string;
  reason: EmailReason;
  /** The incident page (`/incidents/<id>`). */
  incidentUrl: string;
  /** The incident's thread id (`incidentThreadId`). */
  threadId: string;
  /** This is the recipient's first email of the incident: it starts their thread. */
  startsThread: boolean;
  /** `step`: why this person got an escalation email (EmailAlert L1 footers). */
  why?: string;
}

export interface DownEmailInput extends EmailBaseInput {
  confirmedAt: Date;
  cause: string;
  confirmingLocations: number;
  /** Behind a WAF (D-027): who confirmed it and who the WAF blocked. */
  confirmedByWaf?: { from: readonly string[]; blocked: readonly string[] } | null;
  /** A PROBLEM someone had acknowledged, now raised to DOWN (D-021): who has it. */
  ackedBy?: string | null;
  /** The ladder (S08): "acknowledge by 10:03", the Next step row, or timers paused. */
  ladder?: LadderFacts | null;
  /** When it's sent: a time today or tomorrow reads as the time alone. */
  now?: Date;
  /** The first alert after a mute (§24.7, §24.17): when the mute that held it ended. */
  heldUntil?: Date | null;
}

export interface ProblemEmailInput extends EmailBaseInput {
  trigger: Trigger;
  detectedAt: Date;
  /** `formatProblemCause` / `formatProblemSummary` output. */
  cause: string;
  summary: string;
  /** Blocked, not verified: why (the incident context's `verifier`). */
  verifier?: string | null;
  /** The ladder (S08): "Reminder + Nok (backup) at 10:52". */
  ladder?: LadderFacts | null;
  now?: Date;
  /** The first alert after a mute (§24.7, §24.17): when the mute that held it ended. */
  heldUntil?: Date | null;
}

export interface AcknowledgedEmailInput extends EmailBaseInput {
  ackedBy: string;
  ackedAt: Date;
  startedAt: Date;
  confirmedAt: Date;
  /** Set for a PROBLEM incident (EmailAlert PROBLEM thread). */
  problem?: ProblemFacts | null;
  /** The incident's cause line, shown under a PROBLEM's ACKNOWLEDGED (EmailAlert). */
  cause?: string | null;
  /** Minutes down so far by the incident's drops (D-033); without it, first failed check → ack. */
  downMinutes?: number | null;
  /** What the ack stopped (S08): L1 for a DOWN, the reminders for a PROBLEM. */
  stopped?: LadderStopped | null;
}

export interface RecoveredEmailInput extends EmailBaseInput {
  startedAt: Date;
  recoveredAt: Date;
  okLocations: number;
  owner: string | null;
  ack: { by: string; at: Date } | null;
  /** Set for a PROBLEM incident (EmailAlert PROBLEM thread). */
  problem?: ProblemFacts | null;
}

type Template =
  | 'down'
  | 'problem'
  | 'acknowledged'
  | 'recovered'
  | 'flap_summary'
  | 'down_again'
  | 'problem_again'
  | 'resolved';

export interface ResolvedEmailInput extends EmailBaseInput {
  resolvedBy: string;
  resolvedAt: Date;
  /** The incident's closed drops: the "Down for" row counts the DOWN ones (D-033). */
  drops: readonly Drop[];
  /** The category's words ("Hosting / server"). */
  rootCause: string;
  whatHappened: string;
  whatFixedIt: string | null;
}

export interface FlapSummaryEmailInput extends EmailBaseInput {
  severity: 'down' | 'problem';
  drops: readonly Drop[];
  owner: string | null;
  ack: { by: string; at: Date } | null;
  /** Tier 2–3 outside response hours, not acknowledged: "Not yet — outside response hours …". */
  pausedUntil?: Date | null;
}

export interface AutoResolvedEmailInput extends EmailBaseInput {
  trigger: Trigger;
  flaggedAt: Date;
  recoveredAt: Date;
  /** The cause stored when it opened. */
  cause: string | null;
  keyPage?: KeyPageFacts | null;
}

export interface AgainEmailInput extends EmailBaseInput {
  severity: 'down' | 'problem';
  /** The Chat reply's own words: its title and body (D-024: the AGAIN replies are Chat; this is the fallback). */
  title: string;
  body: string;
}

/**
 * AURA light tokens (aura-tokens 5.31) resolved to hex: email clients don't support CSS variables.
 * The board's colours: danger / positive / secondary label, zinc surfaces.
 */
export const EMAIL_COLORS = {
  danger: '#b91c1c',
  /** PROBLEM: amber, never red (spec §11, §19). */
  warning: '#b45309',
  positive: '#3f6212',
  secondary: '#52525b',
  primary: '#18181b',
  canvas: '#fafafa',
  surface: '#ffffff',
  border: '#e4e4e7',
  borderSubtle: '#f4f4f5',
  buttonBorder: '#8e8e97',
  inverted: '#ffffff',
  accentDot: '#d9f99d',
} as const;
const C = EMAIL_COLORS;

const FONT = "-apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
export const EMAIL_FOOTER =
  'Times in Thailand time (UTC+7). This is an automated record — replies aren’t read. Discuss in the Chat thread.';

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export const senderDomain = (from: string) => /@([^>\s]+)>?\s*$/.exec(from)?.[1] ?? 'localhost';

/** `<inc-<id>@notify.example>`: the id every email of one incident refers to. */
export function incidentThreadId(incidentId: string, from: string): string {
  return `<inc-${incidentId}@${senderDomain(from)}>`;
}

const subjectOf = (i: EmailBaseInput) =>
  `${i.site} · ${formatTier(i.tier)} · ${formatIncidentId(i.incidentNumber)}`;

const whyOf = (i: EmailBaseInput): string => {
  switch (i.reason) {
    case 'owner':
      return `You got this because you own ${i.site}.`;
    case 'acked':
      return 'You got this because you acknowledged this incident.';
    case 'fallback':
      return 'You got this because a Google Chat alert for this incident couldn’t be delivered.';
    case 'emailed':
      return 'You got this because you were emailed about this incident.';
    case 'step':
      return i.why ?? 'You got this because this incident wasn’t acknowledged in time.';
  }
};

interface Button {
  label: string;
  href: string;
  primary: boolean;
}

interface Body {
  template: Template;
  color: string;
  bar: string;
  label: string;
  /** Rest of the preheader, after "LABEL —". */
  pre: string;
  headline: string;
  lede: string;
  facts: [string, string][];
  buttons: Button[];
}

function render(input: EmailBaseInput, b: Body): EmailMessage {
  const headers: Record<string, string> = input.startsThread
    ? { References: input.threadId }
    : { 'In-Reply-To': input.threadId, References: input.threadId };
  return emailLayout({ subject: subjectOf(input), why: whyOf(input), footer: EMAIL_FOOTER, headers }, b);
}

export interface Envelope {
  subject: string;
  /** The footer's bold line: why this person got it. */
  why: string;
  footer: string;
  headers: Record<string, string>;
}

/** The body every EmailAlert email fills in (shared with the maintenance emails). */
export type EmailBody = Omit<Body, 'template'>;

/** The EmailAlert layout: status bar, label, headline, lede, facts table, buttons, footer. */
export function emailLayout({ subject, why, footer, headers }: Envelope, b: EmailBody): EmailMessage {
  const preheader = `${b.label} — ${b.pre}`;
  const facts = b.facts
    .map(
      ([k, v]) =>
        `<tr><td style="padding:8px 16px 8px 0;width:120px;vertical-align:top;color:${C.secondary};border-bottom:1px solid ${C.borderSubtle};font-size:13px;line-height:1.5">${escapeHtml(k)}</td>` +
        `<td style="padding:8px 0;vertical-align:top;color:${C.primary};border-bottom:1px solid ${C.borderSubtle};font-size:13px;line-height:1.5">${escapeHtml(v)}</td></tr>`,
    )
    .join('');
  const buttons = b.buttons
    .map((btn) => {
      const style = btn.primary
        ? `background:${C.primary};border:1px solid ${C.primary};color:${C.inverted};font-weight:600`
        : `background:transparent;border:1px solid ${C.buttonBorder};color:${C.primary};font-weight:500`;
      return `<td style="padding-right:10px"><a href="${escapeHtml(btn.href)}" style="display:inline-block;padding:12px 24px;border-radius:9999px;${style};font-size:14px;line-height:18px;text-decoration:none">${escapeHtml(btn.label)}</a></td>`;
    })
    .join('');

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:0;background:${C.canvas}">
<div style="display:none;max-height:0;overflow:hidden">${escapeHtml(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.canvas};font-family:${FONT}">
<tr><td align="center" style="padding:24px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px">
<tr><td style="background:${C.surface};border:1px solid ${C.border};border-radius:8px;overflow:hidden">
<div style="height:6px;line-height:6px;font-size:0;background:${b.bar}">&nbsp;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="padding:22px 28px">
<div style="font-size:13px;font-weight:700;letter-spacing:0.04em;color:${b.color}">${escapeHtml(b.label)}</div>
<div style="margin-top:6px;font-size:26px;line-height:1.25;font-weight:700;color:${C.primary}">${escapeHtml(b.headline)}</div>
<div style="margin-top:6px;font-size:14px;line-height:1.5;color:${C.secondary}">${escapeHtml(b.lede)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:16px;border-top:1px solid ${C.border}">${facts}</table>
<table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:16px"><tr>${buttons}
<td style="padding-left:6px"><span style="display:inline-block;padding:4px 8px;border-radius:4px;background:${C.primary};color:${C.inverted};font-size:13px;font-weight:700">DxT <span style="color:${C.accentDot}">&#9679;</span></span></td></tr></table>
</td></tr></table>
</td></tr>
<tr><td style="padding:16px 8px 0;text-align:center;font-size:12px;line-height:1.5;color:${C.secondary}"><b style="font-weight:600;color:${C.primary}">${escapeHtml(why)}</b><br>${escapeHtml(footer)}</td></tr>
</table>
</td></tr></table>
</body></html>`;

  const text = [
    `${b.label} — ${b.headline}`,
    b.lede,
    '',
    ...b.facts.map(([k, v]) => `${k}: ${v}`),
    '',
    ...(b.buttons.length ? [...b.buttons.map((btn) => `${btn.label}: ${btn.href}`), ''] : []),
    '--',
    why,
    footer,
  ].join('\n');

  return { subject, html, text, headers };
}

const confirmedLabel = (d: Date) => `${formatDay(d, { weekday: true })} ${formatTimeWithSeconds(d)}`;

export function buildDownEmail(input: DownEmailInput): EmailMessage {
  const { site } = input;
  const now = input.now ?? input.confirmedAt;
  const held = input.ackedBy ? null : heldRow(input.heldUntil, input.ladder, now);
  return render(input, {
    template: 'down',
    color: C.danger,
    bar: C.danger,
    label: 'DOWN',
    pre: (held
      ? [site, held.pre, ...ladderPre(input.ladder, now)]
      : [
          `${site} confirmed down ${formatTimeWithSeconds(input.confirmedAt)}`,
          input.cause,
          ...ladderPre(input.ackedBy ? null : input.ladder, now),
        ]
    ).join(' · '),
    headline: `${site} is down`,
    lede: input.ackedBy
      ? `${input.ackedBy} acknowledged it while it was a problem; it is now down.`
      : held && input.reason === 'owner'
        ? 'This went down while the site was muted, so nobody was told until now. Please acknowledge or hand it over in the Chat thread.'
        : input.reason === 'owner'
          ? `Nobody has acknowledged yet. You own ${site} — please acknowledge or hand it over in the Chat thread.`
          : 'Nobody has acknowledged yet. The Google Chat alert couldn’t be delivered, so this email is the alert.',
    facts: [
      ...(held ? [held.row] : []),
      ['Confirmed down', confirmedLabel(input.confirmedAt)],
      ['Cause', input.cause],
      ['Confirmed by', formatConfirmedBy(input.confirmingLocations, input.confirmedByWaf)],
      ...ladderFacts(input.ackedBy ? null : input.ladder, input.now ?? input.confirmedAt, 'down'),
    ],
    // The board adds [Open incident], but Acknowledge opens that same page (one incident page, D-033).
    buttons: input.ackedBy
      ? [{ label: 'Open incident', href: input.incidentUrl, primary: true }]
      : held
        ? [
            { label: 'Acknowledge', href: `${input.incidentUrl}?ack=1`, primary: true },
            { label: 'Open incident', href: input.incidentUrl, primary: false },
          ]
        : [{ label: 'Acknowledge', href: `${input.incidentUrl}?ack=1`, primary: true }],
  });
}

/**
 * The first DOWN / PROBLEM email after a mute (EmailAlert "Down (held by a mute)", §24.17): a first
 * facts row "Held by a mute — until 15:00 — escalation starts now" and the preheader's "held by a mute
 * until 15:00" — the same words as the Chat card's held line (§24.7). No ladder (acknowledged
 * meanwhile, or no plan): only why it is late.
 */
function heldRow(heldUntil: Date | null | undefined, ladder: LadderFacts | null | undefined, now: Date) {
  if (!heldUntil) return null;
  const until = isSameBangkokDay(heldUntil, now) ? formatTime(heldUntil) : formatResume(heldUntil, now);
  const paused = ladder?.pausedUntil ? formatResume(ladder.pausedUntil, now) : null;
  // Nobody to escalate to (no plan, or no level left): only why it is late (§24.16, staging /verify).
  const value =
    !ladder || (!ladder.next && !ladder.pausedUntil)
      ? `until ${until}`
      : paused
        ? `until ${until} — outside response hours — escalation starts ${paused}`
        : `until ${until} — escalation starts now`;
  return { pre: `held by a mute until ${until}`, row: ['Held by a mute', value] as [string, string] };
}

/** "22:14" the same Bangkok day as `ref`, "Thu 24 Sep 22:14" otherwise. */
function withDayIfNot(at: Date, ref: Date, time: (d: Date) => string): string {
  return isSameBangkokDay(at, ref) ? time(at) : `${formatDay(at, { weekday: true })} ${time(at)}`;
}

export function buildAcknowledgedEmail(input: AcknowledgedEmailInput): EmailMessage {
  const { site, ackedBy, problem } = input;
  const at = formatTime(input.ackedAt);
  const duration =
    input.downMinutes != null
      ? formatDuration(input.downMinutes)
      : downtime(input.startedAt, input.ackedAt).duration;
  const slow = problem?.trigger === 'slow';
  const still = !problem ? 'still down' : slow ? 'still slow' : 'still has a problem';
  const stopped = stoppedWords(input.stopped);
  return render(input, {
    template: 'acknowledged',
    color: C.secondary,
    bar: C.secondary,
    label: 'ACKNOWLEDGED',
    pre: [`by ${ackedBy} ${at}`, `${site} ${still}`, ...(stopped ? [stopped.line] : [])].join(' · '),
    headline: `${ackedBy} has ${site}`,
    lede: !problem
      ? `Acknowledged by ${ackedBy}${stopped ? ` → ${stopped.body}` : '.'}`
      : `Acknowledged by ${ackedBy}${stopped ? ` → ${stopped.line}.` : '.'} The site is still up${slow ? ' but slow' : ''}; you’ll get one more email when it clears.`,
    facts: problem
      ? [
          ['Acknowledged', `${ackedBy} at ${at}`],
          [
            `${slow ? 'Slow' : 'Problem'} for`,
            `${duration} so far (detected ${withDayIfNot(input.confirmedAt, input.ackedAt, formatTime)})`,
          ],
          ...(input.cause ? [['Cause', input.cause] as [string, string]] : []),
          ...(stopped?.fact ? [stopped.fact] : []),
        ]
      : [
          ['Acknowledged', `${ackedBy} at ${at}`],
          [
            'Down for',
            `${duration} so far (confirmed down ${withDayIfNot(input.confirmedAt, input.ackedAt, formatTimeWithSeconds)})`,
          ],
        ],
    buttons: [{ label: 'Open incident', href: input.incidentUrl, primary: false }],
  });
}

export function buildRecoveredEmail(input: RecoveredEmailInput): EmailMessage {
  const { site, owner, ack, problem } = input;
  const { duration, range } = downtime(input.startedAt, input.recoveredAt);
  const isOwner = input.reason === 'owner';
  const ackFact = ack ? [['Acknowledged', `${ack.by} at ${formatTime(ack.at)}`] as [string, string]] : [];
  if (problem) {
    return render(input, {
      template: 'recovered',
      color: C.positive,
      bar: C.positive,
      label: 'RECOVERED',
      pre: `${site} back to normal at ${formatTime(input.recoveredAt)} · problem lasted ${duration} · root cause needed`,
      headline: `${site} is back to normal`,
      lede: isOwner
        ? 'The problem cleared. Needs a root cause before it can be resolved.'
        : owner
          ? `The problem cleared. Nothing needed from you. ${owner} adds the root cause.`
          : 'The problem cleared. Nothing needed from you.',
      facts: [
        ['Problem lasted', `${duration} (${range})`],
        ['Confirmed by', `First OK round from ${formatLocations(input.okLocations)}`],
        ...ackFact,
        ...(owner
          ? [
              ['Still to do', `Root cause (${owner}) · a PROBLEM ends at Resolved — no review`] as [
                string,
                string,
              ],
            ]
          : []),
      ],
      buttons: isOwner
        ? [{ label: 'Add root cause', href: `${input.incidentUrl}#resolve`, primary: true }]
        : [{ label: 'Open incident', href: input.incidentUrl, primary: false }],
    });
  }
  return render(input, {
    template: 'recovered',
    color: C.positive,
    bar: C.positive,
    label: 'RECOVERED',
    pre: `${site} back at ${formatTime(input.recoveredAt)} · down ${duration} · root cause needed`,
    headline: `${site} is back`,
    lede: isOwner
      ? 'Needs a root cause before it can be resolved.'
      : owner
        ? `Nothing needed from you. ${owner} adds the root cause.`
        : 'Nothing needed from you.',
    facts: [
      ['Down for', `${duration} (${range})`],
      ['Confirmed by', `First OK round from ${formatLocations(input.okLocations)} → Monitoring`],
      ...ackFact,
      ...(owner ? [['Still to do', `Root cause (${owner})`] as [string, string]] : []),
    ],
    // Board: the owner gets "Add root cause" first; for everyone else one secondary button.
    buttons: isOwner
      ? [
          { label: 'Add root cause', href: `${input.incidentUrl}#resolve`, primary: true },
          { label: 'Open incident', href: input.incidentUrl, primary: false },
        ]
      : [{ label: 'Open incident', href: input.incidentUrl, primary: false }],
  });
}

/**
 * PROBLEM email (EmailAlert PROBLEM thread): amber, PROBLEM first in the preheader, to the owner
 * only — the backup is first emailed with the 60-min reminder (S08). No "Next step" row until S08.
 */
export function buildProblemEmail(input: ProblemEmailInput): EmailMessage {
  const { site, trigger } = input;
  const slow = trigger === 'slow';
  const unverified = trigger === 'blocked_unverified';
  const chain = trigger === 'tls_chain';
  const headline = slow
    ? `${site} is slow`
    : unverified
      ? `${site} can’t be verified`
      : `${site} has a problem`;
  const state = slow
    ? 'Up — pages load, but slowly. Not an outage.'
    : unverified
      ? 'Unknown — blocked by bot protection; no proof either way.'
      : chain
        ? 'Up in most browsers — apps and API clients can’t connect. Not an outage.'
        : 'Up — reachable, with an issue. Not an outage.';
  const opening = slow
    ? 'The site is up but slow.'
    : unverified
      ? input.verifier === 'control_failed'
        ? 'The site is blocked by bot protection at SIN and TYO, and the BKK probe’s network check failed.'
        : 'The site is blocked by bot protection and couldn’t be checked in a browser.'
      : chain
        ? 'The site opens in most browsers, but its certificate chain is misconfigured: install the right intermediate certificate.'
        : 'The site is up, with a problem.';
  const held = heldRow(input.heldUntil, input.ladder, input.now ?? input.detectedAt);
  return render(input, {
    template: 'problem',
    color: C.warning,
    bar: C.warning,
    label: 'PROBLEM',
    pre: held
      ? `${site} · ${input.summary} · ${held.pre}`
      : `${site} · ${input.summary} · detected ${formatTime(input.detectedAt)}`,
    headline,
    lede:
      held && input.reason === 'owner'
        ? `${opening} This started while the site was muted, so nobody was told until now. Please take a look and acknowledge, or hand it over in the Chat thread.`
        : input.reason === 'owner'
          ? `${opening} You own ${site} — please take a look and acknowledge, or hand it over in the Chat thread.`
          : `${opening} The Google Chat alert couldn’t be delivered, so this email is the alert.`,
    facts: [
      ...(held ? [held.row] : []),
      ['Detected', `${formatDay(input.detectedAt, { weekday: true })} ${formatTime(input.detectedAt)}`],
      ['Trigger', TRIGGER_LABELS[trigger]],
      ['Cause', input.cause],
      ['Site', state],
      ...ladderFacts(input.ladder, input.now ?? input.detectedAt, 'problem', true),
    ],
    buttons: [{ label: 'Open / acknowledge', href: `${input.incidentUrl}?ack=1`, primary: true }],
  });
}

/** Admin alerts that aren't about one incident (D-019, D-022, `system_alerts.kind`). */
export type SystemAlertKind =
  'verifier_unavailable' | 'verifier_backlog' | 'probe_locations_low' | 'bkk_control_failing';

/** Why the engine counted the verifier unavailable (D-019). */
export type VerifierDownReason = 'no_poll' | 'not_picked_up' | 'lease_expired';

export interface SystemAlertEmailInput {
  alertId: string;
  kind: SystemAlertKind;
  openedAt: Date;
  /** Blocked sites waiting for a verdict when the alert opened. */
  sites: readonly string[];
  /** verifier_unavailable: what the engine saw. */
  reason?: VerifierDownReason;
  /** verifier_backlog: jobs waiting when the alert opened. */
  queued?: number;
  /** probe_locations_low: the locations still reporting. */
  active?: readonly ProbeLocation[];
  /** Sender, for the alert's thread id. */
  from: string;
}

export const SYSTEM_EMAIL_FOOTER =
  'Times in Thailand time (UTC+7). This is an automated record — replies aren’t read.';

const VERIFIER_DOWN_REASONS: Record<VerifierDownReason, string> = {
  no_poll: 'the verifier hasn’t asked for work in 2 min (BKK VPS)',
  not_picked_up: 'a blocked check found no verifier answering (BKK VPS)',
  lease_expired: 'a verification job ran out of time without a result (BKK VPS)',
};

const LOCATION_NAMES: Record<ProbeLocation, string> = {
  BKK: 'BKK (BKK VPS)',
  SIN: 'SIN (Singapore)',
  TYO: 'TYO (Tokyo)',
};

const PROBE_CHECK: Record<ProbeLocation, string> = {
  BKK: 'The BKK probe on the BKK VPS (dxt-agent)',
  SIN: 'The SIN probe (Vercel cron probe-sin)',
  TYO: 'The TYO probe (Vercel cron probe-tyo)',
};

const SYSTEM_TITLES: Record<SystemAlertKind, string> = {
  verifier_unavailable: 'Browser verifier unavailable',
  verifier_backlog: 'Browser verifier falling behind',
  probe_locations_low: 'Fewer than 2 probe locations',
  bkk_control_failing: 'BKK probe network check failing',
};

/**
 * Admin system emails (EmailAlert "Admin · system", spec §19.5): every active Admin, one email per
 * outage under its own subject with the start time (separate outages never merge into one mail
 * thread), nothing when it is back. No "Open Probes & heartbeat" button until that page (S12).
 */
export function buildSystemAlertEmail(input: SystemAlertEmailInput): EmailMessage {
  const since = `${formatDay(input.openedAt, { weekday: true })} ${formatTime(input.openedAt)}`;
  const envelope: Envelope = {
    subject: `DxT Monitor · System · ${SYSTEM_TITLES[input.kind]} · ${since}`,
    why: 'You got this because you’re an Admin.',
    footer: SYSTEM_EMAIL_FOOTER,
    headers: { References: `<alert-${input.alertId}@${senderDomain(input.from)}>` },
  };
  if (input.kind === 'verifier_unavailable') {
    const waiting = input.sites.length;
    return emailLayout(envelope, {
      color: C.warning,
      bar: C.warning,
      label: 'VERIFIER UNAVAILABLE',
      pre: `${waiting} blocked site${waiting === 1 ? '' : 's'} waiting, shown as PROBLEM (unverified) until it’s back`,
      headline: 'The browser verifier isn’t answering',
      lede: 'Blocked sites are waiting for a browser check. Until the verifier is back they show PROBLEM (unverified) — no proof either way.',
      facts: [
        ['Since', `${since} — ${VERIFIER_DOWN_REASONS[input.reason ?? 'no_poll']}`],
        ['Sites waiting', waiting ? input.sites.join(', ') : 'No site right now'],
        [
          'Effect',
          'Blocked sites can’t be confirmed OK or DOWN. Hard fails still go DOWN as usual — they don’t wait for the verifier.',
        ],
        ['What to check', 'Restart the verifier service on the BKK VPS (dxt-agent).'],
        ['When it’s back', 'Waiting sites are re-checked on the next round and clear on their own.'],
      ],
      buttons: [],
    });
  }
  if (input.kind === 'bkk_control_failing') {
    const waiting = input.sites.length;
    return emailLayout(envelope, {
      color: C.warning,
      bar: C.warning,
      label: 'BKK NETWORK SUSPECT',
      pre: `BKK network check failed 3 rounds in a row · ${waiting} site${waiting === 1 ? '' : 's'} behind bot protection not verified`,
      headline: 'The BKK probe’s network check is failing',
      lede: 'The BKK VPS’s network checks (its public test addresses) failed for 3 rounds in a row, so its own network is suspect. Sites behind bot protection that only BKK can reach show PROBLEM (unverified) until it passes again.',
      facts: [
        ['Since', since],
        ['Sites not verified', waiting ? input.sites.join(', ') : 'No site right now'],
        [
          'Effect',
          'Only sites behind bot protection are affected. Other sites keep their usual vote — SIN and TYO outvote a failing BKK.',
        ],
        ['What to check', 'The BKK VPS network (DNS, route, firewall) and the dxt-agent journal.'],
        ['When it’s back', 'The sites are decided from BKK again on the next round and clear on their own.'],
      ],
      buttons: [],
    });
  }
  if (input.kind === 'probe_locations_low') {
    const active = PROBE_LOCATIONS.filter((l) => input.active?.includes(l));
    const missing = PROBE_LOCATIONS.filter((l) => !active.includes(l));
    return emailLayout(envelope, {
      color: C.warning,
      bar: C.warning,
      label: 'STATUSES FROZEN',
      pre: `${active.length ? `only ${active.join(', ')} is reporting` : 'no location is reporting'} · every site held at its last round`,
      headline: active.length === 1 ? 'Only 1 probe location is reporting' : 'No probe location is reporting',
      lede: 'A status needs at least 2 locations to vote, so statuses are frozen at the last complete round until a second location reports again.',
      facts: [
        ['Since', since],
        ['Still reporting', active.length ? active.map((l) => LOCATION_NAMES[l]).join(' · ') : 'None'],
        ['Missing', missing.map((l) => LOCATION_NAMES[l]).join(' · ')],
        [
          'Effect',
          'Every site keeps its status from its last complete round. No new incidents or recoveries until a second location reports.',
        ],
        ['What to check', `${missing.map((l) => PROBE_CHECK[l]).join(' · ')} — each reports every minute.`],
      ],
      buttons: [],
    });
  }
  const queued = input.queued ?? 0;
  return emailLayout(envelope, {
    color: C.warning,
    bar: C.warning,
    label: 'VERIFIER BEHIND',
    pre: `${queued} jobs waiting · blocked sites wait longer for a verdict`,
    headline: 'The browser verifier is falling behind',
    lede: 'More than 5 verification jobs are waiting, so blocked sites wait longer for a verdict.',
    facts: [
      ['Since', since],
      ['Waiting', `${queued} jobs`],
      ['What to check', 'The verifier service on the BKK VPS (dxt-agent) and its sessions.'],
    ],
    buttons: [],
  });
}

/**
 * The flapping summary email (EmailAlert "VOCA · flapping", spec §19.4): to the owner in the
 * incident's thread at the same time as the Chat summary, replacing the RECOVERED emails held while
 * the site flapped. The owner's one button is "Add root cause" (the Resolve card, S07).
 */
export function buildFlapSummaryEmail(input: FlapSummaryEmailInput): EmailMessage {
  const { site, drops, owner, ack } = input;
  const { flips: n, last, counted, ranges, minutes } = flapCounts(drops, input.severity);
  const stable = last ? formatTime(last.end) : '';
  const total = formatDuration(minutes);
  const down = input.severity === 'down';
  const isOwner = input.reason === 'owner';
  return render(input, {
    template: 'flap_summary',
    color: C.positive,
    bar: C.positive,
    label: 'RECOVERED',
    pre: `${site} stable since ${stable} · flapped ×${n} · ${total} ${down ? 'down ' : ''}in total · root cause needed`,
    headline: `${site} is stable again`,
    lede: isOwner
      ? `${site} flapped ${n} times and has been stable for 15 min. Needs a root cause before it can be resolved.`
      : owner
        ? `${site} flapped ${n} times and has been stable for 15 min. Nothing needed from you. ${owner} adds the root cause.`
        : `${site} flapped ${n} times and has been stable for 15 min. Nothing needed from you.`,
    facts: [
      [`${down ? 'Down' : 'Had a problem'} ${timesWord(counted)}`, ranges],
      [down ? 'Down in total' : 'In total', total],
      ['Stable since', `${stable} — OK for 15 min`],
      [
        'Acknowledged',
        ack
          ? `${ack.by} at ${formatTime(ack.at)}`
          : input.pausedUntil
            ? `Not yet — outside response hours, timers paused until ${formatResume(input.pausedUntil, last?.end ?? input.pausedUntil)}`
            : 'Not yet',
      ],
      ...(owner
        ? [['Still to do', `Root cause (${owner}) — needed before it can be resolved`] as [string, string]]
        : []),
    ],
    buttons: isOwner
      ? [{ label: 'Add root cause', href: `${input.incidentUrl}#resolve`, primary: true }]
      : [{ label: 'Open incident', href: input.incidentUrl, primary: false }],
  });
}

/**
 * RECOVERED email for an auto-resolved PROBLEM (EmailAlert "Fuji Links · auto-resolved", spec §19.6):
 * on its first OK round, in the PROBLEM's thread, nothing to do.
 */
export function buildAutoResolvedEmail(input: AutoResolvedEmailInput): EmailMessage {
  const { site, keyPage } = input;
  const { duration } = downtime(input.flaggedAt, input.recoveredAt);
  const what = keyPage ? `${site} ${keyPage.path}` : site;
  return render(input, {
    template: 'recovered',
    color: C.positive,
    bar: C.positive,
    label: 'RECOVERED',
    pre: `${what} back to normal · cleared ${duration} after it was flagged · resolved automatically`,
    headline: `${what} is back`,
    lede: 'Resolved automatically — no root cause needed. Nothing to do.',
    facts: [
      ['Cleared', `${duration} after it was flagged`],
      ['Trigger', TRIGGER_LABELS[input.trigger]],
      ...(input.cause ? [['Cause', input.cause] as [string, string]] : []),
      ['Acknowledged', 'Nobody — it cleared first'],
      [
        'Status',
        'Resolved automatically on the first OK round — cleared within 5 min of being flagged, never acknowledged. No root cause needed.',
      ],
    ],
    buttons: [{ label: 'Open incident', href: input.incidentUrl, primary: true }],
  });
}

/**
 * DOWN AGAIN / PROBLEM AGAIN by email: only when the Chat reply couldn't be delivered (D-016
 * fallback to the backup and Admins) — the replies themselves are Chat only (D-024). Same words as
 * the Chat reply, in the incident's thread.
 */
export function buildAgainEmail(input: AgainEmailInput): EmailMessage {
  const down = input.severity === 'down';
  const label = down ? 'DOWN AGAIN' : 'PROBLEM AGAIN';
  const title = input.title.replace(/^(DOWN|PROBLEM) AGAIN · /, '');
  return render(input, {
    template: down ? 'down_again' : 'problem_again',
    color: down ? C.danger : C.warning,
    bar: down ? C.danger : C.warning,
    label,
    pre: `${title} · same incident ${formatIncidentId(input.incidentNumber)}`,
    headline: down ? `${input.site} is down again` : `${input.site} has a problem again`,
    lede: `${input.body} The Google Chat reply couldn’t be delivered, so this email is the alert.`,
    facts: [['Same incident', formatIncidentId(input.incidentNumber)]],
    buttons: [{ label: 'Open incident', href: input.incidentUrl, primary: true }],
  });
}

/**
 * RESOLVED email (EmailAlert "Resolved email", spec §16.5, D-033): in the incident's thread to
 * everyone emailed about it, after the 10 s Undo window. Says who resolved it and the root cause —
 * people's own words, escaped like every value in the layout.
 */
export function buildResolvedEmail(input: ResolvedEmailInput): EmailMessage {
  const { site, resolvedBy } = input;
  const at = formatTime(input.resolvedAt);
  const lasted = resolvedLasted(input.drops);
  return render(input, {
    template: 'resolved',
    color: C.positive,
    bar: C.positive,
    label: 'RESOLVED',
    pre: `${site} · by ${resolvedBy} ${at} · root cause: ${input.rootCause}`,
    headline: `${site} is resolved`,
    lede: `Resolved by ${resolvedBy} at ${at}. Nothing needed from you.`,
    facts: [
      ['Root cause', input.rootCause],
      ['What happened', input.whatHappened],
      ...(input.whatFixedIt ? [['What fixed it', input.whatFixedIt] as [string, string]] : []),
      ...(lasted ? [lasted] : []),
    ],
    buttons: [{ label: 'Open incident', href: input.incidentUrl, primary: false }],
  });
}

/** "acknowledge by 10:03" in the Down email's preheader (EmailAlert); nothing while timers are paused. */
function ladderPre(ladder: LadderFacts | null | undefined, now: Date): string[] {
  if (!ladder || ladder.pausedUntil || !ladder.next) return [];
  return [`acknowledge by ${formatResume(ladder.next.at, now)}`];
}

/** The Next step row (EmailAlert Down / PROBLEM emails). */
function ladderFacts(
  ladder: LadderFacts | null | undefined,
  now: Date,
  severity: 'down' | 'problem',
  email = false,
): [string, string][] {
  const next = nextRow(ladder, now, severity, { email });
  return next ? [['Next step', next]] : [];
}

export interface StepEmailInput extends EmailBaseInput {
  severity: 'down' | 'problem';
  level: number;
  /** Minutes unacknowledged since the owner was told: Confirmed down, or a held PROBLEM's opening (D-034). */
  elapsedMin: number;
  confirmedAt: Date;
  /** The L0 person and when they were told: "Arm — Chat + email 09:48". */
  owner: string | null;
  /** This person is told for information (the Admin at L1); otherwise asked to act. */
  asFyi: boolean;
  /** Who was asked at this level, in words: "Ploy". */
  asked: string | null;
  /** The incident's cause line (EmailAlert L1 facts). */
  cause?: string | null;
  /** When the owner was told (a PROBLEM held for response hours: the opening, not detection). */
  toldAt?: Date;
  /** The Chat reply couldn't be delivered: this email is the alert (D-016 fallback). */
  fallback?: boolean;
}

/**
 * The L1 email (EmailAlert "ESCALATED · L1", sent 10:03 to Ploy and Tao, one each): the backup is
 * asked to acknowledge, the Admin is told for information. A PROBLEM's L1 is the backup's first email
 * (EmailAlert: "first emailed with the 60-min reminder"). No "Next step" until S10 builds L2.
 */
export function buildStepEmail(input: StepEmailInput): EmailMessage {
  const { site } = input;
  const duration = formatDuration(input.elapsedMin);
  const down = input.severity === 'down';
  const owner = input.owner ?? 'The owner';
  // Sent `elapsedMin` after the owner was told: INC-0139's L1 at Fri 09:15 says "confirmed down Thu 24 Sep 22:14".
  const sentAt = new Date((input.toldAt ?? input.confirmedAt).getTime() + input.elapsedMin * 60_000);
  const detected = withDayIfNot(input.confirmedAt, sentAt, formatTimeWithSeconds);
  // "Down for" / "Problem for" is how long it has been wrong, on the wall clock from detection — a held
  // PROBLEM's L1 at 10:00 says "11 h 46 min", as its ACK email does 5 min later (message-check round 3).
  const sinceDetected = formatDuration(
    Math.max(0, Math.floor((sentAt.getTime() - input.confirmedAt.getTime()) / 60_000)),
  );
  const ask = input.fallback
    ? `${owner} hasn’t acknowledged. The Google Chat reply couldn’t be delivered, so this email is the alert.`
    : input.asFyi
      ? `For your information — ${input.asked ?? 'the next person'} has been asked to acknowledge. Nothing needed from you.`
      : down
        ? `${owner} hasn’t acknowledged. Please acknowledge — you’re the next person for this incident.`
        : `${owner} hasn’t acknowledged. Please take it — you’re the next person for this incident.`;
  return render(input, {
    template: down ? 'down' : 'problem',
    color: C.warning,
    bar: C.warning,
    label: down ? `ESCALATED · L${input.level}` : 'STILL PROBLEM',
    pre: down
      ? `${site} down ${duration}, not acknowledged`
      : `${site} problem not acknowledged for ${duration}`,
    headline: down
      ? `${site} still down — ${duration}, no ack`
      : `${site} still has a problem — ${duration}, no ack`,
    lede: ask,
    facts: [
      [
        down ? 'Down for' : 'Problem for',
        `${sinceDetected} (${down ? 'confirmed down' : 'detected'} ${detected})`,
      ],
      ...(input.cause ? [['Cause', input.cause] as [string, string]] : []),
      ...(input.owner
        ? [
            [
              'Already told',
              `${input.owner} — Chat + email ${formatResume(input.toldAt ?? input.confirmedAt, input.confirmedAt)}`,
            ] as [string, string],
          ]
        : []),
    ],
    buttons:
      input.asFyi && !input.fallback
        ? [{ label: 'Open incident', href: input.incidentUrl, primary: false }]
        : [
            { label: 'Acknowledge', href: `${input.incidentUrl}?ack=1`, primary: true },
            { label: 'Open incident', href: input.incidentUrl, primary: false },
          ],
  });
}
