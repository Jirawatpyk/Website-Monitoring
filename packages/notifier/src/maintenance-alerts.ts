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
import { EMAIL_COLORS, emailLayout, senderDomain, type EmailMessage, type Envelope } from './email-alerts';
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
      // As drawn: who, then when they changed it ("by Ploy Mon 28 Sep 15:10").
      return [...endChange(f, e, now), quoted(e.reason), `${by} ${full(e.at)}`];
    case 'cancelled':
      return [`${when} (${len})`, quoted(e.reason), by];
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

/**
 * The MUTED reply when someone else muted a site: one line @mentioning the owner and the backup
 * together, without the length (ChatAlert "No Chat app yet", D-037 as amended 12 Oct).
 */
export function buildMutedMention(
  f: WindowFacts,
  e: WindowEvent,
  people: readonly ChatPerson[],
  now: Date,
): ChatMessage {
  return {
    text: buildChatTextLine({
      state: 'MUTED',
      site: plainName(f.site),
      mention: [...new Set(people.flatMap(mention))],
      detail: [`until ${at(f.endsAt, now)}`, quoted(f.reason), `by ${who(e.by)}`, 'still counted in uptime'],
    }),
    cardsV2: [],
  };
}

// ── Email ──────────────────────────────────────────────────────────────
export const WINDOW_EMAIL_ROLES = ['owner', 'backup', 'admin', 'approver'] as const;
export type WindowEmailRole = (typeof WINDOW_EMAIL_ROLES)[number];

export interface WindowEmailInput {
  facts: WindowFacts;
  event: WindowEvent | { action: 'reminder_12h'; at: Date; by: null };
  role: WindowEmailRole;
  /** The recipient's name: the person who asked reads "Your request …". */
  toName?: string | null;
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
  approver: () => 'You got this because you approved this window.',
};

/** Who reads it: the asker gets "Your request …", the others by their tie to the site. */
type Reader = 'asker' | WindowEmailRole;

interface Button {
  label: string;
  href: string;
  primary: boolean;
}

/** One later action in the window's mail thread (EmailAlert, both threads). */
interface Later {
  color: string;
  headline: string;
  /** The preheader after "LABEL —". */
  pre: string;
  /** The "What changed" row. */
  changed: string;
  lede: string;
  /** Rows after "What changed". */
  rows: [string, string][];
  buttons: Button[];
}

/**
 * The window's emails (EmailAlert "Maintenance · request" / "Maintenance · window", redrawn 12 Oct):
 * the request and the 12 h reminder, and every later action in the same mail thread — label,
 * headline, preheader, a "What changed" row and a lede for each reader. Mutes never email (Chat
 * only, ≤ 24 h); the client status page isn't built yet (D-013), so no "Planned maintenance".
 */
export function buildWindowEmail(input: WindowEmailInput): EmailMessage {
  const { facts: f, event: e, role, now } = input;
  const site = plainName(f.site);
  const len = lengthOf(f.startsAt, f.endsAt);
  const start = full(f.startsAt);
  const whenRow: [string, string] = ['When', `${span(f.startsAt, f.endsAt, start)} (${len})`];
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
  const page = (label = 'Open Maintenance & mutes', primary = true): Button => ({
    label,
    href: f.pageUrl,
    primary,
  });
  const people = [
    `owner ${f.owner ? plainName(f.owner.name) : '—'}`,
    ...(f.backup ? [`backup ${plainName(f.backup.name)}`] : []),
  ].join(', ');
  const deadline: [string, string] = ['Deadline', `It starts only if approved before ${start}`];
  const requestEffect = 'No alerts; checks still run; not counted in uptime';

  if (e.action === 'requested') {
    return emailLayout(envelope, {
      color: C.secondary,
      bar: C.secondary,
      label: 'MAINTENANCE REQUESTED',
      pre: `${asker} asks for ${len} on ${site} from ${start}`,
      headline: `${asker} asks for ${len} of maintenance`,
      lede:
        role === 'admin'
          ? `Windows over 24 h asked for by a Responder need an Admin. Approve or decline it on Maintenance & mutes — declining needs a reason, which ${asker} gets.`
          : `${asker} asked for maintenance on ${site}. An Admin approves or declines it on Maintenance & mutes.`,
      facts: [
        ['Site', `${site} · ${formatTier(f.tier)} · ${people}`],
        whenRow,
        ['Reason', quoted(f.reason)],
        ['Effect', requestEffect],
        deadline,
      ],
      buttons: [role === 'admin' ? page('Review request') : page()],
    });
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
        whenRow,
        ['Asked by', `${asker} · ${full(f.createdAt)} · ${quoted(f.reason)}`],
        [
          'If nobody answers',
          `At ${formatTime(f.startsAt)} it doesn’t start; ${asker} is told and has to ask again`,
        ],
      ],
      buttons: [page('Review request')],
    });
  }
  if (e.action === 'scheduled') {
    return emailLayout(envelope, {
      color: C.secondary,
      bar: C.secondary,
      label: 'MAINTENANCE SCHEDULED',
      pre: `${site} · ${whenRow[1]} · by ${asker}`,
      headline: `${site} maintenance on ${formatDay(f.startsAt, { weekday: true })}`,
      lede: `${asker} scheduled maintenance on ${site}. Nothing to do — there will be no alerts for ${site} during the window.`,
      facts: [
        whenRow,
        ['Reason', quoted(f.reason)],
        ['Scheduled by', `${asker} · ${full(f.createdAt)}`],
        ['Effect', 'No alerts while it runs; checks still run; not counted in uptime'],
        ['If it’s down', `At ${formatTime(f.startsAt)} it won’t start, and you’ll be told`],
      ],
      buttons: [page()],
    });
  }

  const reader: Reader =
    (role === 'owner' || role === 'backup') && input.toName && input.toName === f.createdBy ? 'asker' : role;
  const later = laterEmail(f, e, {
    site,
    len,
    start,
    asker,
    whenRow,
    deadline,
    request: input.request,
    reader,
    page,
  });
  return emailLayout(envelope, {
    color: later.color,
    bar: later.color,
    label: KIND[e.action],
    pre: later.pre,
    headline: later.headline,
    lede: later.lede,
    facts: [['What changed', later.changed], ...later.rows],
    buttons: later.buttons,
  });
}

