import { failsHere, firstTimeoutRound, isHardFail, isTlsChainFail } from './hard-fail';
import {
  CRAWLER_FRESH_MS,
  type IncidentState,
  type ProbeLocation,
  type Severity,
  type SiteStatus,
  type Trigger,
} from '@dxt/shared';
import { autoResolves, isFlapping, RECOVERED_STATES, stillFlapping, transition } from './lifecycle';
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
import { abstainsOnWafSite, bkkUntrusted, BLOCKED_NOTE, confirmsDown, evaluateRound, wafNote } from './round';
import {
  isRecording,
  ownDomains,
  pageChangeDetail,
  pageChangeState,
  type PageChangeInput,
  type PageChangeState,
} from './page-change';
import {
  BLIP_ROUNDS,
  BLIP_WINDOW_MS,
  crawlerIssue,
  keywordIssue,
  latestPerView,
  liveBlips,
  minuteOf,
  nextFailingSince,
  nextSlowRounds,
  redirectIssue,
  regionalIssue,
  roundP50,
  SLOW_ROUNDS,
  statusIssue,
  type CrawlerFact,
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
 * - Site status = the worst verdict; while an open incident hasn't recovered, never below the
 *   severity of its drop in progress (`episodeSeverity`, D-024).
 * - A DOWN drop recovers on the first round the home page answers again (D-023), a PROBLEM drop on
 *   the first round every monitor is OK; the incident settles on the second.
 * - A new DOWN / PROBLEM on a recovered incident is a relapse into it (D-004, spec §19.3); the 3rd
 *   OK ↔ not-OK change in 30 min tags it flapping, and its recoveries hold one summary instead of
 *   RECOVERED (§19.4). A < 5 min PROBLEM nobody acknowledged auto-resolves (§16.1).
 * - A DOWN never waits: not for a key page, a blocked round's verifier, nor an older incomplete round.
 */

/** A monitor's carry state from the last judged round (monitor_status). */
export interface MonitorCarry {
  status: Exclude<SiteStatus, 'maintenance'>;
  trigger: Trigger | null;
  /** The worded cause of a problem verdict, kept while the monitor has no new verdict. */
  cause: string | null;
  slowRounds: number;
  failingSince: FailingSince;
  /** D-050: the primary's timeout blips of the last 30 min (none = none). */
  blips?: readonly Date[];
}

export const NEW_MONITOR: MonitorCarry = {
  status: 'ok',
  trigger: null,
  cause: null,
  slowRounds: 0,
  failingSince: {},
  blips: [],
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
  /**
   * The primary monitor's latest usable crawler fetch per view (D-041, D-042), already inside the
   * freshness window. A round counts a fetch made before the round ended.
   */
  crawler?: readonly CrawlerFact[];
  /** The primary's page-change facts (S09d, D-046): its baseline and newest plain fetches. */
  pageChange?: PageChangeInput;
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
  /** The site is flagged `behind_waf`: WAF-signed blocks abstain (D-027). */
  behindWaf?: boolean;
  /**
   * The BKK control check has failed in `CONTROL_FAILING_ROUNDS` probe minutes in a row
   * (`bkkControlDown`: any batch of the minute; the open Admin alert only when the window can't
   * tell). Until then a round with nobody left to vote on a WAF site is no data, not PROBLEM (unverified): one VPS
   * hiccup flipped a WAF site between PROBLEM and RECOVERED all day (D-038). As a function, judged
   * at the round's own time and with the Akamai control only for an Akamai site (D-039).
   */
  bkkControlDown?: boolean | ((roundAt: Date, akamaiSite: boolean) => boolean);
  /** Per probe minute, locations treated as no data (spec §15.3, `faultyByMinute`). */
  faulty?: ReadonlyMap<number, ReadonlySet<ProbeLocation>>;
  /** Per probe minute, locations whose response times are no evidence for slow (D-039, `slowLocationsByMinute`). */
  slowLocations?: ReadonlyMap<number, ReadonlySet<ProbeLocation>>;
  /** OK ↔ not-OK changes at incident steps in the last 30 min, and the last one's direction (D-024). */
  flips?: readonly Date[];
  flipOk?: boolean | null;
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
  /** D-050: the timeout blips still in the window (a DOWN clears them). */
  blips: Date[];
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
  /** Behind a WAF (D-027): the locations it blocked, so "Confirmed by" says who confirmed it. */
  wafBlocked?: readonly ProbeLocation[];
}

export type SiteDecision =
  /** No complete round to judge yet: look again next run. */
  | { kind: 'wait' }
  /** Blocked rounds with no job yet: queue one per monitor; the round waits for them. */
  | { kind: 'verify'; roundAt: Date; monitorIds: string[] }
  /** Judged; no incident change. */
  | ({ kind: 'none'; okRounds: number } & Judged)
  /**
   * A new drop on a recovered incident joins it (D-004, spec §19.3): DOWN AGAIN (with the DOWN's
   * facts) or PROBLEM AGAIN. `flapping`: this drop is the 3rd change in 30 min (D-024).
   */
  | ({
      kind: 'relapse';
      severity: Severity;
      monitorId: string;
      trigger: Trigger;
      detail?: ProblemDetail;
      /** The drop's first failed check. */
      startedAt: Date;
      /** "Confirmed down" of a DOWN relapse; the judged round for a PROBLEM. */
      detectedAt: Date;
      flapping: boolean;
      down?: DownFacts;
    } & Judged)
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
  | ({ kind: 'escalate'; downStartedAt: Date; flapping: boolean } & DownFacts & Judged)
  /**
   * The drop is over: RECOVERED, incident → Monitoring (spec §16.4), or Resolved when it
   * auto-resolves (§16.1). `allOk`: every monitor OK (a flip); false for D-023's partial recovery,
   * where a key page still fails. `holdSummary`: flapping, so one summary after 15 min instead.
   */
  | ({
      kind: 'recover';
      recoveredAt: Date;
      from: IncidentState;
      to: IncidentState;
      okLocations: number;
      allOk: boolean;
      autoResolve: boolean;
      holdSummary: boolean;
      /**
       * D-023 partial recovery: what still fails rejoins as PROBLEM AGAIN in the same round, right
       * after RECOVERED (spec §19.7).
       */
      then?: {
        severity: 'problem';
        monitorId: string;
        trigger: Trigger;
        detail: ProblemDetail;
        startedAt: Date;
      };
    } & Judged)
  /** Second OK round in a row: the site is OK; incident → Needs root cause (or stays in Monitoring). */
  | ({ kind: 'settle'; from: IncidentState; to: IncidentState } & Judged);

const RECOVERABLE: readonly IncidentState[] = ['unacked', 'escalated', 'acknowledged'];
/** The round waits for a browser verifier job. */
const PENDING = 'pending' as const;

/**
 * A browser verdict that is an outage (the verifier's details): no answer, its page timeout, a 5xx,
 * or a network error that isn't a certificate error.
 */
const BROWSER_OUTAGE = /^(No response|Page didn’t load|HTTP 5\d\d)|^page\.goto: net::ERR_(?!CERT_)/;

type Verdict =
  | { kind: 'insufficient' }
  /** Not an OK round, but nothing to raise: a failure the recheck cleared, a split round. */
  | { kind: 'blip' }
  | { kind: 'verify' }
  | { kind: 'ok'; reachable: StoredCheck[]; note?: string }
  | {
      kind: 'problem';
      trigger: Trigger;
      detail: ProblemDetail;
      startedAt: Date;
      note?: string;
      /** A passing round with a problem (slow, keyword, …): the page answered from these. */
      reachable?: StoredCheck[];
      /** Decided without the browser that should have looked (D-029): why, for the Admin alert. */
      unverified?: UnverifiedReason;
    }
  | ({ kind: 'down'; startedAt: Date } & Omit<DownFacts, 'monitorId'>);

interface Judgement {
  verdict: Verdict;
  next: Pick<MonitorCarry, 'slowRounds' | 'failingSince'> & { blips: Date[] };
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
    const ready = s.monitors.every((m) => {
      const round = byMonitor.get(m.id)!;
      return isReady(round, s.locations, s.intervalSec, s.now, excludedIn(s, round));
    });
    const primaryDown = !!primaryRound && downDecided(primaryRound, excludedIn(s, primaryRound));
    return { start, byMonitor, ready, primaryDown };
  });

  const oldest = rounds[0]!;
  if (oldest.ready || oldest.primaryDown) {
    const d = judgeSiteRound(s, oldest.byMonitor, new Date(oldest.start));
    // Judged early only for a DOWN: anything else waits for the round to be complete (never used up).
    const early = !oldest.ready && d !== PENDING && !('status' in d && d.status === 'down');
    if (d !== PENDING && !early) return d;
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
      isReady(round, s.locations, s.intervalSec, s.now, excludedIn(s, round))
        ? judgeMonitor(s, m, round)
        : { verdict: { kind: 'insufficient' }, next: { ...m.carry, blips: [...(m.carry.blips ?? [])] } },
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
    } else if (v.kind === 'problem' && v.unverified) {
      unverified.push({ monitorId: m.id, reason: v.unverified });
    }
    if ((v.kind === 'problem' || v.kind === 'ok') && v.note) {
      // "Blocked, not verified" outranks the OK note.
      if (v.note === UNVERIFIED_NOTE || !note) note = v.note;
    }
  }
  const base = { roundAt, monitors: states, unverified, ...(note ? { note } : {}) };
  const open = s.open;
  const recovered = !!open && RECOVERED_STATES.includes(open.state);
  const episode = open ? (open.episodeSeverity ?? open.severity) : null;
  // A new drop on a recovered incident: is it the 3rd change in 30 min (D-024)?
  const flapping = recovered && isFlapping(s.flips ?? [], s.flipOk, roundAt);

  // ── DOWN (primary only) ──
  if (primaryDown && primary) {
    const facts = {
      monitorId: primary.id,
      failing: primaryDown.failing,
      confirmedAt: primaryDown.confirmedAt,
      ...(primaryDown.verifyJobId ? { verifyJobId: primaryDown.verifyJobId } : {}),
      ...(primaryDown.browserDetail !== undefined ? { browserDetail: primaryDown.browserDetail } : {}),
      ...(primaryDown.wafBlocked?.length ? { wafBlocked: primaryDown.wafBlocked } : {}),
    };
    const judgedDown = { ...base, status: 'down' as const };
    if (open?.severity === 'problem') {
      return { kind: 'escalate', downStartedAt: primaryDown.startedAt, flapping, ...facts, ...judgedDown };
    }
    // DOWN AGAIN: the recovered DOWN incident takes the drop (D-004, spec §19.3).
    if (open && recovered) {
      return {
        kind: 'relapse',
        severity: 'down',
        monitorId: primary.id,
        trigger: 'hard_fail',
        startedAt: primaryDown.startedAt,
        detectedAt: primaryDown.confirmedAt,
        flapping,
        down: facts,
        ...judgedDown,
      };
    }
    // D-023: the DOWN ended, a key page carried on as a PROBLEM, and now the home page fails again:
    // a new DOWN drop in the same incident (DOWN AGAIN), never silence (engine review H1).
    if (open && open.severity === 'down' && episode === 'problem') {
      return {
        kind: 'relapse',
        severity: 'down',
        monitorId: primary.id,
        trigger: 'hard_fail',
        startedAt: primaryDown.startedAt,
        detectedAt: primaryDown.confirmedAt,
        flapping: false,
        down: facts,
        ...judgedDown,
      };
    }
    if (open) return { kind: 'none', okRounds: 0, ...judgedDown };
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
    // D-023: a DOWN drop is over once the home page answers again, whatever a key page says.
    // RECOVERED, and what still fails joins as PROBLEM AGAIN in the same round (spec §19.7).
    const homeBack =
      primaryVerdict.kind === 'ok' || (primaryVerdict.kind === 'problem' && !!primaryVerdict.reachable);
    if (open && !recovered && episode === 'down' && homeBack && RECOVERABLE.includes(open.state)) {
      const reachable =
        primaryVerdict.kind === 'ok' || primaryVerdict.kind === 'problem'
          ? (primaryVerdict.reachable ?? [])
          : [];
      const d = recoverDecision(s, open, base, reachable, 'problem', false);
      if (d?.kind === 'recover') {
        return {
          ...d,
          then: {
            severity: 'problem',
            monitorId: problem.m.id,
            trigger: problem.v.trigger,
            detail: problem.v.detail,
            startedAt: problem.v.startedAt,
          },
        };
      }
    }
    // PROBLEM AGAIN: the recovered incident takes the new problem (D-004, D-022 — M1 included).
    if (open && recovered) {
      return {
        kind: 'relapse',
        severity: 'problem',
        monitorId: problem.m.id,
        trigger: problem.v.trigger,
        detail: problem.v.detail,
        startedAt: problem.v.startedAt,
        detectedAt: roundAt,
        flapping,
        ...base,
        status: 'problem',
      };
    }
    const status = open && episode === 'down' ? ('down' as const) : ('problem' as const);
    if (open) return { kind: 'none', okRounds: 0, ...base, status };
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

  // A key page still showing a problem but with no data this round: nobody saw it recover.
  if (verdicts.some((x) => x.v.kind === 'insufficient' && x.m.carry.status !== 'ok')) {
    return { kind: 'none', okRounds: s.okRounds, ...base, status: null };
  }

  // ── Every monitor OK (a key page with no data that was OK doesn't hold it back) ──
  const reachable = primaryVerdict.kind === 'ok' ? primaryVerdict.reachable : [];
  return okRound(s, base, reachable, crawlerClearedAt(s, roundAt));
}

