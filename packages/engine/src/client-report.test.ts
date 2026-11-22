import { describe, expect, it } from 'vitest';
import { TRIGGERS } from '@dxt/shared';
import {
  bangkokMonth,
  CLIENT_DEGRADED_TRIGGERS,
  clientKindOf,
  clientMonth,
  siteMonth,
  type CauseChange,
  type ReportIncidentInput,
  type ReportSiteInput,
} from './client-report';
import { outageMinutes } from './lifecycle';

// Times are UTC; Bangkok = UTC+7. Spec §5 sample: September so far = 1 Sep 00:00 → Fri 25 Sep 10:07
// Bangkok = 31 Aug 17:00Z → 25 Sep 03:07Z, 35,167 minutes per site.
const SEP_NOW = new Date('2026-09-25T03:07:00Z');
const sep = bangkokMonth('2026-09', SEP_NOW);
const aug = bangkokMonth('2026-08', SEP_NOW);

const at = (iso: string) => new Date(iso);
const plus = (iso: string, minutes: number) => new Date(at(iso).getTime() + minutes * 60_000);
const down = (start: string, minutes: number | null) => ({
  severity: 'down' as const,
  start: at(start),
  end: minutes === null ? null : plus(start, minutes),
});
const downTo = (start: string, end: string | null) => ({
  severity: 'down' as const,
  start: at(start),
  end: end === null ? null : at(end),
});
const problem = (start: string, minutes: number | null) => ({
  severity: 'problem' as const,
  start: at(start),
  end: minutes === null ? null : plus(start, minutes),
});
const inc = (
  number: number,
  episodes: ReportIncidentInput['episodes'],
  trigger: CauseChange['trigger'] = 'hard_fail',
  rootCauseCategory: string | null = 'hosting',
  causes?: ReportIncidentInput['causes'],
): ReportIncidentInput => ({
  number,
  episodes,
  causes: causes ?? [{ at: episodes[0]!.start, trigger }],
  rootCauseCategory,
});
const site = (
  name: string,
  tier: 1 | 2 | 3,
  incidents: ReportIncidentInput[],
  extra: Partial<ReportSiteInput> = {},
): ReportSiteInput => ({
  name,
  tier,
  monitoringStartedAt: at('2026-07-01T00:00:00Z'),
  maintenance: [],
  incidents,
  ...extra,
});

describe('bangkokMonth (D-073)', () => {
  it('a running month ends at now; every day of the month has a cell', () => {
    expect(sep.from.toISOString()).toBe('2026-08-31T17:00:00.000Z');
    expect(sep.to.toISOString()).toBe('2026-09-25T03:07:00.000Z');
    expect(sep.running).toBe(true);
    expect(sep.days).toHaveLength(30);
    expect((sep.to.getTime() - sep.from.getTime()) / 60_000).toBe(35_167);
  });
  it('a past month runs to the next month’s first Bangkok midnight', () => {
    expect(aug.from.toISOString()).toBe('2026-07-31T17:00:00.000Z');
    expect(aug.to.toISOString()).toBe('2026-08-31T17:00:00.000Z');
    expect(aug.running).toBe(false);
    expect(aug.days).toHaveLength(31);
  });
});

describe('clientKindOf (spec §12, D-073 items 2–3)', () => {
  it.each(TRIGGERS.map((t) => [t]))('%s', (trigger) => {
    expect(clientKindOf(trigger, true)).toBe('outage');
    expect(clientKindOf(trigger, false)).toBe(CLIENT_DEGRADED_TRIGGERS.includes(trigger) ? 'degraded' : null);
  });
  it('degraded = slow, key page, regional, intermittent only', () => {
    expect([...CLIENT_DEGRADED_TRIGGERS].sort()).toEqual(['intermittent', 'key_page', 'regional', 'slow']);
  });
});

