import type { IncidentState, ProbeLocation, SiteStatus, Trigger } from '@dxt/shared';
import { transition } from './lifecycle';
import {
  buildRound,
  confirmedAt,
  downDecided,
  earliest,
  firstFailedCheck,
  isReady,
  roundStarts,
  UNVERIFIED_NOTE,
  type OpenIncident,
  type Round,
  type StoredCheck,
  type UnverifiedReason,
  type Verification,
} from './monitor';
import { BLOCKED_NOTE, confirmsDown, evaluateRound } from './round';
import {
  keywordIssue,
  minuteOf,
  nextFailingSince,
  nextSlowRounds,
  redirectIssue,
  regionalIssue,
  roundP50,
  SLOW_ROUNDS,
  statusIssue,
  type FailingSince,
  type ProblemDetail,
} from './triggers';

/**
 * One engine step for one site (spec §6, §11, §16.4; PRD §5; D-022): judge the oldest unjudged round
 * of every monitor of the site together, turn each monitor's checks into a verdict (OK, PROBLEM with
 * its trigger, or — the primary monitor only — DOWN), and move the site's one open incident. Pure:
 * the runner loads the facts, applies the decision and records `roundAt` so a round is judged once.
 *
 * - Only the primary monitor can make the site DOWN; any problem on a key page is a PROBLEM (`key_page`).
 * - Site status = the worst verdict; while an open incident hasn't recovered, never below its severity.
 * - An incident recovers on the first round every monitor is OK, and settles on the second.
 * - A DOWN never waits: not for a key page, a blocked round's verifier, nor an older incomplete round.
 * - Not here yet: a relapse on a recovered incident (D-004) is flagged `relapse` and logged — S04b.
 */

/** A monitor's carry state from the last judged round (monitor_status). */
export interface MonitorCarry {
  status: Exclude<SiteStatus, 'maintenance'>;
  trigger: Trigger | null;
  /** The worded cause of a problem verdict, kept while the monitor has no new verdict. */
  cause: string | null;
  slowRounds: number;
  failingSince: FailingSince;
}

export const NEW_MONITOR: MonitorCarry = {
  status: 'ok',
  trigger: null,
  cause: null,
  slowRounds: 0,
  failingSince: {},
};

export interface SiteMonitor {
  id: string;
  isPrimary: boolean;
  url: string;
  /** p50 above this for 3 rounds → PROBLEM (Slow): the monitor's own threshold or the tier's. */
  slowThresholdMs: number;
  allowedRedirectDomains: readonly string[];
  checks: readonly StoredCheck[];
  carry: MonitorCarry;
  /** This monitor's verify job of each blocked round, by round start (epoch ms). */
  verifications?: ReadonlyMap<number, Verification>;
}

export interface SiteSnapshot {
  now: Date;
  /** The site's tier interval: one round per interval. */
  intervalSec: number;
  /** Locations expected to report (active and beating). */
  locations: readonly ProbeLocation[];
  /** Start of the last round already judged (site_status.last_round_at). */
  lastRoundAt: Date | null;
  /** OK rounds in a row since the last failure (site_status.ok_rounds). */
  okRounds: number;
  open: OpenIncident | null;
  monitors: readonly SiteMonitor[];
  /** The verifier polled the Job API in the last 2 min (D-019). */
  verifierAvailable?: boolean;
  /** Per probe minute, locations treated as no data (spec §15.3, `faultyByMinute`). */
  faulty?: ReadonlyMap<number, ReadonlySet<ProbeLocation>>;
}

/** A monitor's verdict for the judged round, and its carry state for the next one. */
export interface MonitorState {
  monitorId: string;
  status: Exclude<SiteStatus, 'maintenance'>;
  trigger: Trigger | null;
  /** Set when this round raised the problem: the runner words the cause from it. */
  detail?: ProblemDetail;
  /** The cause kept from an earlier round (no new verdict this round). */
  cause: string | null;
  slowRounds: number;
  failingSince: FailingSince;
}

