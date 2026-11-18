// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { fakeDb } from '../../../test/fake-db';
import { runEngine } from './run-engine';

// S13 (D-066): the runner hands each primary monitor its site's `site_expiry` read. Tubtong (Tier 1),
// Tue 6 Oct 17:01 Bangkok; the certificate expires Mon 12 Oct (6 days), read at 06:00.
const now = new Date('2026-10-06T10:01:05Z');
const at = (sec: number) => new Date(Date.parse('2026-10-06T10:00:00Z') + sec * 1000).toISOString();
const beating = [
  { code: 'SIN', last_heartbeat_at: '2026-10-06T10:00:50Z' },
  { code: 'TYO', last_heartbeat_at: '2026-10-06T10:00:30Z' },
];
const monitor = {
  id: 'm1',
  url: 'https://www.tubtong.example.test/',
  is_primary: true,
  must_contain: [],
  must_not_contain: [],
  timeout_ms: 10_000,
  thresholds: {},
  allowed_redirect_domains: [],
  site_id: 's1',
  sites: { name: 'Tubtong', tier: 1, is_active: true, muted_until: null },
};
const pass = (location: string, sec: number) => ({
  monitor_id: 'm1',
  location,
  outcome: 'pass',
  checked_at: at(sec),
  attempt: 1,
  status_code: 200,
  error: null,
  final_url: 'https://www.tubtong.example.test/',
  keyword_missing: [],
  keyword_forbidden: [],
});
const row = (over: Record<string, unknown> = {}) => ({
  site_id: 's1',
  host: 'www.tubtong.example.test',
  ssl_expires_at: '2026-10-12T05:00:00Z',
  ssl_read_at: '2026-10-05T23:00:00Z',
  ssl_error: null,
  domain_expires_at: '2027-04-28T01:48:35Z',
  domain_read_at: '2026-10-05T23:00:00Z',
  domain_error: null,
  ...over,
});
const setup = (expiry: { data?: unknown; error?: { message: string } }) =>
  fakeDb({
    'probe_locations.select': { data: beating },
    'monitors.select': { data: [monitor] },
    'rpc.engine_checks': { data: [pass('SIN', 0), pass('TYO', 1)] },
    'site_expiry.select': expiry,
    'rpc.engine_open_incident': { data: 'i1' },
  });
const opened = (rpcCalls: { name: string; args: unknown }[]) =>
  rpcCalls.find((c) => c.name === 'engine_open_incident')?.args as
    { p_trigger: string; p_context: { cause: string; summary: string } } | undefined;