describe('spec §5 September so far — clients only', () => {
  // BA: Taiwan 11 min DOWN + an internal SSL PROBLEM (not counted, not listed); China a 14-min slow page.
  const ba = [
    site('Bangkok Airways – Taiwan', 1, [
      inc(4, [down('2026-09-03T07:06:00Z', 11)]),
      inc(5, [problem('2026-09-10T02:00:00Z', 600)], 'ssl'),
    ]),
    site('Bangkok Airways – China', 1, [inc(6, [problem('2026-09-18T03:05:00Z', 14)], 'slow')]),
  ];
  // MuvMi: 3 outages, the last still down at 10:07 — 30 + 30 + 41 = 101 min; plus a false alarm left out.
  const muvmi = [
    site('MuvMi', 1, [
      inc(7, [down('2026-09-05T01:00:00Z', 30)]),
      inc(8, [down('2026-09-12T01:00:00Z', 20), down('2026-09-12T02:00:00Z', 10)]),
      inc(9, [down('2026-09-25T02:26:00Z', null)]),
      inc(10, [down('2026-09-20T01:00:00Z', 15)], 'hard_fail', 'false_alarm'),
    ]),
  ];
  const cando = [site('Cando Asia', 2, [inc(11, [down('2026-09-08T04:00:00Z', 12)])])];
  const orca = [site('ORCA Thailand', 2, [inc(12, [down('2026-09-14T09:00:00Z', 8)])])];

  it.each([
    ['BA', ba, 11, '99.98', 2, 1, 1],
    ['MuvMi', muvmi, 101, '99.71', 3, 3, 0],
    ['Cando', cando, 12, '99.97', 1, 1, 0],
    ['ORCA', orca, 8, '99.98', 1, 1, 0],
  ] as const)(
    '%s: %s min down, %s%%, %s incidents (%s outage, %s degraded)',
    (_c, sites, minutes, pct, n, outages, degraded) => {
      const m = clientMonth(sites.map((s) => siteMonth(s, sep)));
      expect(m.downMinutes).toBe(minutes);
      expect((m.uptime! * 100).toFixed(2)).toBe(pct);
      expect(m.incidents).toBe(n);
      expect(m.outages).toBe(outages);
      expect(m.degraded).toBe(degraded);
    },
  );

  it('MuvMi: the ongoing outage counts to now and is open; the false alarm is not listed', () => {
    const s = siteMonth(muvmi[0]!, sep);
    expect(s.incidents.map((i) => [i.number, i.kind, i.minutes, i.open])).toEqual([
      [7, 'outage', 30, false],
      [8, 'outage', 30, false],
      [9, 'outage', 41, true],
    ]);
    expect(clientMonth([s]).open).toBe(1);
  });

  it('BA: the SSL PROBLEM is neither listed nor drawn; the slow page is a degraded day', () => {
    const taiwan = siteMonth(ba[0]!, sep);
    expect(taiwan.incidents.map((i) => i.number)).toEqual([4]);
    expect(taiwan.days[2]?.kind).toBe('outage'); // 3 Sep
    expect(taiwan.days[9]?.kind).toBe('ok'); // 10 Sep, SSL warning only
    const china = siteMonth(ba[1]!, sep);
    expect(china.incidents[0]).toMatchObject({ number: 6, kind: 'degraded', minutes: 14 });
    expect(china.days[17]?.kind).toBe('degraded'); // 18 Sep
    expect(china.uptime).toBe(1); // degraded doesn't reduce uptime
    expect(china.days[29]?.kind).toBe('none'); // 30 Sep hasn't come yet
  });
});

