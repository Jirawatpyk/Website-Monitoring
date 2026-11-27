import {
  allowedDownMinutes,
  formatDay,
  formatDayRange,
  formatDuration,
  formatPercent,
  formatTime,
} from '@dxt/shared';
import { plainName } from './chat-alerts';
import { EMAIL_COLORS, EMAIL_COLORS_DARK, escapeHtml, type EmailMessage } from './email-alerts';
import {
  dayTime,
  midSentence,
  monitorLines,
  mttaAckedCount,
  plannedText,
  comingLines,
  type ReportIncident,
  type ReportSiteUptime,
  type WeeklyFacts,
} from './reports';

/**
 * The weekly summary's email to the CEO (WeeklyEmail board, spec §36, D-063): its own layout — figures
 * first, status badges that carry their word, two lines per incident — with the same content and the
 * same section order as the Chat card on WeeklySummary. Email-safe: tables, inline light colours, the
 * dark set from a `prefers-color-scheme` block; phone layout from a `max-width` block. Plain-text part
 * in the same order.
 */

/** §36.11: colours from the email tokens (AURA light, and the dark set). */
const L = EMAIL_COLORS;
const D = EMAIL_COLORS_DARK;
const FONT = "-apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const esc = escapeHtml;

export const WEEKLY_EMAIL_FOOTER =
  'Times in Thailand time (UTC+7). This is an automated record — replies aren’t read.';
const WHY = 'You got this because you get the weekly summary as the CEO.';

type BadgeKind = 'down' | 'problem' | 'wasDown' | 'wasProblem' | 'maintenance' | 'muted';
const BADGE_WORD: Record<BadgeKind, string> = {
  down: 'DOWN',
  problem: 'PROBLEM',
  wasDown: 'Was down',
  wasProblem: 'Was problem',
  maintenance: 'Maintenance',
  muted: 'Muted',
};

/** Open = still failing when the report was made (a DOWN back with a PROBLEM still open counts, §19.7). */
const isOpen = (i: ReportIncident) => i.failing || !!i.stillProblem;
const badgeOf = (i: ReportIncident): BadgeKind =>
  i.failing && i.severity === 'down'
    ? 'down'
    : isOpen(i)
      ? 'problem'
      : i.severity === 'down'
        ? 'wasDown'
        : 'wasProblem';

interface IncidentLine {
  badge: BadgeKind;
  site: string;
  line1: string;
  line2: string;
}

function incidentLine(i: ReportIncident): IncidentLine {
  const length = isOpen(i)
    ? `${formatDuration(i.minutes)}${i.severity === 'down' ? ' down' : ''} · still open`
    : formatDuration(i.minutes);
  const reached = i.level > 0 ? `reached L${i.level}` : null;
  const acked = i.acked ? `acked by ${plainName(i.acked.by)} ${formatTime(i.acked.at)}` : null;
  const parts = [
    i.stillProblem
      ? `Home page back, still failing: ${midSentence(i.stillProblem)}`
      : i.drops > 1
        ? `${i.cause}, flapped ×${i.drops}`
        : i.cause,
    ...(i.outsideHours ? ['outside response hours'] : []),
    ...(reached || acked ? [[reached, acked].filter(Boolean).join(', ')] : []),
    ...(i.clientUpdate
      ? [`client updated by ${plainName(i.clientUpdate.by)} ${formatTime(i.clientUpdate.at)}`]
      : []),
    i.rootCause ? `root cause: ${midSentence(i.rootCause)}` : 'no root cause yet',
  ];
  return {
    badge: badgeOf(i),
    site: plainName(i.site),
    line1: `${dayTime(i.startedAt)} · ${length}`,
    line2: parts.join(' · '),
  };
}

/** Uptime shown rounded down, as the Chat card (a site just under its target never reads the target). */
const pct = (u: number) => formatPercent(Math.floor(u * 10_000 + 1e-6) / 10_000);

