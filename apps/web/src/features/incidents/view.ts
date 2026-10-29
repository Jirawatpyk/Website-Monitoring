import {
  confirmedByWafOf,
  formatConfirmedBy,
  formatDay,
  formatDuration,
  formatIncidentId,
  formatTier,
  formatTimeWithSeconds,
  ROLE_LABELS,
  TRIGGER_LABELS,
  UNDO_WINDOW_SEC,
  type IncidentState,
  type Role,
  type Severity,
  type Trigger,
} from '@dxt/shared';
import type { PersonWhoCanAct } from '@/components/states';
import { mayAcknowledge } from './ack-rule';

/** Rows the page reads (RLS as the signed-in person). */
export interface IncidentRow {
  id: string;
  number: number;
  state: IncidentState;
  severity: Severity;
  trigger: Trigger;
  escalation_level: number;
  started_at: string;
  detected_at: string;
  acked_at: string | null;
  acked_by: string | null;
  recovered_at: string | null;
  /** The person L0 paged (S10): the person on call outside response hours, else null (the owner). */
  l0_user_id?: string | null;
  sites: {
    name: string;
    tier: number;
    primary_owner_id: string | null;
    backup_owner_id: string | null;
    monitors: { url: string; is_primary: boolean }[];
  };
}

export interface EventRow {
  type: string;
  at: string;
  actor_id: string | null;
  payload: Record<string, unknown>;
}

export interface Viewer {
  id: string;
  email: string;
  displayName: string;
  role: Role;
  /** Holds the on-call shift right now (S10). */
  onCallNow?: boolean;
}

export type AckState =
  /** Waiting for an ack and this person may give it. */
  | { kind: 'can-ack' }
  /** Waiting for an ack, but not from this person (role or not their site, D-016). */
  | { kind: 'read-only'; title: string; description: string; people: PersonWhoCanAct[] }
  /** Acknowledged: by whom, and — inside the window — when it posts; only the acker may undo. */
  | {
      kind: 'acked';
      byName: string;
      byViewer: boolean;
      postsAt: string;
      /** The Undo window was still open when the page was rendered. */
      windowOpen: boolean;
      notifies: boolean;
      /** When the ACKNOWLEDGED messages went out, and where ("the Chat thread + email"). */
      posted: { at: string; to: string } | null;
    }
  /** Past acknowledging (recovered, resolved …): nothing to do here. */
  | { kind: 'closed' };

export interface IncidentView {
  id: string;
  incidentId: string;
  site: string;
  title: string;
  sub: string;
  state: IncidentState;
  severity: Severity;
  escalationLevel: number;
  recovered: boolean;
  /** "You’re the owner." — only for someone who can act. */
  role: string | null;
  /** "Confirmed down" for a DOWN; "Detected" for a PROBLEM (spec §19: no recheck confirms it). */
  confirmedLabel: string;
  confirmedAt: string;
  confirmedBy: string;
  cause: string;
  siteUrl: string | null;
  ack: AckState;
}

const ACKABLE: readonly IncidentState[] = ['unacked', 'escalated'];

const str = (v: unknown) => (typeof v === 'string' ? v : null);
const num = (v: unknown) => (typeof v === 'number' ? v : null);

/** Who may acknowledge this incident (D-016, `mayAcknowledge`). */
export function canAcknowledge(viewer: Viewer, i: IncidentRow): boolean {
  return mayAcknowledge(viewer, {
    primaryOwnerId: i.sites.primary_owner_id,
    backupOwnerId: i.sites.backup_owner_id,
    tier: i.sites.tier,
    l0UserId: i.l0_user_id ?? null,
  });
}

/**
 * Everything the MobileAck board shows, from stored rows only (spec §14.3, §15.6, §16.8; copy cut
 * per D-016). `names` maps profile ids to display names; `now` is the render time.
 */