describe('minutes are whole clock minutes, as every page counts them (D-033)', () => {
  it('INC-0133 VOCA, four drops from :40 s → 41 min, as outageMinutes', () => {
    const eps = [
      downTo('2026-09-25T03:12:40Z', '2026-09-25T03:19:00Z'),
      downTo('2026-09-25T03:24:40Z', '2026-09-25T03:35:00Z'),
      downTo('2026-09-25T03:38:40Z', '2026-09-25T03:52:00Z'),
      downTo('2026-09-25T03:55:40Z', '2026-09-25T04:04:00Z'),
    ];
    const s = siteMonth(
      site('VOCA', 2, [inc(133, eps)]),
      bangkokMonth('2026-09', at('2026-10-01T00:00:00Z')),
    );
    expect(s.incidents[0]?.minutes).toBe(41);
    expect(s.incidents[0]?.minutes).toBe(outageMinutes(eps, SEP_NOW));
    expect(s.downMinutes).toBe(41);
  });
  it.each([
    ['INC-0142 settled 09:47:41 → 10:20', '2026-09-25T02:47:41Z', '2026-09-25T03:20:00Z', 33, false],
    ['INC-0142 running 09:48:12 → now 10:07', '2026-09-25T02:48:12Z', null, 19, true],
    ['a 20-second DOWN', '2026-09-10T05:00:10Z', '2026-09-10T05:00:30Z', 1, false],
  ])('%s → %s min', (_c, start, end, minutes, open) => {
    const now = end ? at('2026-10-01T00:00:00Z') : SEP_NOW;
    const s = siteMonth(site('MuvMi', 1, [inc(142, [downTo(start, end)])]), bangkokMonth('2026-09', now));
    expect(s.incidents[0]).toMatchObject({ minutes, open });
    expect(s.days.some((d) => d.kind === 'outage')).toBe(true);
  });
  it('the headline is the lines added up, so the page adds up (D-073 item 9)', () => {
    const s = siteMonth(
      site('Tubtong', 2, [
        inc(1, [downTo('2026-08-10T01:00:00Z', '2026-08-10T01:07:30Z')]),
        inc(2, [downTo('2026-08-11T01:00:00Z', '2026-08-11T01:07:30Z')]),
      ]),
      aug,
    );
    expect(s.incidents.map((i) => i.minutes)).toEqual([7, 7]);
    expect(s.downMinutes).toBe(14);
  });
});

describe('causes change inside an incident (D-067, D-023)', () => {
  it('an SSL PROBLEM with a key-page failure inside it: only the key-page stretch is degraded', () => {
    const s = siteMonth(
      site('BA', 1, [
        inc(70, [problem('2026-08-31T17:00:00Z', 19 * 24 * 60)], 'ssl', null, [
          { at: at('2026-08-31T17:00:00Z'), trigger: 'ssl' },
          { at: at('2026-09-10T02:00:00Z'), trigger: 'key_page' },
          { at: at('2026-09-10T04:00:00Z'), trigger: 'ssl' },
        ]),
      ]),
      sep,
    );
    expect(s.incidents).toEqual([expect.objectContaining({ kind: 'degraded', minutes: 120 })]);
    expect(s.days.filter((d) => d.kind === 'degraded')).toHaveLength(1);
  });
  it('slow, then PROBLEM AGAIN as keyword: only the slow minutes count', () => {
    const s = siteMonth(
      site('Fuji', 2, [
        inc(71, [problem('2026-08-05T02:00:00Z', 30), problem('2026-08-06T02:00:00Z', 60)], 'slow', null, [
          { at: at('2026-08-05T02:00:00Z'), trigger: 'slow' },
          { at: at('2026-08-06T02:00:00Z'), trigger: 'keyword' },
        ]),
      ]),
      aug,
    );
    expect(s.incidents[0]).toMatchObject({ kind: 'degraded', minutes: 30 });
    expect(s.days[5]?.kind).toBe('ok'); // 6 Aug, keyword only
  });
  it('a DOWN that comes back to a failing key page past midnight: outage, then a degraded day', () => {
    // 21 Aug 23:30–23:50 Bangkok DOWN, then the key page failing to 22 Aug 01:30; latest cause hard_fail
    const s = siteMonth(
      site('BA', 1, [
        inc(
          72,
          [downTo('2026-08-21T16:30:00Z', '2026-08-21T16:50:00Z'), problem('2026-08-21T16:50:00Z', 100)],
          'hard_fail',
          'hosting',
          [
            { at: at('2026-08-21T16:30:00Z'), trigger: 'hard_fail' },
            { at: at('2026-08-21T16:50:00Z'), trigger: 'key_page' },
          ],
        ),
      ]),
      aug,
    );
    expect(s.incidents[0]).toMatchObject({ kind: 'outage', minutes: 20 });
    expect(s.days[20]?.kind).toBe('outage'); // 21 Aug
    expect(s.days[21]?.kind).toBe('degraded'); // 22 Aug
  });
});

