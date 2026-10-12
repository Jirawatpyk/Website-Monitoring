import {
  clockMinutes,
  formatDay,
  formatDuration,
  formatIncidentId,
  formatTier,
  formatTime,
  formatConfirmedBy,
  formatTimeWithSeconds,
  isSameBangkokDay,
  TRIGGER_LABELS,
  type Trigger,
} from '@dxt/shared';
import { buildChatTextLine } from './chat-text';
import { downtime } from './downtime';
import {
  formatResume,
  ladderLine,
  nextRow,
  stoppedWords,
  type LadderFacts,
  type LadderStopped,
} from './escalation-alerts';

/**
 * Google Chat DOWN, PROBLEM, ACKNOWLEDGED and RECOVERED messages — ChatAlert board, spec §10 / §14.10 /
 * §16.4. The ladder's promise ("acknowledge by …", the "Next" row, "(not notified yet)", "L1 stopped")
 * comes with S08 for L1 only (D-034); CEO / L2 / L3 / on-call wording waits for S10.
 * A message is a plain text line (the only place @mentions notify) followed by one Cards v2 card.
 */

export interface ChatPerson {
  name: string;
  /** Google Chat user id; mentioned only when known. */
  chatUserId: string | null;
}

export interface ChatMessage {
  text: string;
  cardsV2: ChatCard[];
}

export interface ChatCard {
  cardId: string;
  card: {
    header: { title: string; subtitle?: string };
    sections: { widgets: ChatWidget[] }[];
  };
}

export type ChatWidget =
  | { decoratedText: { topLabel: string; text: string; wrapText: true } }
  | { textParagraph: { text: string } }
  | { buttonList: { buttons: { text: string; onClick: { openLink: { url: string } } }[] } };

export interface DownAlertInput {
  incidentId: string;
  incidentNumber: number;
  site: string;
  tier: number;
  confirmedAt: Date;
  /** Send time: the date is shown only when DOWN was confirmed on another day. */
  now: Date;
  /** `formatCause` output. */
  cause: string;
  confirmingLocations: number;
  /** Behind a WAF (D-027): who confirmed it and who the WAF blocked. */
  confirmedByWaf?: { from: readonly string[]; blocked: readonly string[] } | null;
  owner: ChatPerson | null;
  backup: ChatPerson | null;
  /** The incident page, where the ack happens (`?ack=1`, MobileAck). */
  incidentUrl: string;
  /** The ladder (S08): the next level and who it asks, or the timers paused outside hours. */
  ladder?: LadderFacts | null;
  /** A mute held this first alert back until then (§24.7, D-036): the card says why it's late. */
  heldUntil?: Date | null;
}

/** What a PROBLEM's replies need to word it as one (ChatAlert PROBLEM rows, D-022). */
export interface ProblemFacts {
  trigger: Trigger;
  /** Slow: the limit the response time is back under. */
  slowLimitMs?: number | null;
}

export interface ProblemAlertInput {
  incidentId: string;
  incidentNumber: number;
  site: string;
  tier: number;
  trigger: Trigger;
  /** When the engine opened it: "Detected 09:52". */
  detectedAt: Date;
  now: Date;
  /** `formatProblemCause` output. */
  cause: string;
  /** `formatProblemSummary` output, for the text line. */
  summary: string;
  /** Locations that saw it, of those reporting; null when not known. */
  seenFrom: { count: number; of: number } | null;
  /** PROBLEM (unverified): why the verifier couldn't decide. */
  verifier?: string | null;
  owner: ChatPerson | null;
  backup: ChatPerson | null;
  incidentUrl: string;
  ladder?: LadderFacts | null;
  /** A mute held this first alert back until then (§24.7, D-036). */
  heldUntil?: Date | null;
}

