import { describe, expect, it } from 'vitest';
import { timelineOf } from './model';

// Spec §30.5–7 sample (test data only): realme.link opened by hand Sat 26 Sep 02:31, L1 sent by hand
// at 02:35, the client-update reminder at 02:36.
const at = (t: string) => `2026-09-26T${t}+07:00`;
const names: Record<string, string> = { 'u-tao': 'Tao', 'u-arm': 'Arm' };
const nameOf = (id: string | null) => (id ? (names[id] ?? 'someone') : 'someone');
const ev = (type: string, t: string, payload: Record<string, unknown>, actor: string | null = null) => ({
  type,
  at: at(t),
  actor_id: actor,
  payload,
});

describe('timelineOf — a manual incident and the by-hand steps (S12b, spec §30.5–7)', () => {
  const i = {
    severity: 'down' as const,
    trigger: 'manual' as const,
    startedAt: at('02:31:05'),
    recoveredAt: null,
  };
  const events = [
    ev(
      'detected',
      '02:31:05',
      { manual: true, openedBy: 'Tao', note: 'Home page shows a 502 error' },
      'u-tao',
    ),
    ev(
      'step_fired',
      '02:35:10',
      { level: 1, notified: ['u-arm'], mentioned: ['u-arm'], byHand: true },
      'u-tao',
    ),
    ev('client_update_due', '02:36:40', { am: 'Thee', tier: 1, byHand: true }, 'u-tao'),
  ];

  it('opened, escalated and reminded by hand, each naming who', () => {
    const t = timelineOf(i, events, nameOf, new Date(at('02:40:00')));
    expect(t.map((x) => x.title)).toContain(
      'Opened by Tao from a hand check · “Home page shows a 502 error”',
    );
    expect(t.map((x) => x.title)).toContain('Escalated to L1 by Tao (engine down)');
    expect(t.map((x) => x.title)).toContain('Client-update reminder sent by Tao (engine down)');
    const opened = t.find((x) => x.title.startsWith('Opened by'))!;
    expect(opened.detail).toBe(
      'Trigger: Manual (hand check) · the status engine was down, so there are no probe results',
    );
    expect(t.find((x) => x.title.startsWith('Client-update reminder'))!.detail).toBe(
      'Thee (AM) @mentioned in the thread with a draft client message + email',
    );
  });

  it('the engine’s own steps keep their words', () => {
    const t = timelineOf(
      i,
      [ev('step_fired', '02:46:00', { level: 1, notified: ['u-arm'], mentioned: ['u-arm'] })],
      nameOf,
      new Date(at('02:50:00')),
    );
    expect(t.map((x) => x.title)).toContain('Escalated to L1 — not acknowledged');
  });
});
