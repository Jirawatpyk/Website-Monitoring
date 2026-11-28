import 'server-only';
import type { DbClient } from '@dxt/db';
import { formatIncidentId, type Role } from '@dxt/shared';
import { ceoStepsLine, type UsersData } from './model';
import { SIGNIN_ACTIONS, type SecurityData } from './security-model';

const OPEN_SWAP = ['waiting', 'accepted'];
const OPEN_INCIDENT = ['unacked', 'escalated', 'acknowledged', 'monitoring', 'needs_root_cause'] as const;

/** A frozen `escalation_plan` with a step naming Management. */
function planNamesManagement(plan: unknown): boolean {
  const steps = (plan as { steps?: unknown } | null)?.steps;
  return (
    Array.isArray(steps) &&
    steps.some(
      (s) =>
        Array.isArray((s as { targets?: unknown }).targets) &&
        (s as { targets: unknown[] }).targets.includes('management'),
    )
  );
}

function check<T>(what: string, r: { data: T; error: { message: string } | null }): T {
  if (r.error) throw new Error(`${what}: ${r.error.message}`);
  return r.data;
}

/**
 * Everything the Users page reads (S16), as the signed-in Admin under RLS. Small tables, read whole:
 * ~10 people, 17 sites, a few clients, the shifts not over yet. `pending_invites` and `list_sessions`
 * refuse anyone but an Admin.
 */
export async function loadUsersData(db: DbClient, viewerId: string, now: Date): Promise<UsersData> {
  const nowIso = now.toISOString();
  const [people, invites, sessions, sites, clients, rotation, shifts, swaps, acks, policies, steps, plans] =
    await Promise.all([
      db
        .from('profiles')
        .select('id, display_name, email, role, google_chat_user_id, is_management')
        .eq('is_active', true),
      db.rpc('pending_invites'),
      db.rpc('list_sessions'),
      db.from('sites').select('id, name, is_active, primary_owner_id, backup_owner_id').order('name'),
      db.from('clients').select('id, name, am_user_id').order('name'),
      db.from('oncall_rotation').select('user_id, position').order('position'),
      db
        .from('oncall_shifts')
        .select('id, user_id, starts_at, ends_at')
        .gt('ends_at', nowIso)
        .order('starts_at'),
      db.from('oncall_swaps').select('id, requester_id, counterpart_id').in('status', OPEN_SWAP),
      db
        .from('incidents')
        .select('number, acked_by, sites!inner(name)')
        .not('acked_by', 'is', null)
        .in('state', [...OPEN_INCIDENT]),
      // D-078: whether a step goes to Management, and the CEO's Tier 1 steps, from the policies.
      db.from('escalation_policies').select('id, severity, tier'),
      db.from('escalation_steps').select('policy_id, level, delay_min, targets, fyi'),
      // As private.assert_management_left: an open incident's frozen plan counts too (spec-check M1).
      db
        .from('incidents')
        .select('escalation_plan')
        .in('state', [...OPEN_INCIDENT])
        .not('escalation_plan', 'is', null),
    ]);
  const t1 = (check('escalation_policies', policies) ?? []).find(
    (p) => p.severity === 'down' && p.tier === 1,
  );
  const allSteps = check('escalation_steps', steps) ?? [];

  const lastUsed = new Map<string, string>();
  for (const s of check('list_sessions', sessions) ?? []) {
    const prev = lastUsed.get(s.user_id);
    if (!prev || s.last_used > prev) lastUsed.set(s.user_id, s.last_used);
  }
  const siteName = (s: { name: string } | { name: string }[] | null) =>
    (Array.isArray(s) ? s[0]?.name : s?.name) ?? '';

  return {
    viewerId,
    people: (check('profiles', people) ?? [])
      .map((p) => ({
        id: p.id,
        name: p.display_name,
        email: p.email,
        role: p.role as Role,
        chatLinked: !!p.google_chat_user_id?.trim(),
        lastActive: lastUsed.get(p.id) ?? null,
        management: p.is_management,
      }))
      .sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role] || a.name.localeCompare(b.name)),
    invites: (check('pending_invites', invites) ?? []).map((i) => ({
      email: i.email,
      role: i.role,
      addedAt: i.created_at,
    })),
    sites: (check('sites', sites) ?? []).map((s) => ({
      id: s.id,
      name: s.name,
      live: s.is_active,
      ownerId: s.primary_owner_id,
      backupId: s.backup_owner_id,
    })),
    clients: (check('clients', clients) ?? []).map((c) => ({ id: c.id, name: c.name, amId: c.am_user_id })),
    rotation: (check('oncall_rotation', rotation) ?? []).map((r) => r.user_id),
    shifts: (check('oncall_shifts', shifts) ?? []).map((s) => ({
      id: s.id,
      userId: s.user_id,
      startsAt: s.starts_at,
      endsAt: s.ends_at,
    })),
    swaps: (check('oncall_swaps', swaps) ?? []).map((w) => ({
      id: w.id,
      requesterId: w.requester_id,
      counterpartId: w.counterpart_id,
    })),
    acks: (check('incidents', acks) ?? []).map((i) => ({
      label: `${formatIncidentId(i.number)} · ${siteName(i.sites)}`,
      ackedBy: i.acked_by!,
    })),
    managementUsed: allSteps.some((s) => s.targets.includes('management')),
    managementOpen: (check('incidents', plans) ?? []).some((i) => planNamesManagement(i.escalation_plan)),
    ceoSteps: ceoStepsLine(
      allSteps
        .filter((s) => s.policy_id === t1?.id)
        .map((s) => ({ level: s.level, delayMin: s.delay_min, targets: s.targets, fyi: s.fyi })),
    ),
  };
}

