import { describe, expect, it } from 'vitest';
import {
  canTest,
  channelRows,
  escalationRows,
  hoursText,
  oncallLine,
  oneAdminWarning,
  shiftCard,
  sitesSummary,
  swapLine,
  type ProfileData,
} from './model';

// Fri 25 Sep 2026 10:08 Bangkok.
const NOW = new Date('2026-09-25T03:08:00Z');

const policies: ProfileData['policies'] = [
  {
    severity: 'down',
    tier: 1,
    steps: [
      { level: 0, delayMin: 0, targets: ['owner'], fyi: false },
      { level: 1, delayMin: 15, targets: ['backup', 'admins'], fyi: false },
      { level: 2, delayMin: 30, targets: ['ceo'], fyi: false },
      { level: 3, delayMin: 60, targets: ['ceo', 'site_am'], fyi: true },
    ],
  },
  {
    severity: 'down',
    tier: 2,
    steps: [
      { level: 0, delayMin: 0, targets: ['owner'], fyi: false },
      { level: 1, delayMin: 15, targets: ['backup'], fyi: false },
      { level: 2, delayMin: 30, targets: ['admins'], fyi: false },
    ],
  },
  {
    severity: 'problem',
    tier: null,
    steps: [
      { level: 0, delayMin: 0, targets: ['owner'], fyi: false },
      { level: 1, delayMin: 60, targets: ['backup'], fyi: false },
    ],
  },
];

const base: ProfileData = {
  me: { id: 'arm', name: 'Arm', email: 'arm@x', role: 'responder', chatLinked: true },
  sessions: [],
  sites: [
    {
      id: 'a',
      name: 'realme.link',
      tier: 1,
      status: 'ok',
      role: 'Owner',
      incident: null,
      mutedUntil: null,
      internal: false,
    },
    {
      id: 'b',
      name: 'MuvMi',
      tier: 2,
      status: 'down',
      role: 'Owner',
      incident: 'i1',
      mutedUntil: null,
      internal: false,
    },
    {
      id: 'c',
      name: 'EQHO',
      tier: 2,
      status: 'ok',
      role: 'Backup',
      incident: null,
      mutedUntil: null,
      internal: false,
    },
  ],
  isCeo: false,
  isAm: false,
  policies,
  inRotation: true,
  shifts: [{ startsAt: '2026-10-05T02:00:00Z', endsAt: '2026-10-12T02:00:00Z' }],
  swap: null,
  hours: { start: '09:00:00', end: '18:00:00', days: [1, 2, 3, 4, 5] },
  emailOn: true,
  admins: ['Tao'],
};

describe('escalationRows: read from the policies (D-062 item 12)', () => {
  it('a Responder: their owner and backup steps per tier', () => {
    expect(escalationRows(base)).toEqual([
      { label: 'Tier 1 DOWN', value: 'L0 at once as owner of 1 site' },
      {
        label: 'Tier 2 DOWN',
        value: 'L0 at once as owner of 1 site · L1 at +15 min as backup for 1 site',
      },
      {
        label: 'PROBLEM, every tier',
        value: 'L0 at once as owner of 2 sites · L1 at +60 min as backup for 1 site',
      },
    ]);
  });

  it('an Admin is on the steps that name Admins', () => {
    const admin = { ...base, me: { ...base.me, role: 'admin' as const }, sites: [] };
    expect(escalationRows(admin)).toEqual([
      { label: 'Tier 1 DOWN', value: 'L1 at +15 min as Admin' },
      { label: 'Tier 2 DOWN', value: 'L2 at +30 min as Admin' },
      {
        label: 'Monitor faults',
        value: 'A probe location silent over 3 min → email to every Admin, no page',
      },
    ]);
  });

  it('the one-Admin warning, only for an Admin and only with one (D-009)', () => {
    const admin = { ...base, me: { ...base.me, role: 'admin' as const } };
    expect(oneAdminWarning(admin)).toBe('Only Tao is an active Admin — add a second one in Users');
    expect(oneAdminWarning({ ...admin, admins: ['Tao', 'Alex'] })).toBeNull();
    expect(oneAdminWarning(base)).toBeNull();
  });

  it('the CEO: Tier 1 L2 and the L3 FYI only (§22.6)', () => {
    const ceo = { ...base, me: { ...base.me, role: 'stakeholder' as const }, sites: [], isCeo: true };
    expect(escalationRows(ceo)).toEqual([
      { label: 'Tier 1 DOWN', value: 'L2 at +30 min as CEO · L3 at +60 min as CEO (FYI)' },
    ]);
  });

  it('an AM: the client-update track and the Tier 1 L3 FYI (§22.6, D-052)', () => {
    const am = {
      ...base,
      me: { ...base.me, role: 'stakeholder' as const },
      isAm: true,
      sites: [
        {
          id: 'a',
          name: 'realme.link',
          tier: 1,
          status: 'ok' as const,
          role: 'AM' as const,
          incident: null,
          mutedUntil: null,
          internal: false,
        },
      ],
    };
    expect(escalationRows(am)).toEqual([
      { label: 'Tier 1 DOWN', value: 'L3 at +60 min as Site AM for 1 site (FYI)' },
      {
        label: 'Client update',
        value: '@mentioned with a draft once a Tier 1 site is down 15 min (1 site)',
      },
    ]);
  });

  it('an internal client has no client-update track (D-052)', () => {
    const am = {
      ...base,
      me: { ...base.me, role: 'stakeholder' as const },
      isAm: true,
      sites: [{ ...base.sites[0]!, role: 'AM' as const, internal: true }],
    };
    expect(escalationRows(am).map((r) => r.label)).toEqual(['Tier 1 DOWN']);
  });

  it('a Viewer named by no step has no rows', () => {
    expect(escalationRows({ ...base, me: { ...base.me, role: 'viewer' }, sites: [] })).toEqual([]);
  });
});

