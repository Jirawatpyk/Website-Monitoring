import { FORBIDDEN_GROUP_LABELS } from '@dxt/shared';
import {
  ESCALATION_CHANNEL_LABELS,
  ESCALATION_TARGET_LABELS,
  INCIDENT_STATE_LABELS,
  ROOT_CAUSE_LABELS,
  TRIGGER_LABELS,
  bangkokDayStart,
  formatResponseHours,
  timeToMinutes,
  formatDay,
  formatTime,
  formatTimeWithSeconds,
  isSameBangkokDay,
} from '@dxt/shared';

/**
 * The Audit log page's rules (board AuditLog, spec §16.11, D-061): categories, the words for each
 * action code, the When ranges and the Before → After summaries. Pure, so the page, the CSV export
 * and the tests share them.
 */

export const AUDIT_CATEGORIES = [
  'All',
  'Incidents',
  'Monitor',
  'Config',
  'Maintenance & mute',
  'On-call',
  'Access',
] as const;
export type AuditCategory = (typeof AUDIT_CATEGORIES)[number];

export const AUDIT_RANGES = ['Today', 'Last 7 days', 'Last 30 days', 'All time'] as const;
export type AuditRange = (typeof AUDIT_RANGES)[number];
export const DEFAULT_RANGE: AuditRange = 'Last 7 days';

/** The newest entries the page lists; the CSV export has no cap (D-061). */
export const PAGE_LIMIT = 500;

/** The filters, as the URL carries them (`?cat=incidents&actor=system&when=30d`). */
export interface AuditFilters {
  cat: AuditCategory;
  /** 'everyone', 'system' (the engine and the notifier: no actor) or a profile id. */
  actor: string;
  range: AuditRange;
  /** One entity only (a key of ENTITY_FILTERS), from a link. */
  entity?: string;
}

const CAT_SLUGS: Record<string, AuditCategory> = {
  incidents: 'Incidents',
  monitor: 'Monitor',
  config: 'Config',
  maintenance: 'Maintenance & mute',
  oncall: 'On-call',
  access: 'Access',
};
const RANGE_SLUGS: Record<string, AuditRange> = {
  today: 'Today',
  '7d': 'Last 7 days',
  '30d': 'Last 30 days',
  all: 'All time',
};
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Params = Record<string, string | string[] | undefined> | URLSearchParams;

function param(p: Params, key: string): string | undefined {
  if (p instanceof URLSearchParams) return p.get(key) ?? undefined;
  const v = p[key];
  return Array.isArray(v) ? v[0] : v;
}

/** Reads the filters from the URL; anything unknown falls back to the default (never an error). */
/** Own keys only: `?cat=constructor` must not reach Object.prototype (security review). */
const lookup = <T>(map: Record<string, T>, key: string | undefined): T | undefined =>
  key !== undefined && Object.hasOwn(map, key) ? map[key] : undefined;

/**
 * The one-entity filter a link can set (`?entity=escalation`: Escalation's "Change history"), with
 * the words its chip shows. Not a control of its own: Clear filters removes it.
 */
export const ENTITY_FILTERS: Record<string, string> = {
  escalation: 'Escalation policies',
};

export function parseFilters(p: Params): AuditFilters {
  const actor = param(p, 'actor');
  const entity = param(p, 'entity');
  return {
    cat: lookup(CAT_SLUGS, param(p, 'cat')) ?? 'All',
    actor: actor === 'system' || (actor && UUID_RE.test(actor)) ? actor : 'everyone',
    range: lookup(RANGE_SLUGS, param(p, 'when')) ?? DEFAULT_RANGE,
    ...(lookup(ENTITY_FILTERS, entity) ? { entity } : {}),
  };
}

/** The filters back to a query string; defaults are left out. */
export function filtersQuery(f: AuditFilters): string {
  const q = new URLSearchParams();
  const cat = Object.entries(CAT_SLUGS).find(([, v]) => v === f.cat)?.[0];
  if (cat) q.set('cat', cat);
  if (f.actor !== 'everyone') q.set('actor', f.actor);
  const when = Object.entries(RANGE_SLUGS).find(([, v]) => v === f.range)?.[0];
  if (when && f.range !== DEFAULT_RANGE) q.set('when', when);
  if (f.entity) q.set('entity', f.entity);
  return q.toString();
}

