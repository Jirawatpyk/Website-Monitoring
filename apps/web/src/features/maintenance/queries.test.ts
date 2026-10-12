// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { fakeDb } from '../../../test/fake-db';
import { loadWindowRows } from './queries';

// A mute holding an incident (§24.13, D-036): what End mute promises depends on L1's people and the
// response hours. Sample people are test data only.
const t = (hhmm: string) => `2026-10-12T${hhmm}:00Z`;
const plan = (l1: string[]) => ({
  severity: 'down',
  tier: 1,
  reminderMin: 15,
  steps: [
    { level: 0, delayMin: 0, targets: ['owner'], channels: ['chat', 'email'] },
    { level: 1, delayMin: 15, targets: l1, channels: ['chat', 'email'] },
  ],
});
const mute = (over: { tier?: number; backup?: string | null; l1?: string[] } = {}) => ({
  id: 'w1',
  site_id: 's1',
  kind: 'mute',
  starts_at: t('08:55'),
  ends_at: t('09:55'),
  approved_at: t('08:55'),
  approved_by: 'u-owner',
  ended_at: null,
  cancelled_at: null,
  created_at: t('08:55'),
  created_by: 'u-owner',
  reason: 'Verify',
  end_reason: null,
  outcome: null,
  outcome_detail: null,
  log: [],
  creator: { display_name: 'Owner' },
  sites: {
    name: 'Test target',
    tier: over.tier ?? 1,
    primary_owner_id: 'u-owner',
    backup_owner_id: over.backup === undefined ? null : over.backup,
    muted_until: t('09:55'),
    owner: { display_name: 'Owner', role: 'admin' },
    backup: null,
    site_status: [{ status: 'down' }],
    client: { am_user_id: null },
    incidents: [
      {
        number: 37,
        state: 'unacked',
        severity: 'down',
        episode_severity: 'down',
        detected_at: t('09:02'),
        alerted_at: null,
        escalation_plan: plan(over.l1 ?? ['backup', 'admins']),
      },
    ],
  },
});
// The owner is the only Admin, already told at L0.
const admins = { 'profiles.select': { data: [{ id: 'u-owner' }] } };

describe('loadWindowRows — the incident a mute holds (§24.13)', () => {
  it('L1 tells nobody new (no backup, the only Admin is the owner): no L1 time, no escalation', async () => {
    const { db } = fakeDb({ 'maintenance_windows.select': { data: [mute()] }, ...admins });
    const [row] = await loadWindowRows(db, new Date(t('09:05')));
    expect(row!.silenced).toMatchObject({
      number: 37,
      l1DelayMin: null,
      escalates: false,
      since: t('09:02'),
    });
  });

  it('L1 tells the backup: its delay (Tier 1) and escalation', async () => {
    const { db } = fakeDb({
      'maintenance_windows.select': { data: [mute({ backup: 'u-backup' })] },
      ...admins,
    });
    const [row] = await loadWindowRows(db, new Date(t('09:05')));
    expect(row!.silenced).toMatchObject({ l1DelayMin: 15, escalates: true, pausedUntil: null });
  });

  it('Tier 2–3 outside response hours: escalation starts at the opening', async () => {
    const { db } = fakeDb({
      'maintenance_windows.select': { data: [mute({ tier: 2, backup: 'u-backup' })] },
      ...admins,
      'organisation_settings.select': {
        data: { response_start: '09:00', response_end: '18:00', response_days: [1, 2, 3, 4, 5] },
      },
      'company_holidays.select': { data: [] },
    });
    // 12:00 UTC = 19:00 Bangkok, after hours: the next opening is Tue 13 Oct 09:00 (02:00 UTC).
    const [row] = await loadWindowRows(db, new Date(t('12:00')));
    expect(row!.silenced).toMatchObject({ escalates: true, pausedUntil: '2026-10-13T02:00:00.000Z' });
  });

  it('no mute holding an incident: no extra reads', async () => {
    const { db, calls } = fakeDb({
      'maintenance_windows.select': { data: [{ ...mute(), kind: 'maintenance' }] },
    });
    await loadWindowRows(db, new Date(t('09:05')));
    expect(calls.some((c) => c.table === 'profiles' || c.table === 'organisation_settings')).toBe(false);
  });
});
