// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { fakeDb, type FakeCall } from '../../../test/fake-db';
import { bangkokDate, isBangkokMonday, runReports } from './run-reports';

// Mon 28 Sep 2026 09:00 Bangkok. Sample data as test data only.
const NOW = new Date('2026-09-28T02:00:00Z');
const iso = (s: string) => new Date(`${s}+07:00`).toISOString();
const ARM = { display_name: 'Arm', google_chat_user_id: '222' };

const sites = [
  {
    id: 's-muvmi',
    name: 'MuvMi',
    tier: 1,
    is_active: true,
    muted_until: iso('2026-09-28T18:00:00'),
    mute_reason: 'redeploying build',
    monitoring_started_at: iso('2026-09-01T00:00:00'),
    created_at: iso('2026-09-01T00:00:00'),
    site_status: { status: 'down', note: null },
  },
  {
    id: 's-tubtong',
    name: 'Tubtong',
    tier: 2,
    is_active: true,
    muted_until: null,
    mute_reason: null,
    monitoring_started_at: null,
    created_at: iso('2026-09-01T00:00:00'),
    site_status: { status: 'ok', note: 'Automated check blocked by bot protection; verified via browser' },
  },
];

const incident = (over: Record<string, unknown>) => ({
  number: 142,
  state: 'acknowledged',
  severity: 'down',
  trigger: 'hard_fail',
  started_at: iso('2026-09-28T08:40:00'),
  resolved_at: null,
  detected_at: iso('2026-09-28T08:41:00'),
  acked_at: iso('2026-09-28T08:45:00'),
  is_manual: false,
  escalation_level: 1,
  client_updated_at: null,
  client_update_not_needed: null,
  root_cause_category: null,
  root_cause: null,
  root_cause_fix: null,
  sites: { id: 's-muvmi', name: 'MuvMi', tier: 1, is_active: true, owner: ARM },
  acker: { display_name: 'Arm' },
  updater: null,
  incident_events: [
    { type: 'detected', at: iso('2026-09-28T08:41:00'), payload: { cause: 'HTTP 503 (BKK, SIN)' } },
  ],
  ...over,
});

const incidents = [
  incident({}),
  // Last week, resolved with a root cause: listed with its words, not under Needs someone.
  incident({
    number: 139,
    state: 'resolved',
    severity: 'problem',
    trigger: 'blocked_unverified',
    started_at: iso('2026-09-24T14:02:00'),
    resolved_at: iso('2026-09-24T15:00:00'),
    detected_at: iso('2026-09-24T14:03:00'),
    acked_at: null,
    escalation_level: 0,
    root_cause_category: 'third_party',
    root_cause_fix: 'verifier restarted',
    sites: { id: 's-tubtong', name: 'Tubtong', tier: 2, is_active: true, owner: ARM },
    acker: null,
    incident_events: [
      { type: 'detected', at: iso('2026-09-24T14:03:00'), payload: { summary: 'Blocked, not verified' } },
      { type: 'recovered', at: iso('2026-09-24T14:14:00'), payload: {} },
    ],
  }),
];

const windowRow = {
  site_id: 's-tubtong',
  kind: 'maintenance',
  starts_at: iso('2026-09-28T10:00:00'),
  ends_at: iso('2026-09-28T12:00:00'),
  ended_at: null,
  cancelled_at: null,
  approved_at: iso('2026-09-27T10:00:00'),
  outcome: null,
  reason: 'plugin updates',
  sites: { name: 'Tubtong' },
  creator: { display_name: 'Ploy' },
};

const has = (c: FakeCall, method: string, col: string) =>
  c.filters.some(([m, k]) => m === method && k === col);

