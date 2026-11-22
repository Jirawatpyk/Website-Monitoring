import { describe, expect, it } from 'vitest';
import { stableJson } from './drafts';
import { nextMonth } from './month';
import { incidentsShort, REPORT_STATUS, statusNote } from './words';

// S20 code review: what the page says (spec §42 item 8) and how a draft is compared (D-073 item 13).
describe('stableJson', () => {
  it('the same figures in another key order (jsonb) compare equal; a changed value does not', () => {
    const built = { v: 1, sites: [{ name: 'A', days: [{ kind: 'ok', maintenance: false }] }], p50: null };
    const stored = { p50: null, sites: [{ days: [{ maintenance: false, kind: 'ok' }], name: 'A' }], v: 1 };
    expect(stableJson(stored)).toBe(stableJson(built));
    expect(stableJson({ ...stored, p50: 400 })).not.toBe(stableJson(built));
    expect(stableJson(undefined)).toBe('null');
  });
});

describe('page words (§42 item 8)', () => {
  it('statuses, notes and counts', () => {
    expect(Object.values(REPORT_STATUS).map((s) => s.words)).toEqual([
      'Draft ready',
      'No draft yet',
      'Month running',
      'Draft out of date',
    ]);
    expect(statusNote('running', '2026-12')).toBe(
      'Generated on demand from live figures — nothing is stored or sent until the 1 Jan draft.',
    );
    expect(statusNote('draft', '2026-10')).toBeNull();
    expect(statusNote('not_drafted', '2026-10')).toMatch(/within a few minutes/);
    expect(statusNote('unreadable', '2026-10')).toMatch(/within a few minutes/);
    expect([incidentsShort('1'), incidentsShort('0'), incidentsShort('3')]).toEqual([
      '1 incident',
      '0 incidents',
      '3 incidents',
    ]);
    expect(nextMonth('2026-12')).toBe('2027-01');
  });
});
