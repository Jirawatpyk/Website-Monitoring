import {
  formatDay,
  formatNameList,
  formatSeriesRule,
  formatTier,
  formatTime,
  formatWindowLength,
  seriesRepeatText,
  type SeriesRule,
} from '@dxt/shared';
import { plainName, type ChatMessage, type ChatPerson } from './chat-alerts';
import { buildChatTextLine, type ChatState } from './chat-text';
import { EMAIL_COLORS, emailLayout, senderDomain, type EmailMessage, type Envelope } from './email-alerts';
import {
  at,
  card,
  full,
  hoursTo,
  mention,
  openLink,
  para,
  quoted,
  row,
  span,
  who,
} from './maintenance-words';

/**
 * A repeating series' own messages (S14, D-057, spec §32.10–11; ChatAlert "Maintenance · repeating
 * series"). One Alerts Space thread per series for what happens to the series — scheduled, or
 * requested → approved / declined / withdrawn / not approved, skipped windows, cancelled — with the
 * request pattern's replies @mentioning the Admins or the asker (§24.1–3, "series every Mon, Thu"),
 * and one email to owner + backup when it is scheduled, approved, declined or cancelled ("Repeats"
 * instead of When). Each window keeps its own thread (maintenance-alerts.ts).
 */

export const SERIES_ACTIONS = [
  'scheduled',
  'requested',
  'approved',
  'declined',
  'withdrawn',
  'cancelled',
  'skipped',
  'not_approved',
] as const;
export type SeriesAction = (typeof SERIES_ACTIONS)[number];

export const SERIES_DMS = [
  'requested',
  'reminder_12h',
  'reminder_1h',
  'still_waiting',
  'approved',
  'declined',
  'not_approved',
] as const;
export type SeriesDm = (typeof SERIES_DMS)[number];

export interface SeriesFacts {
  seriesId: string;
  site: string;
  tier: number;
  rule: SeriesRule;
  /** Bangkok wall-clock start, as Postgres `time` gives it ("01:00:00"). */
  startTime: string;
  durationMin: number;
  /** Bangkok days, "2026-09-15"; `untilOn` null = no end. */
  startsOn: string;
  untilOn: string | null;
  /** Its first window (a waiting series' deadline), when known. */
  firstStartsAt: Date | null;
  reason: string;
  createdBy: string | null;
  createdAt: Date;
  owner: ChatPerson | null;
  backup: ChatPerson | null;
  admins: readonly ChatPerson[];
  pageUrl: string;
}

/** A window the SKIPPED line names. */
export interface SeriesSkip {
  startsAt: Date;
  endsAt: Date;
  next: Date | null;
  overlap: { startsAt: Date; endsAt: Date; reason: string } | null;
}

/** One action as the RPC or the engine queued it (`notifications.context`). */
export interface SeriesEvent {
  action: SeriesAction;
  at: Date;
  by: string | null;
  reason?: string | null;
  /** APPROVED: the windows it scheduled, and any too close to start. */
  windows?: readonly Date[];
  tooSoon?: readonly Date[];
  /** CANCELLED: the windows that hadn't started; whether one is running. */
  cancelled?: readonly Date[];
  running?: boolean;
  skip?: SeriesSkip | null;
}