export function isFiltered(f: AuditFilters): boolean {
  return f.cat !== 'All' || f.actor !== 'everyone' || f.range !== DEFAULT_RANGE || !!f.entity;
}

/**
 * Whether the rows are narrowed inside their range, so "filtered from N" says something: a
 * category, a person, an entity, or Today (counted against the week). A longer range alone isn't.
 */
export function isNarrowed(f: AuditFilters): boolean {
  return hasRowFilters(f) || f.range === 'Today';
}

/**
 * Whether a category, a person or an entity hides rows: an empty list then "matches no filters".
 * A range alone — Today too — is a quiet time: "Nothing logged today" (code review, 13 Nov).
 */
export function hasRowFilters(f: AuditFilters): boolean {
  return f.cat !== 'All' || f.actor !== 'everyone' || !!f.entity;
}

export const NO_FILTERS: AuditFilters = { cat: 'All', actor: 'everyone', range: DEFAULT_RANGE };

/**
 * Words for every action code the database writes (D-061: the codes stay as written). A code that
 * isn't here shows as the code itself. `model.test.ts` fails when a migration adds one.
 */
export const ACTION_WORDS: Record<string, string> = {
  // Incidents
  'incident.opened': 'Incident opened',
  'incident.severity': 'Became DOWN',
  'incident.ack': 'Acknowledged',
  'incident.ack_undone': 'Undid acknowledge',
  'incident.alerted': 'First alert after mute',
  'incident.escalated': 'Escalated',
  'incident.escalate_now': 'Escalated by hand',
  'incident.step_sent': 'Escalation step sent',
  'incident.hand_down': 'Reported down by hand',
  'incident.recovered': 'Recovered',
  'incident.relapsed': 'Down again',
  'incident.new_cause': 'New cause',
  'incident.cause_back': 'Back to expiry',
  'incident.state': 'Changed state',
  'incident.note': 'Added note',
  'incident.root_cause': 'Wrote root cause',
  'incident.client_update_due': 'Client update due',
  'incident.client_update': 'Marked client update',
  'incident.resolved': 'Resolved',
  'incident.resolve_undone': 'Undid resolve',
  // Monitor
  'system_alert.opened': 'Monitor fault',
  'system_alert.cleared': 'Monitor fault cleared',
  'site.hand_check': 'Checked by hand',
  // Config
  'site.create': 'Added site',
  'site.update': 'Changed site',
  'site.delete': 'Deleted site',
  'monitor.create': 'Added monitor',
  'monitor.update': 'Changed monitor',
  'monitor.delete': 'Removed monitor',
  'client.create': 'Added client',
  'client.update': 'Changed client',
  'client.delete': 'Deleted client',
  'holiday.create': 'Added holiday',
  'holiday.update': 'Changed holiday',
  'holiday.delete': 'Removed holiday',
  'forbidden_phrase.create': 'Added forbidden phrase',
  'forbidden_phrase.delete': 'Removed forbidden phrase',
  'escalation.update': 'Changed escalation',
  'organisation.response_hours': 'Changed response hours',
  'page_baseline.accept': 'Accepted page change',
  'page_baseline.undo': 'Undid page baseline',
  'page_baseline.auto': 'Page baseline set',
  // Maintenance & mute
  'maintenance.request': 'Asked for maintenance',
  'maintenance.create': 'Scheduled maintenance',
  'maintenance.approve': 'Approved maintenance',
  'maintenance.decline': 'Declined maintenance',
  'maintenance.withdraw': 'Withdrew request',
  'maintenance.edit': 'Changed maintenance end',
  'maintenance.cancel': 'Cancelled maintenance',
  'maintenance.start': 'Maintenance started',
  'maintenance.end': 'Maintenance ended',
  'maintenance.end_early': 'Ended maintenance early',
  'maintenance.undo': 'Undid maintenance change',
  'maintenance.series_create': 'Scheduled series',
  'maintenance.series_request': 'Asked for a series',
  'maintenance.series_approve': 'Approved series',
  'maintenance.series_decline': 'Declined series',
  'maintenance.series_withdraw': 'Withdrew series request',
  'maintenance.series_cancel': 'Cancelled series',
  'maintenance.series_not_approved': 'Series not approved in time',
  'maintenance.series_undo': 'Undid series change',
  'maintenance.occurrence_skip': 'Skipped occurrence',
  'site.mute': 'Muted site',
  'site.mute_end': 'Ended mute early',
  // On-call
  'oncall.rotation': 'Changed rotation',
  'oncall.handover': 'Handed over shift',
  'oncall.swap_request': 'Requested swap',
  'oncall.swap_accept': 'Accepted swap',
  'oncall.swap_decline': 'Declined swap',
  'oncall.swap_withdraw': 'Withdrew swap',
  'oncall.swap_approve': 'Approved swap',
  'oncall.swap_admin_decline': 'Declined swap (Admin)',
  'oncall.swap_expire': 'Swap expired',
  // Access (S16, D-062)
  'user.invite': 'Added to access list',
  'user.invite_revoke': 'Removed from access list',
  'user.reactivate': 'Gave access back',
  'user.role_change': 'Changed role',
  'user.deactivate': 'Deactivated',
  'profile.chat_id': 'Changed Chat id',
  'session.sign_out_all': 'Signed out everywhere',
  'session.sign_out_others': 'Signed out other devices',
  'session.sign_out_device': 'Signed out a device',
  'signin.refused': 'Refused sign-in',
};

