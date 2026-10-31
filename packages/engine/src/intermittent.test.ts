import { describe, expect, it } from 'vitest';
import type { CheckOutcome, ProbeLocation } from '@dxt/shared';
import type { OpenIncident, StoredCheck } from './monitor';
import {
  decideSite,
  NEW_MONITOR,
  type MonitorCarry,
  type SiteDecision,
  type SiteMonitor,
  type SiteSnapshot,
} from './site';

// D-050: D-049's accepted gap — a site timing out every other round (timeout, OK, timeout…) raised
// nothing. The 3rd timeout blip within 30 min on the home page is PROBLEM · Intermittent from the 1st;
// it holds through the OK rounds in between and recovers 30 min after the last blip. The timeline is
// ENEOS's (INC-0015, Tier 1): BKK and TYO time out, SIN passes. R = a Tier 1 minute tick.
const R = Date.parse('2026-10-16T06:43:00Z');
const at = (sec: number) => new Date(R + sec * 1000);
const LOCATIONS: ProbeLocation[] = ['BKK', 'SIN', 'TYO'];

function check(
  location: ProbeLocation,
  outcome: CheckOutcome,
  sec: number,
  over: Partial<StoredCheck> = {},
): StoredCheck {
  return {
    location,
    outcome,
    checkedAt: at(sec),
    attempt: 1,
    statusCode: outcome === 'fail' ? null : 200,
    error: outcome === 'fail' ? 'Timeout' : null,
    responseMs: outcome === 'fail' ? null : 900,
    ...over,
  };
}
const recheck = (location: ProbeLocation, sec: number, over: Partial<StoredCheck> = {}) =>
  check(location, 'fail', sec, { attempt: 2, ...over });

/** BKK and TYO time out on the check and the recheck, SIN passes. */
const timeoutRound = (base: number, over: Partial<StoredCheck> = {}) => [
  check('BKK', 'fail', base + 1, over),
  check('SIN', 'pass', base + 1),
  check('TYO', 'fail', base + 2, over),
  recheck('BKK', base + 31, over),
  recheck('TYO', base + 32, over),
];
const okRound = (base: number) => LOCATIONS.map((l) => check(l, 'pass', base + 1));

const carry = (over: Partial<MonitorCarry> = {}): MonitorCarry => ({ ...NEW_MONITOR, ...over });

function home(
  checks: StoredCheck[],
  c: MonitorCarry = NEW_MONITOR,
  over: Partial<SiteMonitor> = {},
): SiteMonitor {
  return {
    id: 'home',
    isPrimary: true,
    url: 'https://eneos.example/',
    slowThresholdMs: 10_000,
    allowedRedirectDomains: [],
    checks,
    carry: c,
    ...over,
  };
}

/** Judge the round at `base` (the one before it already judged). */
const site = (base: number, monitors: SiteMonitor[], over: Partial<SiteSnapshot> = {}): SiteSnapshot => ({
  now: at(base + 140),
  intervalSec: 60,
  locations: LOCATIONS,
  lastRoundAt: at(base - 60),
  okRounds: 0,
  open: null,
  monitors,
  ...over,
});

const openIntermittent = (over: Partial<OpenIncident> = {}): OpenIncident => ({
  id: 'inc',
  state: 'unacked',
  severity: 'problem',
  hasRootCause: false,
  startedAt: at(1),
  detectedAt: at(240),
  ...over,
});
const intermittentCarry = (blips: Date[]) =>
  carry({ status: 'problem', trigger: 'intermittent', cause: 'Timing out on and off', blips });

const blipsOf = (d: SiteDecision, id = 'home') =>
  d.kind === 'wait' || d.kind === 'verify' ? undefined : d.monitors.find((m) => m.monitorId === id)?.blips;

