import { describe, expect, it } from 'vitest';
import {
  countLabel,
  DEFAULT_FILTERS,
  desktopViewCounts,
  filterIncidents,
  hiddenNote,
  isUnackedDown,
  listKpis,
  nextLine,
  okTwoRoundsAt,
  phoneViewCounts,
  resolveGate,
  sortIncidents,
  timelineOf,
  triggerWords,
  type EventRow,
  type ListIncident,
} from './model';

// Spec §1: Fri 25 Sep 2026 10:07 (UTC+7).
const NOW = new Date('2026-09-25T03:07:00Z');
const at = (local: string) => new Date(`2026-09-${local}+07:00`).toISOString();

const base: ListIncident = {
  id: 'i142',
  number: 142,
  siteId: 's-muvmi',
  siteName: 'MuvMi',
  tier: 1,
  severity: 'down',
  trigger: 'hard_fail',
  state: 'unacked',
  escalationLevel: 0,
  startedAt: at('25T09:48:12'),
  downStartedAt: null,
  detectedAt: at('25T09:48:41'),
  ackedAt: null,
  ackedByName: null,
  recoveredAt: null,
  resolvedAt: null,
  autoResolved: false,
  isFlapping: false,
  isManual: false,
  ownerName: 'Arm',
  rootCauseCategory: null,
  rootCause: null,
  rootCauseFix: null,
};
const inc = (over: Partial<ListIncident>): ListIncident => ({ ...base, ...over });

// The Incidents board's sample, cut to what S07 has (no In review / Closed transitions yet).
const muvmi = inc({});
const fuji = inc({
  id: 'i141',
  number: 141,
  siteId: 's-fuji',
  siteName: 'Fuji Links',
  severity: 'problem',
  trigger: 'slow',
  state: 'acknowledged',
  startedAt: at('25T09:52:00'),
  detectedAt: at('25T09:52:30'),
  ackedAt: at('25T09:58:00'),
  ackedByName: 'Ploy',
  ownerName: 'Ploy',
});
const orca = inc({
  id: 'i139',
  number: 139,
  siteId: 's-orca',
  siteName: 'ORCA Thailand',
  tier: 2,
  state: 'needs_root_cause',
  startedAt: at('24T22:14:00'),
  detectedAt: at('24T22:14:30'),
  recoveredAt: at('24T22:22:00'),
  ownerName: 'Tao',
});
const tubtong = inc({
  id: 'i138',
  number: 138,
  siteId: 's-tubtong',
  siteName: 'Tubtong',
  severity: 'problem',
  trigger: 'blocked_unverified',
  state: 'resolved',
  startedAt: at('24T14:02:00'),
  detectedAt: at('24T14:02:00'),
  recoveredAt: at('24T14:14:00'),
  resolvedAt: at('24T14:30:00'),
  rootCauseCategory: 'false_alarm',
  rootCause: 'The verifier was stuck',
  rootCauseFix: 'Verifier restarted',
});
const wecare = inc({
  id: 'i129',
  number: 129,
  siteId: 's-wecare',
  siteName: 'WeCare Asia',
  severity: 'problem',
  trigger: 'keyword',
  state: 'resolved',
  startedAt: at('12T16:40:00'),
  detectedAt: at('12T16:40:00'),
  recoveredAt: at('12T17:02:00'),
  resolvedAt: at('12T17:10:00'),
  rootCauseCategory: 'deploy',
  rootCause: 'Broken deploy, rolled back',
});
const old = inc({
  id: 'i100',
  number: 100,
  siteId: 's-muvmi',
  state: 'resolved',
  startedAt: '2026-08-20T01:00:00.000Z',
  detectedAt: at('01T08:01:00'),
  recoveredAt: at('01T08:40:00'),
  resolvedAt: at('01T09:00:00'),
  rootCauseCategory: 'hosting',
  rootCause: 'Host moved the server',
});
const autoA = inc({
  id: 'a1',
  number: 150,
  siteId: 's-fuji',
  severity: 'problem',
  trigger: 'slow',
  state: 'resolved',
  autoResolved: true,
  startedAt: at('24T03:00:00'),
  detectedAt: at('24T03:00:00'),
  recoveredAt: at('24T03:03:00'),
  resolvedAt: at('24T03:03:00'),
});
const autoB = inc({ ...autoA, id: 'a2', number: 151, startedAt: at('20T03:00:00') });
const ALL = [tubtong, muvmi, wecare, orca, fuji, old, autoA, autoB];

