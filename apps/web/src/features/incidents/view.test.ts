import { describe, expect, it } from 'vitest';
import { buildIncidentView, canAcknowledge, type EventRow, type IncidentRow, type Viewer } from './view';

// MobileAck board sample (test data only): MuvMi, INC-0142, Arm owns it, Ploy is backup.
const incident: IncidentRow = {
  id: 'i1',
  number: 142,
  state: 'unacked',
  severity: 'down',
  trigger: 'hard_fail',
  escalation_level: 0,
  started_at: '2026-09-25T02:48:10Z',
  detected_at: '2026-09-25T02:48:41Z',
  acked_at: null,
  acked_by: null,
  recovered_at: null,
  sites: {
    name: 'MuvMi',
    tier: 1,
    primary_owner_id: 'u-arm',
    backup_owner_id: 'u-ploy',
    monitors: [{ url: 'https://www.muvmi.example.test', is_primary: true }],
  },
};
const viewer = (over: Partial<Viewer> = {}): Viewer => ({
  id: 'u-arm',
  email: 'arm@example.test',
  displayName: 'Arm',
  role: 'responder',
  ...over,
});
const names = new Map([
  ['u-arm', 'Arm'],
  ['u-ploy', 'Ploy'],
  ['u-tao', 'Tao'],
]);
const detected: EventRow = {
  type: 'detected',
  at: '2026-09-25T02:48:41Z',
  actor_id: null,
  payload: { cause: 'Timeout > 30 s (BKK, TYO) · HTTP 504 (SIN)', confirmingLocations: 3 },
};
const now = new Date('2026-09-25T03:07:30Z');
const view = (i: Partial<IncidentRow> = {}, events: EventRow[] = [detected], v = viewer(), at = now) =>
  buildIncidentView({ ...incident, ...i }, events, v, names, at);

describe('canAcknowledge (D-016)', () => {
  it.each([
    [viewer({ role: 'admin', id: 'u-tao' }), true],
    [viewer(), true],
    [viewer({ id: 'u-ploy' }), true],
    [viewer({ id: 'u-nok' }), false],
    [viewer({ role: 'stakeholder' }), false],
    [viewer({ role: 'viewer' }), false],
  ])('%o → %s', (v, expected) => {
    expect(canAcknowledge(v, incident)).toBe(expected);
  });
});

