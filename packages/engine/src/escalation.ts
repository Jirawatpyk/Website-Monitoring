import {
  TIER_CONFIG,
  type EscalationPlan,
  type IncidentState,
  type ResponseHours,
  type Severity,
  type Tier,
} from '@dxt/shared';
import { episodesFromTimeline, type Episode, type IncidentEventRow } from './lifecycle';
import { addInsideMinutes, isInsideHours, minutesInsideHours, nextOpening } from './response-hours';

/**
 * The escalation ladder's timing (spec §7, §8, §14.1; D-034). Pure: the runner passes `now`, the
 * incident's plan (the policy it opened with) and its fired level; the SQL functions
 * `engine_fire_step` / `engine_remind` do the guarded writes and choose who is told.
 *   · The clock starts at "Confirmed down" (`detectedAt`; a PROBLEM's flag time). Tier 1 runs 24/7,
 *     Tier 2–3 count only minutes inside response hours (INC-0139: Thu 22:14 → L1 Fri 09:15).
 *   · Timers run only while the incident waits for an ack (Unacked / Escalated): an ack stops the
 *     ladder and the reminders, and so does recovery. The clock counts only the minutes the incident
 *     is down (D-058): a recovery pauses it, a relapse resumes it with the minutes carried
 *     (`ladderClockOf` → `carriedMin`) and the fired level kept (D-004). ENEOS, 4 Nov: a relapse
 *     days after the first drop no longer finds every level overdue.
 *   · Reminders fall due every `reminderMin` from the clock start, skipped on a step's minute.
 *   · The Tier 1 FYI step (CEO + Site AM, S10) also comes due while Acknowledged — the site is still
 *     DOWN then (§14.1: "Acknowledge stops L1 and L2"); recovered by then → nothing is sent.
 */

const MINUTE = 60_000;
const WAITING: readonly IncidentState[] = ['unacked', 'escalated'];

