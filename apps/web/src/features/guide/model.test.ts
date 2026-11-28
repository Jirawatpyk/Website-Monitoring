import { describe, expect, it } from 'vitest';
import type { EscalationStep } from '@dxt/shared';
import { guideTopics, ladderRows, policyLine, type GuideFacts, type Topic } from './content';
import {
  CHIPS,
  countLabel,
  defaultChip,
  emptyTitle,
  forText,
  groupTopics,
  nextSelection,
  phoneCountLine,
  visibleTopics,
  type Chip,
  type GuideRole,
} from './model';

// The seeded policies (D-034, D-048): what a fresh database holds.
const T1: EscalationStep[] = [
  { level: 0, delayMin: 0, targets: ['owner'], channels: ['chat', 'space', 'email'] },
  { level: 1, delayMin: 15, targets: ['backup', 'admins'], channels: ['chat', 'email'] },
  { level: 2, delayMin: 30, targets: ['ceo'], channels: ['chat', 'email', 'voice'] },
  { level: 3, delayMin: 60, targets: ['ceo', 'site_am'], channels: ['chat', 'email'], fyi: true },
];
const T23: EscalationStep[] = [
  { level: 0, delayMin: 0, targets: ['owner'], channels: ['chat', 'space', 'email'] },
  { level: 1, delayMin: 15, targets: ['backup', 'admins'], channels: ['chat', 'email'] },
  { level: 2, delayMin: 30, targets: ['admins'], channels: ['chat', 'email'] },
];
const PROBLEM: EscalationStep[] = [
  { level: 0, delayMin: 0, targets: ['owner'], channels: ['chat', 'space', 'email'] },
  { level: 1, delayMin: 60, targets: ['backup'], channels: ['chat', 'email'] },
];

const FACTS: GuideFacts = {
  hours: 'Mon–Fri 08:30–17:30',
  tier1Sites: 4,
  admins: ['Pat', 'Sam'],
  onCallNow: { who: 'Kim', startsAt: '2026-11-16T02:00:00Z', endsAt: '2026-11-23T02:00:00Z' },
  onCallNext: [{ who: 'Lee', startsAt: '2026-11-23T02:00:00Z', endsAt: '2026-11-30T02:00:00Z' }],
  policies: { t1: T1, t2: T23, t3: T23, problem: PROBLEM },
  downReminderMin: 15,
  problemReminderMin: 60,
  isAdmin: true,
};

const desktop = guideTopics(FACTS, 'desktop');
const phone = guideTopics(FACTS, 'phone');

/**
 * Spec §18's topic matrix, copied by hand — not derived from content.ts, so a topic moved to the
 * wrong chip fails here. Columns: Responder · On-call · Stakeholder · Viewer · Admin.
 */
const MATRIX: Record<string, readonly [0 | 1, 0 | 1, 0 | 1, 0 | 1, 0 | 1]> = {
  'Sign in & 2-step': [1, 1, 1, 1, 1],
  'Set up your phone for on-call': [1, 1, 0, 0, 1],
  'Statuses & badges': [1, 1, 1, 1, 1],
  'When an alert arrives': [1, 1, 1, 0, 1],
  'Client updates': [1, 0, 1, 0, 1],
  'Recover, root cause & resolve': [1, 1, 0, 0, 1],
  'Mute vs maintenance': [1, 1, 0, 0, 1],
  'On-call rotation': [1, 1, 0, 0, 1],
  'When the monitor itself fails': [0, 1, 0, 0, 1],
  'Reports & client status page': [0, 0, 1, 0, 1],
  'Escalation rules, users & roles': [0, 0, 0, 0, 1],
};
const COLUMNS: readonly GuideRole[] = ['Responder', 'On-call', 'Stakeholder', 'Viewer', 'Admin'];
/** On the phone the Admin row is two topics (spec §18: "the Admin topic is split in two on mobile"). */
const PHONE_SPLIT: Record<string, string[]> = {
  'Escalation rules, users & roles': ['Escalation rules', 'Users & roles'],
};

const expected = (chip: Chip, layout: 'desktop' | 'phone') =>
  Object.entries(MATRIX)
    .filter(([, row]) => chip === 'All' || row[COLUMNS.indexOf(chip)] === 1)
    .flatMap(([title]) => (layout === 'phone' ? (PHONE_SPLIT[title] ?? [title]) : [title]))
    .sort();
const titles = (ts: readonly Topic[]) => ts.map((t) => t.title).sort();

describe('the §18 topic matrix (Done-when 1)', () => {
  it.each(CHIPS)('desktop · %s shows exactly its topics', (chip) => {
    expect(titles(visibleTopics(desktop, chip, ''))).toEqual(expected(chip, 'desktop'));
  });
  it.each(CHIPS)('phone · %s shows exactly its topics', (chip) => {
    expect(titles(visibleTopics(phone, chip, ''))).toEqual(expected(chip, 'phone'));
  });
  it('has the eleven topics on desktop, twelve on the phone', () => {
    expect(desktop).toHaveLength(11);
    expect(phone).toHaveLength(12);
  });
});

