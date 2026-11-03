import { describe, expect, it } from 'vitest';
import { faultState, probeMissing, type LocationBeat } from './fault';

// Spec §14.4 / §15.3 (MainFault, Probes boards), D-053. Bangkok time.
const bkk = (iso: string) => new Date(`${iso}+07:00`);
const loc = (code: string, at: string | null): LocationBeat => ({ code, lastBeatAt: at ? bkk(at) : null });
const all = (at: string) => [loc('BKK', at), loc('SIN', at), loc('TYO', at)];

describe('faultState — the engine sweep (spec §14.4, D-053)', () => {
  it('MainFault: last sweep 02:17 → a fault from 02:20 (missed > 3 min), statuses as of the last round', () => {
    const at = (now: string) =>
      faultState({
        sweepAt: bkk('2026-09-26T02:17:00'),
        lastRoundAt: bkk('2026-09-26T02:17:00'),
        locations: [
          loc('BKK', '2026-09-26T02:31:00'),
          loc('SIN', '2026-09-26T02:18:00'),
          loc('TYO', '2026-09-26T02:18:00'),
        ],
        now: bkk(now),
      });
    expect(at('2026-09-26T02:19:59').engineFault).toBe(false);
    const f = at('2026-09-26T02:31:40');
    expect(f.engineFault).toBe(true);
    expect(f.since).toEqual(bkk('2026-09-26T02:17:00'));
    expect(f.staleMinutes).toBe(14);
    expect(f.asOf).toEqual(bkk('2026-09-26T02:17:00'));
    expect(f.beating).toEqual(['BKK']);
    expect(f.missing).toEqual(['SIN', 'TYO']);
    expect(at('2026-09-26T02:20:00').engineFault).toBe(true);
  });

  it('a healthy minute: no fault, every location beating', () => {
    const f = faultState({
      sweepAt: bkk('2026-09-25T10:07:00'),
      lastRoundAt: bkk('2026-09-25T10:07:00'),
      locations: all('2026-09-25T10:07:02'),
      now: bkk('2026-09-25T10:07:40'),
    });
    expect(f).toMatchObject({
      engineFault: false,
      staleMinutes: null,
      missing: [],
      beating: ['BKK', 'SIN', 'TYO'],
    });
  });

  it('no sweep recorded yet (a fresh deploy) is no data, not a fault', () => {
    expect(
      faultState({
        sweepAt: null,
        lastRoundAt: null,
        locations: all('2026-09-25T10:07:02'),
        now: bkk('2026-09-25T10:07:40'),
      }).engineFault,
    ).toBe(false);
  });

  it('a location that never beat counts as missing', () => {
    expect(
      faultState({
        sweepAt: bkk('2026-09-25T10:07:00'),
        lastRoundAt: bkk('2026-09-25T10:07:00'),
        locations: [loc('BKK', null), loc('SIN', '2026-09-25T10:07:01'), loc('TYO', '2026-09-25T10:07:02')],
        now: bkk('2026-09-25T10:07:30'),
      }).missing,
    ).toEqual(['BKK']);
  });
});

describe('probeMissing — one location missing > 3 min (spec §15.3, D-053)', () => {
  const run = (sin: string, now: string, sweep = now) =>
    probeMissing(
      faultState({
        sweepAt: bkk(`2026-09-25T${sweep}`),
        lastRoundAt: bkk(`2026-09-25T${sweep}`),
        locations: [
          loc('BKK', `2026-09-25T${now}`),
          loc('SIN', `2026-09-25T${sin}`),
          loc('TYO', `2026-09-25T${now}`),
        ],
        now: bkk(`2026-09-25T${now}`),
      }),
    );

  it('Probes board: SIN quiet from 03:12 → the one email at 03:15, not before', () => {
    expect(run('03:12:00', '03:14:59')).toBeNull();
    expect(run('03:12:00', '03:15:00')).toBe('SIN');
  });

  it('suppressed during an engine fault (spec §16.10)', () => {
    expect(run('03:12:00', '03:20:00', '03:16:00')).toBeNull();
  });

  it('two missing is probe_locations_low, not this one', () => {
    expect(
      probeMissing(
        faultState({
          sweepAt: bkk('2026-09-25T03:20:00'),
          lastRoundAt: bkk('2026-09-25T03:20:00'),
          locations: [
            loc('BKK', '2026-09-25T03:20:00'),
            loc('SIN', '2026-09-25T03:12:00'),
            loc('TYO', '2026-09-25T03:12:00'),
          ],
          now: bkk('2026-09-25T03:20:00'),
        }),
      ),
    ).toBeNull();
  });

  it.each([
    // [case, locations, now, expected]
    [
      'only 2 active, 1 missing: one left beating is too few',
      [loc('BKK', '2026-09-25T03:15:00'), loc('SIN', '2026-09-25T03:12:00')],
      '2026-09-25T03:15:00',
      null,
    ],
    [
      'exactly 3 min (180,000 ms) since its last beat is missing',
      all('2026-09-25T03:15:00').map((l) => (l.code === 'SIN' ? loc('SIN', '2026-09-25T03:12:00') : l)),
      '2026-09-25T03:15:00',
      'SIN',
    ],
    [
      '3 min less 1 ms is still beating',
      all('2026-09-25T03:15:00').map((l) => (l.code === 'SIN' ? loc('SIN', '2026-09-25T03:12:00.001') : l)),
      '2026-09-25T03:15:00',
      null,
    ],
  ] as const)('%s (engine review)', (_case, locations, now, expected) => {
    const state = faultState({ sweepAt: bkk(now), lastRoundAt: null, locations, now: bkk(now) });
    expect(probeMissing(state)).toBe(expected);
  });

  it('MainFault boundary: sweep 02:17, at 02:19:59.999 no fault, at 02:20 a fault', () => {
    const at = (now: string) =>
      faultState({
        sweepAt: bkk('2026-09-26T02:17:00'),
        lastRoundAt: null,
        locations: all(now),
        now: bkk(now),
      }).engineFault;
    expect(at('2026-09-26T02:19:59.999')).toBe(false);
    expect(at('2026-09-26T02:20:00')).toBe(true);
  });
});
