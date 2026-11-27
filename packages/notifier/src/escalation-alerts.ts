import { formatDay, formatDuration, formatTime, isSameBangkokDay } from '@dxt/shared';
import { plainName, type ChatMessage, type ChatPerson, type ChatWidget } from './chat-alerts';
import { buildChatTextLine, type StepLevel } from './chat-text';
import { row } from './maintenance-words';

/**
 * The escalation ladder's messages (S08, D-034; ChatAlert / EmailAlert rows, spec §8, §14.10, §15.7):
 * ESCALATED · L1 for a DOWN, STILL PROBLEM for a PROBLEM's L1 (the backup's step at +60), the
 * reminders in the thread, the L1 emails, and the escalation facts the first cards and the
 * ACKNOWLEDGED replies carry. S10 (D-048): ESCALATED · L2 to the CEO, the Tier 1 FYI · L3 (acknowledged
 * or not), the Tier 2–3 REMINDER · L2, and "· CEO at 10:18" on L1.
 */

/** What the first card and its email say about the ladder (D-034). */
export interface LadderFacts {
  /** The next level if nobody acknowledges: when, and who it asks / tells FYI. */
  next?: { level: number; at: Date; ask: readonly string[]; fyi: readonly string[] } | null;
  /** Tier 2–3 outside response hours: when the timers run again. */
  pausedUntil?: Date | null;
}

/** "09:00" today or tomorrow, "Mon 28 Sep 09:00" further off. */
export function formatResume(at: Date, now: Date): string {
  const tomorrow = new Date(now.getTime() + 86_400_000);
  return isSameBangkokDay(at, now) || isSameBangkokDay(at, tomorrow)
    ? formatTime(at)
    : `${formatDay(at, { weekday: true })} ${formatTime(at)}`;
}

/** The DOWN text line's promise: "acknowledge by 10:03 or it escalates" / "timers paused until 09:00". */
export function ladderLine(ladder: LadderFacts | null | undefined, now: Date): string[] {
  if (!ladder) return [];
  if (ladder.pausedUntil) {
    return ['outside response hours', `timers paused until ${formatResume(ladder.pausedUntil, now)}`];
  }
  return ladder.next ? [`acknowledge by ${formatResume(ladder.next.at, now)} or it escalates`] : [];
}

/**
 * The "Next" row. DOWN, card and email: "L1 at 10:03 if not acknowledged — Ploy, Tao". PROBLEM card:
 * "Reminder at 10:52 if not acknowledged — Ploy, Nok" (the owner reminded, the backup asked);
 * PROBLEM email: "Reminder + Nok (backup) at 10:52 if not acknowledged" (ChatAlert / EmailAlert).
 */
export function nextRow(
  ladder: LadderFacts | null | undefined,
  now: Date,
  severity: 'down' | 'problem',
  form: { owner?: string | null; email?: boolean } = {},
) {
  const next = ladder?.next;
  if (!next) return null;
  const people = [...next.ask, ...next.fyi].map(plainName);
  const at = formatResume(next.at, now);
  if (severity === 'down') return `L${next.level} at ${at} if not acknowledged — ${people.join(', ')}`;
  if (form.email)
    return `Reminder + ${people.map((p) => `${p} (backup)`).join(', ')} at ${at} if not acknowledged`;
  const who = [...(form.owner ? [plainName(form.owner)] : []), ...people];
  return `Reminder at ${at} if not acknowledged — ${who.join(', ')}`;
}

/** What an ACKNOWLEDGED reply says stopped: L1 for a DOWN, the reminders (and the backup step) for a PROBLEM. */
export type LadderStopped = {
  severity: 'down' | 'problem';
  backup: string | null;
  l1Fired: boolean;
  /** The PROBLEM reminder interval: "the 60-min reminder". */
  reminderMin?: number;
  /** DOWN: the last level an ack stops (the FYI step isn't one) — 2 gives "L1–L2 stopped". */
  stopsThrough?: number;
  /**
   * Tier 1: when the FYI still goes if the site is still down, and to whom ("CEO + Bua") — only while
   * it's still ahead of the ack (an ack after +60 promises nothing).
   */
  fyi?: { level: number; at: Date; who: string } | null;
  /** The site, for §14.1's "If MuvMi is still down at 10:48, CEO + Bua get an FYI (no call)." */
  site?: string;
  /** The highest level that had fired when the ack came: a step already sent isn't "cancelled". */
  firedLevel?: number;
};

