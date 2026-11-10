import { describe, expect, it } from 'vitest';
import { cancelText, metaOf, sectionsOf, type Viewer, type WindowRow } from './page-model';
import {
  approvalPreview,
  approveSeriesEffects,
  declineSeriesEffects,
  endSeriesEffects,
  seriesPageRow,
  seriesToast,
  type SeriesRow,
} from './series-model';

// MaintenancePage STATE › Series / Series · Responder, MMaintenanceList, spec §32.4–9, 7b. The samples
// are the boards' (made up); the words are the boards'.
const NOW = new Date('2026-09-25T03:07:00Z'); // Fri 25 Sep 10:07 Bangkok
const tao: Viewer = { id: 'u-tao', name: 'Tao', role: 'admin' };
const arm: Viewer = { id: 'u-arm', name: 'Arm', role: 'responder' };
const nok: Viewer = { id: 'u-nok', name: 'Nok', role: 'responder' };
const mint: Viewer = { id: 'u-mint', name: 'Mint', role: 'readonly' };

const base: SeriesRow = {
  id: 's-tub',
  siteId: 'site-tub',
  siteName: 'Tubtong',
  tier: 2,
  siteStatus: 'ok',
  rule: { freq: 'weekly', days: [2] },
  startTime: '01:00:00',
  durationMin: 120,
  startsOn: '2026-09-15',
  untilOn: null,
  firstStartsAt: '2026-09-14T18:00:00Z',
  reason: 'WordPress plugin updates',
  createdAt: '2026-09-14T02:10:00Z',
  createdById: 'u-ploy',
  byName: 'Ploy',
  approvedAt: '2026-09-14T04:20:00Z',
  approvedById: 'u-tao',
  approverName: 'Tao',
  declinedAt: null,
  cancelledAt: null,
  outcome: null,
  ownerName: 'Ploy',
  backupName: 'Nok',
  ownerIds: ['u-ploy', 'u-nok'],
  log: [],
  upcoming: ['2026-09-28T18:00:00Z', '2026-10-05T18:00:00Z'],
  cancelledWindows: [],
};
const orca: SeriesRow = {
  ...base,
  id: 's-orca',
  siteId: 'site-orca',
  siteName: 'ORCA Thailand',
  rule: { freq: 'monthly', day: 6 },
  startTime: '20:00:00',
  startsOn: '2026-09-06',
  untilOn: '2026-12-31',
  firstStartsAt: '2026-09-06T13:00:00Z',
  reason: 'Hosting security patches',
  createdById: 'u-tao',
  byName: 'Tao',
  ownerName: 'Tao',
  ownerIsAdmin: true,
  ownerIds: ['u-tao', 'u-nok'],
  upcoming: ['2026-11-06T13:00:00Z'],
  log: [
    {
      at: '2026-09-22T13:00:00Z',
      action: 'skipped',
      starts_at: '2026-10-06T13:00Z',
      reason: 'overlaps another window',
    },
  ],
};
const dataCentre: WindowRow = {
  id: 'w-dc',
  siteId: 'site-orca',
  siteName: 'ORCA Thailand',
  tier: 2,
  siteStatus: 'ok',
  kind: 'maintenance',
  startsAt: '2026-10-06T11:00:00Z',
  endsAt: '2026-10-06T16:00:00Z',
  approvedAt: '2026-09-20T00:00:00Z',
  approvedById: 'u-tao',
  endedAt: null,
  cancelledAt: null,
  createdAt: '2026-09-20T00:00:00Z',
  createdById: 'u-tao',
  outcome: null,
  outcomeDetail: null,
  reason: 'Data-centre move',
  endReason: null,
  byName: 'Tao',
  ownerName: 'Tao',
  backupName: 'Nok',
  ownerIds: ['u-tao', 'u-nok'],
  log: [],
};
const waiting: SeriesRow = {
  ...base,
  id: 's-ba',
  siteId: 'site-ba',
  siteName: 'Bangkok Airways – Taiwan',
  tier: 1,
  rule: { freq: 'weekly', days: [1, 4] },
  startTime: '22:00:00',
  durationMin: 60,
  startsOn: '2026-09-28',
  firstStartsAt: '2026-09-28T15:00:00Z',
  reason: 'Cache purge and log rotation',
  createdAt: '2026-09-25T02:50:00Z',
  createdById: 'u-arm',
  byName: 'Arm',
  approvedAt: null,
  approvedById: null,
  approverName: null,
  ownerName: 'Arm',
  ownerIds: ['u-arm', 'u-nok'],
  upcoming: [],
};

