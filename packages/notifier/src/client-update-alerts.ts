import { formatDay, formatTime, isSameBangkokDay } from '@dxt/shared';
import { plainName, type ChatMessage, type ChatPerson } from './chat-alerts';
import { buildChatTextLine } from './chat-text';

/**
 * The client-update track's messages (S11, FR-20, spec §9, §14.11; ChatAlert "client update due" row,
 * EmailAlert "Client update"; D-052): CLIENT UPDATE DUE in the incident's thread @mentioning the AM —
 * or the Admins when the client has no active AM — and the draft client message the incident page
 * shows in Thai and English.
 */

export type DraftLanguage = 'th' | 'en';

export interface ClientUpdateDraftInput {
  /** The client's name: "เรียนทีม MuvMi". */
  client: string;
  /** The first failed check: "since 09:48". */
  since: Date;
  /** The AM who signs it; null with no AM (D-052): signed by DxT Solutions only. */
  am: string | null;
  lang: DraftLanguage;
  /** When the draft is shown: the time gets its day when it wasn't today. */
  now: Date;
}

/** The draft client message (Incident board): `[ETA]` stays for the AM to fill in. */
export function clientUpdateDraft(input: ClientUpdateDraftInput): string {
  const time = isSameBangkokDay(input.since, input.now)
    ? formatTime(input.since)
    : `${formatDay(input.since, { weekday: true })} ${formatTime(input.since)}`;
  const sign = input.am ? `${plainName(input.am)}, DxT Solutions` : 'DxT Solutions';
  return input.lang === 'th'
    ? [
        `เรียนทีม ${input.client}`,
        `ขณะนี้เว็บไซต์ของท่านไม่สามารถเข้าใช้งานได้ ตั้งแต่เวลา ${time} น. ทีม DxT ตรวจพบแล้วและกำลังแก้ไข จะแจ้งความคืบหน้าภายใน [ETA] น.`,
        `ขออภัยในความไม่สะดวก — ${sign}`,
      ].join('\n')
    : [
        `Hi ${input.client} team,`,
        `Your website has been unavailable since ${time} (UTC+7). DxT detected it and is working on a fix. Next update by [ETA].`,
        `Sorry for the disruption — ${sign}`,
      ].join('\n');
}

/** How long the track waited, in the message's words: Tier 1 "15 min", Tier 2 "60 min inside response hours". */
export const clientUpdateWait = (tier: number) => (tier === 1 ? '15 min' : '60 min inside response hours');

export interface ClientUpdateDueAlertInput {
  incidentId: string;
  site: string;
  tier: number;
  /** The AM, or with `noAm` the Admins told instead (D-052 item 2). */
  people: readonly ChatPerson[];
  noAm: boolean;
  client: string;
  /** Recovered in the minute it fell due: "was down", not "still down". */
  recovered: boolean;
  /** The incident page's Client update card (`#client-update`). */
  draftUrl: string;
  /** Sent by hand while the engine was stopped (S12b, spec §30.7, D-055): who sent it, maybe before 15 min. */
  byHand?: string | null;
}

/**
 * CLIENT UPDATE DUE (ChatAlert 10:03): `<users/BUA> CLIENT UPDATE DUE · MuvMi DOWN 15 min · draft
 * ready`, then the card with "Open draft". Acked or not (§8): the track runs apart from escalation.
 */
export function buildClientUpdateDueAlert(input: ClientUpdateDueAlertInput): ChatMessage {
  const site = plainName(input.site);
  const wait = clientUpdateWait(input.tier);
  const who = input.people.map((p) => plainName(p.name)).join(' and ') || 'An Admin';
  const unlinked = input.people.filter((p) => !p.chatUserId).map((p) => plainName(p.name));
  return {
    text: buildChatTextLine({
      state: 'CLIENT UPDATE DUE',
      // By hand it can go before the wait is over: no "15 min" it may not have reached.
      site: input.byHand ? `${site} DOWN` : `${site} DOWN ${wait}`,
      mention: input.people.flatMap((p) => (p.chatUserId ? [p.chatUserId] : [])),
      detail: [
        ...(input.noAm ? [`no account manager for ${plainName(input.client)}`] : []),
        // Someone without a Chat id is named, since a mention can't reach them (S09b).
        ...(unlinked.length ? [`for ${unlinked.join(' and ')}`] : []),
        'draft ready',
        ...(input.byHand ? [`sent by hand by ${plainName(input.byHand)} (the status engine is down)`] : []),
      ],
    }),
    cardsV2: [
      {
        cardId: `client-update-${input.incidentId}`,
        card: {
          header: {
            title: input.byHand
              ? `CLIENT UPDATE DUE · ${site} still down`
              : `CLIENT UPDATE DUE · ${site} ${input.recovered ? 'was down' : 'still down'} · ${wait}`,
          },
          sections: [
            {
              widgets: [
                ...(input.byHand
                  ? [
                      {
                        textParagraph: {
                          text: `Sent by hand by ${plainName(input.byHand)} — the status engine is down, so this reminder wouldn’t go out on its own.`,
                        },
                      },
                    ]
                  : []),
                {
                  textParagraph: {
                    text: input.noAm
                      ? `${plainName(input.client)} has no account manager in DxT Monitor, so ${who} (Admin) ${input.people.length > 1 ? 'are' : 'is'} told instead. Send the client message from the draft on the incident page, then mark it. Runs whether or not the incident is acknowledged.`
                      : `${who} (AM) sends the client message from the draft on the incident page, then marks it. Runs whether or not the incident is acknowledged.`,
                  },
                },
                {
                  buttonList: {
                    buttons: [{ text: 'Open draft', onClick: { openLink: { url: input.draftUrl } } }],
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
