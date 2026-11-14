import { describe, expect, it } from 'vitest';
import {
  blockedBy,
  ceos,
  changeBlockedWhy,
  gainsLoses,
  missingPicks,
  oncallOf,
  reassignPayload,
  roleRows,
  usageOf,
  usageSummary,
  type UsersData,
} from './model';

// Fri 25 Sep 2026 10:08 Bangkok (the boards' "now").
const NOW = new Date('2026-09-25T03:08:00Z');
const day = (d: number) => new Date(NOW.getTime() + d * 86_400_000).toISOString();

/** The Users board's people, cut down: Nok owns realme.link, backs up Fuji Links, is on call next. */
function data(over: Partial<UsersData> = {}): UsersData {
  return {
    viewerId: 'tao',
    people: [
      { id: 'tao', name: 'Tao', email: 'tao@x', role: 'admin', chatLinked: true, lastActive: null },
      { id: 'arm', name: 'Arm', email: 'arm@x', role: 'responder', chatLinked: true, lastActive: null },
      { id: 'ploy', name: 'Ploy', email: 'ploy@x', role: 'responder', chatLinked: true, lastActive: null },
      { id: 'nok', name: 'Nok', email: 'nok@x', role: 'responder', chatLinked: true, lastActive: null },
      { id: 'thee', name: 'Thee', email: 'thee@x', role: 'stakeholder', chatLinked: true, lastActive: null },
      { id: 'ceo', name: 'CEO', email: 'ceo@x', role: 'stakeholder', chatLinked: true, lastActive: null },
      { id: 'mint', name: 'Mint', email: 'mint@x', role: 'viewer', chatLinked: false, lastActive: null },
    ],
    invites: [],
    sites: [
      { id: 's1', name: 'realme.link', live: true, ownerId: 'nok', backupId: 'arm' },
      { id: 's2', name: 'Fuji Links', live: true, ownerId: 'ploy', backupId: 'nok' },
    ],
    clients: [{ id: 'c1', name: 'realme', amId: 'thee' }],
    rotation: ['ploy', 'nok'],
    shifts: [
      { id: 'w1', userId: 'ploy', startsAt: day(-4), endsAt: day(3) },
      { id: 'w2', userId: 'nok', startsAt: day(3), endsAt: day(10) },
    ],
    swaps: [{ id: 'x1', requesterId: 'ploy', counterpartId: 'nok' }],
    acks: [],
    ...over,
  };
}

describe('the role matrix (Users / MUsers)', () => {
  it('one role at a time, with its foot', () => {
    const r = roleRows('responder');
    expect(r.rows).toHaveLength(10);
    expect(r.rows[2]).toEqual({
      label: 'Acknowledge and resolve incidents',
      cell: 'Own sites (owner or backup) + Tier 1 when on call',
    });
    expect(r.foot).toBe('Responder: 6 of 10 allowed. “Own” = only where they are owner, backup or Site AM.');
    expect(roleRows('client').foot).toMatch(/^Client · Phase 3: 2 of 10/);
  });

  it.each([
    [
      'responder',
      'stakeholder',
      ['Send client reports / edit AM note (own clients)'],
      ['Acknowledge and resolve incidents', 'Maintenance windows and mute'],
    ],
    [
      'responder',
      'admin',
      [
        'Acknowledge and resolve incidents (all sites)',
        'Mark client update / Not needed (all sites)',
        'Maintenance windows and mute (all sites)',
        'Send client reports / edit AM note',
        'Approve incident review',
        'Edit sites, monitors and escalation',
        'Manage users and roles',
      ],
      [],
    ],
    [
      'stakeholder',
      'viewer',
      [],
      [
        'Receive alerts and digests',
        'Mark client update / Not needed',
        'Download uptime reports',
        'Send client reports / edit AM note',
      ],
    ],
  ] as const)('%s → %s', (from, to, gains, loses) => {
    expect(gainsLoses(from, to)).toEqual({ gains, loses });
  });

  it('nothing changes for the same role', () => {
    expect(gainsLoses('viewer', 'viewer')).toEqual({ gains: [], loses: [] });
  });
});