// ── Words ──────────────────────────────────────────────────────────────
const day = (d: Date) => formatDay(d, { weekday: true });
/** A Bangkok day "2026-09-15" → "Tue 15 Sep". */
const bangkokDay = (s: string) => day(new Date(`${s}T12:00:00+07:00`));
const days = (list: readonly Date[]) => list.map(day).join(', ');
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const repeat = (f: SeriesFacts) => seriesRepeatText(f.rule);
const rule = (f: SeriesFacts, length = true) => formatSeriesRule(f, { length });
const lengthText = (f: SeriesFacts) => formatWindowLength(f.durationMin);
/** "from Tue 15 Sep" — the first window's day when known, else the first day asked for. */
const fromDay = (f: SeriesFacts) => (f.firstStartsAt ? day(f.firstStartsAt) : bangkokDay(f.startsOn));
const untilText = (f: SeriesFacts) => (f.untilOn ? `until ${bangkokDay(f.untilOn)}` : 'no end date');
const deadline = (f: SeriesFacts) => (f.firstStartsAt ? full(f.firstStartsAt) : bangkokDay(f.startsOn));
/** "2 windows scheduled (Tue 15 Sep, Tue 22 Sep)"; past three, "5 windows scheduled, to Thu 8 Oct". */
function scheduled(list: readonly Date[], short = false): string {
  if (!list.length) return 'no window scheduled yet';
  const n = `${list.length} window${list.length === 1 ? '' : 's'} scheduled`;
  return short || list.length > 3 ? `${n}, to ${day(list[list.length - 1]!)}` : `${n} (${days(list)})`;
}
const tooSoon = (e: SeriesEvent) => (e.tooSoon?.length ? [`${days(e.tooSoon)} was too soon`] : []);

const KIND: Record<SeriesAction, ChatState> = {
  scheduled: 'MAINTENANCE SCHEDULED',
  requested: 'MAINTENANCE REQUESTED',
  approved: 'MAINTENANCE APPROVED',
  declined: 'MAINTENANCE DECLINED',
  withdrawn: 'REQUEST WITHDRAWN',
  cancelled: 'MAINTENANCE CANCELLED',
  skipped: 'MAINTENANCE SKIPPED',
  not_approved: 'NOT APPROVED',
};

function lineDetail(f: SeriesFacts, e: SeriesEvent): string[] {
  const by = `by ${who(e.by)}`;
  const series = `series ${repeat(f)}`;
  switch (e.action) {
    case 'scheduled':
      return [
        rule(f),
        `from ${fromDay(f)}`,
        ...(f.untilOn ? [untilText(f)] : []),
        quoted(f.reason),
        `by ${who(f.createdBy)}`,
      ];
    case 'requested':
      return [
        rule(f),
        `from ${fromDay(f)}`,
        ...(f.untilOn ? [untilText(f)] : []),
        quoted(f.reason),
        `by ${who(f.createdBy)}`,
        'waiting for an Admin',
      ];
    case 'approved':
      return [series, by, scheduled(e.windows ?? []), ...tooSoon(e)];
    case 'declined':
      return [series, by, quoted(e.reason)];
    case 'withdrawn':
      return [series, by, quoted(e.reason), 'no more reminders'];
    case 'cancelled': {
      const gone = e.cancelled ?? [];
      return [
        `series ${rule(f, false)}`,
        gone.length ? `${gone.length} not started cancelled (${days(gone)})` : 'none waiting to start',
        ...(e.running ? ['the running window finishes'] : []),
        quoted(e.reason),
        by,
      ];
    }
    case 'skipped': {
      const s = e.skip;
      if (!s) return [series];
      const o = s.overlap;
      return [
        span(s.startsAt, s.endsAt, full(s.startsAt)),
        o
          ? `overlaps the ${span(o.startsAt, o.endsAt, at(o.startsAt, s.startsAt))} window (${quoted(o.reason)})`
          : 'overlaps another window',
        ...(s.next ? [`next ${day(s.next)}`] : []),
      ];
    }
    case 'not_approved':
      return [
        series,
        'nothing scheduled',
        `nobody approved before ${deadline(f)}`,
        'ask again on Maintenance & mutes',
      ];
  }
}

/** The action's line in the series' Space thread (no mention, no card). */
export function buildSeriesLine(f: SeriesFacts, e: SeriesEvent): ChatMessage {
  return {
    text: buildChatTextLine({
      state: KIND[e.action],
      site: plainName(f.site),
      detail: lineDetail(f, e),
    }),
    cardsV2: [],
  };
}

/**
 * A reply in the series' thread @mentioning one person (D-037, no Chat app yet): the request and its
 * reminders to each Admin; the answer, STILL WAITING and NOT APPROVED to the asker.
 */
