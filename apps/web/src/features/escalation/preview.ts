import { isInsideHours, nextOpening, scheduleOf } from '@dxt/engine';
import {
  formatDay,
  formatTime,
  isSameBangkokDay,
  type EscalationStep,
  type ResponseHours,
} from '@dxt/shared';
import type { PolicyDraft } from './model';
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
export function tokenRows(site: PreviewSite | undefined, admins: readonly string[]) {
  return [
    { token: 'Owner', name: site?.owner ?? '—' },
    { token: 'Backup', name: site?.backup ?? '—' },
    { token: 'Admin', name: admins.length ? admins.join(', ') : '—' },
    { token: 'Site AM', name: site ? (site.am ?? '— (internal)') : '—' },
  ];
}

/** The names a step reaches for the site, minus those an earlier step already told (PRD §8). */
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
              : [],
    );
  const told = new Set(steps.slice(0, i).flatMap(namesOf));
  return [...new Set(namesOf(steps[i]!))].filter((n) => !told.has(n));
}

const at = (d: Date, now: Date) =>
  isSameBangkokDay(d, now)
    ? formatTime(d)
    : `${formatDay(d, { weekday: true }).split(' ')[0]} ${formatTime(d)}`;

export interface ScenarioRow {
  at: string;
  what: string;
  muted?: boolean;
  danger?: boolean;
}

/** "MuvMi DOWN confirmed now, nobody acknowledges:" and its rows (Escalation board Preview). */
export function scenario(
  p: PolicyDraft,
  site: PreviewSite | undefined,
  admins: readonly string[],
  hours: ResponseHours,
  now: Date,
) {
  const tier = p.tier ?? site?.tier ?? 1;
  const plan = { severity: p.severity, tier, reminderMin: 15, steps: p.steps };
  const schedule = scheduleOf({ plan, detectedAt: now, hours });
  const rows: ScenarioRow[] = [];
  const outside = tier !== 1 && !isInsideHours(now, hours);
  p.steps.forEach((s, i) => {
    const names = stepNames(p.steps, i, site, admins);
    const due = schedule.find((x) => x.level === s.level)?.dueAt ?? now;
    if (i === 1 && outside) {
      rows.push({
        at: at(nextOpening(now, hours), now),
        what: 'Response hours start · timers run',
        muted: true,
      });
    }
    const nobody = !s.channels.length
      ? 'notifies nobody (no channel ticked)'
      : !names.length
        ? 'notifies nobody (no one picked)'
        : null;
    const space = i === 0 && s.channels.includes('space') ? ' + Alerts Space' : '';
    rows.push({
      at: at(due, now),
      what: `L${i} → ${nobody ?? names.join(' + ') + space}${i === 0 && outside ? ' · timers paused' : ''}`,
      danger: !!nobody,
    });
  });
  const what = p.severity === 'down' ? 'DOWN confirmed' : 'PROBLEM';
  return {
    caseLine: `${site?.name ?? 'A site'} ${what} now${outside ? ' (outside response hours)' : ''}, nobody acknowledges:`,
    rows,
  };
}