function uptimeOf(sites: readonly ReportSiteUptime[]) {
  const below = sites
    .filter((s) => s.uptime < s.target)
    .sort((a, b) => b.target - b.uptime - (a.target - a.uptime) || a.site.localeCompare(b.site));
  const on = sites
    .filter((s) => s.uptime >= s.target)
    .sort((a, b) => a.tier - b.tier || a.uptime - b.uptime || a.site.localeCompare(b.site));
  return {
    below: below.map((s) => ({
      site: plainName(s.site),
      // D-059: judged over 30 days (or since monitoring began), this week beside it — under the weekly
      // tiles a bare figure would read as the week's.
      figure: s.since
        ? `${pct(s.uptime)} since ${dayTime(s.since).replace(/ \d\d:\d\d$/, '')}`
        : `30 d ${pct(s.uptime)}`,
      rest: `target ${formatPercent(s.target)}${s.week !== null ? ` · this week ${pct(s.week)}` : ''} · ${formatDuration(Math.ceil(s.downMinutes - 1e-6))} down · ${formatDuration(Math.floor(allowedDownMinutes(s.target, s.windowMinutes) + 1e-6))} allowed`,
    })),
    on,
  };
}

/** "Mon 16 → Mon 23 Nov" (one month), "Mon 30 Nov → Mon 7 Dec". */
function weekSpan(w: { start: Date; end: Date }): string {
  const a = formatDay(w.start, { weekday: true });
  const b = formatDay(w.end, { weekday: true });
  const month = (s: string) => s.split(' ').at(-1);
  return `${month(a) === month(b) ? a.replace(/ \S+$/, '') : a} → ${b}`;
}

/** "Bangkok Airways – Taiwan, realme.link, Fuji Links and 10 more". */
function namesOf(sites: readonly ReportSiteUptime[]): string {
  const names = sites.map((s) => plainName(s.site));
  return names.length > 4 ? `${names.slice(0, 4).join(', ')} and ${names.length - 4} more` : names.join(', ');
}

export interface WeeklyEmailModel {
  subject: string;
  preheader: string;
  title: string;
  tiles: { n: string; k: string; cap: string }[];
  month: string | null;
  needs: { text: string; who: string }[];
  incidentsTitle: string | null;
  incidents: IncidentLine[];
  uptime: {
    below: { site: string; figure: string; rest: string }[];
    onTarget: { count: string; names: string | null } | null;
  } | null;
  mtta: { k: string; v: string; tone: 'positive' | 'warning' | 'neutral' }[];
  planned: { badge: BadgeKind; text: string }[];
  coming: string[];
  monitor: string[];
  button: { text: string; url: string };
}

