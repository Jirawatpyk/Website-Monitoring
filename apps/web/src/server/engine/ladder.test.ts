// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { fakeDb } from '../../../test/fake-db';
import { escalationTick } from './ladder';

const bkk = (iso: string) => new Date(`${iso}+07:00`);
const HOURS = { startMin: 540, endMin: 1080, days: [1, 2, 3, 4, 5], holidays: new Set<string>() };
const plan = (tier: number) => ({
  severity: 'down',
  tier,
  reminderMin: 15,
  steps: [
    { level: 0, delayMin: 0, targets: ['owner'], channels: ['chat', 'space', 'email'] },
    { level: 1, delayMin: 15, targets: ['backup', 'admins'], channels: ['chat', 'email'] },
  ],
});
// INC-0142 MuvMi (Tier 1), confirmed down 09:48:41 (spec §4).
const inc0142 = (over: Record<string, unknown> = {}) => ({
  id: 'i142',
  state: 'unacked',
  detected_at: bkk('2026-09-25T09:48:41').toISOString(),
  escalation_level: 0,
  escalation_plan: plan(1),
  ...over,
});

describe('escalationTick (S08, D-034)', () => {
  it('fires L1 at 10:03:41 with how long it has been', async () => {
    const { db, rpcCalls } = fakeDb({
      'incidents.select': { data: [inc0142()] },
      'rpc.engine_fire_step': { data: true },
    });
    expect(await escalationTick(db, bkk('2026-09-25T10:03:41'), HOURS)).toBe(1);
    expect(rpcCalls).toEqual([
      {
        name: 'engine_fire_step',
        args: {
          p_incident_id: 'i142',
          p_level: 1,
          p_due_at: bkk('2026-09-25T10:03:41').toISOString(),
          p_context: { elapsedMin: 15 },
        },
      },
    ]);
  });

  it('does nothing a second early', async () => {
    const { db, rpcCalls } = fakeDb({ 'incidents.select': { data: [inc0142()] } });
    expect(await escalationTick(db, bkk('2026-09-25T10:03:40'), HOURS)).toBe(0);
    expect(rpcCalls).toEqual([]);
  });

  it('queues the +30 reminder once L1 has fired', async () => {
    const { db, rpcCalls } = fakeDb({
      'incidents.select': { data: [inc0142({ state: 'escalated', escalation_level: 1 })] },
      'rpc.engine_remind': { data: true },
    });
    expect(await escalationTick(db, bkk('2026-09-25T10:19:00'), HOURS)).toBe(1);
    expect(rpcCalls[0]).toEqual({
      name: 'engine_remind',
      args: {
        p_incident_id: 'i142',
        p_due_at: bkk('2026-09-25T10:18:41').toISOString(),
        p_context: { elapsedMin: 30, afterMin: 30 },
      },
    });
  });

  it('counts nothing when the guarded SQL refused (another run fired it)', async () => {
    const { db } = fakeDb({
      'incidents.select': { data: [inc0142()] },
      'rpc.engine_fire_step': { data: false },
    });
    expect(await escalationTick(db, bkk('2026-09-25T10:05:00'), HOURS)).toBe(0);
  });

  it('INC-0139 (Tier 2, Thu 22:14): waits through the night, L1 at Fri 09:15', async () => {
    const orca = inc0142({
      id: 'i139',
      detected_at: bkk('2026-09-24T22:14:00').toISOString(),
      escalation_plan: plan(2),
    });
    const night = fakeDb({ 'incidents.select': { data: [orca] } });
    expect(await escalationTick(night.db, bkk('2026-09-25T03:00:00'), HOURS)).toBe(0);
    const morning = fakeDb({ 'incidents.select': { data: [orca] }, 'rpc.engine_fire_step': { data: true } });
    await escalationTick(morning.db, bkk('2026-09-25T09:15:00'), HOURS);
    expect(morning.rpcCalls[0]?.args).toMatchObject({ p_level: 1, p_context: { elapsedMin: 661 } });
  });

  it('skips an incident opened before S08 (no plan) and one whose plan is broken', async () => {
    const { db, rpcCalls } = fakeDb({
      'incidents.select': {
        data: [inc0142({ escalation_plan: null }), inc0142({ escalation_plan: { steps: 'x' } })],
      },
    });
    expect(await escalationTick(db, bkk('2026-09-25T11:00:00'), HOURS)).toBe(0);
    expect(rpcCalls).toEqual([]);
  });

  it('throws when a guarded write fails, so the run reports it', async () => {
    const { db } = fakeDb({
      'incidents.select': { data: [inc0142()] },
      'rpc.engine_fire_step': { error: { message: 'boom' } },
    });
    await expect(escalationTick(db, bkk('2026-09-25T10:05:00'), HOURS)).rejects.toThrow(
      'engine_fire_step: boom',
    );
  });
});
