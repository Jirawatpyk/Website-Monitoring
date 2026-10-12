import {
  formatDay,
  formatIncidentId,
  formatNameList,
  formatTier,
  formatTime,
  formatWindowLength,
  isSameBangkokDay,
} from '@dxt/shared';
import { plainName, type ChatMessage, type ChatPerson, type ChatWidget } from './chat-alerts';
import { buildChatTextLine, type ChatState } from './chat-text';
import {
  EMAIL_COLORS,
  emailLayout,
  senderDomain,
  type EmailBody,
  type EmailMessage,
  type Envelope,
} from './email-alerts';
import { formatResume } from './escalation-alerts';

/**
 * Maintenance and mute messages (S09b, spec §24, D-037; ChatAlert STATE "Maintenance · …", EmailAlert
 * "Maintenance · approval" / "Maintenance · owner & backup"):
 * - one plain line per action in the window's own Alerts Space thread (no card, no mention, §24.4);
 * - the "direct messages" — the request and reminders to the Admins, the answer to the asker, the
 *   MUTED line to the owner and backup — as replies in that thread that @mention the person, with the
 *   board's DM card (no Chat app yet, D-037);
 * - one email per owner / backup (and Admin, for a request) in one mail thread per window.
 * Every link opens Maintenance & mutes; nothing has an Approve button (§24). The client status page
 * isn't built yet, so the request leaves out "the client status page shows Planned maintenance".
 */

/** Every action the RPCs and the engine store with a window row (`context.kind`). */
export const WINDOW_ACTIONS = [
  'requested',
  'scheduled',
  'approved',
  'declined',
  'withdrawn',
  'request_changed',
  'changed',
  'cancelled',
  'started',
  'ended',
  'ended_early',
  'didnt_start',
  'not_approved',
  'muted',
  'mute_changed',
  'mute_ended',
  'mute_ended_early',
] as const;
export type WindowAction = (typeof WINDOW_ACTIONS)[number];

/** Who a mention reply goes to, and what it says (`context.dm`). */
export const WINDOW_DMS = [
  'requested',
  'reminder_12h',
  'reminder_1h',
  'still_waiting',
  'approved',
  'declined',
  'not_approved',
  'muted',
] as const;
export type WindowDm = (typeof WINDOW_DMS)[number];

export interface WindowFacts {
  windowId: string;
  site: string;
  tier: number;
  startsAt: Date;
  endsAt: Date;
  reason: string;
  /** Who made it, and when (the request's "asked by Arm · Fri 25 Sep 09:20"). */
  createdBy: string | null;
  createdAt: Date;
  approvedBy: string | null;
  approvedAt: Date | null;
  owner: ChatPerson | null;
  backup: ChatPerson | null;
  /** Every active Admin ("Tao reminded"). */
  admins: readonly ChatPerson[];
  /** Maintenance & mutes (`/maintenance`). */
  pageUrl: string;
}

/** The incident a window couldn't start over, or that posts when a mute ends. */
export interface WindowIncident {
  /** "INC-0155", or null when the site was DOWN with no incident open. */
  number: number | null;
  severity?: 'down' | 'problem';
  since?: Date | null;
  url?: string | null;
  /** Tier 2–3 outside response hours: when its timers run again. */
  pausedUntil?: Date | null;
  /** Someone acknowledged it: it stays open, no longer escalating (§24.4 wording). */
  acked?: boolean;
}

/** One action as the RPC or the engine queued it (`notifications.context`). */
export interface WindowEvent {
  action: WindowAction;
  at: Date;
  by: string | null;
  reason?: string | null;
  /** Edit end: the old and the new end. */
  from?: Date | null;
  to?: Date | null;
  incident?: WindowIncident | null;
}

// ── Words ──────────────────────────────────────────────────────────────
const full = (d: Date) => `${formatDay(d, { weekday: true })} ${formatTime(d)}`;
/** "22:00" today, else "Sat 26 Sep 22:00" (§24.4: a date only when it isn't today). */
const at = (d: Date, now: Date) => (isSameBangkokDay(d, now) ? formatTime(d) : full(d));
/** "Tue 29 Sep 01:00 → 03:00": the end's date only when it is another day than the start. */
const span = (start: Date, end: Date, startText: string) =>
  `${startText} → ${isSameBangkokDay(start, end) ? formatTime(end) : full(end)}`;
