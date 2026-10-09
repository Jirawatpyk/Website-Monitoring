import { formatTime } from '@dxt/shared';
import { plainName, type ChatMessage } from './chat-alerts';
import { buildChatTextLine } from './chat-text';
import { downtime } from './downtime';

/**
 * NOTE and RESOLVED thread replies (ChatAlert board rows "Note" and "Resolved", spec §16.5, D-033):
 * both mention nobody. NOTE is the text line alone (`NOTE · <site> · <name>: <text>`), posted at
 * once; RESOLVED (`RESOLVED · <site> · by <name> <time>`) goes after the 10 s Undo window with a card
 * that says what the root cause was.
 */

/**
 * Text people typed (a note, a root cause) goes into the text line, where `<users/…>` would notify
 * and `<url|text>` would make a link: `<` becomes a look-alike so no tag can start, and every other
 * character stays as written ("Timeout > 30 s"). Line breaks fold into spaces.
 */
export const plainText = (text: string) =>
  text
    .replace(/</g, '‹')
    .replace(/\s*\n\s*/g, ' ')
    .trim();

export interface NoteAlertInput {
  site: string;
  by: string;
  text: string;
}

export function buildNoteAlert(input: NoteAlertInput): ChatMessage {
  return {
    text: `${buildChatTextLine({ state: 'NOTE', site: plainName(input.site) })} · ${plainName(input.by)}: ${plainText(input.text)}`,
    cardsV2: [],
  };
}

export interface ResolvedAlertInput {
  incidentId: string;
  site: string;
  resolvedBy: string;
  resolvedAt: Date;
  /** The category's words ("Hosting / server"). */
  rootCause: string;
  whatHappened: string;
  whatFixedIt: string | null;
  severity: 'down' | 'problem';
  startedAt: Date;
  recoveredAt: Date | null;
}

export function buildResolvedAlert(input: ResolvedAlertInput): ChatMessage {
  const site = plainName(input.site);
  const by = plainName(input.resolvedBy);
  const at = formatTime(input.resolvedAt);
  const lasted = input.recoveredAt ? downtime(input.startedAt, input.recoveredAt) : null;
  const rows = [
    ['Root cause', input.rootCause],
    ['What happened', input.whatHappened],
    ...(input.whatFixedIt ? [['What fixed it', input.whatFixedIt]] : []),
    ...(lasted
      ? [[input.severity === 'down' ? 'Down for' : 'Problem for', `${lasted.duration} (${lasted.range})`]]
      : []),
  ];
  return {
    text: buildChatTextLine({ state: 'RESOLVED', site, detail: [`by ${by} ${at}`] }),
    cardsV2: [
      {
        cardId: `resolved-${input.incidentId}`,
        card: {
          header: { title: `RESOLVED · ${site} · by ${by} ${at}` },
          sections: [
            {
              widgets: rows.map(([topLabel, text]) => ({
                // Card text renders tags: `<` escaped, as every card row (chat-alerts `row`).
                decoratedText: {
                  topLabel: topLabel!,
                  text: text!.replace(/</g, '&lt;'),
                  wrapText: true as const,
                },
              })),
            },
          ],
        },
      },
    ],
  };
}
