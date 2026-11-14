import { describe, expect, it } from 'vitest';
import {
  devicesOf,
  devicesWord,
  oncallWarning,
  securityRows,
  signinEvents,
  signOutCopy,
  type SecurityData,
} from './security-model';

// Fri 25 Sep 2026 10:08 Bangkok.
const NOW = new Date('2026-09-25T03:08:00Z');
const TAO = '00000000-0000-4000-8000-000000000001';
const NOK = '00000000-0000-4000-8000-000000000004';
const PLOY = '00000000-0000-4000-8000-000000000005';
const MINT = '00000000-0000-4000-8000-000000000006';
const MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1';

const person = (id: string, name: string, role: 'admin' | 'responder' | 'viewer') => ({
  id,
  name,
  email: `${name.toLowerCase()}@x`,
  role,
  chatLinked: true,
  lastActive: null,
});

const data: SecurityData = {
  viewerId: TAO,
  domains: ['dxt.test'],
  people: [
    person(NOK, 'Nok', 'responder'),
    person(TAO, 'Tao', 'admin'),
    person(PLOY, 'Ploy', 'responder'),
    person(MINT, 'Mint', 'viewer'),
  ],
  invites: [{ email: 'new@dxt.test', role: 'admin', addedAt: '2026-09-24T02:12:00Z' }],
  shifts: [
    // Ploy on call now until Mon 28 Sep 09:00; Nok from then.
    { id: 's1', userId: PLOY, startsAt: '2026-09-21T02:00:00Z', endsAt: '2026-09-28T02:00:00Z' },
    { id: 's2', userId: NOK, startsAt: '2026-09-28T02:00:00Z', endsAt: '2026-10-05T02:00:00Z' },
  ],
  sessions: [
    {
      id: 'a',
      userId: TAO,
      userAgent: MAC,
      createdAt: '2026-09-25T00:52:00Z',
      lastUsed: '2026-09-25T03:05:00Z',
      current: true,
    },
    {
      id: 'b',
      userId: TAO,
      userAgent: IPHONE,
      createdAt: '2026-09-20T00:00:00Z',
      lastUsed: '2026-09-24T09:40:00Z',
      current: false,
    },
    {
      id: 'c',
      userId: PLOY,
      userAgent: 'node',
      createdAt: '2026-09-21T01:00:00Z',
      lastUsed: '2026-09-25T02:00:00Z',
      current: false,
    },
  ],
  names: { [TAO]: 'Tao', [NOK]: 'Nok', [PLOY]: 'Ploy', [MINT]: 'Mint' },
  entries: [
    {
      at: '2026-09-25T03:08:00Z',
      action: 'session.sign_out_all',
      actorId: TAO,
      entityId: NOK,
      before: null,
      after: { devices: 2 },
    },
    {
      at: '2026-09-24T09:40:00Z',
      action: 'signin.refused',
      actorId: null,
      entityId: null,
      before: null,
      after: { reason: 'domain', domain: 'gmail.com' },
    },
    {
      at: '2026-09-24T02:12:00Z',
      action: 'user.invite',
      actorId: TAO,
      entityId: null,
      before: null,
      after: { email: 'new@dxt.test', role: 'admin' },
    },
    {
      at: '2026-09-23T11:30:00Z',
      action: 'user.invite_revoke',
      actorId: TAO,
      entityId: null,
      before: { email: 'old@dxt.test', role: 'viewer' },
      after: { reason: 'typo' },
    },
    {
      at: '2026-09-22T01:00:00Z',
      action: 'session.sign_out_device',
      actorId: PLOY,
      entityId: PLOY,
      before: null,
      after: { devices: 1 },
    },
    {
      at: '2026-09-21T01:00:00Z',
      action: 'user.deactivate',
      actorId: TAO,
      entityId: 'gone',
      before: null,
      after: null,
    },
  ],
};