export function buildIncidentView(
  i: IncidentRow,
  events: readonly EventRow[],
  viewer: Viewer,
  names: ReadonlyMap<string, string>,
  now: Date,
): IncidentView {
  const site = i.sites.name;
  const recovered = !!i.recovered_at;
  const problem = i.severity === 'problem';
  const started = new Date(i.started_at);
  const end = i.recovered_at ? new Date(i.recovered_at) : now;
  const minutes = Math.max(1, Math.floor((end.getTime() - started.getTime()) / 60_000));
  const detected = events.find((e) => e.type === 'detected');
  const nameOf = (id: string | null) => (id ? (names.get(id) ?? 'someone') : 'someone');

  const isPrimary = i.sites.primary_owner_id === viewer.id;
  const isBackup = i.sites.backup_owner_id === viewer.id;
  const allowed = canAcknowledge(viewer, i);
  const role = !allowed
    ? null
    : isPrimary
      ? 'You’re the owner.'
      : isBackup
        ? 'You’re the backup owner.'
        : viewer.role === 'admin'
          ? 'You’re an Admin.'
          : 'You’re on call.';

  let ack: AckState;
  if (i.state === 'acknowledged' && i.acked_at) {
    // The latest ack (an earlier one may have been undone), whatever order the rows came in.
    const ackEvent = events
      .filter((e) => e.type === 'acknowledged')
      .sort((a, b) => b.at.localeCompare(a.at))[0];
    const posted = events.filter(
      (e) =>
        e.type === 'alerted' &&
        e.payload.template === 'acknowledged' &&
        new Date(e.at) >= new Date(i.acked_at!),
    );
    const viaChat = posted.some((e) => e.payload.channel === 'google_chat');
    const viaEmail = posted.some((e) => e.payload.channel === 'email');
    const postsAt =
      str(ackEvent?.payload.posts_at) ??
      new Date(new Date(i.acked_at).getTime() + UNDO_WINDOW_SEC * 1000).toISOString();
    ack = {
      kind: 'acked',
      byName: nameOf(i.acked_by),
      byViewer: i.acked_by === viewer.id,
      postsAt,
      windowOpen: new Date(postsAt) > now,
      notifies: ackEvent?.payload.notifies !== false,
      posted: posted.length
        ? {
            at: posted.map((e) => e.at).sort()[0]!,
            to: viaChat && viaEmail ? 'the Chat thread + email' : viaChat ? 'the Chat thread' : 'email',
          }
        : null,
    };
  } else if (ACKABLE.includes(i.state)) {
    if (allowed) {
      ack = { kind: 'can-ack' };
    } else {
      const people: PersonWhoCanAct[] = [
        ...(i.sites.primary_owner_id
          ? [{ name: nameOf(i.sites.primary_owner_id), duty: 'owner', status: 'Not acked', urgent: true }]
          : []),
        ...(i.sites.backup_owner_id
          ? [
              {
                name: nameOf(i.sites.backup_owner_id),
                duty: 'backup owner',
                status: 'Not acked',
                urgent: true,
              },
            ]
          : []),
      ];
      ack = {
        kind: 'read-only',
        title:
          viewer.role === 'responder'
            ? 'You can see this, not acknowledge it'
            : `Your role can’t acknowledge (${ROLE_LABELS[viewer.role]})`,
        description:
          viewer.role === 'responder'
            ? `${site} isn’t one of your sites. Its owner, backup or an Admin can acknowledge — ask in the Chat thread.`
            : `${viewer.email} can see this incident but not acknowledge it. Its owner, backup or an Admin can — ask in the Chat thread.`,
        people,
      };
    }
  } else {
    ack = { kind: 'closed' };
  }

  return {
    id: formatIncidentId(i.number),
    incidentId: i.id,
    site,
    title: recovered
      ? `${site} ${problem ? 'is back to normal' : 'is back'}`
      : i.trigger === 'content_change'
        ? `${site} home page changed` // IncidentPageChange (§26.3)
        : i.severity === 'problem'
          ? `${site} has a problem`
          : `${site} is down`,
    sub: [
      recovered ? `${problem ? 'problem' : 'down'} ${formatDuration(minutes)}` : formatDuration(minutes),
      formatTier(i.sites.tier),
      formatDay(started, { weekday: true }),
    ].join(' · '),
    state: i.state,
    severity: i.severity,
    escalationLevel: i.escalation_level,
    recovered,
    role,
    confirmedLabel: problem ? 'Detected' : 'Confirmed down',
    confirmedAt: formatTimeWithSeconds(new Date(i.detected_at)),
    confirmedBy: problem
      ? TRIGGER_LABELS[i.trigger]
      : `Confirmed by ${formatConfirmedBy(num(detected?.payload.confirmingLocations) ?? 2, confirmedByWafOf(detected?.payload))}`,
    cause: str(detected?.payload.cause) ?? TRIGGER_LABELS[i.trigger],
    siteUrl: i.sites.monitors.find((m) => m.is_primary)?.url ?? null,
    ack,
  };
}
