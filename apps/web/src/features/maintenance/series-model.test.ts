import { describe, expect, it } from 'vitest';
import { metaOf, sectionsOf, type Viewer, type WindowRow } from './page-model';
import { seriesPageRow, type SeriesRow } from './series-model';

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
      whySub: 'asked by Ploy · approved by Tao Mon 14 Sep 11:20 · not counted in uptime',
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
      ['Each window', '2 h'],
      ['From', 'Tue 15 Sep'],
      ['Ends', 'No end date'],
      ['Next', 'Tue 29 Sep'],
      ['Reason', 'WordPress plugin updates'],
      ['By', 'asked by Ploy · approved by Tao Mon 14 Sep 11:20'],
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
  });
});