export function stoppedWords(
  s: LadderStopped | null | undefined,
  /** The status-note ask is for the team; an FYI reader (the AM's own email) doesn't get it. */
  { nudge = true }: { nudge?: boolean } = {},
): { line: string; body: string; fact: [string, string] | null } | null {
  if (!s) return null;
  if (s.severity === 'down') {
    const through = s.stopsThrough ?? 1;
    const stopped = through > 1 ? `L1–L${through} stopped` : 'L1 stopped';
    // §14.1 / EmailAlert ACKNOWLEDGED: "L2 cancelled · acked · L3 FYI at 10:48 if still down".
    const cancelled = through > 1 && (s.firedLevel ?? 0) < through ? `L${through} cancelled · acked · ` : '';
    const fact: [string, string] | null = s.fyi
      ? ['Escalation', `${cancelled}L${s.fyi.level} FYI at ${formatTime(s.fyi.at)} if still down`]
      : null;
    // §14.1's canonical sentence: "Acknowledged by Arm → L1–L2 stopped. If MuvMi is still down at
    // 10:48, CEO + Bua get an FYI (no call)."
    // D-078: the FYI shows the latest note as the status, so ask for one.
    const fyi = s.fyi
      ? ` If ${plainName(s.site ?? 'the site')} is still down at ${formatTime(s.fyi.at)}, ${plainName(s.fyi.who)} get an FYI (no call).${nudge ? ' Add a status note — they see it in the FYI.' : ''}`
      : '';
    return { line: stopped, body: `${stopped}.${fyi}`, fact };
  }
  const reminder = `${s.reminderMin ?? 60}-min reminder`;
  const what =
    !s.l1Fired && s.backup
      ? `${reminder} and the ${plainName(s.backup)} (backup) step are`
      : `${reminder} is`;
  return {
    line: 'reminders stopped',
    body: `the ${what} stopped.`,
    fact: ['Reminders', `${what.charAt(0).toUpperCase()}${what.slice(1)} stopped`],
  };
}

const mentions = (people: readonly (ChatPerson | null)[]) =>
  people.flatMap((p) => (p?.chatUserId ? [p.chatUserId] : []));
const names = (people: readonly ChatPerson[]) => people.map((p) => plainName(p.name)).join(' and ');
const verb = (people: readonly ChatPerson[]) => (people.length > 1 ? 'are' : 'is');

export interface StepAlertInput {
  incidentId: string;
  site: string;
  severity: 'down' | 'problem';
  level: number;
  /** Minutes unacknowledged since the owner was told: Confirmed down, or a held PROBLEM's opening. */
  elapsedMin: number;
  /** The L0 person: "Arm hasn't acknowledged". */
  owner: ChatPerson | null;
  /** Asked to act at this level (@mentioned), with how the reply names them ("backup"). */
  asked: readonly (ChatPerson & { role: string })[];
  /** Told for information, named in plain text ("Tao FYI"). */
  fyi: readonly ChatPerson[];
  /** L1 · night (ChatAlert): this step's backup is the person on call, paged at L0 already (S10). */
  alreadyPaged?: string | null;
  incidentUrl: string;
  /**
   * What this step is (S10): `ask` someone new to acknowledge (L1); `ceo` the Tier 1 L2 page; `fyi` the
   * Tier 1 CEO + AM step that goes even after an ack; `reminder` a step whose people were all told
   * already (Tier 2–3 L2 → the Admin). Default `ask`.
   */
  kind?: 'ask' | 'ceo' | 'fyi' | 'reminder';
  /** The level after this one, if nobody acknowledges: "· CEO at 10:18" on L1. */
  next?: { who: string; at: Date } | null;
  /** Everyone told before this step, for "Arm, Ploy, Tao informed" (L2 to the CEO, an FYI nobody acked). */
  informed?: readonly string[];
  /** Who acknowledged and when, for the FYI: "acknowledged by Arm 10:07". */
  acked?: { by: string; at: Date } | null;
  /** The incident page without the ack flow: the CEO / FYI card's "Open incident" (they never ack). */
  viewUrl?: string;
  /** Sent with Escalate now while the engine was stopped (S12b, D-055): who sent it. */
  byHand?: string | null;
  /** The FYI card's facts (D-078): the cause line, when the drop was confirmed, the latest note. */
  cause?: string | null;
  since?: Date | null;
  status?: StatusNote | null;
  /** When the message was queued: a note or start on another day gets its date. */
  sentAt?: Date;
}

