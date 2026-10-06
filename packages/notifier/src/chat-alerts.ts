import {
  formatDay,
  formatDuration,
  formatIncidentId,
  formatTier,
  formatTime,
  formatTimeWithSeconds,
  isSameBangkokDay,
} from '@dxt/shared';
import { buildChatTextLine } from './chat-text';

/**
 * Google Chat DOWN and RECOVERED messages — ChatAlert board, spec §10 / §14.10 / §16.4, with D-013:
 * no escalation promise (S10) and an "Open incident" button until ack ships (S02b).
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
  owner: ChatPerson | null;
  backup: ChatPerson | null;
  incidentUrl: string;
}

export interface RecoveredAlertInput {
  incidentId: string;
  site: string;
  /** First failed check: the downtime counts from here (spec §6). */
  startedAt: Date;
  recoveredAt: Date;
  okLocations: number;
  owner: ChatPerson | null;
}

/**
 * Names come from Admins and Google profiles. Angle brackets would let one inject a mention
 * (`<users/all>`) or a link into the text line, or markup into the card: names never need them.
 */
export const plainName = (name: string) => name.replace(/[<>]/g, '');

const mentionOf = (owner: ChatPerson | null) => (owner?.chatUserId ? [owner.chatUserId] : []);

const row = (topLabel: string, text: string): ChatWidget => ({
  decoratedText: { topLabel, text, wrapText: true },
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
  const ownerText = [
    owner ? plainName(owner.name) : 'No owner set',
    ...(backup ? [`backup ${plainName(backup.name)}`] : []),
  ].join(' · ');

  return {
    text: buildChatTextLine({
      state: 'DOWN',
      site: `${site} (${formatTier(tier)})`,
      mention: mentionOf(owner),
    }),
    cardsV2: [
      {
        cardId: `down-${input.incidentId}`,
        card: {
          header: { title: `DOWN · ${site}`, subtitle },
          sections: [
            {
              widgets: [
                row('Cause', input.cause),
                row('Confirmed by', `${input.confirmingLocations} locations, 2 checks`),
                row('Owner', ownerText),
                {
                  buttonList: {
                    buttons: [{ text: 'Open incident', onClick: { openLink: { url: input.incidentUrl } } }],
                  },
                },
                { textParagraph: { text: '<b>Current status is in the latest reply.</b>' } },
              ],
            },
          ],
        },
      },
    ],
  };
}

export function buildRecoveredAlert(input: RecoveredAlertInput): ChatMessage {
  const { startedAt, recoveredAt } = input;
  const site = plainName(input.site);
  // At least "1 min": a confirmed DOWN always lasted some time, and "down 0 min" reads as no outage.
  // Count whole clock minutes, so the number matches the range shown (19:37–19:42 = 5 min); at least
  // "1 min" — a confirmed DOWN always lasted some time, and "down 0 min" reads as no outage.
  const minute = (d: Date) => Math.floor(d.getTime() / 60_000);
  const down = formatDuration(Math.max(1, minute(recoveredAt) - minute(startedAt)));
  // Past midnight in Bangkok the range names both days.
  const at = (d: Date) =>
    isSameBangkokDay(startedAt, recoveredAt)
      ? formatTime(d)
      : `${formatDay(d, { weekday: true })} ${formatTime(d)}`;

  return {
    text: buildChatTextLine({
      state: 'RECOVERED',
      site,
      mention: mentionOf(input.owner),
      detail: [`down ${down}`, 'add a root cause'],
    }),
    cardsV2: [
      {
        cardId: `recovered-${input.incidentId}`,
        card: {
          header: {
            title: `RECOVERED · ${site} is back · down ${down} (${at(startedAt)}–${at(recoveredAt)})`,
          },
          sections: [
            {
              widgets: [
                {
                  textParagraph: {
                    text: `OK from ${input.okLocations} locations. Needs a root cause before it can be resolved.`,
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