function laterEmail(
  f: WindowFacts,
  e: WindowEvent,
  c: {
    site: string;
    len: string;
    start: string;
    asker: string;
    whenRow: [string, string];
    deadline: [string, string];
    request: boolean;
    reader: Reader;
    page: (label?: string, primary?: boolean) => Button;
  },
): Later {
  const { site, start, asker, whenRow, reader, page } = c;
  const by = who(e.by);
  const why = e.reason ? ` · ${quoted(e.reason)}` : '';
  // A window inside one day reads in times ("until 03:00"), a longer one with the day (as drawn).
  const t = (d: Date) => (isSameBangkokDay(f.startsAt, f.endsAt) ? formatTime(d) : full(d));
  const title = c.request ? 'Maintenance' : `${site} maintenance`;
  // While the window is ahead: what it does, and what happens if the site is down at its start.
  const live: [string, string][] = c.request
    ? [
        ['Effect', 'No alerts; checks still run; not counted in uptime'],
        ['If it’s down', 'At the start it won’t start, and you’ll be told'],
      ]
    : [
        ['Effect', 'No alerts while it runs; checks still run; not counted in uptime'],
        ['If it’s down', `At ${formatTime(f.startsAt)} it won’t start, and you’ll be told`],
      ];
  const to = e.to ?? f.endsAt;
  const grey = C.secondary;
  const base = { color: grey, buttons: [page()] };

  switch (e.action) {
    case 'approved':
      return {
        ...base,
        color: C.positive,
        headline: `${title} approved`,
        pre: `${site} · ${span(f.startsAt, f.endsAt, start)} · by ${by}`,
        changed: `Approved by ${by} · ${full(e.at)}`,
        lede:
          reader === 'asker'
            ? `Your request was approved. It starts on its own at ${start}.`
            : `${asker}’s request was approved. Nothing to do — there will be no alerts for ${site} during the window.`,
        rows: [whenRow, ...live],
      };
    case 'declined':
      return {
        ...base,
        headline: `${title} declined`,
        pre: `${site} · by ${by}${why}`,
        changed: `Declined by ${by} · ${full(e.at)}${why}`,
        lede:
          reader === 'asker'
            ? 'Your request was declined. Ask again with a shorter window — under 24 h needs no approval.'
            : `${asker}’s request was declined. Nothing changes for ${site}.`,
        rows: [whenRow],
      };
    case 'request_changed':
      return {
        ...base,
        headline: `Request changed — now ${c.len}`,
        pre: `${site} · ends ${full(to)}${e.from ? ` (was ${was(e.from, to)})` : ''} · now ${c.len} · still waiting`,
        changed: `Ends ${full(to)}${e.from ? ` (was ${full(e.from)})` : ''} · by ${by} ${formatTime(e.at)}${why}`,
        lede:
          reader === 'admin'
            ? `${by} changed the request while it waits. Review it as it stands now.`
            : `${by} changed the request. An Admin still has to approve it.`,
        rows: [whenRow, live[0]!, c.deadline],
        buttons: [reader === 'admin' ? page('Review request') : page()],
      };
    case 'withdrawn':
      return {
        ...base,
        headline: 'Request withdrawn',
        pre: `${site} · by ${by} · no more reminders`,
        changed: `Withdrawn by ${by} · ${full(e.at)}${why}`,
        lede:
          reader === 'admin'
            ? 'Nothing to approve any more.'
            : `${by} withdrew the request. Nothing changes for ${site}.`,
        rows: [whenRow],
      };
    case 'not_approved':
      return {
        ...base,
        headline: 'Not approved — it didn’t start',
        pre: `${site} · didn’t start · nobody approved before ${formatTime(f.startsAt)}`,
        changed: `Nobody approved before ${start}`,
        lede:
          reader === 'asker'
            ? 'Your request wasn’t approved in time, so it didn’t start. Alerts stay on as usual. Ask again if you still need it.'
            : reader === 'admin'
              ? 'The request lapsed without an answer.'
              : `The window didn’t start. Alerts for ${site} stay on as usual.`,
        rows: [whenRow],
        buttons: [page(undefined, reader !== 'admin')],
      };
    case 'started':
      return {
        ...base,
        headline: `${title} has started`,
        pre: `${site} · until ${t(f.endsAt)} · no alerts, not counted in uptime`,
        changed: `Started ${t(e.at)}`,
        lede:
          reader === 'owner' || reader === 'asker'
            ? 'End it early or change the end on Maintenance & mutes.'
            : `Nothing to do — no alerts until ${t(f.endsAt)}.`,
        rows: [whenRow, live[0]!],
      };
    case 'ended':
      return {
        ...base,
        headline: `${title} ended`,
        pre: `${site} · ended on time ${t(f.endsAt)} · alerts back on`,
        changed: `Ended on time ${t(f.endsAt)} · alerts back on`,
        lede: `Alerts for ${site} are back on.`,
        rows: [whenRow],
      };
    case 'ended_early':
      return {
        ...base,
        headline: `${title} ended early`,
        pre: `${site} · ${t(e.at)} by ${by}${why} · alerts back on`,
        changed: `Ended early ${t(e.at)} by ${by}${why} · alerts back on`,
        lede: `Alerts for ${site} are back on.`,
        // The span it really ran.
        rows: [['When', `${span(f.startsAt, e.at, start)} (${lengthOf(f.startsAt, e.at)})`]],
      };
    case 'changed':
      return {
        ...base,
        headline: `${title} now ends ${formatTime(to)}`,
        pre: `${site} · ends ${full(to)}${e.from ? ` (was ${was(e.from, to)})` : ''} · by ${by}`,
        changed: `Ends ${full(to)}${e.from ? ` (was ${was(e.from, to)})` : ''} · by ${by} ${full(e.at)}${why}`,
        lede: `${by} changed the end time. Nothing to do.`,
        rows: [whenRow, ...live],
      };
    case 'cancelled':
      return {
        ...base,
        headline: `${title} cancelled`,
        pre: `${site} · ${span(f.startsAt, f.endsAt, start)} · by ${by}${why}`,
        changed: `Cancelled by ${by} · ${full(e.at)}${why}`,
        lede:
          reader === 'owner' || reader === 'asker'
            ? `${by} cancelled your window. Alerts for ${site} stay on as usual.`
            : 'The window was cancelled. Nothing to do.',
        rows: [whenRow],
      };
    case 'didnt_start': {
      const i = e.incident;
      const label = incidentLabel(i);
      const down = i?.severity === 'problem' ? 'had a problem' : 'was down';
      const since = i?.since ? `${severityWord(i)} since ${formatTime(i.since)}` : `the site ${siteWas(i)}`;
      const incidentRow: [string, string][] = label
        ? [
            [
              'Incident',
              i?.acked
                ? `${label} stays open — it is acknowledged; nothing was hidden`
                : i?.pausedUntil
                  ? `${label} stays open; timers paused until ${formatResume(i.pausedUntil, e.at)} — nothing was hidden`
                  : `${label} stays open and keeps escalating — nothing was hidden`,
            ],
          ]
        : [];
      const buttons: Button[] =
        label && i?.url
          ? [{ label: 'Open incident', href: i.url, primary: true }, page(undefined, false)]
          : [page()];
      return {
        color: C.danger,
        headline: `${title} didn’t start — site ${down}`,
        pre: `${site} ${siteWas(i)} at ${formatTime(f.startsAt)}${label ? ` (${label})` : ''} · reschedule on Maintenance & mutes`,
        changed: `Didn’t start ${start} — ${since}${label ? ` (${label})` : ''}`,
        lede:
          reader === 'approver'
            ? `The window you approved didn’t start because the site ${down}.`
            : reader === 'owner' || reader === 'asker'
              ? `Your window didn’t start because the site ${down}. ${label ? `Deal with ${label} first, then schedule a new window.` : 'Schedule a new window once it’s back.'}`
              : `The window didn’t start because the site ${down}.`,
        rows: [whenRow, ...incidentRow],
        buttons,
      };
    }
    default:
      return {
        ...base,
        headline: title,
        pre: site,
        changed: '',
        lede: '',
        rows: [whenRow],
      };
  }
}