describe('MobileAck view', () => {
  it('has the board header, facts and site link', () => {
    expect(view()).toMatchObject({
      id: 'INC-0142',
      title: 'MuvMi is down',
      sub: '19 min · Tier 1 · Fri 25 Sep',
      role: 'You’re the owner.',
      confirmedAt: '09:48:41',
      confirmedBy: 'Confirmed by 3 locations, 2 checks',
      cause: 'Timeout > 30 s (BKK, TYO) · HTTP 504 (SIN)',
      siteUrl: 'https://www.muvmi.example.test',
      ack: { kind: 'can-ack' },
      log: [{ at: '09:48', text: 'Confirmed down — 3 locations, 2 checks' }],
    });
  });

  it('names the role of whoever can act', () => {
    expect(view({}, [detected], viewer({ id: 'u-ploy' })).role).toBe('You’re the backup owner.');
    expect(view({}, [detected], viewer({ id: 'u-tao', role: 'admin' })).role).toBe('You’re an Admin.');
  });

  it('shows read-only roles who can act instead (EmptyStates panel 5)', () => {
    const v = view({}, [detected], viewer({ id: 'u-mint', role: 'viewer', email: 'mint@example.test' }));
    expect(v.role).toBeNull();
    expect(v.ack).toEqual({
      kind: 'read-only',
      title: 'Your role can’t acknowledge (Viewer)',
      description:
        'mint@example.test can see this incident but not acknowledge it. Its owner, backup or an Admin can — ask in the Chat thread.',
      people: [
        { name: 'Arm', duty: 'owner', status: 'Not acked', urgent: true },
        { name: 'Ploy', duty: 'backup owner', status: 'Not acked', urgent: true },
      ],
    });
    const nok = view({}, [detected], viewer({ id: 'u-nok' }));
    expect(nok.ack).toMatchObject({
      title: 'You can see this, not acknowledge it',
      description:
        'MuvMi isn’t one of your sites. Its owner, backup or an Admin can acknowledge — ask in the Chat thread.',
    });
    const noOwners = view(
      { sites: { ...incident.sites, primary_owner_id: null, backup_owner_id: null } },
      [detected],
      viewer({ role: 'viewer' }),
    );
    expect(noOwners.ack).toMatchObject({ people: [] });
  });

  const acked = { state: 'acknowledged' as const, acked_at: '2026-09-25T03:07:40Z', acked_by: 'u-arm' };
  const ackEvent = (at: string, payload: Record<string, unknown> = {}): EventRow => ({
    type: 'acknowledged',
    at,
    actor_id: 'u-arm',
    payload: {
      from: 'unacked',
      posts_at: new Date(Date.parse(at) + 10_000).toISOString(),
      notifies: true,
      ...payload,
    },
  });

  it('holds the ack for 10 s, then shows where it was posted', () => {
    const holding = view(
      acked,
      [detected, ackEvent('2026-09-25T03:07:40Z')],
      viewer(),
      new Date('2026-09-25T03:07:43Z'),
    );
    expect(holding.ack).toEqual({
      kind: 'acked',
      byName: 'Arm',
      byViewer: true,
      postsAt: '2026-09-25T03:07:50.000Z',
      windowOpen: true,
      notifies: true,
      posted: null,
    });
    expect(holding.log[0]).toEqual({
      at: '10:07',
      text: 'Acknowledged by Arm (posts 10:07:50 unless undone)',
    });

    const alerted = (channel: string, at: string): EventRow => ({
      type: 'alerted',
      at,
      actor_id: null,
      payload: { channel, template: 'acknowledged', ...(channel === 'email' ? { user_id: 'u-arm' } : {}) },
    });
    const events = [
      detected,
      ackEvent('2026-09-25T03:07:40Z'),
      alerted('google_chat', '2026-09-25T03:07:51Z'),
      alerted('email', '2026-09-25T03:07:52Z'),
    ];
    const posted = view(acked, events, viewer(), new Date('2026-09-25T03:08:00Z'));
    expect(posted.ack).toMatchObject({
      posted: { at: '2026-09-25T03:07:51Z', to: 'the Chat thread + email' },
    });
    expect(posted.log.slice(0, 3).map((l) => l.text)).toEqual([
      'ACKNOWLEDGED emailed to Arm',
      'ACKNOWLEDGED posted in Chat',
      'Acknowledged by Arm (posted 10:07:51)',
    ]);
    expect(view(acked, events.slice(0, 3), viewer(), now).ack).toMatchObject({
      posted: { to: 'the Chat thread' },
    });
    expect(view(acked, [...events.slice(0, 2), events[3]!], viewer(), now).ack).toMatchObject({
      posted: { to: 'email' },
    });
  });

  it('uses the latest ack after an Undo, and says when another person acknowledged', () => {
    const events = [
      detected,
      ackEvent('2026-09-25T03:07:00Z'),
      { type: 'ack_undone', at: '2026-09-25T03:07:05Z', actor_id: 'u-arm', payload: {} },
      ackEvent('2026-09-25T03:07:40Z'),
    ];
    const v = view(acked, events, viewer({ id: 'u-tao', role: 'admin' }), new Date('2026-09-25T03:07:42Z'));
    expect(v.ack).toMatchObject({ byName: 'Arm', byViewer: false, postsAt: '2026-09-25T03:07:50.000Z' });
    expect(v.log.map((l) => l.text)).toEqual([
      'Acknowledged by Arm (posts 10:07:50 unless undone)',
      'Acknowledgement undone by Arm',
      'Acknowledged by Arm',
      'Confirmed down — 3 locations, 2 checks',
    ]);
  });

  it('never marks an undone ack as posted, even when a later ack posted', () => {
    const events: EventRow[] = [
      detected,
      ackEvent('2026-09-25T03:07:00Z'),
      { type: 'ack_undone', at: '2026-09-25T03:07:05Z', actor_id: 'u-arm', payload: {} },
      ackEvent('2026-09-25T03:07:40Z'),
      {
        type: 'alerted',
        at: '2026-09-25T03:07:51Z',
        actor_id: null,
        payload: { channel: 'google_chat', template: 'acknowledged' },
      },
    ];
    const v = view(acked, events, viewer(), new Date('2026-09-25T03:08:00Z'));
    expect(v.log.map((l) => l.text)).toContain('Acknowledged by Arm (posted 10:07:51)');
    expect(v.log.filter((l) => l.text.startsWith('Acknowledged by Arm'))).toEqual([
      { at: '10:07', text: 'Acknowledged by Arm (posted 10:07:51)' },
      { at: '10:07', text: 'Acknowledged by Arm' },
    ]);
  });

  it('falls back to the window when the ack event is missing, and knows a muted ack posts nothing', () => {
    expect(view(acked, [detected]).ack).toMatchObject({
      postsAt: '2026-09-25T03:07:50.000Z',
      notifies: true,
    });
    const muted = view(
      acked,
      [detected, ackEvent('2026-09-25T03:07:40Z', { notifies: false })],
      viewer(),
      now,
    );
    expect(muted.ack).toMatchObject({ notifies: false });
    expect(muted.log[0]?.text).toBe('Acknowledged by Arm');
  });

  it('is past acknowledging once recovered, and the log reads in words', () => {
    const events: EventRow[] = [
      detected,
      {
        type: 'alerted',
        at: '2026-09-25T02:48:45Z',
        actor_id: null,
        payload: { channel: 'google_chat', template: 'down' },
      },
      { type: 'recovered', at: '2026-09-25T03:31:41Z', actor_id: null, payload: { okLocations: 3 } },
      { type: 'ok_two_rounds', at: '2026-09-25T03:32:41Z', actor_id: null, payload: {} },
      {
        type: 'alerted',
        at: '2026-09-25T03:32:00Z',
        actor_id: null,
        payload: { channel: 'webhook', template: 'other' },
      },
      { type: 'something_new', at: '2026-09-25T03:33:00Z', actor_id: null, payload: {} },
    ];
    const v = view({ state: 'needs_root_cause', recovered_at: '2026-09-25T03:31:41Z' }, events);
    expect(v).toMatchObject({
      title: 'MuvMi is back',
      sub: 'down 43 min · Tier 1 · Fri 25 Sep',
      recovered: true,
      ack: { kind: 'closed' },
    });
    expect(v.log.map((l) => l.text)).toEqual([
      'OK two rounds in a row — needs a root cause',
      'Alert posted in Chat',
      'Recovered — OK from 3 locations',
      'DOWN posted in Chat',
      'Confirmed down — 3 locations, 2 checks',
    ]);
  });

  it('uses safe defaults when stored facts are missing', () => {
    const v = view({ sites: { ...incident.sites, monitors: [] } }, []);
    expect(v).toMatchObject({
      cause: 'Hard fail',
      confirmedBy: 'Confirmed by 2 locations, 2 checks',
      siteUrl: null,
    });
    const unknown = buildIncidentView(
      { ...incident, state: 'acknowledged', acked_at: '2026-09-25T03:07:40Z', acked_by: 'u-gone' },
      [{ type: 'detected', at: '2026-09-25T02:48:41Z', actor_id: null, payload: {} }],
      viewer({ role: 'viewer' }),
      new Map(),
      now,
    );
    expect(unknown.ack).toMatchObject({ byName: 'someone' });
  });
});
