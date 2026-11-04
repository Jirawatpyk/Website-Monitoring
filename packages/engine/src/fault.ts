import { clockMinutes } from '@dxt/shared';

/**
 * Monitor fault (S12a, FR-21, spec §14.4, §15.3, §16.10; D-053). The fault is the engine's **cron
 * sweep** stopping — `agent_heartbeats` `engine-sweep`, stamped by the cron route only — since the
 * engine also runs after every Bangkok ingest. A heartbeat missed for 3 min or more is a fault:
 * MainFault's last sweep 02:17 → the alert at 02:20. The Overview's statuses are "as of" the last
 * round the engine judged.
 */
export const MONITOR_GRACE_MS = 3 * 60_000;

export interface LocationBeat {
  code: string;
  /** `probe_locations.last_heartbeat_at`; null = never beat. */
  lastBeatAt: Date | null;
}

export interface FaultState {
  engineFault: boolean;
  /** The last sweep (the fault started after it); null = none recorded yet. */
  since: Date | null;
  /** Whole minutes since the last sweep while faulted ("statuses below are 14 min old"), else null. */
  staleMinutes: number | null;
  /** The last judged round: what the Overview's statuses show. */
  asOf: Date | null;
  /** Active locations that beat in the last 3 min, and those that didn't, by code. */
  beating: string[];
  missing: string[];
}

const missed = (at: Date | null, now: Date) => !at || now.getTime() - at.getTime() >= MONITOR_GRACE_MS;

/**
 * The engine fault on its own: the cron sweep 3 min old or more. No sweep recorded yet (a fresh
 * deploy, before the first cron minute) is no data, not a fault.
 */
export function isSweepStale(sweepAt: Date | null, now: Date): boolean {
  return !!sweepAt && missed(sweepAt, now);
}

export function faultState(input: {
  sweepAt: Date | null;
  lastRoundAt: Date | null;
  /** The active probe locations. */
  locations: readonly LocationBeat[];
  now: Date;
}): FaultState {
  const engineFault = isSweepStale(input.sweepAt, input.now);
  const sorted = [...input.locations].sort((a, b) => a.code.localeCompare(b.code));
  return {
    engineFault,
    since: input.sweepAt,
    staleMinutes: engineFault && input.sweepAt ? clockMinutes(input.sweepAt, input.now) : null,
    asOf: input.lastRoundAt,
    beating: sorted.filter((l) => !missed(l.lastBeatAt, input.now)).map((l) => l.code),
    missing: sorted.filter((l) => missed(l.lastBeatAt, input.now)).map((l) => l.code),
  };
}

/**
 * The one probe location missing for 3 min or more while the others beat (spec §15.3): an email to the
 * Admins, no page. Never during an engine fault (§16.10 — and the engine that would send it is the
 * one down), and never with two or more missing — that is `probe_locations_low` (D-022).
 */
export function probeMissing(state: FaultState): string | null {
  if (state.engineFault || state.missing.length !== 1 || state.beating.length < 2) return null;
  return state.missing[0] ?? null;
}