describe('usageOf — Used in (§14.9, Done-when 2)', () => {
  it('Nok Responder → Stakeholder: owner, backup and shifts need someone; the rotation and the swap close', () => {
    const items = usageOf(data(), 'nok', 'stakeholder', NOW);
    expect(items.map((i) => [i.key, i.need, !!i.info])).toEqual([
      ['owner', true, false],
      ['backup', true, false],
      ['shifts', true, false],
      ['rotation', false, true],
      ['swaps', false, true],
      ['ceo', false, true],
    ]);
    const owner = items[0]!;
    expect(owner.label).toBe('Owner of 1 site');
    expect(owner.detail).toBe('realme.link · A Stakeholder can’t do this — reassign first');
    // Owner ≠ backup: Arm backs up realme.link, so Arm isn't offered as its owner.
    expect(owner.sites![0]!.hint).toBe('Backup here: Arm');
    expect(owner.sites![0]!.options.map((o) => o.value)).toEqual(['tao', 'ploy']);
    expect(items[1]!.sites![0]!.options.map((o) => o.value)).toEqual(['tao', 'arm']);
    expect(items[5]!.detail).toMatch(/gets the CEO step on Tier 1 DOWN/);
    expect(usageSummary(items)).toBe('3 of 3 need a new person');
  });

  it('Nok → Admin: everything stays', () => {
    const items = usageOf(data(), 'nok', 'admin', NOW);
    expect(items.every((i) => !i.need)).toBe(true);
    expect(items[0]!.detail).toBe('realme.link · Stays with Nok — an Admin can still do this');
    expect(usageSummary(items)).toBe('Nothing needs reassigning');
  });

  it('the AM: fine as a Responder, picked for every client on deactivate', () => {
    expect(usageOf(data(), 'thee', 'responder', NOW)[0]).toMatchObject({ key: 'am', need: false });
    const am = usageOf(data(), 'thee', 'deactivated', NOW)[0]!;
    expect(am).toMatchObject({ key: 'am', need: true, detail: 'realme · Reassign before deactivating' });
    // An AM can be an Admin, Responder or Stakeholder (D-062), never the person or a Viewer.
    expect(am.pick!.options.map((o) => o.value)).toEqual(['tao', 'arm', 'ploy', 'nok', 'ceo']);
  });

  it('the last CEO: warns, never blocks (D-062 item 4)', () => {
    expect(ceos(data()).map((p) => p.id)).toEqual(['ceo']);
    const items = usageOf(data(), 'ceo', 'viewer', NOW);
    expect(items).toEqual([expect.objectContaining({ key: 'ceo', warn: true, need: false })]);
    expect(missingPicks(items, {})).toEqual([]);
  });

  it('the rotation’s last person blocks', () => {
    const d = data({ rotation: ['nok'], swaps: [] });
    const items = usageOf(d, 'nok', 'viewer', NOW);
    expect(blockedBy(items).map((i) => i.key)).toEqual(['rotation']);
  });

  it('an owner without a Chat id can’t be picked (D-015)', () => {
    const d = data();
    d.people.find((p) => p.id === 'ploy')!.chatLinked = false;
    const owner = usageOf(d, 'nok', 'viewer', NOW)[0]!;
    expect(owner.sites![0]!.options.map((o) => o.value)).toEqual(['tao']);
  });
});

describe('picks', () => {
  it('missing picks, then the payload the SQL takes', () => {
    const items = usageOf(data(), 'nok', 'stakeholder', NOW);
    expect(missingPicks(items, {})).toEqual(['owner:s1', 'backup:s2', 'shifts']);
    const picks = { 'owner:s1': 'ploy', 'backup:s2': 'arm', shifts: 'arm' };
    expect(missingPicks(items, picks)).toEqual([]);
    expect(reassignPayload(picks)).toEqual({ owners: { s1: 'ploy' }, backups: { s2: 'arm' }, shifts: 'arm' });
    expect(reassignPayload({ am: 'ceo', 'owner:s1': '' })).toEqual({ am: 'ceo' });
  });
});

describe('the table', () => {
  it('on-call: now, next, backstop', () => {
    const d = data();
    expect(oncallOf(d, d.people[2]!, NOW)).toEqual({ text: 'On call now', live: true });
    expect(oncallOf(d, d.people[3]!, NOW)).toEqual({ text: 'Next on call 28 Sep', live: false });
    expect(oncallOf(d, d.people[0]!, NOW)).toEqual({ text: 'Admin backstop', live: false });
    expect(oncallOf(d, d.people[6]!, NOW)).toEqual({ text: '—', live: false });
  });

  it('Change role is off for yourself and the only Admin', () => {
    const d = data();
    expect(changeBlockedWhy(d, d.people[0]!)).toBe('You can’t change your own access — ask another Admin.');
    expect(changeBlockedWhy({ ...d, viewerId: 'arm' }, d.people[0]!)).toBe(
      'They’re the only active Admin — invite another Admin first.',
    );
    expect(changeBlockedWhy(d, d.people[3]!)).toBeNull();
  });
});
