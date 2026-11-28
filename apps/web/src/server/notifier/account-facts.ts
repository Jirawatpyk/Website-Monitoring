import 'server-only';
import type { DbClient } from '@dxt/db';
import type { AccountEventKind, AccountFacts } from '@dxt/notifier';
import type { Role } from '@dxt/shared';
import type { Notification } from './facts';

/** An account event as the change froze it (S16 PR 4, spec §34), and its own person's address. */
export interface AccountEventFacts {
  id: string;
  kind: AccountEventKind;
  user_id: string;
  from_role: Role;
  to_role: Role | null;
  created_at: string;
  facts: AccountFacts;
  /** The event's person. Read here, never through `Facts.recipients` (active people only). */
  person: { email: string; is_active: boolean } | null;
}

/**
 * The account events of the claimed rows and their people (D-062 item 13). The person is loaded
 * whether active or not: `deliverAccount` decides, and only a `deactivated` event may go to an
 * inactive person. Nobody else's address is read here.
 */
export async function loadAccountFacts(
  db: DbClient,
  rows: readonly Notification[],
): Promise<Map<string, AccountEventFacts>> {
  const ids = [...new Set(rows.flatMap((n) => (n.account_event_id ? [n.account_event_id] : [])))];
  if (!ids.length) return new Map();
  const events = await db
    .from('account_events')
    .select('id, kind, user_id, from_role, to_role, created_at, facts')
    .in('id', ids);
  if (events.error) throw new Error(`account_events: ${events.error.message}`);
  const userIds = [...new Set((events.data ?? []).map((e) => e.user_id))];
  const people = userIds.length
    ? await db.from('profiles').select('id, email, is_active').in('id', userIds)
    : { data: [], error: null };
  if (people.error) throw new Error(`profiles: ${people.error.message}`);
  const byId = new Map((people.data ?? []).map((p) => [p.id, p]));
  return new Map(
    (events.data ?? []).map((e) => {
      const p = byId.get(e.user_id);
      return [
        e.id,
        {
          id: e.id,
          kind: e.kind as AccountEventFacts['kind'],
          user_id: e.user_id,
          from_role: e.from_role,
          to_role: e.to_role,
          created_at: e.created_at,
          facts: e.facts as unknown as AccountFacts,
          person: p ? { email: p.email, is_active: p.is_active } : null,
        },
      ];
    }),
  );
}
