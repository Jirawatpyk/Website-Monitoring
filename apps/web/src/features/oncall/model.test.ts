import { describe, expect, it } from 'vitest';
import {
  footOf,
  groupsOf,
  handoverSummary,
  handoverTimes,
  heroOf,
  mySwappableShift,
  oncallCardOf,
  ownersOf,
  readinessOf,
  rotationFrom,
  rotationPreview,
  rotationRows,
  rotationText,
  shortWhen,
  swapChoices,
  swapViewOf,
  weekGrid,
  type OncallData,
  type ShiftRow,
  type SwapRow,
  type SwapStatus,
  type Viewer,
} from './model';

// The boards' sample (OnCall, MOnCall): Fri 25 Sep 2026 10:07 Bangkok; Arm → Ploy → Nok, Tao the Admin.
const NOW = new Date('2026-09-25T03:07:00Z');
const ID = { tao: 'tao', arm: 'arm', ploy: 'ploy', nok: 'nok' } as const;
/** Monday 09:00 Bangkok of the week starting on `day` September (Oct as 30 + day). */
const mon = (day: number) => new Date(Date.UTC(2026, 8, day, 2, 0)).toISOString();
const shift = (id: string, userId: string, start: number, extra: Partial<ShiftRow> = {}): ShiftRow => ({
  id,
  userId,
  startsAt: mon(start),
  endsAt: mon(start + 7),
  handedOverFrom: null,
  ...extra,
});
const SHIFTS: ShiftRow[] = [
  shift('arm14', ID.arm, 14),
  shift('ploy21', ID.ploy, 21),
  shift('nok28', ID.nok, 28),
  shift('arm5', ID.arm, 35),
  shift('ploy12', ID.ploy, 42),
  shift('nok19', ID.nok, 49),
];

function data(viewer: keyof typeof ID, over: Partial<OncallData> = {}): OncallData {
  const v: Viewer = {
    id: ID[viewer],
    name: viewer[0]!.toUpperCase() + viewer.slice(1),
    role: viewer === 'tao' ? 'admin' : 'responder',
  };
  return {
    nowIso: NOW.toISOString(),
    viewer: v,
    names: { tao: 'Tao', arm: 'Arm', ploy: 'Ploy', nok: 'Nok' },
    admins: [ID.tao],
    eligible: [ID.arm, ID.nok, ID.ploy, ID.tao],
    rotation: [ID.arm, ID.ploy, ID.nok],
    shifts: SHIFTS,
    swaps: [],
    focus: null,
    handoverReasons: {},
    checklists: {},
    owners: [
      { id: ID.arm, sites: ['Bangkok Airways – Taiwan', 'Bangkok Airways – China', 'MuvMi'] },
      { id: ID.ploy, sites: ['ENEOS Industrial'] },
    ],
    tier1Sites: 5,
    paged: [{ number: 131, site: 'BA – Taiwan', detectedAt: '2026-09-15T15:00:00Z', userId: ID.arm }],
    hours: { startMin: 540, endMin: 1080, days: [1, 2, 3, 4, 5], holidays: [] },
    ...over,
  };
}

/** Arm asks Nok (Tue 22 Sep 10:12, "Family trip"): Nok takes Arm's Mon 5 → 12 Oct, Arm takes Nok's 19 → 26. */
function swap(status: SwapStatus, over: Partial<SwapRow> = {}): SwapRow {
  return {
    id: 'w1',
    status,
    requesterId: ID.arm,
    counterpartId: ID.nok,
    requesterShiftId: 'arm5',
    counterpartShiftId: 'nok19',
    createdAt: '2026-09-22T03:12:00Z',
    respondedAt: status === 'waiting' || status === 'withdrawn' ? null : '2026-09-25T03:07:00Z',
    decidedAt: ['approved', 'admin_declined', 'withdrawn'].includes(status)
      ? '2026-09-25T03:08:00Z'
      : status === 'expired'
        ? mon(35)
        : null,
    decidedBy: ['approved', 'admin_declined'].includes(status) ? ID.tao : null,
    updatedAt: '2026-09-25T03:05:00Z',
    requesterWeek: { start: mon(35), end: mon(42) },
    counterpartWeek: { start: mon(49), end: mon(56) },
    ...over,
  };
}
const withSwap = (
  viewer: keyof typeof ID,
  w: SwapRow,
  notes = { reason: 'Family trip', responseNote: null, decisionNote: null },
) => data(viewer, { swaps: [w], focus: { swap: w, notes } });

