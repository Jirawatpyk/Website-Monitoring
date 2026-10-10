import {
  clockMinutes,
  formatDuration,
  formatIncidentId,
  formatTier,
  formatTime,
  TRIGGER_LABELS,
  type Trigger,
} from '@dxt/shared';
import { plainName, type ChatMessage, type ChatPerson, type ProblemFacts } from './chat-alerts';
import { buildChatTextLine } from './chat-text';
import { downtime } from './downtime';

/**
 * Google Chat replies of S04b — ChatAlert "Fails again while the incident is open" (spec §19.3–19.7,
 * D-024): DOWN AGAIN / PROBLEM AGAIN (Chat only), the flapping summary that replaces the held
 * RECOVERED replies, and RECOVERED for an auto-resolved PROBLEM. A Tier 2–3 DOWN AGAIN outside
 * response hours adds "outside response hours · timers paused until 09:00" (S08, D-034).
 */

/** One drop of the incident, first failed check → recovery. */
export interface Drop {
  start: Date;
  end: Date;
  /** A PROBLEM part of a mixed incident (D-021 before the outage, D-023 key page); DOWN when unset. */
  severity?: 'down' | 'problem';
}

/**
 * What a flapping summary counts (D-033): flips, span and "stable since" over every drop — a PROBLEM
 * that ran straight into the outage (D-021) is one flip with it — and, for a DOWN summary, the DOWN
 * parts only for "Down N times … X down in total", as uptime counts them (spec §5).
 */
export function flapCounts(drops: readonly Drop[], severity: 'down' | 'problem') {
  const flips: Drop[] = [];
  for (const d of drops) {
    const prev = flips.at(-1);
    if (prev && prev.end.getTime() === d.start.getTime()) flips[flips.length - 1] = { ...prev, end: d.end };
    else flips.push({ ...d });
  }
  const counted = severity === 'down' ? drops.filter((d) => d.severity !== 'problem') : drops;
  const { ranges, minutes } = dropsSummary(counted);
  return {
    flips: flips.length,
    first: flips[0],
    last: flips.at(-1),
    counted: counted.length,
    ranges,
    minutes,
  };
}

/** "Down once" for one drop (D-033), then "Down N times" as the boards. */
export const timesWord = (n: number) => (n === 1 ? 'once' : `${n} times`);

/** A key page's part of a PROBLEM: "/booking", "HTTP 404", "/booking → HTTP 404 (BKK, SIN, TYO)". */
export interface KeyPageFacts {
  path: string;
  failure: string;
  cause: string;
}

export interface AgainAlertInput {
  incidentId: string;
  incidentNumber: number;
  site: string;
  tier: number;
  severity: 'down' | 'problem';
  trigger: Trigger;
  /** Whoever acts now: the person who acknowledged, else the owner (the L0 person). */
  mention: ChatPerson | null;
  /** Set when someone acknowledged earlier: "Nok acknowledged earlier, so only Nok is mentioned." */
  ackedBy: string | null;
  /** Where the incident was when the site failed again. */
  fromState: string;
  /** The drop's first failed check. */
  droppedAt: Date;
  /** The recovery before it: "was back for 5 min (03:19–03:24)". */
  backSince: Date | null;
  /** Minutes down (or with a problem) in this incident before this drop: "Down 7 min so far". */
  minutesSoFar: number;
  /** This drop tagged the incident flapping ("Now flapping …"); `flapping`: it is (or was) tagged. */
  nowFlapping: boolean;
  flapping: boolean;
  /** PROBLEM AGAIN: the short cause, "slow, p50 5.4 s". */
  summary?: string | null;
  /** D-023 / §19.7: the home page came back but this key page still fails (same round as RECOVERED). */
  homeBack?: KeyPageFacts | null;
  /** Tier 2–3 outside response hours (S08): when the timers run again. */
  pausedUntil?: Date | null;
}

const STATE_WORDS: Record<string, string> = {
  monitoring: 'Monitoring',
  needs_root_cause: 'Needs root cause',
  // D-023: the home page down again while a key page's PROBLEM was still open.
  unacked: 'Unacked',
  escalated: 'Escalated',
  acknowledged: 'Acknowledged',
};

