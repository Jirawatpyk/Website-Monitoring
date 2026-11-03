import { describe, expect, it } from 'vitest';
import { canMarkClientUpdate, clientUpdateCardOf, resolveGate, timelineOf, type EventRow } from './model';

// INC-0142 MuvMi (Tier 1): due 10:03:12, Bua (AM) marked 10:12 (spec §14.11) — test fixtures only.
const at = (local: string) => new Date(`2026-09-25T${local}+07:00`).toISOString();
const drafts = { th: 'TH', en: 'EN' };
const base = {
  required: true,
  dueAt: at('10:03:12'),
  updatedAt: null,
  by: null,
  notNeeded: false,
  note: null,
  tier: 1,
  notified: null,
  am: 'Bua',
  client: 'MuvMi',
  drafts,
  lang: 'th' as const,
  canMark: true,
};

describe('clientUpdateCardOf (Incident board, D-052)', () => {
  it('no card before the track fired (D-052 item 3)', () => {
    expect(clientUpdateCardOf({ ...base, required: false, dueAt: null })).toBeNull();
  });

  it('due, not marked: the banner and the foot', () => {
    const c = clientUpdateCardOf(base)!;
    expect(c.status).toBe('pending');
    expect(c.dueLine).toBe('10:03 · Tier 1 down 15 min');
    expect(c.stateText).toBe('Not marked yet');
    expect(c.banner).toBe('Client update due 10:03 · Bua notified 10:03 · not marked yet');
    expect(c.foot).toBe(
      'Tier 1 down 15 min: Resolve needs this marked, or marked “Not needed” with a reason.',
    );
  });

  it('marked by Bua with a note; not needed by Tao with a reason', () => {
    const marked = clientUpdateCardOf({
      ...base,
      updatedAt: at('10:12:05'),
      by: 'Bua',
      note: 'Called MuvMi ops, ETA shared',
    })!;
    expect(marked.stateText).toBe('Updated by Bua 10:12');
    expect(marked.note).toEqual({ label: 'Note', text: 'Called MuvMi ops, ETA shared' });
    expect(marked.banner).toBeNull();
    expect(marked.foot).toBe('Recorded in the audit log and the post-incident review (Client notified).');
    const nn = clientUpdateCardOf({
      ...base,
      updatedAt: at('10:07:30'),
      by: 'Tao',
      notNeeded: true,
      note: 'Ops told us',
    })!;
    expect(nn.stateText).toBe('Not needed · Tao 10:07');
    expect(nn.note).toEqual({ label: 'Reason', text: 'Ops told us' });
  });

  it('whom the track told, as it recorded it: the Admins, though the client has an AM now (spec-check M1)', () => {
    const c = clientUpdateCardOf({ ...base, notified: { am: null, at: at('10:20:00') } })!;
    expect(c.am).toBeNull();
    expect(c.notifiedAt).toBe(at('10:20:00'));
    expect(c.banner).toBe('Client update due 10:03 · no AM · Admins notified 10:20 · not marked yet');
  });

  it('the phone line once marked', () => {
    expect(clientUpdateCardOf({ ...base, updatedAt: at('10:12:05'), by: 'Bua' })!.markedLine).toBe(
      'Marked by Bua 10:12',
    );
  });

  it('Tier 2 and no AM', () => {
    const c = clientUpdateCardOf({ ...base, tier: 2, am: null })!;
    expect(c.dueLine).toBe('10:03 · Tier 2 down 60 min inside response hours');
    expect(c.banner).toBe('Client update due 10:03 · no AM · Admins notified 10:03 · not marked yet');
  });
});

describe('canMarkClientUpdate (spec §16.6, D-052 item 4)', () => {
  const site = { primaryOwnerId: 'arm', backupOwnerId: 'ploy', amId: 'bua' };
  it.each([
    [{ id: 'tao', role: 'admin' }, true],
    [{ id: 'arm', role: 'responder' }, true],
    [{ id: 'ploy', role: 'responder' }, true],
    [{ id: 'nok', role: 'responder' }, false],
    [{ id: 'bua', role: 'stakeholder' }, true],
    [{ id: 'thee', role: 'stakeholder' }, false],
    [{ id: 'bua', role: 'viewer' }, false],
    [{ id: 'mint', role: 'viewer' }, false],
  ])('%o → %s', (viewer, expected) => {
    expect(canMarkClientUpdate(viewer, site)).toBe(expected);
  });
  it('a Responder who is the AM', () => {
    expect(canMarkClientUpdate({ id: 'nok', role: 'responder' }, { ...site, amId: 'nok' })).toBe(true);
  });
});

describe('the Client update condition (Resolve gate, §16.2)', () => {
  const gate = (over: Record<string, unknown>) =>
    resolveGate(
      {
        siteName: 'MuvMi',
        state: 'needs_root_cause',
        recoveredAt: at('10:31:00'),
        clientUpdateRequired: true,
        clientUpdatedAt: null,
        rootCauseCategory: null,
        clientUpdate: { tier: 1, dueAt: at('10:03:12'), by: null, notNeeded: false, note: null },
        ...over,
      },
      [],
      () => 'someone',
    ).conditions.find((c) => c.key === 'client_update')!;

  it('required, marked, not needed, not required', () => {
    expect(gate({}).detail).toBe('Required — Tier 1 down 15 min · due 10:03 · not marked yet');
    expect(gate({}).met).toBe(false);
    expect(
      gate({
        clientUpdatedAt: at('10:12:05'),
        clientUpdate: { tier: 1, dueAt: at('10:03:12'), by: 'Bua', notNeeded: false, note: null },
      }).detail,
    ).toBe('Marked by Bua 10:12');
    expect(
      gate({
        clientUpdatedAt: at('10:07:30'),
        clientUpdate: { tier: 1, dueAt: at('10:03:12'), by: 'Tao', notNeeded: true, note: 'x' },
      }).detail,
    ).toBe('Not needed · Tao 10:07 · reason recorded');
    expect(gate({ clientUpdateRequired: false }).detail).toBe(
      'Not required — the client-update track didn’t fire',
    );
  });
});

describe('timeline lines (Incident board 10:03:12 / 10:12:05)', () => {
  it('due, marked, not needed', () => {
    const events: EventRow[] = [
      { type: 'client_update_due', at: at('10:03:12'), actor_id: null, payload: { am: 'Bua', tier: 1 } },
      {
        type: 'client_update_marked',
        at: at('10:12:05'),
        actor_id: 'bua',
        payload: { by: 'Bua', note: 'Called MuvMi ops, ETA shared' },
      },
      {
        type: 'client_update_not_needed',
        at: at('10:13:00'),
        actor_id: 'tao',
        payload: { by: 'Tao', note: 'x' },
      },
    ];
    const lines = timelineOf(
      { severity: 'down', trigger: 'hard_fail', startedAt: at('09:48:12'), recoveredAt: null },
      events,
      () => 'someone',
      new Date(at('10:20:00')),
    ).map((l) => [l.title, l.detail]);
    expect(lines).toContainEqual([
      'Client update due — Bua @mentioned',
      'Tier 1 down 15 min · draft client message posted in the thread for Bua (AM)',
    ]);
    expect(lines).toContainEqual([
      'Client update marked by Bua',
      '“Called MuvMi ops, ETA shared” · client-update track closed',
    ]);
    expect(lines).toContainEqual(['Client update marked not needed by Tao', 'Reason: x']);
  });
});
