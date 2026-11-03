import { describe, expect, it } from 'vitest';
import { buildChatTextLine, buildMonitorFaultLine } from './chat-text';

describe('buildMonitorFaultLine (S12a, ChatAlert "Monitor fault")', () => {
  it('@mentions the on-call person and says since when, in Bangkok time', () => {
    expect(buildMonitorFaultLine({ since: new Date('2026-09-24T19:17:00Z'), onCallChatId: '1234' })).toBe(
      '<users/1234> MONITOR FAULT · all sites · heartbeat missed since 02:17 · status unknown, hand-check Tier 1',
    );
  });

  it('no Chat id: the line without a mention', () => {
    expect(buildMonitorFaultLine({ since: new Date('2026-09-24T19:17:00Z'), onCallChatId: null })).toBe(
      'MONITOR FAULT · all sites · heartbeat missed since 02:17 · status unknown, hand-check Tier 1',
    );
  });
});

describe('buildChatTextLine (spec §10, §14.10)', () => {
  it('puts the mention first and STATE · site next', () => {
    expect(
      buildChatTextLine({
        state: 'ESCALATED · L1',
        site: 'MuvMi DOWN 15 min, not acknowledged',
        mention: ['PLOY'],
        detail: ['please acknowledge', 'Tao FYI', 'CEO at 10:18'],
      }),
    ).toBe(
      '<users/PLOY> ESCALATED · L1 · MuvMi DOWN 15 min, not acknowledged · please acknowledge · Tao FYI · CEO at 10:18',
    );
  });

  it('has no mention on RESOLVED', () => {
    expect(buildChatTextLine({ state: 'RESOLVED', site: 'MuvMi', detail: ['by Arm 10:40'] })).toBe(
      'RESOLVED · MuvMi · by Arm 10:40',
    );
  });
});