describe('runEngine — SSL / domain expiry (D-066)', () => {
  it('a certificate 6 days out opens PROBLEM (SSL expiring) with its cause', async () => {
    const { db, rpcCalls } = setup({ data: [row()] });
    expect(await runEngine(db, now)).toMatchObject({ problems: 1 });
    expect(opened(rpcCalls)).toMatchObject({
      p_trigger: 'ssl',
      p_context: {
        cause: 'SSL certificate expires in 6 days (Mon 12 Oct)',
        summary: 'SSL certificate expires in 6 days',
      },
    });
  });

  it('on a Tier 1 site at night nothing opens: an expiry raises a PROBLEM inside response hours only (D-067 item 1)', async () => {
    const night = new Date('2026-10-06T16:01:05Z'); // Tue 23:01 Bangkok
    const at2 = (sec: number) => new Date(Date.parse('2026-10-06T16:00:00Z') + sec * 1000).toISOString();
    const { db, rpcCalls } = fakeDb({
      'probe_locations.select': {
        data: [
          { code: 'SIN', last_heartbeat_at: '2026-10-06T16:00:50Z' },
          { code: 'TYO', last_heartbeat_at: '2026-10-06T16:00:30Z' },
        ],
      },
      'monitors.select': { data: [monitor] },
      'rpc.engine_checks': {
        data: [
          { ...pass('SIN', 0), checked_at: at2(0) },
          { ...pass('TYO', 1), checked_at: at2(1) },
        ],
      },
      'site_expiry.select': { data: [row()] },
      'rpc.engine_open_incident': { data: 'i1' },
    });
    expect(await runEngine(db, night)).toMatchObject({ problems: 0 });
    expect(rpcCalls.find((c) => c.name === 'engine_open_incident')).toBeUndefined();
  });

  const forbidden = (location: string, sec: number) => ({
    ...pass(location, sec),
    keyword_forbidden: ['Index of /'],
  });
  /** Tubtong open for an SSL (or, `trigger`, another) PROBLEM, acknowledged, its card sent. */
  const openDb = (
    o: {
      checks?: unknown[];
      trigger?: string;
      mutedUntil?: string | null;
      leftExpiry?: boolean;
      tier?: number;
      rpc?: Record<string, unknown>;
    } = {},
  ) =>
    fakeDb({
      'probe_locations.select': { data: beating },
      'monitors.select': {
        data: [
          {
            ...monitor,
            must_not_contain: ['Index of /'],
            sites: { ...monitor.sites, tier: o.tier ?? 1, muted_until: o.mutedUntil ?? null },
          },
        ],
      },
      'rpc.engine_checks': { data: o.checks ?? [forbidden('SIN', 0), forbidden('TYO', 1)] },
      'site_expiry.select': { data: [row()] },
      'rpc.engine_monitor_status': {
        data: [
          {
            monitor_id: 'm1',
            status: 'problem',
            trigger: o.trigger ?? 'ssl',
            cause: 'x',
            slow_rounds: 0,
            failing_since: {},
          },
        ],
      },
      'incidents.select': {
        data: [
          {
            id: 'i1',
            site_id: 's1',
            monitor_id: 'm1',
            state: 'acknowledged',
            severity: 'problem',
            trigger: o.trigger ?? 'ssl',
            episode_severity: 'problem',
            started_at: '2026-10-06T00:00:00Z',
            detected_at: '2026-10-06T00:00:00Z',
            acked_at: '2026-10-06T02:00:00Z',
            recovered_at: null,
            escalation_level: 0,
            is_flapping: false,
            is_manual: false,
            manual_at: null,
            root_cause_category: null,
            expiry_left: o.leftExpiry ?? false,
            notifications: [{ template: 'problem' }],
          },
        ],
      },
      'rpc.engine_new_cause_incident': { data: true },
      ...o.rpc,
    });

  it('a forbidden word on a site open for SSL expiring posts the new cause (D-067)', async () => {
    const { db, rpcCalls } = openDb();
    expect(await runEngine(db, now)).toMatchObject({ newCauses: 1 });
    expect(rpcCalls.find((c) => c.name === 'engine_new_cause_incident')?.args).toMatchObject({
      p_incident_id: 'i1',
      p_trigger: 'keyword',
      p_notify: true,
      p_context: { cause: 'Found “Index of /” on / (SIN, TYO)' },
      // 17:01 Bangkok on a Tuesday: inside hours, L0 stays (at night the SQL names the person on call).
      p_outside_hours: false,
    });
  });

  it('during a mute the new cause waits: the round is recorded, the cause kept for after it (D-067 item 5)', async () => {
    const { db, rpcCalls } = openDb({ mutedUntil: '2026-10-06T10:30:00Z' });
    await runEngine(db, now);
    expect(rpcCalls.find((c) => c.name === 'engine_new_cause_incident')).toBeUndefined();
    expect(rpcCalls.find((c) => c.name === 'engine_record_round')?.args).toMatchObject({
      p_site_id: 's1',
      p_ok_rounds: 0,
    });
  });

  it('the keyword cleared with the certificate still 6 days out: back to SSL, silently (D-067 item 4)', async () => {
    const { db, rpcCalls } = openDb({
      trigger: 'keyword',
      leftExpiry: true,
      checks: [pass('SIN', 0), pass('TYO', 1)],
      rpc: {
        'rpc.engine_cause_back_incident': { data: true },
      },
    });
    expect(await runEngine(db, now)).toMatchObject({ causesBack: 1 });
    expect(rpcCalls.find((c) => c.name === 'engine_cause_back_incident')?.args).toMatchObject({
      p_incident_id: 'i1',
      p_trigger: 'ssl',
      p_context: { detail: { kind: 'ssl', daysLeft: 6 } },
    });
    expect(rpcCalls.find((c) => c.name === 'engine_new_cause_incident')).toBeUndefined();
  });

  it('a keyword incident that never came from SSL recovers instead of turning into SSL (engine re-review H3)', async () => {
    const { db, rpcCalls } = openDb({
      trigger: 'keyword',
      checks: [pass('SIN', 0), pass('TYO', 1)],
      rpc: {
        'rpc.engine_recover_incident': { data: true },
      },
    });
    await runEngine(db, now);
    expect(rpcCalls.find((c) => c.name === 'engine_cause_back_incident')).toBeUndefined();
    expect(rpcCalls.find((c) => c.name === 'engine_recover_incident')).toBeDefined();
  });

  it('inside a maintenance window the new cause on an SSL incident is recorded as Maintenance, not posted (D-067 item 3, engine re-review H2)', async () => {
    const { db, rpcCalls } = openDb({
      rpc: {
        'maintenance_windows.select': {
          data: [
            {
              site_id: 's1',
              kind: 'maintenance',
              starts_at: '2026-10-06T09:30:00Z',
              ends_at: '2026-10-06T11:00:00Z',
              approved_at: '2026-10-06T08:00:00Z',
              ended_at: null,
              cancelled_at: null,
            },
          ],
        },
      },
    });
    await runEngine(db, now);
    expect(rpcCalls.find((c) => c.name === 'engine_new_cause_incident')).toBeUndefined();
    expect(rpcCalls.find((c) => c.name === 'engine_record_round')?.args).toMatchObject({
      p_status: 'maintenance',
    });
  });

  it('a row read from another host (the primary moved) is no data', async () => {
    const { db, rpcCalls } = setup({ data: [row({ host: 'old.tubtong.example.test' })] });
    expect(await runEngine(db, now)).toMatchObject({ problems: 0 });
    expect(opened(rpcCalls)).toBeUndefined();
  });

  it('a failed read (the table not there yet: a deploy ahead of migrate-production) never holds the run back', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { db } = setup({ error: { message: 'relation not found' } });
    expect(await runEngine(db, now)).toMatchObject({ ok: true, problems: 0 });
    expect(error).toHaveBeenCalledWith(expect.stringContaining('engine_site_expiry_failed'));
    error.mockRestore();
  });
});