describe('views and sort (Incidents, MIncidents, D-033)', () => {
  it('Needs action: open + Needs root cause, unacked DOWN first, then open, then root cause', () => {
    const { rows } = filterIncidents(ALL, DEFAULT_FILTERS, NOW);
    expect(rows.map((r) => r.number)).toEqual([142, 141, 139]);
  });
  it('Resolved & closed: done ones, newest first; auto-resolved hidden and counted', () => {
    const r = filterIncidents(ALL, { ...DEFAULT_FILTERS, view: 'done' }, NOW);
    expect(r.rows.map((x) => x.number)).toEqual([138, 129]);
    expect(r.hiddenAutoResolved).toBe(2);
  });
  it('the period: older than 30 days drops out unless still open', () => {
    const stillOpen = inc({ id: 'x', number: 90, startedAt: at('01T00:00:00'), state: 'acknowledged' });
    const r = filterIncidents([old, stillOpen], { ...DEFAULT_FILTERS, view: 'all', period: 7 }, NOW);
    expect(r.rows.map((x) => x.number)).toEqual([90]);
  });
  it('severity and site filters', () => {
    expect(
      filterIncidents(ALL, { ...DEFAULT_FILTERS, view: 'all', severity: 'problem' }, NOW).rows.map(
        (r) => r.number,
      ),
    ).toEqual([141, 138, 129]);
    expect(
      filterIncidents(ALL, { ...DEFAULT_FILTERS, view: 'all', siteId: 's-orca' }, NOW).rows.map(
        (r) => r.number,
      ),
    ).toEqual([139]);
  });
  it('phone: Open / Unacked (DOWN waiting, D-032) / Past', () => {
    expect(phoneViewCounts(ALL, NOW)).toEqual({ open: 3, unacked: 1, past: 2 });
    expect(isUnackedDown(inc({ severity: 'problem' }))).toBe(false);
    expect(isUnackedDown(inc({ state: 'escalated' }))).toBe(true);
  });
  it('desktop view counts', () => {
    expect(desktopViewCounts(ALL, DEFAULT_FILTERS, NOW)).toEqual({ needs_action: 3, done: 2, all: 5 });
  });
  it('sort: inside a group the newest start first', () => {
    const a = inc({ id: 'a', number: 1, startedAt: at('25T08:00:00') });
    const b = inc({ id: 'b', number: 2, startedAt: at('25T09:00:00') });
    expect(sortIncidents([a, b]).map((r) => r.id)).toEqual(['b', 'a']);
  });
});

describe('count line and hidden note', () => {
  it.each([
    [DEFAULT_FILTERS, '3 open'],
    [{ ...DEFAULT_FILTERS, period: 7 as const }, '3 incidents · last 7 days'],
    [{ ...DEFAULT_FILTERS, view: 'done' as const }, '2 incidents · last 30 days'],
    [{ ...DEFAULT_FILTERS, view: 'open' as const }, '3 open · unacknowledged first'],
    [{ ...DEFAULT_FILTERS, view: 'unacked' as const }, '1 not acknowledged'],
    [
      { ...DEFAULT_FILTERS, view: 'past' as const },
      'Last 30 days · 2 resolved, in review or closed · 2 short PROBLEMs auto-resolved (hidden)',
    ],
  ])('%o → %s', (f, label) => {
    expect(countLabel(ALL, f, NOW)).toBe(label);
  });
  it('In review joins the count as the board words it', () => {
    expect(countLabel([muvmi, inc({ id: 'r', number: 133, state: 'in_review' })], DEFAULT_FILTERS, NOW)).toBe(
      '1 open + 1 review awaiting sign-off',
    );
  });
  it('the hidden note is computed (§16.1), never in Needs action', () => {
    expect(hiddenNote(ALL, { ...DEFAULT_FILTERS, view: 'all' }, NOW)).toBe(
      '5 shown · 2 short PROBLEMs auto-resolved in < 5 min are hidden.',
    );
    expect(hiddenNote(ALL, DEFAULT_FILTERS, NOW)).toBeNull();
    expect(hiddenNote([tubtong, autoA], { ...DEFAULT_FILTERS, view: 'done' }, NOW)).toBe(
      '1 shown · 1 short PROBLEM auto-resolved in < 5 min is hidden.',
    );
    expect(hiddenNote([tubtong], { ...DEFAULT_FILTERS, view: 'done' }, NOW)).toBeNull();
  });
});

