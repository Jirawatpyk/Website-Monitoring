import { describe, expect, it } from 'vitest';
import { isEngineFault, monitorFaultOf } from './assemble';
import { faultBannerOf } from './model';
import type { ProbeHealth } from './types';

// Spec §14.4 / MainFault: the last sweep and round at 02:17 (Bangkok), now 02:31.
const sweep = '2026-09-25T19:17:00Z';
const now = new Date('2026-09-25T19:31:40Z');
const bkkOnly: ProbeHealth = { beating: ['BKK'], total: 3, verifier: 'idle' };

describe('the monitor fault (S12a, D-053)', () => {
  it('is a fault from 3 min after the last sweep; a sweep that never ran is none', () => {
    expect(isEngineFault(sweep, new Date('2026-09-25T19:19:59Z'))).toBe(false);
    expect(isEngineFault(sweep, new Date('2026-09-25T19:20:00Z'))).toBe(true);
    expect(isEngineFault(null, now)).toBe(false);
    expect(monitorFaultOf(sweep, sweep, new Date('2026-09-25T19:18:00Z'), null)).toBeNull();
  });

  it('MainFault: statuses 14 min old, who was alerted at 02:20, BKK still collecting', () => {
    const fault = monitorFaultOf(sweep, sweep, now, 'Ploy')!;
    expect(fault.alertedAt).toBe('2026-09-25T19:20:00.000Z');
    const b = faultBannerOf(fault, bkkOnly, now);
    expect(b.title).toBe('Monitoring is degraded — statuses below are 14 min old');
    expect(b.cause).toBe(
      'The status engine’s sweep hasn’t run since 02:17 — escalations, reminders and recoveries wait until it does. BKK still reports; SIN and TYO have no results.',
    );
    expect(b.alerted).toBe(
      'Engine heartbeat missed > 3 min, from 02:20 → Healthchecks.io emails the Admins and the VPS watchdog posts in the Alerts Space @mentioning Ploy (on call).',
    );
    expect(b.pill).toBe('Heartbeat missed 14 min');
    expect(b.asOf).toBe('statuses as of 02:17');
  });

  it('only the sweep is down (BKK ingest still judges rounds): says the sweep stopped, not that statuses are old', () => {
    const fault = monitorFaultOf(sweep, '2026-09-25T19:31:10Z', now, null)!;
    const b = faultBannerOf(fault, { beating: ['BKK', 'SIN', 'TYO'], total: 3, verifier: 'idle' }, now);
    expect(b.title).toBe('Monitoring is degraded — the status engine’s sweep stopped 14 min ago');
    expect(b.cause).not.toContain('no results');
    expect(b.alerted).toBe(
      'Engine heartbeat missed > 3 min, from 02:20 → Healthchecks.io emails the Admins and the VPS watchdog posts in the Alerts Space.',
    );
  });

  it('no round yet, and no location reporting', () => {
    const b = faultBannerOf(
      monitorFaultOf(sweep, null, now, null)!,
      { beating: [], total: 3, verifier: 'offline' },
      now,
    );
    expect(b.title).toBe('Monitoring is degraded — statuses below are not in yet');
    expect(b.cause).toContain('No probe location is reporting.');
    expect(b.asOf).toBeNull();
  });
});