describe('a repeating series row (§32.4)', () => {
  it('words the rule, the first day, the end and the next window', () => {
    const r = seriesPageRow(base, [], tao, NOW);
    expect(r).toMatchObject({
      state: 'repeating',
      badge: { icon: 'rotate-ccw', label: 'Repeating' },
      when: 'Every Tue 01:00 → 03:00',
      whenSub: 'Series · 2 h · from Tue 15 Sep · no end date · next Tue 29 Sep',
      whySub: 'by Ploy · approved by Tao Mon 14 Sep · not counted in uptime',
      endLabel: 'Cancel series…',
      line: 'Every Tue 01:00 → 03:00 · next Tue 29 Sep',
    });
  });

  it('a monthly series with an end and a skipped window names the window it overlaps', () => {
    const r = seriesPageRow(orca, [dataCentre], tao, NOW);
    expect(r.when).toBe('Monthly on day 6 · 20:00 → 22:00');
    expect(r.whenSub).toBe('Series · 2 h · from Sun 6 Sep · until Thu 31 Dec · next Fri 6 Nov');
    expect(r.whySub).toBe('by Tao · not counted in uptime');
    expect(r.skips).toEqual(['Skipped Tue 6 Oct — overlaps the 18:00 → 23:00 window (Data-centre move)']);
    expect(r.line).toBe('Monthly on day 6 · 20:00 → 22:00 · next Fri 6 Nov · 1 skipped');
  });

  it('one action per role: owner / backup / Admin cancel; others see who can', () => {
    expect(seriesPageRow(base, [], nok, NOW).endLabel).toBe('Cancel series…');
    expect(seriesPageRow(base, [], arm, NOW)).toMatchObject({
      endLabel: null,
      note: 'Only Ploy, Nok or an Admin',
    });
    expect(seriesPageRow(base, [], mint, NOW)).toMatchObject({ endLabel: null, note: null });
  });
});

describe('a waiting series (§32.7)', () => {
  it('Needs approval + Repeating, first window, asked by', () => {
    const r = seriesPageRow(waiting, [], tao, NOW);
    expect(r).toMatchObject({
      state: 'waiting',
      badge: { icon: 'clock', label: 'Needs approval' },
      tag: 'Repeating',
      when: 'Every Mon, Thu 22:00 → 23:00',
      whenSub: 'Series · 1 h · from Mon 28 Sep · no end date · first Mon 28 Sep',
      whySub: 'asked by Arm · today 09:50',
      canApprove: true,
    });
  });
  it('the asker withdraws; everyone else waits for an Admin', () => {
    expect(seriesPageRow(waiting, [], arm, NOW)).toMatchObject({
      endLabel: 'Withdraw…',
      note: 'Waiting for an Admin',
      canApprove: false,
    });
    expect(seriesPageRow(waiting, [], nok, NOW)).toMatchObject({
      endLabel: null,
      note: 'Waiting for an Admin',
    });
  });
  it('an undone withdraw stays "Withdrawn" in the log, never "Series cancelled" (code review)', () => {
    const undone: SeriesRow = {
      ...waiting,
      log: [
        { at: '2026-09-25T03:00:00Z', action: 'cancelled', by: 'Arm', reason: 'Not needed' },
        { at: '2026-09-25T03:00:05Z', action: 'undone', by: 'Arm', undid: 'cancelled' },
      ],
    };
    expect(seriesPageRow(undone, [], arm, NOW).logs).toEqual([
      'Withdrawn 10:00 by Arm · “Not needed” · nothing was scheduled',
      'Undone 10:00 by Arm — nothing was posted',
    ]);
  });
  it('the phone sheet’s facts come from the row’s parts (§32.9)', () => {
    expect(seriesPageRow(base, [], tao, NOW).facts).toEqual([
      ['Repeats', 'Every Tue 01:00 → 03:00'],
      ['Each window', '2 h · not counted in uptime'],
      ['From', 'Tue 15 Sep'],
      ['Ends', 'No end date'],
      ['Next', 'Tue 29 Sep'],
      ['Reason', 'WordPress plugin updates'],
      ['By', 'Ploy · approved by Tao Mon 14 Sep'],
      ['Site', 'Tier 2 · Ploy · backup Nok'],
    ]);
  });
});