describe('defaultChip (spec §18, D-070)', () => {
  it.each([
    ['admin', false, 'Admin'],
    ['responder', false, 'Responder'],
    ['stakeholder', false, 'Stakeholder'],
    ['viewer', false, 'Viewer'],
    ['responder', true, 'On-call'],
    ['admin', true, 'On-call'],
  ] as const)('%s, on call %s → %s', (role, onCall, chip) => {
    expect(defaultChip(role, onCall)).toBe(chip);
  });
});

describe('search', () => {
  it('reads the whole topic, not only its title', () => {
    expect(titles(visibleTopics(desktop, 'All', 'Do Not Disturb'))).toEqual([
      'Set up your phone for on-call',
    ]);
  });
  it('keeps the chip', () => {
    // A Viewer sees "Muted" only where badges are explained.
    expect(titles(visibleTopics(desktop, 'Viewer', 'mute'))).toEqual(['Statuses & badges']);
    expect(titles(visibleTopics(desktop, 'All', 'mute'))).toContain('Mute vs maintenance');
  });
  it('finds 2-step under Sign in', () => {
    expect(titles(visibleTopics(desktop, 'All', '2-step'))).toContain('Sign in & 2-step');
  });
  it('jumps to the first title match, and keeps the open topic when it still shows', () => {
    expect(nextSelection(desktop, 'All', 'root cause', 'alert')).toBe('resolve');
    expect(nextSelection(desktop, 'Admin', '', 'alert')).toBe('alert');
    expect(nextSelection(desktop, 'Viewer', '', 'alert')).toBe('signin');
    expect(nextSelection(desktop, 'All', 'zzz', 'alert')).toBeNull();
  });
});

describe('the words around the list (boards Guide, MGuide)', () => {
  it('groups in the boards’ order', () => {
    expect(groupTopics(visibleTopics(desktop, 'Admin', '')).map((g) => g.group)).toEqual([
      'Getting started',
      'Everyday',
      'When things go wrong',
      'Admin',
    ]);
  });
  it('counts', () => {
    expect(countLabel(11, 11, 'Admin', 'Admin', '')).toBe('11 topics');
    expect(countLabel(8, 11, 'Responder', 'Admin', '')).toBe('8 of 11 topics · Responder');
    expect(countLabel(2, 11, 'All', 'Admin', 'mute')).toBe('2 of 11 topics');
    expect(phoneCountLine(12, 12, 'All', 'Responder', '')).toBe('12 topics · you’re a Responder');
    expect(phoneCountLine(1, 12, 'Admin', 'Admin', 'mute')).toBe('1 result for “mute” · Admin');
    expect(phoneCountLine(3, 12, 'Viewer', 'Admin', '')).toBe('3 topics for Viewer');
  });
  it('says who a topic is for', () => {
    expect(forText(['Responder', 'On-call', 'Stakeholder', 'Viewer', 'Admin'])).toBe('Everyone');
    expect(forText(['Admin', 'Responder', 'On-call'])).toBe('Responder · On-call · Admin');
  });
  it('words the empty state', () => {
    expect(emptyTitle('zzz', 'Viewer')).toBe('No topics match “zzz” for Viewer');
    expect(emptyTitle('zzz', 'All')).toBe('No topics match “zzz”');
  });
});

describe('content from the facts (D-070)', () => {
  const all = (ts: readonly Topic[]) => ts.map((t) => t.text).join('\n');
  it('reads the live hours, never the seeded literal', () => {
    expect(all(desktop)).toContain('Mon–Fri 08:30–17:30');
    expect(all(desktop)).not.toContain('09:00–18:00');
  });
  it('names the people on call', () => {
    const rotation = desktop.find((t) => t.id === 'rotation')!;
    expect(rotation.text).toContain('Kim');
    expect(rotation.text).toContain('Next: Lee');
  });
  it('says so when nobody is on call', () => {
    const rotation = guideTopics({ ...FACTS, onCallNow: null, onCallNext: [] }, 'desktop').find(
      (t) => t.id === 'rotation',
    )!;
    expect(rotation.text).toContain('Nobody is on call right now.');
  });
  it('keeps the Stakeholder callout on When an alert arrives (spec §18)', () => {
    const alertTopic = desktop.find((t) => t.id === 'alert')!;
    const first = alertTopic.blocks[0];
    expect(first?.kind === 'callout' && first.callout.title).toBe('For Stakeholders (AMs, CEO)');
  });
  it('warns about one Admin only when it is true', () => {
    expect(all(desktop)).not.toContain('Only one active Admin');
    const one = guideTopics({ ...FACTS, admins: ['Pat'] }, 'desktop');
    expect(all(one)).toContain('reach Pat only');
  });
  it('drops what was retired or isn’t built (D-007, D-016, D-070)', () => {
    for (const text of [all(desktop), all(phone)]) {
      for (const stale of [
        'webhooks',
        'Tao',
        'acknowledge only',
        '5 Oct',
        'In review',
        'Closed',
        'Proposal',
        'signed off',
        'INC-0142',
        'MuvMi',
        'Arm',
        'Nok',
        'Ploy',
      ])
        expect(text).not.toContain(stale);
      expect(text).not.toMatch(/\{\w+\}/);
    }
  });
  it('shows Admin-only screens to Admins only', () => {
    const hrefs = (ts: readonly Topic[]) => ts.flatMap((t) => t.related.map((r) => r.href));
    expect(hrefs(desktop)).toContain('/audit');
    const responder = guideTopics({ ...FACTS, isAdmin: false }, 'desktop');
    expect(hrefs(responder)).not.toContain('/audit');
    expect(hrefs(responder)).not.toContain('/settings/users');
  });
});