describe('row words', () => {
  it.each([
    [muvmi, '18 min unacked', 'danger'],
    [inc({ severity: 'problem' }), '18 min unacked', 'warning'],
    [fuji, 'Acked by Ploy 09:58', 'secondary'],
    [
      inc({ state: 'monitoring', recoveredAt: at('25T10:05:00') }),
      'Recovered 10:05 — watching for 2 OK rounds',
      'secondary',
    ],
    [orca, 'Recovered — add a root cause to resolve', 'warning'],
    [tubtong, 'Verifier restarted', 'secondary'],
    [wecare, 'Broken deploy, rolled back', 'secondary'],
  ])('next line %#', (i, text, tone) => {
    expect(nextLine(i, NOW)).toEqual({ text, tone });
  });
  it('trigger words', () => {
    expect(triggerWords(inc({ isFlapping: true }))).toBe('Hard fail, flapping');
    expect(triggerWords(inc({ trigger: 'tls_chain' }))).toBe('TLS chain');
  });
});

describe('KPIs (D-032 MTTA mean, D-033 MTTR median, Unacked until S08)', () => {
  it('captions from the open incidents', () => {
    const k = listKpis(ALL, NOW);
    expect(k).toMatchObject({
      open: 3,
      openCaption: '1 DOWN · 1 PROBLEM · 1 needs root cause',
      unacked: 1,
      unackedCaption: 'MuvMi · 18 min unacked',
      needsRootCause: 1,
      needsRootCauseCaption: 'ORCA Thailand · recovered, not resolved',
    });
  });
  it('MTTA and MTTR wait for 3 DOWN incidents in 30 days', () => {
    expect(listKpis([muvmi, orca], NOW)).toMatchObject({
      mttaEnough: false,
      mttaSeconds: null,
      mttrMinutes: null,
    });
  });
  it('MTTR is the median of recovered DOWN incidents; MTTA the mean ack wait', () => {
    const d = (n: number, minutes: number, ackSec: number) =>
      inc({
        id: `d${n}`,
        number: n,
        startedAt: at('24T10:00:00'),
        detectedAt: at('24T10:00:30'),
        recoveredAt: new Date(Date.parse(at('24T10:00:00')) + minutes * 60_000).toISOString(),
        ackedAt: new Date(Date.parse(at('24T10:00:30')) + ackSec * 1000).toISOString(),
        state: 'resolved',
      });
    const k = listKpis([d(1, 10, 60), d(2, 30, 120), d(3, 20, 180)], NOW);
    expect(k).toMatchObject({
      mttaEnough: true,
      mttaSeconds: 120,
      mttrMinutes: 20,
      open: 0,
      openCaption: 'Nothing open',
    });
  });
});

// ── Resolve gate (T10) ──────────────────────────────────────────────────
const ev = (
  type: string,
  local: string,
  payload: Record<string, unknown> = {},
  actor: string | null = null,
): EventRow => ({
  type,
  at: at(local),
  actor_id: actor,
  payload,
});
const names = new Map([
  ['u-arm', 'Arm'],
  ['u-tao', 'Tao'],
]);
const nameOf = (id: string | null) => (id ? (names.get(id) ?? 'someone') : 'someone');
const gateBase = {
  siteName: 'MuvMi',
  state: 'acknowledged' as const,
  recoveredAt: null,
  clientUpdateRequired: false,
  clientUpdatedAt: null,
  rootCauseCategory: null,
};

