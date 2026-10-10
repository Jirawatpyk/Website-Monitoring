// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { IncidentFacts, Notification } from './facts';
import { toldAtOf } from './ladder-facts';
import { renderChat, renderEmail } from './render';

// INC-0142 MuvMi (Tier 1): confirmed 09:48:41 Bangkok; Arm owns, Ploy backs up, Tao the Admin (spec §4).
const arm = { id: 'u-arm', display_name: 'Arm', google_chat_user_id: 'ARM' };
const ploy = { id: 'u-ploy', display_name: 'Ploy', google_chat_user_id: 'PLOY' };
const tao = { id: 'u-tao', display_name: 'Tao', google_chat_user_id: 'TAO' };
const HOURS = { startMin: 540, endMin: 1080, days: [1, 2, 3, 4, 5], holidays: new Set<string>() };
const plan = {
  severity: 'down',
  tier: 1,
  reminderMin: 15,
  steps: [
    { level: 0, delayMin: 0, targets: ['owner'], channels: ['chat', 'space', 'email'] },
    { level: 1, delayMin: 15, targets: ['backup', 'admins'], channels: ['chat', 'email'] },
  ],
};
const incident: IncidentFacts = {
  id: 'inc-142',
  number: 142,
  state: 'unacked',
  severity: 'down',
  trigger: 'hard_fail',
  started_at: '2026-09-25T02:48:12Z',
  detected_at: '2026-09-25T02:48:41Z',
  acked_at: null,
  recovered_at: null,
  acker: null,
  sites: { name: 'MuvMi', tier: 1, primary: arm, backup: ploy },
  escalation_plan: plan,
  escalation_level: 0,
  ladder: { admins: [tao], hours: HOURS },
};
const row = (template: string, context: Notification['context'] = {}, over: Partial<Notification> = {}) =>
  ({
    id: 'n1',
    incident_id: 'inc-142',
    system_alert_id: null,
    user_id: null,
    channel: 'google_chat',
    template,
    context,
    created_at: '2026-09-25T02:48:42Z',
    hold_until: null,
    ...over,
  }) as Notification;
const appUrl = 'https://monitor.example.test';
const thread = { threadId: '<inc-inc-142@notify.example.test>', startsThread: false };

