import 'server-only';
import { episodesFromTimeline, outageMinutes, type Episode } from '@dxt/engine';
import {
  buildAcknowledgedAlert,
  buildAcknowledgedEmail,
  buildAgainAlert,
  buildAgainEmail,
  buildAutoResolvedAlert,
  buildAutoResolvedEmail,
  buildFlapSummaryAlert,
  buildFlapSummaryEmail,
  buildNoteAlert,
  buildResolvedAlert,
  buildResolvedEmail,
  buildDownAlert,
  buildDownEmail,
  buildProblemAlert,
  buildProblemEmail,
  buildRecoveredAlert,
  buildRecoveredEmail,
  buildSystemAlertEmail,
  type ChatMessage,
  type ChatPerson,
  type EmailBaseInput,
  type EmailMessage,
  type EmailReason,
  type KeyPageFacts,
  type ProblemFacts,
  type VerifierDownReason,
} from '@dxt/notifier';
import {
  clockMinutes,
  confirmedByWafOf,
  PROBE_LOCATIONS,
  ROOT_CAUSE_CATEGORIES,
  ROOT_CAUSE_LABELS,
  TIER_CONFIG,
  type ProbeLocation,
  type RootCauseCategory,
  type Tier,
} from '@dxt/shared';
import {
  contextOf,
  type IncidentFacts,
  type Notification,
  type Recipient,
  type SystemAlertFacts,
} from './facts';

const person = (p: IncidentFacts['sites']['primary']): ChatPerson | null =>
  p ? { name: p.display_name, chatUserId: p.google_chat_user_id } : null;

const str = (v: unknown, fallback: string) => (typeof v === 'string' ? v : fallback);
const num = (v: unknown, fallback: number) => (typeof v === 'number' ? v : fallback);

export const incidentUrl = (appUrl: string, incidentId: string) =>
  new URL(`/incidents/${incidentId}`, appUrl).toString();

/** A PROBLEM incident's replies say "still slow" / "problem cleared" instead of the DOWN wording. */
function problemOf(i: IncidentFacts, ctx: Record<string, unknown> = {}): ProblemFacts | null {
  if (i.severity !== 'problem') return null;
  const tier = (i.sites.tier >= 1 && i.sites.tier <= 3 ? i.sites.tier : 2) as Tier;
  // The engine stores the monitor's own limit with RECOVERED; the tier's otherwise.
  const own = typeof ctx.slowLimitMs === 'number' ? ctx.slowLimitMs : null;
  return { trigger: i.trigger, slowLimitMs: own ?? TIER_CONFIG[tier].slowThresholdMs };
}

const dateOf = (v: unknown): Date | null =>
  typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? new Date(v) : null;

/**
 * The incident's drops from its timeline (D-024), each with its own severity — the same drops uptime
 * reads (S06): a D-021 incident's PROBLEM before the outage is a PROBLEM drop, a D-023 key-page drop
 * on a DOWN incident too. D-033: "down X" totals count the DOWN drops only.
 */
function dropsOf(i: IncidentFacts): Episode[] {
  return episodesFromTimeline(i, i.incident_events ?? []);
}

/** How long it had been down at `at` (D-033's one number: DOWN drops only), for ACKNOWLEDGED "so far". */
function outageAt(i: IncidentFacts, at: Date): number | null {
  const upTo = dropsOf(i)
    .filter((d) => d.start <= at)
    .map((d) => ({ ...d, end: d.end && d.end < at ? d.end : at }));
  return outageMinutes(upTo, at);
}

const closedDrops = (i: IncidentFacts) =>
  dropsOf(i).flatMap((d) => (d.end ? [{ start: d.start, end: d.end, severity: d.severity }] : []));

/** A DOWN summary once any drop was an outage; a PROBLEM one only when nothing went down. */
const summarySeverity = (i: IncidentFacts): 'down' | 'problem' =>
  dropsOf(i).some((d) => d.severity === 'down') ? 'down' : 'problem';

/**
 * The drop a RECOVERED row ends (its own recovery time, else the incident's latest), with the severity
 * and trigger of that drop (S06 review N3): a key page's PROBLEM recovering on a DOWN incident (D-023)
 * reads "back to normal · problem for X", not "is back · down X".
 */
