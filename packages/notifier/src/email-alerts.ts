import { formatDay, formatIncidentId, formatTier, formatTime, formatTimeWithSeconds } from '@dxt/shared';
import { downtime } from './downtime';

/**
 * Alert emails — EmailAlert board, spec §10, PRD §7, cut to what exists today (D-013 / D-016: no
 * escalation, client-update or root-cause buttons until their slices).
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
export type EmailReason = 'owner' | 'acked' | 'fallback';

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
}

export interface DownEmailInput extends EmailBaseInput {
  confirmedAt: Date;
  cause: string;
  confirmingLocations: number;
}

export interface AcknowledgedEmailInput extends EmailBaseInput {
  ackedBy: string;
  ackedAt: Date;
  startedAt: Date;
  confirmedAt: Date;
}

export interface RecoveredEmailInput extends EmailBaseInput {
  startedAt: Date;
  recoveredAt: Date;
  okLocations: number;
  owner: string | null;
  ack: { by: string; at: Date } | null;
}

type Template = 'down' | 'acknowledged' | 'recovered';

/**
 * AURA light tokens (aura-tokens 5.31) resolved to hex: email clients don't support CSS variables.
 * The board's colours: danger / positive / secondary label, zinc surfaces.
 */
const C = {
  danger: '#b91c1c',
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

const FONT = "-apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
export const EMAIL_FOOTER =
  'Times in Thailand time (UTC+7). This is an automated record — replies aren’t read. Discuss in the Chat thread.';

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const senderDomain = (from: string) => /@([^>\s]+)>?\s*$/.exec(from)?.[1] ?? 'localhost';

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
  return layout({ subject: subjectOf(input), why: whyOf(input), footer: EMAIL_FOOTER, headers }, b);
}

interface Envelope {
  subject: string;
  /** The footer's bold line: why this person got it. */
  why: string;
  footer: string;
  headers: Record<string, string>;
}

/** The EmailAlert layout: status bar, label, headline, lede, facts table, buttons, footer. */
function layout({ subject, why, footer, headers }: Envelope, b: Omit<Body, 'template'>): EmailMessage {
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
  return render(input, {
    template: 'down',
    color: C.danger,
    bar: C.danger,
    label: 'DOWN',
    pre: `${site} confirmed down ${formatTimeWithSeconds(input.confirmedAt)} · ${input.cause}`,
    headline: `${site} is down`,
    lede:
      input.reason === 'owner'
        ? `Nobody has acknowledged yet. You own ${site} — please acknowledge or hand it over in the Chat thread.`
        : 'Nobody has acknowledged yet. The Google Chat alert couldn’t be delivered, so this email is the alert.',
    facts: [
      ['Confirmed down', confirmedLabel(input.confirmedAt)],
      ['Cause', input.cause],
      ['Confirmed by', `${input.confirmingLocations} locations, 2 checks`],
    ],
    // One page serves both until S07 builds the full incident: [Open incident] would repeat it.
    buttons: [{ label: 'Acknowledge', href: `${input.incidentUrl}?ack=1`, primary: true }],
  });
}

export function buildAcknowledgedEmail(input: AcknowledgedEmailInput): EmailMessage {
  const { site, ackedBy } = input;
  const at = formatTime(input.ackedAt);
  const { duration } = downtime(input.startedAt, input.ackedAt);
  return render(input, {
    template: 'acknowledged',
    color: C.secondary,
    bar: C.secondary,
    label: 'ACKNOWLEDGED',
    pre: `by ${ackedBy} ${at} · ${site} still down`,
    headline: `${ackedBy} has ${site}`,
    lede: `Acknowledged by ${ackedBy}.`,
    facts: [
      ['Acknowledged', `${ackedBy} at ${at}`],
      ['Down for', `${duration} so far (confirmed down ${formatTimeWithSeconds(input.confirmedAt)})`],
    ],
    buttons: [{ label: 'Open incident', href: input.incidentUrl, primary: false }],
  });
}

export function buildRecoveredEmail(input: RecoveredEmailInput): EmailMessage {
  const { site, owner, ack } = input;
  const { duration, range } = downtime(input.startedAt, input.recoveredAt);
  const isOwner = input.reason === 'owner';
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
      ['Confirmed by', `First OK round from ${input.okLocations} locations → Monitoring`],
      ...(ack ? [['Acknowledged', `${ack.by} at ${formatTime(ack.at)}`] as [string, string]] : []),
      ...(owner ? [['Still to do', `Root cause (${owner})`] as [string, string]] : []),
    ],
    // Board: the owner's only button leads; for everyone else it's secondary (nothing to do).
    buttons: [{ label: 'Open incident', href: input.incidentUrl, primary: isOwner }],
  });
}

/** Admin alerts that aren't about one incident (D-019, `system_alerts.kind`). */
export type SystemAlertKind = 'verifier_unavailable' | 'verifier_backlog';

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
  /** Sender, for the alert's thread id. */
  from: string;
}

export const SYSTEM_EMAIL_FOOTER =
  'Times in Thailand time (UTC+7). This is an automated message — replies aren’t read.';

const VERIFIER_DOWN_REASONS: Record<VerifierDownReason, string> = {
  no_poll: 'The VPS agent hasn’t asked for work in 2 min',
  not_picked_up: 'A verification job wasn’t picked up within 30 s',
  lease_expired: 'A verification job ran out of time without a result',
};

const VERIFIER_CHECK = 'The dxt-agent service on the Thai VPS (docs/runbook.md → Browser verifier)';

/**
 * "Admin told about the verifier" (StatusModel, D-001): one email per Admin when it becomes
 * unavailable or falls behind, under its own subject; nothing when it is back (spec §15.3).
 */
export function buildSystemAlertEmail(input: SystemAlertEmailInput): EmailMessage {
  const since = `${formatDay(input.openedAt, { weekday: true })} ${formatTime(input.openedAt)}`;
  const envelope: Envelope = {
    subject:
      input.kind === 'verifier_unavailable'
        ? 'DxT Monitor · Browser verifier unavailable'
        : 'DxT Monitor · Browser verifier falling behind',
    why: 'You got this because you’re an Admin.',
    footer: SYSTEM_EMAIL_FOOTER,
    headers: { References: `<alert-${input.alertId}@${senderDomain(input.from)}>` },
  };
  if (input.kind === 'verifier_unavailable') {
    return layout(envelope, {
      color: C.secondary,
      bar: C.secondary,
      label: 'VERIFIER UNAVAILABLE',
      pre: `since ${formatTime(input.openedAt)} · blocked sites show PROBLEM (unverified)`,
      headline: 'The browser verifier is unavailable',
      lede: 'Blocked sites show PROBLEM (unverified) until it’s back, and are checked again every round. Hard fails still go DOWN on time.',
      facts: [
        ['Since', since],
        ['What we saw', VERIFIER_DOWN_REASONS[input.reason ?? 'no_poll']],
        ['Waiting', input.sites.length ? input.sites.join(', ') : 'No site right now'],
        ['Check', VERIFIER_CHECK],
      ],
      buttons: [],
    });
  }
  const queued = input.queued ?? 0;
  return layout(envelope, {
    color: C.secondary,
    bar: C.secondary,
    label: 'VERIFIER BEHIND',
    pre: `${queued} jobs waiting · blocked sites wait longer for a verdict`,
    headline: 'The browser verifier is falling behind',
    lede: 'More than 5 verification jobs are waiting, so blocked sites wait longer for a verdict.',
    facts: [
      ['Since', since],
      ['Waiting', `${queued} jobs`],
      ['Check', VERIFIER_CHECK],
    ],
    buttons: [],
  });
}
