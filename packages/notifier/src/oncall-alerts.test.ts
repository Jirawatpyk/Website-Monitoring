import { describe, expect, it } from 'vitest';
import { buildOncallChat, buildOncallEmail, formatWeek, type OncallFacts } from './oncall-alerts';

// The OnCall board's sample (§27): Arm (Mon 5 → 12 Oct) asks Nok (Mon 19 → 26 Oct). Bangkok 09:00 = 02:00Z.
const armWeek = { start: new Date('2026-10-05T02:00:00Z'), end: new Date('2026-10-12T02:00:00Z') };
const nokWeek = { start: new Date('2026-10-19T02:00:00Z'), end: new Date('2026-10-26T02:00:00Z') };
const swap = {
  requester: 'Arm',
  asked: 'Nok',
  requesterWeek: armWeek,
  askedWeek: nokWeek,
  reason: 'Family trip',
  note: null,
};
const base = (kind: OncallFacts['kind'], over: Partial<OncallFacts> = {}): OncallFacts => ({
  kind,
  by: 'Tao',
  at: new Date('2026-09-25T03:08:00Z'),
  pageUrl: 'https://monitor.example.test/oncall?swap=s1',
  swap,
  ...over,
});
const nok = { name: 'Nok', chatUserId: 'NOK' };
const arm = { name: 'Arm', chatUserId: 'ARM' };
const tao = { name: 'Tao', chatUserId: 'TAO' };
const thread = {
  threadKey: 'oncall-swap-s1',
  from: 'DxT Monitor <alerts@notify.example.test>',
  startsThread: true,
};

