import {
  formatDay,
  formatDayRange,
  formatDuration,
  formatDurationSeconds,
  formatIncidentId,
  formatPercent,
  formatTime,
  formatWeek,
  isSameBangkokDay,
  type IncidentState,
  type Week,
} from '@dxt/shared';
import { plainName, type ChatMessage, type ChatPerson, type ChatWidget } from './chat-alerts';
import { chatMention } from './chat-text';
import { EMAIL_COLORS, escapeHtml, type EmailMessage } from './email-alerts';

/** A row's words with its follow-up and figure: "… — Arm", "… — 43 min". */
const rowText = (r: { text: string; who?: string; trail?: string }) =>
  [r.text, r.who, r.trail].filter(Boolean).join(' — ');

/**
 * The daily digest and the weekly summary (FR-12, WeeklySummary board, spec §10, §15.7, D-056). Both
 * post to the DxT Website Reports Space; the weekly summary is also the CEO's email. The only
 * @mentions are named follow-ups, in the text line. A section with nothing in it is left out.
 *
 * Both reports are built as one `ReportModel` (title, lines, sections of rows) and rendered from it to
 * a Chat card and an email, so the two never say different things.
 */

export type ReportPerson = ChatPerson;

/** One incident as a report lists it. Durations are down (or problem) time, not incident length. */
export interface ReportIncident {
  site: string;
  number: number;
  severity: 'down' | 'problem';
  /** The first failed check of its first drop in the period. */
  startedAt: Date;
  /** Started before the period (the daily digest then says "since …" instead of a duration). */
  startedBefore: boolean;
  /** Down (or problem) minutes inside the period, every drop added up. */
  minutes: number;
  /** How many drops in the period: past one it "flapped ×n" — a DOWN still counts once. */
  drops: number;
  /** Still failing when the report was made. */
  failing: boolean;
  /** Short cause: "Timeout ×2 · 504 ×1", "Blocked, not verified", "SSL expiring". */
  cause: string;
  /** A Tier 2–3 DOWN that started outside response hours. */
  outsideHours: boolean;
  state: IncidentState;
  owner: ReportPerson | null;
  /** The highest level the ladder fired (0 = only L0). */
  level: number;
  acked: { by: string; at: Date } | null;
  clientUpdate: { by: string; at: Date } | null;
}

export interface ReportWindow {
  kind: 'maintenance' | 'mute';
  site: string;
  start: Date;
  /** Its end as it stands: the planned end, or when it was ended early. */
  end: Date;
  endedEarly: boolean;
  reason: string;
  /** Who asked for it (Coming up names them). */
  by: string | null;
}

export interface ProbeGap {
  location: string;
  start: Date;
  /** Null while still going on at report time. */
  end: Date | null;
  /** The locations that still decided status meanwhile. */
  others: readonly string[];
}

export interface MonitorFacts {
  /** Share of the period's minutes the status engine swept, 0–1; null when there's no record. */
  roundsShare: number | null;
  /** The engine's silences over 3 min (stored as no data, not downtime). */
  engineGaps: readonly { start: Date; end: Date }[];
  probeGaps: readonly ProbeGap[];
  /** Active Admins by name. Under two, the report warns: monitor-fault alerts reach one person. */
  admins: readonly string[];
}

export interface DigestFacts {
  /** When it runs: 09:00 Bangkok. */
  at: Date;
  sitesTotal: number;
  sitesOk: number;
  down: readonly { site: string; since: Date; cause: string; number: number }[];
  problem: readonly { site: string; since: Date; cause: string; number: number }[];
  /** OK sites whose OK came from the browser verifier (bots blocked, page verified). */
  browserChecked: readonly string[];
  muted: readonly { site: string; until: Date; reason: string }[];
  /** Maintenance running now or starting later today. */
  maintenance: readonly ReportWindow[];
  /** The previous Bangkok day's incidents (DOWN or PROBLEM at any time in it). */
  yesterday: readonly ReportIncident[];
  monitor: MonitorFacts;
  appUrl: string;
}

