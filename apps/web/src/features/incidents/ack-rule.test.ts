import { describe, expect, it } from 'vitest';
import { mayAcknowledge } from './ack-rule';

// The page mirror of private.can_ack (D-016; S10 on-call, D-048).
const site = { primaryOwnerId: 'arm', backupOwnerId: 'ploy', tier: 1, l0UserId: null };

describe('mayAcknowledge', () => {
  it.each([
    ['an Admin, any site', { id: 'tao', role: 'admin' as const }, site, true],
    ['the owner', { id: 'arm', role: 'responder' as const }, site, true],
    ['the backup', { id: 'ploy', role: 'responder' as const }, site, true],
    ['a Responder who neither owns nor is on call', { id: 'nok', role: 'responder' as const }, site, false],
    ['the Responder on call, Tier 1', { id: 'nok', role: 'responder' as const, onCallNow: true }, site, true],
    [
      'the Responder on call, Tier 2',
      { id: 'nok', role: 'responder' as const, onCallNow: true },
      { ...site, tier: 2 },
      false,
    ],
    [
      'the person L0 paged after the shift changed',
      { id: 'nok', role: 'responder' as const },
      { ...site, l0UserId: 'nok' },
      true,
    ],
    ['a Viewer on call', { id: 'mint', role: 'viewer' as const, onCallNow: true }, site, false],
    // the caller passes l0UserId only while the incident is open (private.oncall_acts_on)
    [
      'a closed incident: its former L0 person',
      { id: 'nok', role: 'responder' as const },
      { ...site, l0UserId: null },
      false,
    ],
  ])('%s → %s', (_label, viewer, s, expected) => {
    expect(mayAcknowledge(viewer, s)).toBe(expected);
  });
});