/**
 * D-042: when the home page's keyword / redirect PROBLEM clears on a clean crawler fetch, that fetch is
 * the evidence — RECOVERED never says it recovered before it (S09c /verify: the round's first check
 * came 10–45 s earlier). Null otherwise: the round's own checks are the evidence.
 */
function crawlerClearedAt(s: SiteSnapshot, roundAt: Date): Date | null {
  const m = s.monitors.find((x) => x.isPrimary);
  if (!m || m.carry.status !== 'problem') return null;
  if (m.carry.trigger === 'content_change') {
    const page = pageStateOf(m, s);
    return page?.kind === 'matches' ? page.at : null;
  }
  if (m.carry.trigger !== 'keyword' && m.carry.trigger !== 'redirect') return null;
  const fresh = crawlerFacts(m, s, roundAt).fresh;
  return fresh.length ? new Date(Math.max(...fresh.map((f) => f.checkedAt.getTime()))) : null;
}

/** An OK round (a pass majority, or a blocked round the browser verified): recover, settle or count it. */
function okRound(
  s: SiteSnapshot,
  base: Omit<Judged, 'status'>,
  reachable: readonly StoredCheck[],
  evidenceAt: Date | null = null,
): SiteDecision {
  const open = s.open;
  if (open && RECOVERABLE.includes(open.state)) {
    // PRD §5: the site shows OK only after the second OK round; until then, the drop's severity.
    const d = recoverDecision(
      s,
      open,
      base,
      reachable,
      open.episodeSeverity ?? open.severity,
      true,
      evidenceAt,
    );
    if (d) return d;
  }
  if (open && open.state === 'monitoring' && s.okRounds === 1) {
    const next = transition(open.state, 'ok_two_rounds', open);
    if (next.ok) return { kind: 'settle', from: open.state, to: next.state, ...base, status: 'ok' };
  }
  return { kind: 'none', okRounds: Math.min(s.okRounds + 1, 2), ...base, status: 'ok' };
}

