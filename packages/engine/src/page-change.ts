import {
  CRAWLER_FRESH_MS,
  FINGERPRINT_DOMAIN_FIELDS,
  FINGERPRINT_TEXT_FIELDS,
  registrableDomain,
  TRACKING_DOMAINS,
  type PageChangeRow,
  type PageFingerprint,
  type ProblemDetail,
} from '@dxt/shared';
import { hostOf } from './triggers';

/**
 * S09d (D-041, D-046): does the home page still match its accepted baseline? Pure — the runner loads
 * the baseline and the newest plain crawler fetches (`engine_page_fingerprints`), the engine judges.
 *
 * - A script / iframe domain that isn't in the baseline (nor the site's own, nor a tracking domain)
 *   → PROBLEM on that fetch.
 * - Any other change (title, description, robots, canonical, h1, a new link domain) → PROBLEM once the
 *   last 3 usable fetches each differ. Removed domains are shown, never alerted on (spec §26.2).
 * - Only usable fetches count, and the newest must be fresh (≤ 65 min); otherwise no data.
 * - An open Page change PROBLEM stays while the page differs at all, and through no data or an accept
 *   waiting for its Undo to close; it recovers on a fetch that matches.
 * - The first 14 days after a baseline was first set only record (`recording`).
 */

/** How many fetches in a row a change other than a new script domain must hold (~1 h). */
export const PAGE_CHANGE_HOLD_FETCHES = 3;
/** Each monitor's recording period, from its first baseline (D-046 item 2). */
export const PAGE_RECORDING_MS = 14 * 24 * 60 * 60_000;

/** One usable plain fetch, newest first. `fingerprint` is null when its hash matches the baseline. */
export interface PageFact {
  id: string;
  checkedAt: Date;
  hash: string;
  fingerprint: PageFingerprint | null;
}

export interface PageChangeInput {
  baselineHash: string;
  /** Sent only when some fact differs (its hash); the baseline to compare with at `now`. */
  baseline: PageFingerprint | null;
  /** An accept is waiting for its Undo to close until then (D-046 item 9). */
  pendingUntil: Date | null;
  firstSetAt: Date;
  /** When the baseline compared with was accepted (its first set, for an automatic one). */
  acceptedAt?: Date;
  facts: readonly PageFact[];
}

export interface PageDiff {
  /** Every row that differs, removed-only domain rows included (shown, never alerted on). */
  rows: PageChangeRow[];
  /** Rows that alert: a text field, or new domains outside the site's own and the tracking list. */
  alerting: boolean;
  newScriptDomains: string[];
  newLinkDomains: string[];
}

export type PageChangeState =
  | { kind: 'no_data' }
  /** An accept is waiting for its Undo to close: nothing new opens, nothing recovers. */
  | { kind: 'pending'; until: Date }
  | { kind: 'matches'; at: Date }
  | {
      kind: 'differs';
      diff: PageDiff;
      fact: PageFact;
      /** Usable fetches in a row that differ, newest back (at most the facts loaded). */
      held: number;
      firstSeenAt: Date;
      /** A PROBLEM: a new script domain, held 3 fetches, or one already open. */
      alert: boolean;
    };

/** The site's own registrable domains: its URL's and its redirect allowlist's. */
export function ownDomains(monitorUrl: string, allowlist: readonly string[]): string[] {
  return [hostOf(monitorUrl), ...allowlist]
    .map((h) => registrableDomain(h))
    .filter((d): d is string => d !== null);
}

/** Compares a fetch's fingerprint with the baseline. */
export function diffFingerprint(
  baseline: PageFingerprint,
  fp: PageFingerprint,
  own: readonly string[],
): PageDiff {
  const rows: PageChangeRow[] = [];
  let alerting = false;
  for (const field of FINGERPRINT_TEXT_FIELDS) {
    if ((baseline[field] ?? null) !== (fp[field] ?? null)) {
      rows.push({ field, was: baseline[field] ?? null, now: fp[field] ?? null });
      alerting = true;
    }
  }
  const quiet = new Set([...own, ...TRACKING_DOMAINS]);
  let newScriptDomains: string[] = [];
  let newLinkDomains: string[] = [];
  for (const field of FINGERPRINT_DOMAIN_FIELDS) {
    const before = new Set(baseline[field]);
    const after = new Set(fp[field]);
    const added = fp[field].filter((d) => !before.has(d));
    const removed = baseline[field].filter((d) => !after.has(d));
    if (!added.length && !removed.length) continue;
    rows.push({ field, added, removed });
    const counted = added.filter((d) => !quiet.has(d));
    if (counted.length) alerting = true;
    if (field === 'scripts') newScriptDomains = counted;
    else newLinkDomains = counted;
  }
  return { rows, alerting, newScriptDomains, newLinkDomains };
}

/** The page's state at `now`. `open`: the monitor already shows a Page change PROBLEM. */
export function pageChangeState(
  input: PageChangeInput,
  { now, own, open }: { now: Date; own: readonly string[]; open: boolean },
): PageChangeState {
  if (input.pendingUntil && input.pendingUntil > now) return { kind: 'pending', until: input.pendingUntil };
  const newest = input.facts[0];
  if (!newest || now.getTime() - newest.checkedAt.getTime() > CRAWLER_FRESH_MS) return { kind: 'no_data' };

  const diffOf = (f: PageFact): PageDiff | null => {
    if (f.hash === input.baselineHash || !f.fingerprint || !input.baseline) return null;
    const d = diffFingerprint(input.baseline, f.fingerprint, own);
    return d.alerting ? d : null;
  };
  const diff = diffOf(newest);
  // §26.6: after an accept the incident waits for the next fetch — the one the Admin accepted (or any
  // from before) proves nothing new, and recovering on it would auto-resolve a < 5 min PROBLEM.
  if (!diff && open && input.acceptedAt && newest.checkedAt <= input.acceptedAt) return { kind: 'no_data' };
  if (!diff) return { kind: 'matches', at: newest.checkedAt };

  let held = 1;
  let firstSeenAt = newest.checkedAt;
  for (const f of input.facts.slice(1)) {
    if (!diffOf(f)) break;
    held += 1;
    firstSeenAt = f.checkedAt;
  }
  const alert = open || diff.newScriptDomains.length > 0 || held >= PAGE_CHANGE_HOLD_FETCHES;
  return { kind: 'differs', diff, fact: newest, held, firstSeenAt, alert };
}

/** Still in its 14-day recording at `now`: records, never alerts. */
export function isRecording(input: Pick<PageChangeInput, 'firstSetAt'>, now: Date): boolean {
  return now.getTime() < input.firstSetAt.getTime() + PAGE_RECORDING_MS;
}

/** The PROBLEM detail of a differing state. */
export function pageChangeDetail(
  state: Extract<PageChangeState, { kind: 'differs' }>,
  monitorUrl: string,
): Extract<ProblemDetail, { kind: 'content_change' }> {
  const path = monitorUrl.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/?#]*/i, '').split(/[?#]/)[0] || '/';
  return {
    kind: 'content_change',
    path,
    changes: state.diff.rows,
    newScriptDomains: state.diff.newScriptDomains,
    newLinkDomains: state.diff.newLinkDomains,
    firstSeenAt: state.firstSeenAt.toISOString(),
    held: state.held,
    checkId: state.fact.id,
    checkedAt: state.fact.checkedAt.toISOString(),
  };
}
