import { describe, expect, it } from 'vitest';
import type { CheckOutcome, ProbeLocation } from '@dxt/shared';
import {
  outageMinutes,
  episodesOf,
  FLAP_STABLE_MS,
  relapseState,
  transition,
  type EpisodeEvent,
} from './lifecycle';

import type { OpenIncident, StoredCheck } from './monitor';
import { decideSite, NEW_MONITOR, type MonitorCarry, type SiteMonitor, type SiteSnapshot } from './site';

// S04b: relapse, flapping, auto-resolve and D-023 (D-004, D-024; spec §16.1, §19.3–19.4).
// Minute rounds (Tier 1 rhythm) so the spec's sample minutes are round starts.
const LOCATIONS: ProbeLocation[] = ['BKK', 'SIN', 'TYO'];
const T = (hhmm: string, day = '21') => new Date(`2026-09-${day}T${hhmm}:00Z`);
const plus = (d: Date, sec: number) => new Date(d.getTime() + sec * 1000);

function check(location: ProbeLocation, outcome: CheckOutcome, at: Date, attempt: 1 | 2 = 1): StoredCheck {
  return {
    location,
    outcome,
    checkedAt: at,
    attempt,
    statusCode: outcome === 'fail' ? 500 : 200,
    error: null,
    responseMs: 800,
  };
}
const passRound = (start: Date) => LOCATIONS.map((l, i) => check(l, 'pass', plus(start, 1 + i)));
const failRound = (start: Date) => [
  ...LOCATIONS.map((l, i) => check(l, 'fail', plus(start, 1 + i))),
  ...LOCATIONS.map((l, i) => check(l, 'fail', plus(start, 31 + i), 2)),
];

function monitor(id: string, checks: StoredCheck[], carry: MonitorCarry = NEW_MONITOR): SiteMonitor {
  return {
    id,
    isPrimary: id === 'home',
    url: id === 'home' ? 'https://voca.example/' : `https://voca.example/${id}`,
    slowThresholdMs: 5_000,
    allowedRedirectDomains: [],
    checks,
    carry,
  };
}
const snapshot = (start: Date, monitors: SiteMonitor[], over: Partial<SiteSnapshot> = {}): SiteSnapshot => ({
  now: plus(start, 50),
  intervalSec: 60,
  locations: LOCATIONS,
  lastRoundAt: null,
  okRounds: 0,
  open: null,
  monitors,
  ...over,
});
const carry = (over: Partial<MonitorCarry>): MonitorCarry => ({ ...NEW_MONITOR, ...over });
const incident = (over: Partial<OpenIncident> = {}): OpenIncident => ({
  id: 'inc-0133',
  state: 'monitoring',
  severity: 'down',
  episodeSeverity: 'down',
  hasRootCause: false,
  acked: false,
  startedAt: T('03:12'),
  isFlapping: false,
  ...over,
});

