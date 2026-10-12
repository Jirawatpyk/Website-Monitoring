import 'server-only';
import { isInsideHours, nextOpening } from '@dxt/engine';
import {
  buildMutedMention,
  buildWindowDm,
  buildWindowEmail,
  buildWindowLine,
  WINDOW_ACTIONS,
  WINDOW_DMS,
  WINDOW_EMAIL_ROLES,
  type ChatMessage,
  type ChatPerson,
  type EmailMessage,
  type WindowEvent,
  type WindowFacts,
} from '@dxt/notifier';
import type { Json } from '@dxt/db';
import { TIER_CONFIG, type Tier } from '@dxt/shared';
import {
  contextOf,
  type Facts,
  type Notification,
  type Owner,
  type Recipient,
  type WindowFactsRow,
} from './facts';
import { incidentUrl } from './render';

/**
 * A maintenance window's messages (S09b, spec §24, D-037): `mw_line` (the action's Space line),
 * `mw_dm` (a reply @mentioning one person) and `mw_email`, each from the window as it is now and the
 * action the RPC or the engine stored with the row (`context`).
 */

const person = (p: Owner | null): ChatPerson | null =>
  p ? { name: p.display_name, chatUserId: p.google_chat_user_id } : null;
const dateOf = (v: unknown): Date | null =>
  typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? new Date(v) : null;
const str = (v: unknown) => (typeof v === 'string' ? v : null);
const pick = <T extends string>(v: unknown, of: readonly T[]): T | null =>
  typeof v === 'string' && (of as readonly string[]).includes(v) ? (v as T) : null;

export const maintenanceUrl = (appUrl: string) => new URL('/maintenance', appUrl).toString();

function windowFacts(w: WindowFactsRow, env: Facts['windowEnv'], appUrl: string): WindowFacts {
  return {
    windowId: w.id,
    site: w.sites.name,
    tier: w.sites.tier,
    startsAt: new Date(w.starts_at),
    endsAt: new Date(w.ends_at),
    reason: w.reason,
    createdBy: w.creator?.display_name ?? null,
    createdAt: new Date(w.created_at),
    approvedBy: w.approver?.display_name ?? null,
    approvedAt: dateOf(w.approved_at),
    owner: person(w.sites.primary),
    backup: person(w.sites.backup),
    admins: (env?.admins ?? []).map((a) => person(a)!),
    pageUrl: maintenanceUrl(appUrl),
  };
}

/** The action stored with the row; reminders have no action of their own (they're DMs and an email). */
function eventOf(
  n: Notification,
  w: WindowFactsRow,
  env: Facts['windowEnv'],
  appUrl: string,
  now: Date,
): WindowEvent | null {
  const ctx = contextOf(n.context);
  const action = pick(ctx.kind, WINDOW_ACTIONS);
  if (!action) return null;
  const number = typeof ctx.incident === 'number' ? ctx.incident : null;
  const incidentId = str(ctx.incidentId);
  // Tier 2–3 outside response hours: the incident's timers are paused (DIDN'T START card, §24.6).
  const alwaysOn = TIER_CONFIG[w.sites.tier as Tier]?.alwaysOn ?? false;
  const hours = env?.hours;
  const pausedUntil = !alwaysOn && hours && !isInsideHours(now, hours) ? nextOpening(now, hours) : null;
  return {
    action,
    at: dateOf(ctx.at) ?? new Date(n.created_at),
    by: str(ctx.by),
    reason: str(ctx.reason),
    from: dateOf(ctx.from),
    to: dateOf(ctx.to),
    incident:
      'incident' in ctx
        ? {
            number,
            severity: ctx.severity === 'problem' ? 'problem' : 'down',
            since: dateOf(ctx.since),
            url: incidentId ? incidentUrl(appUrl, incidentId) : null,
            pausedUntil,
            acked: ctx.acked === true,
          }
        : null,
  };
}

/** The Chat message of a window row, or null when it can't be worded (unknown action or person). */
export function renderWindowChat(
  n: Notification,
  w: WindowFactsRow,
  facts: Pick<Facts, 'windowEnv' | 'recipients'>,
  appUrl: string,
  now: Date,
): ChatMessage | null {
  const f = windowFacts(w, facts.windowEnv, appUrl);
  const ctx = contextOf(n.context);
  if (n.template === 'mw_line') {
    const e = eventOf(n, w, facts.windowEnv, appUrl, now);
    return e ? buildWindowLine(f, e, now) : null;
  }
  if (n.template === 'mw_dm') {
    // Someone else muted the site: one reply @mentioning the owner and the backup together
    // (`context.mention`, D-037 as amended 12 Oct).
    if (ctx.dm === 'muted' && Array.isArray(ctx.mention)) {
      const e = eventOf(n, w, facts.windowEnv, appUrl, now);
      const people = ctx.mention.flatMap((p): ChatPerson[] => {
        const m = contextOf(p as Json);
        return typeof m.name === 'string'
          ? [{ name: m.name, chatUserId: typeof m.chat === 'string' ? m.chat : null }]
          : [];
      });
      return e ? buildMutedMention(f, e, people, now) : null;
    }
    const dm = pick(ctx.dm, WINDOW_DMS);
    const to: Recipient | undefined = n.user_id ? facts.recipients.get(n.user_id) : undefined;
    if (!dm || !to) return null;
    // A reminder carries no action; the DM builder reads the window itself.
    const e = eventOf(n, w, facts.windowEnv, appUrl, now) ?? {
      action: 'requested' as const,
      at: new Date(n.created_at),
      by: null,
    };
    return buildWindowDm(
      f,
      e,
      dm,
      { name: to.display_name, chatUserId: to.google_chat_user_id ?? null },
      now,
    );
  }
  return null;
}

/** The email of a window row to one person, in the window's mail thread. */
export function renderWindowEmail(
  n: Notification,
  w: WindowFactsRow,
  facts: Pick<Facts, 'windowEnv' | 'recipients'>,
  appUrl: string,
  opts: { from: string; startsThread: boolean; now: Date },
): EmailMessage | null {
  if (n.template !== 'mw_email') return null;
  const ctx = contextOf(n.context);
  const role = pick(ctx.role, WINDOW_EMAIL_ROLES);
  if (!role) return null;
  const event =
    ctx.kind === 'reminder_12h'
      ? { action: 'reminder_12h' as const, at: new Date(n.created_at), by: null }
      : eventOf(n, w, facts.windowEnv, appUrl, opts.now);
  if (!event) return null;
  return buildWindowEmail({
    facts: windowFacts(w, facts.windowEnv, appUrl),
    event,
    role,
    // The asker reads "Your request …" (EmailAlert, redrawn 12 Oct).
    toName: n.user_id ? (facts.recipients.get(n.user_id)?.display_name ?? null) : null,
    request: ctx.request === true,
    from: opts.from,
    startsThread: opts.startsThread,
    now: opts.now,
  });
}