const lengthOf = (start: Date, end: Date) => formatWindowLength((end.getTime() - start.getTime()) / 60_000);
/** "(was 03:00)", "(was Tue 29 Sep)", "(was Mon 28 Sep 21:00)": only what differs. */
function was(from: Date, to: Date) {
  if (isSameBangkokDay(from, to)) return formatTime(from);
  return formatTime(from) === formatTime(to) ? formatDay(from, { weekday: true }) : full(from);
}
/** Names and reasons are people's words: no `<` / `>`, so no mention or markup can be slipped in. */
const quoted = (reason: string | null | undefined) => `“${plainName(reason ?? '')}”`;
const who = (name: string | null | undefined) => plainName(name ?? 'System');
const hoursTo = (start: Date, now: Date) =>
  Math.max(1, Math.round((start.getTime() - now.getTime()) / 3_600_000));
/** "DOWN" unless the incident it is about is a PROBLEM. */
const severityWord = (i: WindowIncident | null | undefined) =>
  i?.severity === 'problem' ? 'PROBLEM' : 'DOWN';
/** "was DOWN" / "had a PROBLEM" (DIDN'T START, §24.6). */
const siteWas = (i: WindowIncident | null | undefined) =>
  i?.severity === 'problem' ? 'had a PROBLEM' : 'was DOWN';
const incidentLabel = (i: WindowIncident | null | undefined) =>
  i?.number != null ? formatIncidentId(i.number) : null;

const KIND: Record<WindowAction, ChatState> = {
  requested: 'MAINTENANCE REQUESTED',
  scheduled: 'MAINTENANCE SCHEDULED',
  approved: 'MAINTENANCE APPROVED',
  declined: 'MAINTENANCE DECLINED',
  withdrawn: 'REQUEST WITHDRAWN',
  request_changed: 'REQUEST CHANGED',
  changed: 'MAINTENANCE CHANGED',
  cancelled: 'MAINTENANCE CANCELLED',
  started: 'MAINTENANCE STARTED',
  ended: 'MAINTENANCE ENDED',
  ended_early: 'MAINTENANCE ENDED EARLY',
  didnt_start: 'DIDN’T START',
  not_approved: 'NOT APPROVED',
  muted: 'MUTED',
  mute_changed: 'MUTE CHANGED',
  mute_ended: 'MUTE ENDED',
  mute_ended_early: 'MUTE ENDED EARLY',
};

