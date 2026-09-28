import { describe, expect, it } from 'vitest';
import { formatPercent } from '@dxt/shared';
import { aggregateUptime, siteUptime } from './uptime';

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
