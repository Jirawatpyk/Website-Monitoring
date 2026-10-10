import 'server-only';
import { isInsideHours, nextOpening, scheduleOf } from '@dxt/engine';
import type { ChatPerson, LadderFacts, LadderStopped } from '@dxt/notifier';
import { escalationPlanSchema, TIER_CONFIG, type EscalationTarget, type Tier } from '@dxt/shared';
import { contextOf, type IncidentFacts, type Owner } from './facts';

/**
 * The ladder's words for a message (S08, D-034), from the plan the incident opened with: the next
 * level and who it asks / tells FYI, the timers paused outside response hours, what an ack stopped,
 * and the people a step or reminder named by id. Mirrors the SQL rules (`engine_fire_step`): a step's
 * tokens minus anyone already told (L0 = the owner); an Admin named next to someone else is FYI.
 */

const planOf = (i: IncidentFacts) => {
  const p = escalationPlanSchema.safeParse(i.escalation_plan);
  return p.success ? p.data : null;
};

const ROLE: Record<EscalationTarget, string> = {
  owner: 'owner',
  backup: 'backup',
  admins: 'Admin',
  site_am: 'account manager',
  ceo: 'CEO',
};

/** The people a token names for this incident's site. */
function peopleOf(i: IncidentFacts, token: EscalationTarget): Owner[] {
  switch (token) {
    case 'owner':
      return i.sites.primary ? [i.sites.primary] : [];
    case 'backup':
      return i.sites.backup ? [i.sites.backup] : [];
    case 'site_am':
      return i.sites.client?.am ? [i.sites.client.am] : [];
    case 'admins':
      return i.ladder?.admins ?? [];
    case 'ceo':
      return [];
  }
}

/** Who a step asks and tells FYI, minus those already told (L0's people). */
function stepPeople(i: IncidentFacts, level: number) {
  const plan = planOf(i);
  const step = plan?.steps.find((s) => s.level === level);
  if (!plan || !step) return null;
  const told = new Set(
    plan.steps
      .filter((s) => s.level < level)
      .flatMap((s) => s.targets.flatMap((t) => peopleOf(i, t).map((p) => p.id))),
  );
  const seen = new Set<string>();
  const named = step.targets.flatMap((token) =>
    peopleOf(i, token)
      .filter((p) => !told.has(p.id) && !seen.has(p.id) && seen.add(p.id))
      .map((p) => ({ ...p, token })),
  );
  const others = named.some((p) => p.token !== 'admins');
  return {
    delayMin: step.delayMin,
    ask: named.filter((p) => !(others && p.token === 'admins')),
    fyi: named.filter((p) => others && p.token === 'admins'),
  };
}

const alwaysOn = (tier: number) => TIER_CONFIG[tier as Tier]?.alwaysOn ?? false;

/** The first card's ladder: the next level (when, who) and the paused timers (Tier 2–3 outside hours). */
export function ladderFactsOf(i: IncidentFacts, at: Date): LadderFacts | null {
  const plan = planOf(i);
  const hours = i.ladder?.hours;
  if (!plan || !hours) return null;
  const level = (i.escalation_level ?? 0) + 1;
  const due = scheduleOf({ plan, detectedAt: new Date(i.detected_at), hours }).find((s) => s.level === level);
  const people = stepPeople(i, level);
  const paused = !alwaysOn(plan.tier) && !isInsideHours(at, hours) ? nextOpening(at, hours) : null;
  return {
    next:
      due && people && people.ask.length + people.fyi.length > 0
        ? {
            level,
            at: due.dueAt,
            ask: people.ask.map((p) => p.display_name),
            fyi: people.fyi.map((p) => p.display_name),
          }
        : null,
    pausedUntil: paused,
  };
}

/** What the ack stopped: only for an incident with a ladder. */
export function stoppedOf(i: IncidentFacts, ctx: Record<string, unknown>): LadderStopped | null {
  const plan = planOf(i);
  if (!plan) return null;
  return {
    severity: plan.severity,
    backup: i.sites.backup?.display_name ?? null,
    l1Fired: typeof ctx.escalationLevel === 'number' && ctx.escalationLevel >= 1,
  };
}

/** Everyone the facts know by id: owner, backup, the client's AM, the Admins. */
function directory(i: IncidentFacts): Map<string, Owner & { token: EscalationTarget }> {
  const all: (Owner & { token: EscalationTarget })[] = [
    ...(i.ladder?.admins ?? []).map((p) => ({ ...p, token: 'admins' as const })),
    ...(i.sites.client?.am ? [{ ...i.sites.client.am, token: 'site_am' as const }] : []),
    ...(i.sites.backup ? [{ ...i.sites.backup, token: 'backup' as const }] : []),
    ...(i.sites.primary ? [{ ...i.sites.primary, token: 'owner' as const }] : []),
  ];
  return new Map(all.map((p) => [p.id, p]));
}

const chatPerson = (p: Owner): ChatPerson => ({ name: p.display_name, chatUserId: p.google_chat_user_id });
const ids = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];

/** The people a `step_fired` / `reminder` row names, as the SQL stored them. */
export function namedIn(i: IncidentFacts, context: unknown) {
  const ctx = contextOf(context as never);
  const dir = directory(i);
  const pick = (key: string) => ids(ctx[key]).flatMap((id) => (dir.get(id) ? [dir.get(id)!] : []));
  return {
    asked: pick('mentioned').map((p) => ({ ...chatPerson(p), role: ROLE[p.token] })),
    fyi: pick('fyi').map(chatPerson),
    mentioned: pick('mentioned').map(chatPerson),
    askedNames: pick('mentioned').map((p) => p.display_name),
  };
}

/** The L1 email footer: why this person got it (EmailAlert). */
export function stepWhy(i: IncidentFacts, userId: string, level: number, asFyi: boolean): string {
  const p = directory(i).get(userId);
  const delay = planOf(i)?.steps.find((s) => s.level === level)?.delayMin;
  const site = i.sites.name;
  if (asFyi) return `You got this because you’re the Admin — L${level} keeps you informed.`;
  if (p?.token === 'backup')
    return `You got this because you’re backup for ${site} and it wasn’t acknowledged in ${delay ?? 15} min.`;
  if (p?.token === 'site_am') return `You got this because you’re the account manager for ${site}.`;
  return `You got this because ${site} wasn’t acknowledged in ${delay ?? 15} min and L${level} names you.`;
}
