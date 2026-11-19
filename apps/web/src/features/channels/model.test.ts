import { describe, expect, it } from 'vitest';
import type { EscalationStep } from '@dxt/shared';
import {
  ceoLine,
  FLAPPING,
  ladderLine,
  lastSentLine,
  latencyMs,
  logRows,
  routingRows,
  type LogNotification,
} from './model';

const step = (
  level: number,
  delayMin: number,
  channels: EscalationStep['channels'] = ['chat'],
): EscalationStep => ({ level, delayMin, targets: ['owner'], channels, fyi: false }) as EscalationStep;
const T1 = [
  step(0, 0, ['chat', 'space', 'email']),
  step(1, 15),
  step(2, 30, ['chat', 'email', 'voice']),
  step(3, 60),
];
const T23 = [step(0, 0, ['chat', 'space', 'email']), step(1, 15), step(2, 30)];
const PROBLEM = [step(0, 0, ['chat', 'space', 'email']), step(1, 60, ['chat', 'email'])];

// Fri 25 Sep 2026 10:08 Bangkok (spec §1).
const NOW = new Date('2026-09-25T03:08:00Z');
const n = (over: Partial<LogNotification>): LogNotification => ({
  id: Math.random().toString(36).slice(2),
  channel: 'google_chat',
  template: 'down',
  status: 'sent',
  attempts: 1,
  createdAt: '2026-09-25T02:48:43Z',
  holdUntil: null,
  sentAt: '2026-09-25T02:48:44.800Z',
  incidentNumber: 142,
  reportKind: null,
  oncallKind: null,
  to: null,
  ...over,
});

describe('who gets what (read-only, D-069 item 3)', () => {
  it('words a ladder as the board does, voice left out', () => {
    expect(ladderLine(T1)).toBe('L0 Chat + Space + email · L1 +15 · L2 +30 · L3 +60');
    expect(ladderLine(PROBLEM)).toBe('L0 Chat + Space + email · L1 +60');
  });

  it('DOWN, PROBLEM and SSL are set in Escalation; Recovery and Monitor fault are fixed', () => {
    const rows = routingRows({ t1Down: T1, t2Down: T23, t3Down: T23, problem: PROBLEM }, ['Tao']);
    expect(rows.map((r) => [r.id, r.setIn])).toEqual([
      ['down', 'escalation'],
      ['problem', 'escalation'],
      ['expiry', 'escalation'],
      ['recovery', 'fixed'],
      ['fault', 'fixed'],
    ]);
    expect(rows[0]!.how).toBe(
      'Tier 1: L0 Chat + Space + email · L1 +15 · L2 +30 · L3 +60 · Tier 2–3: L0 Chat + Space + email · L1 +15 · L2 +30',
    );
    expect(rows[2]!.how).toBe('Uses the PROBLEM policy · L0 Chat + Space + email · L1 +60');
    // One active Admin: the board's warning names them.
    expect(rows[4]!.onlyAdmin).toBe('Tao');
    expect(
      routingRows({ t1Down: T1, t2Down: T23, t3Down: T23, problem: PROBLEM }, ['Tao', 'Nok'])[4]!.onlyAdmin,
    ).toBeNull();
  });

  it('Tier 2 and Tier 3 get their own line once their ladders differ (D-034)', () => {
    const t3 = [step(0, 0, ['chat', 'space', 'email']), step(1, 30)];
    expect(routingRows({ t1Down: T1, t2Down: T23, t3Down: t3, problem: PROBLEM }, [])[0]!.how).toBe(
      'Tier 1: L0 Chat + Space + email · L1 +15 · L2 +30 · L3 +60 · Tier 2: L0 Chat + Space + email · L1 +15 · L2 +30 · Tier 3: L0 Chat + Space + email · L1 +30',
    );
  });

  it('the CEO cell reads the Tier 1 policy', () => {
    const ceo = (level: number, fyi: boolean) =>
      ({ level, delayMin: level * 30, targets: ['ceo'], channels: ['chat'], fyi }) as EscalationStep;
    expect(ceoLine([step(0, 0), ceo(2, false), ceo(3, true)])).toBe('Tier 1: L2 page · L3 FYI');
    expect(ceoLine([step(0, 0), step(1, 15)])).toBe('Not paged — the daily digest');
  });

  it('flapping shows the engine’s numbers', () => {
    expect(FLAPPING).toEqual({ changes: 3, windowMin: 30, stableMin: 15 });
  });
});

