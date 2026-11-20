import 'server-only';
import { escalationStepSchema, formatResponseHours, type EscalationStep, type Role } from '@dxt/shared';
import { createClient } from '@/lib/supabase/server';
import { loadResponseHours } from '@/server/escalation/response-hours';
import type { GuideFacts, GuideShift, PolicyKey } from './content';

/** The live shift and the next ones the rotation topic names. */
const SHIFTS_AHEAD = 3;

export interface GuidePageData {
  facts: GuideFacts;
  role: Role;
  /** The viewer holds the live on-call shift (the On-call chip, spec §18). */
  onCallNow: boolean;
}

type ShiftRow = {
  user_id: string;
  starts_at: string;
  ends_at: string;
  person: { display_name: string } | null;
};

/**
 * What the guide reads live (S18, D-070), as the signed-in person: every staff role reads the
 * settings, the policies, the shifts and the Admins' names (`is_staff`, D-034, D-048).
 */
export async function getGuidePage(me: { id: string; role: Role }, now = new Date()): Promise<GuidePageData> {
  const db = await createClient();
  const at = now.toISOString();
  const [hours, policies, steps, settings, sites, admins, shifts] = await Promise.all([
    loadResponseHours(db, now),
    db.from('escalation_policies').select('id, severity, tier'),
    db.from('escalation_steps').select('policy_id, level, delay_min, targets, channels, fyi').order('level'),
    db.from('organisation_settings').select('down_reminder_min, problem_reminder_min').single(),
    db.from('sites').select('id', { count: 'exact', head: true }).eq('is_active', true).eq('tier', 1),
    db
      .from('profiles')
      .select('display_name')
      .eq('role', 'admin')
      .eq('is_active', true)
      .order('display_name'),
    db
      .from('oncall_shifts')
      .select('user_id, starts_at, ends_at, person:profiles!oncall_shifts_user_id_fkey(display_name)')
      .gt('ends_at', at)
      .order('starts_at')
      .limit(SHIFTS_AHEAD + 1),
  ]);
  for (const [name, r] of Object.entries({ policies, steps, settings, sites, admins, shifts })) {
    if (r.error) throw new Error(`${name}: ${r.error.message}`);
  }

  const byPolicy: Record<PolicyKey, EscalationStep[]> = { t1: [], t2: [], t3: [], problem: [] };
  for (const p of policies.data ?? []) {
    const key: PolicyKey = p.severity === 'problem' ? 'problem' : (`t${p.tier ?? 1}` as PolicyKey);
    byPolicy[key] = (steps.data ?? [])
      .filter((s) => s.policy_id === p.id)
      .map((s) =>
        escalationStepSchema.parse({
          level: s.level,
          delayMin: s.delay_min,
          targets: s.targets,
          channels: s.channels,
          ...(s.fyi ? { fyi: true } : {}),
        }),
      );
  }

  const rows = (shifts.data ?? []) as unknown as ShiftRow[];
  const toShift = (r: ShiftRow): GuideShift => ({
    who: r.person?.display_name ?? 'Someone',
    startsAt: r.starts_at,
    endsAt: r.ends_at,
  });
  // Postgres writes "+00:00", not "Z": compare instants, not strings.
  const live = rows.find((r) => Date.parse(r.starts_at) <= now.getTime());
  const next = rows.filter((r) => r !== live).slice(0, SHIFTS_AHEAD);

  return {
    role: me.role,
    onCallNow: live?.user_id === me.id,
    facts: {
      hours: formatResponseHours(hours),
      tier1Sites: sites.count ?? 0,
      admins: (admins.data ?? []).map((a) => a.display_name),
      onCallNow: live ? toShift(live) : null,
      onCallNext: next.map(toShift),
      policies: byPolicy,
      downReminderMin: settings.data!.down_reminder_min,
      problemReminderMin: settings.data!.problem_reminder_min,
      isAdmin: me.role === 'admin',
    },
  };
}
