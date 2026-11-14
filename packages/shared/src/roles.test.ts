import { describe, expect, it } from 'vitest';
import { gainsLoses, roleDiff } from './roles';

const STAFF = ['admin', 'responder', 'stakeholder', 'viewer'] as const;

describe('roleDiff — the role-change email lists (spec §34, D-062 item 13)', () => {
  it('Nok Responder → Stakeholder (the board)', () => {
    expect(roleDiff('responder', 'stakeholder', { managesClients: false })).toEqual({
      now: ['Send client reports for clients where you’re Site AM (none yet)'],
      noLonger: [
        'Acknowledge or resolve incidents on your sites',
        'Mark client updates, except for clients where you’re Site AM',
        'Schedule maintenance or mute your sites',
      ],
      keep: 'The dashboard and history, alerts and digests, uptime reports',
    });
  });

  it('a Site AM made Stakeholder: no "(none yet)"', () => {
    expect(roleDiff('responder', 'stakeholder', { managesClients: true }).now).toEqual([
      'Send client reports for clients where you’re Site AM',
    ]);
  });

  it('Arm Responder → Admin (the board, plus client updates on every site)', () => {
    expect(roleDiff('responder', 'admin', { managesClients: false })).toEqual({
      now: [
        'Acknowledge and resolve incidents on every site',
        'Mark client updates on every site',
        'Schedule maintenance and mute any site',
        'Send client reports and edit the AM note',
        'Approve incident reviews',
        'Edit sites, monitors and escalation',
        'Manage users and roles',
      ],
      noLonger: [],
      keep: 'The dashboard and history, alerts and digests, uptime reports',
    });
  });

  it('Stakeholder → Viewer', () => {
    expect(roleDiff('stakeholder', 'viewer', { managesClients: true })).toEqual({
      now: [],
      noLonger: [
        'Receive alerts and digests',
        'Mark client updates for clients where you’re Site AM',
        'Download uptime reports',
        'Send client reports for clients where you’re Site AM',
      ],
      keep: 'The dashboard and history',
    });
  });

  it.each(STAFF.flatMap((a) => STAFF.filter((b) => b !== a).map((b) => [a, b] as const)))(
    '%s → %s: every changed row has words, and the dialog names the same rows',
    (from, to) => {
      for (const managesClients of [true, false]) {
        const d = roleDiff(from, to, { managesClients });
        expect(d.now.length + d.noLonger.length).toBeGreaterThan(0);
        expect(d.keep).toMatch(/^The dashboard and history/);
        const { gains, loses } = gainsLoses(from, to);
        expect(gains).toHaveLength(d.now.length);
        expect(loses).toHaveLength(d.noLonger.length);
      }
    },
  );

  it('the same role changes nothing', () => {
    expect(roleDiff('viewer', 'viewer', { managesClients: false })).toEqual({
      now: [],
      noLonger: [],
      keep: 'The dashboard and history',
    });
    expect(gainsLoses('viewer', 'viewer')).toEqual({ gains: [], loses: [] });
  });
});

describe('gainsLoses — the Users dialog', () => {
  it('Responder → Stakeholder now names the client-update row (D-062 item 13)', () => {
    expect(gainsLoses('responder', 'stakeholder').loses).toEqual([
      'Acknowledge and resolve incidents',
      'Mark client update / Not needed outside own clients',
      'Maintenance windows and mute',
    ]);
  });
});
