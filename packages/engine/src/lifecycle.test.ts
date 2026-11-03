import { describe, expect, it } from 'vitest';
import { autoResolves, canResolve, clientUpdateDueAt, transition, type Episode } from './lifecycle';

const down = { severity: 'down', hasRootCause: false } as const;
const problem = { severity: 'problem', hasRootCause: false } as const;

describe('transition — lifecycle (spec §15.4)', () => {
  it('walks a DOWN incident from Unacked to Closed', () => {
    const steps = [
      ['unacked', 'escalate', 'escalated'],
      ['escalated', 'ack', 'acknowledged'],
      ['acknowledged', 'recover', 'monitoring'],
      ['monitoring', 'ok_two_rounds', 'needs_root_cause'],
      ['needs_root_cause', 'resolve', 'resolved'],
      ['resolved', 'submit_review', 'in_review'],
      ['in_review', 'sign_off', 'closed'],
    ] as const;
    for (const [from, event, to] of steps)
      expect(transition(from, event, down)).toEqual({ ok: true, state: to });
  });

  it('lets a site recover before anyone acknowledges (INC-0139 ORCA)', () => {
    expect(transition('unacked', 'recover', down)).toEqual({ ok: true, state: 'monitoring' });
  });

  it('stays in Monitoring after 2 OK rounds when the root cause is already written', () => {
    expect(transition('monitoring', 'ok_two_rounds', { ...down, hasRootCause: true })).toEqual({
      ok: true,
      state: 'monitoring',
    });
  });

  it('ends a PROBLEM at Resolved — no review', () => {
    expect(transition('resolved', 'submit_review', problem).ok).toBe(false);
  });

  it('rejects transitions the lifecycle does not have', () => {
    expect(transition('closed', 'ack', down).ok).toBe(false);
    expect(transition('acknowledged', 'escalate', down).ok).toBe(false);
  });
});

describe('canResolve — 3 conditions (spec §15.4, §16.2–3)', () => {
  it('passes when all three are met', () => {
    expect(canResolve({ okRounds: 2, clientUpdate: 'marked', rootCauseCategory: 'server' })).toEqual({
      ok: true,
      unmet: [],
    });
  });

  it('treats "Not required" and "Not needed" as met', () => {
    expect(canResolve({ okRounds: 2, clientUpdate: 'not_required', rootCauseCategory: 'dns' }).ok).toBe(true);
    expect(canResolve({ okRounds: 2, clientUpdate: 'not_needed', rootCauseCategory: 'dns' }).ok).toBe(true);
  });

  it('lists every unmet condition; "Unknown" keeps the incident open', () => {
    expect(canResolve({ okRounds: 1, clientUpdate: 'pending', rootCauseCategory: 'unknown' }).unmet).toEqual([
      'recovery',
      'client_update',
      'root_cause',
    ]);
  });
});

