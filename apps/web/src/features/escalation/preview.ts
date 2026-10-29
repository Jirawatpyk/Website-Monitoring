import { closingOf, firstReminderOf, isInsideHours, nextOpening, scheduleOf } from '@dxt/engine';
import {
  formatDay,
  formatResponseHours,
  formatTime,
  isSameBangkokDay,
  type EscalationStep,
  type ResponseHours,
} from '@dxt/shared';
import { targetLabels, type PolicyDraft } from './model';
import type { EscalationPageData, PreviewSite } from './types';

/**
 * The Preview card and MEscalation's ladder (S08, D-034): role tokens resolved for one site, and when
 * each step fires if nobody acknowledges, from the same clock the engine uses (`scheduleOf`).
 */

export const hoursOf = (h: EscalationPageData['hours']): ResponseHours => ({
  ...h,
  holidays: new Set(h.holidays),
});

/** The sites a policy covers (PROBLEM: all). */
export const sitesOf = (p: PolicyDraft, sites: readonly PreviewSite[]) =>
  p.tier === null ? [...sites] : sites.filter((s) => s.tier === p.tier);

/** "Owner → Arm" … for the token table. */
export function tokenRows(
  site: PreviewSite | undefined,
  admins: readonly string[],
  /** Only the tokens the policy's steps use (spec-check B6: Site AM returns with S11's track). */
  used?: readonly EscalationStep[],
) {
  const all = [
    { key: 'owner', token: 'Owner', name: site?.owner ?? '—' },
    { key: 'backup', token: 'Backup', name: site?.backup ?? '—' },
    { key: 'admins', token: 'Admin', name: admins.length ? admins.join(', ') : '—' },
    { key: 'site_am', token: 'Site AM', name: site ? (site.am ?? '— (internal)') : '—' },
    { key: 'ceo', token: 'CEO', name: 'CEO' },
  ] as const;
  const tokens = used ? new Set(used.flatMap((s) => s.targets)) : null;
  return all.filter((t) => !tokens || tokens.has(t.key)).map(({ token, name }) => ({ token, name }));
}

/**
 * The names a step reaches for the site, minus those an earlier step already told (PRD §8). The FYI
 * step tells everyone it names; from L2, a step whose people all heard already reminds them (S10, as
 * `engine_fire_step`: Tier 2–3 L2 → the Admin).
 */
export function stepNames(
  steps: readonly EscalationStep[],
  i: number,
  site: PreviewSite | undefined,
  admins: readonly string[],
) {
  const namesOf = (s: EscalationStep) =>
    s.targets.flatMap((t) =>
      t === 'owner'
        ? site?.owner
          ? [site.owner]
          : []
        : t === 'backup'
          ? site?.backup
            ? [site.backup]
            : []
          : t === 'site_am'
            ? site?.am
              ? [site.am]
              : []
            : t === 'admins'
              ? [...admins]
              : t === 'ceo'
                ? ['CEO']
                : [],
    );
  const step = steps[i]!;
  const all = [...new Set(namesOf(step))];
  if (step.fyi || i === 0) return all;
  const told = new Set(steps.slice(0, i).flatMap(namesOf));
  const fresh = all.filter((n) => !told.has(n));
  return fresh.length || i < 2 ? fresh : all;
}

const NO_ONE: Partial<Record<EscalationStep['targets'][number], string>> = {
  owner: 'no owner set',
  backup: 'no backup set',
  site_am: 'no site AM',
  admins: 'no active Admin',
};

/**
 * Why a step reaches nobody for the site: everyone it names was told already, or a token has no one
 * behind it — "nobody new (already told · no backup set)", "nobody (no backup set)" (S08 /verify).
 */
export function nobodyWhy(
  s: EscalationStep,
  site: PreviewSite | undefined,
  admins: readonly string[],
): string {
  const unset = s.targets.filter((t) =>
    t === 'admins'
      ? !admins.length
      : t === 'owner'
        ? !site?.owner
        : t === 'backup'
          ? !site?.backup
          : t === 'site_am'
            ? !site?.am
            : false,
  );
  const told = unset.length < s.targets.length;
  const why = [...(told ? ['already told'] : []), ...unset.flatMap((t) => NO_ONE[t] ?? [])];
  return `${told ? 'nobody new' : 'nobody'} (${why.join(' · ')})`;
}

const at = (d: Date, now: Date) =>
  isSameBangkokDay(d, now)
    ? formatTime(d)
    : `${formatDay(d, { weekday: true }).split(' ')[0]} ${formatTime(d)}`;

