import { formatDay, formatDuration, formatTime, isSameBangkokDay } from '@dxt/shared';
import { plainName, type ChatMessage, type ChatPerson } from './chat-alerts';
import { buildChatTextLine } from './chat-text';

/**
 * The escalation ladder's messages (S08, D-034; ChatAlert / EmailAlert rows, spec §8, §14.10, §15.7):
 * ESCALATED · L1 for a DOWN, STILL PROBLEM for a PROBLEM's L1 (the backup's step at +60), the
 * reminders in the thread, the L1 emails, and the escalation facts the first cards and the
 * ACKNOWLEDGED replies carry. CEO, L2 / L3, voice and on-call wording waits for S10 (D-013).
 */

/** What the first card and its email say about the ladder (D-034). */
export interface LadderFacts {
  /** The next level if nobody acknowledges: when, and who it asks / tells FYI. */
  next?: { level: number; at: Date; ask: readonly string[]; fyi: readonly string[] } | null;
  /** Tier 2–3 outside response hours: when the timers run again. */
  pausedUntil?: Date | null;
}

/** "09:00" today or tomorrow, "Mon 09:00" further off. */
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

/** The card's "Next" row: "L1 at 10:03 if not acknowledged — Ploy, Tao". */
export function nextRow(ladder: LadderFacts | null | undefined, now: Date, severity: 'down' | 'problem') {
  const next = ladder?.next;
  if (!next) return null;
  const people = [...next.ask, ...next.fyi].map(plainName);
  const at = formatResume(next.at, now);
  return severity === 'problem'
    ? `Reminder + ${people.map((p) => `${p} (backup)`).join(', ')} at ${at} if not acknowledged`
    : `L${next.level} at ${at} if not acknowledged — ${people.join(', ')}`;
}

/** What an ACKNOWLEDGED reply says stopped: L1 for a DOWN, the reminders (and the backup step) for a PROBLEM. */
export type LadderStopped = { severity: 'down' | 'problem'; backup: string | null; l1Fired: boolean };

export function stoppedWords(s: LadderStopped | null | undefined): { line: string; body: string } | null {
  if (!s) return null;
  if (s.severity === 'down') return { line: 'L1 stopped', body: 'L1 stopped.' };
  const step = !s.l1Fired && s.backup ? ` and the ${plainName(s.backup)} (backup) step are` : ' are';
  return { line: 'reminders stopped', body: `the reminders${step} stopped.` };
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
  /** Minutes since "Confirmed down" (or the PROBLEM flagged), wall clock. */
  elapsedMin: number;
  /** The L0 person: "Arm hasn't acknowledged". */
  owner: ChatPerson | null;
  /** Asked to act at this level (@mentioned), with how the reply names them ("backup"). */
  asked: readonly (ChatPerson & { role: string })[];
  /** Told for information, named in plain text ("Tao FYI"). */
  fyi: readonly ChatPerson[];
  incidentUrl: string;
}

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
  const fyi = input.fyi.length ? [`${names(input.fyi)} FYI`] : [];
  const informed = input.fyi.length ? `; ${names(input.fyi)} ${verb(input.fyi)} informed` : '';
  return {
    text: buildChatTextLine({
      state: input.level === 1 ? 'ESCALATED · L1' : 'ESCALATED · L2',
      site: `${site} DOWN ${duration}, not acknowledged`,
      mention: mentions(input.asked),
      detail: ['please acknowledge', ...fyi],
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
                    text: `${owner} hasn’t acknowledged. ${asked || 'Nobody new'} please take it${informed}.`,
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
