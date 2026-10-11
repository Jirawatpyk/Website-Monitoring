import {
  TIER_CONFIG,
  type EscalationPlan,
  type IncidentState,
  type ResponseHours,
  type Tier,
} from '@dxt/shared';
import { addInsideMinutes, isInsideHours, minutesInsideHours, nextOpening } from './response-hours';

/**
 * The escalation ladder's timing (spec §7, §8, §14.1; D-034). Pure: the runner passes `now`, the
 * incident's plan (the policy it opened with) and its fired level; the SQL functions
 * `engine_fire_step` / `engine_remind` do the guarded writes and choose who is told.
 *   · The clock starts at "Confirmed down" (`detectedAt`; a PROBLEM's flag time). Tier 1 runs 24/7,
 *     Tier 2–3 count only minutes inside response hours (INC-0139: Thu 22:14 → L1 Fri 09:15).
 *   · Timers run only while the incident waits for an ack (Unacked / Escalated): an ack stops the
 *     ladder and the reminders, and so does recovery. A relapse keeps the clock and the fired level
 *     (D-004), so a level that came due while the site was up fires on the relapse.
 *   · Reminders fall due every `reminderMin` from the clock start, skipped on a step's minute.
 */

const MINUTE = 60_000;
const WAITING: readonly IncidentState[] = ['unacked', 'escalated'];

export interface LadderInput {
  plan: EscalationPlan;
  detectedAt: Date;
  /** `incidents.escalation_level`: the highest level fired (0 = only L0). */
  level: number;
  state: IncidentState;
  hours: ResponseHours;
  now: Date;
}

export interface LadderDue {
  /** The next level, when its time has come. */
  step?: { level: number; dueAt: Date };
  /** The latest reminder due (the SQL keys it by `dueAt`, so it goes once). */
  reminder?: { afterMin: number; dueAt: Date };
  /** Tier 2–3 outside response hours: when the timers run again ("timers paused until 09:00"). */
  pausedUntil?: Date;
}

const alwaysOn = (tier: number) => TIER_CONFIG[tier as Tier]?.alwaysOn ?? false;

/**
 * Where the ladder's clock starts (D-036): "Confirmed down" — or, for an incident a mute silenced,
 * the moment its first alert went out once the mute was over (`incidents.alerted_at`). Pass it as
 * `detectedAt` to `ladderDue` / `scheduleOf` / `problemHoldUntil`; "Confirmed down" and "Down for"
 * stay counted from detection.
 */
export function ladderClockStart(i: { detectedAt: Date; alertedAt?: Date | null }): Date {
  return i.alertedAt && i.alertedAt > i.detectedAt ? i.alertedAt : i.detectedAt;
}

/** When `minutes` on the incident's escalation clock have passed. */
function clockAt(input: Pick<LadderInput, 'plan' | 'detectedAt' | 'hours'>, minutes: number): Date {
  return alwaysOn(input.plan.tier)
    ? new Date(input.detectedAt.getTime() + minutes * MINUTE)
    : addInsideMinutes(input.detectedAt, minutes, input.hours);
}

/** Minutes on the escalation clock at `now`. */
function clockMinutesAt(input: LadderInput): number {
  return alwaysOn(input.plan.tier)
    ? Math.max(0, (input.now.getTime() - input.detectedAt.getTime()) / MINUTE)
    : minutesInsideHours(input.detectedAt, input.now, input.hours);
}

/** When each step fires if nobody acknowledges — the preview, the incident card. */
export function scheduleOf(input: Pick<LadderInput, 'plan' | 'detectedAt' | 'hours'>) {
  return (
    [...input.plan.steps]
      .sort((a, b) => a.level - b.level)
      // L0 posts at confirm at any hour (spec §7: DOWN is still posted immediately).
      .map((s) => ({ level: s.level, dueAt: s.level === 0 ? input.detectedAt : clockAt(input, s.delayMin) }))
  );
}

/** The reminder minutes are every `reminderMin` on the clock, skipped where a step fires (D-034). */
const stepMinutesOf = (plan: EscalationPlan) => new Set(plan.steps.map((s) => s.delayMin));

/**
 * The first reminder if nobody acknowledges (the preview's "Reminder in the thread" row): the same skip
 * rule as `ladderDue` — DOWN L1 +15, every 15 → +30; PROBLEM L1 +60, every 60 → +120.
 */
export function firstReminderOf(
  input: Pick<LadderInput, 'plan' | 'detectedAt' | 'hours'>,
): { afterMin: number; dueAt: Date } | null {
  const every = input.plan.reminderMin;
  if (!(every > 0)) return null;
  const steps = stepMinutesOf(input.plan);
  let k = 1;
  while (steps.has(k * every)) k++;
  return { afterMin: k * every, dueAt: clockAt(input, k * every) };
}

export function ladderDue(input: LadderInput): LadderDue {
  const due: LadderDue = {};
  if (!alwaysOn(input.plan.tier) && !isInsideHours(input.now, input.hours)) {
    due.pausedUntil = nextOpening(input.now, input.hours);
  }
  // Paused (Tier 2–3 outside response hours): nothing fires now, not even a level that came due
  // earlier while the site was up — it waits for the next opening (engine review round 2, D-034).
  if (!WAITING.includes(input.state) || due.pausedUntil) return due;

  const next = input.plan.steps.filter((s) => s.level > input.level).sort((a, b) => a.level - b.level)[0];
  if (next) {
    const dueAt = clockAt(input, next.delayMin);
    if (dueAt.getTime() <= input.now.getTime()) due.step = { level: next.level, dueAt };
  }

  const every = input.plan.reminderMin;
  const stepMinutes = stepMinutesOf(input.plan);
  let k = Math.floor(clockMinutesAt(input) / every + 1e-9);
  while (k > 0 && stepMinutes.has(k * every)) k--;
  // A step firing now is the reminder for this tick.
  if (k > 0 && !due.step) due.reminder = { afterMin: k * every, dueAt: clockAt(input, k * every) };
  return due;
}

/**
 * A Tier 2–3 PROBLEM flagged outside response hours is held until the next opening (spec §7, §19.2);
 * null = post now. A DOWN always posts at once.
 */
export function problemHoldUntil(tier: Tier, flaggedAt: Date, hours: ResponseHours): Date | null {
  if (alwaysOn(tier) || isInsideHours(flaggedAt, hours)) return null;
  return nextOpening(flaggedAt, hours);
}