/** The incident's latest note, the FYI's "Status" (D-078): people's words, cut short where shown. */
export type StatusNote = { text: string; by: string; at: Date };

/** The FYI's Next update (D-078): RECOVERED (or the flap summary) reaches everyone the FYI emailed. */
export const FYI_NEXT_UPDATE = 'Email when it’s back · no more escalation';
export const NO_STATUS_NOTE = 'No status note yet';
const STATUS_CHARS = 200;

/** "Arm 10:30 — restarting Redis…": one line, at most ~200 characters, cut at a word where there is one. */
export function statusWords(s: StatusNote | null | undefined, now: Date): string {
  if (!s) return NO_STATUS_NOTE;
  const text = s.text.split(/\s+/).join(' ').trim();
  if (!text) return NO_STATUS_NOTE;
  let short = text;
  // Whole graphemes: an emoji, or a Thai vowel / tone mark, is never split from its letter.
  const chars = Array.from(
    new Intl.Segmenter('th', { granularity: 'grapheme' }).segment(text),
    (g) => g.segment,
  );
  if (chars.length > STATUS_CHARS) {
    const cut = chars.slice(0, STATUS_CHARS).join('');
    const space = cut.lastIndexOf(' ');
    short = `${space > STATUS_CHARS / 2 ? cut.slice(0, space) : cut}…`;
  }
  return `${plainName(s.by)} ${dayTime(s.at, now)} — ${short}`;
}

/** "10:30" today, else "Thu 24 Sep 23:10" (spec §13: a date only when it isn't today). */
const dayTime = (d: Date, now: Date) =>
  isSameBangkokDay(d, now) ? formatTime(d) : `${formatDay(d, { weekday: true })} ${formatTime(d)}`;

/** The level as the text line names it: L1–L3 (the SQL keeps levels 0–3). */
const levelOf = (n: number): StepLevel => (n >= 3 ? 3 : n <= 1 ? 1 : 2);

const listed = (names: readonly string[]) => names.map(plainName).join(', ');
const spoken = (names: readonly string[]) => {
  const n = names.map(plainName);
  return n.length > 1 ? `${n.slice(0, -1).join(', ')} and ${n.at(-1)}` : (n[0] ?? 'Nobody');
};

const openButton = (url: string) => ({
  buttonList: { buttons: [{ text: 'Open / acknowledge', onClick: { openLink: { url } } }] },
});
const askedWords = (asked: StepAlertInput['asked']) =>
  asked.map((p) => `${plainName(p.name)} (${p.role})`).join(' and ');

/**
 * ESCALATED · L1 (ChatAlert 10:03, the "L1 · +15 min · day" row): the people asked @mentioned, the
 * Admin as FYI — or @mentioned when nobody else is new. A PROBLEM's L1 is the "STILL PROBLEM … (backup)
 * please take it" row, which @mentions the owner and the backup.
 */
export function buildStepAlert(input: StepAlertInput): ChatMessage {
  const message = stepAlert(input);
  if (!input.byHand) return message;
  // Escalate now (S12b, spec §30.6): the level went because someone sent it, not on the engine's clock.
  const words = `sent by hand by ${plainName(input.byHand)} (the status engine is down)`;
  return {
    text: `${message.text} · ${words}`,
    cardsV2: message.cardsV2.map(({ cardId, card }) => ({
      cardId,
      card: {
        ...card,
        sections: card.sections.map((s, i) =>
          i === 0
            ? {
                ...s,
                widgets: [
                  {
                    textParagraph: {
                      text: `Sent by hand by ${plainName(input.byHand!)} — the status engine is down, so nothing escalates on its own.`,
                    },
                  },
                  ...s.widgets,
                ],
              }
            : s,
        ),
      },
    })),
  };
}

