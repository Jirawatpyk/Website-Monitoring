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
      'Trigger: Manual (hand check) · reported by hand — no probe round confirms it yet',
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

describe('timelineOf — Down again by hand and the engine back (D-055 item 7, spec §30.8)', () => {
  const probes = {
    severity: 'down' as const,
    trigger: 'hard_fail' as const,
    startedAt: at('00:00:00'),
    recoveredAt: at('00:10:00'),
  };

  it.each([
    [
      'a recovered incident relapses',
      'relapsed',
      { severity: 'down', manual: true, note: '502 again' },
      'Down again, reported by Tao from a hand check · “502 again”',
    ],
    [
      'a PROBLEM is raised',
      'escalated_to_down',
      { manual: true, raised: true, note: '502 again' },
      'Raised to DOWN by Tao from a hand check · “502 again”',
    ],
  ])('%s: who reported it and what they saw', (_case, type, payload, title) => {
    const t = timelineOf(probes, [ev(type, '02:40:00', payload, 'u-tao')], nameOf, new Date(at('02:41:00')));
    const line = t.find((x) => x.at === at('02:40:00'))!;
    expect(line).toMatchObject({
      kind: 'down',
      title,
      detail: 'Reported by hand — no probe round confirms it yet',
    });
  });

  it('without a note the title stops at the hand check', () => {
    const t = timelineOf(
      probes,
      [ev('relapsed', '02:40:00', { severity: 'down', manual: true }, 'u-tao')],
      nameOf,
      new Date(at('02:41:00')),
    );
    expect(t.map((x) => x.title)).toContain('Down again, reported by Tao from a hand check');
  });

  it('the engine back line', () => {
    const t = timelineOf(
      probes,
      [ev('engine_back', '02:44:00', { stoppedSince: at('02:17:00') })],
      nameOf,
      new Date(at('02:45:00')),
    );
    expect(t.find((x) => x.at === at('02:44:00'))).toMatchObject({
      kind: 'ok',
      title: 'Status engine back — automatic escalation running again',
      detail: 'Levels already sent won’t repeat.',
    });
  });

  it('the engine back line names the next level on the latest stop only (§31.7)', () => {
    const t = timelineOf(
      probes,
      [
        ev('engine_back', '02:44:00', { stoppedSince: at('02:17:00') }),
        ev('engine_back', '03:20:00', { stoppedSince: at('03:00:00') }),
      ],
      nameOf,
      new Date(at('03:21:00')),
      'Next: L2 at 03:31 if still unacked.',
    );
    expect(t.filter((x) => x.title.startsWith('Status engine back')).map((x) => x.detail)).toEqual([
      'Levels already sent won’t repeat.',
      'Levels already sent won’t repeat. Next: L2 at 03:31 if still unacked.',
    ]);
  });
});
