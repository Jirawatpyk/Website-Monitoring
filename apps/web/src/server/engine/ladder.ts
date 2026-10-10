import 'server-only';
import type { DbClient } from '@dxt/db';
import { ladderDue, problemHoldUntil } from '@dxt/engine';
import { escalationPlanSchema, type IncidentState, type ResponseHours, type Tier } from '@dxt/shared';

/**
 * The escalation ladder's tick (S08, D-034), once per engine run after the sites are judged: every
 * incident waiting for an ack that opened with a plan gets its next level and its latest reminder
 * when their time has come (`ladderDue`). The SQL functions are guarded — state, level, a first alert
 * out, one reminder per due time — so overlapping runs (the cron, a probe's recheck, Ingest) send each
 * message once. One incident's failure doesn't hold the others back; the run reports it at the end.
 * Returns how many calls queued messages (for inline delivery) and the incidents that failed.
 */
export async function escalationTick(
  db: DbClient,
  now: Date,
  hours: ResponseHours,
): Promise<{ queued: number; failed: string[] }> {
  const { data, error } = await db
    .from('incidents')
    .select('id, state, severity, episode_severity, detected_at, escalation_level, escalation_plan')
    .in('state', ['unacked', 'escalated'])
    .not('escalation_plan', 'is', null);
  if (error) throw new Error(`incidents: ${error.message}`);

  let queued = 0;
  const failed: string[] = [];
  for (const inc of data) {
    if (inc.escalation_plan == null) continue; // opened before S08: no ladder
    // D-023: the home page is back and only a key page fails — the DOWN ladder waits; the PROBLEM
    // AGAIN reply told whoever acts now (D-034).
    if (inc.severity === 'down' && inc.episode_severity === 'problem') continue;
    const plan = escalationPlanSchema.safeParse(inc.escalation_plan);
    if (!plan.success) {
      console.error(JSON.stringify({ event: 'escalation_plan_invalid', incident: inc.id }));
      continue;
    }
    try {
      queued += await tick(db, inc.id, {
        plan: plan.data,
        detectedAt: new Date(inc.detected_at),
        level: inc.escalation_level,
        state: inc.state as IncidentState,
        hours,
        now,
      });
    } catch (err) {
      failed.push(`${inc.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return { queued, failed };
}

async function tick(
  db: DbClient,
  incidentId: string,
  input: Parameters<typeof ladderDue>[0],
): Promise<number> {
  const due = ladderDue(input);
  // How long it has gone unacknowledged since the owner was told: a DOWN at confirm ("11 h" after a
  // night — L0 posted at 22:14), a Tier 2–3 PROBLEM held overnight at the opening ("60 min" at 10:00,
  // not "11 h 46 min"; message-check round 2).
  const toldAt =
    input.plan.severity === 'problem'
      ? (problemHoldUntil(input.plan.tier as Tier, input.detectedAt, input.hours) ?? input.detectedAt)
      : input.detectedAt;
  const elapsedMin = Math.max(0, Math.floor((input.now.getTime() - toldAt.getTime()) / 60_000));
  let queued = 0;
  if (due.step) {
    const fired = await db.rpc('engine_fire_step', {
      p_incident_id: incidentId,
      p_level: due.step.level,
      p_due_at: due.step.dueAt.toISOString(),
      p_context: { elapsedMin },
    });
    if (fired.error) throw new Error(`engine_fire_step: ${fired.error.message}`);
    if (fired.data) queued += 1;
  }
  if (due.reminder) {
    const reminded = await db.rpc('engine_remind', {
      p_incident_id: incidentId,
      p_due_at: due.reminder.dueAt.toISOString(),
      p_context: { elapsedMin, afterMin: due.reminder.afterMin },
    });
    if (reminded.error) throw new Error(`engine_remind: ${reminded.error.message}`);
    if (reminded.data) queued += 1;
  }
  return queued;
}