/** The detail after `KIND · Site`: when → length → "reason" → by whom → effect (§24.4). */
function lineDetail(f: WindowFacts, e: WindowEvent, now: Date): string[] {
  const by = `by ${who(e.by)}`;
  const len = lengthOf(f.startsAt, f.endsAt);
  const when = span(f.startsAt, f.endsAt, at(f.startsAt, now));
  const posted = (i: WindowIncident | null | undefined) => {
    const label = incidentLabel(i);
    if (!label) return [];
    const since = i?.since ? ` (${severityWord(i)} since ${at(i.since, now)})` : '';
    // A Tier 2–3 PROBLEM outside response hours waits for the opening (engine review M3).
    if (i?.severity === 'problem' && i.pausedUntil)
      return [`${label} posts ${formatResume(i.pausedUntil, now)}${since}`];
    return [`${label} posted${since}`];
  };
  switch (e.action) {
    case 'requested':
      return [`${when} (${len})`, quoted(f.reason), `by ${who(f.createdBy)}`, 'waiting for an Admin'];
    case 'scheduled':
      return [`${when} (${len})`, quoted(f.reason), `by ${who(f.createdBy)}`];
    case 'approved':
      return [by];
    case 'declined':
    case 'withdrawn':
      return [by, quoted(e.reason)];
    case 'request_changed':
      return [...endChange(f, e, now), `now ${len}`, by, 'still waiting'];
    case 'changed':
      return [...endChange(f, e, now), quoted(e.reason), by];
    case 'cancelled':
      return [at(f.startsAt, now), quoted(e.reason), by];
    case 'started':
      return [`until ${at(f.endsAt, now)}`, 'no alerts, not counted in uptime'];
    case 'ended':
      return [`ended on time ${formatTime(f.endsAt)}`, 'alerts back on'];
    case 'ended_early':
      return [`${formatTime(e.at)} ${by}`, quoted(e.reason), 'alerts back on'];
    case 'didnt_start': {
      const label = incidentLabel(e.incident);
      return [
        `site ${siteWas(e.incident)} at ${formatTime(f.startsAt)}${label ? ` (${label})` : ''}`,
        'reschedule on Maintenance & mutes',
      ];
    }
    case 'not_approved':
      return ['didn’t start'];
    case 'muted':
      return [`until ${at(f.endsAt, now)} (${len})`, quoted(f.reason), by, 'still counted in uptime'];
    case 'mute_changed': {
      const to = e.to ?? f.endsAt;
      return [`until ${at(to, now)}${e.from ? ` (was ${was(e.from, to)})` : ''}`, quoted(e.reason), by];
    }
    case 'mute_ended':
      return ['alerts back on', ...posted(e.incident)];
    case 'mute_ended_early':
      return [`${formatTime(e.at)} ${by}`, quoted(e.reason), 'alerts back on', ...posted(e.incident)];
  }
}

/** "ends 04:00 (was 03:00)", "ends Mon 28 Sep 22:00 (was Tue 29 Sep)". */
function endChange(f: WindowFacts, e: WindowEvent, now: Date): string[] {
  const to = e.to ?? f.endsAt;
  return [`ends ${at(to, now)}${e.from ? ` (was ${was(e.from, to)})` : ''}`];
}

const openPage = (f: WindowFacts, text = 'Open Maintenance & mutes'): ChatWidget => ({
  buttonList: { buttons: [{ text, onClick: { openLink: { url: f.pageUrl } } }] },
});
const row = (topLabel: string, text: string): ChatWidget => ({
  decoratedText: { topLabel, text: text.replace(/</g, '&lt;'), wrapText: true },
});
const para = (text: string): ChatWidget => ({ textParagraph: { text: text.replace(/</g, '&lt;') } });
const card = (
  id: string,
  title: string,
  widgets: ChatWidget[],
  subtitle?: string,
): ChatMessage['cardsV2'][number] => ({
  cardId: id,
  card: { header: subtitle ? { title, subtitle } : { title }, sections: [{ widgets }] },
});
const mention = (p: ChatPerson | null | undefined) => (p?.chatUserId ? [p.chatUserId] : []);

/**
 * The action's line in the window's Space thread (ChatAlert "Maintenance · Alerts Space thread").
 * DIDN'T START is the one line with mentions and a card: owner, backup and approver decide on a new
 * window (ChatAlert "Maintenance · didn't start").
 */