/** The email's words (pure): what the board draws, from the weekly facts. */
export function weeklyEmailModel(f: WeeklyFacts): WeeklyEmailModel {
  const downs = f.incidents.filter((i) => i.severity === 'down');
  const problems = f.incidents.filter((i) => i.severity === 'problem');
  const open = f.incidents.filter(isOpen);
  const openDown = downs.filter(isOpen);
  const openProblem = problems.filter(isOpen);
  const downCap = openDown.length
    ? `this week · ${openDown.length} still open${openDown.every((i) => !i.failing) ? ', now PROBLEM' : ''}`
    : downs.length
      ? 'this week · all recovered'
      : 'this week';
  const problemCap = openProblem.length
    ? `this week · ${openProblem.length} still open`
    : problems.length
      ? 'this week · all recovered'
      : 'this week';
  // Open first, then the newest first (§36.5).
  const ordered = [...f.incidents].sort(
    (a, b) => Number(isOpen(b)) - Number(isOpen(a)) || b.startedAt.getTime() - a.startedAt.getTime(),
  );
  const u = uptimeOf(f.sites);
  const below = u.below.map((b) => b.site);
  const month = f.sites.length
    ? `Last 30 days: ${f.sites.length - below.length}/${f.sites.length} sites on their uptime target${
        below.length
          ? ` — ${below.length > 3 ? `${below.slice(0, 3).join(', ')} and ${below.length - 3} more are` : `${below.join(', ').replace(/, ([^,]*)$/, ' and $1')} ${below.length === 1 ? 'is' : 'are'}`} below.`
          : '.'
      }`
    : null;
  const mttaTone = (m: WeeklyFacts['mtta'][number]) =>
    m.seconds === null || m.targetMin === null
      ? 'neutral'
      : Math.max(1, Math.round(m.seconds / 60)) > m.targetMin
        ? 'warning'
        : 'positive';
  const range = formatDayRange(f.weekStart, f.weekEnd, { short: true });
  const needsN = f.needsSomeone.length;
  return {
    subject: `DxT Monitor · Weekly summary · ${range}`,
    preheader: [
      `Uptime ${formatPercent(f.uptime)}`,
      `${f.sitesWithoutDowntime}/${f.sitesTotal} sites had no downtime`,
      f.incidents.length
        ? `${downs.length} DOWN, ${problems.length} PROBLEM this week`
        : 'no incidents this week',
      ...(open.length ? [`${open.length} still open`] : []),
      ...(needsN ? [`${needsN} ${needsN === 1 ? 'thing needs' : 'things need'} someone`] : []),
    ].join(' · '),
    title: `Website week · ${formatDayRange(f.weekStart, f.weekEnd)}`,
    tiles: [
      {
        n: formatPercent(f.uptime),
        k: 'Uptime, all sites',
        cap: 'this week · maintenance excluded',
      },
      {
        n: `${f.sitesWithoutDowntime}/${f.sitesTotal}`,
        k: 'No downtime',
        cap: 'sites this week',
      },
      { n: String(downs.length), k: 'DOWN incidents', cap: downCap },
      { n: String(problems.length), k: 'PROBLEM incidents', cap: problemCap },
    ],
    month,
    needs: f.needsSomeone.map((n) => ({
      text: n.text,
      who: n.who.map((p) => plainName(p.name)).join(', '),
    })),
    incidentsTitle: f.incidents.length
      ? `INCIDENTS · ${f.incidents.length} · ${open.length ? `${open.length} STILL OPEN` : 'ALL RECOVERED'}`
      : null,
    incidents: ordered.map(incidentLine),
    uptime: f.sites.length
      ? {
          below: u.below,
          onTarget: u.on.length
            ? u.below.length
              ? { count: `${u.on.length} on target`, names: `— ${namesOf(u.on)}` }
              : { count: `All ${u.on.length} on target`, names: null }
            : null,
        }
      : null,
    mtta: f.mtta.map((m) => {
      const count = mttaAckedCount(m);
      const v =
        m.seconds === null
          ? m.tier === 1
            ? '— (no DOWN)'
            : f.incidents.some((i) => i.severity === 'down')
              ? '— (no DOWN in hours)'
              : '— (no DOWN)'
          : `${formatDuration(Math.max(1, Math.round(m.seconds / 60)))}${m.targetMin !== null ? ` · target ${m.targetMin}` : ''}`;
      return {
        k: `Tier ${m.tier}`,
        // D-075: a tier with DOWNs never says "(no DOWN)": nobody acked them, or no ack fell in hours
        v:
          m.seconds === null && count
            ? m.acked
              ? `— (no acked DOWN in hours) · ${count}`
              : `— · ${count}`
            : count
              ? `${v} · ${count}`
              : v,
        tone: mttaTone(m),
      };
    }),
    planned: f.planned.map((w) => ({
      badge: w.kind === 'mute' ? 'muted' : 'maintenance',
      text: plannedText(w, f.at),
    })),
    // The board's on-call line (§36: "On call (…): Nok, Mon 16 → Mon 23 Nov. Next: Arm."); the windows as the card.
    coming: [
      ...(f.onCall.thisWeek
        ? [
            `On call (Tier 1 nights and weekends): ${plainName(f.onCall.thisWeek.name)}, ${weekSpan(f.onCall.thisWeek.week)}.${f.onCall.next ? ` Next: ${plainName(f.onCall.next.name)}${f.onCall.next.swap ? ` — ${f.onCall.next.swap}` : ''}.` : ''}`,
          ]
        : []),
      ...comingLines({ ...f, onCall: { thisWeek: null, next: null } }),
    ],
    monitor: monitorLines(f.monitor),
    button: { text: 'Open incidents', url: `${f.appUrl}/incidents` },
  };
}

// ── HTML ────────────────────────────────────────────────────────────────

