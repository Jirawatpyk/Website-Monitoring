import { describe, expect, it } from 'vitest';
import type { ProblemDetail } from '@dxt/shared';
import { formatProblemCause, formatProblemSummary, type ProblemCauseContext } from './problem-cause';

// S13 (D-066), ChatAlert board "PROBLEM cause wording", row SSL expiring: INC-0136 DxT AI ·
// "SSL certificate expires in 13 days (Tue 6 Oct)". The board's "· not renewed yet" is left out:
// it is true for as long as the PROBLEM is open.
const home: ProblemCauseContext = {
  monitorUrl: 'https://www.dxt-ai.example/',
  isPrimary: true,
  tier: 3,
  timeoutMs: 30_000,
};

describe('SSL / domain expiry cause and summary', () => {
  it.each<[string, ProblemDetail, string, string]>([
    [
      'INC-0136 DxT AI: 13 days, Tue 6 Oct',
      { kind: 'ssl', expiresAt: '2026-10-06T13:00:00Z', daysLeft: 13 },
      'SSL certificate expires in 13 days (Tue 6 Oct)',
      'SSL certificate expires in 13 days',
    ],
    [
      'a domain 20 days out',
      { kind: 'domain', expiresAt: '2026-12-07T04:00:00Z', daysLeft: 20 },
      'Domain expires in 20 days (Mon 7 Dec)',
      'domain expires in 20 days',
    ],
    [
      'one day',
      { kind: 'ssl', expiresAt: '2026-10-06T13:00:00Z', daysLeft: 1 },
      'SSL certificate expires in 1 day (Tue 6 Oct)',
      'SSL certificate expires in 1 day',
    ],
    [
      'today',
      { kind: 'domain', expiresAt: '2026-10-06T13:00:00Z', daysLeft: 0 },
      'Domain expires today (Tue 6 Oct)',
      'domain expires today',
    ],
    [
      'already past (a domain; an expired certificate is a hard fail)',
      { kind: 'domain', expiresAt: '2026-10-06T13:00:00Z', daysLeft: -2 },
      'Domain expired 2 days ago (Tue 6 Oct)',
      'domain expired 2 days ago',
    ],
  ])('%s', (_name, detail, cause, summary) => {
    expect(formatProblemCause(detail, home)).toBe(cause);
    expect(formatProblemSummary(detail, home)).toBe(summary);
  });
});