describe('open means what the client sees is still going (M1)', () => {
  it('August’s report: a 21 Aug outage that relapses on 2 Sep is closed in August', () => {
    const s = siteMonth(
      site('MuvMi', 1, [inc(80, [down('2026-08-21T07:00:00Z', 20), down('2026-09-02T01:00:00Z', null)])]),
      aug,
    );
    expect(s.incidents[0]).toMatchObject({ minutes: 20, open: false });
    expect(clientMonth([s]).open).toBe(0);
  });
  it('an outage back up while an SSL PROBLEM stays open (D-068) is not open', () => {
    const s = siteMonth(
      site('BA', 1, [
        inc(
          81,
          [down('2026-09-20T01:00:00Z', 20), problem('2026-09-20T01:20:00Z', null)],
          'hard_fail',
          null,
          [
            { at: at('2026-09-20T01:00:00Z'), trigger: 'hard_fail' },
            { at: at('2026-09-20T01:20:00Z'), trigger: 'ssl' },
          ],
        ),
      ]),
      sep,
    );
    expect(s.incidents[0]).toMatchObject({ kind: 'outage', minutes: 20, open: false });
  });
});

describe('maintenance, partial months and targets (spec §5, D-073 items 5–6)', () => {
  it('DOWN inside a maintenance window leaves both sides, the line and the day', () => {
    const s = siteMonth(
      site('Tubtong', 2, [inc(20, [downTo('2026-08-12T15:30:20Z', '2026-08-12T15:41:00Z')])], {
        maintenance: [{ start: at('2026-08-12T15:00:00Z'), end: at('2026-08-12T17:00:00Z') }],
      }),
      aug,
    );
    expect(s.downMinutes).toBe(0);
    expect(s.incidents).toEqual([]);
    expect(s.maintenanceMinutes).toBe(120);
    expect(s.uptime).toBe(1);
    expect(s.days[11]).toEqual({ kind: 'ok', maintenance: true }); // 12 Aug Bangkok
  });

  it('a site watched from 20 Aug counts from then; the days before are empty', () => {
    const s = siteMonth(site('WeCare', 3, [], { monitoringStartedAt: at('2026-08-19T17:00:00Z') }), aug);
    expect(s.windowMinutes).toBe(12 * 24 * 60);
    expect(s.days[18]?.kind).toBe('none'); // 19 Aug
    expect(s.days[19]?.kind).toBe('ok'); // 20 Aug
  });

  it.each([
    ['started after the month', at('2026-09-02T00:00:00Z'), aug],
    ['never started', null, aug],
    ['a month still to come', at('2026-07-01T00:00:00Z'), bangkokMonth('2026-12', SEP_NOW)],
    [
      'the month’s first second',
      at('2026-07-01T00:00:00Z'),
      bangkokMonth('2026-09', at('2026-08-31T17:00:00Z')),
    ],
  ] as const)('%s → no figures and nothing listed', (_c, started, month) => {
    const s = siteMonth(
      site('New', 3, [inc(90, [down('2026-08-21T07:00:00Z', 20)])], { monitoringStartedAt: started }),
      month,
    );
    expect(s.uptime).toBeNull();
    expect(s.metTarget).toBeNull();
    expect(s.incidents).toEqual([]);
    expect(s.days.every((d) => d.kind === 'none')).toBe(true);
  });

  // Tier 1 target 99.95% over 31 days (44,640 min) allows 22.32 min down — judged on the exact time.
  it.each([
    ['22 min', 22 * 60, true],
    ['22 min 24 s', 22 * 60 + 24, false],
    ['23 min', 23 * 60, false],
  ])('Tier 1, %s down in August → target met: %s', (_c, seconds, met) => {
    const s = siteMonth(
      site('MuvMi', 1, [
        inc(30, [
          downTo(
            '2026-08-21T07:06:00Z',
            new Date(at('2026-08-21T07:06:00Z').getTime() + seconds * 1000).toISOString(),
          ),
        ]),
      ]),
      aug,
    );
    expect(s.metTarget).toBe(met);
  });

  it('Tier 3, exactly at 99.5% (216 min in 30 days) meets it', () => {
    const s = siteMonth(
      site('WeCare', 3, [inc(31, [down('2026-09-10T01:00:00Z', 216)])]),
      bangkokMonth('2026-09', at('2026-10-01T00:00:00Z')),
    );
    expect(s.uptime).toBeCloseTo(0.995, 10);
    expect(s.metTarget).toBe(true);
  });

  it('a client meets its target only when every site meets its own', () => {
    const ok = siteMonth(site('A', 3, [inc(31, [down('2026-08-21T07:06:00Z', 100)])]), aug);
    const miss = siteMonth(site('B', 1, [inc(32, [down('2026-08-21T07:06:00Z', 30)])]), aug);
    expect(clientMonth([ok]).metTarget).toBe(true);
    expect(clientMonth([ok, miss]).metTarget).toBe(false);
  });

  it('an outage that started in July counts only its August minutes', () => {
    const s = siteMonth(site('ORCA', 2, [inc(33, [down('2026-07-31T16:50:00Z', 20)])]), aug);
    expect(s.incidents[0]).toMatchObject({ minutes: 10, startedBefore: true });
  });

  it('a day shows its worst event', () => {
    const s = siteMonth(
      site('BA', 1, [
        inc(40, [problem('2026-08-21T03:00:00Z', 30)], 'slow'),
        inc(41, [down('2026-08-21T07:06:00Z', 26)]),
      ]),
      aug,
    );
    expect(s.days[20]?.kind).toBe('outage');
  });
});