function stepAlert(input: StepAlertInput): ChatMessage {
  const site = plainName(input.site);
  const duration = formatDuration(input.elapsedMin);
  const owner = input.owner ? plainName(input.owner.name) : 'Nobody';
  const asked = askedWords(input.asked);
  if (input.severity === 'problem') {
    return {
      text: buildChatTextLine({
        state: 'STILL PROBLEM',
        site,
        mention: mentions([input.owner, ...input.asked]),
        detail: [`${duration}, not acknowledged`, ...(asked ? [`${asked} please take it`] : [])],
      }),
      cardsV2: [
        {
          cardId: `step-${input.incidentId}-problem-${input.level}`,
          card: {
            header: { title: `STILL PROBLEM · ${site} · ${duration}, not acknowledged` },
            sections: [
              {
                widgets: [
                  {
                    textParagraph: {
                      text: `${owner} hasn’t acknowledged.${asked ? ` ${asked} please take it.` : ''}`,
                    },
                  },
                  openButton(input.incidentUrl),
                ],
              },
            ],
          },
        },
      ],
    };
  }
  const kind = input.kind ?? 'ask';
  if (kind !== 'ask') return otherStepAlert(input, kind, site, duration);
  const fyi = input.fyi.length ? [`${names(input.fyi)} FYI`] : [];
  const informed = input.fyi.length ? `; ${names(input.fyi)} ${verb(input.fyi)} informed` : '';
  // ChatAlert L1: "… · please acknowledge · Tao FYI · CEO at 10:18".
  const next = input.next ? [`${plainName(input.next.who)} at ${formatTime(input.next.at)}`] : [];
  return {
    text: buildChatTextLine({
      state: `ESCALATED · L${levelOf(input.level)}` as const,
      site: `${site} DOWN ${duration}, not acknowledged`,
      mention: mentions(input.asked),
      detail: [
        'please acknowledge',
        ...fyi,
        ...(input.alreadyPaged ? [`${plainName(input.alreadyPaged)} (on call) already paged`] : []),
        ...next,
      ],
    }),
    cardsV2: [
      {
        cardId: `step-${input.incidentId}-down-${input.level}`,
        card: {
          header: {
            title: `ESCALATED · L${input.level} · ${site} still down · ${duration}, not acknowledged`,
          },
          sections: [
            {
              widgets: [
                {
                  textParagraph: {
                    text: `${owner} hasn’t acknowledged. ${asked || 'Nobody new'} please take it${informed}.${
                      input.next ? ` Next: ${plainName(input.next.who)} at ${formatTime(input.next.at)}.` : ''
                    }`,
                  },
                },
                openButton(input.incidentUrl),
              ],
            },
          ],
        },
      },
    ],
  };
}

/** The FYI card's facts (D-078, Bua's item 3): what's wrong, since when, the latest status, the next update. */
function fyiRows(input: StepAlertInput, duration: string): ChatWidget[] {
  const now = input.sentAt ?? new Date();
  const since = input.since ? `${duration} (confirmed down ${dayTime(input.since, now)})` : duration;
  return [
    ...(input.cause ? [row('Cause', input.cause)] : []),
    row('Down for', since),
    row('Status', statusWords(input.status, now)),
    row('Next update', FYI_NEXT_UPDATE),
  ];
}

/**
 * The S10 steps (ChatAlert rows; D-048 for the FYI nobody acknowledged):
 *   · ceo:      `<users/CEO> ESCALATED · L2 · MuvMi DOWN 30 min, not acknowledged · Arm, Ploy, Tao informed`
 *   · fyi:      `<users/CEO> <users/BUA> FYI · L3 · MuvMi still DOWN 60 min · acknowledged by Arm 10:07 · no action needed`
 *               (nobody acked: `… still DOWN 60 min · not acknowledged · Arm, Ploy, Tao informed · no action needed`)
 *   · reminder: `<users/TAO> REMINDER · L2 · WeCare Studio DOWN 30 min, not acknowledged` (§16.5)
 */