const STYLE = `
.wk-t2{display:none;mso-hide:all}
@media (max-width:480px){
  .wk-pad{padding:14px 12px !important}
  .wk-card{padding:18px 16px !important}
  .wk-title{font-size:21px !important}
  .wk-t4{display:none !important}
  .wk-t2{display:table !important}
  .wk-bcol,.wk-body{display:block !important;width:auto !important}
  .wk-bcol{padding-bottom:6px !important}
  .wk-body{border-top:0 !important;padding-top:0 !important}
}
@media (prefers-color-scheme:dark){
  .wk-bg{background:${D.canvas} !important}
  .wk-surface{background:${D.surface} !important;border-color:${D.border} !important}
  .wk-p{color:${D.primary} !important}
  .wk-s{color:${D.secondary} !important}
  .wk-line{border-color:${D.border} !important}
  .wk-warnline{border-color:${D.warnBorder} !important}
  .wk-warnbox{background:${D.warnBg} !important;border-color:${D.warnBorder} !important;color:${D.primary} !important}
  .wk-warn{color:${D.warnFg} !important}
  .wk-pos{color:${D.positive} !important}
  .b-down{background:${D.danger} !important;border-color:${D.danger} !important;color:${D.surface} !important}
  .b-problem{background:${D.warnFg} !important;border-color:${D.warnFg} !important;color:${D.surface} !important}
  .b-wasDown{border-color:${D.dangerFg} !important;color:${D.dangerFg} !important}
  .b-wasProblem{border-color:${D.warnFg} !important;color:${D.warnFg} !important}
  .b-maintenance{background:${D.infoBg} !important;border-color:${D.infoBorder} !important;color:${D.infoFg} !important}
  .b-muted{border-color:${D.control} !important;color:${D.secondary} !important}
  .wk-btn{background:${D.buttonBg} !important;color:${D.buttonFg} !important}
}`;

const BADGE_STYLE: Record<BadgeKind, string> = {
  down: `background:${L.danger};border:1px solid ${L.danger};color:${L.surface}`,
  problem: `background:${L.warnFg};border:1px solid ${L.warnFg};color:${L.surface}`,
  wasDown: `background:transparent;border:1px solid ${L.dangerFg};color:${L.dangerFg}`,
  wasProblem: `background:transparent;border:1px solid ${L.warnFg};color:${L.warnFg}`,
  maintenance: `background:${L.infoBg};border:1px solid ${L.infoBorder};color:${L.infoFg}`,
  muted: `background:transparent;border:1px solid ${L.control};color:${L.secondary}`,
};
const badge = (k: BadgeKind) =>
  `<span class="b-${k}" style="display:inline-block;padding:2px 8px;border-radius:9999px;font-size:12px;line-height:18px;font-weight:600;white-space:nowrap;${BADGE_STYLE[k]}">${esc(BADGE_WORD[k])}</span>`;

const heading = (t: string) =>
  `<div class="wk-s" style="padding:18px 0 8px;font-size:12px;font-weight:700;letter-spacing:0.05em;color:${L.secondary}">${esc(t)}</div>`;