describe('rotation rows (OnCall table, MOnCall row cards)', () => {
  it('shows the last done week, the live one, Next and Scheduled, with what paged on call', () => {
    const rows = rotationRows(data('tao'), NOW);
    expect(rows.map((r) => [r.range, r.who, r.status.label, r.alerts])).toEqual([
      ['Mon 14 Sep → Mon 21 Sep', 'Arm', 'Done', 'INC-0131 · BA – Taiwan'],
      ['Mon 21 Sep → Mon 28 Sep', 'Ploy', 'On call now', 'None so far'],
      ['Mon 28 Sep → Mon 5 Oct', 'Nok', 'Next', '—'],
      ['Mon 5 Oct → Mon 12 Oct', 'Arm', 'Scheduled', '—'],
      ['Mon 12 Oct → Mon 19 Oct', 'Ploy', 'Scheduled', '—'],
      ['Mon 19 Oct → Mon 26 Oct', 'Nok', 'Scheduled', '—'],
    ]);
  });

  it.each([
    ['tao', ['handover', null, null, null]],
    ['arm', [null, null, 'swap', null]],
    ['nok', [null, 'swap', null, null]],
  ] as const)(
    'gives %s Swap on their own future weeks only, and Admins Hand over… on the live one',
    (who, kinds) => {
      const rows = rotationRows(data(who), NOW).slice(1, 5);
      expect(rows.map((r) => r.action?.kind ?? null)).toEqual(kinds);
    },
  );

  it('marks both weeks of an open request and says what it waits for (§27.7)', () => {
    const rows = rotationRows(withSwap('ploy', swap('accepted')), NOW);
    const arm = rows.find((r) => r.shiftId === 'arm5')!;
    expect(arm.status.label).toBe('Swap requested');
    expect(arm.phoneLine).toBe('Mon 5 Oct → Mon 12 Oct · with Nok, waiting for an Admin');
    expect(arm.action).toEqual({ kind: 'note', text: 'Request open', why: 'A swap is already waiting' });
    expect(rows.find((r) => r.shiftId === 'nok19')!.phoneLine).toContain('· with Arm, waiting for an Admin');
  });

  it('says when a swap went through or expired', () => {
    expect(
      rotationRows(withSwap('tao', swap('approved')), NOW).find((r) => r.shiftId === 'arm5')!.alerts,
    ).toBe('Swapped · today 10:08');
    expect(
      rotationRows(withSwap('tao', swap('expired')), NOW).find((r) => r.shiftId === 'arm5')!.alerts,
    ).toBe('Swap expired Mon 5 Oct');
  });

  it('disables Swap with its reason when the rotation has one person (§28.4)', () => {
    const one = data('ploy', { rotation: [ID.ploy], shifts: SHIFTS.map((s) => ({ ...s, userId: ID.ploy })) });
    const rows = rotationRows(one, NOW);
    expect(rows.filter((r) => !r.past && !r.live).every((r) => r.action?.kind === 'swap-off')).toBe(true);
    expect(rows[2]!.action).toEqual({ kind: 'swap-off', why: 'Nobody else in the rotation to swap with' });
    expect(mySwappableShift(rotationRows(one, NOW))).toBeNull();
  });

  it('starts with "No one on call" when no week covers now (§28.4 Nobody on call)', () => {
    const rows = rotationRows(data('tao', { shifts: SHIFTS.slice(2) }), NOW);
    expect(rows[0]).toMatchObject({
      who: 'No one',
      range: 'Now → Mon 28 Sep',
      alerts: 'Site owners at night',
      status: { label: 'No one on call', tone: 'warning' },
    });
  });
});