function otherStepAlert(
  input: StepAlertInput,
  kind: 'ceo' | 'fyi' | 'reminder',
  site: string,
  duration: string,
): ChatMessage {
  const informed = input.informed ?? [];
  const acked = input.acked;
  const line =
    kind === 'ceo'
      ? buildChatTextLine({
          state: `ESCALATED · L${levelOf(input.level)}` as const,
          site: `${site} DOWN ${duration}, not acknowledged`,
          mention: mentions(input.asked),
          detail: informed.length ? [`${listed(informed)} informed`] : [],
        })
      : kind === 'fyi'
        ? buildChatTextLine({
            state: `FYI · L${levelOf(input.level)}` as const,
            site: `${site} still DOWN ${duration}`,
            mention: mentions(input.asked),
            detail: acked
              ? [`acknowledged by ${plainName(acked.by)} ${formatTime(acked.at)}`, 'no action needed']
              : [
                  'not acknowledged',
                  ...(informed.length ? [`${listed(informed)} informed`] : []),
                  'no action needed',
                ],
          })
        : buildChatTextLine({
            state: `REMINDER · L${levelOf(input.level)}` as const,
            site: `${site} DOWN ${duration}, not acknowledged`,
            mention: mentions(input.asked),
          });
  const title =
    kind === 'ceo'
      ? `ESCALATED · L${input.level} · ${site} down ${duration} · nobody has acknowledged`
      : kind === 'fyi'
        ? `FYI · L${input.level} · ${site} still down after ${duration}`
        : `REMINDER · L${input.level} · ${site} down ${duration}, not acknowledged`;
  const body =
    kind === 'ceo'
      ? `Nobody on the team has acknowledged. ${spoken(informed)} ${informed.length > 1 ? 'were' : 'was'} asked.`
      : kind === 'fyi'
        ? acked
          ? `For your information — no action needed. ${plainName(acked.by)} acknowledged at ${formatTime(acked.at)} and is working on it.`
          : `For your information — no action needed. Nobody has acknowledged yet; ${spoken(informed)} ${informed.length > 1 ? 'were' : 'was'} asked.`
        : 'Nobody has acknowledged yet. Acknowledge to stop these reminders.';
  return {
    text: line,
    cardsV2: [
      {
        cardId: `step-${input.incidentId}-down-${input.level}`,
        card: {
          header: { title },
          sections: [
            {
              widgets: [
                { textParagraph: { text: body } },
                ...(kind === 'fyi' ? fyiRows(input, duration) : []),
                kind === 'reminder'
                  ? openButton(input.incidentUrl)
                  : {
                      buttonList: {
                        buttons: [
                          {
                            text: 'Open incident',
                            onClick: { openLink: { url: input.viewUrl ?? input.incidentUrl } },
                          },
                        ],
                      },
                    },
              ],
            },
          ],
        },
      },
    ],
  };
}

export interface ReminderAlertInput {
  incidentId: string;
  site: string;
  severity: 'down' | 'problem';
  elapsedMin: number;
  /** Everyone asked to act so far (FYI people aren't). */
  mention: readonly ChatPerson[];
  incidentUrl: string;
}

/** A reminder in the thread (PRD §7; Tao, 10 Oct: "STILL DOWN · <site> · 30 min, not acknowledged"). */
export function buildReminderAlert(input: ReminderAlertInput): ChatMessage {
  const site = plainName(input.site);
  const duration = formatDuration(input.elapsedMin);
  const down = input.severity === 'down';
  const state = down ? 'STILL DOWN' : 'STILL PROBLEM';
  return {
    text: buildChatTextLine({
      state,
      site,
      mention: mentions(input.mention),
      detail: [`${duration}, not acknowledged`, ...(down ? ['please acknowledge'] : [])],
    }),
    cardsV2: [
      {
        cardId: `reminder-${input.incidentId}-${input.elapsedMin}`,
        card: {
          header: { title: `${state} · ${site} · ${duration}, not acknowledged` },
          sections: [
            {
              widgets: [
                {
                  textParagraph: {
                    text: down
                      ? 'Nobody has acknowledged yet. Acknowledge to stop these reminders.'
                      : 'The site is up, with a problem. Acknowledge to stop these reminders.',
                  },
                },
                openButton(input.incidentUrl),
              ],
            },
          ],
        },
      },
    ],
  };
}