/** What every judged decision records besides its incident change. */
export interface Judged {
  roundAt: Date;
  monitors: MonitorState[];
  /** The site status worked out from the verdicts; null = keep it (too few locations reported). */
  status: Exclude<SiteStatus, 'maintenance'> | null;
  /** The site note of this round; none clears it. */
  note?: string;
  /** Monitors the verifier couldn't decide this round (the runner expires jobs, alerts the Admin). */
  unverified: { monitorId: string; reason: UnverifiedReason }[];
}

export interface DownFacts {
  monitorId: string;
  /** The recheck results that confirmed it (or the blocked round's checks), for the cause line. */
  failing: readonly StoredCheck[];
  /** The last confirming recheck (or the browser's verdict): "Confirmed down". */
  confirmedAt: Date;
  /** Blocked, then the page failed in the browser: that job (its screenshot is the evidence). */
  verifyJobId?: string;
  browserDetail?: string | null;
}

export type SiteDecision =
  /** No complete round to judge yet: look again next run. */
  | { kind: 'wait' }
  /** Blocked rounds with no job yet: queue one per monitor; the round waits for them. */
  | { kind: 'verify'; roundAt: Date; monitorIds: string[] }
  /** Judged; no incident change. `relapse`: a new problem on a recovered incident (D-004, S04b). */
  | ({ kind: 'none'; okRounds: number; relapse?: true } & Judged)
  /** A PROBLEM and no incident open: open one (spec §15.4). */
  | ({
      kind: 'problem';
      monitorId: string;
      trigger: Trigger;
      detail: ProblemDetail;
      /** When the problem started: its first check (slow: the first slow round). */
      startedAt: Date;
    } & Judged)
  /** DOWN confirmed on the primary's check and recheck (or in the browser): open an incident. */
  | ({ kind: 'open'; startedAt: Date } & DownFacts & Judged)
  /** DOWN confirmed while the open incident is a PROBLEM: raise it to DOWN (D-021). */
  | ({ kind: 'escalate'; downStartedAt: Date } & DownFacts & Judged)
  /** First round every monitor is OK: RECOVERED, incident → Monitoring (spec §16.4). */
  | ({
      kind: 'recover';
      recoveredAt: Date;
      from: IncidentState;
      to: IncidentState;
      okLocations: number;
    } & Judged)
  /** Second OK round in a row: the site is OK; incident → Needs root cause (or stays in Monitoring). */
  | ({ kind: 'settle'; from: IncidentState; to: IncidentState } & Judged);

const RECOVERABLE: readonly IncidentState[] = ['unacked', 'escalated', 'acknowledged'];
const RECOVERED: readonly IncidentState[] = ['monitoring', 'needs_root_cause'];
/** The round waits for a browser verifier job. */
const PENDING = 'pending' as const;

type Verdict =
  | { kind: 'insufficient' }
  /** Not an OK round, but nothing to raise: a failure the recheck cleared, a split round. */
  | { kind: 'blip' }
  | { kind: 'verify' }
  | { kind: 'ok'; reachable: StoredCheck[]; note?: string }
  | { kind: 'problem'; trigger: Trigger; detail: ProblemDetail; startedAt: Date; note?: string }
  | ({ kind: 'down'; startedAt: Date } & Omit<DownFacts, 'monitorId'>);

interface Judgement {
  verdict: Verdict;
  next: Pick<MonitorCarry, 'slowRounds' | 'failingSince'>;
}

