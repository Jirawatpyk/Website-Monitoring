import { allowedDownMinutes, formatDayRange, formatDuration, formatPercent, formatTime } from '@dxt/shared';
import { plainName } from './chat-alerts';
import { escapeHtml, type EmailMessage } from './email-alerts';
import {
  dayTime,
  midSentence,
  monitorLines,
  plannedText,
  comingLines,
  type ReportIncident,
  type ReportSiteUptime,
  type WeeklyFacts,
} from './reports';

/**
 * The weekly summary's email to the CEO (WeeklyEmail board, spec §36, D-0xx): its own layout — figures
 * first, status badges that carry their word, two lines per incident — with the same content and the
 * same section order as the Chat card on WeeklySummary. Email-safe: tables, inline light colours, the
 * dark set from a `prefers-color-scheme` block; phone layout from a `max-width` block. Plain-text part
 * in the same order.
 */

/** AURA light / dark tokens resolved to hex (email clients have no CSS variables). */
const L = {
  canvas: '#fafafa',
  surface: '#ffffff',
  primary: '#18181b',
  secondary: '#52525b',
  border: '#e4e4e7',
  danger: '#b91c1c',
  positive: '#3f6212',
  warnFg: '#92400e',
  warnBg: '#fffbeb',
  warnBorder: '#fde68a',
  dangerFg: '#b91c1c',
  infoBg: '#f5f3ff',
  infoFg: '#5b21b6',
  infoBorder: '#ddd6fe',
  control: '#71717a',
  buttonBg: '#18181b',
  buttonFg: '#ffffff',
} as const;
const D = {
  canvas: '#08080a',
  surface: '#18181b',
  primary: '#ffffff',
  secondary: '#a1a1aa',
  border: '#3f3f46',
  danger: '#f87171',
  positive: '#bef264',
  warnFg: '#fcd34d',
  warnBg: '#372b19',
  warnBorder: '#704e15',
  dangerFg: '#fca5a5',
  infoBg: '#2c283a',
  infoFg: '#c4b5fd',
  infoBorder: '#514674',
  control: '#a1a1aa',
  buttonBg: '#ffffff',
  buttonFg: '#18181b',
} as const;
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
      figure: s.since
        ? `${pct(s.uptime)} since ${dayTime(s.since).replace(/ \d\d:\d\d$/, '')}`
        : pct(s.uptime),
      rest: `target ${formatPercent(s.target)} · ${formatDuration(Math.ceil(s.downMinutes - 1e-6))} down · ${formatDuration(Math.floor(allowedDownMinutes(s.target, s.windowMinutes) + 1e-6))} allowed`,
    })),
    on,
  };
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
    onTarget: string | null;
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
      : m.seconds > m.targetMin * 60
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
              ? `${u.on.length} on target — ${namesOf(u.on)}`
              : `All ${u.on.length} on target`
            : null,
        }
      : null,
    mtta: f.mtta.map((m) => ({
      k: `Tier ${m.tier}`,
      v:
        m.seconds === null
          ? m.tier === 1
            ? '— (no DOWN)'
            : '— (no DOWN in hours)'
          : `${formatDuration(Math.max(1, Math.round(m.seconds / 60)))}${m.targetMin !== null ? ` · target ${m.targetMin}` : ''}`,
      tone: mttaTone(m),
    })),
    planned: f.planned.map((w) => ({
      badge: w.kind === 'mute' ? 'muted' : 'maintenance',
      text: plannedText(w, f.at),
    })),
    coming: comingLines(f),
    monitor: monitorLines(f.monitor),
    button: { text: 'Open incidents', url: `${f.appUrl}/incidents` },
  };
}

// ── HTML ────────────────────────────────────────────────────────────────

const STYLE = `
.wk-tile{display:inline-block;width:25%;vertical-align:top}
@media (max-width:480px){
  .wk-pad{padding:14px 12px !important}
  .wk-card{padding:18px 16px !important}
  .wk-title{font-size:21px !important}
  .wk-tile{width:50% !important}
  .wk-bcol,.wk-body{display:block !important;width:auto !important}
  .wk-bcol{padding-bottom:6px !important}
}
@media (prefers-color-scheme:dark){
  .wk-bg{background:${D.canvas} !important}
  .wk-surface{background:${D.surface} !important;border-color:${D.border} !important}
  .wk-p{color:${D.primary} !important}
  .wk-s{color:${D.secondary} !important}
  .wk-line{border-color:${D.border} !important}
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
  const tiles = m.tiles
    .map(
      (t) =>
        `<div class="wk-tile"><div style="padding:4px"><div class="wk-surface" style="padding:12px 12px 10px;border:1px solid ${L.border};border-radius:8px;background:${L.surface}"><div class="wk-p" style="font-size:28px;line-height:1.1;font-weight:700;color:${L.primary}">${esc(t.n)}</div><div class="wk-s" style="font-size:12px;line-height:1.35;color:${L.secondary}"><b class="wk-p" style="font-weight:600;color:${L.primary}">${esc(t.k)}</b><br>${esc(t.cap)}</div></div></div></div>`,
    )
    .join('');
  const needs = m.needs.length
    ? `${heading(`NEEDS SOMEONE · ${m.needs.length}`)}<table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="wk-warnbox" style="border:1px solid ${L.warnBorder};border-radius:8px;background:${L.warnBg}">${m.needs
        .map(
          (n, i) =>
            `<tr><td class="wk-p${i ? ' wk-line' : ''}" style="padding:9px 14px;font-size:14px;line-height:1.45;color:${L.primary};${i ? `border-top:1px solid ${L.warnBorder}` : ''}">${esc(n.text)}</td><td class="wk-p${i ? ' wk-line' : ''}" style="padding:9px 14px 9px 0;font-size:14px;font-weight:700;text-align:right;white-space:nowrap;vertical-align:top;color:${L.primary};${i ? `border-top:1px solid ${L.warnBorder}` : ''}">${esc(n.who)}</td></tr>`,
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
        )}${m.uptime.onTarget ? `<div class="wk-p" style="font-size:14px;line-height:1.45;color:${L.primary}"><span class="wk-pos" style="font-weight:700;color:${L.positive}">✓</span> ${esc(m.uptime.onTarget)}</div>` : ''}`
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
<div style="margin:0 -4px">${tiles}</div>
${m.month ? `<div class="wk-s" style="padding-top:10px;font-size:13px;line-height:1.5;color:${L.secondary}">${esc(m.month)}</div>` : ''}
${needs}${incidents}${uptime}${mtta}${planned}${lines('COMING UP', m.coming)}${lines('THE MONITOR ITSELF', m.monitor, true)}
<div style="padding-top:20px"><a href="${esc(m.button.url)}" class="wk-btn" style="display:inline-block;padding:12px 24px;border-radius:9999px;background:${L.buttonBg};color:${L.buttonFg};font-size:14px;line-height:20px;font-weight:600;text-decoration:none">${esc(m.button.text)}</a></div>
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
      ? ['', `NEEDS SOMEONE · ${m.needs.length}`, ...m.needs.map((n) => `${n.text} — ${n.who}`)]
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
          ...(m.uptime.onTarget ? [`✓ ${m.uptime.onTarget}`] : []),
        ]
      : []),
    ...(m.mtta.length
      ? ['', 'MTTA · TIME TO ACKNOWLEDGE A DOWN', m.mtta.map((x) => `${x.k} ${x.v}`).join(' · ')]
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