describe('engine review, round 2', () => {
  const confirmedProblem = (start: string, minutes: number | null, confirmed: string) => ({
    ...problem(start, minutes),
    confirmedAt: at(confirmed),
  });
  it('P1: a relapse stamped at its confirm — the drop’s first minutes take the new cause', () => {
    const s = siteMonth(
      site('Fuji', 2, [
        inc(
          100,
          [
            problem('2026-08-05T02:00:00Z', 30),
            confirmedProblem('2026-08-06T02:00:00Z', 60, '2026-08-06T02:03:00Z'),
          ],
          'slow',
          null,
          [
            { at: at('2026-08-06T02:03:00Z'), trigger: 'keyword' },
            { at: at('2026-08-05T02:00:00Z'), trigger: 'slow' },
          ],
        ),
      ]),
      aug,
    );
    expect(s.incidents[0]).toMatchObject({ kind: 'degraded', minutes: 30 });
  });
  it('P2: keyword, then an intermittent relapse counted from the 1st timeout (D-050)', () => {
    const s = siteMonth(
      site('Fuji', 2, [
        inc(
          101,
          [
            problem('2026-08-05T02:00:00Z', 30),
            confirmedProblem('2026-08-06T02:00:00Z', 60, '2026-08-06T02:30:00Z'),
          ],
          'keyword',
          null,
          [
            { at: at('2026-08-05T02:00:00Z'), trigger: 'keyword' },
            { at: at('2026-08-06T02:30:00Z'), trigger: 'intermittent' },
          ],
        ),
      ]),
      aug,
    );
    expect(s.incidents[0]).toMatchObject({ kind: 'degraded', minutes: 60 });
  });
  it('P3: an SSL drop since 25 Aug with a key-page stretch on 10 Sep starts on 10 Sep', () => {
    const s = siteMonth(
      site('BA', 1, [
        inc(102, [problem('2026-08-25T02:00:00Z', null)], 'ssl', null, [
          { at: at('2026-08-25T02:00:00Z'), trigger: 'ssl' },
          { at: at('2026-09-10T02:00:00Z'), trigger: 'key_page' },
          { at: at('2026-09-10T04:00:00Z'), trigger: 'ssl' },
        ]),
      ]),
      sep,
    );
    expect(s.incidents[0]).toMatchObject({
      kind: 'degraded',
      minutes: 120,
      startedBefore: false,
      open: false,
    });
    expect(s.incidents[0]?.startedAt.toISOString()).toBe('2026-09-10T02:00:00.000Z');
  });
  it('P4: a DOWN back up to a key page still failing at the month’s end is open (D-023, item 9)', () => {
    const s = siteMonth(
      site('BA', 1, [
        inc(
          103,
          [down('2026-08-31T10:00:00Z', 20), problem('2026-08-31T10:20:00Z', null)],
          'hard_fail',
          null,
          [
            { at: at('2026-08-31T10:00:00Z'), trigger: 'hard_fail' },
            { at: at('2026-08-31T10:20:00Z'), trigger: 'key_page' },
          ],
        ),
      ]),
      aug,
    );
    expect(s.incidents[0]).toMatchObject({ kind: 'outage', minutes: 20, open: true });
  });
  it('P5: a 40-second key-page stretch then slow, in one drop, is 10 minutes, not 11', () => {
    const s = siteMonth(
      site('BA', 1, [
        inc(104, [problem('2026-08-10T02:00:00Z', 10)], 'key_page', null, [
          { at: at('2026-08-10T02:00:00Z'), trigger: 'key_page' },
          { at: at('2026-08-10T02:00:40Z'), trigger: 'slow' },
        ]),
      ]),
      aug,
    );
    expect(s.incidents[0]?.minutes).toBe(10);
  });
  it('overlapping maintenance windows are counted once and cut the outage once', () => {
    const s = siteMonth(
      site('Tubtong', 2, [inc(105, [down('2026-08-12T14:30:00Z', 120)])], {
        maintenance: [
          { start: at('2026-08-12T15:00:00Z'), end: at('2026-08-12T16:00:00Z') },
          { start: at('2026-08-12T15:30:00Z'), end: at('2026-08-12T16:15:00Z') },
        ],
      }),
      aug,
    );
    expect(s.maintenanceMinutes).toBe(75);
    expect(s.incidents[0]?.minutes).toBe(45); // 14:30–15:00 and 16:15–16:30
    expect(s.downMinutes).toBe(45);
  });
  it('no maintenance cap on a day before monitoring started', () => {
    const s = siteMonth(
      site('WeCare', 3, [], {
        monitoringStartedAt: at('2026-08-19T17:00:00Z'),
        maintenance: [{ start: at('2026-08-05T15:00:00Z'), end: at('2026-08-05T17:00:00Z') }],
      }),
      aug,
    );
    expect(s.days[4]).toEqual({ kind: 'none', maintenance: false });
  });
});