function recoveryOf(
  i: IncidentFacts,
  ctx: Record<string, unknown>,
): { start: Date; end: Date; severity: 'down' | 'problem'; trigger: IncidentFacts['trigger'] } | null {
  const end = dateOf(ctx.recoveredAt) ?? dateOf(i.recovered_at);
  if (!end) return null;
  const drop = dropsOf(i).find((d) => d.end && d.end.getTime() === end.getTime());
  const start = drop?.start ?? new Date(i.started_at);
  const relapse = i.incident_events?.find(
    (e) => e.type === 'relapsed' && dateOf(contextOf(e.payload).startedAt)?.getTime() === start.getTime(),
  );
  const relapseTrigger = relapse ? contextOf(relapse.payload).trigger : undefined;
  return {
    start,
    end,
    severity: drop?.severity ?? i.severity,
    trigger: (typeof relapseTrigger === 'string' ? relapseTrigger : i.trigger) as IncidentFacts['trigger'],
  };
}

/** problemOf for the drop that recovered (N3). */
const dropProblem = (
  i: IncidentFacts,
  drop: { severity: 'down' | 'problem'; trigger: IncidentFacts['trigger'] },
  ctx: Record<string, unknown>,
): ProblemFacts | null =>
  drop.severity === 'problem' ? problemOf({ ...i, severity: 'problem', trigger: drop.trigger }, ctx) : null;

function keyPageOf(v: unknown): KeyPageFacts | null {
  const k = (v ?? {}) as Record<string, unknown>;
  return typeof k.path === 'string' && typeof k.failure === 'string' && typeof k.cause === 'string'
    ? { path: k.path, failure: k.failure, cause: k.cause }
    : null;
}

/** The facts the incident opened with (its `detected` event). */
const openedWith = (i: IncidentFacts) =>
  contextOf(i.incident_events?.find((e) => e.type === 'detected')?.payload ?? null);

/** DOWN AGAIN / PROBLEM AGAIN: who acts now, the drop, the incident's downtime before it. */
function againAlert(n: Notification, i: IncidentFacts): ChatMessage {
  const ctx = contextOf(n.context);
  const droppedAt = dateOf(ctx.startedAt) ?? new Date(n.created_at);
  const down = n.template === 'down_again';
  // "Down 7 min so far" counts the DOWN drops only (D-033); "with a problem … so far" every drop.
  const before = dropsOf(i).filter((d) => d.end && d.end <= droppedAt && (!down || d.severity === 'down'));
  const minutesSoFar = before.reduce((sum, d) => sum + clockMinutes(d.start, d.end!), 0);
  const acked = !!i.acked_at && !!i.acker;
  return buildAgainAlert({
    incidentId: i.id,
    incidentNumber: i.number,
    site: i.sites.name,
    tier: i.sites.tier,
    severity: n.template === 'down_again' ? 'down' : 'problem',
    trigger: (typeof ctx.trigger === 'string' ? ctx.trigger : i.trigger) as IncidentFacts['trigger'],
    // §19.3: whoever acts now — the person who acknowledged, else the L0 person (the owner).
    mention: acked
      ? { name: i.acker!.display_name, chatUserId: i.acker!.google_chat_user_id ?? null }
      : person(i.sites.primary),
    ackedBy: acked ? i.acker!.display_name : null,
    fromState: str(ctx.fromState, 'monitoring'),
    droppedAt,
    backSince: dateOf(ctx.backSince),
    minutesSoFar,
    nowFlapping: ctx.nowFlapping === true,
    flapping: ctx.flapping === true,
    summary: typeof ctx.summary === 'string' ? ctx.summary : null,
    homeBack: ctx.homeBackAt ? keyPageOf(ctx.keyPage) : null,
  });
}

/** RESOLVED (D-033): who, when and the root cause, as `resolve_incident` stored them with the message. */
function resolvedOf(n: Notification, i: IncidentFacts) {
  const ctx = contextOf(n.context);
  const category = str(ctx.category, '');
  return {
    resolvedBy: str(ctx.resolvedBy, 'someone'),
    resolvedAt: dateOf(ctx.resolvedAt) ?? new Date(n.created_at),
    rootCause: (ROOT_CAUSE_CATEGORIES as readonly string[]).includes(category)
      ? ROOT_CAUSE_LABELS[category as RootCauseCategory]
      : category || 'Not given',
    whatHappened: str(ctx.what, ''),
    whatFixedIt: typeof ctx.fix === 'string' && ctx.fix ? ctx.fix : null,
    drops: closedDrops(i),
  };
}

/** The cause line stored when the incident opened (its `detected` event). */
function causeOf(i: IncidentFacts): string | null {
  const detected = i.incident_events?.find((e) => e.type === 'detected');
  const cause = detected ? contextOf(detected.payload).cause : undefined;
  return typeof cause === 'string' ? cause : null;
}

