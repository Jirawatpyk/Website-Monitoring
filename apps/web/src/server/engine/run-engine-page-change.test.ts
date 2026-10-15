// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { fakeDb as baseFakeDb } from '../../../test/fake-db';
import { runEngine } from './run-engine';

// S09d (D-046): the home page fingerprint against its baseline, behind PAGE_CHANGE_ALERTS.
const now = new Date('2026-10-06T10:01:05Z');
const at = (sec: number) => new Date(Date.parse('2026-10-06T10:00:00Z') + sec * 1000).toISOString();
const beating = [
  { code: 'SIN', last_heartbeat_at: '2026-10-06T10:00:50Z' },
  { code: 'TYO', last_heartbeat_at: '2026-10-06T10:00:30Z' },
];
const monitor = {
  id: 'm1',
  url: 'https://tubtong.example.test/',
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
  final_url: 'https://tubtong.example.test/',
  keyword_missing: [],
  keyword_forbidden: [],
});
const BASE = { title: 'Tubtong', scripts: ['static-cdn.example'], links: ['tubtong.example.test'] };
const INJECTED = { ...BASE, scripts: ['static-cdn.example', 'evil-cdn.example'] };
const pageRow = (over: Record<string, unknown> = {}) => ({
  monitor_id: 'm1',
  baseline_hash: 'h-base',
  baseline: BASE,
  pending_until: null,
  first_set_at: '2026-09-01T00:00:00Z', // recording over
  latest_at: at(-60),
  latest_usable: true,
  facts: [{ id: 'c9', checked_at: at(-60), hash: 'h-evil', fingerprint: INJECTED }],
  ...over,
});
const setup = (page: unknown[]) =>
  baseFakeDb({
    'probe_locations.select': { data: beating },
    'monitors.select': { data: [monitor] },
    'rpc.engine_checks': { data: [pass('SIN', 0), pass('TYO', 1)] },
    'rpc.engine_page_fingerprints': { data: page },
    'rpc.engine_open_incident': { data: 'i1' },
  });
const opened = (rpcCalls: { name: string; args: unknown }[]) =>
  rpcCalls.find((c) => c.name === 'engine_open_incident')?.args as
    { p_trigger: string; p_context: { cause: string; summary: string; detail: unknown } } | undefined;

describe('runEngine — page-change alerts on (staging)', () => {
  it('an injected script opens PROBLEM · Page change with the §26.9 cause', async () => {
    const { db, rpcCalls, readCalls } = setup([pageRow()]);
    expect(await runEngine(db, now, { pageChangeAlerts: true })).toMatchObject({ problems: 1 });
    expect(readCalls.find((c) => c.name === 'engine_page_fingerprints')?.args).toEqual({
      p_now: '2026-10-06T10:01:05.000Z',
      p_since: '2026-10-05T10:01:05.000Z',
    });
    expect(opened(rpcCalls)).toMatchObject({
      p_trigger: 'content_change',
      p_context: {
        cause: '/ · new script domain evil-cdn.example',
        summary: 'new script domain evil-cdn.example',
        detail: { kind: 'content_change', newScriptDomains: ['evil-cdn.example'], checkId: 'c9' },
      },
    });
  });

  it('a page that matches opens nothing', async () => {
    const { db, rpcCalls } = setup([
      pageRow({
        baseline: null,
        facts: [{ id: 'c9', checked_at: at(-60), hash: 'h-base', fingerprint: null }],
      }),
    ]);
    expect(await runEngine(db, now, { pageChangeAlerts: true })).toMatchObject({ problems: 0 });
    expect(opened(rpcCalls)).toBeUndefined();
  });

  it('a site still in its 14-day recording logs it and opens nothing', async () => {
    const { db, rpcCalls } = setup([pageRow({ first_set_at: '2026-10-01T00:00:00Z' })]);
    const summary = await runEngine(db, now, { pageChangeAlerts: true });
    expect(opened(rpcCalls)).toBeUndefined();
    expect(summary.pageChangeHeld).toEqual(['Tubtong · new script domain evil-cdn.example · recording']);
  });

  it('a failed read never holds the run back', async () => {
    const { db } = baseFakeDb({
      'probe_locations.select': { data: beating },
      'monitors.select': { data: [monitor] },
      'rpc.engine_checks': { data: [pass('SIN', 0), pass('TYO', 1)] },
      'rpc.engine_page_fingerprints': { error: { message: 'down' } },
    });
    expect(await runEngine(db, now, { pageChangeAlerts: true })).toMatchObject({ ok: true, problems: 0 });
  });
});

describe('runEngine — page-change alerts off (production until Done-when 3)', () => {
  it('logs what would alert, opens nothing', async () => {
    const { db, rpcCalls } = setup([pageRow()]);
    const summary = await runEngine(db, now);
    expect(summary).toMatchObject({ problems: 0, opened: 0 });
    expect(opened(rpcCalls)).toBeUndefined();
    expect(summary.pageChangeHeld).toEqual(['Tubtong · new script domain evil-cdn.example']);
  });

  it('a change still waiting for its 3rd fetch isn’t logged; once it holds it is', async () => {
    const titled = { ...BASE, title: 'Tubtong | สล็อตออนไลน์' };
    const fact = (id: string, sec: number) => ({ id, checked_at: at(sec), hash: 'h-t', fingerprint: titled });
    const waiting = setup([pageRow({ facts: [fact('c3', -60), fact('c2', -1860)] })]);
    expect((await runEngine(waiting.db, now)).pageChangeHeld).toBeUndefined();
    const holding = setup([pageRow({ facts: [fact('c3', -60), fact('c2', -1860), fact('c1', -3660)] })]);
    expect((await runEngine(holding.db, now)).pageChangeHeld).toEqual(['Tubtong · title (held 3)']);
  });
});