describe('stopped periods are not watched (D-073 item 12)', () => {
  it('a site stopped 10–20 Aug: those days are empty, out of the window, and a DOWN then doesn’t count', () => {
    const s = siteMonth(
      site(
        'Tubtong',
        2,
        [inc(110, [down('2026-08-12T01:00:00Z', 60)]), inc(111, [down('2026-08-25T01:00:00Z', 10)])],
        {
          stopped: [{ start: at('2026-08-09T17:00:00Z'), end: at('2026-08-20T17:00:00Z') }],
        },
      ),
      aug,
    );
    expect(s.windowMinutes).toBe(20 * 24 * 60);
    expect(s.days[9]?.kind).toBe('none'); // 10 Aug
    expect(s.days[19]?.kind).toBe('none'); // 20 Aug
    expect(s.days[20]?.kind).toBe('ok'); // 21 Aug
    expect(s.incidents.map((i) => i.number)).toEqual([111]);
    expect(s.downMinutes).toBe(10);
    expect(s.uptime).toBeCloseTo(1 - 10 / (20 * 24 * 60), 10);
  });
  it('stopped for the whole month → no figures', () => {
    const s = siteMonth(
      site('Old', 3, [], {
        stopped: [{ start: at('2026-07-15T00:00:00Z'), end: at('2026-10-01T00:00:00Z') }],
      }),
      aug,
    );
    expect(s.windowMinutes).toBe(0);
    expect(s.days.every((d) => d.kind === 'none')).toBe(true);
  });
  it('maintenance inside a stopped stretch isn’t counted twice', () => {
    const s = siteMonth(
      site('Old', 3, [], {
        stopped: [{ start: at('2026-08-09T17:00:00Z'), end: at('2026-08-10T17:00:00Z') }],
        maintenance: [{ start: at('2026-08-10T10:00:00Z'), end: at('2026-08-10T20:00:00Z') }],
      }),
      aug,
    );
    expect(s.maintenanceMinutes).toBe(180); // 17:00–20:00 only
    expect(s.windowMinutes).toBe(30 * 24 * 60);
  });
});