describe('a handed-over shift (§28.4 Handed over)', () => {
  const at = '2026-09-25T11:00:00Z'; // Fri 18:00
  const handed = data('tao', {
    shifts: [
      SHIFTS[0]!,
      { ...SHIFTS[1]!, endsAt: at },
      { id: 'arm-cover', userId: ID.arm, startsAt: at, endsAt: mon(28), handedOverFrom: ID.ploy },
      ...SHIFTS.slice(2),
    ],
    handoverReasons: { 'arm-cover': 'ill tonight' },
  });

  it('keeps one row for the week, handed to the person covering', () => {
    expect(groupsOf(handed)).toHaveLength(6);
    const live = rotationRows(handed, NOW)[1]!;
    expect(live).toMatchObject({
      who: 'Ploy',
      alerts: 'Arm from today 18:00',
      status: { label: 'Handed over' },
    });
    expect(live.action).toBeNull();
  });

  it('names who covers in the hero, with the reason only when the viewer may read it', () => {
    expect(heroOf(handed, NOW)).toMatchObject({
      eyebrow: 'ON CALL TONIGHT · COVERING PLOY',
      title: 'Arm',
      l2: 'Covering Ploy from 18:00 · ill tonight · then Nok from Mon 28 Sep',
      phoneEyebrow: 'ON CALL TONIGHT · ARM, COVERING PLOY',
    });
    expect(heroOf({ ...handed, handoverReasons: {} }, NOW).l2).toBe(
      'Covering Ploy from 18:00 · then Nok from Mon 28 Sep',
    );
  });

  it('gives Fri night to the weekend to Arm in the week grid', () => {
    const fri = weekGrid(handed, NOW)[4]!;
    expect(fri.segments.map((s) => s.who)).toEqual(['Ploy', 'Owners', 'Arm']);
    expect(weekGrid(handed, NOW)[5]!.segments[0]!.who).toBe('Arm · all day');
  });

  it('never offers the rest of a handed-over shift as a week to swap', () => {
    const later = data('nok', {
      shifts: [
        ...SHIFTS.slice(0, 2),
        { id: 'arm-cover', userId: ID.arm, startsAt: mon(26), endsAt: mon(28), handedOverFrom: ID.nok },
        ...SHIFTS.slice(2),
      ],
    });
    expect(swapChoices(later, 'nok28', NOW).find((c) => c.userId === ID.arm)!.shiftId).toBe('arm5');
  });
});

describe('the week grid (This week · who gets Tier 1 alerts)', () => {
  it('gives nights to the person on call and working hours to the owners, Mon–Sun', () => {
    const days = weekGrid(data('tao'), NOW);
    expect(days.map((d) => d.label)).toEqual([
      'Mon 21',
      'Tue 22',
      'Wed 23',
      'Thu 24',
      'Fri 25 · today',
      'Sat 26',
      'Sun 27',
    ]);
    expect(days[0]!.segments.map((s) => [s.who, s.hours])).toEqual([
      ['Arm', 9],
      ['Owners', 9],
      ['Ploy', 6],
    ]);
    expect(days[6]!.segments).toEqual([{ who: 'Ploy · all day', hours: 24, onCall: true }]);
  });

  it('pages on call all day on a company holiday', () => {
    const days = weekGrid(
      data('tao', {
        hours: { startMin: 540, endMin: 1080, days: [1, 2, 3, 4, 5], holidays: ['2026-09-23'] },
      }),
      NOW,
    );
    expect(days[2]!.segments.map((s) => s.who)).toEqual(['Ploy · all day']);
  });

  it('shows owners only when nobody is on call', () => {
    const days = weekGrid(data('tao', { shifts: [] }), NOW);
    expect(days[0]!.segments.every((s) => s.who === 'Owners' && !s.onCall)).toBe(true);
    expect(days[5]!.segments[0]!.who).toBe('Owners · all day');
  });
});

