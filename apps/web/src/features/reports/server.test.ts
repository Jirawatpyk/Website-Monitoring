// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { fakeDb, type FakeCall } from '../../../test/fake-db';
import { runReportDrafts } from './drafts';
import type { ReportFigures } from './figures';
import { monthKeyOf, monthLabel, pickMonth, previousMonth, reportMonths } from './month';
import { loadReportsPage } from './page-data';
import { PREVIEW_LIMIT, reportPdfHandler, takePreview } from './pdf-route';

// S20: the reads, the drafts cron, the page data and the PDF route over the fake client. Times UTC;
// now = Sun 22 Nov 2026 13:00 Bangkok, so the closed month is October.
const NOW = new Date('2026-11-22T06:00:00Z');
const CLIENT = '11111111-1111-4111-8111-111111111111';

const CLIENTS = [
  {
    id: CLIENT,
    name: 'Bangkok Airways',
    am: { display_name: 'Account Manager' },
    sites: [
      {
        id: 's1',
        name: 'BA Taiwan',
        tier: 1,
        is_active: true,
        monitoring_started_at: '2026-07-01T00:00:00Z',
        created_at: '2026-06-01T00:00:00Z',
      },
      // a Draft never started: no report
      {
        id: 's0',
        name: 'Never started',
        tier: 2,
        is_active: false,
        monitoring_started_at: null,
        created_at: '2026-06-01T00:00:00Z',
      },
      // set live by a script: counts from when it was added, as Site detail does
      {
        id: 's2',
        name: 'BA China',
        tier: 1,
        is_active: true,
        monitoring_started_at: null,
        created_at: '2026-06-01T00:00:00Z',
      },
    ],
  },
];
// one 11-minute DOWN on 3 Oct, root cause given
const INCIDENTS = [
  {
    id: 'i1',
    site_id: 's1',
    number: 4,
    severity: 'down',
    trigger: 'hard_fail',
    started_at: '2026-10-03T07:06:00Z',
    resolved_at: '2026-10-03T08:00:00Z',
    root_cause_category: 'hosting',
    root_cause: 'Hosting fault',
    incident_events: [
      { type: 'detected', at: '2026-10-03T07:06:00Z', payload: {} },
      { type: 'recovered', at: '2026-10-03T07:17:00Z', payload: {} },
    ],
  },
];

function db(extra: Record<string, unknown> = {}) {
  return fakeDb({
    'clients.select': { data: CLIENTS },
    'incidents.select': { data: INCIDENTS },
    'monitors.select': { data: [{ id: 'm1', site_id: 's1' }] },
    'check_rollups.select': { data: [{ monitor_id: 'm1', checks: 100, p50_ms: 400, p95_ms: 700 }] },
    'rpc.site_stopped_spans': { data: [] },
    'maintenance_windows.select': { data: [] },
    ...(extra as Record<string, { data?: unknown }>),
  });
}

const render = vi.fn(async () => Buffer.from('%PDF-fake'));

describe('month', () => {
  it('Bangkok months, the two offered, labels and the pick', () => {
    expect(monthKeyOf(new Date('2026-10-31T17:00:00Z'))).toBe('2026-11'); // 1 Nov 00:00 Bangkok
    expect(previousMonth('2026-01')).toBe('2025-12');
    expect(reportMonths(NOW)).toEqual({ closed: '2026-10', running: '2026-11' });
    expect(monthLabel('2026-10')).toBe('October 2026');
    expect(monthLabel('2026-10', { short: true })).toBe('Oct 2026');
    expect(pickMonth('2026-11', NOW)).toBe('2026-11');
    expect(pickMonth(['2026-11'], NOW)).toBe('2026-11');
    expect(pickMonth('2025-01', NOW)).toBe('2026-10');
    expect(pickMonth(undefined, NOW)).toBe('2026-10');
  });
});