/**
 * Sign-in & security (S16 PR 3) as the signed-in Admin: the Users page's people, every session
 * (`list_sessions` with no person = everyone, Admin only) and the newest sign-in rows of the audit log —
 * enough to find each person's last "signed out everywhere" for the table's Last sign-in.
 */
export async function loadSecurityData(
  db: DbClient,
  viewerId: string,
  domains: string[],
  now: Date,
): Promise<SecurityData> {
  const [profiles, invites, shifts, sessions, entries, signOuts] = await Promise.all([
    db.from('profiles').select('id, display_name, email, role, google_chat_user_id, is_active'),
    db.rpc('pending_invites'),
    db
      .from('oncall_shifts')
      .select('id, user_id, starts_at, ends_at')
      .gt('ends_at', now.toISOString())
      .order('starts_at'),
    db.rpc('list_sessions'),
    db
      .from('audit_log')
      .select('at, action, actor_id, entity_id, before, after')
      .in('action', [...SIGNIN_ACTIONS])
      .order('at', { ascending: false })
      .limit(20),
    // Each person's last "signed out everywhere" (Last sign-in, D-062 item 12): a few rows a month.
    db
      .from('audit_log')
      .select('at, action, actor_id, entity_id')
      .eq('action', 'session.sign_out_all')
      .order('at', { ascending: false })
      .limit(500),
  ]);
  const everyone = check('profiles', profiles) ?? [];
  const sessionRows = check('list_sessions', sessions) ?? [];
  return {
    viewerId,
    domains,
    people: everyone
      .filter((p) => p.is_active)
      .map((p) => ({
        id: p.id,
        name: p.display_name,
        email: p.email,
        role: p.role as Role,
        chatLinked: !!p.google_chat_user_id?.trim(),
        lastActive: null,
      })),
    invites: (check('pending_invites', invites) ?? []).map((i) => ({
      email: i.email,
      role: i.role,
      addedAt: i.created_at,
    })),
    shifts: (check('oncall_shifts', shifts) ?? []).map((s) => ({
      id: s.id,
      userId: s.user_id,
      startsAt: s.starts_at,
      endsAt: s.ends_at,
    })),
    sessions: sessionRows.map((s) => ({
      id: s.id,
      userId: s.user_id,
      userAgent: s.user_agent,
      createdAt: s.created_at,
      lastUsed: s.last_used,
      current: s.is_current,
    })),
    names: Object.fromEntries(everyone.map((p) => [p.id, p.display_name])),
    entries: (check('audit_log', entries) ?? []).map(accessEntry),
    signOuts: (check('audit_log sign-outs', signOuts) ?? []).map((e) =>
      accessEntry({ ...e, before: null, after: null }),
    ),
  };
}

const accessEntry = (e: {
  at: string;
  action: string;
  actor_id: string | null;
  entity_id: string | null;
  before: unknown;
  after: unknown;
}) => ({
  at: e.at,
  action: e.action,
  actorId: e.actor_id,
  entityId: e.entity_id,
  before: e.before,
  after: e.after,
});

/** The table's order: Admins first, then Responders, Stakeholders, Viewers; by name within. */
const ROLE_ORDER: Record<Role, number> = { admin: 0, responder: 1, stakeholder: 2, viewer: 3, client: 4 };