export function decideSite(s: SiteSnapshot): SiteDecision {
  const primary = s.monitors.find((m) => m.isPrimary);
  const starts = [
    ...new Set(s.monitors.flatMap((m) => roundStarts(m.checks, s.intervalSec, s.now, s.lastRoundAt))),
  ].sort((a, b) => a - b);
  if (!starts.length) return { kind: 'wait' };

  const rounds = starts.map((start) => {
    const byMonitor = new Map(s.monitors.map((m) => [m.id, buildRound(m.checks, start, s.intervalSec)]));
    const primaryRound = primary ? byMonitor.get(primary.id) : undefined;
    const ready = s.monitors.every((m) => isReady(byMonitor.get(m.id)!, s.locations, s.intervalSec, s.now));
    return { start, byMonitor, ready, primaryDown: !!primaryRound && downDecided(primaryRound) };
  });

  const oldest = rounds[0]!;
  if (oldest.ready || oldest.primaryDown) {
    const d = judgeSiteRound(s, oldest.byMonitor, new Date(oldest.start));
    if (d !== PENDING) return d;
  }
  // A DOWN never waits (spec §6, PRD §9): not for a blocked round's verifier, nor for an older round
  // still missing a location. A later round that confirms DOWN is judged now; the older one it passes
  // over is never judged (its result comes too late to matter).
  for (const later of rounds.slice(1)) {
    if (!later.ready && !later.primaryDown) continue;
    const d = judgeSiteRound(s, later.byMonitor, new Date(later.start));
    if (d !== PENDING && (d.kind === 'open' || d.kind === 'escalate')) return d;
  }
  return { kind: 'wait' };
}

function judgeSiteRound(
  s: SiteSnapshot,
  byMonitor: ReadonlyMap<string, Round>,
  roundAt: Date,
): SiteDecision | typeof PENDING {
  const judged = new Map<string, Judgement | typeof PENDING>();
  for (const m of s.monitors) {
    const round = byMonitor.get(m.id)!;
    // A monitor not ready yet (only when the primary's DOWN is already decided) keeps its state.
    judged.set(
      m.id,
      isReady(round, s.locations, s.intervalSec, s.now)
        ? judgeMonitor(s, m, round)
        : { verdict: { kind: 'insufficient' }, next: m.carry },
    );
  }

  const primary = s.monitors.find((m) => m.isPrimary);
  const primaryJudged = primary ? judged.get(primary.id) : undefined;
  const primaryDown =
    primaryJudged && primaryJudged !== PENDING && primaryJudged.verdict.kind === 'down'
      ? primaryJudged.verdict
      : null;

  if (!primaryDown) {
    if ([...judged.values()].some((j) => j === PENDING)) return PENDING;
    const toVerify = s.monitors.filter((m) => {
      const j = judged.get(m.id);
      return j !== PENDING && j?.verdict.kind === 'verify';
    });
    if (toVerify.length) return { kind: 'verify', roundAt, monitorIds: toVerify.map((m) => m.id) };
  }

  const states: MonitorState[] = [];
  const unverified: Judged['unverified'] = [];
  let note: string | undefined;
  for (const m of s.monitors) {
    const j = judged.get(m.id)!;
    const state = j === PENDING ? keep(m) : stateOf(m, j);
    states.push(state);
    if (j === PENDING) continue;
    const v = j.verdict;
    if (v.kind === 'problem' && v.detail.kind === 'blocked') {
      unverified.push({ monitorId: m.id, reason: v.detail.reason });
    }
    if ((v.kind === 'problem' || v.kind === 'ok') && v.note) {
      // "Blocked, not verified" outranks the OK note.
      if (v.note === UNVERIFIED_NOTE || !note) note = v.note;
    }
  }
  const base = { roundAt, monitors: states, unverified, ...(note ? { note } : {}) };
  const open = s.open;
  const recovered = !!open && RECOVERED.includes(open.state);
  const relapse = recovered ? { relapse: true as const } : {};

  // ── DOWN (primary only) ──
  if (primaryDown && primary) {
    const facts = {
      monitorId: primary.id,
      failing: primaryDown.failing,
      confirmedAt: primaryDown.confirmedAt,
      ...(primaryDown.verifyJobId ? { verifyJobId: primaryDown.verifyJobId } : {}),
      ...(primaryDown.browserDetail !== undefined ? { browserDetail: primaryDown.browserDetail } : {}),
    };
    const judgedDown = { ...base, status: 'down' as const };
    if (open?.severity === 'problem') {
      return { kind: 'escalate', downStartedAt: primaryDown.startedAt, ...facts, ...judgedDown };
    }
    // A confirmed relapse while a DOWN incident is open joins it (D-004) — S04b. Nothing new to open.
    if (open) return { kind: 'none', okRounds: 0, ...relapse, ...judgedDown };
    return { kind: 'open', startedAt: primaryDown.startedAt, ...facts, ...judgedDown };
  }

  const verdicts = s.monitors.map((m) => {
    const j = judged.get(m.id)!;
    return { m, v: j === PENDING ? ({ kind: 'insufficient' } as const) : j.verdict };
  });
  const primaryVerdict = verdicts.find((x) => x.m.isPrimary)?.v ?? { kind: 'insufficient' as const };

  // ── PROBLEM: the primary's first, then the key pages in order ──
  const problem = [...verdicts]
    .sort((a, b) => Number(b.m.isPrimary) - Number(a.m.isPrimary))
    .find((x) => x.v.kind === 'problem');
  if (problem && problem.v.kind === 'problem') {
    const stillDown = !!open && !recovered && open.severity === 'down';
    const status = stillDown ? ('down' as const) : ('problem' as const);
    if (open) return { kind: 'none', okRounds: 0, ...relapse, ...base, status };
    return {
      kind: 'problem',
      monitorId: problem.m.id,
      trigger: problem.v.trigger,
      detail: problem.v.detail,
      startedAt: problem.v.startedAt,
      ...base,
      status,
    };
  }

  // Too few locations reported for the home page: keep the current status (PRD §5).
  if (primaryVerdict.kind === 'insufficient') {
    return { kind: 'none', okRounds: s.okRounds, ...base, status: null };
  }
  // A failure the recheck cleared, or a split round: not an OK round, nothing to raise.
  if (verdicts.some((x) => x.v.kind === 'blip')) {
    return { kind: 'none', okRounds: 0, ...base, status: null };
  }

  // ── Every monitor OK (key pages with no data don't hold it back) ──
  const reachable = primaryVerdict.kind === 'ok' ? primaryVerdict.reachable : [];
  return okRound(s, base, reachable);
}