export function buildWindowLine(f: WindowFacts, e: WindowEvent, now: Date): ChatMessage {
  const site = plainName(f.site);
  const detail = lineDetail(f, e, now);
  if (e.action !== 'didnt_start') {
    return { text: buildChatTextLine({ state: KIND[e.action], site, detail }), cardsV2: [] };
  }
  const people = [
    f.owner,
    f.backup,
    ...(f.approvedBy ? f.admins.filter((a) => a.name === f.approvedBy) : []),
  ];
  const ids = [...new Set(people.flatMap(mention))];
  const label = incidentLabel(e.incident);
  const i = e.incident;
  const word = severityWord(i);
  const since = i?.since ? ` (${word} since ${formatTime(i.since)})` : '';
  const body = !label
    ? `The site was DOWN at its start, so the window didn’t start and alerts stayed on. Schedule a new window once it’s back.`
    : i?.acked
      ? `${label}${since} stays open — it is acknowledged. Nothing was hidden. Schedule a new window once it’s resolved.`
      : i?.pausedUntil
        ? `${label}${since} stays open; timers paused until ${formatResume(i.pausedUntil, now)}. Nothing was hidden. Schedule a new window once it’s resolved.`
        : `${label}${since} stays open and keeps escalating${f.tier === 1 ? ` — ${site} is Tier 1, 24/7` : ''}. Nothing was hidden. Schedule a new window once it’s resolved.`;
  const buttons = [
    { text: 'Open Maintenance & mutes', onClick: { openLink: { url: f.pageUrl } } },
    ...(label && i?.url ? [{ text: `Open ${label}`, onClick: { openLink: { url: i.url } } }] : []),
  ];
  return {
    text: buildChatTextLine({ state: KIND.didnt_start, site, mention: ids, detail }),
    cardsV2: [
      card(
        `mw-didnt-${f.windowId}`,
        `DIDN’T START · ${site} · site ${siteWas(i)} at ${formatTime(f.startsAt)}`,
        [para(body), { buttonList: { buttons } }],
      ),
    ],
  };
}

/** The effect a window has, for the request (§24.1; no status page yet). */
const effect = (len: string) => `No alerts for ${len}; checks still run; not counted in uptime`;

/**
 * A "direct message" as a reply in the window's thread that @mentions the person (D-037): the
 * request and its reminders to each Admin, the answer, STILL WAITING and NOT APPROVED to the asker,
 * MUTED to the owner and backup when someone else muted their site.
 */
export function buildWindowDm(
  f: WindowFacts,
  e: WindowEvent,
  dm: WindowDm,
  to: ChatPerson,
  now: Date,
): ChatMessage {
  const site = plainName(f.site);
  const m = mention(to);
  const len = lengthOf(f.startsAt, f.endsAt);
  const asker = who(f.createdBy);
  const start = full(f.startsAt);
  const when = span(f.startsAt, f.endsAt, start);
  const id = `mw-${dm}-${f.windowId}`;
  const text = (state: ChatState, detail: string[]) => buildChatTextLine({ state, site, mention: m, detail });

  switch (dm) {
    case 'requested':
      return {
        text: text('MAINTENANCE REQUESTED', [
          `${len} from ${start}`,
          `by ${asker}`,
          `approve before ${start}`,
        ]),
        cardsV2: [
          card(
            id,
            `Maintenance request · ${site}`,
            [
              row('When', when),
              row('Length', len),
              row('Reason', quoted(f.reason)),
              row('Effect', effect(len)),
              row('Deadline', `It starts only if approved before ${start}`),
              openPage(f, 'Review on Maintenance & mutes'),
              {
                textParagraph: {
                  text: `<b>Approve or decline on the page.</b> The request may have changed since this message (${asker} can edit or withdraw it); the page always shows it as it stands.`,
                },
              },
            ],
            `${formatTier(f.tier)} · asked by ${asker} · ${full(f.createdAt)} (UTC+7)`,
          ),
        ],
      };
    case 'reminder_12h':
    case 'reminder_1h': {
      const last = dm === 'reminder_1h';
      const h = hoursTo(f.startsAt, now);
      const deadline = formatTime(f.startsAt);
      return {
        text: text('WAITING FOR APPROVAL', [
          // As drawn: the 12 h reminder names the day, the last one only the time.
          `starts in ${h} h (${last ? formatTime(f.startsAt) : start})`,
          ...(last ? ['last reminder'] : []),
          `asked by ${asker}`,
        ]),
        cardsV2: [
          card(id, `WAITING FOR APPROVAL · starts in ${h} h${last ? ' · last reminder' : ''}`, [
            para(
              last
                ? `After ${deadline} it can’t be approved any more — ${asker} would have to ask again.`
                : `${len} from ${start} · ${quoted(f.reason)}. Not approved by ${deadline} → it doesn’t start and ${asker} is told.`,
            ),
            openPage(f, 'Review on Maintenance & mutes'),
          ]),
        ],
      };
    }
    case 'still_waiting': {
      const reminded = formatNameList(f.admins.map((a) => plainName(a.name)));
      return {
        text: text('STILL WAITING', [
          `starts in ${hoursTo(f.startsAt, now)} h (${start})`,
          ...(reminded ? [`${reminded} reminded`] : []),
        ]),
        cardsV2: [],
      };
    }
    case 'approved': {
      const approver = who(e.by);
      const told = formatNameList([
        'you',
        ...[f.owner, f.backup]
          .filter((p): p is ChatPerson => !!p && p.name !== f.createdBy && p.name !== e.by)
          .map((p) => plainName(p.name)),
        approver,
      ]);
      return {
        text: text('APPROVED', [when, `by ${approver}`]),
        cardsV2: [
          card(
            id,
            `Approved · ${site}`,
            [
              row('Approved by', `${approver} · ${full(e.at)}`),
              row('Starts', `On its own ${start} — no alerts, not counted in uptime`),
              row('If it’s down', `At ${formatTime(f.startsAt)} it won’t start; ${told} are told`),
              openPage(f),
            ],
            `${len} · ${when} (UTC+7)`,
          ),
        ],
      };
    }
    case 'declined': {
      const admin = who(e.by);
      return {
        text: text('DECLINED', [when, `by ${admin}`, quoted(e.reason)]),
        cardsV2: [
          card(
            id,
            `Declined · ${site}`,
            [
              row('Declined by', `${admin} · ${full(e.at)}`),
              row('Reason', quoted(e.reason)),
              row('Next', 'Ask again with a shorter window — under 24 h needs no approval'),
              openPage(f),
            ],
            `Asked for ${len} from ${start}`,
          ),
        ],
      };
    }
    case 'not_approved':
      return {
        text: text('NOT APPROVED', [
          'didn’t start',
          `nobody approved before ${formatTime(f.startsAt)}`,
          'ask again on Maintenance & mutes',
        ]),
        cardsV2: [
          card(id, `NOT APPROVED · ${site}`, [
            para(`Nobody approved it before ${start}, so it didn’t start. Alerts stay on as usual.`),
            openPage(f),
          ]),
        ],
      };
    case 'muted':
      return { text: text('MUTED', lineDetail(f, { ...e, action: 'muted' }, now)), cardsV2: [] };
  }
}

