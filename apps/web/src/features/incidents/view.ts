import {
  formatDay,
  formatDuration,
  formatIncidentId,
  formatTier,
  formatTime,
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
  log: { at: string; text: string }[];
}

const ACKABLE: readonly IncidentState[] = ['unacked', 'escalated'];

const str = (v: unknown) => (typeof v === 'string' ? v : null);
const num = (v: unknown) => (typeof v === 'number' ? v : null);

/**
 * Who may acknowledge (D-016): an Admin, or a Responder on a site they own (primary or backup).
 * Display only — the `ack_incident` SQL function (`private.can_ack`) is the rule that counts.
 */
export function canAcknowledge(viewer: Viewer, i: IncidentRow): boolean {
  if (viewer.role === 'admin') return true;
  return (
    viewer.role === 'responder' &&
    (i.sites.primary_owner_id === viewer.id || i.sites.backup_owner_id === viewer.id)
  );
}

const TEMPLATE_WORDS: Record<string, string> = {
  down: 'DOWN',
  problem: 'PROBLEM',
  acknowledged: 'ACKNOWLEDGED',
  recovered: 'RECOVERED',
};

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
        : 'You’re an Admin.';

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
      : `Confirmed by ${num(detected?.payload.confirmingLocations) ?? 2} locations, 2 checks`,
    cause: str(detected?.payload.cause) ?? TRIGGER_LABELS[i.trigger],
    siteUrl: i.sites.monitors.find((m) => m.is_primary)?.url ?? null,
    ack,
    log: logOf(events, nameOf, now),
  };
}

/** The LATEST log (MobileAck board), newest first, in words. */
export function logOf(
  events: readonly EventRow[],
  nameOf: (id: string | null) => string,
  now: Date,
): { at: string; text: string }[] {
  const sorted = [...events].sort((a, b) => b.at.localeCompare(a.at));
  return sorted.flatMap((e, n): { at: string; text: string }[] => {
    const at = formatTime(new Date(e.at));
    switch (e.type) {
      case 'detected':
        // A PROBLEM is detected in one round; only a DOWN is confirmed by locations and a recheck.
        return typeof e.payload.summary === 'string'
          ? [{ at, text: `PROBLEM detected — ${e.payload.summary}` }]
          : [{ at, text: `Confirmed down — ${num(e.payload.confirmingLocations) ?? 2} locations, 2 checks` }];
      case 'alerted': {
        const word = TEMPLATE_WORDS[str(e.payload.template) ?? ''] ?? 'Alert';
        return e.payload.channel === 'email'
          ? [{ at, text: `${word} emailed to ${nameOf(str(e.payload.user_id))}` }]
          : [{ at, text: `${word} posted in Chat` }];
      }
      case 'acknowledged': {
        const postsAt = str(e.payload.posts_at);
        // Newer events come first: an undo after this ack means it never posts.
        const later = sorted.slice(0, n);
        const undone = later.some((l) => l.type === 'ack_undone');
        // An undone ack never posted: a later ack's post belongs to that one.
        const posted = undone
          ? undefined
          : later
              .filter((l) => l.type === 'alerted' && l.payload.template === 'acknowledged')
              .map((l) => l.at)
              .sort()[0];
        const holding = postsAt && !undone && new Date(postsAt) > now && e.payload.notifies !== false;
        const by = `Acknowledged by ${nameOf(e.actor_id)}`;
        return [
          {
            at,
            text: posted
              ? `${by} (posted ${formatTimeWithSeconds(new Date(posted))})`
              : holding
                ? `${by} (posts ${formatTimeWithSeconds(new Date(postsAt))} unless undone)`
                : by,
          },
        ];
      }
      case 'ack_undone':
        return [{ at, text: `Acknowledgement undone by ${nameOf(e.actor_id)}` }];
      case 'recovered':
        return [{ at, text: `Recovered — OK from ${num(e.payload.okLocations) ?? 2} locations` }];
      case 'ok_two_rounds':
        return [{ at, text: 'OK two rounds in a row — needs a root cause' }];
      default:
        return [];
    }
  });
}