describe('a timeout that keeps coming back is a PROBLEM (D-050)', () => {
  it('1st and 2nd blips raise nothing but are kept', () => {
    const first = decideSite(site(0, [home([...okRound(-60), ...timeoutRound(0)])]));
    expect(first.kind).toBe('none');
    expect(blipsOf(first)).toEqual([at(1)]);

    const second = decideSite(
      site(120, [home([...okRound(60), ...timeoutRound(120)], carry({ blips: [at(1)] }))]),
    );
    expect(second.kind).toBe('none');
    expect(blipsOf(second)).toEqual([at(1), at(121)]);
  });

  it('timeout, OK, timeout, OK, timeout: the 3rd blip opens PROBLEM · Intermittent from the 1st', () => {
    const d = decideSite(
      site(240, [home([...okRound(180), ...timeoutRound(240)], carry({ blips: [at(1), at(121)] }))]),
    );
    expect(d).toMatchObject({
      kind: 'problem',
      monitorId: 'home',
      trigger: 'intermittent',
      startedAt: at(1),
      status: 'problem',
      detail: { kind: 'intermittent', blips: 3, windowMin: 30, locations: ['BKK', 'TYO'] },
    });
    expect(blipsOf(d)).toEqual([at(1), at(121), at(241)]);
  });

  it('blips older than 30 min no longer count', () => {
    const d = decideSite(
      site(240, [home([...okRound(180), ...timeoutRound(240)], carry({ blips: [at(-1560), at(121)] }))]),
    );
    expect(d.kind).toBe('none');
    expect(blipsOf(d)).toEqual([at(121), at(241)]);
  });

  it('the same round judged twice counts once', () => {
    const d = decideSite(
      site(240, [home([...okRound(180), ...timeoutRound(240)], carry({ blips: [at(121), at(241)] }))]),
    );
    expect(d.kind).toBe('none');
    expect(blipsOf(d)).toEqual([at(121), at(241)]);
  });

  it('a 5xx whose recheck passed is no blip (narrow on purpose)', () => {
    const fiveHundred = { statusCode: 503, error: null };
    const round = [
      check('BKK', 'fail', 241, fiveHundred),
      check('SIN', 'pass', 241),
      check('TYO', 'fail', 242, fiveHundred),
      check('BKK', 'pass', 271, { attempt: 2 }),
      check('TYO', 'pass', 272, { attempt: 2 }),
    ];
    const d = decideSite(site(240, [home([...okRound(180), ...round], carry({ blips: [at(1), at(121)] }))]));
    expect(d.kind).toBe('none');
    expect(blipsOf(d)).toEqual([at(1), at(121)]);
  });

  it('the OK round between two timeouts holds the open PROBLEM: no RECOVERED, no auto-resolve', () => {
    const d = decideSite(
      site(
        300,
        [home([...timeoutRound(240), ...okRound(300)], intermittentCarry([at(1), at(121), at(241)]))],
        {
          open: openIntermittent(),
        },
      ),
    );
    expect(d).toMatchObject({ kind: 'none', status: null });
    expect(d.kind === 'none' && d.monitors[0]).toMatchObject({ status: 'problem', trigger: 'intermittent' });
    expect(blipsOf(d)).toEqual([at(1), at(121), at(241)]);
  });

  it('the next blip while it is open keeps it — no PROBLEM AGAIN, no flapping', () => {
    const d = decideSite(
      site(
        360,
        [home([...okRound(300), ...timeoutRound(360)], intermittentCarry([at(1), at(121), at(241)]))],
        {
          open: openIntermittent(),
        },
      ),
    );
    expect(d).toMatchObject({ kind: 'none', status: 'problem' });
    expect(blipsOf(d)).toHaveLength(4);
  });

  it('the first OK round 30 min after the last blip recovers it — too late to auto-resolve', () => {
    const d = decideSite(
      site(2100, [home([...okRound(2040), ...okRound(2100)], intermittentCarry([at(241)]))], {
        open: openIntermittent(),
      }),
    );
    expect(d).toMatchObject({ kind: 'recover', autoResolve: false, to: 'monitoring' });
    expect(blipsOf(d)).toEqual([]);
  });

  it('a confirmed DOWN escalates it (D-021) and clears the blips', () => {
    const d = decideSite(
      site(
        300,
        [home([...timeoutRound(240), ...timeoutRound(300)], intermittentCarry([at(1), at(121), at(241)]))],
        {
          open: openIntermittent(),
        },
      ),
    );
    expect(d).toMatchObject({ kind: 'escalate', status: 'down' });
    expect(blipsOf(d)).toEqual([]);
  });

  it('a DOWN episode leaves no blip behind to count later', () => {
    // Round 0 timed out (a blip), round 60 confirmed the DOWN: the round-0 blip is gone.
    const down = decideSite(
      site(60, [home([...timeoutRound(0), ...timeoutRound(60)], carry({ blips: [at(1)] }))]),
    );
    expect(down.kind).toBe('open');
    expect(blipsOf(down)).toEqual([]);
  });

  it('a slow PROBLEM drop with no blip in the window recovers as before', () => {
    const d = decideSite(
      site(
        300,
        [
          home(
            [...okRound(240), ...okRound(300)],
            carry({ status: 'problem', trigger: 'slow', slowRounds: 3 }),
          ),
        ],
        {
          open: openIntermittent(),
        },
      ),
    );
    expect(d.kind).toBe('recover');
  });

  it('a slow verdict in between doesn’t let an open Intermittent go early (engine review H1)', () => {
    // The carry says slow now (the latest verdict), the drop is still the Intermittent one.
    const d = decideSite(
      site(
        480,
        [
          home(
            [...okRound(420), ...okRound(480)],
            carry({ status: 'problem', trigger: 'slow', slowRounds: 3, blips: [at(1), at(121), at(241)] }),
          ),
        ],
        {
          open: openIntermittent(),
        },
      ),
    );
    expect(d).toMatchObject({ kind: 'none', status: null });
  });

  it('the round exactly 30 min after the last blip is the first clear of it (engine review L1)', () => {
    const held = decideSite(
      site(1980, [home([...okRound(1920), ...okRound(1980)], intermittentCarry([at(241)]))], {
        open: openIntermittent(),
      }),
    );
    expect(held.kind).toBe('none');
    const clear = decideSite(
      site(2040, [home([...okRound(1980), ...okRound(2040)], intermittentCarry([at(241)]))], {
        open: openIntermittent(),
      }),
    );
    expect(clear.kind).toBe('recover');
  });

  it('a PROBLEM AGAIN never starts before the recovery it follows (engine review M1)', () => {
    // Blips at 1 and 121 came while an earlier drop was open; it recovered (Monitoring) before 240.
    const d = decideSite(
      site(300, [home([...okRound(240), ...timeoutRound(300)], carry({ blips: [at(1), at(121)] }))], {
        lastRoundAt: at(240),
        open: openIntermittent({ state: 'monitoring' }),
      }),
    );
    expect(d).toMatchObject({ kind: 'relapse', trigger: 'intermittent', startedAt: at(300) });
  });

  it('the 3rd blip, then a DOWN the next round: PROBLEM first, then escalate from the 3rd blip’s timeout', () => {
    const d = decideSite(
      site(
        300,
        [home([...timeoutRound(240), ...timeoutRound(300)], intermittentCarry([at(1), at(121), at(241)]))],
        {
          open: openIntermittent(),
        },
      ),
    );
    expect(d).toMatchObject({ kind: 'escalate', downStartedAt: at(241) });
  });

  it('a WAF round one location decided: BKK’s timeout alone is a blip (D-027)', () => {
    const waf = { outcome: 'blocked' as const, statusCode: 403, error: null, waf: 'cloudflare' as const };
    const round = (base: number) => [
      check('BKK', 'fail', base + 1),
      check('SIN', 'blocked', base + 1, waf),
      check('TYO', 'blocked', base + 2, waf),
      recheck('BKK', base + 31),
    ];
    const okWaf = (base: number) => [
      check('BKK', 'pass', base + 1),
      check('SIN', 'blocked', base + 1, waf),
      check('TYO', 'blocked', base + 2, waf),
    ];
    const d = decideSite(
      site(240, [home([...okWaf(180), ...round(240)], carry({ blips: [at(1), at(121)] }))], {
        behindWaf: true,
      }),
    );
    expect(d).toMatchObject({ kind: 'problem', trigger: 'intermittent', detail: { locations: ['BKK'] } });
  });

  it('blips hold any open PROBLEM drop, keyed on the drop', () => {
    const d = decideSite(
      site(
        300,
        [
          home(
            [...timeoutRound(240), ...okRound(300)],
            carry({ status: 'problem', trigger: 'slow', slowRounds: 3, blips: [at(241)] }),
          ),
        ],
        // A slow PROBLEM incident, and the home page timed out one round ago: not over yet.
        { open: openIntermittent() },
      ),
    );
    expect(d).toMatchObject({ kind: 'none', status: null });
  });

  it('a key page timing out on and off is never Intermittent (the home page only)', () => {
    const key = home([...okRound(180), ...timeoutRound(240)], carry({ blips: [at(1), at(121)] }), {
      id: 'booking',
      isPrimary: false,
      url: 'https://eneos.example/booking',
    });
    const d = decideSite(site(240, [home([...okRound(180), ...okRound(240)]), key]));
    expect(d.kind).toBe('none');
    expect(blipsOf(d, 'booking')).toEqual([]);
  });

  it('INC-0035 DxT Games (Tier 3): three 5-minute blips inside 30 min open it', () => {
    // Ticks every 300 s: blips at 0, 600, 1200 (OK rounds at 300 and 900).
    const d = decideSite(
      site(1200, [home([...okRound(900), ...timeoutRound(1200)], carry({ blips: [at(1), at(601)] }))], {
        intervalSec: 300,
        lastRoundAt: at(900),
        now: at(1200 + 400),
      }),
    );
    expect(d).toMatchObject({ kind: 'problem', trigger: 'intermittent', startedAt: at(1) });
  });

  it('a monitor carry from before D-050 (no blips) starts counting from none', () => {
    const { blips: _, ...old } = NEW_MONITOR;
    const d = decideSite(site(0, [home([...okRound(-60), ...timeoutRound(0)], old)]));
    expect(blipsOf(d)).toEqual([at(1)]);
  });
});
