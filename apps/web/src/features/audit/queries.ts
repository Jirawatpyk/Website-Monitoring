import 'server-only';
import { formatIncidentId, formatWeek } from '@dxt/shared';
import type { DbClient } from '@dxt/db';
import { fetchAllPages } from '@/lib/csv';
import {
  DEFAULT_RANGE,
  PAGE_LIMIT,
  atLabel,
  categoryFilter,
  categoryOf,
  entityFallback,
  isNarrowed,
  rangeStart,
  sidesOf,
  wordsOf,
  type AuditCategory,
  type AuditFilters,
  type Json,
} from './model';

/** One row of the table and of the CSV (board AuditLog). */
export interface AuditEntry {
  id: string;
  at: string;
  atLabel: string;
  /** "System" for the engine and the notifier (no actor). */
  actor: string;
  action: string;
  words: string;
  category: Exclude<AuditCategory, 'All'> | null;
  entity: string;
  before: string;
  after: string;
  struck: boolean;
  /** The stored values, for the CSV. */
  beforeJson: Json | null;
  afterJson: Json | null;
}

export interface AuditPage {
  nowIso: string;
  filters: AuditFilters;
  entries: AuditEntry[];
  /** Entries matching the filters (the page lists at most PAGE_LIMIT of them). */
  total: number;
  /** Entries in the default view (Last 7 days, everyone, all categories): the "filtered from N". */
  unfiltered: number;
  actors: { value: string; label: string }[];
}

interface Raw {
  id: string;
  at: string;
  actor_id: string | null;
  action: string;
  entity: string;
  entity_id: string | null;
  before: Json | null;
  after: Json | null;
}

const COLUMNS = 'id, at, actor_id, action, entity, entity_id, before, after';
/** Ids per `in.(…)` filter, so a query string stays short. */
const ID_CHUNK = 100;

const check = <T extends { error: { message: string } | null }>(name: string, r: T): T => {
  if (r.error) throw new Error(`${name}: ${r.error.message}`);
  return r;
};

/**
 * The audit_log query for these filters, newest first (`id` breaks ties). It stops at `now`, so
 * rows the engine appends while an export pages through can't shift the offsets and repeat a row
 * at a page seam (spec-checker H2).
 */
function filtered(db: DbClient, f: AuditFilters, now: Date, count: boolean) {
  let q = db
    .from('audit_log')
    .select(COLUMNS, count ? { count: 'exact' } : undefined)
    .lte('at', now.toISOString())
    .order('at', { ascending: false })
    .order('id', { ascending: false });
  const start = rangeStart(f.range, now);
  if (start) q = q.gte('at', start.toISOString());
  const cat = categoryFilter(f.cat);
  if (cat) q = q.or(cat);
  if (f.actor === 'system') q = q.is('actor_id', null);
  else if (f.actor !== 'everyone') q = q.eq('actor_id', f.actor);
  if (f.entity) q = q.eq('entity', f.entity);
  return q;
}

/** `/audit`: the newest PAGE_LIMIT matching entries with their names, read as the signed-in Admin. */
export async function loadAuditPage(db: DbClient, f: AuditFilters, now = new Date()): Promise<AuditPage> {
  // "Filtered from N" — only when something narrows the rows — counts every entry in the wider of
  // the chosen range and the default (Today against the week, as the board does).
  const countBase = () => {
    const baseStart = rangeStart(f.range === 'Today' ? DEFAULT_RANGE : f.range, now);
    const base = db
      .from('audit_log')
      .select('id', { count: 'exact', head: true })
      .lte('at', now.toISOString());
    return baseStart ? base.gte('at', baseStart.toISOString()) : base;
  };
  const [page, baseCount, people] = await Promise.all([
    filtered(db, f, now, true).limit(PAGE_LIMIT),
    isNarrowed(f) ? countBase() : null,
    loadPeople(db),
  ]);
  const rows = (check('audit_log', page).data ?? []) as Raw[];
  // The page shows words only; the stored JSON stays on the server for the CSV (spec-checker M5).
  const entries = (await entriesOf(db, rows, people, now)).map((e) => ({
    ...e,
    beforeJson: null,
    afterJson: null,
  }));
  return {
    nowIso: now.toISOString(),
    filters: f,
    entries,
    total: page.count ?? rows.length,
    unfiltered: baseCount ? (check('audit_log count', baseCount).count ?? 0) : (page.count ?? rows.length),
    actors: [
      { value: 'everyone', label: 'Everyone' },
      { value: 'system', label: 'System' },
      ...[...people.entries()]
        .sort((a, b) => a[1].localeCompare(b[1]))
        .map(([value, label]) => ({ value, label })),
    ],
  };
}

/** Every matching entry for the CSV, 1,000 a request (`max_rows`), no cap (D-061 item 2). */
export async function loadAuditExport(
  db: DbClient,
  f: AuditFilters,
  now = new Date(),
): Promise<AuditEntry[]> {
  const [people, rows] = await Promise.all([
    loadPeople(db),
    fetchAllPages<Raw>(
      (from, to) =>
        filtered(db, f, now, false).range(from, to) as PromiseLike<{
          data: Raw[] | null;
          error: { message: string } | null;
        }>,
      { max: Number.MAX_SAFE_INTEGER },
    ),
  ]);
  return entriesOf(db, rows, people, now);
}

async function loadPeople(db: DbClient): Promise<Map<string, string>> {
  const r = check('profiles', await db.from('profiles').select('id, display_name'));
  return new Map((r.data ?? []).map((p) => [p.id, p.display_name]));
}