describe('the hero (OnCall, MOnCall per viewer)', () => {
  it('names tonight’s person and when the owners stop', () => {
    expect(heroOf(data('tao'), NOW)).toMatchObject({
      avatar: 'Ploy',
      eyebrow: 'ON CALL TONIGHT',
      title: 'Ploy',
      l1: 'Fri 25 Sep 18:00 → Mon 28 Sep 09:00',
      l2: 'Shift Mon 21 Sep → Mon 28 Sep · then Nok',
      nowTitle: 'Owners respond',
      nowLine: 'until 18:00 today',
      phoneEyebrow: 'ON CALL TONIGHT · PLOY',
      phoneTitle: 'Tonight 18:00 → Mon 09:00',
      phoneText: 'You’re not in the rotation. As Admin backstop you’re at L1 for every DOWN.',
    });
  });

  it.each([
    ['ploy', 'YOUR ON-CALL HOURS START IN 7 H 53 MIN', 'Tonight 18:00 → Mon 09:00'],
    ['nok', 'YOUR NEXT SHIFT STARTS MON 28 SEP 09:00', 'Mon 28 Sep → Mon 5 Oct'],
    ['arm', 'YOUR NEXT SHIFT STARTS MON 5 OCT 09:00', 'Mon 5 Oct → Mon 12 Oct'],
  ] as const)('tells %s on a phone what’s theirs', (who, eyebrow, title) => {
    expect(heroOf(data(who), NOW)).toMatchObject({ phoneEyebrow: eyebrow, phoneTitle: title });
  });

  it('says the Tier 1 site count to the person on call', () => {
    expect(heroOf(data('ploy'), NOW).phoneText).toBe(
      'Owners handle alerts until 18:00. Then all Tier 1 alerts (5 sites) come to you instead of the owners.',
    );
  });

  it('says when the rotation starts with nobody on call, and an Admin can add a week', () => {
    expect(heroOf(data('tao', { shifts: SHIFTS.slice(2) }), NOW)).toMatchObject({
      avatar: null,
      title: 'Nobody on call',
      l1: 'No week covers tonight — the rotation starts Mon 28 Sep 09:00 with Nok',
      l2: 'Until then Tier 1 alerts at night page each site’s owner · add a week in Edit rotation',
      nowLine: 'until 18:00 — and tonight',
    });
  });

  it.each([
    ['tao', 'Set one up in Edit rotation. Until then Tier 1 alerts at night page each site’s owner'],
    ['nok', 'An Admin sets it up. Until then Tier 1 alerts at night page each site’s owner'],
  ] as const)('says who sets up an empty rotation (%s)', (who, l2) => {
    expect(heroOf(data(who, { shifts: [], rotation: [] }), NOW)).toMatchObject({ l1: 'No rotation yet', l2 });
  });

  it('says one person is on call every week (§28.4 One person)', () => {
    const one = data('ploy', { rotation: [ID.ploy], shifts: SHIFTS.map((s) => ({ ...s, userId: ID.ploy })) });
    expect(heroOf(one, NOW).l2).toBe(
      'Shift Mon 21 Sep → Mon 28 Sep · then Ploy again — the only person in the rotation',
    );
  });

  it('counts down outside response hours on the person’s own phone', () => {
    const night = new Date('2026-09-25T16:00:00Z'); // Fri 23:00
    expect(heroOf(data('ploy'), night)).toMatchObject({
      phoneEyebrow: 'YOU’RE ON CALL NOW',
      phoneTitle: 'Now → Mon 09:00',
      phoneText: 'All Tier 1 alerts (5 sites) come to you until Mon 28 Sep 09:00.',
      l1: 'Now → Mon 28 Sep 09:00',
      nowTitle: 'Ploy responds',
      nowLine: 'until Mon 28 Sep 09:00',
    });
  });

  it('never says "Tonight 10:00" on a Saturday morning (MOnCall review)', () => {
    const saturday = new Date('2026-09-26T03:00:00Z'); // Sat 10:00
    expect(heroOf(data('tao'), saturday)).toMatchObject({
      phoneTitle: 'Now → Mon 09:00',
      l1: 'Now → Mon 28 Sep 09:00',
    });
  });

  it('says how a week came from an approved swap, and names an Admin in the rotation as not a backstop', () => {
    const approved = { ...swap('approved'), requesterShiftId: 'nok28', counterpartShiftId: 'arm5' };
    expect(heroOf(withSwap('nok', approved), NOW).phoneText).toBe(
      'Swapped with Arm · today 10:08. Tier 1 alerts at night and on the weekend come to you.',
    );
    const inRotation = data('tao', { rotation: [ID.arm, ID.ploy, ID.nok, ID.tao] });
    expect(heroOf(inRotation, NOW).phoneText).toBe('Ploy gets Tier 1 alerts at night and on the weekend.');
  });
});

