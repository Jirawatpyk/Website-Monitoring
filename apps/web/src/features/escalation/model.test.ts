import type { EscalationStep } from '@dxt/shared';
import { describe, expect, it } from 'vitest';
import {
  addBlocked,
  affectedPolicies,
  affectsLine,
  canAdd,
  canDelete,
  canSwap,
  deleteLabel,
  delayCheck,
  fyiNote,
  moveLabels,
  stepCondition,
  stepNote,
  swapSteps,
  describeStep,
  diff,
  newStep,
  policyMessage,
  reminderError,
  saveProblems,
  saveWarnings,
  showsManagementLeftOut,
  stepErrors,
  targetLabels,
  toSaveInput,
  unsavedSummary,
  type EscalationDraft,
  type PolicyDraft,
} from './model';

const l0: EscalationStep = {
  level: 0,
  delayMin: 0,
  targets: ['owner'],
  channels: ['chat', 'space', 'email'],
};
const l1 = (over: Partial<EscalationStep> = {}): EscalationStep => ({
  level: 1,
  delayMin: 15,
  targets: ['backup', 'admins'],
  channels: ['chat', 'email'],
  ...over,
});
const t1 = (steps: EscalationStep[] = [l0, l1()]): PolicyDraft => ({
  id: 'p1',
  key: 't1',
  severity: 'down',
  tier: 1,
  steps,
});
const problem = (steps: EscalationStep[]): PolicyDraft => ({
  id: 'pp',
  key: 'problem',
  severity: 'problem',
  tier: null,
  steps,
});
const draft = (policies: PolicyDraft[], downReminder = '15', problemReminder = '60'): EscalationDraft => ({
  policies,
  downReminder,
  problemReminder,
});

describe('stepErrors — the board’s guardrails (spec §14.7, §15.5)', () => {
  it.each([
    ['the seed passes', l1(), []],
    ['under +15 min', l1({ delayMin: 10 }), ['Must be at least +15 min.']],
    ['no channel', l1({ channels: [] }), ['No channel ticked — this step notifies nobody.']],
    ['nobody', l1({ targets: [] }), ['Pick at least one person.']],
    // The board says the first that applies: under +15 covers "not later than L0".
    ['at +0', l1({ delayMin: 0 }), ['Must be at least +15 min.']],
    [
      'voice alone reaches nobody',
      l1({ channels: ['voice'] }),
      ['No channel ticked — this step notifies nobody.'],
    ],
  ])('%s', (_case, step, want) => {
    expect(stepErrors([l0, step], 1)).toEqual(want);
  });
});

// The S10 seed (spec §8): Tier 1 L2 CEO (voice configured), L3 CEO + Site AM FYI.
const l2ceo: EscalationStep = {
  level: 2,
  delayMin: 30,
  targets: ['ceo'],
  channels: ['chat', 'email', 'voice'],
};
const l3fyi: EscalationStep = {
  level: 3,
  delayMin: 60,
  targets: ['ceo', 'site_am'],
  channels: ['chat', 'email'],
  fyi: true,
};
const t1full = () => t1([l0, l1(), l2ceo, l3fyi]);
// D-078: Tier 1 L2 → Management, Chat + email.
const mgL2: EscalationStep = { level: 2, delayMin: 30, targets: ['management'], channels: ['chat', 'email'] };