/**
 * The drop is over. A PROBLEM incident nobody acknowledged that recovers < 5 min after it was flagged
 * goes straight to Resolved (spec §16.1 as §19.6 amends it, D-003); a flapping one holds its
 * RECOVERED for one summary after 15 min of continuous OK (spec §19.4).
 */
function recoverDecision(
  s: SiteSnapshot,
  open: OpenIncident,
  base: Omit<Judged, 'status'>,
  reachable: readonly StoredCheck[],
  status: Exclude<SiteStatus, 'maintenance'>,
  allOk: boolean,
  evidenceAt: Date | null = null,
): SiteDecision | null {
  const first = earliest(reachable);
  const recoveredAt = evidenceAt && evidenceAt > first ? evidenceAt : first;
  const flaggedAt = open.detectedAt ?? open.startedAt;
  const autoResolve =
    allOk &&
    !!flaggedAt &&
    (open.episodeSeverity ?? open.severity) === 'problem' &&
    autoResolves({
      severity: open.severity,
      recovered: true,
      acknowledged: !!open.acked,
      minutesToRecover: (recoveredAt.getTime() - flaggedAt.getTime()) / 60_000,
    });
  const next = transition(open.state, autoResolve ? 'auto_resolve' : 'recover', open);
  if (!next.ok) return null;
  return {
    kind: 'recover',
    recoveredAt,
    from: open.state,
    to: next.state,
    okLocations: reachable.length,
    allOk,
    autoResolve,
    // A partial recovery (D-023) is no flip: RECOVERED goes with its PROBLEM AGAIN (spec §19.7).
    holdSummary: allOk && !!open.isFlapping && !autoResolve && stillFlapping(s.flips ?? [], recoveredAt),
    ...base,
    // Auto-resolved: nothing is open any more, so the site shows the verdicts (OK).
    status: autoResolve ? 'ok' : status,
  };
}