describe('delivery log', () => {
  it('latency counts from when it was due — its hold, or its queueing', () => {
    expect(latencyMs(n({}))).toBe(1800);
    expect(latencyMs(n({ holdUntil: '2026-09-25T02:53:43Z', sentAt: '2026-09-25T02:53:45Z' }))).toBe(2000);
    expect(latencyMs(n({ sentAt: null }))).toBeNull();
  });

  it('statuses: Delivered, Late · retried, Late, Failed, Held, Queued; cancelled rows left out', () => {
    const rows = logRows(
      [
        n({ id: 'ok' }),
        n({ id: 'retried', attempts: 2, createdAt: '2026-09-25T02:40:00Z', sentAt: '2026-09-25T02:40:32Z' }),
        n({ id: 'late', createdAt: '2026-09-25T02:30:00Z', sentAt: '2026-09-25T02:30:40Z' }),
        n({ id: 'failed', status: 'failed', attempts: 4, sentAt: null, createdAt: '2026-09-25T02:20:00Z' }),
        n({
          id: 'held',
          status: 'queued',
          attempts: 0,
          sentAt: null,
          holdUntil: '2026-09-25T03:30:00Z',
          createdAt: '2026-09-25T02:10:00Z',
        }),
        n({ id: 'queued', status: 'queued', attempts: 0, sentAt: null, createdAt: '2026-09-25T02:05:00Z' }),
        n({ id: 'cancelled', status: 'cancelled', attempts: 0, sentAt: null }),
      ],
      NOW,
    );
    expect(rows.map((r) => [r.id, r.status])).toEqual([
      ['ok', 'Delivered'],
      ['retried', 'Late · retried'],
      ['late', 'Late'],
      ['failed', 'Failed'],
      ['held', 'Held until 10:30'],
      ['queued', 'Queued'],
    ]);
    expect(rows[0]).toMatchObject({
      at: '09:48:44',
      inc: 'INC-0142',
      ch: 'Google Chat',
      tries: '1',
      lat: '1.8 s',
    });
    expect(rows[1]).toMatchObject({ tries: '2', lat: '32.0 s', tone: 'warning' });
  });

  it('the To words per kind: an incident thread, an email’s person, the reports Space, a test', () => {
    const rows = logRows(
      [
        n({
          id: 'a',
          template: 'client_update_due',
          channel: 'email',
          to: 'Bua',
          createdAt: '2026-09-25T03:03:13Z',
        }),
        n({
          id: 'b',
          incidentNumber: null,
          reportKind: 'daily',
          template: 'daily_digest',
          createdAt: '2026-09-25T02:00:02Z',
        }),
        n({
          id: 'c',
          incidentNumber: null,
          oncallKind: 'channel_test',
          template: 'oncall',
          createdAt: '2026-09-25T03:08:12Z',
        }),
        n({ id: 'd', incidentNumber: null, oncallKind: 'swap_requested', template: 'oncall' }),
      ],
      NOW,
    );
    expect(rows.map((r) => [r.inc, r.to])).toEqual([
      ['Test', '@them · “TEST — no action” thread'],
      ['INC-0142', 'Bua · client update due'],
      ['Digest', 'DxT Website Reports Space'],
    ]);
  });

  it('the newest Chat post as the card’s "Last sent"', () => {
    expect(lastSentLine({ at: '2026-09-25T03:03:44Z', latencyMs: 1200 }, NOW)).toBe('10:03:44 · 1.2 s');
    expect(lastSentLine(null, NOW)).toBe('Nothing sent yet');
    expect(lastSentLine({ at: '2026-09-24T09:40:00Z', latencyMs: null }, NOW)).toBe('Thu 24 Sep 16:40');
  });
});
