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