function db(over: Record<string, unknown> = {}) {
  return fakeDb({
    'sites.select': { data: sites },
    'incidents.select': (c) =>
      // The open-DOWN read (Needs someone) filters on state; the period reads on started_at.
      has(c, 'in', 'state') ? { data: [] } : { data: incidents },
    'maintenance_windows.select': (c) =>
      has(c, 'is', 'approved_at')
        ? {
            data: [
              {
                starts_at: iso('2026-10-01T01:00:00'),
                ends_at: iso('2026-10-02T03:00:00'),
                sites: { name: 'VOCA' },
              },
            ],
          }
        : { data: [windowRow] },
    'system_alerts.select': {
      data: [
        {
          opened_at: iso('2026-09-25T03:15:00'),
          cleared_at: iso('2026-09-25T03:16:00'),
          context: { location: 'SIN', lastBeatAt: iso('2026-09-25T03:12:00') },
        },
      ],
    },
    'probe_locations.select': {
      data: [
        { code: 'BKK', is_active: true },
        { code: 'SIN', is_active: true },
        { code: 'TYO', is_active: true },
      ],
    },
    'profiles.select': (c) =>
      has(c, 'eq', 'role') && c.filters.some(([, , v]) => v === 'stakeholder')
        ? { data: [{ id: 'u-ceo' }, { id: 'u-bua' }] }
        : { data: [{ id: 'u-tao', display_name: 'Tao', google_chat_user_id: '111' }] },
    'clients.select': { data: [{ am_user_id: 'u-bua' }] },
    'rpc.engine_sweep_gaps': {
      data: [
        {
          first_minute: iso('2026-09-01T00:00:00'),
          gap_start: iso('2026-09-26T02:17:00'),
          gap_end: iso('2026-09-26T02:43:00'),
        },
      ],
    },
    'escalation_policies.select': {
      data: [
        {
          tier: 1,
          severity: 'down',
          escalation_steps: [
            { level: 0, delay_min: 0 },
            { level: 1, delay_min: 15 },
          ],
        },
        { tier: 2, severity: 'down', escalation_steps: [{ level: 0, delay_min: 0 }] },
      ],
    },
    'oncall_swaps.select': {
      data: [
        {
          status: 'waiting',
          requester: { display_name: 'Arm' },
          counterpart: { display_name: 'Nok', google_chat_user_id: null },
          rq: { starts_at: '2026-10-05T02:00:00+00:00', ends_at: '2026-10-12T02:00:00+00:00' },
        },
      ],
    },
    'oncall_shifts.select': {
      data: [
        {
          starts_at: '2026-09-28T02:00:00+00:00',
          ends_at: '2026-10-05T02:00:00+00:00',
          person: { display_name: 'Nok' },
        },
        {
          starts_at: '2026-10-05T02:00:00+00:00',
          ends_at: '2026-10-12T02:00:00+00:00',
          person: { display_name: 'Arm' },
        },
      ],
    },
    'rpc.queue_report': { data: 'r1' },
    'rpc.claim_notifications': { data: [] },
    ...over,
  } as Parameters<typeof fakeDb>[0]);
}

const deps = (d: ReturnType<typeof db>, over: Record<string, unknown> = {}) => ({
  db: d.db,
  webhookUrl: 'https://chat.example.test/alerts',
  reportsWebhookUrl: 'https://chat.example.test/reports',
  email: { apiKey: 're_test', from: 'DxT Monitor <alerts@notify.example.test>' },
  appUrl: 'https://monitor.example.test',
  ...over,
});

type Queued = {
  p_kind: string;
  p_period_start: string;
  p_chat: { text: string; cardsV2: unknown[] };
  p_email: { subject: string } | null;
  p_recipients: string[] | null;
};
const queued = (d: ReturnType<typeof db>) =>
  d.rpcCalls.filter((c) => c.name === 'queue_report').map((c) => c.args as Queued);