/** The incident thread's line when a mute starts on a site with an open incident (§24.4). */
export function buildIncidentMutedLine(input: {
  site: string;
  incidentNumber: number;
  until: Date;
  by: string | null;
  acked: boolean;
  now: Date;
}): ChatMessage {
  const inc = formatIncidentId(input.incidentNumber);
  return {
    text: buildChatTextLine({
      state: 'MUTED',
      site: plainName(input.site),
      detail: [
        `until ${at(input.until, input.now)}`,
        `by ${who(input.by)}`,
        input.acked ? `${inc} stays open` : `${inc} keeps escalating until someone acknowledges`,
      ],
    }),
    cardsV2: [],
  };
}

// ── Email ──────────────────────────────────────────────────────────────
export const WINDOW_EMAIL_ROLES = ['owner', 'backup', 'admin'] as const;
export type WindowEmailRole = (typeof WINDOW_EMAIL_ROLES)[number];

export interface WindowEmailInput {
  facts: WindowFacts;
  event: WindowEvent | { action: 'reminder_12h'; at: Date; by: null };
  role: WindowEmailRole;
  /** The window began as a request: its request mail thread (§24.5). */
  request: boolean;
  /** Sender, for the window's thread id. */
  from: string;
  /** This is the recipient's first email about the window: it starts their thread. */
  startsThread: boolean;
  now: Date;
}

/** `<mw-<id>@notify.example>`: the id every email about one window refers to. */
export function windowThreadId(windowId: string, from: string): string {
  return `<mw-${windowId}@${senderDomain(from)}>`;
}

export const WINDOW_EMAIL_FOOTER =
  'Times in Thailand time (UTC+7). This is an automated record — replies aren’t read. Everything about this window is on Maintenance & mutes.';