describe('render — the ladder (S08, D-034)', () => {
  it('the DOWN card promises the L1 time and names Ploy, Tao', () => {
    const m = renderChat(
      row('down', { cause: 'Timeout > 30 s (BKK, TYO)' }),
      incident,
      appUrl,
      new Date('2026-09-25T02:48:45Z'),
    )!;
    expect(m.text).toBe('<users/ARM> DOWN · MuvMi (Tier 1) · acknowledge by 10:03 or it escalates');
    expect(JSON.stringify(m.cardsV2)).toContain('L1 at 10:03 if not acknowledged — Ploy, Tao');
  });

  it('an incident opened before S08 (no plan) keeps the old card', () => {
    const m = renderChat(
      row('down'),
      { ...incident, escalation_plan: null },
      appUrl,
      new Date('2026-09-25T02:48:45Z'),
    )!;
    expect(m.text).toBe('<users/ARM> DOWN · MuvMi (Tier 1)');
  });

  it('ESCALATED · L1 from the people the SQL named', () => {
    const m = renderChat(
      row('step_fired', {
        level: 1,
        severity: 'down',
        elapsedMin: 15,
        mentioned: ['u-ploy'],
        fyi: ['u-tao'],
        notified: ['u-ploy', 'u-tao'],
      }),
      { ...incident, state: 'escalated', escalation_level: 1 },
      appUrl,
      new Date('2026-09-25T03:03:42Z'),
    )!;
    expect(m.text).toBe(
      '<users/PLOY> ESCALATED · L1 · MuvMi DOWN 15 min, not acknowledged · please acknowledge · Tao FYI',
    );
  });

  it('STILL DOWN reminder', () => {
    const m = renderChat(
      row('reminder', { severity: 'down', elapsedMin: 30, mentioned: ['u-arm', 'u-ploy'] }),
      incident,
      appUrl,
      new Date('2026-09-25T03:18:42Z'),
    )!;
    expect(m.text).toBe(
      '<users/ARM> <users/PLOY> STILL DOWN · MuvMi · 30 min, not acknowledged · please acknowledge',
    );
  });

  it('ACKNOWLEDGED · L1 stopped', () => {
    const m = renderChat(
      row('acknowledged', { ackedBy: 'Arm', ackedAt: '2026-09-25T03:07:40Z', escalationLevel: 1 }),
      { ...incident, state: 'acknowledged' },
      appUrl,
      new Date('2026-09-25T03:07:51Z'),
    )!;
    expect(m.text).toBe('ACKNOWLEDGED · MuvMi · by Arm 10:07 · L1 stopped');
  });

  it('the L1 emails: the backup is asked, the Admin informed, each with their footer', () => {
    const ctx = { level: 1, severity: 'down', elapsedMin: 15, mentioned: ['u-ploy'], fyi: ['u-tao'] };
    const toPloy = renderEmail(
      row('step_fired', { ...ctx, asFyi: false }, { channel: 'email', user_id: 'u-ploy' }),
      incident,
      { id: 'u-ploy', email: 'ploy@example.test', display_name: 'Ploy' },
      appUrl,
      thread,
    )!;
    expect(toPloy.text).toContain('Please acknowledge — you’re the next person for this incident.');
    expect(toPloy.text).toContain(
      'You got this because you’re backup for MuvMi and it wasn’t acknowledged in 15 min.',
    );
    const toTao = renderEmail(
      row('step_fired', { ...ctx, asFyi: true }, { channel: 'email', user_id: 'u-tao' }),
      incident,
      { id: 'u-tao', email: 'tao@example.test', display_name: 'Tao' },
      appUrl,
      thread,
    )!;
    expect(toTao.text).toContain('For your information — Ploy has been asked to acknowledge.');
    expect(toTao.text).toContain('You got this because you’re the Admin — L1 keeps you informed.');
  });

  it('a step_fired email sent as the Chat fallback carries the fallback footer', () => {
    const e = renderEmail(
      row(
        'step_fired',
        {
          level: 1,
          severity: 'down',
          elapsedMin: 15,
          mentioned: ['u-ploy'],
          fyi: ['u-tao'],
          asFyi: true,
          fallback: true,
        },
        { channel: 'email', user_id: 'u-tao' },
      ),
      incident,
      { id: 'u-tao', email: 'tao@example.test', display_name: 'Tao' },
      appUrl,
      thread,
    )!;
    expect(e.text).toContain('The Google Chat reply couldn’t be delivered, so this email is the alert.');
    expect(e.text).not.toContain('L1 keeps you informed');
  });

  it('toldAtOf: a DOWN at detection; a Tier 2 PROBLEM held overnight at the opening', () => {
    expect(toldAtOf(incident)).toEqual(new Date('2026-09-25T02:48:41Z'));
    const held: IncidentFacts = {
      ...incident,
      severity: 'problem',
      detected_at: '2026-09-24T15:14:00Z',
      sites: { name: 'ORCA Thailand', tier: 2, primary: tao, backup: ploy },
    };
    expect(toldAtOf(held)).toEqual(new Date('2026-09-25T02:00:00Z'));
    expect(toldAtOf({ ...held, sites: { ...held.sites, tier: 1 } })).toEqual(
      new Date('2026-09-24T15:14:00Z'),
    );
    expect(toldAtOf({ ...held, ladder: undefined })).toEqual(new Date('2026-09-24T15:14:00Z'));
  });

  it('a Tier 2 DOWN at night: timers paused until 09:00 (INC-0139)', () => {
    const orca: IncidentFacts = {
      ...incident,
      detected_at: '2026-09-24T15:14:00Z',
      sites: { name: 'ORCA Thailand', tier: 2, primary: tao, backup: ploy },
      escalation_plan: { ...plan, tier: 2 },
    };
    const m = renderChat(row('down'), orca, appUrl, new Date('2026-09-24T15:14:05Z'))!;
    expect(m.text).toBe(
      '<users/TAO> DOWN · ORCA Thailand (Tier 2) · outside response hours · timers paused until 09:00',
    );
    // Tao owns it, so L1 asks Ploy alone — the Admin was already told at L0.
    expect(JSON.stringify(m.cardsV2)).toContain('L1 at 09:15 if not acknowledged — Ploy');
  });
});