export interface AcknowledgedAlertInput {
  incidentId: string;
  site: string;
  ackedBy: string;
  ackedAt: Date;
  /** Set for a PROBLEM incident: "still slow" / "still has a problem", not "still down". */
  problem?: ProblemFacts | null;
  /** What the ack stopped (S08): "· L1 stopped" / "· reminders stopped". */
  stopped?: LadderStopped | null;
}

export interface RecoveredAlertInput {
  incidentId: string;
  site: string;
  /** First failed check: the downtime counts from here (spec §6). */
  startedAt: Date;
  recoveredAt: Date;
  okLocations: number;
  owner: ChatPerson | null;
  /** Set for a PROBLEM incident: "problem cleared after …", not "is back · down …". */
  problem?: ProblemFacts | null;
}

/**
 * Names come from Admins and Google profiles. Angle brackets would let one inject a mention
 * (`<users/all>`) or a link into the text line, or markup into the card: names never need them.
 */
export const plainName = (name: string) => name.replace(/[<>]/g, '');

const mentionOf = (owner: ChatPerson | null) => (owner?.chatUserId ? [owner.chatUserId] : []);

/** "Arm · backup Ploy (not notified yet)" while the backup's step is still ahead (ChatAlert). */
function ownerRow(owner: ChatPerson | null, backup: ChatPerson | null, ladder?: LadderFacts | null) {
  const waiting = !!backup && !!ladder?.next?.ask.some((n) => n === backup.name);
  return [
    owner ? plainName(owner.name) : 'No owner set',
    ...(backup ? [`backup ${plainName(backup.name)}${waiting ? ' (not notified yet)' : ''}`] : []),
  ].join(' · ');
}

/**
 * Card rows are plain text: a cause carries text from probes and the VPS (errors, verifier detail),
 * and Chat renders tags in card text. `<` is escaped so no tag can start; "Timeout > 30 s" stays.
 */
const row = (topLabel: string, text: string): ChatWidget => ({
  decoratedText: { topLabel, text: text.replace(/</g, '&lt;'), wrapText: true },
});

