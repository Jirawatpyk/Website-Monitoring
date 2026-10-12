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

/**
 * D-038: may a WAF round with nobody left to vote be PROBLEM (unverified)? Only once the control
 * check failed in `rounds` probe minutes in a row; a minute where every batch passed ends it. Unlike
 * the Admin alert (`bkkControlFailing`), a minute counts as failing when **any** of its batches failed
 * the control — the scheduled check or the recheck — so a passing batch can't hide a control that
 * fails every minute in the other one (a round is judged untrusted on either). While the alert is
 * open and the window holds no passing minute (sparse batches), it is still down; with no control
 * reported at all, the alert decides.
 */
export function bkkControlDown(
  facts: readonly ControlFact[],
  alertOpen: boolean,
  rounds = CONTROL_FAILING_ROUNDS,
): boolean {
  const byMinute = new Map<number, boolean>();
  for (const f of facts) {
    if (f.controlOk == null) continue;
    const minute = minuteOf(f.checkedAt);
    byMinute.set(minute, (byMinute.get(minute) ?? true) && f.controlOk);
  }
  const latest = [...byMinute.entries()].sort(([a], [b]) => b - a);
  if (!latest.length) return alertOpen;
  if (latest[0]![1]) return false;
  const recent = latest.slice(0, rounds);
  if (recent.length === rounds && recent.every(([, ok]) => !ok)) return true;
  return alertOpen && latest.every(([, ok]) => !ok);
}