describe('the swap card (§27.3–6, §28.1–2, §28.5)', () => {
  it('asks the person asked, with the back-to-back warning and Tao by name', () => {
    const v = swapViewOf(withSwap('nok', swap('waiting')), NOW)!;
    expect(v).toMatchObject({
      part: 'asked',
      eyebrow: 'SWAP REQUEST',
      title: 'Arm asks you to swap weeks',
      sub: 'Tue 22 Sep 10:12 · “Family trip”',
      badge: { label: 'Waiting for you', tone: 'warning' },
      left: {
        label: 'You would take',
        week: 'Mon 5 → 12 Oct',
        sub: 'Arm’s week now · Tier 1 nights and weekend',
      },
      right: {
        label: 'Arm would take',
        week: 'Mon 19 → 26 Oct',
        sub: 'Your week now · Tier 1 nights and weekend',
      },
      warn: {
        title: 'Back-to-back for you',
        text: 'You would be on call Mon 28 Sep → Mon 12 Oct — two weeks in a row.',
      },
      canAnswer: true,
      hint: 'Accepting sends it to Tao to approve. Nothing changes in the rotation until then. Logged in the audit log.',
      declineTitle: 'Decline Arm’s swap?',
      declineText:
        'Arm keeps Mon 5 → 12 Oct and you keep Mon 19 → 26 Oct. Arm gets a Chat message and an email.',
    });
  });

  it.each([
    [
      'accepted',
      'Waiting for Tao',
      'Accepted · waiting for an Admin to approve. Nothing changes in the rotation until then.',
      'Accepted today 10:07 · Arm and Tao got a Chat message',
    ],
    [
      'declined',
      'Declined',
      'You declined · Arm keeps Mon 5 → 12 Oct.',
      'today 10:07 · No reason given · Arm got a Chat message and an email',
    ],
    [
      'approved',
      'Approved',
      'The weeks have swapped — you’re on call Mon 5 → 12 Oct, Arm Mon 19 → 26 Oct.',
      'Approved by Tao · today 10:08',
    ],
    [
      'admin_declined',
      'Closed',
      'This request is closed — Declined by Tao · No reason given',
      'today 10:08 · Arm keeps Mon 5 → 12 Oct, you keep Mon 19 → 26 Oct',
    ],
    [
      'withdrawn',
      'Closed',
      'This request is closed — Withdrawn by Arm · today 10:08',
      'Nothing changes: Arm keeps Mon 5 → 12 Oct, you keep Mon 19 → 26 Oct',
    ],
    [
      'expired',
      'Expired',
      'Expired — Arm’s week started before it was approved',
      'Mon 5 Oct 09:00 · both weeks unchanged: Arm keeps Mon 5 → 12 Oct, you keep Mon 19 → 26 Oct · Arm and you got a Chat message',
    ],
  ] as const)('shows the person asked a %s request', (status, badge, text, sub) => {
    const v = swapViewOf(withSwap('nok', swap(status)), NOW)!;
    expect(v.badge.label).toBe(badge);
    expect(v.line).toMatchObject({ text, sub });
    expect(v.canAnswer).toBe(false);
  });

  it('gives the requester Withdraw while it is open, and their side of the closed states', () => {
    const open = swapViewOf(withSwap('arm', swap('waiting')), NOW)!;
    expect(open).toMatchObject({
      part: 'requester',
      eyebrow: 'YOUR SWAP REQUEST',
      title: 'You asked Nok to swap weeks',
      badge: { label: 'Waiting for Nok' },
      canWithdraw: true,
      canDecide: false,
      // The requester sees the warning too: the dialog promised "Nok and the Admin see this warning too".
      warn: { title: 'Back-to-back for Nok' },
      hint: 'Waiting for Nok to accept, then an Admin approves. You can withdraw until an Admin acts.',
    });
    expect(open.people.map((p) => [p.who, p.status.label])).toEqual([
      ['Arm', 'Requested'],
      ['Nok', 'Pending'],
      ['Tao', 'Not yet'],
    ]);
    expect(swapViewOf(withSwap('arm', swap('withdrawn')), NOW)!.line!.text).toBe(
      'You withdrew · today 10:08',
    );
  });

  it('lets an Admin approve only once the person asked accepted, and decline with a reason', () => {
    const waiting = swapViewOf(withSwap('tao', swap('waiting')), NOW)!;
    expect(waiting).toMatchObject({
      part: 'admin',
      canDecide: true,
      canApprove: false,
      title: 'Arm and Nok swap weeks',
    });
    expect(waiting.hint).toBe(
      'Approve unlocks once Nok accepts — Nok first, then an Admin. Logged in the audit log.',
    );
    expect(waiting.warn).toEqual({
      title: 'Back-to-back for Nok',
      text: 'Nok would be on call Mon 28 Sep → Mon 12 Oct — two weeks in a row.',
    });
    const accepted = swapViewOf(withSwap('tao', swap('accepted')), NOW)!;
    expect(accepted.canApprove).toBe(true);
    expect(accepted.declineTitle).toBe('Decline Arm’s swap with Nok?');
    expect(swapViewOf(withSwap('tao', swap('admin_declined')), NOW)!.line!.text).toBe(
      'This request is closed — You declined · No reason given',
    );
  });

  it('lets the only Admin decide a request they were asked about, once accepted (staging /verify)', () => {
    const onlyAdminAsked = { ...swap('accepted'), counterpartId: ID.tao };
    const v = swapViewOf(withSwap('tao', onlyAdminAsked), NOW)!;
    expect(v).toMatchObject({ part: 'asked', canDecide: true, canApprove: true, canAnswer: false });
    expect(v.badge.label).toBe('Waiting for you');
    expect(v.line?.text).toBe(
      'Accepted · waiting for you to approve. Nothing changes in the rotation until then.',
    );
    // Before accepting, they answer as the person asked: no second Decline / Approve beside it.
    const waiting = swapViewOf(withSwap('tao', { ...onlyAdminAsked, status: 'waiting' }), NOW)!;
    expect(waiting).toMatchObject({ canAnswer: true, canDecide: false });
    // The requester who is the only Admin withdraws while it waits, and decides once accepted.
    const own = { ...swap('waiting'), requesterId: ID.tao };
    expect(swapViewOf(withSwap('tao', own), NOW)).toMatchObject({ canWithdraw: true, canDecide: false });
    const two = { ...withSwap('tao', onlyAdminAsked), admins: [ID.tao, ID.ploy] };
    expect(swapViewOf(two, NOW)!.canDecide).toBe(false);
  });

  it('shows no card to anyone else (§27.6)', () => {
    expect(swapViewOf(withSwap('ploy', swap('waiting')), NOW)).toBeNull();
  });
});

