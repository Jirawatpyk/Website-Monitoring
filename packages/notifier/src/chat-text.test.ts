import { describe, expect, it } from 'vitest';
import { buildChatTextLine } from './chat-text';

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
