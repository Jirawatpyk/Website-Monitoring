import 'server-only';
import type { DbClient, Json } from '@dxt/db';
import { seriesRuleSchema, seriesRepeatText } from '@dxt/shared';
import type { Notification, Owner } from './facts';

/** A repeating series and its people, for its messages (S14, D-057, spec §32.10–11). */
export interface SeriesFactsRow {
  id: string;
  rule: Json;
  start_time: string;
  duration_min: number;
  starts_on: string;
  until_on: string | null;
  first_starts_at: string | null;
  reason: string;
  created_at: string;
  created_by: string | null;
  creator: { display_name: string } | null;
  sites: { name: string; tier: number; primary: Owner | null; backup: Owner | null };
}

export interface SeriesFacts {
  series: Map<string, SeriesFactsRow>;
  /** Every active Admin ("Tao reminded"). */
  admins: Owner[];
  /** `series:user` → the first email that person was really sent about the series (the thread root). */
  firstEmail: Map<string, { id: string }>;
}

/** The repeat words of a stored rule ("every Tue"), or null when it can't be read. */
export function repeatWordsOf(rule: Json | undefined): string | null {
  const parsed = seriesRuleSchema.safeParse(rule);
  return parsed.success ? seriesRepeatText(parsed.data) : null;
}

/** Loads the series of the claimed rows, every active Admin, and who was emailed about each already. */
export async function loadSeriesFacts(db: DbClient, rows: readonly Notification[]): Promise<SeriesFacts> {
  const ids = [...new Set(rows.flatMap((n) => (n.maintenance_series_id ? [n.maintenance_series_id] : [])))];
  const users = [...new Set(rows.flatMap((n) => (n.maintenance_series_id && n.user_id ? [n.user_id] : [])))];
  if (!ids.length) return { series: new Map(), admins: [], firstEmail: new Map() };
  const none = Promise.resolve({ data: [], error: null });
  const [series, admins, sent] = await Promise.all([
    db
      .from('maintenance_series')
      .select(
        `id, rule, start_time, duration_min, starts_on, until_on, first_starts_at, reason, created_at, created_by,
         creator:profiles!maintenance_series_created_by_fkey(display_name),
         sites!inner(name, tier,
           primary:profiles!sites_primary_owner_id_fkey(id, display_name, google_chat_user_id),
           backup:profiles!sites_backup_owner_id_fkey(id, display_name, google_chat_user_id))`,
      )
      .in('id', ids)
      .overrideTypes<SeriesFactsRow[], { merge: false }>(),
    db
      .from('profiles')
      .select('id, display_name, google_chat_user_id')
      .eq('role', 'admin')
      .eq('is_active', true)
      .order('display_name'),
    users.length
      ? db
          .from('notifications')
          .select('id, maintenance_series_id, user_id')
          .eq('channel', 'email')
          .eq('status', 'sent')
          .in('maintenance_series_id', ids)
          .in('user_id', users)
          .order('created_at')
      : none,
  ]);
  if (series.error) throw new Error(`maintenance_series: ${series.error.message}`);
  if (admins.error) throw new Error(`profiles: ${admins.error.message}`);
  if (sent.error) throw new Error(`notifications: ${sent.error.message}`);
  const firstEmail = new Map<string, { id: string }>();
  type Sent = { id: string; maintenance_series_id: string; user_id: string | null };
  for (const e of (sent.data ?? []) as Sent[]) {
    const key = `${e.maintenance_series_id}:${e.user_id}`;
    if (!firstEmail.has(key)) firstEmail.set(key, { id: e.id });
  }
  return {
    series: new Map((series.data ?? []).map((s) => [s.id, s])),
    admins: (admins.data ?? []) as Owner[],
    firstEmail,
  };
}