describe('on-call messages (S10, D-048 item 11)', () => {
  it('writes a week as on the boards', () => {
    expect(formatWeek(armWeek)).toBe('Mon 5 → 12 Oct');
    expect(
      formatWeek({ start: new Date('2026-09-28T02:00:00Z'), end: new Date('2026-10-05T02:00:00Z') }),
    ).toBe('Mon 28 Sep → 5 Oct');
  });

  it.each([
    [
      'swap_requested',
      [nok],
      '<users/NOK> SWAP REQUEST · On-call · Arm asks Nok to swap weeks · Nok would take Mon 5 → 12 Oct · Arm would take Mon 19 → 26 Oct · accept or decline on On-call',
    ],
    [
      'swap_accepted',
      [arm, tao],
      '<users/ARM> <users/TAO> SWAP ACCEPTED · On-call · Nok accepted Arm’s swap · waiting for an Admin to approve',
    ],
    [
      'swap_declined',
      [arm],
      '<users/ARM> SWAP DECLINED · On-call · Nok declined Arm’s swap · Arm keeps Mon 5 → 12 Oct',
    ],
    [
      'swap_withdrawn',
      [nok],
      '<users/NOK> SWAP WITHDRAWN · On-call · Arm withdrew the swap request · Nok keeps Mon 19 → 26 Oct',
    ],
    [
      'swap_approved',
      [arm, nok],
      '<users/ARM> <users/NOK> SWAP APPROVED · On-call · approved by Tao · Nok takes Mon 5 → 12 Oct · Arm takes Mon 19 → 26 Oct',
    ],
    [
      'swap_admin_declined',
      [arm, nok],
      '<users/ARM> <users/NOK> SWAP NOT APPROVED · On-call · declined by Tao · nothing changes in the rotation',
    ],
    [
      'swap_expired',
      [arm, nok],
      '<users/ARM> <users/NOK> SWAP EXPIRED · On-call · Arm’s week started before it was approved · nothing changes',
    ],
  ] as const)('%s: the Chat line @mentions whoever it tells, and never the reason', (kind, who, text) => {
    const m = buildOncallChat(base(kind), who);
    expect(m.text).toBe(text);
    expect(JSON.stringify(m)).not.toContain('Family trip');
  });

  it('a hand-over, a rotation change and the day-before reminder', () => {
    const handover = {
      from: 'Ploy',
      to: 'Arm',
      at: new Date('2026-09-25T11:00:00Z'),
      until: new Date('2026-09-28T02:00:00Z'),
      reason: 'ill tonight',
    };
    expect(buildOncallChat(base('handed_over', { handover }), [arm]).text).toBe(
      '<users/ARM> SHIFT HANDED OVER · On-call · Arm covers Ploy from Fri 25 Sep 18:00 until Mon 28 Sep 09:00',
    );
    const rotation = {
      order: [
        { name: 'Nok', next: nokWeek },
        { name: 'Arm', next: null },
      ],
      removed: ['Ploy'],
    };
    expect(buildOncallChat(base('rotation_changed', { rotation }), [nok]).text).toBe(
      '<users/NOK> ROTATION CHANGED · On-call · by Tao · next weeks: Nok from Mon 19 Oct · Ploy no longer in the rotation',
    );
    expect(buildOncallChat(base('shift_reminder', { by: null, shift: nokWeek }), [nok]).text).toBe(
      '<users/NOK> ON CALL TOMORROW · On-call · your shift Mon 19 Oct 09:00 → Mon 26 Oct 09:00 · Tier 1 alerts at night and on the weekend come to you',
    );
  });

  it('the test alert is the ChatAlert row, with the link that ticks the checklist', () => {
    const m = buildOncallChat(
      base('test_alert', { test: { name: 'Ploy', url: 'https://monitor.example.test/oncall?test=t1' } }),
      [{ name: 'Ploy', chatUserId: 'PLOY' }],
    );
    expect(m.text).toBe('<users/PLOY> TEST — no action · alert test for Ploy’s phone');
    expect(JSON.stringify(m.cardsV2)).toContain('"url":"https://monitor.example.test/oncall?test=t1"');
    expect(JSON.stringify(m.cardsV2)).toContain('Open test link on this phone');
  });

  it('emails: the person asked accepts or declines; the reason only by email', () => {
    const e = buildOncallEmail({ facts: base('swap_requested'), role: 'asked', to: 'Nok', ...thread })!;
    expect(e.subject).toBe('DxT Monitor · On-call · Arm asks you to swap weeks');
    expect(e.text).toContain('You would take Mon 5 → 12 Oct and Arm would take Mon 19 → 26 Oct.');
    expect(e.text).toContain('“Family trip”');
    expect(e.text).toContain('Accept or decline');
    expect(e.text).toContain('You got this because Arm asked you to swap on-call weeks.');
  });

  it('emails: an Admin is asked to approve; the requester is told who accepted', () => {
    const admin = buildOncallEmail({ facts: base('swap_accepted'), role: 'admin', to: 'Tao', ...thread })!;
    expect(admin.text).toContain('Nok accepted Arm’s swap — approve it?');
    expect(admin.text).toContain('You got this because you’re an Admin — a swap needs an Admin to approve.');
    const req = buildOncallEmail({ facts: base('swap_accepted'), role: 'requester', to: 'Arm', ...thread })!;
    expect(req.text).toContain('Nok accepted your swap');
    expect(req.text).not.toContain('Family trip');
  });

  it('emails: approved names each person’s new week; a hand-over names the reason to both', () => {
    const asked = buildOncallEmail({ facts: base('swap_approved'), role: 'asked', to: 'Nok', ...thread })!;
    expect(asked.text).toContain('You’re on call Mon 5 → 12 Oct. Approved by Tao');
    const handover = {
      from: 'Ploy',
      to: 'Arm',
      at: new Date('2026-09-25T11:00:00Z'),
      until: new Date('2026-09-28T02:00:00Z'),
      reason: 'ill tonight',
    };
    const prev = buildOncallEmail({
      facts: base('handed_over', { handover }),
      role: 'previous',
      to: 'Ploy',
      ...thread,
    })!;
    expect(prev.text).toContain('Your on-call shift was handed to Arm');
    expect(prev.text).toContain('“ill tonight”');
  });

  it('no email for a rotation change or a test alert (Chat only)', () => {
    expect(
      buildOncallEmail({ facts: base('rotation_changed'), role: 'rotation', to: 'Nok', ...thread }),
    ).toBeNull();
    expect(buildOncallEmail({ facts: base('test_alert'), role: 'self', to: 'Nok', ...thread })).toBeNull();
  });

  it('a later email replies in the same thread', () => {
    const e = buildOncallEmail({
      facts: base('swap_declined'),
      role: 'requester',
      to: 'Arm',
      ...thread,
      startsThread: false,
    })!;
    expect(e.headers?.['In-Reply-To']).toBe('<oncall-swap-s1@notify.example.test>');
  });
});
