import 'server-only';
import {
  buildAcknowledgedAlert,
  buildAcknowledgedEmail,
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
  type ProblemFacts,
  type VerifierDownReason,
} from '@dxt/notifier';
import { PROBE_LOCATIONS, TIER_CONFIG, type ProbeLocation, type Tier } from '@dxt/shared';
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
    case 'recovered':
      return i.recovered_at
        ? buildRecoveredAlert({
            incidentId: i.id,
            site: i.sites.name,
            startedAt: new Date(i.started_at),
            recoveredAt: new Date(i.recovered_at),
            okLocations: num(ctx.okLocations, 2),
            owner: person(i.sites.primary),
            problem: problemOf(i, ctx),
          })
        : null;
    default:
      return null;
  }
}

/**
 * Why this person gets the email (the footer line): the one who acknowledged, the owner, or — for
 * everyone else in S02b — because a Chat alert of the incident couldn't be delivered (D-016).
 */
export function emailReason(n: Notification, i: IncidentFacts): EmailReason {
  if (n.template === 'acknowledged' && contextOf(n.context).ackedById === n.user_id) return 'acked';
  if (i.sites.primary?.id === n.user_id) return 'owner';
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
      });
    case 'acknowledged':
      return buildAcknowledgedEmail({
        ...base,
        problem: problemOf(i),
        cause: causeOf(i),
        ackedBy: str(ctx.ackedBy, 'someone'),
        ackedAt: new Date(str(ctx.ackedAt, n.created_at)),
        startedAt: new Date(i.started_at),
        confirmedAt: new Date(i.detected_at),
      });
    case 'recovered':
      return i.recovered_at
        ? buildRecoveredEmail({
            ...base,
            startedAt: new Date(i.started_at),
            recoveredAt: new Date(i.recovered_at),
            okLocations: num(ctx.okLocations, 2),
            owner: i.sites.primary?.display_name ?? null,
            ack: i.acked_at && i.acker ? { by: i.acker.display_name, at: new Date(i.acked_at) } : null,
            problem: problemOf(i, ctx),
          })
        : null;
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
