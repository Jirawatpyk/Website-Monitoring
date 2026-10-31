import type { ProbeLocation } from './domain';
import type { FingerprintField } from './fingerprint';
import type { CrawlerView } from './forbidden';

/**
 * One fingerprint row that differs from the baseline (S09d, D-046): a text field's before / after, or
 * a domain set's added / removed domains (the unchanged ones aren't kept here — the pages read them
 * from the fingerprints).
 */
export interface PageChangeRow {
  field: FingerprintField;
  was?: string | null;
  now?: string | null;
  added?: string[];
  removed?: string[];
}

/**
 * Why a monitor shows PROBLEM in a round (PRD §5 triggers, D-022): the engine (`@dxt/engine`)
 * decides it, the notifier (`@dxt/notifier` `formatProblemCause`) words it, the runner stores both.
 */
export type ProblemDetail =
  | { kind: 'slow'; p50Ms: number; thresholdMs: number; locations: ProbeLocation[] }
  /** `view`: seen only by a crawler fetch (D-041), not by the round's locations. */
  | {
      kind: 'keyword';
      missing: string[];
      forbidden: string[];
      locations: ProbeLocation[];
      view?: CrawlerView;
    }
  | { kind: 'redirect'; host: string; locations: ProbeLocation[]; view?: CrawlerView }
  /**
   * The home page's fingerprint differs from its baseline (S09d, D-046): the rows that differ, the new
   * script / iframe domains among them, when the run of differing fetches began, how many fetches it
   * has held and the plain fetch it was read from.
   */
  | {
      kind: 'content_change';
      path: string;
      changes: PageChangeRow[];
      newScriptDomains: string[];
      /** New link domains that count (not the site's own, not a tracking domain). */
      newLinkDomains: string[];
      firstSeenAt: string;
      held: number;
      checkId: string;
      checkedAt: string;
    }
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
  /**
   * D-050: the home page timed out at 2+ locations in `blips` rounds within `windowMin` minutes, each
   * time back by the next round, so none was a DOWN (D-049). `locations`: where the latest one timed out.
   */
  | { kind: 'intermittent'; blips: number; windowMin: number; locations: ProbeLocation[] }
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
