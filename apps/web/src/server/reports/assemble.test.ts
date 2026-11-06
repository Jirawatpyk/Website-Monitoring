import { describe, expect, it } from 'vitest';
import { reportIncident, roundsOf, type IncidentRow } from './assemble';

// Spec examples as test data (INC-0133 VOCA, INC-0142 MuvMi) — never product code.
const bkk = (s: string) => new Date(`${s}+07:00`);
const iso = (s: string) => bkk(s).toISOString();
const week = { from: bkk('2026-09-21T00:00:00'), to: bkk('2026-09-28T00:00:00') };
const now = bkk('2026-09-28T09:00:00');
const insideHours = (d: Date) => {
  const b = new Date(d.getTime() + 7 * 3_600_000);
  return b.getUTCDay() >= 1 && b.getUTCDay() <= 5 && b.getUTCHours() >= 9 && b.getUTCHours() < 18;
};

const row = (over: Partial<IncidentRow>): IncidentRow => ({
  number: 133,
  state: 'resolved',
  severity: 'down',
  trigger: 'hard_fail',
  started_at: iso('2026-09-21T03:12:00'),
  resolved_at: iso('2026-09-21T10:00:00'),
  acked_at: null,
  escalation_level: 0,
  client_updated_at: null,
  site: { name: 'VOCA', tier: 2, owner: { name: 'Ploy', chatUserId: '1' } },
  acker: null,
  updater: null,
  events: [],
  ...over,
});

// VOCA flapped ×4: 03:12–03:19, 03:25–03:36, 03:40–03:52, 03:55–04:06 (spec §4) — 41 min down.
const voca = row({
  events: [
    { type: 'detected', at: iso('2026-09-21T03:13:00'), payload: { cause: 'HTTP 503 (BKK, SIN, TYO)' } },
    { type: 'recovered', at: iso('2026-09-21T03:19:00'), payload: {} },
    {
      type: 'relapsed',
      at: iso('2026-09-21T03:26:00'),
      payload: { startedAt: iso('2026-09-21T03:25:00'), severity: 'down' },
    },
    { type: 'recovered', at: iso('2026-09-21T03:36:00'), payload: {} },
    {
      type: 'relapsed',
      at: iso('2026-09-21T03:41:00'),
      payload: { startedAt: iso('2026-09-21T03:40:00'), severity: 'down' },
    },
    { type: 'recovered', at: iso('2026-09-21T03:52:00'), payload: {} },
    {
      type: 'relapsed',
      at: iso('2026-09-21T03:56:00'),
      payload: { startedAt: iso('2026-09-21T03:55:00'), severity: 'down' },
    },
    { type: 'recovered', at: iso('2026-09-21T04:06:00'), payload: {} },
  ],
});