describe('securityRows (Security board, MSecurity §35.6)', () => {
  const rows = securityRows(data, NOW);
  const row = (name: string) => rows.find((r) => r.name === name)!;

  it('orders Admins first, then by name; pending addresses last', () => {
    expect(rows.map((r) => r.name)).toEqual(['Tao', 'Nok', 'Ploy', 'Mint', 'new@dxt.test']);
  });

  it('your own row offers Sign out other devices only with more than one device', () => {
    expect(row('Tao')).toMatchObject({ devices: 2, action: 'others', last: 'Today 07:52' });
    expect(securityRows({ ...data, sessions: data.sessions.slice(0, 1) }, NOW)[0]!.action).toBeNull();
  });

  it('anyone else: Sign out all while they have devices', () => {
    expect(row('Ploy')).toMatchObject({
      devices: 1,
      action: 'all',
      oncall: { text: 'On call now', live: true },
    });
    expect(row('Mint')).toMatchObject({ devices: 0, action: null, last: 'No devices', oncall: null });
  });

  it('signed out everywhere reads from the audit row, so it survives a reload', () => {
    expect(row('Nok')).toMatchObject({
      devices: 0,
      action: null,
      last: 'Signed out · 10:08',
      oncall: { text: 'On call from 28 Sep', live: false },
    });
  });

  it('an older sign-out keeps its day (code review)', () => {
    const old = { ...data, entries: [{ ...data.entries[0]!, at: '2026-09-21T03:08:00Z' }] };
    expect(securityRows(old, NOW).find((r) => r.name === 'Nok')!.last).toBe('Signed out · Mon 21 Sep 10:08');
  });

  it('a pending address has no devices and has not signed in', () => {
    expect(row('new@dxt.test')).toMatchObject({ personId: null, last: 'Not signed in yet', action: null });
  });
});

describe('devicesOf', () => {
  it('names each device from its browser, last used first, with its tag', () => {
    expect(devicesOf(data, TAO, NOW)).toEqual([
      { id: 'a', name: 'Chrome · macOS', tag: 'This device', when: 'Last used today 10:05', current: true },
      { id: 'b', name: 'Safari · iPhone', tag: 'Phone', when: 'Last used yesterday 16:40', current: false },
    ]);
  });
  it('a session from before the forwarding is an unknown device, told apart by its sign-in day', () => {
    expect(devicesOf(data, PLOY, NOW)[0]).toMatchObject({
      name: 'Unknown device',
      tag: null,
      when: 'Last used today 09:00 · signed in Mon 21 Sep',
    });
  });
  it('words the count', () => {
    expect([0, 1, 3].map(devicesWord)).toEqual(['No devices', '1 device', '3 devices']);
  });
});

describe('signOutCopy (Security board dialog)', () => {
  it('your other devices keep this browser', () => {
    expect(signOutCopy('Tao', true, devicesOf(data, TAO, NOW))).toEqual({
      title: 'Sign out your other devices?',
      description:
        'This browser (Chrome · macOS) stays signed in. The device below goes back to the Google sign-in.',
      cta: 'Sign out 1 other device',
    });
  });
  it('someone else everywhere', () => {
    const two = [...devicesOf(data, TAO, NOW)];
    expect(signOutCopy('Ploy', false, two)).toEqual({
      title: 'Sign out Ploy everywhere?',
      description:
        'Ploy goes back to the Google sign-in on these 2 devices. Their role and alerts don’t change.',
      cta: 'Sign out 2 devices',
    });
    expect(signOutCopy('Ploy', false, two.slice(1)).description).toContain('on this device.');
  });
});

describe('oncallWarning', () => {
  it('on call now: until the shift ends', () => {
    expect(oncallWarning(data, PLOY, 'Ploy', NOW)?.title).toBe('Ploy is on call until Mon 28 Sep 09:00');
  });
  it('on call within a week: from when', () => {
    expect(oncallWarning(data, NOK, 'Nok', NOW)).toEqual({
      title: 'Nok is on call from Mon 28 Sep 09:00',
      body: 'Their Ack link will need a fresh sign-in. Make sure Nok signs in again before the shift starts.',
    });
  });
  it('nothing for someone not on call soon', () => {
    expect(oncallWarning(data, MINT, 'Mint', NOW)).toBeNull();
    expect(oncallWarning(data, NOK, 'Nok', new Date('2026-09-15T00:00:00Z'))).toBeNull();
  });
});

describe('signinEvents (§35.7: newest 5)', () => {
  it('words each row as a sentence; a refused address on another domain is its domain only (D-062 item 7)', () => {
    expect(signinEvents(data, NOW).map((e) => [e.time, e.icon, e.text])).toEqual([
      ['10:08', 'log-out', 'Tao signed Nok out everywhere'],
      ['Yesterday 16:40', 'ban', 'Refused sign-in · an address @gmail.com'],
      ['Yesterday 09:12', 'user', 'Tao added new@dxt.test as an Admin'],
      ['Wed 23 Sep 18:30', 'user', 'Tao removed old@dxt.test from the access list'],
      ['Tue 22 Sep 08:00', 'log-out', 'Ploy signed out one of their devices'],
    ]);
  });
  it('someone no longer listed reads "someone"', () => {
    expect(signinEvents(data, NOW, 6)[5]!.text).toBe('Tao deactivated someone');
  });
});