describe('lifecycle — relapse state, auto-resolve event, episodes (D-004, spec §16.1, §19.4)', () => {
  it.each([
    [{ acked: true, escalationLevel: 1 }, 'acknowledged'],
    [{ acked: false, escalationLevel: 1 }, 'escalated'],
    [{ acked: false, escalationLevel: 0 }, 'unacked'],
  ] as const)('a relapse goes back to the right state: %o → %s', (input, state) => {
    expect(relapseState(input)).toBe(state);
  });

  it('only a PROBLEM can auto-resolve, and only before it is acknowledged', () => {
    const problem = { severity: 'problem' as const, hasRootCause: false };
    expect(transition('unacked', 'auto_resolve', problem)).toEqual({ ok: true, state: 'resolved' });
    expect(transition('escalated', 'auto_resolve', problem)).toEqual({ ok: true, state: 'resolved' });
    expect(transition('acknowledged', 'auto_resolve', problem).ok).toBe(false);
    expect(transition('unacked', 'auto_resolve', { ...problem, severity: 'down' }).ok).toBe(false);
  });

  it('D-003: a PROBLEM passes through Monitoring and Needs root cause, ends at Resolved, never In review', () => {
    const ctx = { severity: 'problem' as const, hasRootCause: false };
    expect(transition('unacked', 'recover', ctx)).toEqual({ ok: true, state: 'monitoring' });
    expect(transition('monitoring', 'ok_two_rounds', ctx)).toEqual({ ok: true, state: 'needs_root_cause' });
    expect(transition('needs_root_cause', 'resolve', ctx)).toEqual({ ok: true, state: 'resolved' });
    expect(transition('resolved', 'submit_review', ctx).ok).toBe(false);
  });

  it('INC-0133 VOCA: four drops, 41 min down in total, in any event order', () => {
    const ev = (type: string, at: string, startedAt?: string): EpisodeEvent => ({
      type,
      at: T(at),
      ...(startedAt ? { startedAt: T(startedAt) } : {}),
    });
    const events = [
      ev('recovered', '04:04'),
      ev('detected', '03:12', '03:12'),
      ev('recovered', '03:19'),
      ev('relapsed', '03:24', '03:24'),
      ev('recovered', '03:35'),
      ev('relapsed', '03:38', '03:38'),
      ev('recovered', '03:52'),
      ev('relapsed', '03:55', '03:55'),
      ev('ok_two_rounds', '03:20'),
    ];
    const episodes = episodesOf(events);
    expect(
      episodes.map((e) => [e.start.toISOString().slice(11, 16), e.end?.toISOString().slice(11, 16)]),
    ).toEqual([
      ['03:12', '03:19'],
      ['03:24', '03:35'],
      ['03:38', '03:52'],
      ['03:55', '04:04'],
    ]);
    expect(outageMinutes(episodes, T('04:19'))).toBe(41);
  });

  it('D-023: the PROBLEM AGAIN at the recovery is its own drop, from the recovery on; a DOWN during it is a new DOWN drop', () => {
    const episodes = episodesOf([
      { type: 'detected', at: T('10:01', '25'), startedAt: T('10:00', '25') },
      { type: 'relapsed', at: T('10:21', '25'), startedAt: T('10:00', '25'), severity: 'problem' },
      { type: 'recovered', at: T('10:21', '25') },
      { type: 'relapsed', at: T('10:30', '25'), startedAt: T('10:29', '25'), severity: 'down' },
      { type: 'recovered', at: T('10:40', '25') },
    ]);
    expect(episodes).toEqual([
      { start: T('10:00', '25'), end: T('10:21', '25'), severity: 'down' },
      { start: T('10:21', '25'), end: T('10:29', '25'), severity: 'problem' },
      { start: T('10:29', '25'), end: T('10:40', '25'), severity: 'down' },
    ]);
  });

  it('a drop still in progress counts to now; an escalation after a recovery is a new drop', () => {
    const episodes = episodesOf([
      { type: 'detected', at: T('10:00'), startedAt: T('09:58'), severity: 'problem' },
      { type: 'escalated_to_down', at: T('10:02') },
      { type: 'recovered', at: T('10:05') },
      { type: 'escalated_to_down', at: T('10:20') },
    ]);
    // D-021 while the PROBLEM drop is open: the PROBLEM ends at the outage's start (S06 engine review)
    expect(episodes).toEqual([
      { start: T('09:58'), end: T('10:02'), severity: 'problem' },
      { start: T('10:02'), end: T('10:05'), severity: 'down' },
      { start: T('10:20'), end: null, severity: 'down' },
    ]);
    // DOWN drops only (D-033): 10:02–10:05 + 10:20–now = 3 + 10; the PROBLEM's 4 min aren't an outage
    expect(outageMinutes(episodes, T('10:30'))).toBe(13);
  });
});