/** "3 of 3 locations": where the problem was seen, of the locations reporting when it opened. */
function seenFrom(ctx: Record<string, unknown>): { count: number; of: number } | null {
  const detail = (ctx.detail ?? {}) as { locations?: unknown; location?: unknown };
  const count = Array.isArray(detail.locations) ? detail.locations.length : detail.location ? 1 : 0;
  const of = typeof ctx.reporting === 'number' ? ctx.reporting : 0;
  return count && of >= count ? { count, of } : null;
}

/** The Google Chat message for a claimed row, or null when its template has nothing to say. */
export function renderChat(n: Notification, i: IncidentFacts, appUrl: string, now: Date): ChatMessage | null {
  const ctx = contextOf(n.context);
  switch (n.template) {
    case 'down':
      return buildDownAlert({
        incidentId: i.id,
        incidentNumber: i.number,
        site: i.sites.name,
        tier: i.sites.tier,
        confirmedAt: new Date(i.detected_at),
        now,
        cause: str(ctx.cause, 'Hard fail'),
        confirmingLocations: num(ctx.confirmingLocations, 2),
        confirmedByWaf: confirmedByWafOf(ctx),
        owner: person(i.sites.primary),
        backup: person(i.sites.backup),
        // MobileAck: the card's link opens the incident ready to acknowledge.
        incidentUrl: `${incidentUrl(appUrl, i.id)}?ack=1`,
      });
    case 'problem':
      return buildProblemAlert({
        incidentId: i.id,
        incidentNumber: i.number,
        site: i.sites.name,
        tier: i.sites.tier,
        trigger: i.trigger,
        detectedAt: new Date(i.detected_at),
        now,
        cause: str(ctx.cause, 'Problem'),
        summary: str(ctx.summary, 'problem'),
        seenFrom: seenFrom(ctx),
        verifier: typeof ctx.verifier === 'string' ? ctx.verifier : null,
        owner: person(i.sites.primary),
        backup: person(i.sites.backup),
        incidentUrl: `${incidentUrl(appUrl, i.id)}?ack=1`,
      });
    case 'acknowledged':
      return buildAcknowledgedAlert({
        incidentId: i.id,
        site: i.sites.name,
        ackedBy: str(ctx.ackedBy, 'someone'),
        ackedAt: new Date(str(ctx.ackedAt, n.created_at)),
        problem: problemOf(i),
      });
    case 'recovered': {
      const drop = recoveryOf(i, ctx);
      if (!drop) return null;
      if (ctx.autoResolved === true) {
        return buildAutoResolvedAlert({
          incidentId: i.id,
          site: i.sites.name,
          flaggedAt: new Date(i.detected_at),
          recoveredAt: drop.end,
          okLocations: num(ctx.okLocations, 2),
          problem: problemOf(i, ctx) ?? { trigger: i.trigger },
          keyPage: keyPageOf(openedWith(i).keyPage),
        });
      }
      return buildRecoveredAlert({
        incidentId: i.id,
        site: i.sites.name,
        startedAt: drop.start,
        recoveredAt: drop.end,
        okLocations: num(ctx.okLocations, 2),
        owner: person(i.sites.primary),
        problem: dropProblem(i, drop, ctx),
      });
    }
    case 'down_again':
    case 'problem_again':
      return againAlert(n, i);
    case 'note':
      return buildNoteAlert({ site: i.sites.name, by: str(ctx.by, 'someone'), text: str(ctx.text, '') });
    case 'resolved':
      return buildResolvedAlert({ incidentId: i.id, site: i.sites.name, ...resolvedOf(n, i) });
    case 'flap_summary': {
      const drops = closedDrops(i);
      return drops.length
        ? buildFlapSummaryAlert({
            incidentId: i.id,
            site: i.sites.name,
            severity: summarySeverity(i),
            owner: person(i.sites.primary),
            drops,
          })
        : null;
    }
    default:
      return null;
  }
}

/**
 * Why this person gets the email (the footer line): the one who acknowledged, the owner, everyone
 * already emailed for RESOLVED (D-033), or — for everyone else — because a Chat alert of the incident
 * couldn't be delivered (D-016).
 */
export function emailReason(n: Notification, i: IncidentFacts): EmailReason {
  if (n.template === 'acknowledged' && contextOf(n.context).ackedById === n.user_id) return 'acked';
  if (i.sites.primary?.id === n.user_id) return 'owner';
  if (n.template === 'resolved') return 'emailed';
  return 'fallback';
}

