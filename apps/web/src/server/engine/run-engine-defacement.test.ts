// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { fakeDb as baseFakeDb } from '../../../test/fake-db';
import { runEngine } from './run-engine';

// S09c (D-041, D-042): the shared forbidden list and the crawler views, behind DEFACEMENT_ALERTS.
const now = new Date('2026-10-06T10:01:05Z');
const at = (sec: number) => new Date(Date.parse('2026-10-06T10:00:00Z') + sec * 1000).toISOString();
const beating = [
  { code: 'SIN', last_heartbeat_at: '2026-10-06T10:00:50Z' },
  { code: 'TYO', last_heartbeat_at: '2026-10-06T10:00:30Z' },
];
const monitor = {
  id: 'm1',
  url: 'https://tubtong.example.test',
  is_primary: true,
  must_contain: [],
  must_not_contain: ['Index of /'],
  timeout_ms: 10_000,
  thresholds: {},
  allowed_redirect_domains: [],
  site_id: 's1',
  sites: { name: 'Tubtong', tier: 1, is_active: true, muted_until: null },
};
const pass = (location: string, sec: number, forbidden: string[] = []) => ({
  monitor_id: 'm1',
  location,
  outcome: 'pass',
  checked_at: at(sec),
  attempt: 1,
  status_code: 200,
  error: null,
  final_url: 'https://tubtong.example.test/',
  keyword_missing: [],
  keyword_forbidden: forbidden,
});
const googlebotHit = {
  monitor_id: 'm1',
  view: 'googlebot',
  checked_at: at(-120), // stored a minute ago: inside the 5-min log window,
  final_url: 'https://tubtong.example.test/',
  forbidden: ['บาคาร่า'],
};

const setup = (checks: unknown[], crawler: unknown[] = []) =>
  baseFakeDb({
    'probe_locations.select': { data: beating },
    'monitors.select': { data: [monitor] },
    'rpc.engine_checks': { data: checks },
    'rpc.engine_crawler_checks': { data: crawler.length ? [{ monitor_id: 'm1', facts: crawler }] : [] },
    'rpc.engine_open_incident': { data: 'i1' },
  });
const opened = (rpcCalls: { name: string; args: unknown }[]) =>
  rpcCalls.find((c) => c.name === 'engine_open_incident')?.args as
    { p_trigger: string; p_context: { cause: string; summary: string; detail: unknown } } | undefined;

describe('runEngine — defacement alerts on (staging)', () => {
  it('a phrase only Googlebot was served opens PROBLEM (Keyword) "(as Googlebot)"', async () => {
    const { db, rpcCalls, readCalls } = setup([pass('SIN', 0), pass('TYO', 1)], [googlebotHit]);
    expect(await runEngine(db, now, { defacementAlerts: true })).toMatchObject({ problems: 1 });
    expect(readCalls.find((c) => c.name === 'engine_crawler_checks')?.args).toEqual({
      p_since: '2026-10-05T10:01:05.000Z', // a day back: an unrefuted hit holds (the engine judges freshness)
    });
    expect(opened(rpcCalls)).toMatchObject({
      p_trigger: 'keyword',
      p_context: {
        cause: 'Found “บาคาร่า” on / (as Googlebot)',
        summary: '“บาคาร่า” found on the page (as Googlebot)',
        detail: { kind: 'keyword', view: 'googlebot', forbidden: ['บาคาร่า'] },
      },
    });
  });

  it('a shared-list phrase at both locations opens PROBLEM (Keyword) like any forbidden word', async () => {
    const { db, rpcCalls } = setup([pass('SIN', 0, ['สล็อตออนไลน์']), pass('TYO', 1, ['สล็อตออนไลน์'])]);
    await runEngine(db, now, { defacementAlerts: true });
    expect(opened(rpcCalls)?.p_context.cause).toBe('Found “สล็อตออนไลน์” on / (SIN, TYO)');
  });

  it('a crawler read that fails never holds the run back', async () => {
    const { db } = baseFakeDb({
      'probe_locations.select': { data: beating },
      'monitors.select': { data: [monitor] },
      'rpc.engine_checks': { data: [pass('SIN', 0), pass('TYO', 1)] },
      'rpc.engine_crawler_checks': { error: { message: 'down' } },
    });
    expect(await runEngine(db, now, { defacementAlerts: true })).toMatchObject({ ok: true, problems: 0 });
  });
});

describe('runEngine — defacement alerts off (production until Done-when 3)', () => {
  it('logs shared-list and crawler findings, opens nothing', async () => {
    const { db, rpcCalls } = setup(
      [pass('SIN', 0, ['สล็อตออนไลน์']), pass('TYO', 1, ['สล็อตออนไลน์'])],
      [
        googlebotHit,
        { ...googlebotHit, view: 'google_referer', forbidden: [], final_url: 'https://casino.example.net/' },
      ],
    );
    const summary = await runEngine(db, now);
    expect(summary).toMatchObject({ problems: 0, opened: 0 });
    expect(opened(rpcCalls)).toBeUndefined();
    expect(summary.defacementHeld).toEqual([
      'Tubtong · “สล็อตออนไลน์” (SIN, TYO)',
      'Tubtong · “บาคาร่า” (as Googlebot)',
    ]);
  });

  it('logs a redirect only the Google-search view saw', async () => {
    const { db } = setup(
      [pass('SIN', 0), pass('TYO', 1)],
      [{ ...googlebotHit, view: 'google_referer', forbidden: [], final_url: 'https://casino.example.net/' }],
    );
    expect((await runEngine(db, now)).defacementHeld).toEqual([
      'Tubtong · → casino.example.net (from Google search)',
    ]);
  });

  it('a site’s own forbidden word still alerts, even when it is also a list entry', async () => {
    const own = { ...monitor, must_not_contain: ['Index of /', 'บาคาร่า'] };
    const { db, rpcCalls } = baseFakeDb({
      'probe_locations.select': { data: beating },
      'monitors.select': { data: [own] },
      'rpc.engine_checks': { data: [pass('SIN', 0, ['บาคาร่า']), pass('TYO', 1, ['บาคาร่า'])] },
      'rpc.engine_open_incident': { data: 'i1' },
    });
    const summary = await runEngine(db, now);
    expect(opened(rpcCalls)?.p_context.cause).toBe('Found “บาคาร่า” on / (SIN, TYO)');
    expect(summary.defacementHeld).toBeUndefined();
  });

  it('keeps the own word and drops only the list entry when both were found', async () => {
    const { db, rpcCalls } = setup([
      pass('SIN', 0, ['Index of /', 'บาคาร่า']),
      pass('TYO', 1, ['Index of /', 'บาคาร่า']),
    ]);
    const summary = await runEngine(db, now);
    expect(opened(rpcCalls)?.p_context.cause).toBe('Found “Index of /” on / (SIN, TYO)');
    expect(summary.defacementHeld).toEqual(['Tubtong · “บาคาร่า” (SIN, TYO)']);
  });

  it('logs a crawler finding only in the runs just after its fetch, not for its whole window', async () => {
    const { db } = setup([pass('SIN', 0), pass('TYO', 1)], [{ ...googlebotHit, checked_at: at(-600) }]);
    expect('defacementHeld' in (await runEngine(db, now))).toBe(false);
  });

  it('a clean run adds no defacementHeld field', async () => {
    const { db } = setup([pass('SIN', 0), pass('TYO', 1)], [{ ...googlebotHit, forbidden: [] }]);
    expect('defacementHeld' in (await runEngine(db, now))).toBe(false);
  });
});