describe('a series that ended without running (§32 7b)', () => {
  it.each([
    [
      'Declined',
      {
        declinedAt: '2026-09-21T09:05:00Z',
        log: [
          { at: '2026-09-21T09:05:00Z', action: 'declined', by: 'Tao', reason: 'Make it monthly instead' },
        ],
      },
      'Series · 1 h · from Mon 28 Sep · nothing scheduled',
      'Declined Mon 21 Sep 16:05 by Tao · “Make it monthly instead” · nothing was scheduled · Arm told in Chat',
    ],
    [
      'Withdrawn',
      {
        cancelledAt: '2026-09-17T08:30:00Z',
        log: [{ at: '2026-09-17T08:30:00Z', action: 'cancelled', by: 'Nok', reason: 'Host does it now' }],
      },
      'Series · 1 h · from Mon 28 Sep · nothing scheduled',
      'Withdrawn Thu 17 Sep 15:30 by Nok · “Host does it now” · nothing was scheduled',
    ],
    [
      'Not approved',
      {
        firstStartsAt: '2026-09-19T15:00:00Z',
        cancelledAt: '2026-09-19T15:00:00Z',
        outcome: 'not_approved',
        log: [{ at: '2026-09-19T15:00:00Z', action: 'not_approved' }],
      },
      'Series · 1 h · first window Sat 19 Sep 22:00 · didn’t start',
      'Not approved — nothing scheduled · nobody approved before the first window, Sat 19 Sep 22:00 · ask again on Maintenance & mutes',
    ],
  ] as const)('%s', (label, over, whenSub, log) => {
    const r = seriesPageRow({ ...waiting, ...over } as unknown as SeriesRow, [], tao, NOW);
    expect(r.badge).toEqual({ tone: 'neutral', variant: 'outline', icon: 'rotate-ccw', label });
    expect(r.whenSub).toBe(whenSub);
    expect(r.logs).toEqual([log]);
    expect(r.skips).toEqual([]);
    expect(r.endLabel).toBeNull();
  });

  it('a cancelled series names the windows its cancel took', () => {
    const r = seriesPageRow(
      {
        ...base,
        cancelledAt: '2026-09-25T03:07:00Z',
        cancelledWindows: ['2026-09-28T18:00:00Z', '2026-10-05T18:00:00Z'],
        log: [
          {
            at: '2026-09-25T03:07:00Z',
            action: 'cancelled',
            by: 'Tao',
            reason: 'Plugins now update automatically',
          },
        ],
      },
      [],
      tao,
      NOW,
    );
    expect(r.badge.label).toBe('Cancelled');
    expect(r.logs).toEqual([
      'Series cancelled 10:07 by Tao · “Plugins now update automatically” · 2 not started cancelled (Tue 29 Sep, Tue 6 Oct)',
    ]);
  });
});

describe('the page with series (§32.4)', () => {
  it('Repeating series after Scheduled, the waiting one under Waiting for approval, "N repeating"', () => {
    const s = sectionsOf([], tao, NOW, [base, orca, waiting]);
    expect(s.map((x) => x.key)).toEqual(['waiting', 'series']);
    expect(s[0]!.hint).toBe(
      '1 · over 24 h or repeating, asked by a Responder — nothing is scheduled unless an Admin approves',
    );
    expect(s[1]).toMatchObject({
      title: 'Repeating series',
      hint: '2 · each creates its windows 14 days ahead; one that overlaps another window on the site is skipped',
    });
    expect(metaOf(s)).toBe('1 waiting for approval · 2 repeating');
  });
  it('a series window is tagged "Part of a series"', () => {
    const w: WindowRow = {
      ...dataCentre,
      id: 'w-s',
      seriesId: 's-orca',
      startsAt: '2026-11-06T13:00:00Z',
      endsAt: '2026-11-06T15:00:00Z',
    };
    const s = sectionsOf([w], tao, NOW);
    expect(s[0]!.rows[0]!.tag).toBe('Part of a series');
    // Cancelling one window of it: only this one (§32.6).
    expect(cancelText(w, 'scheduled', 'Tao')).toContain(
      'cancelling removes it — only this window; the series keeps going.',
    );
  });
});

