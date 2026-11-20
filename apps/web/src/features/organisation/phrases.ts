import {
  cleanPhrase,
  FORBIDDEN_GROUP_IDS,
  FORBIDDEN_GROUP_LABELS,
  formatDay,
  formatTime,
  MAX_PHRASE_LENGTH,
  normalizeForMatch,
  type ForbiddenGroup,
  type PhraseRefusal,
} from '@dxt/shared';

/** One shared forbidden phrase (S17 PR 3c, D-069). */
export interface Phrase {
  id: string;
  group: ForbiddenGroup;
  phrase: string;
}

export interface PhraseGroup {
  id: ForbiddenGroup;
  label: string;
  /** "13 phrases" */
  count: string;
  phrases: { id: string; phrase: string; lang: 'th' | 'en' }[];
}

export { MAX_PHRASE_LENGTH };

/** The most phrases the list holds (add_forbidden_phrase's cap, D-069). */
export const MAX_PHRASES = 300;

export const GROUP_OPTIONS = FORBIDDEN_GROUP_IDS.map((id) => ({
  value: id,
  label: FORBIDDEN_GROUP_LABELS[id],
}));

const THAI = /[฀-๿]/u;
/** Each chip carries lang="th" or "en" (spec §41). */
export const phraseLang = (p: string): 'th' | 'en' => (THAI.test(p) ? 'th' : 'en');

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;

/** The board's groups, in its order, each with its phrases as they grew. */
export function phraseGroups(phrases: readonly Phrase[]): PhraseGroup[] {
  return FORBIDDEN_GROUP_IDS.map((id) => {
    const mine = phrases.filter((p) => p.group === id);
    return {
      id,
      label: FORBIDDEN_GROUP_LABELS[id],
      count: plural(mine.length, 'phrase'),
      phrases: mine.map((p) => ({ id: p.id, phrase: p.phrase, lang: phraseLang(p.phrase) })),
    };
  });
}

/** What a refusal before any check says, under the Phrase field (board OrganisationLists). */
export const REFUSAL_WORDS: Record<PhraseRefusal, string> = {
  empty: 'Type the phrase to check.',
  too_long: `Up to ${MAX_PHRASE_LENGTH} characters.`,
  markup: 'Use words only — no &, < or >.',
  short:
    'Use a phrase — a single short word is refused: “slot” would also match “time slot” on a booking page.',
  taken: 'Already in the list.',
};

/** What `check_forbidden_phrase` answers. */
export interface PhraseCheck {
  sites: number;
  checked: number;
  unchecked: string[];
  /** The sites it was found on (`hits` holds at most five). */
  found: number;
  hits: { site: string; view: string; checkedAt: string; snippet: string }[];
}

export interface Snippet {
  before: string;
  match: string;
  after: string;
}

const SNIPPET_SIDE = 60;

/**
 * The stored page is lower-case page source, not readable text (D-069): tags (and a tag cut at either
 * end) become spaces, runs of spaces one, and the match keeps up to 60 characters each side. Shown as
 * plain text, never as markup.
 */
