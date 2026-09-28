import { describe, expect, it } from 'vitest';
import { autoResolves, canResolve, clientUpdateRequired, transition } from './lifecycle';

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

describe('clientUpdateRequired (spec §9, §16.2, D-002)', () => {
  it.each([
    // INC-0142: first failed 09:48:12 → due at 10:03:12, exactly 15 min (not 15 min after confirmed down)
    [{ tier: 1, severity: 'down', downMinutes: 15, downMinutesInsideHours: 15 }, true],
    [{ tier: 1, severity: 'down', downMinutes: 14, downMinutesInsideHours: 14 }, false],
    [{ tier: 2, severity: 'down', downMinutes: 60, downMinutesInsideHours: 59 }, false],
    [{ tier: 1, severity: 'down', downMinutes: 43, downMinutesInsideHours: 43 }, true], // INC-0142 MuvMi
    [{ tier: 1, severity: 'down', downMinutes: 11, downMinutesInsideHours: 0 }, false], // INC-0118 BA – Taiwan
    [{ tier: 2, severity: 'down', downMinutes: 41, downMinutesInsideHours: 0 }, false], // INC-0133 VOCA, at night
    [{ tier: 2, severity: 'down', downMinutes: 70, downMinutesInsideHours: 60 }, true],
    [{ tier: 3, severity: 'down', downMinutes: 300, downMinutesInsideHours: 300 }, false],
    [{ tier: 1, severity: 'problem', downMinutes: 60, downMinutesInsideHours: 60 }, false],
  ] as const)('%o → %s', (input, expected) => {
    expect(clientUpdateRequired(input)).toBe(expected);
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