export function wordsOf(action: string): string {
  return ACTION_WORDS[action] ?? action;
}

const MONITOR_ACTIONS = new Set(['site.hand_check']);
const MUTE_ACTIONS = new Set(['site.mute', 'site.mute_end']);
const CONFIG_PREFIXES = [
  'site.',
  'monitor.',
  'client.',
  'holiday.',
  'forbidden_phrase.',
  'escalation.',
  'organisation.',
  'page_baseline.',
];
const ACCESS_PREFIXES = ['user.', 'session.', 'signin.', 'security.', 'profile.'];

/** The category a code belongs to (D-061 item 3); null = shown under All only. */
export function categoryOf(action: string): Exclude<AuditCategory, 'All'> | null {
  if (action.startsWith('incident.')) return 'Incidents';
  if (action.startsWith('system_alert.') || MONITOR_ACTIONS.has(action)) return 'Monitor';
  if (action.startsWith('maintenance.') || MUTE_ACTIONS.has(action)) return 'Maintenance & mute';
  if (action.startsWith('oncall.')) return 'On-call';
  if (ACCESS_PREFIXES.some((p) => action.startsWith(p))) return 'Access';
  if (CONFIG_PREFIXES.some((p) => action.startsWith(p))) return 'Config';
  return null;
}

/**
 * The same rule as a PostgREST `or` filter on `action`, so the database filters before the limit.
 * `like` takes `*` as the wildcard; `_` in codes is a literal there only when escaped, so prefixes
 * are matched with `like` and the few exact codes with `in`.
 */
export function categoryFilter(cat: AuditCategory): string | null {
  const like = (p: string) => `action.like.${p.replaceAll('_', '\\_')}*`;
  const exact = (codes: Iterable<string>) => `action.in.(${[...codes].join(',')})`;
  switch (cat) {
    case 'All':
      return null;
    case 'Incidents':
      return like('incident.');
    case 'Monitor':
      return [like('system_alert.'), exact(MONITOR_ACTIONS)].join(',');
    case 'Maintenance & mute':
      return [like('maintenance.'), exact(MUTE_ACTIONS)].join(',');
    case 'On-call':
      return like('oncall.');
    case 'Access':
      return ACCESS_PREFIXES.map(like).join(',');
    case 'Config': {
      const notSite = CONFIG_PREFIXES.filter((p) => p !== 'site.').map(like);
      const site = `and(${like('site.')},action.not.in.(${[...MONITOR_ACTIONS, ...MUTE_ACTIONS].join(',')}))`;
      return [...notSite, site].join(',');
    }
  }
}

const DAY_MS = 86_400_000;