describe('S10 — the CEO, the FYI step, moving steps (Escalation board, §14.7, §15.5)', () => {
  it('the seed passes', () => {
    const p = t1full();
    expect(p.steps.flatMap((_s, i) => stepErrors(p.steps, i, 't1'))).toEqual([]);
  });
  it.each<[string, EscalationStep[], number, 't1' | 't2', string[]]>([
    [
      'CEO on L1',
      [l0, l1({ targets: ['ceo'] })],
      1,
      't1',
      ['A step that pages the CEO can’t sit above L2.', 'The CEO can be paged only from L2 onward.'],
    ],
    [
      'CEO on Tier 2',
      [l0, l1(), { ...l2ceo, channels: ['chat', 'email'] }],
      2,
      't2',
      ['The CEO is paged only on Tier 1 DOWN — remove CEO from this step.'],
    ],
  ])('%s', (_case, steps, i, key, want) => {
    expect(stepErrors(steps, i, key)).toEqual(want);
  });
  it('the FYI step can’t be deleted or moved; L0 never moves', () => {
    expect(canDelete(l3fyi)).toBe(false);
    expect(deleteLabel(l3fyi)).toBe('The CEO + AM FYI step can’t be removed from Tier 1 DOWN');
    const steps = t1full().steps;
    expect(canSwap(steps, 2, 3)).toBe(false);
    expect(moveLabels(steps, 3)).toMatchObject({ up: 'The CEO + AM FYI step keeps its place', canUp: false });
    expect(moveLabels(steps, 1)).toMatchObject({
      up: 'L0 is pinned — nothing can move above it',
      canUp: false,
    });
  });
  it('a CEO step never lands above L2', () => {
    const steps = t1full().steps;
    expect(canSwap(steps, 1, 2)).toBe(false);
    expect(moveLabels(steps, 1).down).toBe('L2 tells the CEO — it can’t move up to L1');
    expect(moveLabels(steps, 2).up).toBe('A Management or CEO step can’t move above L2');
  });
  // D-078 (§43.9): the rules `save_escalation_policies` refuses with management_* / voice_not_here.
  it.each<[string, EscalationStep[], number, 't1' | 't2', string[] | undefined, string[]]>([
    ['Management at L2 with people tagged', [l0, l1(), mgL2], 2, 't1', ['Vee'], []],
    [
      'nobody tagged',
      [l0, l1(), mgL2],
      2,
      't1',
      [],
      ['Nobody is Management yet — set someone on Users & roles.'],
    ],
    ['the list not loaded', [l0, l1(), mgL2], 2, 't1', undefined, []],
    [
      'on L1',
      [l0, { ...l1(), targets: ['management'] }],
      1,
      't1',
      ['Vee'],
      ['Management can be told only from L2.'],
    ],
    [
      'on Tier 2',
      [l0, l1(), mgL2],
      2,
      't2',
      ['Vee'],
      ['Management is used only on Tier 1 DOWN — remove it from this step.'],
    ],
    [
      'with voice',
      [l0, l1(), { ...mgL2, channels: ['chat', 'email', 'voice'] }],
      2,
      't1',
      ['Vee'],
      ['No voice on a Management step — they’re told by Chat @mention + email.'],
    ],
  ])('Management: %s', (_case, steps, i, key, management, want) => {
    expect(stepErrors(steps, i, key, management)).toEqual(want);
  });
  it('a Management step never lands above L2; the labels say Management', () => {
    const steps = [l0, l1(), mgL2, l3fyi];
    expect(canSwap(steps, 1, 2)).toBe(false);
    expect(moveLabels(steps, 1).down).toBe('L2 tells Management — it can’t move up to L1');
    expect(targetLabels(mgL2, ['Tao'], ['Vee', 'Pim'])).toEqual(['Management · Vee, Pim']);
    expect(targetLabels(mgL2, ['Tao'], [])).toEqual(['Management · nobody yet']);
    expect(targetLabels(mgL2)).toEqual(['Management']);
  });
  it('the L1 Management line: Tier 1 Admin steps only; the phone says it in the note', () => {
    const t2 = { ...t1(), key: 't2' as const, tier: 2 };
    expect(showsManagementLeftOut(t1full(), l1())).toBe(true);
    expect(showsManagementLeftOut(t2, l1())).toBe(false);
    expect(showsManagementLeftOut(t1full(), l0)).toBe(false);
    expect(stepNote(t1full(), l1(), true, ['Tao'], 'h')).toBe(
      'Anyone already paged is left out. Admins who are Management are left out here — they get L2.',
    );
    expect(stepNote(t2, l1(), true, ['Tao'], 'h')).toBe('Anyone already paged is left out.');
    expect(stepNote(t1full(), mgL2, true, [], 'h')).toBe(
      'Asked to step in and find someone to take it. No voice call.',
    );
  });
  it('swapping keeps each level’s delay', () => {
    const steps = [l0, l1(), { ...l1({ targets: ['admins'] }), level: 2, delayMin: 30 }];
    expect(swapSteps(steps, 1, 2).map((s) => [s.level, s.delayMin, s.targets.join('+')])).toEqual([
      [0, 0, 'owner'],
      [1, 15, 'admins'],
      [2, 30, 'backup+admins'],
    ]);
  });
  it('the FYI step doesn’t count as the step after L0', () => {
    expect(policyMessage(t1([l0, l3fyi]))?.tone).toBe('danger');
    expect(policyMessage(t1full())).toBeNull();
  });
  it('conditions and notes (board / MEscalation)', () => {
    const t2 = { ...t1(), key: 't2' as const, tier: 2 };
    const l2rem = { ...l1({ targets: ['admins'] }), level: 2, delayMin: 30 };
    expect(stepCondition(t1full(), l3fyi)).toBe('Still DOWN — sent even after acknowledge');
    expect(stepCondition(t2, l2rem)).toBe('Still no acknowledgement');
    expect(stepNote(t2, l2rem, false, ['Tao'], 'Mon–Fri 09:00–18:00')).toBe(
      'Reminder to Tao. No CEO page — the CEO sees it in the daily digest.',
    );
    expect(stepNote(t1full(), l3fyi, true, [], 'Mon–Fri 09:00–18:00')).toBe(
      'FYI only, never a call. Recovered by then → nothing is sent.',
    );
    // L0 (Escalation board, S10): owner by day, on call otherwise; the pencil @mentions everyone on it.
    expect(stepNote(t1full(), l0, false, [], 'Mon–Sat 08:30–17:00')).toBe(
      'Chat @mention and Alerts Space are locked on. Owner by day (Mon–Sat 08:30–17:00), the person on call otherwise. Only they are @mentioned; the backup is named in plain text.',
    );
    expect(stepNote(t1full(), l0, true, [], 'Mon–Fri 09:00–18:00')).toBe(
      'Only this person is @mentioned; the backup is named in plain text.',
    );
    expect(stepNote(t1full(), { ...l0, targets: ['owner', 'backup'] }, true, [], 'Mon–Fri 09:00–18:00')).toBe(
      'Everyone on this step is @mentioned.',
    );
    expect(fyiNote(l3fyi)).toBe(
      'Acknowledge stops L1–L2 only. If the site is still DOWN at +60 min, CEO + Site AM get an FYI — Chat @mention + email, never a voice call. Recovered by then → nothing is sent.',
    );
    // L2 deleted: the FYI is L2 and an ack stops L1 only (spec-check M3).
    expect(fyiNote({ ...l3fyi, level: 2 })).toMatch(/^Acknowledge stops L1 only\./);
  });
  it('Add step stays, disabled with its reason (board gaps 1–2, D-048)', () => {
    expect(addBlocked(t1full())).toBe('L3 is the last level');
    expect(addBlocked(t1([l0, l1(), { ...l3fyi, level: 2 }]))).toBe('The CEO + AM FYI step stays last');
    expect(addBlocked(t1())).toBeNull();
  });
});