describe('decideSite — relapse (D-004, spec §19.3)', () => {
  const start = T('03:24');

  it('PROBLEM AGAIN: a key page failing on a recovered incident joins it', () => {
    const d = decideSite(
      snapshot(start, [monitor('home', passRound(start)), monitor('booking', failRound(start))], {
        open: incident({ acked: true }),
        okRounds: 2,
      }),
    );
    expect(d).toMatchObject({
      kind: 'relapse',
      severity: 'problem',
      monitorId: 'booking',
      trigger: 'key_page',
      startedAt: plus(start, 1),
      detectedAt: start,
      flapping: false,
      status: 'problem',
    });
  });

  it('a relapse is the 3rd change in 30 min → flapping (VOCA: 03:12, 03:19, 03:24)', () => {
    const open = incident();
    const d = decideSite(
      snapshot(start, [monitor('home', failRound(start))], {
        open,
        flips: [T('03:12'), T('03:19')],
        flipOk: true,
      }),
    );
    expect(d).toMatchObject({ kind: 'relapse', severity: 'down', flapping: true, status: 'down' });
  });

  it.each([
    ['the older change is more than 30 min back', [T('02:50'), T('03:19')], true],
    ['the site never went back to OK (D-023 partial recovery)', [T('03:12'), T('03:19')], false],
  ] as const)('no flapping when %s', (_n, flips, flipOk) => {
    const d = decideSite(
      snapshot(start, [monitor('home', failRound(start))], { open: incident(), flips, flipOk }),
    );
    expect(d).toMatchObject({ kind: 'relapse', flapping: false });
  });

  it('a DOWN on a recovered PROBLEM incident still raises it (D-021), counting toward flapping', () => {
    const d = decideSite(
      snapshot(start, [monitor('home', failRound(start))], {
        open: incident({ severity: 'problem', episodeSeverity: 'problem' }),
        flips: [T('03:12'), T('03:19')],
        flipOk: true,
      }),
    );
    expect(d).toMatchObject({ kind: 'escalate', flapping: true });
  });

  it('a site still failing while its incident hasn’t recovered is no relapse', () => {
    const d = decideSite(
      snapshot(start, [monitor('home', failRound(start))], { open: incident({ state: 'acknowledged' }) }),
    );
    expect(d).toMatchObject({ kind: 'none', status: 'down' });
  });
});

describe('decideSite — D-023: a DOWN ends when the home page is back', () => {
  const start = T('10:20', '25');
  const broken = carry({ status: 'problem', trigger: 'key_page' });

  it('home OK, /booking still 404 → RECOVERED (not a flip) and PROBLEM AGAIN from the same round (spec §19.7)', () => {
    const d = decideSite(
      snapshot(start, [monitor('home', passRound(start)), monitor('booking', failRound(start), broken)], {
        open: incident({ state: 'acknowledged', acked: true }),
      }),
    );
    expect(d).toMatchObject({
      kind: 'recover',
      from: 'acknowledged',
      to: 'monitoring',
      recoveredAt: plus(start, 1),
      allOk: false,
      autoResolve: false,
      status: 'problem',
      then: { severity: 'problem', monitorId: 'booking', trigger: 'key_page', startedAt: plus(start, 1) },
    });
  });

  it('a key page failing on the round after a partial recovery is PROBLEM AGAIN too, not flapping', () => {
    const next = plus(start, 60);
    const d = decideSite(
      snapshot(next, [monitor('home', passRound(next)), monitor('booking', failRound(next), broken)], {
        open: incident({ state: 'monitoring', acked: true }),
        okRounds: 1,
        flips: [T('10:05', '25')],
        flipOk: false,
      }),
    );
    expect(d).toMatchObject({ kind: 'relapse', severity: 'problem', flapping: false, status: 'problem' });
  });

  it('a flapping incident’s partial recovery still posts RECOVERED with its PROBLEM AGAIN (§19.7)', () => {
    const d = decideSite(
      snapshot(start, [monitor('home', passRound(start)), monitor('booking', failRound(start), broken)], {
        open: incident({ state: 'unacked', isFlapping: true }),
        flips: [plus(start, -600), plus(start, -300), plus(start, -120)],
        flipOk: false,
      }),
    );
    expect(d).toMatchObject({
      kind: 'recover',
      allOk: false,
      holdSummary: false,
      then: { severity: 'problem' },
    });
  });

  it('the home page down again during that PROBLEM drop → DOWN AGAIN in the same incident (engine review H1)', () => {
    const d = decideSite(
      snapshot(start, [monitor('home', failRound(start)), monitor('booking', failRound(start), broken)], {
        open: incident({ state: 'acknowledged', acked: true, episodeSeverity: 'problem' }),
      }),
    );
    expect(d).toMatchObject({ kind: 'relapse', severity: 'down', trigger: 'hard_fail', status: 'down' });
  });

  it('…and that PROBLEM drop recovers only when every monitor is OK (a flip), showing PROBLEM until it settles', () => {
    const later = plus(start, 600);
    const open = incident({ state: 'acknowledged', acked: true, episodeSeverity: 'problem' });
    const still = decideSite(
      snapshot(later, [monitor('home', passRound(later)), monitor('booking', failRound(later), broken)], {
        open,
      }),
    );
    expect(still).toMatchObject({ kind: 'none', status: 'problem' });
    const ok = decideSite(
      snapshot(later, [monitor('home', passRound(later)), monitor('booking', passRound(later), broken)], {
        open,
      }),
    );
    expect(ok).toMatchObject({ kind: 'recover', allOk: true, status: 'problem' });
  });
});

