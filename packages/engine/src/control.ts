import { minuteOf } from './triggers';

/** BKK rounds in a row whose control check failed before the Admin is told (D-028). */
export const CONTROL_FAILING_ROUNDS = 3;

/** One Bangkok check's control result (`check_results.control_ok`, D-027). */
export interface ControlFact {
  checkedAt: Date;
  controlOk: boolean | null | undefined;
}

/**
 * D-028: is the BKK probe's control check failing? `true` when its last `CONTROL_FAILING_ROUNDS`
 * probe minutes all failed it, `false` once the latest minute passed, `null` when there's no
 * evidence either way (no control reported, or fewer failing minutes than that) — keep the alert as
 * it is. A minute with any passing batch (e.g. the recheck) counts as passed.
 */
export function bkkControlFailing(
  facts: readonly ControlFact[],
  rounds = CONTROL_FAILING_ROUNDS,
): boolean | null {
  const byMinute = new Map<number, boolean>();
  for (const f of facts) {
    if (f.controlOk == null) continue;
    const minute = minuteOf(f.checkedAt);
    byMinute.set(minute, (byMinute.get(minute) ?? false) || f.controlOk);
  }
  const latest = [...byMinute.entries()].sort(([a], [b]) => b - a);
  if (!latest.length) return null;
  if (latest[0]![1]) return false;
  const recent = latest.slice(0, rounds);
  return recent.length === rounds && recent.every(([, ok]) => !ok) ? true : null;
}