export interface LadderInput {
  plan: EscalationPlan;
  /** Where this drop's clock runs from: the clock start, or the relapse's confirm (`ladderClockOf`). */
  detectedAt: Date;
  /** The clock minutes the incident's earlier drops used up (D-058); 0 / absent for the first drop. */
  carriedMin?: number;
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

type ClockInput = Pick<LadderInput, 'plan' | 'detectedAt' | 'carriedMin' | 'hours'>;

/** Minutes on the clock between two times: wall minutes for Tier 1, response-hours minutes else. */
function minutesBetween(tier: number, from: Date, to: Date, hours: ResponseHours): number {
  return alwaysOn(tier)
    ? Math.max(0, (to.getTime() - from.getTime()) / MINUTE)
    : minutesInsideHours(from, to, hours);
}

/**
 * Where an incident's ladder clock stands (D-058): it counts only the minutes the incident was down at
 * the plan's severity. The latest drop runs from its confirm (`detectedAt`); the earlier drops' minutes
 * are carried (`carriedMin`). The first drop counts from `clockStart` (`ladderClockStart`: Confirmed
 * down, or the late alert after a mute; a D-021 raise resets it), and nothing before it counts — so the
 * PROBLEM time before a raise and a D-023 key-page PROBLEM drop on a DOWN incident stay off the DOWN
 * clock. One drop: `{ detectedAt: clockStart, carriedMin: 0 }`, the clock as it always was.
 * `carriedWallMin` is the same drops on the wall clock, for the words ("ESCALATED · L1 · 15 min, not
 * acknowledged" — D-034 words Tier 2–3 on the wall clock too); equal to `carriedMin` on Tier 1.
 */
export function ladderClockOf(input: {
  episodes: readonly Episode[];
  severity: EscalationPlan['severity'];
  clockStart: Date;
  tier: number;
  hours: ResponseHours;
}): { detectedAt: Date; carriedMin: number; carriedWallMin: number } {
  const from = input.clockStart.getTime();
  const drops = input.episodes
    .filter((e) => e.severity === input.severity && (e.end === null || e.end.getTime() > from))
    .map((e) => ({ start: new Date(Math.max((e.confirmedAt ?? e.start).getTime(), from)), end: e.end }))
    .sort((a, b) => a.start.getTime() - b.start.getTime());
  const last = drops.at(-1);
  if (!last) return { detectedAt: input.clockStart, carriedMin: 0, carriedWallMin: 0 };
  let carriedMin = 0;
  let carriedWallMin = 0;
  for (const d of drops.slice(0, -1)) {
    const end = d.end ?? last.start;
    carriedMin += minutesBetween(input.tier, d.start, end, input.hours);
    // A Tier 2–3 PROBLEM held overnight was told at the opening: its words count from then (D-034).
    const told =
      input.severity === 'problem'
        ? (problemHoldUntil(input.tier as Tier, d.start, input.hours) ?? d.start)
        : d.start;
    carriedWallMin += minutesBetween(1, told, end, input.hours);
  }
  return { detectedAt: last.start, carriedMin, carriedWallMin };
}

/**
 * `ladderClockOf` for a stored incident and its timeline rows: the one way the runner and the
 * messages build the clock, so "acknowledge by HH:MM" promises the time the level fires (D-058).
 */
export function incidentLadderClock(
  incident: {
    started_at: string;
    severity: Severity;
    resolved_at?: string | null;
    detected_at: string;
    alerted_at?: string | null;
  },
  events: readonly IncidentEventRow[],
  plan: Pick<EscalationPlan, 'severity' | 'tier'>,
  hours: ResponseHours,
): { detectedAt: Date; carriedMin: number; carriedWallMin: number } {
  return ladderClockOf({
    episodes: episodesFromTimeline(incident, events),
    severity: plan.severity,
    clockStart: ladderClockStart({
      detectedAt: new Date(incident.detected_at),
      alertedAt: incident.alerted_at ? new Date(incident.alerted_at) : null,
    }),
    tier: plan.tier,
    hours,
  });
}

/**
 * When `minutes` on the incident's escalation clock have passed. A minute the earlier drops already
 * reached is due at this drop's start (D-058: a level due then that never fired goes at the relapse).
 */
function clockAt(input: ClockInput, minutes: number): Date {
  const left = minutes - (input.carriedMin ?? 0);
  if (left <= 0) return input.detectedAt;
  return alwaysOn(input.plan.tier)
    ? new Date(input.detectedAt.getTime() + left * MINUTE)
    : addInsideMinutes(input.detectedAt, left, input.hours);
}

/** Minutes on the escalation clock at `now`. */
function clockMinutesAt(input: LadderInput): number {
  return (input.carriedMin ?? 0) + minutesBetween(input.plan.tier, input.detectedAt, input.now, input.hours);
}

/** When each step fires if nobody acknowledges — the preview, the incident card. */
export function scheduleOf(input: ClockInput) {
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
export function firstReminderOf(input: ClockInput): { afterMin: number; dueAt: Date } | null {
  const every = input.plan.reminderMin;
  if (!(every > 0)) return null;
  const steps = stepMinutesOf(input.plan);
  // After a relapse: the first reminder minute this drop reaches (D-058).
  let k = Math.floor((input.carriedMin ?? 0) / every + 1e-9) + 1;
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
  if (due.pausedUntil) return due;
  const acked = input.state === 'acknowledged';
  if (!WAITING.includes(input.state) && !acked) return due;

  // Acknowledged: only the FYI step, whatever level the incident reached — an FYI sent after an ack
  // doesn't move the level (an Undo must let L2 still fire), and a D-021 raise keeps a PROBLEM
  // ladder's level; the SQL sends each drop severity's FYI once (engine review M1, M2).
  const next = input.plan.steps
    .filter((s) => (acked ? !!s.fyi : s.level > input.level))
    .sort((a, b) => a.level - b.level)[0];
  if (next) {
    const dueAt = clockAt(input, next.delayMin);
    if (dueAt.getTime() <= input.now.getTime()) due.step = { level: next.level, dueAt };
  }
  if (acked) return due;

  const every = input.plan.reminderMin;
  const stepMinutes = stepMinutesOf(input.plan);
  let k = Math.floor(clockMinutesAt(input) / every + 1e-9);
  while (k > 0 && stepMinutes.has(k * every)) k--;
  // A step firing now is the reminder for this tick. A minute an earlier drop already reached was
  // reminded (or skipped) then: no second STILL DOWN at the relapse (D-058).
  if (k > 0 && k * every > (input.carriedMin ?? 0) && !due.step) {
    due.reminder = { afterMin: k * every, dueAt: clockAt(input, k * every) };
  }
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
