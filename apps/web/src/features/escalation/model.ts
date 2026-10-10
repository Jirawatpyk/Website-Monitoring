import {
  ESCALATION_CHANNEL_LABELS,
  ESCALATION_TARGET_LABELS,
  formatIncidentId,
  MIN_STEP_DELAY_MIN,
  type EscalationChannel,
  type EscalationStep,
  type EscalationTarget,
} from '@dxt/shared';

/**
 * The Escalation page's rules (S08, D-034; Escalation board, spec §14.7, §15.5), pure so the page and
 * its tests share them. The same guardrails run again in `save_escalation_policies`.
 */

export type PolicyKey = 't1' | 't2' | 't3' | 'problem';

export interface PolicyDraft {
  id: string;
  key: PolicyKey;
  severity: 'down' | 'problem';
  tier: number | null;
  steps: EscalationStep[];
}

export interface EscalationDraft {
  policies: PolicyDraft[];
  /** Text fields: kept as typed until saved. */
  downReminder: string;
  problemReminder: string;
}

/** S08 edits L0–L1 (L2+ with S10, D-034). */
export const MAX_LEVEL = 1;

export const POLICY_LABELS: Record<PolicyKey, string> = {
  t1: 'Tier 1 DOWN',
  t2: 'Tier 2 DOWN',
  t3: 'Tier 3 DOWN',
  problem: 'PROBLEM · all tiers',
};

/** Short form for the save dialog's rows and the unsaved bar ("Tier 1 DOWN", "PROBLEM"). */
export const policyShort = (key: PolicyKey) => (key === 'problem' ? 'PROBLEM' : POLICY_LABELS[key]);

export const policyKeyOf = (severity: 'down' | 'problem', tier: number | null): PolicyKey =>
  severity === 'problem' ? 'problem' : (`t${tier ?? 1}` as PolicyKey);

/** The clock line beside the policy switch (Escalation board); `hours` = "Mon–Fri 09:00–18:00" from settings. */
export function timerBasis(key: PolicyKey, hours: string): string {
  if (key === 't1') return 'Tier 1 · timers run 24/7 from “Confirmed down”';
  if (key === 'problem') return `Tier 1 runs 24/7 · Tier 2–3 wait for ${hours}`;
  return `Tier 2 and 3 share hours: ${hours}`;
}

/** "+0 · immediately" / "+15 min". */
export const stepWhen = (s: EscalationStep) => (s.level === 0 ? '+0 · immediately' : `+${s.delayMin} min`);

/** The row's condition line (Escalation board; the phone's shorter "any hour", MEscalation). */
export function stepCondition(p: PolicyDraft, s: EscalationStep, phone = false): string {
  if (s.level > 0) return 'No acknowledgement';
  if (p.severity === 'problem') return 'PROBLEM confirmed';
  if (p.key === 't1') return 'DOWN confirmed';
  return phone ? 'DOWN confirmed · any hour' : 'DOWN confirmed · posted at any hour';
}

/**
 * The row's note (Escalation board / MEscalation; on-call wording waits for S10). The phone has no
 * locked checkboxes to talk about, and says the PROBLEM hold once, in its subtitle.
 */
export function stepNote(p: PolicyDraft, s: EscalationStep, phone = false): string | null {
  if (s.level > 0) return 'Anyone already paged is left out.';
  if (p.severity === 'down') {
    if (p.key !== 't1')
      return 'Outside response hours it still posts, but the timers below wait for the next opening.';
    return phone
      ? 'Only this person is @mentioned; the backup is named in plain text.'
      : 'Chat @mention and Alerts Space are locked on. Only the owner is @mentioned; the backup is named in plain text.';
  }
  return phone ? null : 'Tier 2–3 outside response hours are held until the next opening.';
}

const ORDER: readonly EscalationTarget[] = ['owner', 'backup', 'admins', 'site_am', 'ceo'];
const CHANNEL_ORDER: readonly EscalationChannel[] = ['chat', 'space', 'email', 'voice'];

/** "Backup", "Admin (Tao)" — the Admin token names every active Admin (D-034). */
export const targetLabels = (s: EscalationStep, admins: readonly string[] = []) =>
  ORDER.filter((t) => s.targets.includes(t)).map((t) =>
    t === 'admins' && admins.length ? `Admin (${admins.join(', ')})` : ESCALATION_TARGET_LABELS[t],
  );
export const channelLabels = (s: EscalationStep) =>
  CHANNEL_ORDER.filter((c) => s.channels.includes(c)).map((c) => ESCALATION_CHANNEL_LABELS[c]);

