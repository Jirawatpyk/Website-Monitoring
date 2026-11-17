import { describe, expect, it } from 'vitest';
import { fakeDb } from '../../../test/fake-db';
import { loadWindows, windowHides } from './windows';

describe('engine windows (S09, D-036)', () => {
  it('a window hides new problems with nothing open or an incident that recovered, never one still failing', () => {
    expect(windowHides(null)).toBe(true);
    expect(windowHides(undefined)).toBe(true);
    expect(windowHides({ state: 'monitoring' })).toBe(true);
    expect(windowHides({ state: 'needs_root_cause' })).toBe(true);
    for (const state of ['unacked', 'escalated', 'acknowledged']) expect(windowHides({ state })).toBe(false);
  });

  it('D-067 item 3: an incident open only for SSL / domain expiry hides like none (as private.site_busy)', () => {
    const open = { state: 'acknowledged', severity: 'problem', episode_severity: 'problem' };
    expect(windowHides({ ...open, trigger: 'ssl' })).toBe(true);
    expect(windowHides({ ...open, trigger: 'domain', episode_severity: null })).toBe(true);
    expect(windowHides({ ...open, trigger: 'keyword' })).toBe(false);
    // A DOWN incident back up: hidden only while the expiry is its only failing verdict (Tao, 17 Nov).
    const down = { ...open, severity: 'down', trigger: 'hard_fail' };
    expect(windowHides(down)).toBe(false);
    expect(
      windowHides(down, [
        { status: 'problem', trigger: 'ssl' },
        { status: 'ok', trigger: null },
      ]),
    ).toBe(true);
    expect(
      windowHides(down, [
        { status: 'problem', trigger: 'ssl' },
        { status: 'problem', trigger: 'key_page' },
      ]),
    ).toBe(false);
  });

  it('reads only windows whose start engine_log_windows checked (a failed log hides nothing)', async () => {
    const { db, calls } = fakeDb({});
    await loadWindows(db, ['s1'], new Date('2026-10-06T10:00:00Z'));
    const read = calls.find((c) => c.table === 'maintenance_windows');
    expect(read?.filters).toContainEqual(['eq', 'start_logged', true]);
  });
});