/** One monitor's verdict for one round, and its carry state after it. */
function judgeMonitor(s: SiteSnapshot, m: SiteMonitor, round: Round): Judgement | typeof PENDING {
  const roundAt = round.start;
  const excluded = excludedIn(s, round);
  const wafSite = !!s.behindWaf;
  // The rows are already chosen; the window only has to include them all.
  const windowSec = (s.now.getTime() - roundAt.getTime()) / 1000 + s.intervalSec + 60;
  // D-027 rule 2b: the site's WAF is Akamai when any check in the lookback carried its signature —
  // a site property, so the walk back (rule 2c) judges older rows the same way as this round.
  const akamaiSite = wafSite && m.checks.some((c) => c.waf === 'akamai');
  const first = evaluateRound({
    results: round.scheduled,
    now: s.now,
    windowSec,
    excluded,
    wafSite,
    akamaiSite,
  });
  // D-027: behind a WAF, the locations that sat the round out don't count — not for the majority,
  // and not as a regional failure.
  const sittingOut = wafSite
    ? new Set(round.scheduled.filter((c) => abstainsOnWafSite(c, akamaiSite)).map((c) => c.location))
    : new Set<ProbeLocation>();
  const counted = round.scheduled.filter((c) => !excluded.has(c.location) && !sittingOut.has(c.location));
  // A clock of a location that stopped beating is stale: its next failure starts a new one.
  const beating = Object.fromEntries(
    Object.entries(m.carry.failingSince).filter(
      ([l]) => s.locations.includes(l as ProbeLocation) && !excluded.has(l as ProbeLocation),
    ),
  ) as FailingSince;
  const failingSince = nextFailingSince(beating, counted);
  for (const loc of sittingOut) delete failingSince[loc];
  // D-027: one voter decides only when the WAF (or the control check) really sat someone out; a
  // flagged site with everyone voting keeps the majority rules (rule 5: the flag alone gains nothing).
  const wafRound = wafSite && [...sittingOut].some((l) => !excluded.has(l));
  /** The locations the WAF itself blocked this round (not those sat out for the control check). */
  const wafBlocked = wafRound
    ? round.scheduled
        .filter((c) => c.outcome === 'blocked' && c.waf && !excluded.has(c.location))
        .map((c) => c.location)
    : [];
  // D-050: every path carries the blips still in the window; only a timeout blip adds one, a DOWN
  // clears them (`stateOf`).
  const blips = m.isPrimary ? liveBlips(m.carry.blips, roundAt) : [];
  const carried = { slowRounds: m.carry.slowRounds, failingSince, blips };
  const reset = { slowRounds: 0, failingSince, blips };
  const blockedChecks = round.scheduled.filter((c) => c.outcome === 'blocked');
  const unverified = (reason: UnverifiedReason, startedAt: Date): Judgement => ({
    verdict: {
      kind: 'problem',
      // D-022: any problem on a key page is `key_page`; the cause says it was blocked.
      trigger: m.isPrimary ? 'blocked_unverified' : 'key_page',
      detail: {
        kind: 'blocked',
        reason,
        locations: blockedChecks.map((c) => c.location),
        statusCode: blockedChecks[0]?.statusCode ?? null,
      },
      startedAt,
      ...(m.isPrimary ? { note: UNVERIFIED_NOTE } : {}),
    },
    next: reset,
  });

  // Behind a WAF with nobody left to vote and the VPS's control check down (D-027). A single failing
  // minute is no data — the current status holds — until the check has failed long enough to alert
  // the Admin (D-028, D-038). Nobody measured that round, so a slow streak doesn't run across it:
  // "3 in a row" means 3 judged rounds (D-039).
  const controlDown =
    typeof s.bkkControlDown === 'function' ? s.bkkControlDown(roundAt, akamaiSite) : !!s.bkkControlDown;
  const noData: Judgement = { verdict: { kind: 'insufficient' }, next: reset };
  if (first.kind === 'untrusted') {
    if (!controlDown) return noData;
    return unverified(
      'control_failed',
      earliest(round.scheduled.filter((c) => c.outcome !== 'pass')) ?? roundAt,
    );
  }

  if (first.kind === 'hard_fail') {
    const firstFail = earliest(round.scheduled.filter((c) => first.failing.includes(c.location)));
    // Only rechecks vote in the second round, each after its own scheduled check: a location that
    // didn't recheck can't vote twice with its scheduled result. Behind a WAF, a round decided by one
    // location is confirmed by that location's recheck alone (D-027).
    const second = evaluateRound({
      results: round.rechecks,
      now: s.now,
      windowSec,
      after: firstFail,
      excluded,
      wafSite,
      akamaiSite,
      ...(wafSite && counted.length === 1 ? { minReporting: 1 } : {}),
    });
    if (second.kind === 'untrusted') {
      if (!controlDown) return noData;
      return unverified('control_failed', firstFail ?? roundAt);
    }
    if (!(confirmsDown(first, second) && second.kind === 'hard_fail')) {
      return { verdict: { kind: 'blip' }, next: reset };
    }
    const failing = round.rechecks.filter((c) => second.failing.includes(c.location));
    // D-049: a timeout alone is no DOWN (nor a key-page PROBLEM) in its first round — on these sites
    // it was a server stalling for a minute far more often than a site down. It counts once the
    // round just before also hard-failed at enough locations (its own scheduled checks, so a
    // skipped or no-data round can't stand in). A 5xx, a refused connection, DNS or TLS confirm in
    // one round as before.
    const sitsOut = wafSite ? (c: StoredCheck) => abstainsOnWafSite(c, akamaiSite) : undefined;
    if (firstTimeoutRound(failing, round.scheduled, m.checks, roundAt, s.intervalSec, sitsOut)) {
      if (!m.isPrimary) return { verdict: { kind: 'blip' }, next: reset };
      // D-050: the 3rd such blip in 30 min — a site timing out on and off — is a PROBLEM from the 1st.
      const now = liveBlips([...blips, firstFail ?? roundAt], roundAt);
      const next = { ...reset, blips: now };
      if (now.length < BLIP_ROUNDS) return { verdict: { kind: 'blip' }, next };
      return {
        verdict: {
          kind: 'problem',
          trigger: 'intermittent',
          detail: {
            kind: 'intermittent',
            blips: now.length,
            windowMin: BLIP_WINDOW_MS / 60_000,
            locations: failing.map((c) => c.location),
          },
          startedAt: now[0]!,
        },
        next,
      };
    }
    const history = wafSite
      ? m.checks.map((c) => (bkkUntrusted(c, akamaiSite) ? { ...c, outcome: 'blocked' as const } : c))
      : m.checks;
    // A confirming recheck always votes, so it can't be masked; the fallback only guards that.
    const walked = firstFailedCheck(history, failing);
    const startedAt = Number.isFinite(walked.getTime()) ? walked : (earliest(failing) ?? roundAt);
    if (m.isPrimary) {
      return {
        verdict: {
          kind: 'down',
          startedAt,
          confirmedAt: confirmedAt(failing),
          failing,
          ...(wafBlocked.length ? { wafBlocked } : {}),
        },
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

  // D-029: a certificate chain misconfigured at most reporting locations is a PROBLEM in one round —
  // steady until someone fixes it, like a missing keyword. A real hard fail (above) still wins.
  // With chain errors in the round, chain + real failures as a majority is no OK round either: say
  // TLS chain rather than leave it a silent blip (engine review M2). The server answered the
  // handshake, so the home page counts as back for a DOWN drop (D-023, engine review H1).
  const chained = counted.filter(isTlsChainFail);
  const failingHere = counted.filter(failsHere);
  if (chained.length && failingHere.length * 2 > counted.length && failingHere.length >= (wafRound ? 1 : 2)) {
    const startedAt = earliest(chained) ?? roundAt;
    const tlsProblem = (unverifiedReason?: UnverifiedReason): Judgement => ({
      verdict: {
        kind: 'problem',
        trigger: m.isPrimary ? 'tls_chain' : 'key_page',
        detail: { kind: 'tls_chain', code: chained[0]!.error!, locations: chained.map((c) => c.location) },
        startedAt,
        reachable: chained,
        ...(unverifiedReason ? { unverified: unverifiedReason } : {}),
      },
      next: reset,
    });
    // A key page caps at PROBLEM anyway; a VPS its own checks can't vouch for (D-027 rule 2 — on any
    // site here, the browser runs on that VPS) can't decide either.
    const vpsUntrusted =
      round.scheduled.some((c) => c.location === 'BKK' && c.controlOk === false) ||
      (wafSite && round.scheduled.some((c) => bkkUntrusted(c, akamaiSite)));
    if (!m.isPrimary || vpsUntrusted) return tlsProblem();
    // D-029 (Tao, 8 Oct 2026): the failed handshake hides HTTP, so an origin down behind a front end
    // serving the wrong chain would never show. The browser fetches the missing intermediate: it
    // decides — the page loads → TLS chain PROBLEM; it fails → DOWN.
    const v = m.verifications?.get(roundAt.getTime());
    if (!v)
      return s.verifierAvailable ? { verdict: { kind: 'verify' }, next: carried } : tlsProblem('no_poll');
    if (v.state === 'pending') return PENDING;
    if (v.state === 'unavailable') return tlsProblem(v.reason);
    // Only an outage in the browser too is DOWN: no answer, a timeout, a 5xx, a connection error.
    // A certificate error (should Chromium ever not fetch the intermediate), a 4xx (D-022) or a missing
    // keyword stays the TLS chain PROBLEM (engine review N1, N2).
    if (v.state === 'failed' && BROWSER_OUTAGE.test(v.detail ?? '')) {
      return {
        verdict: {
          kind: 'down',
          startedAt,
          confirmedAt: v.completedAt,
          failing: failingHere,
          verifyJobId: v.jobId,
          browserDetail: v.detail,
        },
        next: reset,
      };
    }
    // Loaded, blocked in the browser, or failed for a non-outage reason: the chain is what we know of.
    return tlsProblem();
  }

  // An OK round needs a majority of the reporting locations to pass (PRD §5): one pass and one fail
  // is no majority; two passes and a regional failure is.
  const passing = counted.filter((c) => c.outcome === 'pass');
  // Behind a WAF, `evaluateWafRound` already weighed the voters: a pass stands with one voter passing.
  const okRound = wafRound ? passing.length > 0 : passing.length * 2 > counted.length;
  if (first.kind === 'pass' && okRound) {
    // Behind a WAF a round one location decided is evidence enough for the triggers too (D-027).
    const minLocations = wafRound ? 1 : 2;
    // D-039: a location slow on most sites this minute times itself, not the site — no evidence.
    const timed = counted.filter((c) => !s.slowLocations?.get(minuteOf(c.checkedAt))?.has(c.location));
    const p50 = roundP50(timed, minLocations);
    const slowRounds = nextSlowRounds(m.carry.slowRounds, p50, m.slowThresholdMs);
    const next = { slowRounds, failingSince, blips };
    const crawler = crawlerFacts(m, s, roundAt);
    const issue = problemOf(
      m,
      counted,
      failingSince,
      slowRounds,
      p50,
      minLocations,
      wafRound,
      crawler.fresh,
      pageIssue(m, s),
    );
    if (issue) {
      return {
        verdict: {
          kind: 'problem',
          trigger: issue.trigger,
          detail: issue.detail,
          startedAt: issue.at
            ? issue.trigger === 'content_change'
              ? pageStart(issue.at, s)
              : crawlerStart(issue.at, s)
            : issueStart(issue.detail, counted, roundAt, s, slowRounds),
          reachable: passing,
        },
        next,
      };
    }
    // D-039 (engine review H1): a slow PROBLEM whose only evidence this round was left out isn't over —
    // no evidence, so its state holds, as the streak does; otherwise it would recover (and auto-resolve).
    const slowOpen = m.carry.status === 'problem' && m.carry.slowRounds >= SLOW_ROUNDS;
    if (slowOpen && p50 === null && timed.length < counted.length) {
      return { verdict: { kind: 'insufficient' }, next };
    }
    // D-042: an open keyword / redirect PROBLEM whose view hasn't had a usable fetch since its hit (the
    // site now refuses the fake Googlebot, or the crawler stopped) isn't over — no evidence either way,
    // so it holds until a clean usable fetch replaces the hit.
    if (crawlerHolds(m, s, crawler.stale)) return { verdict: { kind: 'insufficient' }, next };
    // D-046: an open Page change PROBLEM with no usable fetch, or an accept waiting for its Undo, holds.
    if (pageHolds(m, s)) return { verdict: { kind: 'insufficient' }, next };
    // D-050: the OK round between two timeouts isn't the end of an Intermittent PROBLEM.
    if (intermittentHolds(m, s, blips)) return { verdict: { kind: 'insufficient' }, next };
    // Behind a WAF with some locations blocked: say who decided (D-027) — the home page only.
    const note =
      m.isPrimary && wafBlocked.length
        ? wafNote(
            passing.map((c) => c.location),
            wafBlocked,
          )
        : undefined;
    return { verdict: { kind: 'ok', reachable: passing, ...(note ? { note } : {}) }, next };
  }

  if (first.kind === 'needs_verification') {
    const notPassing = round.scheduled.filter((c) => c.outcome !== 'pass' && !isTlsChainFail(c));
    const startedAt = earliest(notPassing);
    const v = m.verifications?.get(roundAt.getTime());
    if (!v)
      return s.verifierAvailable
        ? { verdict: { kind: 'verify' }, next: carried }
        : unverified('no_poll', startedAt);
    switch (v.state) {
      case 'pending':
        return PENDING;
      case 'unavailable':
        return unverified(v.reason, startedAt);
      case 'blocked':
        // PRD §5: a plain browser blocked too is a PROBLEM, never hidden — and never a DOWN (D-020).
        return unverified('browser_blocked', startedAt);
      case 'loaded': {
        // The browser saw the page: the blocked locations count as reachable this round.
        const reachable = round.scheduled.filter((c) => !isHardFail(c));
        // D-042: what a crawler view saw still counts — the probes were only blocked, not answered.
        const crawler = crawlerFacts(m, s, roundAt);
        const viewed = crawlerIssue(crawler.fresh, m.url, m.allowedRedirectDomains);
        if (viewed) {
          return {
            verdict: {
              kind: 'problem',
              trigger: viewed.detail.kind,
              detail: viewed.detail,
              startedAt: crawlerStart(viewed.at, s),
              reachable,
            },
            next: reset,
          };
        }
        // D-046: the page change, as on a passing round (before the crawler's stale hold).
        const page = pageIssue(m, s);
        if (page) {
          return {
            verdict: {
              kind: 'problem',
              trigger: page.trigger,
              detail: page.detail,
              startedAt: pageStart(page.at, s),
              reachable,
            },
            next: reset,
          };
        }
        if (crawlerHolds(m, s, crawler.stale)) return { verdict: { kind: 'insufficient' }, next: reset };
        if (pageHolds(m, s)) return { verdict: { kind: 'insufficient' }, next: reset };
        if (intermittentHolds(m, s, blips)) return { verdict: { kind: 'insufficient' }, next: reset };
        return { verdict: { kind: 'ok', reachable, note: BLOCKED_NOTE }, next: reset };
      }
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

/**
 * D-042: the primary's crawler fetches as a round sees them — per view, the latest usable fetch made
 * before the round ended (a round judged late still sees the one before a newer fetch), split into
 * fresh (≤ 65 min old: raises a problem) and stale (only keeps an open one from recovering).
 */
function crawlerFacts(
  m: SiteMonitor,
  s: SiteSnapshot,
  roundAt: Date,
): { fresh: CrawlerFact[]; stale: CrawlerFact[] } {
  if (!m.isPrimary || !m.crawler?.length) return { fresh: [], stale: [] };
  const roundEnd = roundAt.getTime() + s.intervalSec * 1000;
  const freshFrom = s.now.getTime() - CRAWLER_FRESH_MS;
  const latest = latestPerView(m.crawler, roundEnd);
  return {
    fresh: latest.filter((f) => f.checkedAt.getTime() >= freshFrom),
    stale: latest.filter((f) => f.checkedAt.getTime() < freshFrom),
  };
}

/**
 * D-042: an open PROBLEM incident that hasn't recovered doesn't recover while a view's latest usable
 * fetch is a stale hit (the site now refuses the fake Googlebot, or the crawler stopped) — no data is no
 * evidence the page is clean, whatever trigger the incident shows now (slow may have taken over). A
 * DOWN drop recovers as before: the home page answering is the evidence (D-023).
 */
function crawlerHolds(m: SiteMonitor, s: SiteSnapshot, stale: readonly CrawlerFact[]): boolean {
  const open = s.open;
  if (!m.isPrimary || !open || RECOVERED_STATES.includes(open.state)) return false;
  if ((open.episodeSeverity ?? open.severity) !== 'problem') return false;
  return crawlerIssue(stale, m.url, m.allowedRedirectDomains) !== null;
}

/**
 * A crawler problem starts at its fetch — but never before the round after the last one judged: a
 * fetch made while the site was down or recovering would otherwise start a PROBLEM AGAIN before the
 * recovery it follows.
 */
function crawlerStart(at: Date, s: SiteSnapshot): Date {
  const afterJudged = s.lastRoundAt ? s.lastRoundAt.getTime() + s.intervalSec * 1000 : 0;
  return new Date(Math.max(at.getTime(), afterJudged));
}

/** The primary's page-change state at the snapshot's time (S09d, D-046); null without facts. */
export function pageStateOf(m: SiteMonitor, s: Pick<SiteSnapshot, 'now' | 'open'>): PageChangeState | null {
  if (!m.isPrimary || !m.pageChange) return null;
  return pageChangeState(m.pageChange, {
    now: s.now,
    own: ownDomains(m.url, m.allowedRedirectDomains),
    open: pageProblemOpen(m, s),
  });
}

/**
 * The monitor shows a Page change PROBLEM and the site's incident is still open and hasn't recovered —
 * a carry left over from an incident resolved with a new baseline (§26.7) doesn't count.
 */
function pageProblemOpen(m: SiteMonitor, s: Pick<SiteSnapshot, 'open'>): boolean {
  return (
    m.carry.status === 'problem' &&
    m.carry.trigger === 'content_change' &&
    !!s.open &&
    !RECOVERED_STATES.includes(s.open.state)
  );
}

/**
 * A Page change starts at the first fetch of its run (D-046 item 5, §26.8 "Problem since"): the walk back
 * already stops at a fetch that matched. Only a PROBLEM AGAIN on a recovered incident is clamped to the
 * round after the last one judged, as a crawler problem is (D-042).
 */
function pageStart(at: Date, s: SiteSnapshot): Date {
  return s.open && RECOVERED_STATES.includes(s.open.state) ? crawlerStart(at, s) : at;
}

/**
 * D-050: an open Intermittent PROBLEM holds through OK rounds while a blip is still in the window, so it
 * neither recovers (nor auto-resolves) between two timeouts nor relapses on the next; it recovers on the
 * first OK round 30 min after the last blip. Only that trigger: blips never hold a slow PROBLEM.
 */
function intermittentHolds(m: SiteMonitor, s: SiteSnapshot, blips: readonly Date[]): boolean {
  if (!m.isPrimary || !blips.length) return false;
  if (m.carry.status !== 'problem' || m.carry.trigger !== 'intermittent') return false;
  return !!s.open && !RECOVERED_STATES.includes(s.open.state);
}

/** A Page change PROBLEM to raise or keep: the page differs enough, and its recording is over. */
function pageIssue(
  m: SiteMonitor,
  s: SiteSnapshot,
): { trigger: 'content_change'; detail: ProblemDetail; at: Date } | null {
  const page = pageStateOf(m, s);
  if (page?.kind !== 'differs' || !page.alert || isRecording(m.pageChange!, s.now)) return null;
  return { trigger: 'content_change', detail: pageChangeDetail(page, m.url), at: page.firstSeenAt };
}

/**
 * D-046 item 6: an open Page change PROBLEM doesn't recover without a fetch that matches — no data and an
 * accept still inside its Undo window are no evidence either way.
 */
function pageHolds(m: SiteMonitor, s: SiteSnapshot): boolean {
  if (!pageProblemOpen(m, s)) return false;
  // The runner couldn't read the fingerprints this run: no evidence either way.
  if (m.isPrimary && !m.pageChange) return true;
  const page = pageStateOf(m, s);
  return page?.kind === 'no_data' || page?.kind === 'pending';
}

/** The first PROBLEM trigger of a passing round, in the order a person would fix them. */
function problemOf(
  m: SiteMonitor,
  counted: readonly StoredCheck[],
  failingSince: FailingSince,
  slowRounds: number,
  p50: number | null,
  minLocations = 2,
  wafSite = false,
  crawler: readonly CrawlerFact[] = [],
  page: { trigger: Trigger; detail: ProblemDetail; at: Date } | null = null,
): { trigger: Trigger; detail: ProblemDetail; at?: Date } | null {
  const as = (trigger: Trigger, detail: ProblemDetail | null) =>
    detail ? { trigger: m.isPrimary ? trigger : ('key_page' as const), detail } : null;
  // What only a crawler view saw (primary only, D-042): after the round's own keyword and redirect,
  // which win and carry no view.
  const viewed = crawlerIssue(crawler, m.url, m.allowedRedirectDomains);
  return (
    (m.isPrimary ? null : as('key_page', statusIssue(counted, minLocations))) ??
    as('keyword', keywordIssue(counted, minLocations)) ??
    as('redirect', redirectIssue(counted, m.url, m.allowedRedirectDomains, minLocations)) ??
    (viewed ? { trigger: viewed.detail.kind, detail: viewed.detail, at: viewed.at } : null) ??
    page ??
    (slowRounds >= SLOW_ROUNDS && p50 !== null
      ? as('slow', {
          kind: 'slow',
          p50Ms: p50,
          thresholdMs: m.slowThresholdMs,
          locations: counted.filter((c) => c.outcome === 'pass').map((c) => c.location),
        })
      : null) ??
    as('regional', regionalIssue(counted, failingSince, wafSite))
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

/** Locations that failed most sites in a scheduled check's minute: no data for this round (spec §15.3). */
function excludedIn(s: SiteSnapshot, round: Round): Set<ProbeLocation> {
  const excluded = new Set<ProbeLocation>();
  for (const c of round.scheduled) {
    if (s.faulty?.get(minuteOf(c.checkedAt))?.has(c.location)) excluded.add(c.location);
  }
  return excluded;
}

function stateOf(m: SiteMonitor, j: Judgement): MonitorState {
  const v = j.verdict;
  const base = { monitorId: m.id, ...j.next };
  switch (v.kind) {
    case 'down':
      // D-050: the DOWN supersedes the blips it was waiting on.
      return { ...base, status: 'down', trigger: null, cause: null, blips: [] };
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
    blips: [...(m.carry.blips ?? [])],
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