/** "+15 min · Backup + Admin · Chat @mention, Email" (the save dialog's diff). */
export function describeStep(s: EscalationStep): string {
  return [
    s.level === 0 ? '+0' : `+${s.delayMin} min`,
    targetLabels(s).join(' + ') || 'nobody',
    channelLabels(s).join(', ') || 'no channel',
  ].join(' · ');
}

/** A step's blocking errors, in the board's words and order. */
export function stepErrors(steps: readonly EscalationStep[], i: number): string[] {
  const s = steps[i];
  if (!s) return [];
  const errs: string[] = [];
  if (!s.channels.length) errs.push('No channel ticked — this step notifies nobody.');
  if (!s.targets.length) errs.push('Pick at least one person.');
  if (i > 0 && s.delayMin < MIN_STEP_DELAY_MIN) errs.push(`Must be at least +${MIN_STEP_DELAY_MIN} min.`);
  const prev = steps[i - 1];
  if (i > 0 && prev && s.delayMin <= prev.delayMin) {
    errs.push(`Must be later than L${i - 1} (+${prev.delayMin} min).`);
  }
  return errs;
}

/** The policy's own message under its steps: a DOWN needs a step after L0; PROBLEM only warns. */
export function policyMessage(p: PolicyDraft): { tone: 'danger' | 'warning'; text: string } | null {
  if (p.steps.length > 1) return null;
  return p.severity === 'down'
    ? {
        tone: 'danger',
        text: `${POLICY_LABELS[p.key]} needs at least one step after L0 — otherwise nobody else is ever told.`,
      }
    : {
        tone: 'warning',
        text: 'PROBLEM has no step after L0 — only the owner hears about it. Allowed, but the backup is never told.',
      };
}

const WHOLE = /^\d+$/;
export const reminderError = (v: string) =>
  WHOLE.test(v.trim()) && Number(v) > 0 && Number(v) <= 1440 ? null : 'Whole minutes above 0, e.g. 15';

/** Everything that blocks the save, one line each (the save dialog). */
export function saveProblems(d: EscalationDraft): string[] {
  const out: string[] = [];
  for (const p of d.policies) {
    p.steps.forEach((s, i) => {
      for (const e of stepErrors(p.steps, i))
        out.push(`${policyShort(p.key)} · L${i} (+${s.delayMin} min): ${e}`);
    });
    const m = policyMessage(p);
    if (m?.tone === 'danger') out.push(m.text);
  }
  for (const [label, v] of [
    ['DOWN reminder', d.downReminder],
    ['PROBLEM reminder', d.problemReminder],
  ] as const) {
    if (reminderError(v)) out.push(`${label}: “${v}” isn’t valid — enter whole minutes above 0.`);
  }
  return out;
}

export const saveWarnings = (d: EscalationDraft) =>
  d.policies.flatMap((p) => {
    const m = policyMessage(p);
    return m?.tone === 'warning' ? [m.text] : [];
  });

export interface DiffRow {
  where: string;
  before: string | null;
  after: string | null;
}

/** What changed since the saved policies (the save dialog's rows and the unsaved count). */
export function diff(saved: EscalationDraft, draft: EscalationDraft): DiffRow[] {
  const rows: DiffRow[] = [];
  for (const p of draft.policies) {
    const was = saved.policies.find((s) => s.id === p.id);
    const levels = Math.max(p.steps.length, was?.steps.length ?? 0);
    for (let i = 0; i < levels; i++) {
      const a = was?.steps[i];
      const b = p.steps[i];
      const before = a ? describeStep(a) : null;
      const after = b ? describeStep(b) : null;
      if (before !== after)
        rows.push({ where: `${policyShort(p.key)} · L${i}`, before, after: after ?? 'Removed' });
    }
  }
  for (const [label, a, b] of [
    ['DOWN reminder', saved.downReminder, draft.downReminder],
    ['PROBLEM reminder', saved.problemReminder, draft.problemReminder],
  ] as const) {
    if (a.trim() !== b.trim()) rows.push({ where: label, before: `every ${a} min`, after: `every ${b} min` });
  }
  return rows;
}