/** An OK round (a pass majority, or a blocked round the browser verified): recover, settle or count it. */
function okRound(
  s: SiteSnapshot,
  base: Omit<Judged, 'status'>,
  reachable: readonly StoredCheck[],
): SiteDecision {
  const open = s.open;
  if (open && RECOVERABLE.includes(open.state)) {
    const next = transition(open.state, 'recover', open);
    if (next.ok) {
      return {
        kind: 'recover',
        recoveredAt: earliest(reachable),
        from: open.state,
        to: next.state,
        okLocations: reachable.length,
        ...base,
        // PRD §5: the site shows OK only after the second OK round.
        status: open.severity,
      };
    }
  }
  if (open && open.state === 'monitoring' && s.okRounds === 1) {
    const next = transition(open.state, 'ok_two_rounds', open);
    if (next.ok) return { kind: 'settle', from: open.state, to: next.state, ...base, status: 'ok' };
  }
  return { kind: 'none', okRounds: Math.min(s.okRounds + 1, 2), ...base, status: 'ok' };
}

/** One monitor's verdict for one round, and its carry state after it. */
function judgeMonitor(s: SiteSnapshot, m: SiteMonitor, round: Round): Judgement | typeof PENDING {
  const roundAt = round.start;
  // Locations that failed most monitors in a minute are no data for it (spec §15.3).
  const excluded = new Set<ProbeLocation>();
  for (const c of round.scheduled) {
    if (s.faulty?.get(minuteOf(c.checkedAt))?.has(c.location)) excluded.add(c.location);
  }
  const counted = round.scheduled.filter((c) => !excluded.has(c.location));
  const failingSince = nextFailingSince(m.carry.failingSince, counted);
  const carried = { slowRounds: m.carry.slowRounds, failingSince };
  const reset = { slowRounds: 0, failingSince };

  // The rows are already chosen; the window only has to include them all.
  const windowSec = (s.now.getTime() - roundAt.getTime()) / 1000 + s.intervalSec + 60;
  const first = evaluateRound({ results: round.scheduled, now: s.now, windowSec, excluded });

  if (first.kind === 'hard_fail') {
    const firstFail = earliest(round.scheduled.filter((c) => first.failing.includes(c.location)));
    // Only rechecks vote in the second round, each after its own scheduled check: a location that
    // didn't recheck can't vote twice with its scheduled result.
    const second = evaluateRound({
      results: round.rechecks,
      now: s.now,
      windowSec,
      after: firstFail,
      excluded,
    });
    if (!(confirmsDown(first, second) && second.kind === 'hard_fail')) {
      return { verdict: { kind: 'blip' }, next: reset };
    }
    const failing = round.rechecks.filter((c) => second.failing.includes(c.location));
    const startedAt = firstFailedCheck(m.checks, failing);
    if (m.isPrimary) {
      return {
        verdict: { kind: 'down', startedAt, confirmedAt: confirmedAt(failing), failing },
        next: reset,
      };
    }
    // A key page can only raise a PROBLEM (spec §6: only the primary monitor makes a site DOWN).
    return {
      verdict: {
        kind: 'problem',
        trigger: 'key_page',
        startedAt,
        detail: {
          kind: 'hard_fail',
          failing: failing.map((c) => ({ location: c.location, statusCode: c.statusCode, error: c.error })),
        },
      },
      next: reset,
    };
  }

  // An OK round needs a majority of the reporting locations to pass (PRD §5): one pass and one fail
  // is no majority; two passes and a regional failure is.
  const passing = counted.filter((c) => c.outcome === 'pass');
  if (first.kind === 'pass' && passing.length * 2 > counted.length) {
    const p50 = roundP50(counted);
    const slowRounds = nextSlowRounds(m.carry.slowRounds, p50, m.slowThresholdMs);
    const next = { slowRounds, failingSince };
    const issue = problemOf(m, counted, failingSince, slowRounds, p50);
    if (issue) {
      return {
        verdict: {
          kind: 'problem',
          ...issue,
          startedAt: issueStart(issue.detail, counted, roundAt, s, slowRounds),
        },
        next,
      };
    }
    return { verdict: { kind: 'ok', reachable: passing }, next };
  }

  if (first.kind === 'needs_verification') {
    const notPassing = round.scheduled.filter((c) => c.outcome !== 'pass');
    const startedAt = earliest(notPassing);
    const blocked = round.scheduled.filter((c) => c.outcome === 'blocked');
    const unverified = (reason: UnverifiedReason): Judgement => ({
      verdict: {
        kind: 'problem',
        trigger: 'blocked_unverified',
        detail: {
          kind: 'blocked',
          reason,
          locations: blocked.map((c) => c.location),
          statusCode: blocked[0]?.statusCode ?? null,
        },
        startedAt,
        note: UNVERIFIED_NOTE,
      },
      next: reset,
    });
    const v = m.verifications?.get(roundAt.getTime());
    if (!v)
      return s.verifierAvailable ? { verdict: { kind: 'verify' }, next: carried } : unverified('no_poll');
    switch (v.state) {
      case 'pending':
        return PENDING;
      case 'unavailable':
        return unverified(v.reason);
      case 'blocked':
        // PRD §5: a plain browser blocked too is a PROBLEM, never hidden — and never a DOWN (D-020).
        return unverified('browser_blocked');
      case 'loaded':
        // The browser saw the page: the blocked locations count as reachable this round.
        return {
          verdict: {
            kind: 'ok',
            reachable: round.scheduled.filter((c) => c.outcome !== 'fail'),
            note: BLOCKED_NOTE,
          },
          next: reset,
        };
      case 'failed':
        if (!m.isPrimary) {
          return {
            verdict: {
              kind: 'problem',
              trigger: 'key_page',
              startedAt,
              detail: { kind: 'browser', detail: v.detail },
            },
            next: reset,
          };
        }
        return {
          verdict: {
            kind: 'down',
            startedAt,
            confirmedAt: v.completedAt,
            failing: notPassing,
            verifyJobId: v.jobId,
            browserDetail: v.detail,
          },
          next: reset,
        };
    }
  }

  // Too few locations reported: keep the monitor's state. Split or blocked: not an OK round.
  if (first.kind === 'insufficient_data') return { verdict: { kind: 'insufficient' }, next: carried };
  return { verdict: { kind: 'blip' }, next: reset };
}

