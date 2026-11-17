import { formatIncidentId, formatTier, TRIGGER_LABELS, type Trigger } from '@dxt/shared';
import { plainName, type ChatMessage, type ChatPerson } from './chat-alerts';
import { buildChatTextLine } from './chat-text';

export interface NewCauseAlertInput {
  incidentId: string;
  incidentNumber: number;
  site: string;
  tier: number;
  /** The SSL / domain trigger the incident was open for. */
  was: Trigger;
  /** The new, more urgent trigger. */
  trigger: Trigger;
  /** Its short cause for the text line: "“บาคาร่า” found on the page (as Googlebot)". */
  summary: string;
  /** Its full cause for the card: "Found “บาคาร่า” on / (as Googlebot)". */
  cause: string;
  /** Whoever acts now: the person who acknowledged, else the L0 person. */
  mention: ChatPerson | null;
  ackedBy: string | null;
  /** When the new cause was seen (the round). */
  at: Date;
}

/**
 * D-067: an incident open for an SSL / domain expiry that now has a more urgent PROBLEM says so in its
 * thread — "PROBLEM · <site> (Tier n) · new cause: … · was SSL expiring · same incident INC-…",
 * @mentioning whoever acts now. Without it the one open incident would swallow the new problem for as
 * long as the certificate waits for its renewal (engine review S13, H1). No card button: a reply.
 */
export function buildNewCauseAlert(input: NewCauseAlertInput): ChatMessage {
  const site = plainName(input.site);
  const inc = formatIncidentId(input.incidentNumber);
  const was = TRIGGER_LABELS[input.was];
  const now = TRIGGER_LABELS[input.trigger];
  const ack = input.ackedBy ? plainName(input.ackedBy) : null;
  const body =
    `${input.cause}. ${site} was already open as ${inc} for ${was}; this new problem joins it, ` +
    `and the incident now reads ${now}.` +
    (ack ? ` ${ack} acknowledged earlier, so only ${ack} is mentioned.` : '');
  return {
    text: buildChatTextLine({
      state: 'PROBLEM',
      site: `${site} (${formatTier(input.tier)})`,
      mention: input.mention?.chatUserId ? [input.mention.chatUserId] : [],
      detail: [`new cause: ${input.summary}`, `was ${was}`, `same incident ${inc}`],
    }),
    cardsV2: [
      {
        cardId: `problem-new-cause-${input.incidentId}-${input.at.getTime()}`,
        card: {
          header: { title: `PROBLEM · ${site} · new cause: ${now}` },
          sections: [{ widgets: [{ textParagraph: { text: escape(body) } }] }],
        },
      },
    ],
  };
}

/** As the AGAIN replies: no markup from page text reaches the card (the email turns it back). */
const escape = (text: string) => text.replace(/</g, '&lt;');