/** The unsaved bar: "1 unsaved change" + where ("In Tier 1 DOWN, PROBLEM" / "Reminder interval"). */
export function unsavedSummary(rows: readonly DiffRow[]): { label: string; hint: string } | null {
  if (!rows.length) return null;
  const places = [
    ...new Set(
      rows.map((r) => (r.where.includes('reminder') ? 'Reminder interval' : r.where.split(' · L')[0]!)),
    ),
  ];
  const policies = places.filter((p) => p !== 'Reminder interval');
  const hint = [
    ...(policies.length ? [`In ${policies.join(', ')}`] : []),
    ...(places.includes('Reminder interval') ? ['Reminder interval'] : []),
  ].join(' · ');
  return { label: `${rows.length} unsaved change${rows.length === 1 ? '' : 's'}`, hint };
}

/** The edit dialog's delay field: error (blocks Apply) or hint (Save stays blocked). */
export function delayCheck(
  value: string,
  steps: readonly EscalationStep[],
  i: number,
): { error: string | null; hint: string | null } {
  if (i === 0) return { error: null, hint: 'Pinned — fires immediately.' };
  if (!WHOLE.test(value.trim())) return { error: 'Enter whole minutes, e.g. 45', hint: null };
  const n = Number(value);
  if (n < MIN_STEP_DELAY_MIN)
    return { error: 'At least +15 min — L0 covers the first 15 minutes', hint: null };
  const prev = steps[i - 1];
  const next = steps[i + 1];
  if (prev && n <= prev.delayMin) {
    return {
      error: null,
      hint: `Earlier than L${i - 1} (+${prev.delayMin} min). You can apply it, but Save stays blocked until each step is later than the one before.`,
    };
  }
  if (next && n >= next.delayMin) {
    return {
      error: null,
      hint: `Later than L${i + 1} (+${next.delayMin} min). You can apply it, but Save stays blocked until each step is later than the one before.`,
    };
  }
  // The board's standing hint for a valid delay.
  return { error: null, hint: prev ? `Must be later than L${i - 1} (+${prev.delayMin} min).` : null };
}

/** "Affects 5 sites · 1 open incident (INC-0142) keeps its current timers" (the save dialog). */
export function affectsLine(sites: number, openIncidents: readonly number[]): string {
  const head = `Affects ${sites} site${sites === 1 ? '' : 's'}`;
  if (!openIncidents.length) return `${head} · no open incidents`;
  const ids = openIncidents.map(formatIncidentId).join(', ');
  return openIncidents.length === 1
    ? `${head} · 1 open incident (${ids}) keeps its current timers`
    : `${head} · ${openIncidents.length} open incidents (${ids}) keep their current timers`;
}

/** Whether a step can be deleted / a step added (S08: L1 only; L0 is pinned). */
export const canDelete = (s: EscalationStep) => s.level > 0;
export const canAdd = (p: PolicyDraft) => p.steps.length <= MAX_LEVEL;

/** A new L1: the last step's delay + 30 (at least 15), Chat + email, nobody picked (Escalation board). */
export function newStep(p: PolicyDraft): EscalationStep {
  const last = p.steps.at(-1);
  return {
    level: p.steps.length,
    delayMin: Math.max(MIN_STEP_DELAY_MIN, (last?.delayMin ?? 0) + 30),
    targets: [],
    channels: ['chat', 'email'],
  };
}

const sameSteps = (a: PolicyDraft | undefined, b: PolicyDraft) =>
  !!a && a.steps.map(describeStep).join('|') === b.steps.map(describeStep).join('|');

/**
 * The policies a save changes for new incidents: those whose steps changed, and every policy of a
 * severity whose reminder interval changed (the save dialog's "Affects …" line).
 */
export function affectedPolicies(saved: EscalationDraft, draft: EscalationDraft): PolicyDraft[] {
  const downReminder = saved.downReminder.trim() !== draft.downReminder.trim();
  const problemReminder = saved.problemReminder.trim() !== draft.problemReminder.trim();
  return draft.policies.filter(
    (p) =>
      !sameSteps(
        saved.policies.find((s) => s.id === p.id),
        p,
      ) || (p.severity === 'down' ? downReminder : problemReminder),
  );
}

/** The input `save_escalation_policies` takes: only the policies whose steps changed. */
export function toSaveInput(d: EscalationDraft, note: string, saved?: EscalationDraft) {
  return {
    policies: d.policies
      .filter(
        (p) =>
          !saved ||
          !sameSteps(
            saved.policies.find((s) => s.id === p.id),
            p,
          ),
      )
      .map((p) => ({
        policyId: p.id,
        steps: p.steps.map((s, level) => ({ ...s, level })),
      })),
    downReminderMin: Number(d.downReminder),
    problemReminderMin: Number(d.problemReminder),
    note,
  };
}