export function buildDownAlert(input: DownAlertInput): ChatMessage {
  const { tier, confirmedAt, now, owner, backup } = input;
  const site = plainName(input.site);
  const subtitle = [
    formatTier(tier),
    formatIncidentId(input.incidentNumber),
    ...(isSameBangkokDay(confirmedAt, now) ? [] : [formatDay(confirmedAt, { weekday: true })]),
    `Confirmed down ${formatTimeWithSeconds(confirmedAt)} (UTC+7)`,
  ].join(' · ');
  const ownerText = ownerRow(owner, backup, input.ladder);
  const next = nextRow(input.ladder, now, 'down');
  const held = heldWords(input.heldUntil, input.ladder, now, 'down');

  return {
    text: buildChatTextLine({
      state: 'DOWN',
      site: `${site} (${formatTier(tier)})`,
      mention: mentionOf(owner),
      detail: held?.line ?? ladderLine(input.ladder, now),
    }),
    cardsV2: [
      {
        cardId: `down-${input.incidentId}`,
        card: {
          header: { title: `DOWN · ${site}`, subtitle },
          sections: [
            {
              widgets: [
                ...(held ? [{ textParagraph: { text: held.card } }] : []),
                row('Cause', input.cause),
                row('Confirmed by', formatConfirmedBy(input.confirmingLocations, input.confirmedByWaf)),
                row('Owner', ownerText),
                ...(next ? [row('Next', next)] : []),
                {
                  buttonList: {
                    buttons: [
                      { text: 'Open / acknowledge', onClick: { openLink: { url: input.incidentUrl } } },
                    ],
                  },
                },
                {
                  textParagraph: {
                    text: held
                      ? `${FIRST_CARD_FOOTER} Down ${formatDuration(clockMinutes(confirmedAt, now))} so far — the time while muted counts in uptime.`
                      : FIRST_CARD_FOOTER,
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

/**
 * The first alert after a mute (ChatAlert "First alert after a mute", §24.7): the text line says
 * "held by a mute until 15:00" before the ladder's promise (outside response hours only "timers paused
 * until …"), and one amber line sits under the title. Every timer counts from the mute's end.
 */
function heldWords(
  heldUntil: Date | null | undefined,
  ladder: LadderFacts | null | undefined,
  now: Date,
  severity: 'down' | 'problem',
) {
  if (!heldUntil) return null;
  // A held PROBLEM can post the next working morning: the mute's end then carries its day (reviews).
  const until = isSameBangkokDay(heldUntil, now) ? formatTime(heldUntil) : formatResume(heldUntil, now);
  const paused = ladder?.pausedUntil ? formatResume(ladder.pausedUntil, now) : null;
  // A PROBLEM's next step is a reminder, not an escalation: it keeps "please take a look".
  const ask = severity === 'problem' ? ['please take a look'] : ladderLine(ladder, now);
  return {
    line: [`held by a mute until ${until}`, ...(paused ? [`timers paused until ${paused}`] : ask)],
    // No ladder (acknowledged meanwhile, or no plan): it says only why it is late.
    card:
      !ladder || (!ladder.next && !ladder.pausedUntil)
        ? `Held by a mute until ${until}`
        : paused
          ? `Held by a mute until ${until} · outside response hours — escalation starts ${paused}`
          : `Held by a mute until ${until} · escalation starts now`,
  };
}

/** Spec §14.10: the first card says where the status is and that an ack is personal. */
export const FIRST_CARD_FOOTER =
  '<b>Current status is in the latest reply.</b><br>Anyone can open it; the ack is recorded under ' +
  'their own Google account, so nobody can acknowledge as someone else.';

/**
 * ACKNOWLEDGED reply (ChatAlert board): posted only after the 10 s Undo window, mentions nobody,
 * no button. Until escalation exists the body says only who acknowledged (D-016).
 */
export function buildAcknowledgedAlert(input: AcknowledgedAlertInput): ChatMessage {
  const site = plainName(input.site);
  const by = plainName(input.ackedBy);
  const at = formatTime(input.ackedAt);
  const slow = input.problem?.trigger === 'slow';
  const still = !input.problem ? 'still down' : slow ? 'still slow' : 'still has a problem';
  const stopped = stoppedWords(input.stopped);
  const acked = `Acknowledged by ${by}${stopped ? ` → ${stopped.body}` : '.'}`;
  const body = slow ? `${acked} The site is up; it’s only slow.` : acked;
  return {
    text: buildChatTextLine({
      state: 'ACKNOWLEDGED',
      site,
      detail: [`by ${by} ${at}`, ...(stopped ? [stopped.line] : [])],
    }),
    cardsV2: [
      {
        cardId: `acknowledged-${input.incidentId}`,
        card: {
          header: { title: `ACKNOWLEDGED · ${site} ${still} · by ${by} ${at}` },
          sections: [{ widgets: [{ textParagraph: { text: body } }] }],
        },
      },
    ],
  };
}

export function buildRecoveredAlert(input: RecoveredAlertInput): ChatMessage {
  const site = plainName(input.site);
  const { duration, range } = downtime(input.startedAt, input.recoveredAt);
  const problem = input.problem;
  const slow = problem?.trigger === 'slow';
  const title = !problem
    ? `RECOVERED · ${site} is back · down ${duration} (${range})`
    : `RECOVERED · ${site} back to normal · ${slow ? 'slow' : 'problem'} for ${duration} (${range})`;
  const back =
    slow && problem?.slowLimitMs
      ? `Response time back under ${seconds(problem.slowLimitMs)} from ${input.okLocations} locations.`
      : `OK from ${input.okLocations} locations.`;

  return {
    text: buildChatTextLine({
      state: 'RECOVERED',
      site,
      mention: mentionOf(input.owner),
      detail: [problem ? `problem cleared after ${duration}` : `down ${duration}`, 'add a root cause'],
    }),
    cardsV2: [
      {
        cardId: `recovered-${input.incidentId}`,
        card: {
          header: { title },
          sections: [
            {
              widgets: [{ textParagraph: { text: `${back} Needs a root cause before it can be resolved.` } }],
            },
          ],
        },
      },
    ],
  };
}

/**
 * PROBLEM first card (ChatAlert "PROBLEM — the site is up, with an issue"): the owner mentioned in
 * the text line with the short cause, then the card — trigger, cause, where it was seen (PROBLEM
 * (unverified): what we know), owner, "Open / acknowledge". Amber on the boards; a webhook card has
 * no colour, so the word PROBLEM carries it.
 */
export function buildProblemAlert(input: ProblemAlertInput): ChatMessage {
  const { tier, detectedAt, now, owner, backup } = input;
  const site = plainName(input.site);
  const unverified = input.trigger === 'blocked_unverified';
  const subtitle = [
    formatTier(tier),
    formatIncidentId(input.incidentNumber),
    ...(isSameBangkokDay(detectedAt, now) ? [] : [formatDay(detectedAt, { weekday: true })]),
    `Detected ${formatTime(detectedAt)} (UTC+7)`,
  ].join(' · ');
  const ownerText = ownerRow(owner, backup, input.ladder);
  const next = nextRow(input.ladder, now, 'problem', { owner: owner?.name ?? null });
  const held = heldWords(input.heldUntil, input.ladder, now, 'problem');
  const slowNote = input.trigger === 'slow' ? ' — the site loads, just slowly' : '';
  const seen = input.seenFrom ? `${input.seenFrom.count} of ${input.seenFrom.of} locations${slowNote}` : null;
  const known = unverified
    ? [
        row(
          'What we know',
          input.verifier === 'control_failed'
            ? 'No proof either way — the site may be fine. Checked again every round: decided from BKK once its network check passes.'
            : 'No proof either way — the site may be fine. Checked again every round: OK with a note once the verifier loads the page, DOWN if the page fails.',
        ),
      ]
    : seen
      ? [row('Seen from', seen)]
      : [];
  // D-028: a failing BKK network check is the Admin's too, told by its own system email.
  const adminText =
    input.verifier === 'control_failed'
      ? 'The Admin is told about the BKK probe’s network separately (system email) if it keeps failing. This card doesn’t ask anyone to fix it.'
      : 'The Admin is told about the verifier separately (system email). This card doesn’t ask anyone to fix it.';
  const adminNote: ChatWidget[] =
    unverified && input.verifier !== 'browser_blocked' ? [{ textParagraph: { text: adminText } }] : [];

  return {
    text: buildChatTextLine({
      state: 'PROBLEM',
      site: `${site} (${formatTier(tier)})`,
      mention: mentionOf(owner),
      detail: held ? [input.summary, ...held.line] : [input.summary, 'please take a look'],
    }),
    cardsV2: [
      {
        cardId: `problem-${input.incidentId}`,
        card: {
          header: { title: `PROBLEM · ${site}${unverified ? ' · not verified' : ''}`, subtitle },
          sections: [
            {
              widgets: [
                ...(held ? [{ textParagraph: { text: held.card } }] : []),
                row('Trigger', TRIGGER_LABELS[input.trigger]),
                row('Cause', input.cause),
                ...known,
                row('Owner', ownerText),
                ...(next ? [row('Next', next)] : []),
                ...adminNote,
                {
                  buttonList: {
                    buttons: [
                      { text: 'Open / acknowledge', onClick: { openLink: { url: input.incidentUrl } } },
                    ],
                  },
                },
                { textParagraph: { text: FIRST_CARD_FOOTER } },
              ],
            },
          ],
        },
      },
    ],
  };
}

/** 5000 → "5 s", 3500 → "3.5 s". */
const seconds = (ms: number) => `${Number((ms / 1000).toFixed(1))} s`;