export function buildSeriesDm(
  f: SeriesFacts,
  e: SeriesEvent,
  dm: SeriesDm,
  to: ChatPerson,
  now: Date,
): ChatMessage {
  const site = plainName(f.site);
  const text = (state: ChatState, detail: string[]) =>
    buildChatTextLine({ state, site, mention: mention(to), detail });
  const asker = who(f.createdBy);
  const series = `series ${repeat(f)}`;
  const id = `ms-${dm}-${f.seriesId}`;
  const first = f.firstStartsAt;

  switch (dm) {
    case 'requested':
      return {
        text: text('MAINTENANCE REQUESTED', [
          rule(f),
          `from ${fromDay(f)}`,
          `by ${asker}`,
          `approve before ${deadline(f)}`,
        ]),
        cardsV2: [
          card(
            id,
            `Repeating maintenance request · ${site}`,
            [
              row('Repeats', `${capital(rule(f, false))} (${lengthText(f)} each)`),
              row('From', `${fromDay(f)} · ${untilText(f)}`),
              row('Reason', quoted(f.reason)),
              row('Effect', 'Each window: no alerts; checks still run; not counted in uptime'),
              row(
                'Deadline',
                `Approve before the first window, ${deadline(f)} — otherwise nothing is scheduled`,
              ),
              openLink(f.pageUrl, 'Review on Maintenance & mutes'),
              // As drawn: "Approve once." in bold — fixed words, so the markup is ours.
              {
                textParagraph: {
                  text: '<b>Approve once.</b> Its windows don’t ask again; they are created 14 days ahead.',
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
      const h = first ? hoursTo(first, now) : 0;
      const when = first ? (last ? formatTime(first) : full(first)) : deadline(f);
      return {
        text: text('WAITING FOR APPROVAL', [
          series,
          `first window in ${h} h (${when})`,
          ...(last ? ['last reminder'] : []),
          `asked by ${asker}`,
        ]),
        cardsV2: [
          card(id, `WAITING FOR APPROVAL · first window in ${h} h${last ? ' · last reminder' : ''}`, [
            para(
              last
                ? `After ${when} it can’t be approved any more — ${asker} would have to ask again.`
                : `${capital(rule(f))} · ${quoted(f.reason)}. Not approved by ${when} → nothing is scheduled and ${asker} is told.`,
            ),
            openLink(f.pageUrl, 'Review on Maintenance & mutes'),
          ]),
        ],
      };
    }
    case 'still_waiting': {
      const reminded = formatNameList(f.admins.map((a) => plainName(a.name)));
      return {
        text: text('STILL WAITING', [
          series,
          `first window in ${first ? hoursTo(first, now) : 0} h (${deadline(f)})`,
          ...(reminded ? [`${reminded} reminded`] : []),
        ]),
        cardsV2: [],
      };
    }
    case 'approved':
      return {
        text: text('APPROVED', [
          `series ${rule(f, false)}`,
          `by ${who(e.by)} ${at(e.at, now)}`,
          scheduled(e.windows ?? [], true),
          ...tooSoon(e),
        ]),
        cardsV2: [],
      };
    case 'declined':
      return {
        text: text('DECLINED', [series, `by ${who(e.by)} ${at(e.at, now)}`, quoted(e.reason)]),
        cardsV2: [],
      };
    case 'not_approved':
      return {
        text: text('NOT APPROVED', lineDetail(f, { ...e, action: 'not_approved' })),
        cardsV2: [],
      };
  }
}

// ── Email ──────────────────────────────────────────────────────────────
export const SERIES_EMAIL_ROLES = ['owner', 'backup', 'admin'] as const;
export type SeriesEmailRole = (typeof SERIES_EMAIL_ROLES)[number];

export interface SeriesEmailInput {
  facts: SeriesFacts;
  event: SeriesEvent | { action: 'reminder_12h'; at: Date; by: null };
  role: SeriesEmailRole;
  /** The recipient asked for the series. */
  toIsAsker?: boolean;
  /** The series began as a request: its request mail thread. */
  request: boolean;
  from: string;
  startsThread: boolean;
  now: Date;
}

/** `<ms-<id>@notify.example>`: the id every email about one series refers to. */
export function seriesThreadId(seriesId: string, from: string): string {
  return `<ms-${seriesId}@${senderDomain(from)}>`;
}

export const SERIES_EMAIL_FOOTER =
  'Times in Thailand time (UTC+7). This is an automated record — replies aren’t read. Everything about this series is on Maintenance & mutes.';

const WHY: Record<SeriesEmailRole, (site: string) => string> = {
  owner: (site) => `You got this because you own ${site}.`,
  backup: (site) => `You got this because you’re backup for ${site}.`,
  admin: () => 'You got this because you’re an Admin.',
};

/**
 * A series' emails (§32.11, the window emails' layout with "Repeats" instead of When): the request,
 * its 12 h reminder, withdrawn and not approved to the Admins; scheduled, approved, declined and
 * cancelled once to owner + backup. Its windows send none of their own but DIDN'T START.
 */
export function buildSeriesEmail(input: SeriesEmailInput): EmailMessage {
  const { facts: f, event: e, role, now } = input;
  const C = EMAIL_COLORS;
  const site = plainName(f.site);
  const asker = who(f.createdBy);
  const by = who(e.by);
  const series = `series ${repeat(f)}`;
  const threadId = seriesThreadId(f.seriesId, input.from);
  const envelope: Envelope = {
    subject: input.request
      ? `DxT Monitor · Maintenance request · ${site} · ${series}`
      : `${site} · Maintenance · ${series}`,
    why: WHY[role](site),
    footer: SERIES_EMAIL_FOOTER,
    headers: input.startsThread
      ? { References: threadId }
      : { 'In-Reply-To': threadId, References: threadId },
  };
  const page = (label = 'Open Maintenance & mutes', primary = true) => ({ label, href: f.pageUrl, primary });
  const repeats: [string, string] = ['Repeats', `${capital(rule(f, false))} (${lengthText(f)} each)`];
  const fromRow: [string, string] = ['From', `${fromDay(f)} · ${untilText(f)}`];
  const reasonRow: [string, string] = ['Reason', quoted(f.reason)];
  const effect: [string, string] = [
    'Effect',
    'Each window: no alerts; checks still run; not counted in uptime',
  ];
  const why = 'reason' in e && e.reason ? ` · ${quoted(e.reason)}` : '';
  const asAsker = input.toIsAsker && role !== 'admin';
  const people = [
    `owner ${f.owner ? plainName(f.owner.name) : '—'}`,
    ...(f.backup ? [`backup ${plainName(f.backup.name)}`] : []),
  ].join(', ');

  const body = (() => {
    switch (e.action) {
      case 'requested':
        return {
          color: C.secondary,
          pre: `${asker} asks for ${series} on ${site} from ${fromDay(f)}`,
          headline: `${asker} asks for repeating maintenance`,
          lede: `${asker} asked for a repeating window on ${site}. Approve it once on Maintenance & mutes — its windows don’t ask again. Declining needs a reason, which ${asker} gets.`,
          facts: [
            ['Site', `${site} · ${formatTier(f.tier)} · ${people}`] as [string, string],
            repeats,
            fromRow,
            reasonRow,
            effect,
            [
              'Deadline',
              `Approve before the first window, ${deadline(f)} — otherwise nothing is scheduled`,
            ] as [string, string],
          ],
          buttons: [page('Review request')],
        };
      case 'reminder_12h': {
        const h = f.firstStartsAt ? hoursTo(f.firstStartsAt, now) : 0;
        return {
          color: C.warning,
          pre: `${site} · first window in ${h} h (${deadline(f)}) · asked by ${asker}`,
          headline: `Still waiting — first window in ${h} h`,
          lede: `Nobody has approved or declined ${asker}’s series yet. A last reminder comes by Chat${f.firstStartsAt ? ` at ${formatTime(new Date(f.firstStartsAt.getTime() - 3_600_000))}` : ' an hour before'}.`,
          facts: [
            repeats,
            fromRow,
            ['Asked by', `${asker} · ${full(f.createdAt)} · ${quoted(f.reason)}`] as [string, string],
            ['If nobody answers', `Nothing is scheduled; ${asker} is told and has to ask again`] as [
              string,
              string,
            ],
          ],
          buttons: [page('Review request')],
        };
      }
      case 'scheduled':
        return {
          color: C.secondary,
          pre: `${site} · ${rule(f)} · by ${asker}`,
          headline: `${site} maintenance ${repeat(f)}`,
          lede: `${asker} set up repeating maintenance on ${site}. Nothing to do — there are no alerts for ${site} during its windows. You get no email per window; only one that can’t start because the site is down.`,
          facts: [
            repeats,
            fromRow,
            reasonRow,
            ['Scheduled by', `${asker} · ${full(f.createdAt)}`] as [string, string],
            effect,
          ],
          buttons: [page()],
        };
      case 'approved':
        return {
          color: C.positive,
          pre: `${site} · ${series} · by ${by}`,
          headline: 'Repeating maintenance approved',
          lede: asAsker
            ? 'Your series was approved. Its windows start on their own.'
            : `${asker}’s series was approved. Nothing to do — no alerts for ${site} during its windows, and no email per window.`,
          facts: [
            ['What changed', `Approved by ${by} · ${full(e.at)} · ${scheduled(e.windows ?? [])}`] as [
              string,
              string,
            ],
            repeats,
            fromRow,
            effect,
          ],
          buttons: [page()],
        };
      case 'declined':
        return {
          color: C.secondary,
          pre: `${site} · ${series} · by ${by}${why}`,
          headline: 'Repeating maintenance declined',
          lede: asAsker
            ? 'Your series was declined. Ask again on Maintenance & mutes.'
            : `${asker}’s series was declined. Nothing changes for ${site}.`,
          facts: [['What changed', `Declined by ${by} · ${full(e.at)}${why}`] as [string, string], repeats],
          buttons: [page()],
        };
      case 'withdrawn':
        return {
          color: C.secondary,
          pre: `${site} · ${series} · by ${by} · no more reminders`,
          headline: 'Request withdrawn',
          lede: 'Nothing to approve any more. Nothing was scheduled, so nothing is cancelled.',
          facts: [['What changed', `Withdrawn by ${by} · ${full(e.at)}${why}`] as [string, string], repeats],
          buttons: [page()],
        };
      case 'not_approved':
        return {
          color: C.secondary,
          pre: `${site} · ${series} · nothing scheduled · nobody approved before ${deadline(f)}`,
          headline: 'Not approved — nothing scheduled',
          lede: 'The request lapsed without an answer. Alerts stay on as usual.',
          facts: [['What changed', `Nobody approved before ${deadline(f)}`] as [string, string], repeats],
          buttons: [page(undefined, false)],
        };
      case 'cancelled': {
        const gone = e.cancelled ?? [];
        return {
          color: C.secondary,
          pre: `${site} · ${series} · by ${by}${why}`,
          headline: 'Repeating maintenance cancelled',
          lede: `${by} cancelled the series. ${gone.length ? `Its ${gone.length} window${gone.length === 1 ? '' : 's'} not started ${gone.length === 1 ? 'is' : 'are'} cancelled` : 'No window was waiting to start'}${e.running ? '; the one running finishes' : ''}. Alerts for ${site} stay on as usual after that.`,
          facts: [
            ['What changed', `Cancelled by ${by} · ${full(e.at)}${why}`] as [string, string],
            repeats,
            ...(gone.length ? [['Cancelled', days(gone)] as [string, string]] : []),
          ],
          buttons: [page()],
        };
      }
      default:
        return {
          color: C.secondary,
          pre: site,
          headline: series,
          lede: '',
          facts: [repeats],
          buttons: [page()],
        };
    }
  })();
  const label: string = e.action === 'reminder_12h' ? 'WAITING FOR APPROVAL' : KIND[e.action];
  return emailLayout(envelope, { ...body, bar: body.color, label });
}