describe('runReportDrafts (D-073 item 13)', () => {
  it('waits for 06:00 on the 1st', async () => {
    const f = db();
    const r = await runReportDrafts(f.db, new Date('2026-10-31T22:00:00Z'), render);
    expect(r).toMatchObject({ ok: true, month: '2026-10', clients: 0, made: 0 });
    expect(f.calls).toHaveLength(0);
  });

  it('makes a missing draft: the PDF into the bucket, the figures into client_reports', async () => {
    const f = db();
    const r = await runReportDrafts(f.db, NOW, render);
    expect(r).toMatchObject({ ok: true, month: '2026-10', clients: 1, made: 1, failed: 0 });
    expect(f.storageCalls[0]).toMatchObject({ bucket: 'client-reports', method: 'upload' });
    expect(f.storageCalls[0]!.args[0]).toBe(`${CLIENT}/2026-10.pdf`);
    const up = f.calls.find((c) => c.table === 'client_reports' && c.op === 'upsert')!;
    const row = up.values as { figures: ReportFigures; month: string; storage_path: string };
    expect(row.month).toBe('2026-10-01');
    expect(row.figures.downMinutes).toBe(11);
    expect(row.figures.sites.map((s) => s.name)).toEqual(['BA China', 'BA Taiwan']); // the Draft site is left out
  });

  it('leaves an unchanged draft alone and refreshes a changed one', async () => {
    const first = db();
    await runReportDrafts(first.db, NOW, render);
    const stored = (first.calls.find((c) => c.op === 'upsert')!.values as { figures: ReportFigures }).figures;
    const row = (figures: unknown) => ({
      data: [
        {
          client_id: CLIENT,
          generated_at: NOW.toISOString(),
          storage_path: `${CLIENT}/2026-10.pdf`,
          figures,
        },
      ],
    });

    const same = db({ 'client_reports.select': row({ ...stored, generatedAt: '2026-11-01T00:00:00.000Z' }) });
    expect(await runReportDrafts(same.db, NOW, render)).toMatchObject({
      unchanged: 1,
      made: 0,
      refreshed: 0,
    });

    const changed = db({ 'client_reports.select': row({ ...stored, downMinutes: 99 }) });
    expect(await runReportDrafts(changed.db, NOW, render)).toMatchObject({ refreshed: 1 });
  });

  it('one client failing is counted, never thrown', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const f = db({ 'storage.upload': { error: { message: 'full' } } });
    expect(await runReportDrafts(f.db, NOW, render)).toMatchObject({ ok: false, failed: 1 });
    const g = db({ 'client_reports.upsert': { error: { message: 'denied' } } });
    expect(await runReportDrafts(g.db, NOW, render)).toMatchObject({ ok: false, failed: 1 });
    error.mockRestore();
  });

  it('a failed read throws (the cron reports it)', async () => {
    const f = db({ 'clients.select': { error: { message: 'down' } } });
    await expect(runReportDrafts(f.db, NOW, render)).rejects.toThrow('clients: down');
  });
});

describe('loadReportsPage', () => {
  it('a closed month without a draft is worked out now: "Not drafted yet"', async () => {
    const page = await loadReportsPage(db().db, '2026-10', NOW);
    expect(page).toMatchObject({
      month: '2026-10',
      label: 'October 2026',
      running: false,
      closed: '2026-10',
    });
    expect(page.rows[0]).toMatchObject({
      client: 'Bangkok Airways',
      tier1: true,
      status: 'not_drafted',
      down: '11 min',
    });
    expect(page.tiles.map((t) => t.label)).toEqual(['Uptime · Oct 2026', 'Downtime', 'Incidents']);
    expect(page.tiles[2]!.caption).toBe('1 outage');
  });

  it('a stored draft is what the page shows; an unreadable one falls back to now', async () => {
    const first = db();
    await runReportDrafts(first.db, NOW, render);
    const stored = (first.calls.find((c) => c.op === 'upsert')!.values as { figures: ReportFigures }).figures;
    const row = (figures: unknown) => ({
      'client_reports.select': {
        data: [{ client_id: CLIENT, generated_at: NOW.toISOString(), storage_path: 'x', figures }],
      },
    });
    const draft = await loadReportsPage(db(row({ ...stored, downMinutes: 42 })).db, '2026-10', NOW);
    expect(draft.rows[0]).toMatchObject({ status: 'draft', down: '42 min' });
    const old = await loadReportsPage(db(row({ v: 0 })).db, '2026-10', NOW);
    expect(old.rows[0]).toMatchObject({ status: 'unreadable', down: '11 min' });
  });

  it('the running month says so; no client, no rows', async () => {
    const page = await loadReportsPage(db().db, '2026-11', NOW);
    expect(page).toMatchObject({ running: true, label: 'November 2026 (running)' });
    expect(page.tiles[0]!.label).toBe('Uptime · Nov so far');
    expect(page.rows[0]!.status).toBe('running');
    const none = await loadReportsPage(db({ 'clients.select': { data: [] } }).db, '2026-11', NOW);
    expect(none.rows).toEqual([]);
    expect(none.tiles[0]!.value).toBe('—');
  });
});