describe('policyMessage', () => {
  it('a DOWN policy without a step after L0 blocks the save', () => {
    expect(policyMessage(t1([l0]))).toEqual({
      tone: 'danger',
      text: 'Tier 1 DOWN needs at least one step after L0 — otherwise nobody else is ever told.',
    });
  });
  it('PROBLEM without one only warns', () => {
    expect(policyMessage(problem([l0]))?.tone).toBe('warning');
    expect(saveWarnings(draft([problem([l0])]))).toHaveLength(1);
    expect(saveProblems(draft([problem([l0])]))).toEqual([]);
  });
});

describe('saveProblems — the save dialog’s list', () => {
  it('names the policy, the level and its delay', () => {
    expect(saveProblems(draft([t1([l0, l1({ delayMin: 10 })])]))).toEqual([
      'Tier 1 DOWN · L1 (+10 min): Must be at least +15 min.',
    ]);
  });
  it('refuses a reminder that isn’t whole minutes', () => {
    expect(saveProblems(draft([t1()], 'x'))).toEqual([
      'DOWN reminder: “x” isn’t valid — enter whole minutes above 0.',
    ]);
    expect(reminderError('0')).toBe('Whole minutes above 0, e.g. 15');
    expect(reminderError('15')).toBeNull();
  });
});

describe('diff — a deleted step reads as removed (S10 /verify)', () => {
  it('deleting the Tier 1 CEO step names L2, not "L2 changed, L3 removed"', () => {
    const saved = draft([t1full()]);
    const edited = draft([t1([l0, l1(), { ...l3fyi, level: 2 }])]);
    expect(diff(saved, edited)).toEqual([
      {
        where: 'Tier 1 DOWN · L2',
        before: '+30 min · CEO · Chat @mention, Email, Voice call',
        after: 'Removed',
      },
    ]);
  });
});