export function snippetOf(raw: string, phrase: string): Snippet {
  const needle = normalizeForMatch(cleanPhrase(phrase));
  const clean = (lead: boolean) =>
    // A tag cut at the start ends in '>' after attribute text (quotes or '='); plain text with a '>' isn't one.
    (lead ? raw.replace(/^[^<>]*["'=][^<>]*>/u, ' ') : raw)
      .replace(/<[^>]*$/u, ' ')
      .replace(/<[^>]*>/gu, ' ')
      .replace(/\s+/gu, ' ');
  const stripped = clean(true);
  const text = stripped.includes(needle) ? stripped : clean(false);
  const at = text.indexOf(needle);
  if (at < 0) return { before: '', match: needle, after: '' };
  const before = text.slice(Math.max(0, at - SNIPPET_SIDE), at);
  const after = text.slice(at + needle.length, at + needle.length + SNIPPET_SIDE);
  return {
    before: `${at > SNIPPET_SIDE ? '… ' : ''}${before.trimStart()}`,
    match: text.slice(at, at + needle.length),
    after: `${after.trimEnd()}${at + needle.length + SNIPPET_SIDE < text.length ? ' …' : ''}`,
  };
}

const when = (iso: string) => {
  const d = new Date(iso);
  return `${formatDay(d, { weekday: true })} ${formatTime(d)}`;
};

/**
 * `clear`: checked on every live site. `partial`: not found, but some sites (or all) had no clean page to
 * check — it can still be added, said in the warning tone (spec-checker; D-069 settles the words).
 */
export type CheckWords =
  | { kind: 'found'; title: string; snippet: Snippet; line: string }
  | { kind: 'clear' | 'partial'; title: string; lines: string[] };

/** The Add dialog's footer line for each state (board OrganisationLists). */
export function checkFoot(words: CheckWords | null): string {
  if (!words) return 'Checked against every live site before it’s saved.';
  if (words.kind === 'found') return 'Not saved — change the phrase and check again.';
  return words.kind === 'clear'
    ? 'Checked · ready to add'
    : 'Not checked against every site — it can still be added';
}

/** The Add dialog's box after "Check phrase" (board OrganisationLists, D-069: counts what was checked). */
export function checkWords(check: PhraseCheck, phrase: string): CheckWords {
  const hit = check.hits[0];
  if (hit) {
    return {
      kind: 'found',
      title: `Found on ${hit.site}’s home page${
        check.found > 1 ? ` and ${plural(check.found - 1, 'more site')}` : ''
      } — this would open a PROBLEM on a healthy site`,
      snippet: snippetOf(hit.snippet, phrase),
      line: `Last clean fetch of ${plural(check.checked, 'site')} · ${hit.site}, ${when(hit.checkedAt)}. Make the phrase longer so it only matches spam.`,
    };
  }
  const next =
    'Every site is checked for it from the next round (about 1–5 min); the Googlebot and Google-search views from the next crawler run (within 30 min). A site that has it then opens PROBLEM · Keyword.';
  if (check.checked === 0) {
    return {
      kind: 'partial',
      title: 'No site has a clean fetch yet — nothing was checked',
      lines: [next],
    };
  }
  const title =
    check.checked === check.sites
      ? `Not found on ${check.sites === 1 ? 'the site’s' : `any of the ${check.sites} sites’`} last clean fetch`
      : `Not found on the ${check.checked} of ${plural(check.sites, 'site')} with a clean fetch`;
  return {
    kind: check.checked === check.sites ? 'clear' : 'partial',
    title,
    lines: [
      ...(check.unchecked.length ? [`Not checked (no clean fetch yet): ${namesOf(check.unchecked)}.`] : []),
      next,
    ],
  };
}

const NAMES_SHOWN = 10;
/** At most 10 names, then "and N more" — the list grows with the sites (spec-checker). */
function namesOf(names: readonly string[]): string {
  if (names.length <= NAMES_SHOWN) return names.join(', ');
  return `${names.slice(0, NAMES_SHOWN).join(', ')} and ${names.length - NAMES_SHOWN} more`;
}

/** The Remove dialog (spec §41 item 6; D-069: an open incident recovers, a short unacked one resolves). */
export function removeWords(group: ForbiddenGroup) {
  return {
    description: `From ${FORBIDDEN_GROUP_LABELS[group]} · sites stop being checked for it from the next round.`,
    body: 'The Googlebot and Google-search views stop at the next crawler run (within 30 min). An incident it opened recovers once no check finds it and stays open until it’s resolved — a short, unacknowledged one resolves itself.',
  };
}

/** "Checking 17 sites’ last clean fetch…" (board), one site in the singular. */
export const checkingLine = (sites: number) =>
  `Checking ${sites === 1 ? 'the site’s' : `${sites} sites’`} last clean fetch…`;

/** The result line under the heading after a change. */
export const addedLine = (phrase: string, group: ForbiddenGroup) =>
  `Added “${phrase}” to ${FORBIDDEN_GROUP_LABELS[group]} · logged · sites are checked for it from the next round`;
export const removedLine = (phrase: string, group: ForbiddenGroup) =>
  `Removed “${phrase}” from ${FORBIDDEN_GROUP_LABELS[group]} · logged`;