describe('the series dialogs’ words (board MaintenancePage › Approve series / Cancel series, §32.6–7, 7a)', () => {
  it('Approve: the rule, the first windows inside 14 days, what each does, who hears', () => {
    expect(approveSeriesEffects(waiting, 'Tao', NOW)).toEqual([
      'Every Mon, Thu 22:00 → 23:00 (1 h), from Mon 28 Sep, no end date. Bangkok Airways – Taiwan is Tier 1.',
      'Windows are created 14 days ahead — the first 4 now: Mon 28 Sep, Thu 1 Oct, Mon 5 Oct, Thu 8 Oct. One that overlaps another window on this site is skipped and noted on the series.',
      'Each one: no alerts, checks still run, not counted in uptime. It doesn’t start if the site is DOWN or has an open incident — Arm, Nok and Tao are told.',
      'You approve the series once; its windows don’t ask again. Arm gets a Chat message, Arm and Nok an email, and the Alerts Space one line for the series. Logged in the audit log as Tao.',
    ]);
    // Monthly on day 20 from 25 Sep: Tue 20 Oct is 25 days out, so nothing is made now.
    expect(
      approvalPreview({ ...waiting, rule: { freq: 'monthly', day: 20 }, startsOn: '2026-09-25' }, NOW),
    ).toEqual([]);
  });
  it('Decline names the Chat message and the emails', () => {
    expect(declineSeriesEffects(waiting, 'Tao')).toEqual([
      'Nothing is scheduled; the request moves to Recent as Declined.',
      'Arm gets your reason in a Chat message; Arm and Nok get an email. Logged in the audit log as Tao.',
    ]);
  });
  it('Cancel words one occurrence and none, and its toast (§32 7a)', () => {
    expect(endSeriesEffects({ ...base, upcoming: ['2026-09-28T18:00:00Z'] }, 'Tao', false)[0]).toBe(
      'Cancels the occurrence that hasn’t started (Tue 29 Sep). Nothing is running now.',
    );
    expect(endSeriesEffects({ ...base, upcoming: [] }, 'Tao', false)[0]).toBe(
      'No occurrence is scheduled yet. Nothing is running now.',
    );
    expect(seriesToast(base, 'cancelled', 0)).toMatchObject({
      title: 'Tubtong series cancelled',
      undone: { text: 'Nothing was posted. The series is back.' },
    });
    expect(seriesToast(base, 'cancelled', 1).undone.text).toBe(
      'Nothing was posted. The series and its window are back.',
    );
    expect(seriesToast(base, 'approved', 4).late('2026-09-25T03:07:10Z')).toBe(
      'Tubtong series approved — posted 10:07:10. To take it back, cancel the series.',
    );
  });
  it('an undone action keeps its line as it was (§32 7a): the windows a cancel took, the asker told', () => {
    const cancel = {
      ...base,
      log: [
        { at: '2026-09-25T03:00:00Z', action: 'cancelled', by: 'Tao', reason: 'Not needed' },
        { at: '2026-09-25T03:00:05Z', action: 'undone', by: 'Tao', undid: 'cancelled' },
      ],
    } satisfies SeriesRow;
    expect(seriesPageRow(cancel, [], tao, NOW).logs[0]).toBe(
      'Series cancelled 10:00 by Tao · “Not needed” · 2 not started cancelled (Tue 29 Sep, Tue 6 Oct)',
    );
    const decline = {
      ...waiting,
      log: [
        { at: '2026-09-25T03:00:00Z', action: 'declined', by: 'Tao', reason: 'Monthly instead' },
        { at: '2026-09-25T03:00:05Z', action: 'undone', by: 'Tao', undid: 'declined' },
      ],
    } satisfies SeriesRow;
    expect(seriesPageRow(decline, [], tao, NOW).logs[0]).toBe(
      'Declined 10:00 by Tao · “Monthly instead” · nothing was scheduled · Arm told in Chat',
    );
  });
  it('an ended series on the phone: "· nothing scheduled" when not approved, Repeats with where it stopped', () => {
    const notApproved = {
      ...waiting,
      cancelledAt: '2026-09-28T15:00:00Z',
      outcome: 'not_approved',
    } satisfies SeriesRow;
    const row = seriesPageRow(notApproved, [], tao, NOW);
    expect(row.line).toBe('Every Mon, Thu 22:00 → 23:00 · nothing scheduled');
    expect(row.facts[0]).toEqual(['Repeats', 'Every Mon, Thu 22:00 → 23:00 · first Mon 28 Sep']);
    const declined = { ...waiting, declinedAt: '2026-09-25T03:00:00Z' } satisfies SeriesRow;
    expect(seriesPageRow(declined, [], tao, NOW).facts[0]).toEqual([
      'Repeats',
      'Every Mon, Thu 22:00 → 23:00 · from Mon 28 Sep',
    ]);
  });
  it('the APPROVED line: the windows it made, one too close to start, the asker told (D-057)', () => {
    const approved: SeriesRow = {
      ...waiting,
      approvedAt: '2026-09-25T03:07:00Z',
      approvedById: 'u-tao',
      approverName: 'Tao',
      approvalWindows: ['2026-09-28T15:00:00Z', '2026-10-08T15:00:00Z'],
      upcoming: ['2026-09-28T15:00:00Z', '2026-10-08T15:00:00Z'],
      log: [
        {
          at: '2026-09-25T03:07:00Z',
          action: 'skipped',
          starts_at: '2026-10-01T15:00:00Z',
          reason: 'starts in less than 5 min',
        },
        { at: '2026-09-25T03:07:00Z', action: 'approved', by: 'Tao', posts_at: '2026-09-25T03:07:10Z' },
      ],
    };
    const row = seriesPageRow(approved, [], tao, new Date('2026-09-25T03:08:00Z'));
    expect(row.logs).toEqual([
      'Approved 10:07 by Tao · 2 windows created, to Thu 8 Oct · Thu 1 Oct too close to start, not created · Arm told in Chat (posted 10:07:10)',
    ]);
    expect(row.skips).toEqual([]);
  });
});