describe('diff and the unsaved bar', () => {
  it('lists each changed level and the reminders', () => {
    const rows = diff(draft([t1()]), draft([t1([l0, l1({ delayMin: 20 })])], '10'));
    expect(rows).toEqual([
      {
        where: 'Tier 1 DOWN · L1',
        before: '+15 min · Backup + Admin · Chat @mention, Email',
        after: '+20 min · Backup + Admin · Chat @mention, Email',
      },
      { where: 'DOWN reminder', before: 'every 15 min', after: 'every 10 min' },
    ]);
    expect(unsavedSummary(rows)).toEqual({
      label: '2 unsaved changes',
      hint: 'In Tier 1 DOWN · Reminder interval',
    });
  });
  it('a removed step reads "Removed"; nothing changed is no bar', () => {
    expect(diff(draft([problem([l0, l1()])]), draft([problem([l0])]))[0]?.after).toBe('Removed');
    // The save dialog names the Admin as the ladder does (spec-check round 2).
    expect(diff(draft([t1()]), draft([t1([l0, l1({ delayMin: 20 })])]), ['Tao'])[0]?.after).toBe(
      '+20 min · Backup + Admin (Tao) · Chat @mention, Email',
    );
    // "015" is the saved 15, not a change.
    expect(diff(draft([t1()]), draft([t1()], '015'))).toEqual([]);
    expect(unsavedSummary([])).toBeNull();
  });
});

describe('delayCheck — the edit dialog', () => {
  it.each([
    ['L0 is pinned', '0', 0, { error: null, hint: 'Pinned — fires immediately.' }],
    ['not a number', '4x', 1, { error: 'Enter whole minutes, e.g. 45', hint: null }],
    ['under 15', '10', 1, { error: 'At least +15 min — L0 covers the first 15 minutes', hint: null }],
    ['fine: the board’s standing hint', '20', 1, { error: null, hint: 'Must be later than L0 (+0 min).' }],
  ])('%s', (_case, value, i, want) => {
    expect(delayCheck(value, [l0, l1()], i)).toEqual(want);
  });
});

describe('the rest', () => {
  it('describes a step', () => {
    expect(describeStep(l0)).toBe('+0 · Owner / on-call · Chat @mention, Alerts Space, Email');
  });
  it('affects line, as the board', () => {
    expect(affectsLine(5, [142])).toBe(
      'Affects 5 sites · 1 open incident (INC-0142) keeps its current timers',
    );
    expect(affectsLine(9, [])).toBe('Affects 9 sites · no open incidents');
    expect(affectsLine(17, [141, 142])).toBe(
      'Affects 17 sites · 2 open incidents (INC-0141, INC-0142) keep their current timers',
    );
  });
  it('adds steps up to L3', () => {
    expect(canAdd(problem([l0]))).toBe(true);
    expect(canAdd(t1())).toBe(true);
    expect(canAdd(t1full())).toBe(false);
    expect(newStep(problem([l0]))).toEqual({
      level: 1,
      delayMin: 30,
      targets: [],
      channels: ['chat', 'email'],
    });
  });
  it('a reminder change affects every policy of that severity; only changed steps are sent', () => {
    const saved = draft([t1(), problem([l0, l1({ delayMin: 60 })])]);
    const changed = { ...saved, downReminder: '10' };
    expect(affectedPolicies(saved, changed).map((p) => p.key)).toEqual(['t1']);
    expect(toSaveInput(changed, 'x', saved).policies).toEqual([]);
    const edited = draft([t1([l0, l1({ delayMin: 20 })]), problem([l0, l1({ delayMin: 60 })])]);
    expect(toSaveInput(edited, 'x', saved).policies.map((p) => p.policyId)).toEqual(['p1']);
  });
  it('builds the save input', () => {
    expect(toSaveInput(draft([t1()]), 'why')).toEqual({
      policies: [{ policyId: 'p1', steps: [l0, l1()] }],
      downReminderMin: 15,
      problemReminderMin: 60,
      note: 'why',
    });
  });
});