export interface WeeklyFacts {
  at: Date;
  /** Monday 00:00 and Sunday 23:59 Bangkok of the week reported. */
  weekStart: Date;
  weekEnd: Date;
  sitesTotal: number;
  sitesWithoutDowntime: number;
  /** All sites, maintenance excluded (`aggregateUptime`). */
  uptime: number;
  incidents: readonly ReportIncident[];
  needsSomeone: readonly {
    kind: 'root_cause' | 'request' | 'swap';
    text: string;
    who: readonly ReportPerson[];
  }[];
  /** MTTA of DOWNs inside response hours per tier, in seconds (null: none), and its target. */
  mtta: readonly { tier: number; seconds: number | null; targetMin: number | null }[];
  /** Every window and mute in the week. */
  planned: readonly ReportWindow[];
  /** Windows in the next 7 days. */
  comingUp: readonly ReportWindow[];
  onCall: {
    thisWeek: { name: string; week: Week } | null;
    next: { name: string; week: Week; swap: string | null } | null;
  };
  monitor: MonitorFacts;
  appUrl: string;
}

interface Row {
  /** The badge words (Chat: the decorated text's top label). */
  label?: string;
  text: string;
  /** Whose follow-up it is, shown at the end. */
  who?: string;
  /** A figure at the end of the row (an incident's down time), plain. */
  trail?: string;
  warning?: boolean;
}

interface Section {
  title?: string;
  rows: Row[];
}

export interface ReportModel {
  title: string;
  lines: string[];
  sections: Section[];
  buttons: { text: string; url: string }[];
  textLine: string;
}

const dayTime = (d: Date) => `${formatDay(d, { weekday: true })} ${formatTime(d)}`;

/** "timeout ×2 · 504 ×1" mid-sentence; an acronym ("SSL expiring", "HTTP 503") keeps its capitals. */
const midSentence = (s: string) => (/^[A-Z][a-z]/.test(s) ? s[0]!.toLowerCase() + s.slice(1) : s);

const SEV = { down: 'DOWN', problem: 'PROBLEM' } as const;

const RESOLVED: readonly IncidentState[] = ['resolved', 'in_review', 'closed'];

/** Who to @mention once each, in the order named; people without a Chat id are named in the card only. */
function mentions(people: readonly (ReportPerson | null | undefined)[]): string {
  const ids = [...new Set(people.flatMap((p) => (p?.chatUserId ? [p.chatUserId] : [])))];
  return ids.map(chatMention).join(' ');
}

/** "now" for a window running at `at`, the times otherwise: "09:30–14:00", "Sat 26 Sep 22:00 → Tue 29 Sep 22:00". */
function windowSpan(w: ReportWindow, withDay: boolean): string {
  const sameDay = isSameBangkokDay(w.start, w.end);
  if (sameDay)
    return `${withDay ? `${formatDay(w.start, { weekday: true })} ` : ''}${formatTime(w.start)}–${formatTime(w.end)}`;
  return `${dayTime(w.start)} → ${dayTime(w.end)}`;
}

const counted = (w: ReportWindow) => (w.kind === 'mute' ? 'still counted' : 'not counted');

/** The incident's outcome, for the digest's Yesterday line. */
function outcome(i: ReportIncident): { text: string; who: ReportPerson | null } {
  if (RESOLVED.includes(i.state)) return { text: 'resolved', who: null };
  if (i.state === 'needs_root_cause')
    return { text: `needs a root cause${i.owner ? `, ${plainName(i.owner.name)}` : ''}`, who: i.owner };
  if (i.state === 'monitoring') return { text: 'recovered', who: null };
  const still = i.severity === 'down' ? 'still down' : 'still a problem';
  if (!i.failing) return { text: 'recovered', who: null };
  return {
    text: i.acked ? `${still}, acknowledged by ${plainName(i.acked.by)}` : `${still}, not acknowledged`,
    who: null,
  };
}

/** "ORCA Thailand DOWN 8 min (22:14, timeout ×2 · 504 ×1, outside response hours) — needs a root cause, Tao". */
function yesterdayLine(i: ReportIncident): { row: Row; who: ReportPerson | null } {
  const facts = [
    ...(i.startedBefore ? [] : [formatTime(i.startedAt)]),
    midSentence(i.cause),
    ...(i.drops > 1 ? [`flapped ×${i.drops}`] : []),
    ...(i.outsideHours ? ['outside response hours'] : []),
    ...(i.startedBefore ? [`since ${dayTime(i.startedAt)}`] : []),
  ].join(', ');
  const o = outcome(i);
  const length = i.startedBefore ? '' : ` ${formatDuration(i.minutes)}`;
  return {
    row: { text: `${plainName(i.site)} ${SEV[i.severity]}${length} (${facts}) — ${o.text}` },
    who: o.who,
  };
}