describe('request a swap', () => {
  it('offers everyone else in the rotation with their next free week', () => {
    expect(swapChoices(data('arm'), 'arm5', NOW).map((c) => [c.who, c.week])).toEqual([
      ['Ploy', 'Mon 12 → 19 Oct'],
      ['Nok', 'Mon 28 Sep → 5 Oct'],
    ]);
  });

  it('warns when the swap would give someone two weeks in a row', () => {
    const c = swapChoices(data('ploy'), 'ploy12', NOW).find((x) => x.userId === ID.nok)!;
    expect(c.warn).toBe(
      'Nok would be on call two weeks in a row. You can still send the request — Nok and the Admin see this warning too.',
    );
  });

  it('skips weeks already in an open request, and an unknown shift', () => {
    const busy = withSwap('ploy', swap('waiting'));
    expect(swapChoices(busy, 'ploy12', NOW).map((c) => c.shiftId)).toEqual(['nok28']);
    expect(swapChoices(data('arm'), 'nope', NOW)).toEqual([]);
  });

  it('finds the viewer’s own next week for the phone button', () => {
    expect(mySwappableShift(rotationRows(data('nok'), NOW))!.shiftId).toBe('nok28');
    expect(mySwappableShift(rotationRows(data('tao'), NOW))).toBeNull();
  });
});

