import 'server-only';
import type { DbClient } from '@dxt/db';
import { CLOSED_INCIDENT_STATES_IN, type Role, type SiteStatus } from '@dxt/shared';
import type { MySite, ProfileData } from './model';

function check<T>(what: string, r: { data: T; error: { message: string } | null }): T {
  if (r.error) throw new Error(`${what}: ${r.error.message}`);
  return r.data;
}

const OPEN_SWAP = ['waiting', 'accepted'];

/**
 * My profile (S16 PR 3), read as the signed-in person under RLS — every staff role reads these tables
 * (`is_staff()`), and `list_sessions(me)` is your own devices only. Small: your sites, the four
 * policies, your shifts not over yet.
 */
export async function loadProfileData(
  db: DbClient,
  meId: string,
  now: Date,
  emailOn: boolean,
): Promise<ProfileData> {
  const nowIso = now.toISOString();
  const [
    me,
    sessions,
    sites,
    clients,
    policies,
    steps,
    rotation,
    shifts,
    swaps,
    settings,
    open,
    admins,
    checklist,
  ] = await Promise.all([
    db.from('profiles').select('id, display_name, email, role, google_chat_user_id').eq('id', meId).single(),
    db.rpc('list_sessions', { p_user_id: meId }),
    db
      .from('sites')
      .select(
        'id, name, tier, client_id, primary_owner_id, backup_owner_id, muted_until, status:site_status(status)',
      )
      .eq('is_active', true)
      .order('name'),
    db.from('clients').select('id, am_user_id, is_internal'),
    db.from('escalation_policies').select('id, severity, tier'),
    db.from('escalation_steps').select('policy_id, level, delay_min, targets, fyi'),
    db.from('oncall_rotation').select('user_id'),
    db
      .from('oncall_shifts')
      .select('id, starts_at, ends_at')
      .eq('user_id', meId)
      .gt('ends_at', nowIso)
      .order('starts_at'),
    db
      .from('oncall_swaps')
      .select(
        'requester_id, counterpart_id, requester_shift_id, counterpart_shift_id, status, requester:profiles!oncall_swaps_requester_id_fkey(display_name), counterpart:profiles!oncall_swaps_counterpart_id_fkey(display_name)',
      )
      .or(`requester_id.eq.${meId},counterpart_id.eq.${meId}`)
      .in('status', OPEN_SWAP),
    db.from('organisation_settings').select('response_start, response_end, response_days').single(),
    db.from('incidents').select('id, site_id').not('state', 'in', CLOSED_INCIDENT_STATES_IN),
    db
      .from('profiles')
      .select('display_name')
      .eq('role', 'admin')
      .eq('is_active', true)
      .order('display_name'),
    db.from('oncall_checklist').select('test_sent_at').eq('user_id', meId).maybeSingle(),
  ]);

  const p = check('profiles', me);
  if (!p) throw new Error('profiles: your own row is missing');
  const myClients = new Set(
    (check('clients', clients) ?? []).filter((c) => c.am_user_id === meId).map((c) => c.id),
  );
  const internalClients = new Set(
    (check('clients', clients) ?? []).filter((c) => c.is_internal).map((c) => c.id),
  );
  const incidentOf = new Map<string, string>();
  for (const i of check('incidents', open) ?? [])
    if (!incidentOf.has(i.site_id)) incidentOf.set(i.site_id, i.id);
  const one = <T>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);

  const mySites: MySite[] = (check('sites', sites) ?? []).flatMap((s) => {
    const role: MySite['role'] | null =
      s.primary_owner_id === meId
        ? 'Owner'
        : s.backup_owner_id === meId
          ? 'Backup'
          : s.client_id && myClients.has(s.client_id)
            ? 'AM'
            : null;
    if (!role) return [];
    return [
      {
        id: s.id,
        name: s.name,
        tier: s.tier,
        status: (one(s.status)?.status ?? null) as SiteStatus | null,
        role,
        incident: incidentOf.get(s.id) ?? null,
        mutedUntil: s.muted_until,
        internal: !!(s.client_id && internalClients.has(s.client_id)),
      },
    ];
  });

  const stepRows = check('escalation_steps', steps) ?? [];
  const role = p.role as Role;
  const swap = [...(check('oncall_swaps', swaps) ?? [])].sort(
    (a, b) => Number(a.requester_id === meId) - Number(b.requester_id === meId),
  )[0];
  const hours = check('organisation_settings', settings);

  return {
    me: {
      id: p.id,
      name: p.display_name,
      email: p.email,
      role,
      chatLinked: !!p.google_chat_user_id?.trim(),
    },
    sessions: (check('list_sessions', sessions) ?? []).map((s) => ({
      id: s.id,
      userId: s.user_id,
      userAgent: s.user_agent,
      createdAt: s.created_at,
      lastUsed: s.last_used,
      current: s.is_current,
    })),
    sites: mySites,
    isAm: myClients.size > 0,
    isCeo: role === 'stakeholder' && myClients.size === 0,
    policies: (check('escalation_policies', policies) ?? []).map((pol) => ({
      severity: pol.severity === 'down' ? 'down' : 'problem',
      tier: pol.tier,
      steps: stepRows
        .filter((s) => s.policy_id === pol.id)
        .map((s) => ({ level: s.level, delayMin: s.delay_min, targets: s.targets, fyi: !!s.fyi })),
    })),
    inRotation: (check('oncall_rotation', rotation) ?? []).some((r) => r.user_id === meId),
    shifts: (check('oncall_shifts', shifts) ?? []).map((s) => ({
      id: s.id,
      startsAt: s.starts_at,
      endsAt: s.ends_at,
    })),
    swap: swap
      ? {
          mine: swap.requester_id === meId,
          other:
            (swap.requester_id === meId ? one(swap.counterpart) : one(swap.requester))?.display_name ??
            'someone',
          status: swap.status === 'accepted' ? 'accepted' : 'waiting',
          shiftId: swap.requester_id === meId ? swap.requester_shift_id : swap.counterpart_shift_id,
        }
      : null,
    hours: hours
      ? { start: hours.response_start, end: hours.response_end, days: hours.response_days }
      : { start: '09:00', end: '18:00', days: [1, 2, 3, 4, 5] },
    emailOn,
    admins: (check('admins', admins) ?? []).map((a) => a.display_name),
    testSentAt: check('oncall_checklist', checklist)?.test_sent_at ?? null,
  };
}