describe('resolveGate (T10, D-033)', () => {
  it('still down: 1 of 3 met (client update not required), locked naming the site', () => {
    const g = resolveGate(gateBase, [], nameOf);
    expect(g.conditions.map((c) => [c.label, c.met, c.detail])).toEqual([
      ['OK for 2 rounds', false, 'Still down · needs 2 OK rounds once it recovers'],
      ['Client update marked', true, 'Not required — the client-update track didn’t fire'],
      ['Root cause written', false, 'Not written yet · needed before Resolve'],
    ]);
    expect(g).toMatchObject({
      metCount: 1,
      ok: false,
      canOpenDialog: false,
      lockedReason: 'Resolve locked · 1 of 3 met — MuvMi is still down',
    });
  });
  it('one OK round: waiting for the second', () => {
    const g = resolveGate({ ...gateBase, state: 'monitoring', recoveredAt: at('25T10:31:00') }, [], nameOf);
    expect(g.conditions[0]!.detail).toBe('OK since 10:31 · waiting for the second OK round');
    expect(g.lockedReason).toBe('Resolve locked · 1 of 3 met — waiting for the second OK round');
  });
  it('Needs root cause: the dialog opens; Resolve itself waits for a real category', () => {
    const g = resolveGate(
      { ...gateBase, state: 'needs_root_cause', recoveredAt: at('25T10:31:00') },
      [ev('ok_two_rounds', '25T10:32:10', { state: 'needs_root_cause' })],
      nameOf,
    );
    expect(g.conditions[0]!.detail).toBe('OK since 10:31 · 2 rounds done 10:32');
    expect(g).toMatchObject({ metCount: 2, ok: false, canOpenDialog: true, lockedReason: null });
  });
  it('"Unknown — keep investigating" doesn’t count', () => {
    const g = resolveGate(
      {
        ...gateBase,
        state: 'needs_root_cause',
        recoveredAt: at('25T10:31:00'),
        rootCauseCategory: 'unknown',
      },
      [ev('ok_two_rounds', '25T10:32:10')],
      nameOf,
    );
    expect(g.conditions[2]).toMatchObject({ met: false, detail: 'Unknown keeps the incident open' });
    expect(g.ok).toBe(false);
  });
  it('root cause written first, settled in Monitoring: all three met, names who wrote it', () => {
    const g = resolveGate(
      { ...gateBase, state: 'monitoring', recoveredAt: at('25T10:31:00'), rootCauseCategory: 'hosting' },
      [
        ev('root_cause', '25T10:07:00', { category: 'hosting' }, 'u-tao'),
        ev('ok_two_rounds', '25T10:32:10', { state: 'monitoring' }),
      ],
      nameOf,
    );
    expect(g.conditions[2]!.detail).toBe('Tao · 10:07 · Hosting / server');
    expect(g).toMatchObject({ metCount: 3, ok: true, canOpenDialog: true });
  });
  it('the OK rounds before a relapse don’t count (same rule as resolve_incident)', () => {
    const i = { ...gateBase, state: 'monitoring' as const, recoveredAt: at('25T10:40:00') };
    expect(okTwoRoundsAt(i, [ev('ok_two_rounds', '25T10:32:10')])).toBeNull();
  });
  it('client update required and not marked (S11): locked on it', () => {
    const g = resolveGate(
      { ...gateBase, state: 'needs_root_cause', recoveredAt: at('25T10:31:00'), clientUpdateRequired: true },
      [ev('ok_two_rounds', '25T10:32:10')],
      nameOf,
    );
    expect(g.lockedReason).toBe('Resolve locked · 1 of 3 met — mark the client update first');
  });
});