/** Where a range starts: Bangkok midnight today, or that many Bangkok days back; null = all time. */
export function rangeStart(range: AuditRange, now: Date): Date | null {
  const today = bangkokDayStart(now);
  switch (range) {
    case 'Today':
      return today;
    case 'Last 7 days':
      return new Date(today.getTime() - 7 * DAY_MS);
    case 'Last 30 days':
      return new Date(today.getTime() - 30 * DAY_MS);
    case 'All time':
      return null;
  }
}

/** The empty list when nothing narrows it: "Nothing logged in the last 7 days" (both widths). */
export function quietWords(range: AuditRange): string {
  if (range === 'Today') return 'Nothing logged today';
  if (range === 'All time') return 'Nothing logged yet';
  return `Nothing logged in the ${range.toLowerCase()}`;
}

/** The span after the count: "today", "Fri 18 Sep → Fri 25 Sep 10:07", "all time". */
export function spanLabel(range: AuditRange, now: Date): string {
  const start = rangeStart(range, now);
  if (range === 'Today') return 'today';
  if (!start) return 'all time';
  return `${formatDay(start, { weekday: true })} → ${formatDay(now, { weekday: true })} ${formatTime(now)}`;
}

/** The Time column: "10:03:41" today, "Thu 22:22" this week, "Fri 18 Sep 16:20" before that. */
export function atLabel(at: Date, now: Date): string {
  if (isSameBangkokDay(at, now)) return formatTimeWithSeconds(at);
  const weekday = formatDay(at, { weekday: true });
  if (now.getTime() - at.getTime() < 6 * DAY_MS) return `${weekday.split(' ')[0]} ${formatTime(at)}`;
  // All time reaches back years: an entry from another Bangkok year says which.
  const otherYear = formatDay(at, { year: true }).slice(-4) !== formatDay(now, { year: true }).slice(-4);
  return `${formatDay(at, { weekday: true, year: otherYear })} ${formatTime(at)}`;
}

/** The entry sheet's date (MAuditLog, §33.7): "Fri 25 Sep 2026 09:20:14 (UTC+7)". */
export function fullAtLabel(at: Date): string {
  return `${formatDay(at, { weekday: true, year: true })} ${formatTimeWithSeconds(at)} (UTC+7)`;
}

// ── Before → After ─────────────────────────────────────────────────────────────────────────────

export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

