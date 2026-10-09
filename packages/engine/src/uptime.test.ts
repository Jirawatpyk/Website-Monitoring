import { describe, expect, it } from 'vitest';
import { formatPercent } from '@dxt/shared';
import { episodesFromTimeline, type Episode } from './lifecycle';
import { aggregateUptime, downMinutesIn, siteUptime, siteUptimeOver } from './uptime';

const WINDOW_30D = 43_200;

describe('siteUptime (spec §5)', () => {
  it('matches the 30-day sample figures', () => {
    const muvmi = siteUptime({ windowMinutes: WINDOW_30D, downMinutes: 101, maintenanceMinutes: 0 });
    expect(formatPercent(muvmi)).toBe('99.77%');
    const orca = siteUptime({ windowMinutes: WINDOW_30D, downMinutes: 8, maintenanceMinutes: 0 });
    expect(formatPercent(orca)).toBe('99.98%');
    const voca = siteUptime({ windowMinutes: WINDOW_30D, downMinutes: 41, maintenanceMinutes: 0 });
    expect(formatPercent(voca)).toBe('99.91%');
    // MainFault board, Sat 26 Sep 02:31: MuvMi 125 min
    const muvmiSat = siteUptime({ windowMinutes: WINDOW_30D, downMinutes: 125, maintenanceMinutes: 0 });
    expect(formatPercent(muvmiSat)).toBe('99.71%');
  });

  it('removes maintenance from both sides', () => {
    expect(siteUptime({ windowMinutes: 100, downMinutes: 0, maintenanceMinutes: 100 })).toBe(1);
    expect(siteUptime({ windowMinutes: 100, downMinutes: 10, maintenanceMinutes: 50 })).toBeCloseTo(0.8);
  });
});

// Fri 25 Sep 2026 10:07 (UTC+7) — the boards' "now" (spec §1).
const NOW = new Date('2026-09-25T03:07:00Z');
const at = (iso: string) => new Date(`${iso}+07:00`);
const down = (start: string, end: string | null): Episode => ({
  start: at(start),
  end: end ? at(end) : null,
  severity: 'down',
});

describe('downMinutesIn (spec §5: DOWN minutes inside the window)', () => {
  const from = at('2026-08-26T10:07:00');
  it.each([
    ['a drop inside the window', [down('2026-09-02T03:40:00', '2026-09-02T03:51:00')], 11],
    [
      'a drop straddling the window start counts from the start',
      [down('2026-08-26T10:00:00', '2026-08-26T10:17:00')],
      10,
    ],
    ['a drop before the window', [down('2026-08-21T10:00:00', '2026-08-21T10:26:00')], 0],
    [
      'a drop still in progress runs to now (INC-0142: 19 min at 10:07)',
      [down('2026-09-25T09:48:00', null)],
      19,
    ],
    [
      'a PROBLEM drop counts as up',
      [{ start: at('2026-09-25T09:52:00'), end: null, severity: 'problem' as const }],
      0,
    ],
    [
      'flapping VOCA, four drops = 41 min',
      [
        down('2026-09-21T03:12:00', '2026-09-21T03:19:00'),
        down('2026-09-21T03:24:00', '2026-09-21T03:35:00'),
        down('2026-09-21T03:38:00', '2026-09-21T03:52:00'),
        down('2026-09-21T03:55:00', '2026-09-21T04:04:00'),
      ],
      41,
    ],
  ])('%s', (_name, episodes, minutes) => {
    expect(downMinutesIn(episodes, from, NOW)).toBe(minutes);
  });
});

