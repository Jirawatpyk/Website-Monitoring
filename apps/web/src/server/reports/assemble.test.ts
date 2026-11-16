import { describe, expect, it } from 'vitest';
import {
  causeOf,
  reportIncident,
  rootCauseOf,
  roundsOf,
  stillFailingRows,
  type IncidentRow,
} from './assemble';

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

  // §19.7 / D-023: a PROBLEM raised to DOWN whose home page came back while the certificate chain still
  // fails — its DOWN minutes stand, but it isn't recovered: the PROBLEM drop is still open.
  const chainStillBroken = row({
    number: 3,
    state: 'acknowledged',
    severity: 'down',
    trigger: 'tls_chain',
    started_at: iso('2026-09-10T18:00:00'),
    resolved_at: null,
    site: { name: 'Cando Asia', tier: 2, owner: null },
    events: [
      { type: 'detected', at: iso('2026-09-10T18:01:30'), payload: { summary: 'TLS chain misconfigured' } },
      {
        type: 'escalated_to_down',
        at: iso('2026-09-25T08:01:13'),
        payload: { downStartedAt: iso('2026-09-25T08:00:00'), cause: 'Browser: page didn’t load' },
      },
      { type: 'recovered', at: iso('2026-09-25T08:03:01'), payload: {} },
      {
        type: 'relapsed',
        at: iso('2026-09-25T08:03:01'),
        payload: {
          startedAt: iso('2026-09-25T08:03:01'),
          severity: 'problem',
          summary: 'TLS chain misconfigured',
        },
      },
    ],
  });

  it('a DOWN that came back with a PROBLEM still open: its DOWN minutes, not recovered', () => {
    expect(reportIncident(chainStillBroken, week.from, week.to, now, insideHours)).toMatchObject({
      severity: 'down',
      minutes: 3,
      drops: 1,
      failing: false,
      stillProblem: 'TLS chain misconfigured',
    });
    // Once that PROBLEM clears it is an ordinary recovered DOWN.
    const cleared = {
      ...chainStillBroken,
      events: [
        ...chainStillBroken.events,
        { type: 'recovered', at: iso('2026-09-26T10:00:00'), payload: {} },
      ],
    };
    expect(reportIncident(cleared, week.from, week.to, now, insideHours)!.stillProblem).toBeNull();
    // DOWN AGAIN after the period ended, still down at the report: failing, not "recovered".
    const downAgain = {
      ...chainStillBroken,
      events: [
        ...chainStillBroken.events,
        {
          type: 'relapsed',
          at: iso('2026-09-28T05:01:00'),
          payload: { startedAt: iso('2026-09-28T05:00:00'), severity: 'down' },
        },
      ],
    };
    expect(reportIncident(downAgain, week.from, week.to, now, insideHours)).toMatchObject({
      failing: true,
      stillProblem: null,
    });
    // The PROBLEM drop opened after the period ended (Monday 05:00, the weekly at 09:00): still open.
    const lateWeek = { from: bkk('2026-09-18T00:00:00'), to: bkk('2026-09-25T08:02:00') };
    expect(reportIncident(chainStillBroken, lateWeek.from, lateWeek.to, now, insideHours)!.stillProblem).toBe(
      'TLS chain misconfigured',
    );
    // The DOWN was the week before; this week only the PROBLEM drop: still the home page back, still failing.
    const nextWeek = { from: bkk('2026-09-28T00:00:00'), to: bkk('2026-10-05T00:00:00') };
    expect(
      reportIncident(chainStillBroken, nextWeek.from, nextWeek.to, bkk('2026-10-05T09:00:00'), insideHours),
    ).toMatchObject({ severity: 'problem', failing: true, stillProblem: 'TLS chain misconfigured' });
    // VOCA ended on a recovery: nothing still open.
    expect(reportIncident(voca, week.from, week.to, now, insideHours)!.stillProblem).toBeNull();
  });

  it('a DOWN back with something still failing needs someone until a root cause is written (§36.7)', () => {
    const r = reportIncident(
      { ...chainStillBroken, site: { ...chainStillBroken.site, owner: { name: 'Ploy', chatUserId: null } } },
      week.from,
      week.to,
      now,
      insideHours,
    )!;
    expect(stillFailingRows([r])).toEqual([
      {
        kind: 'root_cause',
        text: 'Cando Asia — still failing since Fri 25 Sep (TLS chain misconfigured), no root cause yet',
        who: [{ name: 'Ploy', chatUserId: null }],
      },
    ]);
    expect(stillFailingRows([{ ...r, rootCause: 'host fixed the chain' }])).toEqual([]);
    expect(stillFailingRows([reportIncident(voca, week.from, week.to, now, insideHours)!])).toEqual([]);
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
        // As the engine writes a PROBLEM: both a cause and a summary (engine review S14, M1).
        {
          type: 'detected',
          at: iso('2026-09-25T09:31:00'),
          payload: { cause: 'Slow: p50 5.8 s (BKK, SIN, TYO)', summary: 'Slow, p50 5.8 s' },
        },
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
    // The embed has no order: the same in reverse.
    const reversed = { ...raised, events: [...raised.events].reverse() };
    expect(reportIncident(reversed, week.from, week.to, now, insideHours)!.cause).toBe('Timeout ×2 · 504 ×1');
    expect(causeOf(raised, 'problem')).toBe('Slow, p50 5.8 s');
    // Raised by hand (D-055 item 7): no probe cause — "Manual (hand check)", never "Hard fail" (/verify S14).
    const byHand = {
      ...raised,
      events: raised.events.map((e) =>
        e.type === 'escalated_to_down'
          ? { ...e, payload: { manual: true, raised: true, note: '502 again' } }
          : e,
      ),
    };
    expect(reportIncident(byHand, week.from, week.to, now, insideHours)!.cause).toBe('Manual (hand check)');
    // Down again by hand (a relapse with `manual`) shares the same branch.
    const downAgain = row({
      events: [
        ...voca.events.slice(0, 2),
        {
          type: 'relapsed',
          at: iso('2026-09-21T03:26:00'),
          payload: { startedAt: iso('2026-09-21T03:25:00'), severity: 'down', manual: true },
        },
      ],
    });
    expect(causeOf(downAgain, 'down')).toBe('Manual (hand check)');
    expect(causeOf(downAgain, 'down', bkk('2026-09-21T03:12:00'))).toBe('503 ×3');
  });

  it.each([
    [
      'what fixed it first',
      { root_cause_category: 'ssl', root_cause: 'Cert expired', root_cause_fix: 'cert renewed' },
      'cert renewed',
    ],
    [
      'else what happened, first sentence',
      { root_cause_category: 'hosting', root_cause: 'Provider reboot. Then more.' },
      'Provider reboot',
    ],
    ['none while unknown', { root_cause_category: 'unknown', root_cause: 'Still looking' }, null],
    ['none without a category', { root_cause: 'x' }, null],
    [
      'long text cut at a word',
      {
        root_cause_category: 'deploy',
        root_cause:
          'A deploy at 22:10 replaced the nginx config with one missing the upstream block for the API',
      },
      'A deploy at 22:10 replaced the nginx config with one…',
    ],
  ])('rootCauseOf: %s', (_n, over, expected) => {
    expect(rootCauseOf(row(over))).toBe(expected);
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