describe('the ladder in words', () => {
  it('rows', () => {
    expect(ladderRows(T1)).toEqual([
      {
        level: 'L0',
        when: '0 min',
        who: 'Owner inside response hours, on-call outside · Chat @mention + Alerts Space + email',
        ack: 'Chat at once, email after 5 min',
        fyi: false,
      },
      {
        level: 'L1',
        when: '+15 min',
        who: 'Backup + every Admin · Chat @mention + email',
        ack: 'Stopped by ack',
        fyi: false,
      },
      {
        level: 'L2',
        when: '+30 min',
        who: 'CEO · Chat @mention + email (voice call off until approved)',
        ack: 'Stopped by ack',
        fyi: false,
      },
      {
        level: 'L3',
        when: '+60 min',
        who: 'CEO + site AM · Chat @mention + email',
        ack: 'Also after an ack: FYI, no call',
        fyi: true,
      },
    ]);
  });
  it('one line per policy', () => {
    expect(policyLine(T23)).toBe('L0 owner · L1 +15 min backup + every Admin · L2 +30 min every Admin');
  });
  it('D-078: L2 to Management — the Admin token says who it leaves out, Management get their own card', () => {
    const t1 = T1.map((s) =>
      s.level === 2
        ? { ...s, targets: ['management' as const], channels: ['chat' as const, 'email' as const] }
        : s,
    );
    expect(ladderRows(t1)[1]!.who).toBe('Backup + the Admins who aren’t Management · Chat @mention + email');
    expect(ladderRows(t1)[2]!.who).toBe('Management · Chat @mention + email');
    expect(policyLine(T23, true)).toBe(
      'L0 owner · L1 +15 min backup + the Admins who aren’t Management · L2 +30 min the Admins who aren’t Management',
    );
    const alert = guideTopics({ ...FACTS, policies: { ...FACTS.policies, t1 } }, 'desktop').find(
      (t) => t.id === 'alert',
    )!;
    const card = alert.blocks.find((b) => b.kind === 'callout' && b.callout.title === 'For Management');
    expect(card?.kind === 'callout' && card.callout.text).toBe(
      'Tier 1 DOWN comes to you at +30 min when nobody has acknowledged. Step in and find someone to take it: call the owner or backup, reassign, or acknowledge yourself — and ask for a status note: the CEO and the site’s AM see it in the FYI at +60 min.',
    );
    // Tagged before the switch: the Admin token already leaves them out (D-078 3a, spec-check H1).
    const tagged = guideTopics({ ...FACTS, managementTagged: true }, 'desktop')
      .find((t) => t.id === 'alert')!
      .blocks.find((b) => b.kind === 'ladder');
    expect(tagged?.kind === 'ladder' && tagged.rows[1]!.who).toMatch(/the Admins who aren’t Management/);
    // Before the switch there is no Management card.
    expect(
      desktop
        .find((t) => t.id === 'alert')!
        .blocks.some((b) => b.kind === 'callout' && b.callout.title === 'For Management'),
    ).toBe(false);
  });
  it('shows Tier 2 and Tier 3 apart when they differ', () => {
    const t3 = T23.slice(0, 2);
    const ladder = guideTopics({ ...FACTS, policies: { ...FACTS.policies, t3 } }, 'desktop')
      .find((t) => t.id === 'alert')!
      .blocks.find((b) => b.kind === 'ladder');
    expect(ladder?.kind === 'ladder' && ladder.cards.map((c) => c.title)).toEqual([
      'Tier 2 DOWN',
      'Tier 3 DOWN',
      'PROBLEM · all tiers',
      'Until someone acknowledges',
    ]);
  });
});
