import { describe, expect, it } from 'vitest';
import { agoText, beatRowsOf, gapLinesOf, probeCardsOf, summaryOf } from './model';

// The Probes board: now 10:07:12 Bangkok; SIN missed 03:12–03:16.
const now = new Date('2026-09-25T03:07:12Z');
const ago = (s: number) => new Date(now.getTime() - s * 1000).toISOString();

const facts = {
  engineSweep: ago(12),
  notifier: ago(12),
  crawler: ago(20 * 60),
  verifier: ago(31),
  watchdog: ago(9),
  locations: { BKK: ago(2), SIN: ago(8), TYO: ago(10) },
};

describe('beatRowsOf (S12a, spec §15.3)', () => {
  it('every check with its grace; only the engine pages', () => {
    const rows = beatRowsOf(facts, now);
    expect(rows.map((r) => r.name)).toEqual([
      'engine',
      'notifier',
      'probe-bkk',
      'probe-sin',
      'probe-tyo',
      'browser-verifier',
      'vps-watchdog',
      'crawler',
    ]);
    expect(rows.filter((r) => r.pages).map((r) => r.name)).toEqual(['engine']);
    expect(rows.every((r) => r.status === 'up')).toBe(true);
    expect(rows.at(-1)).toMatchObject({ every: '30 min', grace: '15 min' });
    expect(summaryOf(rows)).toEqual({ healthy: true, title: 'Monitor healthy · 8/8 heartbeats on time' });
  });

  it('down past period + grace; never pinged is waiting and not counted', () => {
    const rows = beatRowsOf({ ...facts, engineSweep: ago(4 * 60 + 1), watchdog: null }, now);
    expect(rows.find((r) => r.name === 'engine')?.status).toBe('down');
    expect(rows.find((r) => r.name === 'vps-watchdog')?.status).toBe('waiting');
    // the engine's rule: a minute check is missed at 3 min (D-053, as the cards and the Overview)
    expect(beatRowsOf({ ...facts, engineSweep: ago(3 * 60 - 1) }, now)[0]?.status).toBe('up');
    expect(beatRowsOf({ ...facts, engineSweep: ago(3 * 60) }, now)[0]?.status).toBe('down');
    expect(summaryOf(rows)).toEqual({ healthy: false, title: '1 heartbeat missed · engine' });
    // nothing pinged yet: no claim of health
    const none = beatRowsOf(
      { engineSweep: null, notifier: null, crawler: null, verifier: null, watchdog: null, locations: {} },
      now,
    );
    expect(summaryOf(none)).toEqual({ healthy: false, empty: true, title: 'No heartbeats yet' });
  });

  it('says how long ago', () => {
    expect(agoText(ago(12), now)).toBe('12 s ago');
    expect(agoText(ago(62 * 60), now)).toBe('1 h 2 min ago');
  });
});

describe('probeCardsOf and gapLinesOf', () => {
  const gaps = [{ location: 'SIN', gap_start: '2026-09-24T20:12:00Z', gap_end: '2026-09-24T20:16:00Z' }];
  const activity = [
    { location: 'BKK', hour: '2026-09-25T02:00:00Z', results: 522 },
    { location: 'BKK', hour: '2026-09-25T03:00:00Z', results: 60 },
    { location: 'SIN', hour: '2026-09-24T20:00:00Z', results: 400 },
  ];

  it('per-hour bars, checks a minute from the last full hour, gaps, healthy from the last beat', () => {
    const [bkk, sin, tyo] = probeCardsOf(activity, gaps, { BKK: ago(2), SIN: ago(8), TYO: null }, now);
    expect(bkk).toMatchObject({ code: 'BKK', city: 'Bangkok', rate: '8.7', gaps: '0', healthy: true });
    expect(bkk?.hours[23]).toBe(60);
    expect(bkk?.hours[22]).toBe(522);
    expect(sin).toMatchObject({ gaps: '1 · 4 min', rate: null });
    expect(sin?.hours[16]).toBe(400);
    expect(sin?.gapHours[16]).toBe(true);
    expect(sin?.gapHours.filter(Boolean)).toHaveLength(1);
    expect(tyo).toMatchObject({ healthy: false, lastRunAt: null });
  });

  it('a silence still going on counts as a gap, and its hours show', () => {
    const [, , tyo] = probeCardsOf([], [], { BKK: ago(2), SIN: ago(8), TYO: ago(2 * 3600) }, now);
    expect(tyo).toMatchObject({ healthy: false, gaps: '1 · 2 h' });
    expect(tyo?.gapHours.slice(21)).toEqual([true, true, true]);
  });

  it('says who was emailed for a gap when the alert is readable (Admins), else claims nothing', () => {
    const alerts = [{ context: { location: 'SIN' }, opened_at: '2026-09-24T20:15:00Z' }];
    expect(gapLinesOf(gaps, alerts)[0]?.text).toBe(
      'SIN reported nothing 03:12–03:16 (4 min) → one email to the Admins at 03:15, no page',
    );
    expect(gapLinesOf(gaps, [])[0]?.text).toContain('→ no email (the status engine was down');
  });

  it('words each gap', () => {
    expect(gapLinesOf(gaps)).toEqual([
      { at: '2026-09-24T20:16:00Z', text: 'SIN reported nothing 03:12–03:16 (4 min)' },
    ]);
  });
});