const C = EMAIL_COLORS;
const WHY: Record<WindowEmailRole, (site: string) => string> = {
  owner: (site) => `You got this because you own ${site}.`,
  backup: (site) => `You got this because you’re backup for ${site}.`,
  admin: () => 'You got this because you’re an Admin.',
};

/** The headline and "What changed" row of a later action in the window's mail thread (§24.5). */
function laterAction(f: WindowFacts, e: WindowEvent, site: string): { headline: string; changed: string } {
  const by = who(e.by);
  const to = e.to ?? f.endsAt;
  const ends = e.from ? `Ends ${full(to)} (was ${was(e.from, to)})` : `Ends ${full(to)}`;
  switch (e.action) {
    case 'approved':
      return { headline: `${site} maintenance approved`, changed: `Approved by ${by} · ${full(e.at)}` };
    case 'declined':
      return { headline: `${site} maintenance declined`, changed: `Declined by ${by} · ${quoted(e.reason)}` };
    case 'withdrawn':
      return { headline: `${site} request withdrawn`, changed: `Withdrawn by ${by} · ${quoted(e.reason)}` };
    case 'request_changed':
      return {
        headline: `${site} request changed`,
        changed: `${ends} · now ${lengthOf(f.startsAt, f.endsAt)} · by ${by} · still waiting`,
      };
    case 'changed':
      return { headline: `${site} maintenance changed`, changed: `${ends} · by ${by} · ${quoted(e.reason)}` };
    case 'cancelled':
      return {
        headline: `${site} maintenance cancelled`,
        changed: `Cancelled by ${by} · ${quoted(e.reason)}`,
      };
    case 'started':
      return {
        headline: `${site} maintenance started`,
        changed: `Started ${full(e.at)} · no alerts until ${full(f.endsAt)}`,
      };
    case 'ended':
      return {
        headline: `${site} maintenance ended`,
        changed: `Ended on time ${full(f.endsAt)} · alerts back on`,
      };
    case 'ended_early':
      return {
        headline: `${site} maintenance ended early`,
        changed: `Ended ${full(e.at)} by ${by} · ${quoted(e.reason)} · alerts back on`,
      };
    case 'didnt_start': {
      const label = incidentLabel(e.incident);
      return {
        headline: `${site} maintenance didn’t start`,
        changed: `The site was DOWN at ${formatTime(f.startsAt)}${label ? ` (${label})` : ''} · reschedule on Maintenance & mutes`,
      };
    }
    case 'not_approved':
      return {
        headline: `${site} request not approved`,
        changed: `Nobody approved it before ${full(f.startsAt)}, so it didn’t start`,
      };
    default:
      return { headline: `${site} maintenance`, changed: '' };
  }
}

/**
 * The window's emails (EmailAlert "Maintenance · approval", "Maintenance · owner & backup"): the
 * request and the 12 h reminder to the Admins (the owner and backup get the request too), and every
 * later action in the same mail thread with the same layout — label, headline, preheader and a
 * "What changed" row change. Mutes never email (Chat only, ≤ 24 h).
 */