function roundsLine(m: MonitorFacts, withGaps: boolean): string | null {
  if (m.roundsShare === null) return null;
  const share = formatPercent(m.roundsShare);
  if (!withGaps || !m.engineGaps.length) return `Monitor ran ${share} of rounds on time.`;
  const gaps = m.engineGaps
    .map(
      (g) =>
        `${dayTime(g.start)}–${formatTime(g.end)} (${formatDuration(Math.round((g.end.getTime() - g.start.getTime()) / 60_000))})`,
    )
    .join(', ');
  return `Monitor ran ${share} of rounds on time · ${m.engineGaps.length} ${m.engineGaps.length === 1 ? 'gap' : 'gaps'} ${gaps} — stored as no data, not downtime.`;
}

function monitorRows(m: MonitorFacts): Row[] {
  const rows: Row[] = [];
  const rounds = roundsLine(m, true);
  if (rounds) rows.push({ text: rounds });
  for (const g of m.probeGaps) {
    const span = g.end ? `${dayTime(g.start)}–${formatTime(g.end)}` : `since ${dayTime(g.start)}`;
    const others = g.others.length ? ` — ${g.others.join(' and ')} still decided status` : '';
    rows.push({ text: `1 probe gap ${span} (${g.location})${others} · the Admins were emailed, no page.` });
  }
  if (m.admins.length === 1)
    rows.push({
      text: `Only 1 active Admin (${plainName(m.admins[0]!)}), so monitor-fault alerts reach one person.`,
      warning: true,
    });
  if (m.admins.length === 0)
    rows.push({ text: 'No active Admin, so monitor-fault alerts reach nobody.', warning: true });
  return rows;
}

/** The daily digest at 09:00: what is true now, then yesterday (WeeklySummary "Daily digest"). */
export function digestModel(f: DigestFacts): ReportModel {
  const day = formatDay(f.at, { weekday: true });
  const time = formatTime(f.at);
  // A site in a running window isn't OK, DOWN or PROBLEM: it is counted as in maintenance.
  const running = f.maintenance.filter((w) => w.start <= f.at);
  const status = [
    `${f.sitesOk}/${f.sitesTotal} OK`,
    ...(f.down.length ? [`${f.down.length} DOWN`] : []),
    ...(f.problem.length ? [`${f.problem.length} PROBLEM`] : []),
    ...(running.length ? [`${running.length} in maintenance`] : []),
    ...(f.muted.length ? [`${f.muted.length} muted`] : []),
  ];
  const nowLine = [
    `${f.sitesOk}/${f.sitesTotal} OK`,
    ...(f.down.length ? [`${f.down.length} DOWN (${f.down.map((d) => plainName(d.site)).join(', ')})`] : []),
    ...(f.problem.length
      ? [`${f.problem.length} PROBLEM (${f.problem.map((d) => plainName(d.site)).join(', ')})`]
      : []),
    ...(running.length
      ? [`${running.length} in maintenance (${running.map((w) => plainName(w.site)).join(', ')})`]
      : []),
    ...(f.muted.length
      ? [`${f.muted.length} muted (${f.muted.map((d) => plainName(d.site)).join(', ')})`]
      : []),
  ].join(' · ');

  const now: Row[] = [
    ...f.down.map((d) => ({
      label: 'DOWN',
      text: `${plainName(d.site)} — since ${formatWhenShort(d.since, f.at)} · ${d.cause} · ${formatIncidentId(d.number)}`,
    })),
    ...f.problem.map((d) => ({
      label: 'PROBLEM',
      text: `${plainName(d.site)} — since ${formatWhenShort(d.since, f.at)} · ${d.cause} · ${formatIncidentId(d.number)}`,
    })),
    ...(f.browserChecked.length
      ? [
          {
            label: 'OK · checked by browser',
            text: `${f.browserChecked.map(plainName).join(', ')} — bots blocked, page verified`,
          },
        ]
      : []),
    ...f.muted.map((m) => ({
      label: `Muted · until ${formatWhenShort(m.until, f.at)}`,
      text: `${plainName(m.site)} — ${m.reason}, still counted`,
    })),
    ...f.maintenance.map((w) => ({
      label: 'Maintenance',
      text: `${plainName(w.site)} — ${
        w.start > f.at
          ? `Planned today ${windowSpan(w, false)}`
          : `Running now until ${formatWhenShort(w.end, f.at)}`
      } · ${w.reason} · not counted`,
    })),
  ];

  const lines = f.yesterday.map(yesterdayLine);
  const yesterday = new Date(f.at.getTime() - 86_400_000);
  const rounds = roundsLine(f.monitor, false);
  const followUps = lines.map((l) => l.who);
  const mention = mentions(followUps);

  return {
    title: `Website status · ${day} ${time}`,
    lines: [`Now: ${nowLine}`],
    sections: [
      ...(now.length ? [{ rows: now }] : []),
      {
        title: `Yesterday · ${formatDay(yesterday, { weekday: true })}`,
        rows: [
          ...(lines.length ? lines.map((l) => l.row) : [{ text: 'No incidents.' }]),
          {
            text: `${rounds ? `${rounds.replace(' on time.', '.')} ` : ''}A missing digest means the monitor itself needs checking.`,
          },
        ],
      },
    ],
    buttons: [],
    textLine: `Website status ${day} ${time} · ${status.join(' · ')}${mention ? ` · follow-up: ${mention}` : ''}`,
  };
}

