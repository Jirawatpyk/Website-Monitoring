import 'server-only';
import {
  buildSeriesDm,
  buildSeriesEmail,
  buildSeriesLine,
  SERIES_ACTIONS,
  SERIES_DMS,
  SERIES_EMAIL_ROLES,
  type ChatMessage,
  type ChatPerson,
  type EmailMessage,
  type SeriesEvent,
  type SeriesFacts as SeriesWords,
  type SeriesSkip,
} from '@dxt/notifier';
import type { Json } from '@dxt/db';
import { seriesRuleSchema } from '@dxt/shared';
import { contextOf, type Notification, type Owner, type Recipient } from './facts';
import { maintenanceUrl } from './render-window';
import type { SeriesFacts, SeriesFactsRow } from './series-facts';

/**
 * A repeating series' messages (S14, D-057, spec §32.10–11): `ms_line` (the action's line in the
 * series' Space thread), `ms_dm` (a reply @mentioning one person) and `ms_email`, from the series as it
 * is now and the action the RPC or the engine stored with the row (`context`).
 */

const person = (p: Owner | null): ChatPerson | null =>
  p ? { name: p.display_name, chatUserId: p.google_chat_user_id } : null;
const dateOf = (v: unknown): Date | null =>
  typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? new Date(v) : null;
const dates = (v: Json | undefined): Date[] =>
  Array.isArray(v) ? v.flatMap((x) => (dateOf(x) ? [dateOf(x)!] : [])) : [];
const str = (v: unknown) => (typeof v === 'string' ? v : null);
const pick = <T extends string>(v: unknown, of: readonly T[]): T | null =>
  typeof v === 'string' && (of as readonly string[]).includes(v) ? (v as T) : null;

/** The series in the notifier's words, or null when its stored rule can't be read. */
function seriesWords(s: SeriesFactsRow, admins: Owner[], appUrl: string): SeriesWords | null {
  const rule = seriesRuleSchema.safeParse(s.rule);
  if (!rule.success) return null;
  return {
    seriesId: s.id,
    site: s.sites.name,
    tier: s.sites.tier,
    rule: rule.data,
    startTime: s.start_time,
    durationMin: s.duration_min,
    startsOn: s.starts_on,
    untilOn: s.until_on,
    firstStartsAt: dateOf(s.first_starts_at),
    reason: s.reason,
    createdBy: s.creator?.display_name ?? null,
    createdAt: new Date(s.created_at),
    owner: person(s.sites.primary),
    backup: person(s.sites.backup),
    admins: admins.map((a) => person(a)!),
    pageUrl: maintenanceUrl(appUrl),
  };
}

function skipOf(v: Json | undefined): SeriesSkip | null {
  const c = contextOf(v ?? null);
  const startsAt = dateOf(c.startsAt);
  const endsAt = dateOf(c.endsAt);
  if (!startsAt || !endsAt) return null;
  const o = contextOf(c.overlap ?? null);
  const oStart = dateOf(o.startsAt);
  const oEnd = dateOf(o.endsAt);
  return {
    startsAt,
    endsAt,
    next: dateOf(c.next),
    overlap: oStart && oEnd ? { startsAt: oStart, endsAt: oEnd, reason: str(o.reason) ?? '' } : null,
  };
}

/** The action stored with the row; reminders have no action of their own. */
function eventOf(n: Notification): SeriesEvent | null {
  const ctx = contextOf(n.context);
  const action = pick(ctx.kind, SERIES_ACTIONS);
  if (!action) return null;
  return {
    action,
    at: dateOf(ctx.at) ?? new Date(n.created_at),
    by: str(ctx.by),
    reason: str(ctx.reason),
    windows: dates(ctx.windows),
    tooSoon: dates(ctx.tooSoon),
    cancelled: dates(ctx.cancelled),
    running: ctx.running === true,
    skip: action === 'skipped' ? skipOf(n.context) : null,
  };
}

/** The Chat message of a series row, or null when it can't be worded (unknown action or person). */
export function renderSeriesChat(
  n: Notification,
  s: SeriesFactsRow,
  facts: { series: SeriesFacts; recipients: Map<string, Recipient> },
  appUrl: string,
  now: Date,
): ChatMessage | null {
  const f = seriesWords(s, facts.series.admins, appUrl);
  if (!f) return null;
  if (n.template === 'ms_line') {
    const e = eventOf(n);
    return e ? buildSeriesLine(f, e) : null;
  }
  if (n.template === 'ms_dm') {
    const dm = pick(contextOf(n.context).dm, SERIES_DMS);
    const to = n.user_id ? facts.recipients.get(n.user_id) : undefined;
    if (!dm || !to) return null;
    const e = eventOf(n) ?? { action: 'requested' as const, at: new Date(n.created_at), by: null };
    return buildSeriesDm(
      f,
      e,
      dm,
      { name: to.display_name, chatUserId: to.google_chat_user_id ?? null },
      now,
    );
  }
  return null;
}

/** The email of a series row to one person, in the series' mail thread. */
export function renderSeriesEmail(
  n: Notification,
  s: SeriesFactsRow,
  facts: { series: SeriesFacts },
  appUrl: string,
  opts: { from: string; startsThread: boolean; now: Date },
): EmailMessage | null {
  if (n.template !== 'ms_email') return null;
  const f = seriesWords(s, facts.series.admins, appUrl);
  const ctx = contextOf(n.context);
  const role = pick(ctx.role, SERIES_EMAIL_ROLES);
  if (!f || !role) return null;
  const event =
    ctx.kind === 'reminder_12h'
      ? { action: 'reminder_12h' as const, at: new Date(n.created_at), by: null }
      : eventOf(n);
  if (!event) return null;
  return buildSeriesEmail({
    facts: f,
    event,
    role,
    toIsAsker: !!n.user_id && n.user_id === s.created_by,
    request: ctx.request === true,
    from: opts.from,
    startsThread: opts.startsThread,
    now: opts.now,
  });
}