/** The first PROBLEM trigger of a passing round, in the order a person would fix them. */
function problemOf(
  m: SiteMonitor,
  counted: readonly StoredCheck[],
  failingSince: FailingSince,
  slowRounds: number,
  p50: number | null,
): { trigger: Trigger; detail: ProblemDetail } | null {
  const as = (trigger: Trigger, detail: ProblemDetail | null) =>
    detail ? { trigger: m.isPrimary ? trigger : ('key_page' as const), detail } : null;
  return (
    (m.isPrimary ? null : as('key_page', statusIssue(counted))) ??
    as('keyword', keywordIssue(counted)) ??
    as('redirect', redirectIssue(counted, m.url, m.allowedRedirectDomains)) ??
    (slowRounds >= SLOW_ROUNDS && p50 !== null
      ? as('slow', {
          kind: 'slow',
          p50Ms: p50,
          thresholdMs: m.slowThresholdMs,
          locations: counted.filter((c) => c.outcome === 'pass').map((c) => c.location),
        })
      : null) ??
    as('regional', regionalIssue(counted, failingSince))
  );
}

/** When a problem started: slow at its first slow round, regional at the location's first failure. */
function issueStart(
  detail: ProblemDetail,
  counted: readonly StoredCheck[],
  roundAt: Date,
  s: SiteSnapshot,
  slowRounds: number,
): Date {
  if (detail.kind === 'slow') return new Date(roundAt.getTime() - (slowRounds - 1) * s.intervalSec * 1000);
  if (detail.kind === 'regional') return new Date(detail.since);
  return earliest(counted);
}