describe('reportIncident (WeeklySummary: a DOWN counts once, durations are down time)', () => {
  it('VOCA: four drops, 41 min, outside response hours, the short cause', () => {
    expect(reportIncident(voca, week.from, week.to, now, insideHours)).toMatchObject({
      site: 'VOCA',
      severity: 'down',
      startedAt: bkk('2026-09-21T03:12:00'),
      startedBefore: false,
      minutes: 41,
      drops: 4,
      failing: false,
      cause: '503 ×3',
      outsideHours: true,
    });
  });

  it('clips a drop that began before the period, and says so', () => {
    const r = reportIncident(voca, bkk('2026-09-21T03:30:00'), week.to, now, insideHours)!;
    expect(r.startedBefore).toBe(true); // the 03:25 drop is still going at 03:30
    expect(r.drops).toBe(3);
    expect(r.minutes).toBe(6 + 12 + 11);
    const mid = reportIncident(voca, bkk('2026-09-21T03:15:00'), week.to, now, insideHours)!;
    expect(mid.startedBefore).toBe(true);
    expect(mid.minutes).toBe(4 + 11 + 12 + 11);
  });

  it('leaves out an incident with no drop in the period', () => {
    expect(reportIncident(voca, bkk('2026-09-22T00:00:00'), week.to, now, insideHours)).toBeNull();
  });

  it('a PROBLEM raised to DOWN counts its DOWN time only, as uptime does', () => {
    const raised = row({
      number: 142,
      severity: 'down',
      trigger: 'slow',
      started_at: iso('2026-09-25T09:30:00'),
      site: { name: 'MuvMi', tier: 1, owner: null },
      events: [
        { type: 'detected', at: iso('2026-09-25T09:31:00'), payload: { summary: 'Slow, p50 5.8 s' } },
        {
          type: 'escalated_to_down',
          at: iso('2026-09-25T09:48:41'),
          payload: {
            downStartedAt: iso('2026-09-25T09:47:00'),
            cause: 'Timeout > 30 s (BKK, TYO) · HTTP 504 (SIN)',
          },
        },
        { type: 'recovered', at: iso('2026-09-25T10:30:00'), payload: {} },
      ],
    });
    const r = reportIncident(raised, week.from, week.to, now, insideHours)!;
    expect(r).toMatchObject({
      severity: 'down',
      minutes: 43,
      drops: 1,
      cause: 'Timeout ×2 · 504 ×1',
      outsideHours: false,
    });
  });

  it('an open drop runs to now (still failing), and names who acked and updated the client', () => {
    const open = row({
      state: 'acknowledged',
      resolved_at: null,
      started_at: iso('2026-09-28T08:50:00'),
      acked_at: iso('2026-09-28T08:55:00'),
      client_updated_at: iso('2026-09-28T08:58:00'),
      acker: { display_name: 'Arm' },
      updater: { display_name: 'Bua' },
      events: [{ type: 'detected', at: iso('2026-09-28T08:51:00'), payload: {} }],
    });
    const r = reportIncident(open, bkk('2026-09-28T00:00:00'), now, now, insideHours)!;
    expect(r).toMatchObject({
      failing: true,
      minutes: 10,
      cause: 'Hard fail',
      acked: { by: 'Arm', at: bkk('2026-09-28T08:55:00') },
      clientUpdate: { by: 'Bua', at: bkk('2026-09-28T08:58:00') },
    });
    expect(
      reportIncident(
        { ...open, client_update_not_needed: true },
        bkk('2026-09-28T00:00:00'),
        now,
        now,
        insideHours,
      )!.clientUpdate,
    ).toBeNull();
  });
});

describe('roundsOf ("Monitor ran 99.7% of rounds on time")', () => {
  const from = bkk('2026-09-21T00:00:00');
  const to = bkk('2026-09-28T00:00:00');
  it('takes the silences off the period', () => {
    const r = roundsOf(
      [
        {
          first_minute: iso('2026-09-20T00:00:00'),
          gap_start: iso('2026-09-26T02:17:00'),
          gap_end: iso('2026-09-26T02:43:00'),
        },
      ],
      from,
      to,
    );
    expect(r.engineGaps).toEqual([{ start: bkk('2026-09-26T02:17:00'), end: bkk('2026-09-26T02:43:00') }]);
    expect(r.roundsShare).toBeCloseTo(1 - 26 / (7 * 1440), 6);
  });
  it('no silence → 100%; no record → nothing to say', () => {
    expect(
      roundsOf([{ first_minute: iso('2026-09-20T00:00:00'), gap_start: null, gap_end: null }], from, to)
        .roundsShare,
    ).toBe(1);
    expect(
      roundsOf([{ first_minute: null, gap_start: null, gap_end: null }], from, to).roundsShare,
    ).toBeNull();
  });
  it('counts from when the record began inside the period', () => {
    const r = roundsOf(
      [{ first_minute: iso('2026-09-27T00:00:00'), gap_start: null, gap_end: null }],
      from,
      to,
    );
    expect(r.roundsShare).toBe(1);
  });
});
