import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeDb, type FakeCall } from '../../../test/fake-db';
import { loadOncallCard, loadOncallData } from './queries';

const NOW = new Date('2026-09-25T03:07:00Z');
const mon = (day: number) => new Date(Date.UTC(2026, 8, day, 2, 0)).toISOString();
const SHIFTS = [
  { id: 's21', user_id: 'ploy', starts_at: mon(21), ends_at: mon(28), handed_over_from: null },
  { id: 's28', user_id: 'nok', starts_at: mon(28), ends_at: mon(35), handed_over_from: null },
  { id: 's35', user_id: 'arm', starts_at: mon(35), ends_at: mon(42), handed_over_from: 'nok' },
];
const swapRow = (id: string, status: string, requester = 'arm', counterpart = 'nok') => ({
  id,
  status,
  requester_id: requester,
  counterpart_id: counterpart,
  requester_shift_id: 's35',
  counterpart_shift_id: 's28',
  created_at: '2026-09-22T03:12:00Z',
  responded_at: null,
  decided_at: null,
  decided_by: null,
  updated_at: '2026-09-22T03:12:00Z',
  rq: { starts_at: mon(35), ends_at: mon(42) },
  cp: { starts_at: mon(28), ends_at: mon(35) },
});
const PEOPLE = [
  { id: 'tao', display_name: 'Tao', role: 'admin', is_active: true },
  { id: 'arm', display_name: 'Arm', role: 'responder', is_active: true },
  { id: 'nok', display_name: 'Nok', role: 'responder', is_active: true },
  { id: 'ploy', display_name: 'Ploy', role: 'responder', is_active: true },
  { id: 'mint', display_name: 'Mint', role: 'viewer', is_active: true },
  { id: 'gone', display_name: 'Gone', role: 'responder', is_active: false },
];

function results(swaps: ReturnType<typeof swapRow>[], named?: ReturnType<typeof swapRow>) {
  return {
    'oncall_shifts.select': { data: SHIFTS },
    'oncall_rotation.select': { data: [{ user_id: 'arm' }, { user_id: 'ploy' }, { user_id: 'nok' }] },
    'profiles.select': { data: PEOPLE },
    'oncall_checklist.select': {
      data: [
        {
          user_id: 'ploy',
          mentions_only: true,
          dnd_allowed: false,
          test_sent_at: null,
          test_received_at: null,
        },
      ],
    },
    'sites.select': {
      data: [
        { name: 'MuvMi', primary_owner_id: 'arm' },
        { name: 'ENEOS', primary_owner_id: 'ploy' },
        { name: 'BA – Taiwan', primary_owner_id: 'arm' },
      ],
    },
    'incidents.select': {
      data: [{ number: 131, detected_at: mon(22), l0_user_id: 'ploy', sites: { name: 'MuvMi', tier: 1 } }],
    },
    'oncall_swaps.select': (call: FakeCall) =>
      call.filters.some(([f]) => f === 'eq') ? { data: named ?? null } : { data: swaps },
    'rpc.oncall_notes': {
      data: [{ reason: 'Family trip', response_note: null, decision_note: null, handover_reason: 'ill' }],
    },
  };
}
const viewer = (id: string, role: 'admin' | 'responder' | 'readonly') => ({ id, name: id, role });

afterEach(() => vi.restoreAllMocks());

describe('loadOncallData (/oncall)', () => {
  it('reads shifts, the rotation, people, checklists, owners and the paged incidents as listed columns', async () => {
    const { db, calls } = fakeDb(results([]));
    const d = await loadOncallData(db, viewer('tao', 'admin'), NOW, null);
    expect(d.rotation).toEqual(['arm', 'ploy', 'nok']);
    expect(d.admins).toEqual(['tao']);
    expect(d.eligible).toEqual(['arm', 'nok', 'ploy', 'tao']);
    expect(d.names.gone).toBe('Gone');
    expect(d.shifts[2]).toEqual({
      id: 's35',
      userId: 'arm',
      startsAt: mon(35),
      endsAt: mon(42),
      handedOverFrom: 'nok',
    });
    expect(d.owners).toEqual([
      { id: 'arm', sites: ['MuvMi', 'BA – Taiwan'] },
      { id: 'ploy', sites: ['ENEOS'] },
    ]);
    expect(d.tier1Sites).toBe(3);
    expect(d.paged).toEqual([{ number: 131, site: 'MuvMi', detectedAt: mon(22), userId: 'ploy' }]);
    expect(d.checklists.ploy).toEqual({
      mentionsOnly: true,
      dndAllowed: false,
      testSentAt: null,
      testReceivedAt: null,
    });
    // A handed-over shift's reason, through oncall_notes only (D-048 item 10).
    expect(d.handoverReasons).toEqual({ s35: 'ill' });
    // `select('*')` is refused by the column grants: every select lists its columns.
    expect(calls.every((c) => c.op === 'select')).toBe(true);
    expect(d.hours.holidays).toEqual([]);
  });

  it.each([
    ['the named swap', 'nok', 'responder', 'named', 'w-named'],
    ['the viewer’s own open swap', 'arm', 'responder', null, 'w-open'],
    ['the accepted one for an Admin', 'tao', 'admin', null, 'w-accepted'],
    ['none for anyone else', 'mint', 'readonly', null, null],
  ] as const)('opens on %s', async (_label, who, role, named, expected) => {
    // Newest first, as read: an Admin opens on the oldest accepted one, whoever asked.
    const swaps = [swapRow('w-open', 'waiting'), swapRow('w-accepted', 'accepted', 'ploy', 'nok')];
    const { db } = fakeDb(results(swaps, named ? swapRow('w-named', 'declined') : undefined));
    const d = await loadOncallData(db, viewer(who, role), NOW, named ? 'w-named' : null);
    expect(d.focus?.swap.id ?? null).toBe(expected);
    if (expected)
      expect(d.focus!.notes).toEqual({ reason: 'Family trip', responseNote: null, decisionNote: null });
  });

  it('fails loudly when a read fails', async () => {
    const { db } = fakeDb({ ...results([]), 'oncall_rotation.select': { error: { message: 'boom' } } });
    await expect(loadOncallData(db, viewer('tao', 'admin'), NOW, null)).rejects.toThrow('oncall: boom');
  });
});

describe('loadOncallCard (Overview)', () => {
  it('builds the card from the next shifts', async () => {
    const { db } = fakeDb({
      'oncall_shifts.select': { data: SHIFTS.map((s) => ({ ...s, person: { display_name: s.user_id } })) },
    });
    const card = await loadOncallCard(db, NOW);
    expect(card!.lines.map((l) => l.text)).toEqual([
      'Site owners respond',
      'ploy · Tier 1 on call',
      'nok · next week',
    ]);
  });

  it('leaves the card out when the shifts can’t be read', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { db } = fakeDb({ 'oncall_shifts.select': { error: { message: 'down' } } });
    expect(await loadOncallCard(db, NOW)).toBeNull();
    expect(log).toHaveBeenCalledWith(expect.stringContaining('oncall_card_unreadable'));
  });
});
