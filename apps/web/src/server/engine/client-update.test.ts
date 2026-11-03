// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { fakeDb } from '../../../test/fake-db';
import { clientUpdateTick } from './client-update';

const bkk = (iso: string) => new Date(`${iso}+07:00`);
const HOURS = { startMin: 540, endMin: 1080, days: [1, 2, 3, 4, 5], holidays: new Set<string>() };
// INC-0142 MuvMi (Tier 1): first failed 09:48:12 (spec §4).
const inc0142 = (over: Record<string, unknown> = {}) => ({
  id: 'i142',
  started_at: bkk('2026-09-25T09:48:12').toISOString(),
  severity: 'down',
  resolved_at: null,
  sites: { tier: 1, clients: { is_internal: false } },
  ...over,
});
const detected = {
  incident_id: 'i142',
  type: 'detected',
  at: bkk('2026-09-25T09:48:41').toISOString(),
  payload: {},
};

describe('clientUpdateTick (S11, spec §9)', () => {
  it('INC-0142: nothing at 10:03:11, fires at 10:03:12 with that due time (Done-when 1)', async () => {
    const early = fakeDb({
      'incidents.select': { data: [inc0142()] },
      'incident_events.select': { data: [detected] },
      'rpc.engine_client_update_due': { data: true },
    });
    expect((await clientUpdateTick(early.db, bkk('2026-09-25T10:03:11'), HOURS)).queued).toBe(0);
    expect(early.rpcCalls).toEqual([]);

    const { db, rpcCalls } = fakeDb({
      'incidents.select': { data: [inc0142()] },
      'incident_events.select': { data: [detected] },
      'rpc.engine_client_update_due': { data: true },
    });
    expect(await clientUpdateTick(db, bkk('2026-09-25T10:03:12'), HOURS)).toEqual({ queued: 1, failed: [] });
    expect(rpcCalls).toEqual([
      {
        name: 'engine_client_update_due',
        args: { p_incident_id: 'i142', p_due_at: bkk('2026-09-25T10:03:12').toISOString() },
      },
    ]);
  });

  it('a recovery before 15 min: never asked; one in the minute it fell due: still asked', async () => {
    const before = fakeDb({
      'incidents.select': { data: [inc0142()] },
      'incident_events.select': {
        data: [detected, { ...detected, type: 'recovered', at: bkk('2026-09-25T10:02:12').toISOString() }],
      },
    });
    await clientUpdateTick(before.db, bkk('2026-09-25T10:05:00'), HOURS);
    expect(before.rpcCalls).toEqual([]);

    const same = fakeDb({
      'incidents.select': { data: [inc0142()] },
      'incident_events.select': {
        data: [detected, { ...detected, type: 'recovered', at: bkk('2026-09-25T10:03:30').toISOString() }],
      },
      'rpc.engine_client_update_due': { data: true },
    });
    await clientUpdateTick(same.db, bkk('2026-09-25T10:03:39'), HOURS);
    expect(same.rpcCalls).toHaveLength(1);
  });

  it('skips Tier 3 and internal clients without reading their timelines', async () => {
    const { db, calls, rpcCalls } = fakeDb({
      'incidents.select': {
        data: [
          inc0142({ id: 'a', sites: { tier: 3, clients: { is_internal: false } } }),
          inc0142({ id: 'b', sites: { tier: 1, clients: { is_internal: true } } }),
        ],
      },
    });
    expect((await clientUpdateTick(db, bkk('2026-09-25T11:00:00'), HOURS)).queued).toBe(0);
    expect(calls.some((c) => c.table === 'incident_events')).toBe(false);
    expect(rpcCalls).toEqual([]);
  });

  it('Tier 2 counts 60 min inside response hours (Thu 22:14 → Fri 10:00)', async () => {
    const { db, rpcCalls } = fakeDb({
      'incidents.select': {
        data: [
          inc0142({
            id: 'i139',
            started_at: bkk('2026-09-24T22:14:00').toISOString(),
            sites: { tier: 2, clients: { is_internal: false } },
          }),
        ],
      },
      'incident_events.select': { data: [{ ...detected, incident_id: 'i139' }] },
      'rpc.engine_client_update_due': { data: true },
    });
    await clientUpdateTick(db, bkk('2026-09-25T09:59:00'), HOURS);
    expect(rpcCalls).toEqual([]);
    await clientUpdateTick(db, bkk('2026-09-25T10:00:00'), HOURS);
    expect(rpcCalls).toEqual([
      {
        name: 'engine_client_update_due',
        args: { p_incident_id: 'i139', p_due_at: bkk('2026-09-25T10:00:00').toISOString() },
      },
    ]);
  });

  it('a failing incident is reported; a refused one (already fired) counts nothing', async () => {
    const failing = fakeDb({
      'incidents.select': { data: [inc0142()] },
      'incident_events.select': { data: [detected] },
      'rpc.engine_client_update_due': { error: { message: 'boom' } },
    });
    expect(await clientUpdateTick(failing.db, bkk('2026-09-25T10:04:00'), HOURS)).toEqual({
      queued: 0,
      failed: ['i142: boom'],
    });
    const refused = fakeDb({
      'incidents.select': { data: [inc0142()] },
      'incident_events.select': { data: [detected] },
      'rpc.engine_client_update_due': { data: false },
    });
    expect((await clientUpdateTick(refused.db, bkk('2026-09-25T10:04:00'), HOURS)).queued).toBe(0);
  });

  it('one incident whose hours never open is reported; the next still fires (engine review L1)', async () => {
    const closed = { ...HOURS, days: [] as number[] };
    const { db, rpcCalls } = fakeDb({
      'incidents.select': {
        data: [inc0142({ id: 't2', sites: { tier: 2, clients: { is_internal: false } } }), inc0142()],
      },
      'incident_events.select': { data: [{ ...detected, incident_id: 't2' }, detected] },
      'rpc.engine_client_update_due': { data: true },
    });
    const r = await clientUpdateTick(db, bkk('2026-09-25T10:04:00'), closed);
    expect(r.queued).toBe(1);
    expect(r.failed).toEqual([expect.stringMatching(/^t2: /)]);
    expect(rpcCalls.map((c) => (c.args as { p_incident_id: string }).p_incident_id)).toEqual(['i142']);
  });

  it('after a mute it counts from the late alert (D-052 item 6)', async () => {
    const { db, rpcCalls } = fakeDb({
      'incidents.select': { data: [inc0142({ alerted_at: bkk('2026-09-25T10:00:00').toISOString() })] },
      'incident_events.select': { data: [detected] },
      'rpc.engine_client_update_due': { data: true },
    });
    await clientUpdateTick(db, bkk('2026-09-25T10:14:59'), HOURS);
    expect(rpcCalls).toEqual([]);
    await clientUpdateTick(db, bkk('2026-09-25T10:15:00'), HOURS);
    expect(rpcCalls).toHaveLength(1);
  });

  it('a failed read fails the tick', async () => {
    const { db } = fakeDb({ 'incidents.select': { error: { message: 'down' } } });
    await expect(clientUpdateTick(db, bkk('2026-09-25T10:04:00'), HOURS)).rejects.toThrow('incidents: down');
  });
});
