import 'server-only';
import { isInsideHours, ladderClockStart, nextOpening, problemHoldUntil, scheduleOf } from '@dxt/engine';
import type { ChatPerson, LadderFacts, LadderStopped } from '@dxt/notifier';
import {
  escalationPlanSchema,
  formatDuration,
  formatTime,
  TIER_CONFIG,
  type EscalationTarget,
  type Tier,
} from '@dxt/shared';
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
      return i.ladder?.ceo ?? [];
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
  // A card sent after the incident moved on (acknowledged, recovered) promises nothing.
  if (!plan || !hours || !['unacked', 'escalated'].includes(i.state)) return null;
  const level = (i.escalation_level ?? 0) + 1;
  const due = scheduleOf({ plan, detectedAt: clockOf(i), hours }).find((s) => s.level === level);
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
  const fyiStep = plan.steps.find((s) => s.fyi);
  const hours = i.ladder?.hours;
  const fyiAt =
    fyiStep && hours
      ? scheduleOf({ plan, detectedAt: clockOf(i), hours }).find((s) => s.level === fyiStep.level)?.dueAt
      : undefined;
  const ackedAt = typeof ctx.ackedAt === 'string' ? new Date(ctx.ackedAt) : null;
  const fired = typeof ctx.escalationLevel === 'number' ? ctx.escalationLevel : 0;
  return {
    severity: plan.severity,
    backup: i.sites.backup?.display_name ?? null,
    l1Fired: fired >= 1,
    reminderMin: plan.reminderMin,
    // §14.1: "Acknowledge stops L1 and L2" — every level but the FYI.
    stopsThrough: Math.max(1, ...plan.steps.filter((s) => !s.fyi).map((s) => s.level)),
    firedLevel: fired,
    site: i.sites.name,
    // Promised only while it's still ahead of the ack (engine review L2).
    fyi:
      fyiStep && fyiAt && (!ackedAt || fyiAt > ackedAt)
        ? {
            level: fyiStep.level,
            at: fyiAt,
            who: fyiStep.targets.flatMap((t) => tokenWords(i, t)).join(' + '),
          }
        : null,
  };
}

/** The roles a token is named by in a message: "CEO + Bua". */
const tokenWords = (i: IncidentFacts, token: EscalationTarget) =>
  token === 'ceo' ? ['CEO'] : peopleOf(i, token).map((p) => p.display_name);

/**
 * What a fired step is and the words around it (S10, D-048): `kind` (the SQL's `fyiStep` / `reminder`;
 * a step naming the CEO is the L2 page), the level after it if nobody acknowledges ("· CEO at 10:18"),
 * everyone told before it ("Arm, Ploy, Tao informed"), who acknowledged (the FYI), and whether the step
 * carries the voice call that stays off.
 */
export function stepFactsOf(i: IncidentFacts, context: unknown) {
  const ctx = contextOf(context as never);
  const plan = planOf(i);
  const level = typeof ctx.level === 'number' ? ctx.level : 1;
  const step = plan?.steps.find((s) => s.level === level);
  const kind: 'ask' | 'ceo' | 'fyi' | 'reminder' =
    ctx.fyiStep === true
      ? 'fyi'
      : ctx.reminder === true
        ? 'reminder'
        : step?.targets.includes('ceo')
          ? 'ceo'
          : 'ask';
  const hours = i.ladder?.hours;
  const after = plan?.steps.find((s) => s.level === level + 1);
  const afterAt =
    plan && after && hours
      ? scheduleOf({ plan, detectedAt: clockOf(i), hours }).find((s) => s.level === after.level)?.dueAt
      : undefined;
  // Everyone told before this step, minus this step's own people (the CEO isn't "informed" in the
  // FYI the CEO receives — message-check 8), each with the role the EmailAlert L2 lede names.
  const own = new Set(step?.targets.flatMap((t) => tokenWords(i, t)) ?? []);
  const earlier = (plan?.steps ?? []).filter((s) => s.level < level && !s.fyi);
  const told = new Map<string, string>();
  for (const s of earlier)
    for (const t of s.targets)
      for (const name of tokenWords(i, t))
        if (!own.has(name) && !told.has(name))
          told.set(name, t === 'owner' ? `${name} (owner)` : t === 'backup' ? `${name} (backup)` : name);
  const informed = [...told.keys()];
  const schedule = plan && hours ? scheduleOf({ plan, detectedAt: clockOf(i), hours }) : [];
  // "Arm 09:48 · Ploy + Tao 10:03" (EmailAlert L2 "Already told").
  const alreadyTold = earlier
    .map((s) => {
      const names = [...new Set(s.targets.flatMap((t) => tokenWords(i, t)))].filter((n) => !own.has(n));
      const at = schedule.find((x) => x.level === s.level)?.dueAt;
      return names.length && at ? `${names.join(' + ')} ${formatTime(at)}` : null;
    })
    .filter((x): x is string => !!x)
    .join(' · ');
  const ackedAt = typeof ctx.ackedAt === 'string' ? new Date(ctx.ackedAt) : null;
  const stopsThrough = Math.max(1, ...(plan?.steps ?? []).filter((s) => !s.fyi).map((s) => s.level));
  // A next level that only reminds people already told (Tier 2–3 L2 → the Admin) isn't an escalation
  // to announce: "· CEO at 10:18" is Tier 1's.
  const afterPeople = after ? stepPeople(i, after.level) : null;
  const afterIsNew = !!afterPeople && afterPeople.ask.length + afterPeople.fyi.length > 0;
  return {
    kind,
    next:
      kind === 'ask' && after && afterAt && afterIsNew
        ? { who: after.targets.flatMap((t) => tokenWords(i, t)).join(' + '), at: afterAt }
        : null,
    // "L3 (CEO + Bua, no call) at 10:48" on the CEO's L2 email.
    nextStep:
      kind === 'ceo' && after && afterAt
        ? `L${after.level} (${after.targets.flatMap((t) => tokenWords(i, t)).join(' + ')}${after.fyi ? ', no call' : ''}) at ${formatTime(afterAt)}`
        : null,
    informed,
    informedRoles: [...told.values()],
    alreadyTold: alreadyTold || null,
    // "Open it to see the latest, or call Tao." — the Admin the CEO can ring.
    admin: i.ladder?.admins[0]?.display_name ?? null,
    acked: typeof ctx.ackedBy === 'string' && ackedAt ? { by: ctx.ackedBy, at: ackedAt } : null,
    stopped: stopsThrough > 1 ? `L1–L${stopsThrough} stopped` : 'L1 stopped',
    voiceConfigured: step?.channels.includes('voice') ?? false,
  };
}