/** "09:48" today, "Thu 24 Sep 22:14" another day. */
function formatWhenShort(d: Date, at: Date): string {
  return isSameBangkokDay(d, at) ? formatTime(d) : dayTime(d);
}

/** "Fri 25 Sep 09:48 · Timeout ×2 · 504 ×1 · reached L1, acked by Arm 10:07 · client updated by Bua 10:12". */
function weeklyWhat(i: ReportIncident): string {
  const parts = [
    dayTime(i.startedAt),
    i.drops > 1 ? `${i.cause}, flapped ×${i.drops}` : i.cause,
    ...(i.outsideHours ? ['outside response hours'] : []),
  ];
  const reached = i.level > 0 ? `reached L${i.level}` : null;
  const acked = i.acked ? `acked by ${plainName(i.acked.by)} ${formatTime(i.acked.at)}` : null;
  if (reached || acked) parts.push([reached, acked].filter(Boolean).join(', '));
  if (i.clientUpdate)
    parts.push(`client updated by ${plainName(i.clientUpdate.by)} ${formatTime(i.clientUpdate.at)}`);
  if (i.state === 'needs_root_cause') parts.push('no root cause yet');
  return parts.join(' · ');
}

/** The Monday weekly summary (WeeklySummary "Weekly summary"). */
export function weeklyModel(f: WeeklyFacts): ReportModel {
  const range = formatDayRange(f.weekStart, f.weekEnd);
  const short = formatDayRange(f.weekStart, f.weekEnd, { short: true });
  const downs = f.incidents.filter((i) => i.severity === 'down').length;
  const problems = f.incidents.length - downs;
  const failing = f.incidents.filter((i) => i.failing).length;

  const needs: Row[] = f.needsSomeone.map((n) => ({
    text: n.text,
    who: n.who.map((p) => plainName(p.name)).join(', '),
  }));
  const incidents: Row[] = f.incidents.map((i) => ({
    label: i.failing
      ? i.severity === 'down'
        ? 'Down'
        : 'Problem'
      : i.severity === 'down'
        ? 'Was down'
        : 'Was problem',
    text: `${plainName(i.site)} · ${weeklyWhat(i)}`,
    trail: formatDuration(i.minutes),
  }));

  const mttaValue = f.mtta
    .map((m) => `Tier ${m.tier} ${m.seconds === null ? '—' : formatDurationSeconds(m.seconds)}`)
    .join(' · ');
  const mttaNote = f.mtta
    .map((m) =>
      m.seconds === null
        ? `Tier ${m.tier} — (no DOWN inside response hours)`
        : m.targetMin === null
          ? `Tier ${m.tier} — no L1 step to compare with`
          : m.seconds > m.targetMin * 60
            ? `Tier ${m.tier} over the ${m.targetMin} min target`
            : `Tier ${m.tier} within the ${m.targetMin} min target`,
    )
    .join(' · ');
  const overTarget = f.mtta.some(
    (m) => m.seconds !== null && m.targetMin !== null && m.seconds > m.targetMin * 60,
  );

  const planned: Row[] = f.planned.map((w) => ({
    label: w.kind === 'mute' ? 'Muted' : 'Maintenance',
    text: `${plainName(w.site)} · ${plannedSpan(w, f.at)} · ${w.reason}${w.start <= f.at && f.at < w.end ? ' · running now' : ''} · ${counted(w)}`,
  }));

  const coming: Row[] = [];
  const oc = f.onCall;
  if (oc.thisWeek) {
    const next = oc.next
      ? ` Next: ${plainName(oc.next.name)}, ${formatWeek(oc.next.week).replace(/^\w+ /, '')}${oc.next.swap ? ` — ${oc.next.swap}` : ''}.`
      : '';
    coming.push({
      text: `On call this week (Tier 1 nights and weekends): ${plainName(oc.thisWeek.name)}, ${formatWeek(oc.thisWeek.week)}.${next}`,
    });
  }
  for (const w of f.comingUp)
    coming.push({
      text: `Maintenance: ${plainName(w.site)} ${windowSpan(w, true)} · ${w.reason}${w.by ? ` · ${plainName(w.by)}` : ''}`,
    });

  const monitor = monitorRows(f.monitor);
  const mention = mentions(f.needsSomeone.flatMap((n) => n.who));

  return {
    title: `Website week · ${range}`,
    lines: [
      `Week: ${f.sitesWithoutDowntime}/${f.sitesTotal} sites had no downtime`,
      `Uptime all sites ${formatPercent(f.uptime)} · ${downs} DOWN · ${problems} PROBLEM · maintenance excluded`,
    ],
    sections: [
      ...(needs.length ? [{ title: 'NEEDS SOMEONE', rows: needs }] : []),
      ...(incidents.length
        ? [
            {
              title: failing ? `INCIDENTS · ${failing} NOT RECOVERED` : 'INCIDENTS · ALL RECOVERED',
              rows: incidents,
            },
          ]
        : []),
      ...(f.mtta.length
        ? [
            {
              rows: [
                {
                  label: 'MTTA DOWN (response hours)',
                  text: `${mttaValue} — ${mttaNote}`,
                  warning: overTarget,
                },
              ],
            },
          ]
        : []),
      ...(planned.length ? [{ title: 'PLANNED & QUIET', rows: planned }] : []),
      ...(coming.length ? [{ title: 'COMING UP', rows: coming }] : []),
      ...(monitor.length ? [{ title: 'THE MONITOR ITSELF', rows: monitor }] : []),
    ],
    buttons: [{ text: 'Open incidents', url: `${f.appUrl}/incidents` }],
    textLine: `Website week ${short} · ${f.sitesWithoutDowntime}/${f.sitesTotal} sites had no downtime${mention ? ` · follow-ups: ${mention}` : ''}`,
  };
}

