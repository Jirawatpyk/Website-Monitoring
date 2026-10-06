// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeDb } from '../../../test/fake-db';

const m = vi.hoisted(() => ({ db: null as unknown, access: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => m.db }));
vi.mock('@/lib/auth/session', () => ({ getAccess: m.access }));

const { getIncidentForAck } = await import('./queries');
const ID = '7c481a3b-6979-4c48-97eb-50a8d27c4e41';
const incident = {
  id: ID,
  number: 7,
  state: 'unacked',
  started_at: '2026-10-06T02:47:30Z',
  detected_at: '2026-10-06T02:48:41Z',
  acked_at: null,
  acked_by: null,
  recovered_at: null,
  sites: {
    name: 'Test target',
    tier: 1,
    primary_owner_id: 'u-arm',
    backup_owner_id: null,
    monitors: [{ url: 'https://t.example.test', is_primary: true }],
  },
};
const events = [
  { type: 'detected', at: '2026-10-06T02:48:41Z', actor_id: null, payload: { cause: 'HTTP 500 (SIN, TYO)' } },
  {
    type: 'alerted',
    at: '2026-10-06T02:48:45Z',
    actor_id: null,
    payload: { channel: 'email', template: 'down', user_id: 'u-arm' },
  },
];

beforeEach(() => {
  m.access.mockResolvedValue({
    status: 'active',
    profile: { id: 'u-arm', email: 'arm@example.test', displayName: 'Arm', role: 'responder' },
  });
});

describe('getIncidentForAck', () => {
  it('reads the incident, its timeline and the names it needs, as the signed-in person', async () => {
    const { db, calls } = fakeDb({
      'incidents.select': { data: incident },
      'incident_events.select': { data: events },
      'profiles.select': { data: [{ id: 'u-arm', display_name: 'Arm' }] },
    });
    m.db = db;
    const view = await getIncidentForAck(ID, new Date('2026-10-06T03:00:00Z'));
    expect(view).toMatchObject({ id: 'INC-0007', cause: 'HTTP 500 (SIN, TYO)', ack: { kind: 'can-ack' } });
    expect(view?.log[0]).toEqual({ at: '09:48', text: 'DOWN emailed to Arm' });
    expect(calls.find((c) => c.table === 'profiles')?.filters).toContainEqual(['in', 'id', ['u-arm']]);
  });

  it('is null for a malformed id, a signed-out person or an unknown incident', async () => {
    const { db } = fakeDb({ 'incidents.select': { data: null } });
    m.db = db;
    expect(await getIncidentForAck('not-a-uuid')).toBeNull();
    expect(await getIncidentForAck(ID)).toBeNull();
    m.access.mockResolvedValue({ status: 'signed-out' });
    expect(await getIncidentForAck(ID)).toBeNull();
  });

  it('skips the names query when nobody is named', async () => {
    const { db, calls } = fakeDb({
      'incidents.select': { data: { ...incident, sites: { ...incident.sites, primary_owner_id: null } } },
      'incident_events.select': { data: [] },
    });
    m.db = db;
    expect(await getIncidentForAck(ID)).not.toBeNull();
    expect(calls.some((c) => c.table === 'profiles')).toBe(false);
  });

  it.each([
    ['incidents.select', 'incident: boom'],
    ['incident_events.select', 'incident_events: boom'],
    ['profiles.select', 'profiles: boom'],
  ])('throws when %s fails', async (key, message) => {
    const { db } = fakeDb({
      'incidents.select': { data: incident },
      'incident_events.select': { data: events },
      [key]: { error: { message: 'boom' } },
    });
    m.db = db;
    await expect(getIncidentForAck(ID)).rejects.toThrow(message);
  });
});