export function weeklyEmail(f: WeeklyFacts): EmailMessage {
  const m = weeklyEmailModel(f);
  const tile = (t: WeeklyEmailModel['tiles'][number], width: string) =>
    `<td class="wk-surface" width="${width}" style="width:${width};padding:12px 12px 10px;vertical-align:top;border:1px solid ${L.border};border-radius:8px;background:${L.surface}"><div class="wk-p" style="font-size:28px;line-height:1.1;font-weight:700;color:${L.primary}">${esc(t.n)}</div><div class="wk-s" style="font-size:12px;line-height:1.35;color:${L.secondary}"><b class="wk-p" style="font-weight:600;color:${L.primary}">${esc(t.k)}</b><br>${esc(t.cap)}</div></td>`;
  const grid = (rows: WeeklyEmailModel['tiles'][], cls: string, width: string, hidden: boolean) =>
    `<table role="presentation" class="${cls}" width="100%" cellpadding="0" cellspacing="8" style="width:100%;border-collapse:separate;margin:-8px 0 -8px -8px;width:calc(100% + 16px)${hidden ? ';display:none;mso-hide:all' : ''}">${rows.map((r) => `<tr>${r.map((t) => tile(t, width)).join('')}</tr>`).join('')}</table>`;
  const tiles =
    grid([m.tiles], 'wk-t4', '25%', false) +
    grid([m.tiles.slice(0, 2), m.tiles.slice(2)], 'wk-t2', '50%', true);
  const needs = m.needs.length
    ? `${heading(`NEEDS SOMEONE · ${m.needs.length}`)}<table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="wk-warnbox" style="border:1px solid ${L.warnBorder};border-radius:8px;background:${L.warnBg}">${m.needs
        .map(
          (n, i) =>
            `<tr><td class="wk-p${i ? ' wk-warnline' : ''}" style="padding:9px 14px;font-size:14px;line-height:1.45;color:${L.primary};${i ? `border-top:1px solid ${L.warnBorder}` : ''}"${n.who ? '' : ' colspan="2"'}>${esc(n.text)}</td>${n.who ? `<td class="wk-p${i ? ' wk-warnline' : ''}" style="padding:9px 14px 9px 0;font-size:14px;font-weight:700;text-align:right;white-space:nowrap;vertical-align:top;color:${L.primary};${i ? `border-top:1px solid ${L.warnBorder}` : ''}">${esc(n.who)}</td>` : ''}</tr>`,
        )
        .join('')}</table>`
    : '';
  const incidents = m.incidentsTitle
    ? `${heading(m.incidentsTitle)}<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${m.incidents
        .map(
          (i) =>
            `<tr><td class="wk-bcol wk-line" style="width:104px;padding:10px 12px 10px 0;vertical-align:top;border-top:1px solid ${L.border}">${badge(i.badge)}</td><td class="wk-body wk-line" style="padding:10px 0;vertical-align:top;border-top:1px solid ${L.border}"><div class="wk-p" style="font-size:15px;line-height:1.4;color:${L.primary}"><b style="font-weight:700">${esc(i.site)}</b> · ${esc(i.line1)}</div><div class="wk-s" style="font-size:13px;line-height:1.45;color:${L.secondary}">${esc(i.line2)}</div></td></tr>`,
        )
        .join('')}</table>`
    : '';
  const uptime = m.uptime
    ? `${heading('UPTIME BY SITE · TARGETS')}${m.uptime.below
        .map(
          (b) =>
            `<div class="wk-warnbox" style="margin-bottom:8px;padding:9px 12px;border:1px solid ${L.warnBorder};border-radius:8px;background:${L.warnBg};font-size:14px;line-height:1.45;color:${L.primary}"><b>${esc(b.site)}</b> <b class="wk-warn" style="color:${L.warnFg}">below target</b> · <b>${esc(b.figure)}</b> <span class="wk-s" style="color:${L.secondary}">· ${esc(b.rest)}</span></div>`,
        )
        .join(
          '',
        )}${m.uptime.onTarget ? `<div class="wk-p" style="font-size:14px;line-height:1.45;color:${L.primary}"><span class="wk-pos" style="font-weight:700;color:${L.positive}">✓</span> <b style="font-weight:600">${esc(m.uptime.onTarget.count)}</b>${m.uptime.onTarget.names ? ` <span class="wk-s" style="color:${L.secondary}">${esc(m.uptime.onTarget.names)}</span>` : ''}</div>` : ''}`
    : '';
  const toneColor = {
    positive: L.positive,
    warning: L.warnFg,
    neutral: L.primary,
  } as const;
  const toneClass = {
    positive: 'wk-pos',
    warning: 'wk-warn',
    neutral: 'wk-p',
  } as const;
  const mtta = m.mtta.length
    ? `${heading('MTTA · TIME TO ACKNOWLEDGE A DOWN')}<div>${m.mtta
        .map(
          (x) =>
            `<span class="wk-line" style="display:inline-block;margin:0 8px 8px 0;padding:6px 10px;border:1px solid ${L.border};border-radius:8px;font-size:14px;line-height:1.5"><span class="wk-s" style="color:${L.secondary}">${esc(x.k)}</span> <b class="${toneClass[x.tone]}" style="color:${toneColor[x.tone]}">${esc(x.v)}</b></span>`,
        )
        .join('')}</div>`
    : '';
  const lines = (title: string, items: readonly string[], small = false) =>
    items.length
      ? `${heading(title)}${items.map((t) => `<div class="${small ? 'wk-s' : 'wk-p'}" style="padding-bottom:4px;font-size:${small ? 13 : 14}px;line-height:1.5;color:${small ? L.secondary : L.primary}">${esc(t)}</div>`).join('')}`
      : '';
  const planned = m.planned.length
    ? `${heading('PLANNED & QUIET')}${m.planned.map((p) => `<div class="wk-p" style="padding-bottom:6px;font-size:14px;line-height:1.45;color:${L.primary}">${badge(p.badge)} ${esc(p.text)}</div>`).join('')}`
    : '';
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark"><title>${esc(m.subject)}</title><style>${STYLE}</style></head>
<body class="wk-bg" style="margin:0;padding:0;background:${L.canvas}">
<div style="display:none;max-height:0;overflow:hidden">${esc(m.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="wk-bg" style="background:${L.canvas};font-family:${FONT}">
<tr><td align="center" class="wk-pad" style="padding:24px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px">
<tr><td class="wk-card wk-surface" style="background:${L.surface};border:1px solid ${L.border};border-radius:10px;padding:24px 28px">
<div class="wk-s" style="font-size:12px;font-weight:700;letter-spacing:0.05em;color:${L.secondary}">WEEKLY SUMMARY</div>
<div class="wk-title wk-p" style="padding:4px 0 14px;font-size:24px;line-height:1.25;font-weight:700;color:${L.primary}">${esc(m.title)}</div>
${tiles}
${m.month ? `<div class="wk-s" style="padding-top:10px;font-size:13px;line-height:1.5;color:${L.secondary}">${esc(m.month)}</div>` : ''}
${needs}${incidents}${uptime}${mtta}${planned}${lines('COMING UP', m.coming)}${lines('THE MONITOR ITSELF', m.monitor, true)}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:20px"><tr><td><a href="${esc(m.button.url)}" class="wk-btn" style="display:inline-block;padding:12px 24px;border-radius:9999px;background:${L.buttonBg};color:${L.buttonFg};font-size:14px;line-height:20px;font-weight:600;text-decoration:none">${esc(m.button.text)}</a></td><td align="right" style="vertical-align:middle"><span class="wk-btn" style="display:inline-block;padding:3px 8px;border-radius:4px;background:${L.buttonBg};color:${L.buttonFg};font-size:13px;line-height:20px;font-weight:700">DxT <span style="display:inline-block;width:5px;height:5px;border-radius:9999px;background:${L.accentDot};vertical-align:middle"></span></span></td></tr></table>
</td></tr>
<tr><td class="wk-s" style="padding:16px 8px 0;text-align:center;font-size:12px;line-height:1.5;color:${L.secondary}"><b class="wk-p" style="font-weight:600;color:${L.primary}">${esc(WHY)}</b><br>${esc(WEEKLY_EMAIL_FOOTER)}</td></tr>
</table>
</td></tr></table>
</body></html>`;
  const text = [
    'WEEKLY SUMMARY',
    m.title,
    '',
    ...m.tiles.map((t) => `${t.k}: ${t.n} (${t.cap})`),
    ...(m.month ? [m.month] : []),
    ...(m.needs.length
      ? [
          '',
          `NEEDS SOMEONE · ${m.needs.length}`,
          ...m.needs.map((n) => (n.who ? `${n.text} — ${n.who}` : n.text)),
        ]
      : []),
    ...(m.incidentsTitle
      ? [
          '',
          m.incidentsTitle,
          ...m.incidents.flatMap((i) => [`${BADGE_WORD[i.badge]} · ${i.site} · ${i.line1}`, `  ${i.line2}`]),
        ]
      : []),
    ...(m.uptime
      ? [
          '',
          'UPTIME BY SITE · TARGETS',
          ...m.uptime.below.map((b) => `${b.site} below target · ${b.figure} · ${b.rest}`),
          ...(m.uptime.onTarget
            ? [`✓ ${m.uptime.onTarget.count}${m.uptime.onTarget.names ? ` ${m.uptime.onTarget.names}` : ''}`]
            : []),
        ]
      : []),
    ...(m.mtta.length
      ? // one tier a line: each value now has " · " inside it (D-075, message-checker)
        ['', 'MTTA · TIME TO ACKNOWLEDGE A DOWN', ...m.mtta.map((x) => `${x.k} ${x.v}`)]
      : []),
    ...(m.planned.length
      ? ['', 'PLANNED & QUIET', ...m.planned.map((p) => `${BADGE_WORD[p.badge]} · ${p.text}`)]
      : []),
    ...(m.coming.length ? ['', 'COMING UP', ...m.coming] : []),
    ...(m.monitor.length ? ['', 'THE MONITOR ITSELF', ...m.monitor] : []),
    '',
    `${m.button.text}: ${m.button.url}`,
    '--',
    WHY,
    WEEKLY_EMAIL_FOOTER,
  ].join('\n');
  return { subject: m.subject, html, text, headers: {} };
}
