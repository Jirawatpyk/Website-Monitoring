import type { Role } from '@dxt/shared';

/**
 * The User guide's rules (boards Guide, MGuide; spec §18; S18, D-070): which topics a role chip
 * shows, the chip a viewer opens on, search, and the words around the list. Pure, so the §18 matrix
 * is tested here.
 */

/** The role chips after "All" (spec §18). On-call is a duty, not an RBAC role. */
export const GUIDE_ROLES = ['Responder', 'On-call', 'Stakeholder', 'Viewer', 'Admin'] as const;
export type GuideRole = (typeof GUIDE_ROLES)[number];
export type Chip = 'All' | GuideRole;
export const CHIPS: readonly Chip[] = ['All', ...GUIDE_ROLES];

export const GUIDE_GROUPS = ['Getting started', 'Everyday', 'When things go wrong', 'Admin'] as const;
export type GuideGroup = (typeof GUIDE_GROUPS)[number];

/** Desktop shows the Admin topic whole; the phone splits it in two (spec §18, MGuide). */
export type GuideLayout = 'desktop' | 'phone';

/** The few fields the rules need from a topic (content.ts builds the rest). */
export interface TopicLike {
  id: string;
  group: GuideGroup;
  title: string;
  roles: readonly GuideRole[];
  /** Everything a search reads: title, summary, keywords and the body text. */
  text: string;
}

const ROLE_CHIP: Record<Role, GuideRole> = {
  admin: 'Admin',
  responder: 'Responder',
  stakeholder: 'Stakeholder',
  viewer: 'Viewer',
  // A client never reaches the guide (staff only); Viewer is the nearest set of topics.
  client: 'Viewer',
};

/**
 * The chip the guide opens on (spec §18): On-call while the viewer holds the live shift — the duty
 * wins, even for an Admin — otherwise their role (D-070: "this week" read as the shift live now).
 */
export function defaultChip(role: Role, onCallNow: boolean): GuideRole {
  return onCallNow ? 'On-call' : ROLE_CHIP[role];
}

const norm = (q: string) => q.trim().toLowerCase();

/** The topics a chip and a search show, in content order. */
export function visibleTopics<T extends TopicLike>(topics: readonly T[], chip: Chip, q: string): T[] {
  const needle = norm(q);
  return topics.filter(
    (t) => (chip === 'All' || t.roles.includes(chip)) && (!needle || t.text.toLowerCase().includes(needle)),
  );
}

/** The topics under their group headings, empty groups left out. */
export function groupTopics<T extends TopicLike>(topics: readonly T[]): { group: GuideGroup; topics: T[] }[] {
  return GUIDE_GROUPS.map((group) => ({ group, topics: topics.filter((t) => t.group === group) })).filter(
    (g) => g.topics.length > 0,
  );
}

/**
 * The open topic after the chip or search changes (the board's `refilter`): a search jumps to the
 * first topic whose title matches, and a topic that drops out of the list gives way to the first one
 * left. Null when nothing is left.
 */
export function nextSelection<T extends TopicLike>(
  topics: readonly T[],
  chip: Chip,
  q: string,
  current: string,
): string | null {
  const shown = visibleTopics(topics, chip, q);
  const needle = norm(q);
  const byTitle = needle ? shown.filter((t) => t.title.toLowerCase().includes(needle)) : [];
  if (byTitle.length && !byTitle.some((t) => t.id === current)) return byTitle[0]!.id;
  if (shown.some((t) => t.id === current)) return current;
  return shown[0]?.id ?? null;
}

/** "For Responder · On-call · Admin", or "Everyone" when every chip shows it. */
export function forText(roles: readonly GuideRole[]): string {
  return roles.length === GUIDE_ROLES.length
    ? 'Everyone'
    : GUIDE_ROLES.filter((r) => roles.includes(r)).join(' · ');
}

/** The desktop list's head: "11 topics", or "5 of 11 topics · Responder" once something narrows it. */
export function countLabel(shown: number, total: number, chip: Chip, mine: GuideRole, q: string): string {
  const filtered = !!norm(q) || (chip !== 'All' && chip !== mine);
  if (!filtered && shown === total) return `${total} topics`;
  return `${shown} of ${total} topics${chip !== 'All' ? ` · ${chip}` : ''}`;
}

const article = (r: GuideRole) => (r === 'Admin' || r === 'On-call' ? 'an' : 'a');

/** The phone list's line under the chips (MGuide), when it isn't "Showing topics for you". */
export function phoneCountLine(shown: number, total: number, chip: Chip, mine: GuideRole, q: string): string {
  const needle = q.trim();
  if (needle)
    return `${shown} ${shown === 1 ? 'result' : 'results'} for “${needle}”${chip !== 'All' ? ` · ${chip}` : ''}`;
  if (chip === 'All') return `${total} topics · you’re ${article(mine)} ${mine}`;
  return `${shown} topics for ${chip}`;
}

/** The empty state's title. */
export function emptyTitle(q: string, chip: Chip): string {
  const needle = q.trim();
  const forChip = chip !== 'All' ? ` for ${chip}` : '';
  return needle ? `No topics match “${needle}”${forChip}` : `No topics${forChip}`;
}

/** The words the empty state offers (Guide board). */
export const SEARCH_SUGGESTIONS = ['acknowledge', 'mute', 'root cause', '2-step'] as const;