/** "Fri 25 Sep 09:30–14:00", "Fri 25 Sep until 18:00" (running), "Mon 21 Sep 10:15–11:40 (ended early)". */
function plannedSpan(w: ReportWindow, at: Date): string {
  if (w.start <= at && at < w.end && isSameBangkokDay(w.start, w.end))
    return `${formatDay(w.start, { weekday: true })} until ${formatTime(w.end)}`;
  return `${windowSpan(w, true)}${w.endedEarly ? ' (ended early)' : ''}`;
}

const chatText = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** The Chat message: the text line (the only place a mention notifies), then one card. */
export function reportChat(m: ReportModel, cardId: string): ChatMessage {
  // Card text is Chat's small HTML subset: a reason someone typed stays text.
  const widget = (r: Row): ChatWidget => {
    const text = chatText(rowText(r));
    return r.label
      ? { decoratedText: { topLabel: r.label, text, wrapText: true } }
      : { textParagraph: { text } };
  };
  return {
    text: m.textLine,
    cardsV2: [
      {
        cardId,
        card: {
          header: { title: m.title, subtitle: m.lines[0] },
          sections: [
            ...(m.lines.length > 1
              ? [{ widgets: m.lines.slice(1).map((t) => ({ textParagraph: { text: t } })) }]
              : []),
            ...m.sections.map((s) => ({
              ...(s.title ? { header: s.title } : {}),
              widgets: s.rows.map(widget),
            })),
            ...(m.buttons.length
              ? [
                  {
                    widgets: [
                      {
                        buttonList: {
                          buttons: m.buttons.map((b) => ({
                            text: b.text,
                            onClick: { openLink: { url: b.url } },
                          })),
                        },
                      },
                    ],
                  },
                ]
              : []),
          ],
        },
      },
    ],
  };
}