/** The email for a claimed row and its recipient, or null when its template has nothing to say. */
export function renderEmail(
  n: Notification,
  i: IncidentFacts,
  to: Recipient,
  appUrl: string,
  thread: { threadId: string; startsThread: boolean },
): EmailMessage | null {
  const ctx = contextOf(n.context);
  const base: EmailBaseInput = {
    incidentId: i.id,
    incidentNumber: i.number,
    site: i.sites.name,
    tier: i.sites.tier,
    recipientId: to.id,
    reason: emailReason(n, i),
    incidentUrl: incidentUrl(appUrl, i.id),
    ...thread,
  };
  switch (n.template) {
    case 'down':
      return buildDownEmail({
        ...base,
        confirmedAt: new Date(i.detected_at),
        cause: str(ctx.cause, 'Hard fail'),
        confirmingLocations: num(ctx.confirmingLocations, 2),
        confirmedByWaf: confirmedByWafOf(ctx),
        // A PROBLEM raised to DOWN keeps its acknowledgement (D-021).
        ackedBy: i.state === 'acknowledged' && i.acker ? i.acker.display_name : null,
      });
    case 'problem':
      return buildProblemEmail({
        ...base,
        trigger: i.trigger,
        detectedAt: new Date(i.detected_at),
        cause: str(ctx.cause, 'Problem'),
        summary: str(ctx.summary, 'problem'),
        verifier: typeof ctx.verifier === 'string' ? ctx.verifier : null,
      });
    case 'acknowledged':
      return buildAcknowledgedEmail({
        ...base,
        problem: problemOf(i),
        cause: causeOf(i),
        ackedBy: str(ctx.ackedBy, 'someone'),
        ackedAt: new Date(str(ctx.ackedAt, n.created_at)),
        startedAt: new Date(i.started_at),
        downMinutes: outageAt(i, new Date(str(ctx.ackedAt, n.created_at))),
        confirmedAt: new Date(i.detected_at),
      });
    case 'recovered': {
      const drop = recoveryOf(i, ctx);
      if (!drop) return null;
      if (ctx.autoResolved === true) {
        return buildAutoResolvedEmail({
          ...base,
          trigger: i.trigger,
          flaggedAt: new Date(i.detected_at),
          recoveredAt: drop.end,
          cause: causeOf(i),
          keyPage: keyPageOf(openedWith(i).keyPage),
        });
      }
      return buildRecoveredEmail({
        ...base,
        startedAt: drop.start,
        recoveredAt: drop.end,
        okLocations: num(ctx.okLocations, 2),
        owner: i.sites.primary?.display_name ?? null,
        ack: i.acked_at && i.acker ? { by: i.acker.display_name, at: new Date(i.acked_at) } : null,
        problem: dropProblem(i, drop, ctx),
      });
    }
    case 'resolved':
      return buildResolvedEmail({ ...base, ...resolvedOf(n, i) });
    case 'flap_summary': {
      const drops = closedDrops(i);
      return drops.length
        ? buildFlapSummaryEmail({
            ...base,
            severity: summarySeverity(i),
            drops,
            owner: i.sites.primary?.display_name ?? null,
            ack: i.acked_at && i.acker ? { by: i.acker.display_name, at: new Date(i.acked_at) } : null,
          })
        : null;
    }
    // Only as the D-016 fallback when the Chat reply failed: the reply's own words.
    case 'down_again':
    case 'problem_again': {
      const chat = againAlert(n, i);
      const card = chat.cardsV2[0]!.card;
      const body = card.sections[0]?.widgets[0];
      return buildAgainEmail({
        ...base,
        severity: n.template === 'down_again' ? 'down' : 'problem',
        title: card.header.title,
        body: body && 'textParagraph' in body ? body.textParagraph.text.replace(/&lt;/g, '<') : '',
      });
    }
    default:
      return null;
  }
}

const VERIFIER_DOWN_REASONS: readonly VerifierDownReason[] = ['no_poll', 'not_picked_up', 'lease_expired'];

/** The Admin alert email for a claimed row (D-019), or null for a kind it doesn't know. */
export function renderSystemAlertEmail(
  n: Notification,
  alert: SystemAlertFacts,
  from: string,
): EmailMessage | null {
  const ctx = contextOf(alert.context);
  const sites = Array.isArray(ctx.sites) ? ctx.sites.filter((s): s is string => typeof s === 'string') : [];
  const reason = VERIFIER_DOWN_REASONS.find((r) => r === ctx.reason);
  const active = Array.isArray(ctx.active)
    ? PROBE_LOCATIONS.filter((l: ProbeLocation) => (ctx.active as unknown[]).includes(l))
    : [];
  switch (n.template) {
    case 'verifier_unavailable':
    case 'verifier_backlog':
    case 'probe_locations_low':
    case 'bkk_control_failing':
      return buildSystemAlertEmail({
        alertId: alert.id,
        kind: n.template,
        openedAt: new Date(alert.opened_at),
        sites,
        reason,
        queued: num(ctx.queued, 0),
        active,
        from,
      });
    default:
      return null;
  }
}
