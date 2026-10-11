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

  it('reads only windows whose start engine_log_windows checked (a failed log hides nothing)', async () => {
    const { db, calls } = fakeDb({});
    await loadWindows(db, ['s1'], new Date('2026-10-06T10:00:00Z'));
    const read = calls.find((c) => c.table === 'maintenance_windows');
    expect(read?.filters).toContainEqual(['eq', 'start_logged', true]);
  });
});
