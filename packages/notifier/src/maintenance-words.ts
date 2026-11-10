import { formatDay, formatTime, formatWindowLength, isSameBangkokDay } from '@dxt/shared';
import { plainName, type ChatMessage, type ChatPerson, type ChatWidget } from './chat-alerts';

/**
 * Words and card parts the window (S09b) and series (S14) messages share. Internal to the package:
 * `index.ts` doesn't export it.
 */

export const full = (d: Date) => `${formatDay(d, { weekday: true })} ${formatTime(d)}`;
/** "22:00" today, else "Sat 26 Sep 22:00" (§24.4: a date only when it isn't today). */
export const at = (d: Date, now: Date) => (isSameBangkokDay(d, now) ? formatTime(d) : full(d));
/** "Tue 29 Sep 01:00 → 03:00": the end's date only when it is another day than the start. */
export const span = (start: Date, end: Date, startText: string) =>
  `${startText} → ${isSameBangkokDay(start, end) ? formatTime(end) : full(end)}`;
export const lengthOf = (start: Date, end: Date) =>
  formatWindowLength((end.getTime() - start.getTime()) / 60_000);
/** Names and reasons are people's words: no `<` / `>`, so no mention or markup can be slipped in. */
export const quoted = (reason: string | null | undefined) => `“${plainName(reason ?? '')}”`;
export const who = (name: string | null | undefined) => plainName(name ?? 'System');
export const hoursTo = (start: Date, now: Date) =>
  Math.max(1, Math.round((start.getTime() - now.getTime()) / 3_600_000));

export const row = (topLabel: string, text: string): ChatWidget => ({
  decoratedText: { topLabel, text: text.replace(/</g, '&lt;'), wrapText: true },
});
export const para = (text: string): ChatWidget => ({ textParagraph: { text: text.replace(/</g, '&lt;') } });
export const card = (
  id: string,
  title: string,
  widgets: ChatWidget[],
  subtitle?: string,
): ChatMessage['cardsV2'][number] => ({
  cardId: id,
  card: { header: subtitle ? { title, subtitle } : { title }, sections: [{ widgets }] },
});
export const mention = (p: ChatPerson | null | undefined) => (p?.chatUserId ? [p.chatUserId] : []);
export const openLink = (url: string, text = 'Open Maintenance & mutes'): ChatWidget => ({
  buttonList: { buttons: [{ text, onClick: { openLink: { url } } }] },
});
