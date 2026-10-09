import { formatDuration, formatTime } from '@dxt/shared';
import { plainName, type ChatMessage } from './chat-alerts';
import { buildChatTextLine } from './chat-text';
import { downtime } from './downtime';
import { flapCounts, type Drop } from './relapse-alerts';

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
  /** The incident's closed drops (with their severity): "Down for" counts the DOWN ones (D-033). */
  drops: readonly Drop[];
}

/**
 * How long, in RESOLVED (message-checker H1): DOWN minutes only, as uptime and the flapping summary
 * count them — "Down for 43 min (09:48–10:31)" for one drop, "Down in total 41 min (03:12–04:04)" for
 * several; "Problem lasted …" only when nothing went down.
 */
export function resolvedLasted(drops: readonly Drop[]): [string, string] | null {
  if (!drops.length) return null;
  const down = drops.some((d) => d.severity !== 'problem');
  const { counted, first, last, minutes } = flapCounts(drops, down ? 'down' : 'problem');
  if (!first || !last) return null;
  if (counted === 1) {
    const one = drops.find((d) => (down ? d.severity !== 'problem' : true))!;
    const { duration, range } = downtime(one.start, one.end);
    return [down ? 'Down for' : 'Problem lasted', `${duration} (${range})`];
  }
  const span = downtime(first.start, last.end).range;
  return [down ? 'Down in total' : 'Problem lasted', `${formatDuration(minutes)} (${span})`];
}

export function buildResolvedAlert(input: ResolvedAlertInput): ChatMessage {
  const site = plainName(input.site);
  const by = plainName(input.resolvedBy);
  const at = formatTime(input.resolvedAt);
  const lasted = resolvedLasted(input.drops);
  const rows = [
    ['What happened', input.whatHappened],
    ...(input.whatFixedIt ? [['What fixed it', input.whatFixedIt]] : []),
    ...(lasted ? [lasted] : []),
  ];
  return {
    text: buildChatTextLine({ state: 'RESOLVED', site, detail: [`by ${by} ${at}`] }),
    cardsV2: [
      {
        cardId: `resolved-${input.incidentId}`,
        card: {
          header: { title: `Root cause · ${plainName(input.rootCause)}` },
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