describe('decideSite — auto-resolve (spec §16.1)', () => {
  // Rounds start on the minute; the first OK check is 1 s in (09:53:01).
  const round = T('09:53', '25');
  const keyword = (start: Date) =>
    LOCATIONS.map((l, i) => ({
      ...check(l, 'pass', plus(start, 1 + i)),
      keywordMissing: [],
      keywordForbidden: [],
    }));
  const problem = (over: Partial<OpenIncident> = {}) =>
    incident({
      state: 'unacked',
      severity: 'problem',
      episodeSeverity: 'problem',
      startedAt: T('09:40', '25'),
      // §19.6: the 5 min count from when the PROBLEM was flagged, not from its first failed check.
      detectedAt: T('09:48', '25'),
      ...over,
    });

  it.each([
    [
      '4 min 59 s after it was flagged, nobody acked → Resolved',
      { detectedAt: plus(T('09:48', '25'), 2) },
      true,
    ],
    ['exactly 5 min → Monitoring', { detectedAt: plus(T('09:48', '25'), 1) }, false],
    ['acknowledged → Monitoring', { state: 'acknowledged' as const, acked: true }, false],
    ['a DOWN never auto-resolves', { severity: 'down' as const, episodeSeverity: 'down' as const }, false],
  ])('%s', (_n, over: Partial<OpenIncident>, resolves) => {
    const d = decideSite(snapshot(round, [monitor('home', keyword(round))], { open: problem(over) }));
    expect(d).toMatchObject({
      kind: 'recover',
      autoResolve: resolves,
      to: resolves ? 'resolved' : 'monitoring',
      // Resolved: no incident holds the status up any more.
      status: resolves ? 'ok' : (over.episodeSeverity ?? 'problem'),
      holdSummary: false,
    });
  });
});

describe('decideSite — flapping holds RECOVERED (spec §19.4)', () => {
  it('a flapping incident’s recovery holds one summary instead of RECOVERED', () => {
    const start = T('03:35');
    const d = decideSite(
      snapshot(start, [monitor('home', passRound(start))], {
        open: incident({ state: 'unacked', isFlapping: true }),
        flips: [T('03:12'), T('03:19'), T('03:24')],
        flipOk: false,
      }),
    );
    expect(d).toMatchObject({ kind: 'recover', allOk: true, holdSummary: true, to: 'monitoring' });
  });

  it('hours after the flapping ended, a recovery gets a plain RECOVERED again', () => {
    const start = T('14:10');
    const d = decideSite(
      snapshot(start, [monitor('home', passRound(start))], {
        open: incident({ state: 'unacked', isFlapping: true }),
        flips: [T('14:00')],
        flipOk: false,
      }),
    );
    expect(d).toMatchObject({ kind: 'recover', holdSummary: false });
  });
});

/**
 * INC-0133 VOCA (spec §19.4, ChatAlert "Fails again while the incident is open"): drops 03:12–03:19 ·
 * 03:24–03:35 · 03:38–03:52 · 03:55–04:04, summary 04:19. The harness feeds `decideSite` one round a
 * minute and applies each decision the way the engine's SQL functions do (state, flips, events).
 * Ploy acknowledges once, during the second drop (after the 03:24 DOWN AGAIN mentioned her).
 */
