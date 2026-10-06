import 'server-only';
import {
  buildAcknowledgedAlert,
  buildAcknowledgedEmail,
  buildDownAlert,
  buildDownEmail,
  buildRecoveredAlert,
  buildRecoveredEmail,
  type ChatMessage,
  type ChatPerson,
  type EmailBaseInput,
  type EmailMessage,
  type EmailReason,
} from '@dxt/notifier';
import { contextOf, type IncidentFacts, type Notification, type Recipient } from './facts';

const person = (p: IncidentFacts['sites']['primary']): ChatPerson | null =>
  p ? { name: p.display_name, chatUserId: p.google_chat_user_id } : null;

const str = (v: unknown, fallback: string) => (typeof v === 'string' ? v : fallback);
const num = (v: unknown, fallback: number) => (typeof v === 'number' ? v : fallback);

export const incidentUrl = (appUrl: string, incidentId: string) =>
  new URL(`/incidents/${incidentId}`, appUrl).toString();

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
    case 'acknowledged':
      return buildAcknowledgedAlert({
        incidentId: i.id,
        site: i.sites.name,
        ackedBy: str(ctx.ackedBy, 'someone'),
        ackedAt: new Date(str(ctx.ackedAt, n.created_at)),
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

/** "DxT Monitor <alerts@notify.example>" → "notify.example". */
export const domainOf = (from: string) => /@([^>\s]+)>?\s*$/.exec(from)?.[1] ?? 'localhost';

/** The email for a claimed row and its recipient, or null when its template has nothing to say. */
export function renderEmail(
  n: Notification,
  i: IncidentFacts,
  to: Recipient,
  appUrl: string,
  messageDomain: string,
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
    messageDomain,
  };
  switch (n.template) {
    case 'down':
      return buildDownEmail({
        ...base,
        confirmedAt: new Date(i.detected_at),
        cause: str(ctx.cause, 'Hard fail'),
        confirmingLocations: num(ctx.confirmingLocations, 2),
      });
    case 'acknowledged':
      return buildAcknowledgedEmail({
        ...base,
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
          })
        : null;
    default:
      return null;
  }
}