async function entriesOf(
  db: DbClient,
  rows: Raw[],
  people: Map<string, string>,
  now: Date,
): Promise<AuditEntry[]> {
  const labels = await entityLabels(db, rows);
  const names = { people };
  return rows.map((r) => {
    const sides = sidesOf(r.action, r.before, r.after, names);
    return {
      id: r.id,
      at: r.at,
      atLabel: atLabel(new Date(r.at), now),
      actor: r.actor_id ? (people.get(r.actor_id) ?? 'Former user') : 'System',
      action: r.action,
      words: wordsOf(r.action),
      category: categoryOf(r.action),
      entity:
        (r.entity_id && labels.get(`${r.entity}:${r.entity_id}`)) ||
        // A person (Access rows) is named by their profile.
        (r.entity === 'user' && r.entity_id && people.get(r.entity_id)) ||
        // A window or series removed since still names its site from the entry itself.
        siteOfRow(r, labels) ||
        entityFallback(r.entity, r.before, r.after),
      before: sides.before,
      after: sides.after,
      struck: sides.struck,
      beforeJson: r.before,
      afterJson: r.after,
    };
  });
}

function siteOfRow(r: Raw, labels: Map<string, string>): string | undefined {
  if (r.entity !== 'maintenance_window' && r.entity !== 'maintenance_series') return undefined;
  for (const side of [r.after, r.before]) {
    if (side && typeof side === 'object' && !Array.isArray(side) && typeof side.site_id === 'string') {
      const name = labels.get(`site:${side.site_id}`);
      if (name) return name;
    }
  }
  return undefined;
}

function chunks<T>(xs: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

const siteName = (s: unknown) =>
  s && typeof s === 'object' && 'name' in s && typeof s.name === 'string' ? s.name : null;

function pathOf(url: string): string {
  try {
    return new URL(url).pathname || '/';
  } catch {
    return url;
  }
}

/**
 * Names for the Entity column, keyed `entity:id`: "INC-0142 · MuvMi", "Fuji Links · /", the site of a
 * window or a series, an on-call week. The small tables are read whole; the others by id, in chunks.
 * A row deleted since keeps its name from the entry itself (`entityFallback`).
 */
async function entityLabels(db: DbClient, rows: Raw[]): Promise<Map<string, string>> {
  const ids = (entity: string) => [
    ...new Set(rows.filter((r) => r.entity === entity && r.entity_id).map((r) => r.entity_id!)),
  ];
  const labels = new Map<string, string>();
  const put = (entity: string, id: string, label: string | null) => {
    if (label) labels.set(`${entity}:${id}`, label);
  };
  const byIds = async <R>(
    entity: string,
    load: (chunk: string[]) => PromiseLike<{ data: R[] | null; error: { message: string } | null }>,
    each: (r: R) => void,
  ) => {
    // The chunks side by side: a year's export names thousands of incidents (review).
    const results = await Promise.all(chunks(ids(entity), ID_CHUNK).map((chunk) => load(chunk)));
    for (const r of results) for (const row of check(entity, r).data ?? []) each(row);
  };
  const has = (entity: string) => rows.some((r) => r.entity === entity);

  await Promise.all([
    (has('site') || has('maintenance_window') || has('maintenance_series')) &&
      db
        .from('sites')
        .select('id, name')
        .then((r) => check('sites', r).data?.forEach((s) => put('site', s.id, s.name))),
    has('client') &&
      db
        .from('clients')
        .select('id, name')
        .then((r) => check('clients', r).data?.forEach((c) => put('client', c.id, c.name))),
    has('holiday') &&
      db
        .from('company_holidays')
        .select('id, name')
        .then((r) => check('company_holidays', r).data?.forEach((h) => put('holiday', h.id, h.name))),
    // page_baseline.* rows name their monitor (entity 'monitor').
    has('monitor') &&
      db
        .from('monitors')
        .select('id, url, site:sites(name)')
        .then((r) =>
          check('monitors', r).data?.forEach((m) => {
            const site = siteName(m.site);
            put('monitor', m.id, site ? `${site} · ${pathOf(m.url)}` : pathOf(m.url));
          }),
        ),
    byIds(
      'incident',
      (c) => db.from('incidents').select('id, number, site:sites(name)').in('id', c),
      (i: { id: string; number: number; site: unknown }) => {
        const site = siteName(i.site);
        put('incident', i.id, `${formatIncidentId(i.number)}${site ? ` · ${site}` : ''}`);
      },
    ),
    byIds(
      'maintenance_window',
      (c) => db.from('maintenance_windows').select('id, site:sites(name)').in('id', c),
      (w: { id: string; site: unknown }) => put('maintenance_window', w.id, siteName(w.site)),
    ),
    byIds(
      'maintenance_series',
      (c) => db.from('maintenance_series').select('id, site:sites(name)').in('id', c),
      (s: { id: string; site: unknown }) => put('maintenance_series', s.id, siteName(s.site)),
    ),
    byIds(
      'oncall_shift',
      (c) => db.from('oncall_shifts').select('id, starts_at, ends_at').in('id', c),
      (s: { id: string; starts_at: string; ends_at: string }) =>
        put(
          'oncall_shift',
          s.id,
          `Week ${formatWeek({ start: new Date(s.starts_at), end: new Date(s.ends_at) })}`,
        ),
    ),
    byIds(
      'oncall_swap',
      (c) =>
        db
          .from('oncall_swaps')
          .select('id, rq:oncall_shifts!oncall_swaps_requester_shift_id_fkey(starts_at, ends_at)')
          .in('id', c),
      (s: { id: string; rq: { starts_at: string; ends_at: string } | null }) =>
        put(
          'oncall_swap',
          s.id,
          s.rq
            ? `Swap · week ${formatWeek({ start: new Date(s.rq.starts_at), end: new Date(s.rq.ends_at) })}`
            : null,
        ),
    ),
  ]);
  return labels;
}