describe('edit rotation', () => {
  it('applies from the first week not yet made, continuing the order', () => {
    expect(rotationFrom(data('tao'), NOW).toISOString()).toBe(mon(56));
    expect(rotationText(data('tao'), NOW)).toBe(
      'Changes apply from Mon 26 Oct. Weeks already scheduled keep their person — use Swap for those.',
    );
    expect(rotationPreview([ID.arm, ID.ploy, ID.nok], data('tao'), NOW)).toBe(
      '26 Oct Arm · 2 Nov Ploy · 9 Nov Nok · 16 Nov Arm',
    );
    expect(rotationPreview([], data('tao'), NOW)).toBe('Nobody yet — add someone');
  });

  it('continues from the last week’s slot after a reorder, as the SQL does (code review)', () => {
    // Nok's week (slot 3) is the last one made; the new order is Nok, Arm, Ploy: slot 3 % 3 + 1 = 1 → Nok.
    const slotted = data('tao', { shifts: SHIFTS.map((s, i) => ({ ...s, slot: (i % 3) + 1 })) });
    expect(rotationPreview([ID.nok, ID.arm, ID.ploy], slotted, NOW)).toBe(
      '26 Oct Nok · 2 Nov Arm · 9 Nov Ploy · 16 Nov Nok',
    );
  });

  it('starts an empty rotation this week, from Monday 09:00', () => {
    const empty = data('tao', { shifts: [], rotation: [] });
    expect(rotationFrom(empty, NOW).toISOString()).toBe(mon(21));
    expect(rotationText(empty, NOW)).toBe(
      'Pick the people who take Tier 1 nights and weekends and their order. The first week starts Mon 21 Sep 09:00.',
    );
  });
});

describe('hand over', () => {
  const live = SHIFTS[1]!;
  it('offers now, tonight and tomorrow morning while the shift runs', () => {
    expect(handoverTimes(data('tao'), live, NOW).map((t) => t.label)).toEqual([
      'Now · 10:07',
      'Tonight 18:00',
      'Sat 26 Sep 09:00',
    ]);
  });

  it('says what changes and when', () => {
    const [now, tonight] = handoverTimes(data('tao'), live, NOW);
    expect(handoverSummary(data('tao'), live, 'Arm', tonight!, NOW)).toBe(
      'From tonight 18:00 until Mon 28 Sep 09:00, Tier 1 DOWN at night and on the weekend @mentions Arm instead of Ploy. Ploy and Arm get a Chat message; the On-call page updates.',
    );
    expect(handoverSummary(data('tao'), live, 'Arm', now!, NOW)).toContain(
      'Right now owners respond until 18:00, so nothing changes before tonight.',
    );
  });
});

