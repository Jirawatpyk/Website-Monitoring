/**
 * D-041 / D-042: the shared forbidden-phrase list, applied to every monitor on top of its own
 * `must_not_contain`. Phrases only — never a single ambiguous word ("slot" matches "time slot" on a
 * booking page, "พนัน" matches Thai news). Thai has no spaces between words, so every Thai entry is
 * checked against normal Thai copy in `forbidden.test.ts` before it joins. It changes by PR until S17
 * makes it Admin-editable, and is never shown in the UI.
 */
const GAMBLING_TH = [
  'สล็อตออนไลน์',
  'สล็อตเว็บตรง',
  'เว็บสล็อต',
  'สล็อต pg',
  'บาคาร่า',
  'แทงบอล',
  'เว็บพนัน',
  'คาสิโนออนไลน์',
  'เว็บตรงไม่ผ่านเอเย่นต์',
  'ฝากถอนออโต้',
  'สล็อตเครดิตฟรี',
  'หวยออนไลน์',
  'แทงหวย',
] as const;

const GAMBLING_EN = [
  'slot online',
  'online slot',
  'slot gacor',
  'situs slot',
  'judi online',
  'online casino',
  'casino online',
  'baccarat online',
  'pg slot',
] as const;

/** Gambling brand names: one token each, but they never mean anything else. */
export const FORBIDDEN_BRANDS = ['slotxo', 'ufabet', 'sbobet', 'joker123'] as const;

const ADULT = ['porn video', 'xxx video', 'sex video', 'คลิปโป๊', 'หนังโป๊'] as const;

const PHARMA = ['buy viagra', 'cheap viagra', 'viagra online', 'cialis online', 'buy cialis'] as const;

export const FORBIDDEN_PHRASES: readonly string[] = [
  ...GAMBLING_TH,
  ...GAMBLING_EN,
  ...FORBIDDEN_BRANDS,
  ...ADULT,
  ...PHARMA,
];

const SPACE_RUN = /(?:\s|&nbsp;|&#160;|&#xa0;)+/giu;

/** Lower case, and any run of whitespace / `&nbsp;` as one space: what the shared list matches on. */
export function normalizeForMatch(text: string): string {
  return text.replace(SPACE_RUN, ' ').toLowerCase();
}

const NORMALIZED = new Map(FORBIDDEN_PHRASES.map((p) => [p, normalizeForMatch(p)]));

/** The longest normalised entry, so a streaming reader keeps enough overlap between chunks. */
export const MAX_FORBIDDEN_PHRASE_LENGTH = Math.max(...FORBIDDEN_PHRASES.map((p) => p.length));

/**
 * The shared-list entries found in `text`, as written in the list (canonical), in list order.
 * Case-insensitive; runs of whitespace count as one space (D-042).
 */
export function findForbiddenPhrases(text: string, phrases: readonly string[] = FORBIDDEN_PHRASES): string[] {
  const haystack = normalizeForMatch(text);
  return phrases.filter((p) => haystack.includes(NORMALIZED.get(p) ?? normalizeForMatch(p)));
}

/** Is this found word a shared-list entry (as the probe reports it)? */
export function isForbiddenPhrase(word: string): boolean {
  return NORMALIZED.has(word);
}

/**
 * D-041: the crawler's two views of a home page, fetched every 30 min from SIN. They are not
 * locations and don't take part in rounds.
 */
export const CRAWLER_VIEWS = ['googlebot', 'google_referer'] as const;
export type CrawlerView = (typeof CRAWLER_VIEWS)[number];

/**
 * Fixed request identities per view (D-042): sent on every redirect hop, never taken from user input.
 * `google_referer` is a mobile browser arriving from Google search — Thai gambling hacks redirect those
 * visitors without looking at the User-Agent.
 */
export const CRAWLER_CLIENTS: Record<CrawlerView, { userAgent: string; referer?: string }> = {
  googlebot: { userAgent: 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)' },
  google_referer: {
    userAgent:
      'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36',
    referer: 'https://www.google.com/',
  },
};

/** How a cause names the view (spec §13 style: lower case inside the brackets). */
export const CRAWLER_LABELS: Record<CrawlerView, string> = {
  googlebot: 'as Googlebot',
  google_referer: 'from Google search',
};

/** How long a usable crawler result counts: two 30-min runs plus slack (D-042). */
export const CRAWLER_FRESH_MS = 65 * 60_000;