export function buildWindowEmail(input: WindowEmailInput): EmailMessage {
  const { facts: f, event: e, role, now } = input;
  const site = plainName(f.site);
  const len = lengthOf(f.startsAt, f.endsAt);
  const start = full(f.startsAt);
  const when = `${span(f.startsAt, f.endsAt, start)} (${len})`;
  const asker = who(f.createdBy);
  const threadId = windowThreadId(f.windowId, input.from);
  const subject = input.request
    ? `DxT Monitor · Maintenance request · ${site} · ${start}`
    : `${site} · Maintenance · ${start}`;
  const envelope: Envelope = {
    subject,
    why: WHY[role](site),
    footer: WINDOW_EMAIL_FOOTER,
    headers: input.startsThread
      ? { References: threadId }
      : { 'In-Reply-To': threadId, References: threadId },
  };
  const review = (label: string) => [{ label, href: f.pageUrl, primary: true }];
  const people = [
    `owner ${f.owner ? plainName(f.owner.name) : '—'}`,
    ...(f.backup ? [`backup ${plainName(f.backup.name)}`] : []),
  ].join(', ');

  if (e.action === 'requested') {
    const body: EmailBody = {
      color: C.secondary,
      bar: C.secondary,
      label: 'MAINTENANCE REQUESTED',
      pre: `${asker} asks for ${len} of maintenance on ${site} from ${start}`,
      headline: `${asker} asks for ${len} of maintenance`,
      lede:
        role === 'admin'
          ? `Windows over 24 h asked for by a Responder need an Admin. Approve or decline it on Maintenance & mutes — declining needs a reason, which ${asker} gets.`
          : `${asker} asked for maintenance on ${site}. An Admin approves or declines it on Maintenance & mutes.`,
      facts: [
        ['Site', `${site} · ${formatTier(f.tier)} · ${people}`],
        ['When', when],
        ['Reason', quoted(f.reason)],
        ['Effect', effect(len)],
        ['Deadline', `It starts only if approved before ${start}`],
      ],
      buttons: review(role === 'admin' ? 'Review request' : 'Open Maintenance & mutes'),
    };
    return emailLayout(envelope, body);
  }
  if (e.action === 'reminder_12h') {
    const h = hoursTo(f.startsAt, now);
    const lastAt = formatTime(new Date(f.startsAt.getTime() - 3_600_000));
    return emailLayout(envelope, {
      color: C.warning,
      bar: C.warning,
      label: 'WAITING FOR APPROVAL',
      pre: `${site} starts in ${h} h (${start}) · asked by ${asker}`,
      headline: `Still waiting — starts in ${h} h`,
      lede: `Nobody has approved or declined ${asker}’s request yet. A last reminder comes by Chat at ${lastAt}.`,
      facts: [
        ['Site', `${site} · ${formatTier(f.tier)}`],
        ['When', when],
        ['Asked by', `${asker} · ${full(f.createdAt)} · ${quoted(f.reason)}`],
        [
          'If nobody answers',
          `At ${formatTime(f.startsAt)} it doesn’t start; ${asker} is told and has to ask again`,
        ],
      ],
      buttons: review('Review request'),
    });
  }

  // Scheduled, and every later action: the owner & backup layout (EmailAlert "Tubtong · Scheduled").
  const base: [string, string][] = [
    ['When', when],
    ['Reason', quoted(f.reason)],
    [input.request ? 'Asked by' : 'Scheduled by', `${asker} · ${full(f.createdAt)}`],
    ['Effect', 'No alerts while it runs; checks still run; not counted in uptime'],
    ['If it’s down', `At ${formatTime(f.startsAt)} it won’t start, and you’ll be told`],
  ];
  if (e.action === 'scheduled') {
    return emailLayout(envelope, {
      color: C.secondary,
      bar: C.secondary,
      label: 'MAINTENANCE SCHEDULED',
      pre: `${site} · ${when} · by ${asker}`,
      headline: `${site} maintenance on ${formatDay(f.startsAt, { weekday: true })}`,
      lede: `${asker} scheduled maintenance on ${site}. Nothing to do — there will be no alerts for ${site} during the window.`,
      facts: base,
      buttons: review('Open Maintenance & mutes'),
    });
  }
  const later = laterAction(f, e, site);
  const warn = e.action === 'didnt_start' || e.action === 'not_approved';
  // Once the window is over or will never run, its effect and "if it's down" no longer apply.
  const over = [
    'declined',
    'withdrawn',
    'cancelled',
    'ended',
    'ended_early',
    'didnt_start',
    'not_approved',
  ].includes(e.action);
  const facts = over ? base.filter(([k]) => k !== 'Effect' && k !== 'If it’s down') : base;
  return emailLayout(envelope, {
    color: warn ? C.warning : C.secondary,
    bar: warn ? C.warning : C.secondary,
    label: KIND[e.action],
    pre: `${site} · ${lineDetail(f, e, now).join(' · ')}`,
    headline: later.headline,
    lede: `${later.changed}.`,
    facts: [['What changed', later.changed], ...facts],
    buttons: review('Open Maintenance & mutes'),
  });
}
