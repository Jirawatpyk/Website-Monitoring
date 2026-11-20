import { CLIENT_UPDATE_MIN } from '@dxt/engine';
import { formatPercent, formatResponseHours, TIER_CONFIG, timeToMinutes, type Tier } from '@dxt/shared';

/**
 * Settings › Organisation (board Organisation, spec §7, §14.14, D-069): the tier cards, the one
 * response-hours setting (Tier 2–3 timers and Tier 1's owner / on-call hand-over, D-048 item 10), the
 * save dialog's diff, the clients, what is kept and the budget. Pure, so the page and tests share it.
 */

/** The board's day choices, as ISO weekdays (1 = Monday). */
export const DAY_SETS = {
  'Mon–Fri': [1, 2, 3, 4, 5],
  'Mon–Sat': [1, 2, 3, 4, 5, 6],
  'Every day': [1, 2, 3, 4, 5, 6, 7],
} as const satisfies Record<string, readonly number[]>;
export type DaySet = keyof typeof DAY_SETS;
export const DAY_SET_LABELS = Object.keys(DAY_SETS) as DaySet[];

/** The board's From / To choices: 06:00–22:00 every 30 min (the SQL checks the same grid). */
export const TIME_OPTIONS: readonly string[] = Array.from({ length: (22 - 6) * 2 + 1 }, (_, i) => {
  const m = 6 * 60 + i * 30;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${m % 60 ? '30' : '00'}`;
});

export interface Hours {
  days: DaySet;
  from: string;
  to: string;
}

const toMin = timeToMinutes;

/** The saved days as one of the board's sets, or null for a set written by SQL before S17. */
export function daySetOf(days: readonly number[]): DaySet | null {
  const sorted = [...new Set(days)].sort((a, b) => a - b).join(',');
  return DAY_SET_LABELS.find((k) => DAY_SETS[k].join(',') === sorted) ?? null;
}

/** "Must be after From" under To while the hours are backwards (board). */
export function hoursError(h: Hours): string | null {
  return toMin(h.from) >= toMin(h.to) ? 'Must be after From' : null;
}

export function sameHours(a: Hours, b: Hours): boolean {
  return a.days === b.days && a.from === b.from && a.to === b.to;
}

/** How many of Days / From / To differ, for "N unsaved changes" (board). */
export function changedFields(a: Hours, b: Hours): number {
  return Number(a.days !== b.days) + Number(a.from !== b.from) + Number(a.to !== b.to);
}

/** "Mon–Fri 09:00–18:00", as every other page words the hours. */
export function hoursText(h: Hours): string {
  return formatResponseHours({ startMin: toMin(h.from), endMin: toMin(h.to), days: DAY_SETS[h.days] });
}

export interface OrgSite {
  name: string;
  tier: Tier;
}

export interface TierFact {
  k: string;
  v: string;
}

export interface TierCard {
  tier: Tier;
  count: number;
  names: string;
  facts: TierFact[];
}

const minutes = (sec: number) => `${Math.round(sec / 60)} min`;

/** What a tier means (spec §7, §9; TIER_CONFIG), its live sites and their names. */
export function tierCards(sites: readonly OrgSite[]): TierCard[] {
  return ([1, 2, 3] as const).map((tier) => {
    const mine = sites.filter((s) => s.tier === tier);
    const cfg = TIER_CONFIG[tier];
    return {
      tier,
      count: mine.length,
      names: mine.length ? mine.map((s) => s.name).join(', ') : 'No live sites',
      facts: [
        { k: 'Checked every', v: minutes(cfg.intervalSec) },
        { k: 'Covered', v: cfg.alwaysOn ? '24/7' : 'Response hours only' },
        {
          k: tier === 3 ? 'Client update' : 'Client update after',
          v:
            tier === 1
              ? `${CLIENT_UPDATE_MIN[1]} min down`
              : tier === 2
                ? `${CLIENT_UPDATE_MIN[2]} min down, in hours`
                : 'Report only',
        },
        { k: 'Uptime target', v: formatPercent(cfg.uptimeTarget) },
      ],
    };
  });
}

const sitesWord = (n: number) => `${n} ${n === 1 ? 'site' : 'sites'}`;

export interface HoursDiff {
  where: string;
  before: string;
  after: string;
  affects: string;
  covers: string;
}

/**
 * The save dialog's rows (board; D-069): the Tier 2–3 hours and, since the one setting also moves
 * Tier 1's hand-over to on-call (D-048 item 10), what that means for Tier 1. Counts are live sites.
 */
export function hoursDiff(
  saved: Hours,
  next: Hours,
  sites: readonly OrgSite[],
  /** The stored hours in words when they aren't one of the editor's choices (`storedOther`). */
  storedText: string | null = null,
): HoursDiff[] {
  if (sameHours(saved, next) && !storedText) return [];
  const before = storedText ?? hoursText(saved);
  const t1 = sites.filter((s) => s.tier === 1);
  const t2 = sites.filter((s) => s.tier === 2).length;
  const t3 = sites.filter((s) => s.tier === 3).length;
  const after = hoursText(next);
  return [
    {
      where: 'Tier 2–3 · response hours',
      before,
      after,
      affects: `Affects ${sitesWord(t2 + t3)} · ${t2} in Tier 2, ${t3} in Tier 3`,
      covers: `Outside ${after} DOWN still posts and escalation timers wait until ${next.from}; PROBLEM is held until ${next.from}. Tier 2–3 have no on-call.`,
    },
    {
      where: 'Tier 1 · owner hours',
      before,
      after,
      affects: t1.length
        ? `Affects ${sitesWord(t1.length)} · ${t1.map((s) => s.name).join(', ')}`
        : 'No live Tier 1 sites',
      covers: `Owners cover ${after}; the person on call covers the rest. The on-call week still changes over on Monday at 09:00.`,
    },
  ];
}

export interface OrgClient {
  name: string;
  internal: boolean;
  amName: string | null;
  language: 'en' | 'th';
  sites: readonly string[];
}

export interface ClientRow {
  name: string;
  sitesLine: string;
  count: number;
  am: string;
  language: string;
}

/** The Clients table (board, minus Monthly report and Status page until S20 / S21; D-069). */
export function clientRows(clients: readonly OrgClient[]): ClientRow[] {
  return [...clients]
    .sort((a, b) => Number(a.internal) - Number(b.internal) || a.name.localeCompare(b.name))
    .map((c) => ({
      name: c.name,
      sitesLine: !c.sites.length
        ? 'No sites yet'
        : c.sites.length === 1 && c.sites[0] === c.name
          ? '1 site'
          : c.sites.join(', '),
      count: c.sites.length,
      am: c.internal ? '—' : (c.amName ?? 'No AM'),
      language: c.internal ? '—' : c.language.toUpperCase(),
    }));
}

/**
 * What is kept and for how long — the real jobs (D-069): check_results partitions (90 d), the hourly
 * and daily roll-ups (`run_check_rollups`: 90 d / 2 y), crawler checks (30 d), verifier screenshots
 * (`/api/cron/housekeeping`, 30 d); incidents and the audit log have no retention job.
 */
export const RETENTION: readonly TierFact[] = [
  { k: 'Raw check results', v: '90 days' },
  { k: 'Hourly roll-ups', v: '90 days' },
  { k: 'Daily roll-ups', v: '2 years' },
  { k: 'Crawler checks, verifier screenshots', v: '30 days' },
  // S17 PR 3c (D-069): what "Check phrase" searches; replaced each run, pruned when a site stops.
  { k: 'Newest clean page per site', v: 'Replaced each crawler run' },
  { k: 'Incidents and the audit log', v: 'Kept' },
];

/** The database the Supabase Pro plan includes before extra disk is billed. */
export const DB_INCLUDED_BYTES = 8 * 1024 ** 3;

/** The storage card's figure: "1.4 GB", "8 GB", or "45 MB" under a gigabyte. */
export function gigabytes(bytes: number): string {
  const gb = bytes / 1024 ** 3;
  if (gb < 1) return `${Math.max(1, Math.round(bytes / 1024 ** 2))} MB`;
  return `${gb < 10 && !Number.isInteger(Math.round(gb * 10) / 10) ? gb.toFixed(1) : Math.round(gb)} GB`;
}

/**
 * The monthly cost, estimated: the cap the PRD records (§13, approved Mon 5 Oct 2026) and each provider's
 * share. Vercel is not free: the Pro seat plus usage, ~$40–65 a month from its bill of 31 Oct–19 Nov 2026
 * (D-069, Tao 19 Nov). No live bill is read; each provider's bill has the exact amount.
 */
export const BUDGET = {
  cap: '$60',
  approved: 'Mon 5 Oct',
  lines: [
    { k: 'Supabase · Micro compute', v: '~$10' },
    { k: 'Thai VPS · probe + verifier', v: '~$10–25' },
    { k: 'Twilio voice · off', v: '$0 (~$23–26 if turned on)' },
    { k: 'Vercel Pro · seat', v: '$20' },
    { k: 'Vercel usage · builds + functions', v: '~$40–65' },
    { k: 'Resend, Healthchecks.io', v: 'Free plans' },
  ],
} as const;