export interface ScenarioRow {
  at: string;
  /** The step this row is (none for the hours and reminder rows). */
  level?: number;
  what: string;
  muted?: boolean;
  danger?: boolean;
}

/**
 * "MuvMi DOWN confirmed now, nobody acknowledges:" and its rows (Escalation board Preview; MEscalation
 * drops ", nobody acknowledges" under its own heading). Outside response hours a Tier 2–3 DOWN posts L0
 * and pauses; a Tier 2–3 PROBLEM is held, L0 included, until the next opening (spec §7, D-034). The first
 * reminder (`firstReminderOf`) and, for Tier 2–3, the closing and opening the timeline runs across are
 * muted rows, in time order.
 */
export function scenario(
  p: PolicyDraft,
  site: PreviewSite | undefined,
  admins: readonly string[],
  hours: ResponseHours,
  now: Date,
  options: { phone?: boolean; reminderMin?: number } = {},
) {
  const tier = p.tier ?? site?.tier ?? 1;
  const plan = { severity: p.severity, tier, reminderMin: options.reminderMin ?? 15, steps: p.steps };
  const schedule = scheduleOf({ plan, detectedAt: now, hours });
  const timed: { t: number; row: ScenarioRow }[] = [];
  const add = (d: Date, row: Omit<ScenarioRow, 'at'>) =>
    timed.push({ t: d.getTime(), row: { at: at(d, now), ...row } });
  const outside = tier !== 1 && !isInsideHours(now, hours);
  const held = outside && p.severity === 'problem';
  const opening = outside ? nextOpening(now, hours) : now;
  const reminder = p.steps.length ? firstReminderOf({ plan, detectedAt: now, hours }) : null;
  const last = Math.max(...schedule.map((x) => x.dueAt.getTime()), reminder?.dueAt.getTime() ?? 0);
  if (outside && !held && last > opening.getTime()) {
    add(opening, { what: 'Response hours start · timers run', muted: true });
  }
  // Inside hours, a Tier 2–3 timeline that runs past closing pauses overnight (board: "Outside hours → held").
  const closing = tier !== 1 && !outside ? closingOf(now, hours) : null;
  if (closing && last > closing.getTime()) {
    add(closing, { what: 'Response hours end · timers paused', muted: true });
    add(nextOpening(closing, hours), { what: 'Response hours start · timers run', muted: true });
  }
  if (reminder)
    add(reminder.dueAt, { what: `Reminder in the thread (every ${plan.reminderMin} min)`, muted: true });
  p.steps.forEach((s, i) => {
    // No site to resolve for: the role tokens stand in for names (spec-check round 2).
    const names = site ? stepNames(p.steps, i, site, admins) : targetLabels(s, admins);
    const due = held && i === 0 ? opening : (schedule.find((x) => x.level === s.level)?.dueAt ?? now);
    const nobody = !s.channels.some((c) => c !== 'voice')
      ? 'notifies nobody (no channel ticked)'
      : !s.targets.length
        ? 'notifies nobody (no one picked)'
        : !names.length
          ? nobodyWhy(s, site, admins)
          : null;
    const space = i === 0 && s.channels.includes('space') ? ' + Alerts Space' : '';
    const suffix =
      i > 0
        ? s.fyi && !nobody
          ? ' · FYI even if acked'
          : ''
        : held
          ? ' (held until response hours)'
          : outside
            ? ' · timers paused'
            : '';
    add(due, {
      level: s.level,
      what: `L${i} → ${nobody ?? names.join(' + ') + space}${suffix}`,
      danger: !s.channels.some((c) => c !== 'voice') || !s.targets.length,
    });
  });
  // Steps before the muted row at the same minute; otherwise by time (a stable sort keeps the order added).
  const rows = timed
    .sort((a, b) => a.t - b.t || Number(a.row.level === undefined) - Number(b.row.level === undefined))
    .map((x) => x.row);
  const what = p.severity === 'down' ? 'DOWN confirmed' : 'PROBLEM';
  return {
    caseLine: `${site?.name ?? 'A site'} ${what} now${outside ? ' (outside response hours)' : ''}${options.phone ? ':' : ', nobody acknowledges:'}`,
    rows,
  };
}

/** "Mon–Fri 09:00–18:00" from the organisation's response hours. */
export const hoursLabel = (h: EscalationPageData['hours']): string => formatResponseHours(h);
