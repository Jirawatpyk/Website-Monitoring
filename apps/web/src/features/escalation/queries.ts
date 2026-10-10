import 'server-only';
import {
  escalationStepSchema,
  timeToMinutes,
  CLOSED_INCIDENT_STATES_IN,
  type EscalationStep,
} from '@dxt/shared';
import { createClient } from '@/lib/supabase/server';
import { policyKeyOf, type PolicyDraft, type PolicyKey } from './model';
import type { EscalationPageData, PreviewSite } from './types';

const ORDER: Record<PolicyKey, number> = { t1: 0, t2: 1, t3: 2, problem: 3 };

/** The Escalation page's data, read as the signed-in person (staff read every part, D-034). */
export async function getEscalationPage(now = new Date()): Promise<EscalationPageData> {
  const db = await createClient();
  const from = new Date(now.getTime() - 60 * 86_400_000).toISOString().slice(0, 10);
  const [policies, steps, settings, holidays, sites, admins, open] = await Promise.all([
    db.from('escalation_policies').select('id, severity, tier'),
    db.from('escalation_steps').select('policy_id, level, delay_min, targets, channels').order('level'),
    db
      .from('organisation_settings')
      .select('response_start, response_end, response_days, down_reminder_min, problem_reminder_min')
      .single(),
    db.from('company_holidays').select('day').gte('day', from),
    db
      .from('sites')
      .select(
        `id, name, tier,
         primary:profiles!sites_primary_owner_id_fkey(display_name),
         backup:profiles!sites_backup_owner_id_fkey(display_name),
         client:clients(is_internal, am:profiles!clients_am_user_id_fkey(display_name))`,
      )
      .eq('is_active', true)
      .order('tier')
      .order('name'),
    db
      .from('profiles')
      .select('display_name')
      .eq('role', 'admin')
      .eq('is_active', true)
      .order('display_name'),
    db
      .from('incidents')
      .select('number, severity, escalation_plan')
      .not('state', 'in', CLOSED_INCIDENT_STATES_IN)
      .not('escalation_plan', 'is', null)
      .order('number'),
  ]);
  for (const r of [policies, steps, settings, holidays, sites, admins, open]) {
    if (r.error) throw new Error(r.error.message);
  }

  const stepsOf = (policyId: string): EscalationStep[] =>
    (steps.data ?? [])
      .filter((s) => s.policy_id === policyId)
      .map((s) =>
        escalationStepSchema.parse({
          level: s.level,
          delayMin: s.delay_min,
          targets: s.targets,
          channels: s.channels,
        }),
      );

  const drafts: PolicyDraft[] = (policies.data ?? [])
    .map((p) => ({
      id: p.id,
      key: policyKeyOf(p.severity, p.tier),
      severity: p.severity,
      tier: p.tier,
      steps: stepsOf(p.id),
    }))
    .sort((a, b) => ORDER[a.key] - ORDER[b.key]);

  type SiteRow = {
    id: string;
    name: string;
    tier: number;
    primary: { display_name: string } | null;
    backup: { display_name: string } | null;
    client: { is_internal: boolean; am: { display_name: string } | null } | null;
  };
  const previewSites: PreviewSite[] = ((sites.data ?? []) as unknown as SiteRow[]).map((s) => ({
    id: s.id,
    name: s.name,
    tier: s.tier,
    owner: s.primary?.display_name ?? null,
    backup: s.backup?.display_name ?? null,
    am: s.client && !s.client.is_internal ? (s.client.am?.display_name ?? null) : null,
  }));

  const planKey = (plan: unknown): PolicyKey | null => {
    const p = plan as { severity?: unknown; tier?: unknown } | null;
    if (p?.severity !== 'down' && p?.severity !== 'problem') return null;
    return policyKeyOf(p.severity, typeof p.tier === 'number' ? p.tier : null);
  };

  return {
    policies: drafts,
    downReminder: settings.data!.down_reminder_min,
    problemReminder: settings.data!.problem_reminder_min,
    hours: {
      startMin: timeToMinutes(settings.data!.response_start),
      endMin: timeToMinutes(settings.data!.response_end),
      days: settings.data!.response_days,
      holidays: (holidays.data ?? []).map((h) => h.day),
    },
    sites: previewSites,
    admins: (admins.data ?? []).map((a) => a.display_name),
    openIncidents: (open.data ?? []).flatMap((i) => {
      const key = planKey(i.escalation_plan);
      return key ? [{ number: i.number, key }] : [];
    }),
  };
}