/** "slow, p50 5.4 s" → "slow again, p50 5.4 s"; the head alone for a title. */
function again(summary: string): { line: string; head: string } {
  const i = summary.indexOf(', ');
  return i < 0
    ? { line: `${summary} again`, head: summary }
    : { line: `${summary.slice(0, i)} again${summary.slice(i)}`, head: summary.slice(0, i) };
}

/**
 * DOWN AGAIN / PROBLEM AGAIN reply in the incident's thread (ChatAlert VOCA 03:24 / 03:38,
 * INC-0150, INC-0152). Mentions only whoever acts now; no card button (a reply, like ACKNOWLEDGED).
 */
export function buildAgainAlert(input: AgainAlertInput): ChatMessage {
  const site = plainName(input.site);
  const inc = formatIncidentId(input.incidentNumber);
  const down = input.severity === 'down';
  const state = down ? 'DOWN AGAIN' : 'PROBLEM AGAIN';
  const still = input.flapping && !input.nowFlapping;
  const held = `recovery replies are${still ? ' still' : ''} held until ${site} stays OK for 15 min.`;
  const flapNote = input.nowFlapping ? ` Now flapping (3 changes in 30 min): ${held}` : '';
  const back = input.backSince ? downtime(input.backSince, input.droppedAt) : null;
  const where = STATE_WORDS[input.fromState] ?? 'Monitoring';
  const ack = input.ackedBy ? plainName(input.ackedBy) : null;

  let detail: string[];
  let title: string;
  let body: string;
  if (input.homeBack) {
    const k = input.homeBack;
    detail = [`${k.path} still failing (${k.failure}) after the home page came back`, `same incident ${inc}`];
    title = `${state} · ${site} · ${k.path} still failing after the home page came back`;
    body =
      `Home page OK again (RECOVERED posted in the same round). ${k.cause} — the same incident ` +
      `continues as a PROBLEM (${TRIGGER_LABELS[input.trigger]}).`;
  } else if (down) {
    detail = [
      `same incident ${inc}`,
      ...(still ? ['still flapping'] : []),
      ...(input.pausedUntil
        ? ['outside response hours', `timers paused until ${formatTime(input.pausedUntil)}`]
        : []),
    ];
    title = back
      ? `${state} · ${site} · was back for ${back.duration} (${back.range})`
      : `${state} · ${site}`;
    const soFar = `Down ${formatDuration(input.minutesSoFar)} so far in this incident.`;
    body = still
      ? `Still flapping — ${held} ${soFar}`
      : `Joined ${inc} — no new incident (the incident was still open, in ${where}). ${soFar}${flapNote}`;
  } else {
    const s = again(input.summary ?? 'problem');
    detail = [s.line, `same incident ${inc}`, ...(still ? ['still flapping'] : [])];
    title = back ? `${state} · ${site} · ${s.head} again after ${back.duration} OK` : `${state} · ${site}`;
    body = still
      ? `Still flapping — ${held}`
      : `Joined ${inc} while it was still open (${where}).` +
        (ack ? ` ${ack} acknowledged earlier, so only ${ack} is mentioned.` : '') +
        flapNote;
  }

  return {
    text: buildChatTextLine({
      state,
      site: `${site} (${formatTier(input.tier)})`,
      mention: input.mention?.chatUserId ? [input.mention.chatUserId] : [],
      detail,
    }),
    cardsV2: [
      {
        cardId: `${down ? 'down' : 'problem'}-again-${input.incidentId}-${input.droppedAt.getTime()}`,
        card: { header: { title }, sections: [{ widgets: [{ textParagraph: { text: escape(body) } }] }] },
      },
    ],
  };
}

export interface FlapSummaryInput {
  incidentId: string;
  site: string;
  severity: 'down' | 'problem';
  owner: ChatPerson | null;
  drops: readonly Drop[];
}

/** "03:12–03:19 · 03:24–03:35" and the total in whole clock minutes, as `downtime` counts one drop. */
export function dropsSummary(drops: readonly Drop[]): { ranges: string; minutes: number } {
  return {
    ranges: drops.map((d) => downtime(d.start, d.end).range).join(' · '),
    minutes: drops.reduce((sum, d) => sum + clockMinutes(d.start, d.end), 0),
  };
}