/** What the summaries need to turn ids into names. */
export interface Names {
  people: ReadonlyMap<string, string>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** Keys that carry no meaning for a reader (ids, bookkeeping) — never shown. */
const HIDDEN = new Set([
  'id',
  'created_at',
  'updated_at',
  'window_id',
  'check_id',
  'event',
  'hand_check_id',
  'shift',
  'log_length',
  'site_id',
  'series_id',
  'client_id',
  'monitor_id',
  'applies_at',
  'with_resolve',
]);
/** Free text that is shown quoted, last (spec §23.11: "each with the reason"). */
const TEXT_KEYS = ['reason', 'note', 'text', 'mute_reason', 'end_reason'];
/** Keys whose value is shown alone, without the key: "Unacked → Acknowledged". */
const BARE_KEYS = new Set(['state', 'status', 'severity', 'trigger']);

const KEY_WORDS: Record<string, string> = {
  escalation_level: 'level',
  l0_user_id: 'L0',
  primary_owner_id: 'owner',
  backup_owner_id: 'backup',
  am_user_id: 'AM',
  approved_by: 'approved by',
  ended_by: 'ended by',
  user: 'person',
  with: 'with',
  counterpart: 'with',
  until_on: 'ends on',
  starts_on: 'from',
  start_time: 'at',
  duration_min: 'minutes',
  occurrences_cancelled: 'cancelled',
  notified: 'told',
  fix: 'what fixed it',
  what: 'what happened',
  thresholds_slowMs: 'slow threshold',
  timeout_ms: 'timeout',
  expected_status: 'expected status',
  must_contain: 'must contain',
  must_not_contain: 'must not contain',
};

function keyWord(key: string): string {
  return KEY_WORDS[key] ?? key.replace(/_at$/, '').replace(/_id$/, '').replaceAll('_', ' ');
}

const SEVERITY_WORDS: Record<string, string> = { down: 'DOWN', problem: 'PROBLEM' };

function enumWord(key: string, value: string): string {
  if (key === 'severity' || key === 'episode') return SEVERITY_WORDS[value] ?? value;
  if (key === 'trigger') return (TRIGGER_LABELS as Record<string, string>)[value] ?? value;
  if (key === 'category') return (ROOT_CAUSE_LABELS as Record<string, string>)[value] ?? value;
  if (key === 'state') {
    const s = (INCIDENT_STATE_LABELS as Record<string, string>)[value];
    if (s) return s;
  }
  return value.replaceAll('_', ' ');
}

/** One value as words, or null when there is nothing worth showing (an id nobody can read). */
function valueWords(key: string, value: Json, names: Names): string | null {
  if (value === null) return 'none';
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  // Milliseconds as seconds, as the pages show them (§13): "slow threshold 3 s".
  if (typeof value === 'number') return /(Ms|_ms)$/.test(key) ? `${value / 1000} s` : String(value);
  if (typeof value === 'string') {
    if (UUID.test(value)) return names.people.get(value) ?? null;
    if (TIMESTAMP.test(value)) {
      const d = new Date(value);
      return Number.isNaN(d.getTime()) ? value : `${formatDay(d, { weekday: true })} ${formatTime(d)}`;
    }
    if (DATE_ONLY.test(value)) return formatDay(new Date(`${value}T00:00:00+07:00`), { weekday: true });
    return BARE_KEYS.has(key) ||
      key === 'category' ||
      key === 'episode' ||
      key === 'outcome' ||
      key === 'kind'
      ? enumWord(key, value)
      : value;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return 'none';
    if (value.every((v) => typeof v === 'string' && UUID.test(v))) {
      const known = value.map((v) => names.people.get(v as string)).filter((n): n is string => !!n);
      return known.length === value.length ? known.join(', ') : `${value.length}`;
    }
    if (value.every((v) => typeof v === 'string' || typeof v === 'number')) return value.join(', ');
    return `${value.length}`;
  }
  if ('freq' in value) return ruleWords(value);
  if ('location' in value && typeof value.location === 'string') return value.location;
  return null;
}

const WEEKDAY_WORDS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** A series rule: "weekly Mon, Thu", "monthly day 15", "monthly 2nd Tue". */
function ruleWords(rule: { [key: string]: Json }): string {
  if (rule.freq === 'weekly' && Array.isArray(rule.days)) {
    return `weekly ${rule.days.map((d) => WEEKDAY_WORDS[Number(d) % 7] ?? String(d)).join(', ')}`;
  }
  if (rule.freq === 'monthly') {
    if (typeof rule.day === 'number') return `monthly day ${rule.day}`;
    if (typeof rule.nth === 'number' && typeof rule.weekday === 'number') {
      const nth = ['', '1st', '2nd', '3rd', '4th'][rule.nth] ?? `${rule.nth}th`;
      return `monthly ${nth} ${WEEKDAY_WORDS[rule.weekday % 7] ?? rule.weekday}`;
    }
  }
  return String(rule.freq ?? 'rule');
}

function isObject(v: Json | null | undefined): v is { [key: string]: Json } {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** A page fingerprint, as the scripts it loads ("scripts evil-cdn.example") or its title. */
function fingerprintWords(f: Json): string | null {
  if (!isObject(f)) return null;
  const scripts = Array.isArray(f.scripts) ? f.scripts.filter((s): s is string => typeof s === 'string') : [];
  return scripts.length
    ? `scripts ${scripts.join(', ')}`
    : typeof f.title === 'string'
      ? `title “${f.title}”`
      : null;
}

/** Shows one side: "key value · key value · “reason”". `only` limits it to changed keys. */
function sideWords(side: { [key: string]: Json }, names: Names, only?: ReadonlySet<string>): string {
  const parts: string[] = [];
  const texts: string[] = [];
  for (const [key, value] of Object.entries(side)) {
    if (HIDDEN.has(key) || (only && !only.has(key))) continue;
    if (TEXT_KEYS.includes(key)) {
      if (typeof value === 'string' && value.trim()) texts.push(`“${value.trim()}”`);
      continue;
    }
    if (key === 'fingerprint') {
      const w = fingerprintWords(value);
      if (w) parts.push(w);
      continue;
    }
    if (key === 'policies' && Array.isArray(value)) {
      parts.push(`${value.length} ${value.length === 1 ? 'policy' : 'policies'}`);
      continue;
    }
    if ((key === 'windows' || key === 'occurrences_cancelled') && Array.isArray(value)) {
      const n = `${value.length} ${value.length === 1 ? 'window' : 'windows'}`;
      parts.push(key === 'windows' ? n : `${n} cancelled`);
      continue;
    }
    const words = valueWords(key, value, names);
    if (words === null) continue;
    parts.push(BARE_KEYS.has(key) ? words : `${keyWord(key)} ${words}`);
  }
  return [...parts, ...texts].join(' · ');
}

type Side = { [key: string]: Json };

/** Keys that differ between the two rows; an object on both sides is opened one level (`key_sub`). */
function flattenChanged(b: Side, a: Side): { before: Side; after: Side; changed: Set<string> } {
  const before: Side = {};
  const after: Side = {};
  const changed = new Set<string>();
  const same = (x: Json | undefined, y: Json | undefined) =>
    JSON.stringify(x ?? null) === JSON.stringify(y ?? null);
  for (const k of new Set([...Object.keys(b), ...Object.keys(a)])) {
    const bv = b[k];
    const av = a[k];
    if (same(bv, av)) continue;
    if (isObject(bv ?? null) && isObject(av ?? null) && k !== 'fingerprint') {
      const bo = bv as Side;
      const ao = av as Side;
      for (const sub of new Set([...Object.keys(bo), ...Object.keys(ao)])) {
        if (same(bo[sub], ao[sub])) continue;
        const key = `${k}_${sub}`;
        before[key] = bo[sub] ?? null;
        after[key] = ao[sub] ?? null;
        changed.add(key);
      }
      continue;
    }
    before[k] = bv ?? null;
    after[k] = av ?? null;
    changed.add(k);
  }
  return { before, after, changed };
}

// ── Escalation saves ───────────────────────────────────────────────────────────────────────────

interface Step {
  level: number;
  delayMin: number;
  targets: string[];
  channels: string[];
  fyi: boolean;
}

/** "DOWN · Tier 1", "PROBLEM · all tiers" (the Escalation page's policy names). */
function policyName(p: Side): string {
  const sev = String(p.severity ?? '').toUpperCase();
  return typeof p.tier === 'number' ? `${sev} · Tier ${p.tier}` : `${sev} · all tiers`;
}

function stepsOf(p: Side): Map<number, Step> {
  const steps = Array.isArray(p.steps) ? p.steps : [];
  return new Map(
    steps.filter(isObject).map((s) => [
      Number(s.level),
      {
        level: Number(s.level),
        delayMin: Number(s.delayMin ?? 0),
        targets: Array.isArray(s.targets) ? s.targets.map(String) : [],
        channels: Array.isArray(s.channels) ? s.channels.map(String) : [],
        fyi: s.fyi === true,
      },
    ]),
  );
}

const label = (map: Record<string, string>, v: string) => map[v] ?? v;

function stepWords(s: Step): string {
  const who = s.targets.map((t) => label(ESCALATION_TARGET_LABELS, t)).join(', ');
  const how = s.channels.map((c) => label(ESCALATION_CHANNEL_LABELS, c)).join(', ');
  return `${s.level === 0 ? 'at once' : `after ${s.delayMin} min`} · ${who} · ${how}${s.fyi ? ' · FYI' : ''}`;
}

/**
 * An `escalation.update` row holds every policy before and after the save: show only the steps and
 * reminders that changed, one per change — "DOWN · Tier 1 · L1 after 10 min" → "… after 15 min"
 * (board AuditLog's escalation row), then the note.
 */
export function escalationSides(b: Side, a: Side): AuditSides {
  const policies = (s: Side) =>
    new Map((Array.isArray(s.policies) ? s.policies.filter(isObject) : []).map((p) => [policyName(p), p]));
  const bp = policies(b);
  const ap = policies(a);
  const before: string[] = [];
  const after: string[] = [];
  for (const name of new Set([...bp.keys(), ...ap.keys()])) {
    const bs = bp.has(name) ? stepsOf(bp.get(name)!) : new Map<number, Step>();
    const as = ap.has(name) ? stepsOf(ap.get(name)!) : new Map<number, Step>();
    for (const level of [...new Set([...bs.keys(), ...as.keys()])].sort((x, y) => x - y)) {
      const o = bs.get(level);
      const n = as.get(level);
      const was = o ? stepWords(o) : null;
      const now = n ? stepWords(n) : null;
      if (was === now) continue;
      // Only the part that changed, when the step is still there on both sides.
      if (o && n) {
        const parts = (s: Step) => stepWords(s).split(' · ');
        const op = parts(o);
        const np = parts(n);
        // By content, not position: a part only one side has (FYI) still shows (spec-checker N1).
        before.push(`${name} · L${level} ${op.filter((p) => !np.includes(p)).join(' · ') || 'none'}`);
        after.push(`${name} · L${level} ${np.filter((p) => !op.includes(p)).join(' · ') || 'none'}`);
      } else if (o) {
        before.push(`${name} · L${level} ${was}`);
        after.push(`${name} · L${level} removed`);
      } else {
        before.push(`${name} · L${level} none`);
        after.push(`${name} · L${level} ${now}`);
      }
    }
  }
  for (const [key, words] of [
    ['downReminderMin', 'DOWN reminder'],
    ['problemReminderMin', 'PROBLEM reminder'],
  ] as const) {
    if (b[key] !== a[key]) {
      before.push(`${words} every ${b[key] ?? '—'} min`);
      after.push(`${words} every ${a[key] ?? '—'} min`);
    }
  }
  const note = typeof a.note === 'string' && a.note.trim() ? `“${a.note.trim()}”` : '';
  // One change from the next with "; " — " · " already separates the parts of a step (N1).
  const afterWords = [after.join('; '), note].filter(Boolean).join(' · ');
  return {
    before: before.join('; ') || '—',
    after: afterWords || 'no change',
    struck: before.length > 0,
  };
}

/** `organisation.response_hours` (S17, D-069): "Mon–Fri 09:00–18:00" → "Mon–Sat 08:30–17:30 · “note”". */
function hoursSides(b: Record<string, Json>, a: Record<string, Json>): AuditSides {
  const words = (h: Record<string, Json>) => {
    const days = Array.isArray(h.days) ? h.days.filter((d): d is number => typeof d === 'number') : [];
    const start = typeof h.start === 'string' ? h.start : '';
    const end = typeof h.end === 'string' ? h.end : '';
    return days.length && start && end
      ? formatResponseHours({ startMin: timeToMinutes(start), endMin: timeToMinutes(end), days })
      : '—';
  };
  const note = typeof a.note === 'string' && a.note.trim() ? ` · “${a.note.trim()}”` : '';
  return { before: words(b), after: `${words(a)}${note}`, struck: true };
}

export interface AuditSides {
  before: string;
  after: string;
  /** The board strikes through a real Before value, not the "—" of a new entry. */
  struck: boolean;
}

/**
 * Before → After as words. A row-change trigger row (`site.update`, …) holds the whole row on both
 * sides, so only the keys that changed are shown; every other row holds just what its action
 * changed. A create shows "—" before; a delete shows what was removed and "deleted".
 */
export function sidesOf(action: string, before: Json | null, after: Json | null, names: Names): AuditSides {
  let b = isObject(before) ? before : null;
  let a = isObject(after) ? after : null;
  let changed: Set<string> | undefined;
  if (action.endsWith('.update') && b && a && action !== 'escalation.update') {
    // A changed jsonb column (`monitors.thresholds`) shows the keys inside it that changed:
    // "slow threshold 3 s → slow threshold 5 s", never "—" → "—".
    const flat = flattenChanged(b, a);
    b = flat.before;
    a = flat.after;
    changed = flat.changed;
  }
  if (action === 'escalation.update' && b && a) return escalationSides(b, a);
  if (action === 'organisation.response_hours' && b && a) return hoursSides(b, a);
  // A monitor fault: the Entity names it already ("Probe location missing · TYO"), so the change is
  // its state — open, then cleared — with the last beat when known (/verify, 13 Nov).
  if (action === 'system_alert.opened' || action === 'system_alert.cleared') {
    const ctx = a && isObject(a.context) ? a.context : null;
    const beat =
      ctx && typeof ctx.lastBeatAt === 'string' ? valueWords('lastBeatAt', ctx.lastBeatAt, names) : null;
    return action === 'system_alert.opened'
      ? { before: '—', after: beat ? `open · last beat ${beat}` : 'open', struck: false }
      : { before: 'open', after: 'cleared', struck: true };
  }
  // An Undo stores the whole snapshot it restored; what it undid is the news.
  if (a && typeof a.undid === 'string') {
    const before = b && typeof b.action === 'string' ? enumWord('action', b.action) : '';
    return { before: before || '—', after: `undid ${enumWord('undid', a.undid)}`, struck: before !== '' };
  }
  // A new site / client / holiday by its name, a new monitor by its URL — not the whole row.
  const created = action.endsWith('.create') && a && nameOf(a) !== 'removed';
  const deleted = action.endsWith('.delete');
  const beforeWords = b ? (deleted ? nameOf(b) : sideWords(b, names, changed)) : '';
  const afterWords = deleted
    ? 'deleted'
    : created && a
      ? `added · ${nameOf(a)}`
      : a
        ? sideWords(a, names, changed)
        : '';
  return {
    before: beforeWords || '—',
    after: afterWords || '—',
    struck: beforeWords !== '',
  };
}

function nameOf(row: { [key: string]: Json }): string {
  for (const key of ['name', 'path', 'url', 'day', 'phrase']) {
    const v = row[key];
    if (typeof v === 'string' && v)
      return key === 'day' && DATE_ONLY.test(v) ? (valueWords(key, v, { people: new Map() }) ?? v) : v;
  }
  return 'removed';
}

// ── Entity ─────────────────────────────────────────────────────────────────────────────────────

export const SYSTEM_ALERT_WORDS: Record<string, string> = {
  verifier_unavailable: 'Browser verifier',
  verifier_backlog: 'Verifier backlog',
  probe_locations_low: 'Probe locations',
  bkk_control_failing: 'Bangkok control check',
  probe_location_missing: 'Probe location missing',
};

/** What an entity is called when nothing else names it ("Escalation policies", "On-call rotation"). */
const GROUP_LABELS: Record<string, string> = FORBIDDEN_GROUP_LABELS;

export function entityFallback(entity: string, before: Json | null, after: Json | null): string {
  const side = isObject(after) ? after : isObject(before) ? before : null;
  if (entity === 'system_alert' && side && typeof side.kind === 'string') {
    const kind = SYSTEM_ALERT_WORDS[side.kind] ?? side.kind.replaceAll('_', ' ');
    const ctx = side.context;
    return isObject(ctx) && typeof ctx.location === 'string' ? `${kind} · ${ctx.location}` : kind;
  }
  if (entity === 'escalation') return 'Escalation policies';
  if (entity === 'organisation') return 'Response hours';
  // S17 PR 3c: a phrase by its group (the phrase itself is in Before / After, not the Entity column).
  if (entity === 'forbidden_phrase') {
    const sides = [after, before].filter(isObject);
    const group = sides.map((s) => s.group).find((v) => typeof v === 'string');
    const label = typeof group === 'string' ? GROUP_LABELS[group] : undefined;
    return label ? `Forbidden words · ${label}` : 'Forbidden words';
  }
  if (entity === 'oncall_rotation') return 'On-call rotation';
  // An invite or a refused sign-in has no person yet: its address, or the domain (D-062 item 7).
  // A revoke keeps the address only on the before side, so both sides are read.
  if (entity === 'user' || entity === 'signin') {
    const sides = [after, before].filter(isObject);
    const email = sides.map((s) => s.email).find((v) => typeof v === 'string');
    if (typeof email === 'string') return email;
    const domain = sides.map((s) => s.domain).find((v) => typeof v === 'string');
    if (typeof domain === 'string') return `an address @${domain}`;
  }
  if (side) {
    const n = nameOf(side);
    if (n !== 'removed') return n;
  }
  return entity.replaceAll('_', ' ');
}
