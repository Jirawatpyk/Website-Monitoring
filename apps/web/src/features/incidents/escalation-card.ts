import { ladderClockStart, scheduleOf } from '@dxt/engine';
import { formatTime, type EscalationPlan, type EscalationTarget, type ResponseHours } from '@dxt/shared';

/**
 * The Escalation card (S12b, spec §8, §30.6–8; Incident / MIncident CASE Manual): the incident's ladder,
 * what went and when, and — only while no engine run of any kind happened for 3 min (D-055 item 1) —
 * Escalate now for the people who may acknowledge. Once the engine is back the levels sent by hand don't
 * repeat: the engine's own guard (`engine_fire_step`) sees them.
 */

export interface StepSent {
  level: number;
  at: string;
  /** Escalate now: who sent it; null = the engine. */
  sentBy: string | null;
}

/** The people a plan's tokens name on this incident (`escalation_people`, in words). */
export interface LadderPeople {
  /** L0: the person on call when L0 paged them, else the owner. */
  owner: { name: string; onCall: boolean } | null;
  backup: string | null;
  am: string | null;
  admins: readonly string[];
}

export interface LadderRow {
  label: string;
  /** "+15 min · 02:46" (L0 "0 min · 02:31"). */
  when: string;
  who: string;
  status: string;
  tone: 'sent' | 'next' | 'waits' | 'cancelled';
}

export interface EscalateButton {
  level: number;
  /** "Escalate now · L1 (Arm, backup · Tao)". */
  label: string;
  /** "Send L1 now?" */
  title: string;
  people: { name: string; role: string }[];
  cta: string;
}

export interface EscalationCardView {
  title: string;
  rows: LadderRow[];
  /** The danger note while the engine is stopped and it waits for an ack. */
  stopped: string | null;
  /** "Automatic escalation is running again — levels already sent won't repeat." */
  back: string | null;
  /** While it waits for an ack and the engine runs: "Next: L2 at 03:01 if still unacked." (§30.8, §31.7). */
  nextLine: string | null;
  button: EscalateButton | null;
  footer: string;
}

const WAITING = new Set(['unacked', 'escalated']);

const roleWord: Record<EscalationTarget, string> = {
  owner: 'owner',
  backup: 'backup',
  admins: 'Admin',
  ceo: 'CEO',
  site_am: 'Site AM',
};

function peopleOf(targets: readonly EscalationTarget[], p: LadderPeople): { name: string; role: string }[] {
  return targets.flatMap((t) => {
    if (t === 'owner')
      return p.owner ? [{ name: p.owner.name, role: p.owner.onCall ? 'on call' : 'owner' }] : [];
    if (t === 'backup') return p.backup ? [{ name: p.backup, role: 'backup' }] : [];
    if (t === 'site_am') return p.am ? [{ name: p.am, role: 'Site AM' }] : [];
    if (t === 'ceo') return [{ name: 'CEO', role: 'CEO' }];
    return p.admins.filter((a) => a !== p.owner?.name).map((a) => ({ name: a, role: roleWord.admins }));
  });
}

/** The ladder row's "who": "Arm (backup) + Tao" — the CEO by role. */
const whoOf = (targets: readonly EscalationTarget[], p: LadderPeople, space: boolean) => {
  const names = peopleOf(targets, p).map((x) =>
    x.name === 'CEO'
      ? 'CEO'
      : x.role === 'Admin'
        ? x.name
        : `${x.name} (${x.role === 'Site AM' ? 'AM' : x.role})`,
  );
  return [names.join(' + ') || 'Nobody', ...(space ? ['Alerts Space'] : [])].join(' + ');
};

/** The button's words (§30.6): "L1 (Arm, backup · Tao)", "L2 (CEO)", "L3 (CEO + Thee, Site AM)". */
const buttonWho = (targets: readonly EscalationTarget[], p: LadderPeople) => {
  const parts = peopleOf(targets, p).map((x) =>
    x.name === 'CEO' ? 'CEO' : x.role === 'Admin' ? x.name : `${x.name}, ${x.role}`,
  );
  return parts.join(targets.includes('ceo') ? ' + ' : ' · ');
};

/**
 * The Resolve condition while the pre-fire reminder card shows (D-055 item 3): "Due 02:46 · Tier 1 client
 * site", not met — so the two cards agree. Resolve stays locked by OK-for-2-rounds anyway.
 */
export function pendingClientUpdate<
  G extends {
    conditions: { key: string; met: boolean; detail: string }[];
    metCount: number;
    lockedReason: string | null;
  },
>(reminder: { dueAt: string } | null, gate: G): G {
  if (!reminder) return gate;
  const conditions = gate.conditions.map((c) =>
    c.key === 'client_update' ? { ...c, met: false, detail: `Due ${reminder.dueAt} · client site` } : c,
  );
  const metCount = conditions.filter((c) => c.met).length;
  // The locked line counts the same conditions as the card's header (staging /verify, 4 Nov).
  const lockedReason = gate.lockedReason?.replace(/· \d of 3 met/, `· ${metCount} of 3 met`) ?? null;
  return { ...gate, conditions, metCount, lockedReason };
}

