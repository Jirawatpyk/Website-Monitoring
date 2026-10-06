import { formatDay, formatIncidentId, formatTier, formatTime, formatTimeWithSeconds } from '@dxt/shared';
import { downtime } from './downtime';

/**
 * Alert emails — EmailAlert board, spec §10, PRD §7, cut to what exists today (D-013 / D-016: no
 * escalation, client-update or root-cause buttons until their slices).
 *
 * One email per event and per person, all under one subject per incident ("MuvMi · Tier 1 ·
 * INC-0142"), so a mail client stacks them like the Chat thread: every later email sets
 * `In-Reply-To` / `References` to the recipient's DOWN email. The status word leads the preheader
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
  /** Domain of the sending address: Message-IDs are made on it. */
  messageDomain: string;
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

/** `<inc-…@domain>`: deterministic, so later emails can reply to the recipient's DOWN email. */
export function emailMessageId(
  incidentId: string,
  template: string,
  recipientId: string,
  domain: string,
): string {
  return `<inc-${incidentId}.${template}.${recipientId}@${domain}>`;
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
  const why = whyOf(input);
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
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(subjectOf(input))}</title></head>
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
<tr><td style="padding:16px 8px 0;text-align:center;font-size:12px;line-height:1.5;color:${C.secondary}"><b style="font-weight:600;color:${C.primary}">${escapeHtml(why)}</b><br>${escapeHtml(EMAIL_FOOTER)}</td></tr>
</table>
</td></tr></table>
</body></html>`;

  const text = [
    `${b.label} — ${b.headline}`,
    b.lede,
    '',
    ...b.facts.map(([k, v]) => `${k}: ${v}`),
    '',
    ...b.buttons.map((btn) => `${btn.label}: ${btn.href}`),
    '',
    '--',
    why,
    EMAIL_FOOTER,
  ].join('\n');

  const own = emailMessageId(input.incidentId, b.template, input.recipientId, input.messageDomain);
  const first = emailMessageId(input.incidentId, 'down', input.recipientId, input.messageDomain);
  const headers: Record<string, string> =
    b.template === 'down'
      ? { 'Message-ID': own }
      : { 'Message-ID': own, 'In-Reply-To': first, References: first };

  return { subject: subjectOf(input), html, text, headers };
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
    buttons: [{ label: 'Open incident', href: input.incidentUrl, primary: true }],
  });
}