describe('clientUpdateDueAt — the client-update track (spec §9, §16.2, D-002, D-004)', () => {
  const bkk = (iso: string) => new Date(`${iso}+07:00`);
  // Spec §7: Tier 2 responds Mon–Fri 09:00–18:00 (D-034); Fri 25 Sep 2026 as a holiday where noted.
  const HOURS = {
    startMin: 9 * 60,
    endMin: 18 * 60,
    days: [1, 2, 3, 4, 5],
    holidays: new Set<string>(),
  };
  const FRIDAY_OFF = { ...HOURS, holidays: new Set(['2026-09-25']) };
  const down = (start: string, end: string | null): Episode => ({
    start: bkk(start),
    end: end ? bkk(end) : null,
    severity: 'down',
  });
  const problem = (start: string, end: string | null): Episode => ({
    ...down(start, end),
    severity: 'problem',
  });

  it.each([
    // INC-0142 MuvMi: first failed 09:48:12, still down → due and posted 10:03:12 (acked or not: the
    // ack isn't an input) — 15 min from the FIRST FAILED CHECK, not from confirmed down 09:48:41.
    ['INC-0142, still down', 1, [down('2026-09-25T09:48:12', null)], '2026-09-25T10:03:12'],
    ['down 14 min → Not required', 1, [down('2026-09-25T09:48:12', '2026-09-25T10:02:12')], null],
    [
      'down exactly 15:00 → required',
      1,
      [down('2026-09-25T09:48:12', '2026-09-25T10:03:12')],
      '2026-09-25T10:03:12',
    ],
    [
      'down 16 min → required',
      1,
      [down('2026-09-25T09:48:12', '2026-09-25T10:04:12')],
      '2026-09-25T10:03:12',
    ],
    // D-004: the track keeps counting from the first failed check; a relapse after the due time fires then.
    [
      'relapse after the due time',
      1,
      [down('2026-09-25T09:48:12', '2026-09-25T09:58:12'), down('2026-09-25T10:10:00', null)],
      '2026-09-25T10:10:00',
    ],
    [
      'two short drops both over before 15 min',
      1,
      [
        down('2026-09-25T09:48:12', '2026-09-25T09:55:00'),
        down('2026-09-25T09:58:00', '2026-09-25T10:01:00'),
      ],
      null,
    ],
    // D-021: a PROBLEM raised to DOWN counts from the DOWN's start, not the PROBLEM's.
    [
      'PROBLEM raised to DOWN',
      1,
      [problem('2026-09-25T09:30:00', '2026-09-25T09:48:12'), down('2026-09-25T09:48:12', null)],
      '2026-09-25T10:03:12',
    ],
    ['a PROBLEM never', 1, [problem('2026-09-25T09:00:00', null)], null],
    ['no drop yet', 1, [], null],
    // Tier 2: 60 min counted inside response hours from the first failed check.
    ['Tier 2 inside hours', 2, [down('2026-09-25T10:00:00', null)], '2026-09-25T11:00:00'],
    [
      'Tier 2 59 min inside hours → Not required',
      2,
      [down('2026-09-25T10:00:00', '2026-09-25T10:59:00')],
      null,
    ],
    // INC-0139 ORCA: Thu 22:14, down overnight → the hours open Fri 09:00, due 10:00.
    ['Tier 2 at night (INC-0139)', 2, [down('2026-09-24T22:14:00', null)], '2026-09-25T10:00:00'],
    // INC-0133 VOCA: down 41 min at night, back before 09:00 → never inside hours.
    ['Tier 2 down at night only (INC-0133)', 2, [down('2026-09-29T03:12:00', '2026-09-29T03:53:00')], null],
    ['Tier 2 across 18:00 and the weekend', 2, [down('2026-09-25T17:30:00', null)], '2026-09-28T09:30:00'],
    ['Tier 3: report only', 3, [down('2026-09-25T09:48:12', null)], null],
  ] as const)('%s', (_name, tier, episodes, expected) => {
    expect(clientUpdateDueAt({ tier, episodes: [...episodes], hours: HOURS })).toEqual(
      expected ? bkk(expected) : null,
    );
  });

  it('skips a company holiday on Tier 2 (Fri 25 Sep off → Mon 28 Sep 10:00)', () => {
    expect(
      clientUpdateDueAt({
        tier: 2,
        episodes: [down('2026-09-25T09:00:00', null)],
        hours: FRIDAY_OFF,
      }),
    ).toEqual(bkk('2026-09-28T10:00:00'));
  });

  it('Tier 1 counts 24/7, whatever the response hours', () => {
    expect(
      clientUpdateDueAt({
        tier: 1,
        episodes: [down('2026-09-26T02:00:00', null)],
        hours: HOURS,
      }),
    ).toEqual(bkk('2026-09-26T02:15:00'));
  });

  it('16 min down and not marked yet: Resolve waits for it (Done-when 2)', () => {
    expect(
      canResolve({
        okRounds: 2,
        clientUpdate: 'pending',
        rootCauseCategory: 'hosting',
      }).unmet,
    ).toEqual(['client_update']);
    expect(
      canResolve({
        okRounds: 2,
        clientUpdate: 'not_needed',
        rootCauseCategory: 'hosting',
      }).ok,
    ).toBe(true);
  });
});

describe('autoResolves (spec §16.1)', () => {
  const base = { severity: 'problem', recovered: true, minutesToRecover: 3, acknowledged: false } as const;
  it.each([
    ['short, recovered, never acknowledged PROBLEM', base, true],
    ['acknowledged', { ...base, acknowledged: true }, false],
    ['recovered at exactly 5 min', { ...base, minutesToRecover: 5 }, false],
    ['still failing at minute 3', { ...base, recovered: false }, false],
    ['DOWN never auto-resolves', { ...base, severity: 'down' }, false],
  ] as const)('%s → %s', (_name, input, expected) => {
    expect(autoResolves(input)).toBe(expected);
  });
});

describe('canResolve — root cause wording', () => {
  it('treats "Unknown" in any case as unwritten', () => {
    expect(canResolve({ okRounds: 2, clientUpdate: 'marked', rootCauseCategory: ' Unknown ' }).unmet).toEqual(
      ['root_cause'],
    );
  });
});