describe('INC-0133 VOCA end to end (D-004 with flapping, Done-when 1)', () => {
  const drops: [string, string][] = [
    ['03:12', '03:19'],
    ['03:24', '03:35'],
    ['03:38', '03:52'],
    ['03:55', '04:04'],
  ];
  const isDown = (t: Date) => drops.some(([a, b]) => t >= T(a) && t < T(b));

  it('one incident, flapped ×4, 41 min down, one ack, RECOVERED once then one summary at 04:19', () => {
    let open: OpenIncident | null = null;
    let flips: Date[] = [];
    let flipOk: boolean | null = null;
    let okRounds = 0;
    let lastRoundAt: Date | null = null;
    const events: EpisodeEvent[] = [];
    const log: string[] = [];
    let opens = 0;
    let acks = 0;
    let summaryAt: Date | null = null;
    const flip = (at: Date, ok: boolean) => {
      if (flipOk === ok) return;
      flipOk = ok;
      flips = [...flips, at].filter((f) => f.getTime() > at.getTime() - 30 * 60_000);
    };

    for (let t = T('03:12'); t <= T('04:19'); t = plus(t, 60)) {
      const d = decideSite(
        snapshot(t, [monitor('home', isDown(t) ? failRound(t) : passRound(t))], {
          open,
          okRounds,
          lastRoundAt,
          flips,
          flipOk,
        }),
      );
      const hhmm = t.toISOString().slice(11, 16);
      switch (d.kind) {
        case 'open':
          opens += 1;
          open = incident({ state: 'unacked', startedAt: d.startedAt });
          events.push({ type: 'detected', at: d.confirmedAt, startedAt: d.startedAt });
          flip(t, false);
          okRounds = 0;
          log.push(`${hhmm} DOWN`);
          break;
        case 'relapse':
          // "Now flapping" only on the drop that tags it (ChatAlert 03:24).
          log.push(`${hhmm} DOWN AGAIN${d.flapping && !open!.isFlapping ? ' · now flapping' : ''}`);
          open = { ...open!, state: relapseState({ acked: !!open!.acked, escalationLevel: 0 }) };
          if (d.flapping) open = { ...open, isFlapping: true };
          events.push({ type: 'relapsed', at: d.detectedAt, startedAt: d.startedAt });
          flip(t, false);
          okRounds = 0;
          summaryAt = null; // a new drop cancels the held summary
          break;
        case 'recover':
          open = { ...open!, state: d.to };
          events.push({ type: 'recovered', at: d.recoveredAt });
          if (d.allOk) flip(t, true);
          okRounds = 1;
          if (d.holdSummary) summaryAt = new Date(d.recoveredAt.getTime() + FLAP_STABLE_MS);
          log.push(`${hhmm} ${d.holdSummary ? 'summary held' : 'RECOVERED'}`);
          break;
        case 'settle':
          open = { ...open!, state: d.to };
          okRounds = 2;
          break;
        case 'none':
          okRounds = d.okRounds;
          break;
        default:
          throw new Error(`unexpected ${d.kind} at ${hhmm}`);
      }
      lastRoundAt = t;
      // Ploy acknowledges once, during the second drop.
      if (hhmm === '03:26' && open && transition(open.state, 'ack', open).ok) {
        open = { ...open, state: 'acknowledged', acked: true };
        acks += 1;
      }
    }

    expect(opens).toBe(1);
    expect(log).toEqual([
      '03:12 DOWN',
      '03:19 RECOVERED',
      '03:24 DOWN AGAIN · now flapping',
      '03:35 summary held',
      '03:38 DOWN AGAIN',
      '03:52 summary held',
      '03:55 DOWN AGAIN',
      '04:04 summary held',
    ]);
    expect(open).toMatchObject({ state: 'needs_root_cause', isFlapping: true, acked: true });
    expect(acks).toBe(1);
    const episodes = episodesOf(events);
    expect(episodes).toHaveLength(4); // "flapped ×4"
    expect(outageMinutes(episodes, T('04:19'))).toBe(41);
    // Recovered at the first OK check (04:04:01): the summary goes 15 min later, at 04:19.
    expect(summaryAt).toEqual(plus(T('04:19'), 1));
  });
});

describe('outageMinutes — how long an incident was down, on every page (D-033)', () => {
  const drop = (start: string, end: string | null, severity: 'down' | 'problem') => ({
    start: T(start),
    end: end ? T(end) : null,
    severity,
  });
  it.each([
    ['one DOWN drop', [drop('03:12', '03:19', 'down')], 7],
    [
      'two DOWN drops (03:12–03:19 · 03:24–03:35): the OK between them is not an outage',
      [drop('03:12', '03:19', 'down'), drop('03:24', '03:35', 'down')],
      18,
    ],
    [
      'a PROBLEM raised to DOWN (D-021): DOWN minutes only, as uptime (§5)',
      [drop('09:58', '10:02', 'problem'), drop('10:02', '10:05', 'down')],
      3,
    ],
    ['a PROBLEM-only incident counts its problem minutes', [drop('10:21', '10:29', 'problem')], 8],
    ['the drop in progress counts to now', [drop('10:20', null, 'down')], 10],
  ])('%s', (_, episodes, minutes) => {
    expect(outageMinutes(episodes, T('10:30'))).toBe(minutes);
  });
  it('no drop: null', () => {
    expect(outageMinutes([], T('10:30'))).toBeNull();
  });
});