describe('runReports (S14, D-056)', () => {
  it('on a Monday queues the digest and the weekly summary for the week before, emailing the CEO', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const d = db();
    const r = await runReports(deps(d), NOW);
    expect(r).toMatchObject({ ok: true, daily: 'queued', weekly: 'queued' });
    const [daily, weekly] = queued(d);

    expect(daily).toMatchObject({ p_kind: 'daily', p_period_start: '2026-09-28', p_email: null });
    expect(daily!.p_chat.text).toBe('Website status Mon 28 Sep 09:00 · 1/2 OK · 1 DOWN · 1 muted');
    const card = JSON.stringify(daily!.p_chat.cardsV2);
    expect(card).toContain('MuvMi — since 08:40 · 503 ×2 · INC-0142');
    expect(card).toContain('Tubtong — bots blocked, page verified');
    expect(card).toContain('Tubtong — Planned today 10:00–12:00 · plugin updates · not counted');

    expect(weekly).toMatchObject({ p_kind: 'weekly', p_period_start: '2026-09-21', p_recipients: ['u-ceo'] });
    expect(weekly!.p_email!.subject).toBe('DxT Monitor · Weekly summary · 21–27 Sep');
    expect(weekly!.p_chat.text).toMatch(
      // MuvMi's DOWN began Mon 28 Sep, after the week: no downtime in it. Tao: the request's Admin.
      /^Website week 21–27 Sep · 2\/2 sites had no downtime · follow-ups: <users\/111>$/,
    );
    const week = JSON.stringify(weekly!.p_chat.cardsV2);
    expect(week).toContain('Tubtong · Thu 24 Sep 14:02 · Blocked, not verified · verifier restarted');
    expect(week).toContain(
      'Maintenance request · VOCA · Thu 1 Oct 01:00 → Fri 2 Oct 03:00 — waiting for an Admin',
    );
    expect(week).toContain('On-call swap Mon 5 → 12 Oct — Arm asked, not accepted yet');
    expect(week).toContain('Next: Arm, 5 → 12 Oct — swap with Nok asked, not accepted yet.');
    expect(week).toContain('Tier 1 — (no DOWN) · Tier 2 — (no DOWN inside response hours)');
    expect(week).toContain('1 probe gap Fri 25 Sep 03:12–03:16 (SIN) — BKK and TYO still decided status');
    expect(week).toContain('1 gap Sat 26 Sep 02:17–02:43 (26 min)');
    expect(week).toContain('Only 1 active Admin (Tao)');
  });

  it('another day queues the digest only; a period queued already says so', async () => {
    const d = db({ 'rpc.queue_report': { data: null } });
    const r = await runReports(deps(d), new Date('2026-09-29T02:00:00Z'));
    expect(r).toMatchObject({ ok: true, daily: 'already_queued', weekly: 'not_monday' });
    expect(queued(d).map((q) => q.p_kind)).toEqual(['daily']);
  });

  it('without email the weekly summary queues no email', async () => {
    const d = db();
    await runReports(deps(d, { email: undefined }), NOW);
    expect(queued(d)[1]).toMatchObject({ p_email: null, p_recipients: [] });
  });

  it('a read that fails fails the run (the Healthchecks check then alarms)', async () => {
    const d = db({ 'sites.select': { error: { message: 'boom' } } });
    await expect(runReports(deps(d), NOW)).rejects.toThrow('sites: boom');
    const q = db({ 'rpc.queue_report': { error: { message: 'nope' } } });
    await expect(runReports(deps(q), NOW)).rejects.toThrow('queue_report daily: nope');
  });

  it('refuses without a Reports Space webhook', async () => {
    expect(await runReports(deps(db(), { reportsWebhookUrl: undefined }), NOW)).toEqual({
      ok: false,
      reason: 'no_reports_webhook',
    });
  });

  it('Bangkok dates and Mondays', () => {
    expect(bangkokDate(new Date('2026-09-27T17:30:00Z'))).toBe('2026-09-28');
    expect(isBangkokMonday(new Date('2026-09-27T17:30:00Z'))).toBe(true);
    expect(isBangkokMonday(new Date('2026-09-27T16:30:00Z'))).toBe(false);
  });
});
