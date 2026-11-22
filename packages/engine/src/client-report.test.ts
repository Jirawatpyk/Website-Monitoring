import { describe, expect, it } from 'vitest';
import {
  bangkokMonth,
  clientKindOf,
  clientMonth,
  siteMonth,
  type ReportIncidentInput,
  type ReportSiteInput,
} from './client-report';

// Times are UTC; Bangkok = UTC+7. Spec §5 sample: September so far = 1 Sep 00:00 → Fri 25 Sep 10:07
// Bangkok = 31 Aug 17:00Z → 25 Sep 03:07Z, 35,167 minutes per site.
const SEP_NOW = new Date('2026-09-25T03:07:00Z');
const sep = bangkokMonth('2026-09', SEP_NOW);

const at = (iso: string) => new Date(iso);
const down = (start: string, minutes: number | null) => ({
  severity: 'down' as const,
  start: at(start),
  end: minutes === null ? null : new Date(at(start).getTime() + minutes * 60_000),
});
const problem = (start: string, minutes: number) => ({
  severity: 'problem' as const,
  start: at(start),
  end: new Date(at(start).getTime() + minutes * 60_000),
});
const inc = (
  number: number,
  episodes: ReportIncidentInput['episodes'],
  problemTrigger: ReportIncidentInput['problemTrigger'] = 'hard_fail',
  rootCauseCategory: string | null = 'hosting',
): ReportIncidentInput => ({ number, episodes, problemTrigger, rootCauseCategory });
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
  it('a running month ends at now, on Bangkok midnights', () => {
    expect(sep.from.toISOString()).toBe('2026-08-31T17:00:00.000Z');
    expect(sep.to.toISOString()).toBe('2026-09-25T03:07:00.000Z');
    expect(sep.running).toBe(true);
    expect(sep.days).toHaveLength(30);
    expect((sep.to.getTime() - sep.from.getTime()) / 60_000).toBe(35_167);
  });
  it('a past month runs to the next month’s first Bangkok midnight', () => {
    const aug = bangkokMonth('2026-08', SEP_NOW);
    expect(aug.from.toISOString()).toBe('2026-07-31T17:00:00.000Z');
    expect(aug.to.toISOString()).toBe('2026-08-31T17:00:00.000Z');
    expect(aug.running).toBe(false);
    expect(aug.days).toHaveLength(31);
  });
});

describe('clientKindOf (spec §12, D-073 items 2–3)', () => {
  it.each([
    ['hard_fail', true, 'outage'],
    ['manual', true, 'outage'],
    ['slow', false, 'degraded'],
    ['key_page', false, 'degraded'],
    ['regional', false, 'degraded'],
    ['intermittent', false, 'degraded'],
    ['ssl', false, null],
    ['domain', false, null],
    ['tls_chain', false, null],
    ['keyword', false, null],
    ['redirect', false, null],
    ['content_change', false, null],
    ['blocked_unverified', false, null],
  ] as const)('%s (a DOWN drop: %s) → %s', (trigger, hasDown, kind) => {
    expect(clientKindOf(trigger, hasDown)).toBe(kind);
  });
  it('a PROBLEM that became DOWN is an outage, whatever its trigger', () => {
    expect(clientKindOf('ssl', true)).toBe('outage');
  });
});

describe('spec §5 September so far — clients only', () => {
  // BA: Taiwan 11 min DOWN + an internal SSL PROBLEM (not counted, not listed); China a 14-min slow booking page.
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
  });
});

describe('maintenance, partial months and targets (spec §5, D-073 items 5–6)', () => {
  const aug = bangkokMonth('2026-08', SEP_NOW);

  it('DOWN inside a maintenance window leaves both sides, and the day gets its cap', () => {
    const s = siteMonth(
      site('Tubtong', 2, [inc(20, [down('2026-08-12T15:30:00Z', 60)])], {
        maintenance: [{ start: at('2026-08-12T15:00:00Z'), end: at('2026-08-12T17:00:00Z') }],
      }),
      aug,
    );
    expect(s.downMinutes).toBe(0);
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

  it('a site never monitored in the month has no figures', () => {
    const s = siteMonth(site('New', 3, [], { monitoringStartedAt: at('2026-09-02T00:00:00Z') }), aug);
    expect(s.windowMinutes).toBe(0);
    expect(s.uptime).toBeNull();
    expect(s.metTarget).toBeNull();
  });

  // Tier 1 target 99.95% over 31 days (44,640 min) allows 22.32 min down.
  it.each([
    [22, true],
    [23, false],
  ])('Tier 1, %s min down in August → target met: %s', (minutes, met) => {
    const s = siteMonth(site('MuvMi', 1, [inc(30, [down('2026-08-21T07:06:00Z', minutes)])]), aug);
    expect(s.metTarget).toBe(met);
  });

  it('a client meets its target only when every site meets its own', () => {
    const ok = siteMonth(site('A', 3, [inc(31, [down('2026-08-21T07:06:00Z', 100)])]), aug); // 99.78% ≥ 99.5%
    const miss = siteMonth(site('B', 1, [inc(32, [down('2026-08-21T07:06:00Z', 30)])]), aug); // < 99.95%
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