/** Where the ladder's clock starts: Confirmed down, or the late alert after a mute (D-036). */
function clockOf(i: IncidentFacts): Date {
  return ladderClockStart({
    detectedAt: new Date(i.detected_at),
    alertedAt: i.alerted_at ? new Date(i.alerted_at) : null,
  });
}

/**
 * When the owner was told: at detection, or when a mute that held the alert back was over, or — a
 * Tier 2–3 PROBLEM held overnight — at the opening.
 */
export function toldAtOf(i: IncidentFacts): Date {
  const detected = clockOf(i);
  const hours = i.ladder?.hours;
  if (i.severity !== 'problem' || !hours) return detected;
  return problemHoldUntil(i.sites.tier as Tier, detected, hours) ?? detected;
}

/** Everyone the facts know by id: owner, backup, the client's AM, the Admins. */
function directory(i: IncidentFacts): Map<string, Owner & { token: EscalationTarget }> {
  const all: (Owner & { token: EscalationTarget })[] = [
    ...(i.ladder?.ceo ?? []).map((p) => ({ ...p, token: 'ceo' as const })),
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

/** How the email reader is named at a step: the FYI words differ for the CEO and the site's AM. */
export function readerOf(i: IncidentFacts, userId: string): 'ceo' | 'site_am' | 'other' {
  const token = directory(i).get(userId)?.token;
  return token === 'ceo' || token === 'site_am' ? token : 'other';
}

/** The step email's footer: why this person got it (EmailAlert L1 / L2 / L3). */
export function stepWhy(
  i: IncidentFacts,
  userId: string,
  level: number,
  asFyi: boolean,
  kind: 'ask' | 'ceo' | 'fyi' | 'reminder' = 'ask',
): string {
  const p = directory(i).get(userId);
  const delay = planOf(i)?.steps.find((s) => s.level === level)?.delayMin;
  const site = i.sites.name;
  // Durations in the spec's format (§13: "1 h", not the board's "60 min").
  const minutes = formatDuration(delay ?? 15);
  if (kind === 'ceo')
    return `You got this because a Tier 1 site was down ${minutes} without an acknowledgement (L${level}, the step you approved).`;
  if (kind === 'fyi')
    return p?.token === 'site_am'
      ? `You got this because you’re the AM for ${site} and a Tier 1 site is still down after ${minutes}.`
      : `You got this because ${site} (Tier ${i.sites.tier}) is still down after ${minutes} — the FYI step that runs even after an acknowledgement. No call.`;
  if (kind === 'reminder')
    return `You got this because ${site} wasn’t acknowledged in ${minutes} — L${level} reminds you.`;
  if (asFyi) return `You got this because you’re the Admin — L${level} keeps you informed.`;
  if (p?.token === 'backup')
    return `You got this because you’re backup for ${site} and it wasn’t acknowledged in ${delay ?? 15} min.`;
  if (p?.token === 'site_am') return `You got this because you’re the account manager for ${site}.`;
  return `You got this because ${site} wasn’t acknowledged in ${delay ?? 15} min and L${level} names you.`;
}