describe('GET /api/reports/[clientId]/[month]', () => {
  const active = (role: string) => async () =>
    ({
      status: 'active',
      profile: { id: `u-${role}-${Math.random()}`, email: 'x', displayName: 'X', role },
    }) as never;
  const ctx = (clientId: string, month: string) => ({ params: Promise.resolve({ clientId, month }) });
  const handler = (role: string, f = db(), service = db()) =>
    reportPdfHandler({
      access: active(role),
      userDb: async () => f.db,
      service: () => service.db,
      render,
      clock: () => NOW,
    });

  it('refuses the signed-out, the client role, a bad id or month, another month and an unknown client', async () => {
    const out = reportPdfHandler({ access: async () => ({ status: 'signed-out' }) as never });
    expect((await out(new Request('http://x'), ctx(CLIENT, '2026-10'))).status).toBe(401);
    expect((await handler('client')(new Request('http://x'), ctx(CLIENT, '2026-10'))).status).toBe(403);
    expect((await handler('viewer')(new Request('http://x'), ctx('nope', '2026-10'))).status).toBe(404);
    expect((await handler('viewer')(new Request('http://x'), ctx(CLIENT, '2026-13'))).status).toBe(404);
    expect((await handler('viewer')(new Request('http://x'), ctx(CLIENT, '2026-08'))).status).toBe(404);
    const none = db({ 'clients.select': { data: [] } });
    expect((await handler('viewer', none)(new Request('http://x'), ctx(CLIENT, '2026-10'))).status).toBe(404);
  });

  it('a closed month serves the stored file, only its own path, privately', async () => {
    const first = db();
    await runReportDrafts(first.db, NOW, render);
    const stored = (first.calls.find((c) => c.op === 'upsert')!.values as { figures: ReportFigures }).figures;
    const user = db({
      'client_reports.select': {
        data: [
          {
            client_id: CLIENT,
            generated_at: NOW.toISOString(),
            storage_path: `${CLIENT}/2026-10.pdf`,
            figures: stored,
          },
        ],
      },
    });
    const service = db({ 'storage.download': { data: new Blob(['%PDF-stored']) } });
    const res = await handler('viewer', user, service)(new Request('http://x'), ctx(CLIENT, '2026-10'));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('%PDF-stored');
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('content-disposition')).toContain(
      "filename*=UTF-8''RPT-2610-BA%20Bangkok%20Airways.pdf",
    );
    expect(service.storageCalls[0]).toMatchObject({
      bucket: 'client-reports',
      args: [`${CLIENT}/2026-10.pdf`],
    });
    // the client row was read with the person's own session filtered to the asked client
    expect(user.calls.find((c: FakeCall) => c.table === 'clients')!.filters).toContainEqual([
      'eq',
      'id',
      CLIENT,
    ]);

    // the row without its file: printed from the stored figures
    const missing = db({ 'storage.download': { data: null, error: { message: 'not found' } } });
    const again = await handler('admin', user, missing)(new Request('http://x'), ctx(CLIENT, '2026-10'));
    expect(await again.text()).toBe('%PDF-fake');
  });

  it('the running month is printed on demand, a few a minute per person', async () => {
    const res = await handler('responder')(new Request('http://x'), ctx(CLIENT, '2026-11'));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-disposition')).toContain('(preview)');
    const t = NOW.getTime();
    for (let i = 0; i < PREVIEW_LIMIT.count; i++) expect(takePreview('same', t)).toBe(true);
    expect(takePreview('same', t)).toBe(false);
    expect(takePreview('same', t + PREVIEW_LIMIT.windowMs)).toBe(true);
    for (let i = 0; i < PREVIEW_LIMIT.count; i++) takePreview('busy', t);
    const busy = reportPdfHandler({
      access: async () =>
        ({ status: 'active', profile: { id: 'busy', email: 'x', displayName: 'X', role: 'admin' } }) as never,
      userDb: async () => db().db,
      render,
      clock: () => NOW,
    });
    expect((await busy(new Request('http://x'), ctx(CLIENT, '2026-11'))).status).toBe(429);
  });
});