function stateOf(m: SiteMonitor, j: Judgement): MonitorState {
  const v = j.verdict;
  const base = { monitorId: m.id, ...j.next };
  switch (v.kind) {
    case 'down':
      return { ...base, status: 'down', trigger: null, cause: null };
    case 'problem':
      return { ...base, status: 'problem', trigger: v.trigger, detail: v.detail, cause: null };
    case 'ok':
      return { ...base, status: 'ok', trigger: null, cause: null };
    default:
      // No new verdict: keep the last one.
      return { ...base, status: m.carry.status, trigger: m.carry.trigger, cause: m.carry.cause };
  }
}

function keep(m: SiteMonitor): MonitorState {
  return {
    monitorId: m.id,
    status: m.carry.status,
    trigger: m.carry.trigger,
    cause: m.carry.cause,
    slowRounds: m.carry.slowRounds,
    failingSince: m.carry.failingSince,
  };
}

/** One primary monitor's view (S02a / S03 shape): `decideMonitor` judges it as a one-monitor site. */
export interface MonitorSnapshot {
  checks: readonly StoredCheck[];
  now: Date;
  intervalSec: number;
  locations: readonly ProbeLocation[];
  lastRoundAt: Date | null;
  okRounds: number;
  open: OpenIncident | null;
  verifications?: ReadonlyMap<number, Verification>;
  verifierAvailable?: boolean;
}

type Bookkeeping = 'monitors' | 'status' | 'unverified' | 'monitorId' | 'monitorIds';
type Stripped<T> = T extends unknown ? Omit<T, Bookkeeping> : never;
export type MonitorDecision = Stripped<SiteDecision>;

/**
 * The primary monitor alone, with no slow threshold or redirect rule: the S02a / S03 round rules as
 * `decideSite` applies them, without the per-monitor bookkeeping. Kept for the round-rule tests.
 */
export function decideMonitor(s: MonitorSnapshot): MonitorDecision {
  const d = decideSite({
    ...s,
    monitors: [
      {
        id: 'primary',
        isPrimary: true,
        url: 'https://primary.invalid/',
        slowThresholdMs: Infinity,
        allowedRedirectDomains: [],
        checks: s.checks,
        carry: NEW_MONITOR,
        ...(s.verifications ? { verifications: s.verifications } : {}),
      },
    ],
  });
  const out: Record<string, unknown> = { ...d };
  for (const key of ['monitors', 'status', 'unverified', 'monitorId', 'monitorIds']) delete out[key];
  return out as MonitorDecision;
}
