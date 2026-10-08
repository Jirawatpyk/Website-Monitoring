import { isTlsChainError, type SiteStatus } from '@dxt/shared';
import type { LocationGlyph, SiteListRow } from '../types';

/**
 * The Sites list's rules (spec §20), kept pure so the desktop table and the phone list share them and
 * tests can drive them: the status a row shows, filters, "Needs attention", sorts, counts and the meta line.
 */

/** A row's place in the list: its real status, "pending" for a live site before its first round, or a draft. */
export type RowKey = SiteStatus | 'pending' | 'draft';

export const STATUS_FILTERS = ['all', 'down', 'problem', 'maintenance', 'ok', 'muted', 'draft'] as const;
export type StatusFilter = (typeof STATUS_FILTERS)[number];

export const SORTS = ['status', 'name', 'uptime', 'expiry'] as const;
export type SortKey = (typeof SORTS)[number];

/** The sort options, labels exactly as spec §20 names them. */
export const SORT_LABELS: Record<SortKey, string> = {
  status: 'Status',
  name: 'Name A–Z',
  uptime: 'Uptime 30d lowest first',
  expiry: 'Expiry soonest first',
};

/** "· sorted by …" under the filters (Sites board). */
export const SORT_WORDS: Record<SortKey, string> = {
  status: 'status (Down first), then tier',
  name: 'name A–Z',
  uptime: 'uptime 30d, lowest first',
  expiry: 'expiry, soonest first',
};

export interface SiteListFilters {
  q: string;
  status: StatusFilter;
  tier: 'all' | '1' | '2' | '3';
  /** A person's id, or "mine" = owner or backup is the viewer. */
  owner: string;
  /** A client's id, or "internal". */
  client: string;
  attention: boolean;
}

export const NO_FILTERS: SiteListFilters = {
  q: '',
  status: 'all',
  tier: 'all',
  owner: 'all',
  client: 'all',
  attention: false,
};

/** Expiry within this many days needs attention (spec §20; auto-renew certificates 30 d lands with S13). */
export const EXPIRY_SOON_DAYS = 60;

const RANK: Record<RowKey, number> = { down: 0, problem: 1, maintenance: 2, ok: 3, pending: 4, draft: 5 };

export function rowKey(r: SiteListRow): RowKey {
  if (!r.live) return 'draft';
  return r.status ?? 'pending';
}

export function isMuted(r: SiteListRow, now: Date): boolean {
  return !!r.mutedUntil && new Date(r.mutedUntil).getTime() > now.getTime();
}

/** Open incident · draft · SSL or domain due within 60 d · no backup owner (spec §20). */
export function needsAttention(r: SiteListRow): boolean {
  return (
    !!r.openIncident || !r.live || (r.expiryDays !== null && r.expiryDays < EXPIRY_SOON_DAYS) || !r.backup
  );
}

function matchesStatus(r: SiteListRow, f: StatusFilter, now: Date): boolean {
  if (f === 'all') return true;
  if (f === 'muted') return isMuted(r, now);
  return rowKey(r) === f;
}

export interface FilterContext {
  /** The signed-in person, for "Mine". */
  meId: string;
  now: Date;
}

/** Every filter at once (AND). `skip` leaves one out, to count what turning it on would show. */
export function matches(
  r: SiteListRow,
  f: SiteListFilters,
  ctx: FilterContext,
  skip?: keyof SiteListFilters,
): boolean {
  const q = f.q.trim().toLowerCase();
  if (
    skip !== 'q' &&
    q &&
    !`${r.name} ${r.client.internal ? 'Internal' : r.client.name} ${hostAndPath(r.url)}`
      .toLowerCase()
      .includes(q)
  )
    return false;
  if (skip !== 'status' && !matchesStatus(r, f.status, ctx.now)) return false;
  if (skip !== 'tier' && f.tier !== 'all' && String(r.tier) !== f.tier) return false;
  if (skip !== 'owner' && f.owner !== 'all') {
    if (f.owner === 'mine') {
      if (r.owner?.id !== ctx.meId && r.backup?.id !== ctx.meId) return false;
    } else if (r.owner?.id !== f.owner) return false;
  }
  if (skip !== 'client' && f.client !== 'all') {
    if (f.client === 'internal' ? !r.client.internal : r.client.id !== f.client) return false;
  }
  if (skip !== 'attention' && f.attention && !needsAttention(r)) return false;
  return true;
}

/** A URL as people search it: no scheme, no leading www ("https" would match every site). */
function hostAndPath(url: string | null): string {
  return (url ?? '').replace(/^https?:\/\//i, '').replace(/^www\./i, '');
}

export function filterSites(
  rows: readonly SiteListRow[],
  f: SiteListFilters,
  ctx: FilterContext,
): SiteListRow[] {
  return rows.filter((r) => matches(r, f, ctx));
}

function byDefault(a: SiteListRow, b: SiteListRow): number {
  return RANK[rowKey(a)] - RANK[rowKey(b)] || a.tier - b.tier || a.name.localeCompare(b.name);
}

/** Missing values (null) go after real ones. */
function nullsLast(a: number | null, b: number | null): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a - b;
}

const COMPARE: Record<SortKey, (a: SiteListRow, b: SiteListRow) => number> = {
  status: byDefault,
  name: (a, b) => a.name.localeCompare(b.name),
  uptime: (a, b) => nullsLast(a.uptime30d, b.uptime30d),
  expiry: (a, b) => nullsLast(a.expiryDays, b.expiryDays),
};

/** Drafts always last; ties fall back to the default order (spec §20). */
export function sortSites(rows: readonly SiteListRow[], sort: SortKey): SiteListRow[] {
  return [...rows].sort(
    (a, b) => Number(!a.live) - Number(!b.live) || COMPARE[sort](a, b) || byDefault(a, b),
  );
}

/** How many rows each status chip would show (the other filters aside, as on the boards). */
export function statusCounts(rows: readonly SiteListRow[], now: Date): Record<StatusFilter, number> {
  const out = Object.fromEntries(STATUS_FILTERS.map((s) => [s, 0])) as Record<StatusFilter, number>;
  for (const r of rows) for (const s of STATUS_FILTERS) if (matchesStatus(r, s, now)) out[s] += 1;
  return out;
}

/** "N sites · N monitored · N drafts" — drafts count as sites, never as monitored (spec §20). */
export function listMeta(rows: readonly SiteListRow[]): string {
  const live = rows.filter((r) => r.live).length;
  const drafts = rows.length - live;
  return `${rows.length} ${rows.length === 1 ? 'site' : 'sites'} · ${live} monitored · ${drafts} ${drafts === 1 ? 'draft' : 'drafts'}`;
}

/** One location's latest check as a glyph; a TLS chain error is never drawn as a hard fail (D-029). */
export function locationGlyph(
  check:
    { outcome: 'pass' | 'fail' | 'blocked'; error: string | null; responseMs: number | null } | undefined,
  slowMs: number,
): LocationGlyph {
  if (!check) return 'none';
  if (check.outcome === 'blocked') return 'blocked';
  if (check.outcome === 'fail') return isTlsChainError(check.error) ? 'chain' : 'fail';
  return check.responseMs !== null && check.responseMs > slowMs ? 'slow' : 'pass';
}