const C = EMAIL_COLORS;
const FONT = "-apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const esc = escapeHtml;

export const REPORT_EMAIL_FOOTER =
  'Times in Thailand time (UTC+7). This is an automated record — replies aren’t read. The same summary is in the DxT Website Reports Space.';

/**
 * The weekly summary's email to the CEO: subject `DxT Monitor · Weekly summary · 21–27 Sep`, the body
 * the card (same sections), with a plain-text part.
 */
export function weeklyEmail(m: ReportModel, f: Pick<WeeklyFacts, 'weekStart' | 'weekEnd'>): EmailMessage {
  const subject = `DxT Monitor · Weekly summary · ${formatDayRange(f.weekStart, f.weekEnd, { short: true })}`;
  const why = 'You got this because you get the weekly summary as the CEO.';
  const row = (r: Row) =>
    `<tr><td style="padding:6px 0;font-size:13px;line-height:1.5;color:${r.warning ? C.warning : C.primary};border-bottom:1px solid ${C.borderSubtle}">` +
    (r.label ? `<b style="font-weight:600">${esc(r.label)}</b> · ` : '') +
    esc(r.text) +
    (r.who ? ` <b style="font-weight:600">— ${esc(r.who)}</b>` : '') +
    (r.trail ? ` — ${esc(r.trail)}` : '') +
    '</td></tr>';
  const section = (s: Section) =>
    `<tr><td style="padding:18px 0 4px">${
      s.title
        ? `<div style="font-size:11px;font-weight:700;letter-spacing:0.06em;color:${C.secondary}">${esc(s.title)}</div>`
        : ''
    }<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${s.rows.map(row).join('')}</table></td></tr>`;
  const buttons = m.buttons
    .map(
      (b) =>
        `<a href="${esc(b.url)}" style="display:inline-block;margin-right:10px;padding:12px 24px;border-radius:9999px;background:transparent;border:1px solid ${C.buttonBorder};color:${C.primary};font-size:14px;line-height:18px;font-weight:500;text-decoration:none">${esc(b.text)}</a>`,
    )
    .join('');
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:${C.canvas}">
<div style="display:none;max-height:0;overflow:hidden">${esc(m.lines.join(' · '))}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.canvas};font-family:${FONT}">
<tr><td align="center" style="padding:24px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px">
<tr><td style="background:${C.surface};border:1px solid ${C.border};border-radius:8px;padding:22px 28px">
<div style="font-size:20px;line-height:1.3;font-weight:700;color:${C.primary}">${esc(m.title)}</div>
${m.lines.map((l, i) => `<div style="margin-top:4px;font-size:${i === 0 ? 15 : 13}px;line-height:1.5;font-weight:${i === 0 ? 600 : 400};color:${i === 0 ? C.primary : C.secondary}">${esc(l)}</div>`).join('\n')}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${m.sections.map(section).join('')}</table>
${buttons ? `<div style="margin-top:18px">${buttons}</div>` : ''}
</td></tr>
<tr><td style="padding:16px 8px 0;text-align:center;font-size:12px;line-height:1.5;color:${C.secondary}"><b style="font-weight:600;color:${C.primary}">${esc(why)}</b><br>${esc(REPORT_EMAIL_FOOTER)}</td></tr>
</table>
</td></tr></table>
</body></html>`;
  const text = [
    m.title,
    ...m.lines,
    ...m.sections.flatMap((s) => [
      '',
      ...(s.title ? [s.title] : []),
      ...s.rows.map((r) => `${r.label ? `${r.label} · ` : ''}${rowText(r)}`),
    ]),
    '',
    ...m.buttons.map((b) => `${b.text}: ${b.url}`),
    '--',
    why,
    REPORT_EMAIL_FOOTER,
  ].join('\n');
  return { subject, html, text, headers: {} };
}