describe('the phone checklist and the owners card', () => {
  it('counts what is ready and how the test alert stands (§27.8)', () => {
    const d = data('ploy', {
      checklists: {
        ploy: {
          mentionsOnly: true,
          dndAllowed: true,
          testSentAt: '2026-09-25T03:08:00Z',
          testReceivedAt: null,
        },
      },
    });
    const r = readinessOf(d, ID.ploy, NOW);
    expect(r.count).toBe(2);
    expect(r.testLine).toBe(
      'Test alert sent 10:08 to Ploy’s current phone — waiting for Ploy to confirm it arrived',
    );
    expect(readinessOf(data('nok'), ID.nok, NOW).testLine).toBe('Test alert not received on current phone');
    const done = readinessOf(
      data('nok', {
        checklists: {
          nok: {
            mentionsOnly: true,
            dndAllowed: true,
            testSentAt: null,
            testReceivedAt: '2026-09-14T03:00:00Z',
          },
        },
      }),
      ID.nok,
      NOW,
    );
    expect([done.count, done.testLine]).toEqual([3, 'Test alert received on this phone · Mon 14 Sep 10:00']);
  });

  it('lists each Tier 1 owner with three sites, then how many more', () => {
    expect(ownersOf(data('tao', { owners: [{ id: ID.arm, sites: ['A', 'B', 'C', 'D', 'E'] }] }))).toEqual([
      { who: 'Arm', sites: 'A, B, C +2 more' },
    ]);
  });
});

describe('footers and the Overview card', () => {
  it.each([
    [
      'tao',
      'Shifts change Monday 09:00. The live shift can’t be swapped — use “Hand over…” on its row. Tao isn’t in the rotation: as Admin backstop, Tao is at L1 for every DOWN.',
    ],
    [
      'nok',
      'Shifts change Monday 09:00. The live shift can’t be swapped — an Admin hands it over. Tao isn’t in the rotation: as Admin backstop, Tao is at L1 for every DOWN.',
    ],
  ] as const)('explains the live shift to %s', (who, foot) => {
    expect(footOf(data(who), NOW)).toBe(foot);
  });

  it('says when the rotation starts, and nothing for an empty one', () => {
    expect(footOf(data('tao', { shifts: SHIFTS.slice(2) }), NOW)).toBe(
      'The rotation starts Mon 28 Sep 09:00. Until then no one is on call: Tier 1 alerts at night page each site’s owner. Shifts change Monday 09:00.',
    );
    expect(footOf(data('tao', { shifts: [], rotation: [] }), NOW)).toBeNull();
  });

  it('gives the Overview who responds now, tonight and next week (Main3)', () => {
    expect(oncallCardOf(data('tao'), NOW)).toEqual({
      lines: [
        { who: null, text: 'Site owners respond', when: 'until 18:00' },
        { who: 'Ploy', text: 'Ploy · Tier 1 on call', when: '18:00 → Mon 09:00' },
        { who: 'Nok', text: 'Nok · next week', when: 'from Mon 28 Sep' },
      ],
      foot: 'Tier 2–3: Mon–Fri 09:00–18:00 — outside those hours escalation waits until 09:00.',
    });
    expect(oncallCardOf(data('tao', { shifts: [] }), NOW).lines[1]).toEqual({
      who: null,
      text: 'Nobody on call',
      when: 'Site owners at night',
    });
  });

  it('writes times within a week by weekday, older ones by date', () => {
    expect(shortWhen(new Date('2026-09-24T03:00:00Z'), NOW)).toBe('yesterday 10:00');
    expect(shortWhen(new Date('2026-09-14T03:00:00Z'), NOW)).toBe('Mon 14 Sep 10:00');
  });
});