describe('siteUptimeOver (D-031: the window starts no earlier than monitoring)', () => {
  // MuvMi's 30-day sample: 101 DOWN minutes → 99.77% (INC-0120 47, INC-0126 35, INC-0142 19 so far)
  const muvmi = [
    down('2026-09-08T19:30:00', '2026-09-08T20:17:00'),
    down('2026-09-11T14:05:00', '2026-09-11T14:40:00'),
    down('2026-09-25T09:48:00', null),
  ];

  it('MuvMi 30 d = 99.77% (spec §5)', () => {
    const r = siteUptimeOver(muvmi, {
      now: NOW,
      rangeMinutes: WINDOW_30D,
      monitoringStartedAt: at('2026-01-01T00:00:00'),
    });
    expect(r?.downMinutes).toBe(101);
    expect(r?.windowMinutes).toBe(WINDOW_30D);
    expect(formatPercent(r!.uptime)).toBe('99.77%');
  });

  it('a site monitored for less than the range is judged on the time it was watched', () => {
    const r = siteUptimeOver([down('2026-09-25T09:48:00', null)], {
      now: NOW,
      rangeMinutes: WINDOW_30D,
      monitoringStartedAt: at('2026-09-24T10:07:00'),
    });
    expect(r?.windowMinutes).toBe(1440);
    expect(formatPercent(r!.uptime)).toBe('98.68%');
  });

  it('is null for a site that was never monitored (a draft)', () => {
    expect(siteUptimeOver([], { now: NOW, rangeMinutes: WINDOW_30D, monitoringStartedAt: null })).toBeNull();
  });

  it('a 24 h range with no drop is 100%', () => {
    const r = siteUptimeOver(muvmi.slice(0, 2), {
      now: NOW,
      rangeMinutes: 1440,
      monitoringStartedAt: at('2026-01-01T00:00:00'),
    });
    expect(r?.uptime).toBe(1);
  });
});

describe('episodesFromTimeline (stored incident_events → drops)', () => {
  it('reads detected / recovered / relapsed rows and their payload start', () => {
    const drops = episodesFromTimeline({ started_at: '2026-09-21T03:12:00+07:00', severity: 'down' }, [
      { type: 'detected', at: '2026-09-21T03:12:40+07:00', payload: {} },
      { type: 'recovered', at: '2026-09-21T03:19:00+07:00', payload: {} },
      {
        type: 'relapsed',
        at: '2026-09-21T03:24:40+07:00',
        payload: { startedAt: '2026-09-21T03:24:00+07:00', severity: 'down' },
      },
      { type: 'recovered', at: '2026-09-21T03:35:00+07:00', payload: {} },
      { type: 'acknowledged', at: '2026-09-21T08:04:00+07:00', payload: null },
      { type: 'detected', at: 'not a date', payload: {} },
    ]);
    expect(downMinutesIn(drops, at('2026-09-21T00:00:00'), at('2026-09-21T12:00:00'))).toBe(18);
  });

  it('a PROBLEM incident raised to DOWN (D-021) starts its downtime at downStartedAt', () => {
    const drops = episodesFromTimeline({ started_at: '2026-09-25T09:30:00+07:00', severity: 'problem' }, [
      { type: 'detected', at: '2026-09-25T09:31:00+07:00', payload: {} },
      { type: 'recovered', at: '2026-09-25T09:40:00+07:00', payload: {} },
      {
        type: 'escalated_to_down',
        at: '2026-09-25T09:51:00+07:00',
        payload: { downStartedAt: '2026-09-25T09:50:00+07:00', severity: 'down' },
      },
    ]);
    expect(downMinutesIn(drops, at('2026-09-25T00:00:00'), NOW)).toBe(17);
  });
});

describe('aggregateUptime', () => {
  it('is time-weighted across 17 sites (173 DOWN min / 734,400)', () => {
    const downBySite = [101, 11, 12, 8, 41, ...Array.from({ length: 12 }, () => 0)];
    const sites = downBySite.map((downMinutes) => ({
      windowMinutes: WINDOW_30D,
      downMinutes,
      maintenanceMinutes: 0,
    }));
    expect(formatPercent(aggregateUptime(sites))).toBe('99.98%');
  });

  it('is 100% with no sites', () => {
    expect(aggregateUptime([])).toBe(1);
  });
});