// ── Timeline ────────────────────────────────────────────────────────────
describe('timelineOf (§16.11, §19.7)', () => {
  const i = {
    severity: 'down' as const,
    trigger: 'hard_fail' as const,
    startedAt: at('25T09:48:12'),
    recoveredAt: at('25T10:31:00'),
  };
  const events: EventRow[] = [
    ev('detected', '25T09:48:41', {
      cause: 'Timeout > 30 s (BKK, TYO) · HTTP 504 (SIN)',
      confirmingLocations: 3,
    }),
    ev('alerted', '25T09:48:43', { channel: 'google_chat', template: 'down' }),
    ev('alerted', '25T09:48:44', { channel: 'email', template: 'down', user_id: 'u-arm' }),
    ev('evidence', '25T09:49:20', { screenshotPath: 'x.jpg' }),
    ev('acknowledged', '25T10:07:40', { posts_at: at('25T10:07:50') }, 'u-arm'),
    ev('alerted', '25T10:07:51', { channel: 'google_chat', template: 'acknowledged' }),
    ev('note', '25T10:10:00', { text: 'Host says the app server is restarting' }, 'u-arm'),
    ev(
      'root_cause',
      '25T10:12:00',
      {
        category: 'hosting',
        what: 'Host rebooted the app server',
        fix: null,
        state: 'acknowledged',
        first: true,
      },
      'u-arm',
    ),
    ev('recovered', '25T10:31:00', { okLocations: 3 }),
    ev('ok_two_rounds', '25T10:32:10', { state: 'monitoring' }),
    ev(
      'root_cause',
      '25T10:33:00',
      {
        category: 'hosting',
        what: 'Host rebooted the app server',
        fix: 'Host restarted it',
        state: 'monitoring',
        first: false,
      },
      'u-arm',
    ),
    ev(
      'resolved',
      '25T10:33:10',
      { category: 'hosting', what: 'Host rebooted the app server', posts_at: at('25T10:33:20') },
      'u-arm',
    ),
  ];
  const later = new Date(at('25T10:33:15'));
  it('every event in words, oldest first', () => {
    expect(timelineOf(i, events, nameOf, later).map((t) => [t.time, t.title])).toEqual([
      ['09:48:12', 'First failed check'],
      ['09:48:41', 'Confirmed down 09:48:41'],
      ['09:48:43', 'DOWN posted in Chat'],
      ['09:48:44', 'DOWN emailed to Arm'],
      ['09:49:20', 'Screenshot attached'],
      ['10:07:40', 'Acknowledged by Arm (posted 10:07:51)'],
      ['10:07:51', 'ACKNOWLEDGED posted in Chat'],
      ['10:10:00', 'Note by Arm'],
      ['10:12:00', 'Root cause draft by Arm · incident kept open (still down)'],
      ['10:31:00', 'Recovered → Monitoring'],
      ['10:32:10', 'OK for 2 rounds'],
      ['10:33:00', 'Root cause edited by Arm'],
      ['10:33:10', 'Resolved by Arm (posts 10:33:20 unless undone)'],
    ]);
  });
  it('details: cause, confirmation, note text, root cause, OK-rounds wording by state (M2)', () => {
    const t = timelineOf(i, events, nameOf, later);
    expect(t[0]!.detail).toBe('Timeout > 30 s (BKK, TYO) · HTTP 504 (SIN)');
    expect(t[1]!.detail).toBe('Confirmed by 3 locations, 2 checks. Incident opened.');
    expect(t[7]!.detail).toBe('Host says the app server is restarting');
    expect(t[8]!.detail).toBe('Hosting / server · “Host rebooted the app server”');
    expect(t[10]!.detail).toBe('Root cause already written — ready to resolve');
    expect(t[11]!.detail).toBe('Hosting / server · “Host rebooted the app server” · Fix: Host restarted it');
  });
  it('same time: RECOVERED before PROBLEM AGAIN (§19.7)', () => {
    const t = timelineOf(
      i,
      [
        ev('relapsed', '25T10:31:00', { severity: 'problem', summary: 'Key page /booking failing' }),
        ev('recovered', '25T10:31:00'),
      ],
      nameOf,
      later,
    );
    expect(t.map((x) => x.title)).toEqual(['First failed check', 'Recovered → Monitoring', 'Problem again']);
  });
  it('an undone resolve and ack never post; Unknown is a note; a late screenshot says so', () => {
    const t = timelineOf(
      i,
      [
        ev('acknowledged', '25T10:00:00', { posts_at: at('25T10:00:10') }, 'u-tao'),
        ev('ack_undone', '25T10:00:05', {}, 'u-tao'),
        ev('evidence', '25T10:40:00'),
        ev(
          'root_cause',
          '25T10:41:00',
          { category: 'unknown', what: 'Still looking', state: 'needs_root_cause', first: true },
          'u-tao',
        ),
        ev('resolved', '25T10:42:00', { posts_at: at('25T10:42:10') }, 'u-tao'),
        ev('resolve_undone', '25T10:42:05', {}, 'u-tao'),
      ],
      nameOf,
      new Date(at('25T10:42:06')),
    );
    expect(t.map((x) => x.title)).toEqual([
      'First failed check',
      'Acknowledged by Tao',
      'Acknowledgement undone by Tao',
      'Screenshot attached',
      'Root cause note by Tao · doesn’t count — incident stays open',
      'Resolved by Tao',
      'Resolve undone by Tao',
    ]);
    expect(t[3]!.detail).toBe('Browser verifier, Bangkok — evidence only · taken after recovery.');
  });
  it('PROBLEM, relapse, escalation and auto-resolve lines', () => {
    const p = { ...i, severity: 'problem' as const, trigger: 'keyword' as const };
    const t = timelineOf(
      p,
      [
        ev('detected', '25T09:00:00', { summary: 'Keyword missing on /' }),
        ev('escalated_to_down', '25T09:05:00', { cause: 'HTTP 500 (SIN, TYO)' }),
        ev('relapsed', '25T09:20:00', { severity: 'down', flapping: true, cause: 'HTTP 502' }),
        ev('recovered', '25T09:25:00', { autoResolved: true }),
        ev('auto_resolved', '25T09:25:00'),
        ev('ok_two_rounds', '25T09:26:00', { state: 'needs_root_cause' }),
      ],
      nameOf,
      NOW,
    );
    expect(t.map((x) => [x.title, x.detail])).toEqual([
      ['First failed check', 'Keyword'],
      ['PROBLEM detected 09:00:00', 'Keyword missing on /'],
      ['PROBLEM became DOWN', 'HTTP 500 (SIN, TYO)'],
      ['Down again · flapping', 'HTTP 502'],
      ['Recovered', 'First OK round · OK from 2 locations'],
      ['Resolved automatically', 'Short PROBLEM, never acknowledged — no root cause needed'],
      ['OK for 2 rounds → Needs root cause', 'Needs a root cause before it can be resolved'],
    ]);
  });
});
