import type { ProbeLocation } from './domain';

/**
 * Why a monitor shows PROBLEM in a round (PRD §5 triggers, D-022): the engine (`@dxt/engine`)
 * decides it, the notifier (`@dxt/notifier` `formatProblemCause`) words it, the runner stores both.
 */
export type ProblemDetail =
  | { kind: 'slow'; p50Ms: number; thresholdMs: number; locations: ProbeLocation[] }
  | { kind: 'keyword'; missing: string[]; forbidden: string[]; locations: ProbeLocation[] }
  | { kind: 'redirect'; host: string; locations: ProbeLocation[] }
  | {
      kind: 'regional';
      location: ProbeLocation;
      minutes: number;
      /** When that location started failing (ISO): the problem's start. */
      since: string;
      /** How that location fails, for the cause line ("timeout > 30 s"). */
      failure: { statusCode: number | null; error: string | null };
      okLocations: ProbeLocation[];
    }
  /** A key page answering 4xx (not a WAF block) at most locations. */
  | { kind: 'status'; statusCode: number; locations: ProbeLocation[] }
  /** A key page that failed its check and recheck at 2+ locations (a primary would be DOWN). */
  | {
      kind: 'hard_fail';
      failing: { location: ProbeLocation; statusCode: number | null; error: string | null }[];
    }
  /** The certificate chain is misconfigured at most locations (D-029): browsers open it, apps don't. */
  | { kind: 'tls_chain'; code: string; locations: ProbeLocation[] }
  /** A blocked key page whose page then failed in the browser. */
  | { kind: 'browser'; detail: string | null }
  /**
   * Blocked and not verified: the verifier was unavailable, the browser was blocked too (D-001, D-020),
   * or behind a WAF the VPS's control check failed (D-027).
   */
  | {
      kind: 'blocked';
      reason: 'no_poll' | 'not_picked_up' | 'lease_expired' | 'browser_blocked' | 'control_failed';
      /** The blocked locations and the status they got (403 / 429 / 503). */
      locations: ProbeLocation[];
      statusCode: number | null;
    };