/**
 * The flapping summary (ChatAlert VOCA 04:19): one RECOVERED after 15 min of continuous OK instead
 * of a RECOVERED reply per drop. Mentions the owner (they add the root cause).
 */
export function buildFlapSummaryAlert(input: FlapSummaryInput): ChatMessage {
  const site = plainName(input.site);
  const { flips: n, first, last, counted, ranges, minutes } = flapCounts(input.drops, input.severity);
  const total = formatDuration(minutes);
  const down = input.severity === 'down';
  const span = first && last ? downtime(first.start, last.end).range : '';
  const stable = last ? formatTime(last.end) : '';
  return {
    text: buildChatTextLine({
      state: 'RECOVERED',
      site,
      mention: input.owner?.chatUserId ? [input.owner.chatUserId] : [],
      detail: [
        'stable 15 min',
        `flapped ×${n}, ${down ? `down ${total}` : `problem ${total}`} in total`,
        'add a root cause',
      ],
    }),
    cardsV2: [
      {
        cardId: `flap-summary-${input.incidentId}`,
        card: {
          header: { title: `RECOVERED · ${site} stable since ${stable} · flapped ×${n} (${span})` },
          sections: [
            {
              widgets: [
                {
                  textParagraph: {
                    text:
                      `${down ? 'Down' : 'Had a problem'} ${timesWord(counted)}: ${ranges} — ${total} ${down ? 'down ' : ''}in total. ` +
                      'Needs a root cause before it can be resolved.',
                  },
                },
              ],
            },
          ],
        },
      },
    ],
  };
}

export interface AutoResolvedAlertInput {
  incidentId: string;
  site: string;
  /** When the PROBLEM was flagged: "cleared 3 min after it was flagged" (spec §19.6). */
  flaggedAt: Date;
  recoveredAt: Date;
  okLocations: number;
  problem: ProblemFacts;
  /** A key page's PROBLEM: "/contact loads again … (it returned HTTP 500 while the home page stayed OK)". */
  keyPage?: KeyPageFacts | null;
}

/**
 * RECOVERED for an auto-resolved PROBLEM (ChatAlert INC-0151, spec §19.6): no @mention — nothing for
 * anyone to do — and no root cause needed.
 */
export function buildAutoResolvedAlert(input: AutoResolvedAlertInput): ChatMessage {
  const site = plainName(input.site);
  const { duration } = downtime(input.flaggedAt, input.recoveredAt);
  const k = input.keyPage;
  const what = k ? `${site} ${k.path}` : site;
  const slow = input.problem.trigger === 'slow' && input.problem.slowLimitMs;
  const back = k
    ? `${k.path} loads again from ${input.okLocations} locations (it returned ${k.failure} while the home page stayed OK).`
    : slow
      ? `Response time back under ${Number((input.problem.slowLimitMs! / 1000).toFixed(1))} s from ${input.okLocations} locations.`
      : `OK from ${input.okLocations} locations.`;
  return {
    text: buildChatTextLine({
      state: 'RECOVERED',
      site,
      detail: [
        `${k ? `${k.path} ` : ''}back ${duration} after it was flagged, before anyone acknowledged`,
        'resolved automatically',
      ],
    }),
    cardsV2: [
      {
        cardId: `recovered-${input.incidentId}`,
        card: {
          header: { title: `RECOVERED · ${what} back to normal · cleared ${duration} after it was flagged` },
          sections: [
            {
              widgets: [
                {
                  textParagraph: {
                    text: escape(
                      `${back} Nobody acknowledged it — a PROBLEM that clears within 5 min of being flagged, ` +
                        'with no acknowledgement, auto-resolves on the first OK round. ' +
                        'Resolved automatically — no root cause needed.',
                    ),
                  },
                },
              ],
            },
          ],
        },
      },
    ],
  };
}

/** Card text carries probe facts (paths, errors): `<` never starts a tag. */
const escape = (text: string) => text.replace(/</g, '&lt;');