describe('oncallLine / shiftCard / swapLine (MProfile on-call card)', () => {
  it('the escalation row says what on call means; the card has the times', () => {
    expect(oncallLine(base, NOW)).toEqual({
      label: 'On call (nights, weekends)',
      value: 'L0 for every Tier 1 site · next shift Mon 5 Oct',
    });
    expect(oncallLine(base, new Date('2026-10-06T00:00:00Z'))?.value).toBe(
      'L0 for every Tier 1 site — on call now',
    );
    expect(shiftCard(base, NOW)).toEqual({
      eyebrow: 'MY NEXT ON-CALL SHIFT',
      value: 'Mon 5 Oct → Mon 12 Oct',
    });
    expect(shiftCard(base, new Date('2026-10-06T00:00:00Z'))).toEqual({
      eyebrow: 'ON CALL NOW',
      value: 'Until Mon 12 Oct 09:00',
    });
    const admin = { ...base, me: { ...base.me, role: 'admin' as const }, shifts: [], inRotation: false };
    expect(oncallLine(admin, NOW)).toEqual({
      label: 'Tier 1 night rotation',
      value: 'Not in it — Admin backstop',
    });
    expect(oncallLine({ ...base, shifts: [], inRotation: false }, NOW)).toBeNull();
  });

  it('words the swap you asked for and one asked of you', () => {
    expect(swapLine({ mine: true, other: 'Nok', status: 'waiting' })).toEqual({
      badge: 'Swap requested',
      line: 'with Nok · not accepted yet',
      note: 'You stay on call for this shift until Nok accepts.',
    });
    expect(swapLine({ mine: false, other: 'Ploy', status: 'waiting' })).toEqual({
      badge: 'Swap asked',
      line: 'Ploy asked to swap with you',
      note: 'Answer on On-call.',
    });
    expect(swapLine(null)).toBeNull();
  });
});

describe('channels, sites and the shared values', () => {
  it('email says when it isn’t set up (D-013)', () => {
    expect(channelRows({ ...base, emailOn: false })[1]!.status).toBe('Not set up');
  });

  it('the Chat row says when the id is missing', () => {
    expect(channelRows(base)[0]!.status).toBe('Working');
    expect(channelRows({ ...base, me: { ...base.me, chatLinked: false } })[0]).toMatchObject({
      status: 'No Chat id',
      detail: 'Add your Chat id so alerts can @mention you',
    });
  });
  it('only Admins and Responders get the phone test (D-062 item 12)', () => {
    expect((['admin', 'responder', 'stakeholder', 'viewer'] as const).map(canTest)).toEqual([
      true,
      true,
      false,
      false,
    ]);
  });
  it('sums the sites', () => {
    expect(sitesSummary(base)).toBe('Owner of 2 · backup for 1');
    expect(sitesSummary({ ...base, sites: [] })).toBe('No sites yet');
  });
  it('words the response hours', () => {
    expect(hoursText(base.hours)).toBe('Mon–Fri 09:00–18:00');
    expect(hoursText({ ...base.hours, days: [1, 3] })).toBe('Mon, Wed 09:00–18:00');
  });
});