export function escalationCardOf(input: {
  plan: EscalationPlan | null;
  tier: number;
  severity: 'down' | 'problem';
  level: number;
  state: string;
  detectedAt: string;
  alertedAt: string | null;
  hours: ResponseHours;
  steps: readonly StepSent[];
  people: LadderPeople;
  acked: { by: string } | null;
  /** No engine run of any kind for 3 min or more (D-055 item 1); `since` the last run. */
  engine: { stopped: boolean; since: string | null };
  canAct: boolean;
}): EscalationCardView | null {
  const { plan } = input;
  if (!plan) return null;
  const start = ladderClockStart({
    detectedAt: new Date(input.detectedAt),
    alertedAt: input.alertedAt ? new Date(input.alertedAt) : null,
  });
  const due = new Map(
    scheduleOf({ plan, detectedAt: start, hours: input.hours }).map((s) => [s.level, s.dueAt]),
  );
  const waiting = WAITING.has(input.state);
  const steps = [...plan.steps].sort((a, b) => a.level - b.level);
  const sentAt = new Map(input.steps.map((s) => [s.level, s]));
  const byHand = input.steps.some((s) => s.sentBy);
  const next = steps.find((s) => s.level > input.level && !sentAt.has(s.level));

  const rows = steps.map((s): LadderRow => {
    const at = due.get(s.level)!;
    const when = s.level === 0 ? `0 min · ${formatTime(at)}` : `+${s.delayMin} min · ${formatTime(at)}`;
    const who = whoOf(s.targets, input.people, s.level === 0 && s.channels.includes('space'));
    const sent = s.level === 0 ? { at: start.toISOString(), sentBy: null } : sentAt.get(s.level);
    if (sent || (s.level > 0 && s.level <= input.level)) {
      const t = sent ? formatTime(new Date(sent.at)) : null;
      return {
        label: `L${s.level}`,
        when,
        who,
        status: sent?.sentBy ? `Sent ${t} by ${sent.sentBy}` : t ? `Sent ${t}` : 'Sent',
        tone: 'sent',
      };
    }
    // The Tier 1 CEO + AM FYI still goes after an ack while the drop is DOWN (§14.1, D-048).
    if (!waiting && s.fyi && input.state === 'acknowledged' && input.severity === 'down')
      return input.engine.stopped
        ? { label: `L${s.level}`, when, who, status: 'Waits — engine down', tone: 'waits' }
        : { label: `L${s.level}`, when, who, status: `At ${formatTime(at)} · FYI`, tone: 'waits' };
    if (!waiting)
      return {
        label: `L${s.level}`,
        when,
        who,
        status: input.acked ? 'Cancelled · acked' : 'Not sent · recovered',
        tone: 'cancelled',
      };
    const isNext = s === next;
    if (input.engine.stopped)
      return {
        label: `L${s.level}`,
        when,
        who,
        status: isNext ? 'Waits — engine down' : 'Waits',
        tone: isNext ? 'next' : 'waits',
      };
    return {
      label: `L${s.level}`,
      when,
      who,
      status: isNext ? `At ${formatTime(at)} if unacked` : 'If still unacked',
      tone: isNext ? 'next' : 'waits',
    };
  });

  const stopped =
    input.engine.stopped && waiting
      ? `Nothing escalates on its own — the status engine is down${input.engine.since ? ` since ${formatTime(new Date(input.engine.since))}` : ''}${next && input.canAct ? '. Send the next level by hand if nobody acknowledges.' : '.'}`
      : null;
  const people = next ? peopleOf(next.targets, input.people) : [];
  return {
    title: `Escalation · Tier ${input.tier} ${input.severity === 'down' ? 'DOWN' : 'PROBLEM'}`,
    rows,
    stopped,
    back:
      !input.engine.stopped && byHand && !['resolved', 'in_review', 'closed'].includes(input.state)
        ? 'Automatic escalation is running again — levels already sent won’t repeat.'
        : null,
    nextLine:
      !input.engine.stopped && waiting && next && due.get(next.level)
        ? `Next: L${next.level} at ${formatTime(due.get(next.level)!)} if still unacked.`
        : null,
    button:
      stopped && next && input.canAct
        ? {
            level: next.level,
            label: `Escalate now · L${next.level} (${buttonWho(next.targets, input.people)})`,
            title: `Send L${next.level} now?`,
            people: people.map((x) => ({ name: x.name, role: x.name === 'CEO' ? `L${next.level}` : x.role })),
            cta: `Send L${next.level} now`,
          }
        : null,
    footer: input.acked
      ? `Acknowledged by ${input.acked.by} → escalation stopped. The client-update track continues.`
      : 'Acknowledge stops escalation. It does not stop the client update.',
  };
}
