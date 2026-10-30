import 'server-only';
import type { DbClient } from '@dxt/db';
import type { OncallFacts, OncallKind, Week } from '@dxt/notifier';
import type { Notification } from './facts';

/**
 * What an on-call event's messages say (S10 B2b): the event, its swap and both weeks, a hand-over, the
 * rotation's next weeks, a shift, the test link — read as the service role, since the reasons, notes,
 * the event payload and the test token are hidden from signed-in staff (B0 column grants, D-048 item
 * 10). Nothing here is stored in `notifications.context`.
 */
export interface OncallEventFacts {
  id: string;
  kind: OncallKind;
  at: string;
  by: string | null;
  /** Everyone with a name the event may mention: id → name and Chat id. */
  people: Map<string, { name: string; chatUserId: string | null }>;
  swap?: OncallFacts['swap'] & { id: string };
  handover?: OncallFacts['handover'];
  rotation?: OncallFacts['rotation'];
  shift?: Week;
  shiftHolder?: string;
  /** The test link's token; the URL is built with the app's address at render time. */
  test?: { name: string; token: string | null };
}

type EventRow = {
  id: string;
  kind: OncallKind;
  at: string;
  actor_id: string | null;
  user_id: string | null;
  swap_id: string | null;
  shift_id: string | null;
  payload: Record<string, unknown> | null;
};
type ShiftRow = { id: string; user_id: string; starts_at: string; ends_at: string };
type SwapRow = {
  id: string;
  requester_id: string;
  counterpart_id: string;
  requester_shift_id: string;
  counterpart_shift_id: string;
  reason: string | null;
  response_note: string | null;
  decision_note: string | null;
  decided_by: string | null;
};

const week = (s: ShiftRow | undefined): Week | null =>
  s ? { start: new Date(s.starts_at), end: new Date(s.ends_at) } : null;
const ids = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];

/** Loads the facts of every on-call event among the claimed rows. */
export async function loadOncallFacts(
  db: DbClient,
  rows: readonly Notification[],
): Promise<Map<string, OncallEventFacts>> {
  const eventIds = [...new Set(rows.flatMap((n) => (n.oncall_event_id ? [n.oncall_event_id] : [])))];
  if (!eventIds.length) return new Map();
  const ev = await db
    .from('oncall_events')
    .select('id, kind, at, actor_id, user_id, swap_id, shift_id, payload')
    .in('id', eventIds)
    .overrideTypes<EventRow[], { merge: false }>();
  if (ev.error) throw new Error(`oncall_events: ${ev.error.message}`);
  const events = ev.data ?? [];

  const swapIds = [...new Set(events.flatMap((e) => (e.swap_id ? [e.swap_id] : [])))];
  const swaps = swapIds.length
    ? await db
        .from('oncall_swaps')
        .select(
          'id, requester_id, counterpart_id, requester_shift_id, counterpart_shift_id, reason, response_note, decision_note, decided_by',
        )
        .in('id', swapIds)
        .overrideTypes<SwapRow[], { merge: false }>()
    : { data: [] as SwapRow[], error: null };
  if (swaps.error) throw new Error(`oncall_swaps: ${swaps.error.message}`);

  // The rotation's next weeks: every shift from the earliest event on.
  const since = events.reduce((m, e) => (e.at < m ? e.at : m), events[0]?.at ?? new Date().toISOString());
  const shiftIds = [
    ...new Set([
      ...events.flatMap((e) => (e.shift_id ? [e.shift_id] : [])),
      ...(swaps.data ?? []).flatMap((s) => [s.requester_shift_id, s.counterpart_shift_id]),
    ]),
  ];
  const [shifts, upcoming] = await Promise.all([
    shiftIds.length
      ? db.from('oncall_shifts').select('id, user_id, starts_at, ends_at').in('id', shiftIds)
      : Promise.resolve({ data: [] as ShiftRow[], error: null }),
    events.some((e) => e.kind === 'rotation_changed')
      ? db
          .from('oncall_shifts')
          .select('id, user_id, starts_at, ends_at')
          .gte('starts_at', since)
          .order('starts_at')
      : Promise.resolve({ data: [] as ShiftRow[], error: null }),
  ]);
  if (shifts.error) throw new Error(`oncall_shifts: ${shifts.error.message}`);
  if (upcoming.error) throw new Error(`oncall_shifts: ${upcoming.error.message}`);
  const shiftOf = new Map(((shifts.data ?? []) as ShiftRow[]).map((s) => [s.id, s]));

  const testers = events.flatMap((e) => (e.kind === 'test_alert' && e.user_id ? [e.user_id] : []));
  const checklist = testers.length
    ? await db.from('oncall_checklist').select('user_id, test_token').in('user_id', testers)
    : { data: [] as { user_id: string; test_token: string | null }[], error: null };
  if (checklist.error) throw new Error(`oncall_checklist: ${checklist.error.message}`);
  const tokenOf = new Map((checklist.data ?? []).map((c) => [c.user_id, c.test_token]));

  const personIds = new Set<string>();
  for (const e of events) {
    for (const id of [e.actor_id, e.user_id, typeof e.payload?.from === 'string' ? e.payload.from : null])
      if (id) personIds.add(id);
    for (const id of [...ids(e.payload?.order), ...ids(e.payload?.removed)]) personIds.add(id);
  }
  for (const s of swaps.data ?? [])
    for (const id of [s.requester_id, s.counterpart_id, s.decided_by]) if (id) personIds.add(id);
  for (const n of rows)
    for (const p of Array.isArray((n.context as { people?: unknown } | null)?.people)
      ? ((n.context as { people: { id?: unknown }[] }).people ?? [])
      : [])
      if (typeof p.id === 'string') personIds.add(p.id);
  const profiles = personIds.size
    ? await db
        .from('profiles')
        .select('id, display_name, google_chat_user_id')
        .in('id', [...personIds])
    : { data: [], error: null };
  if (profiles.error) throw new Error(`profiles: ${profiles.error.message}`);
  const people = new Map(
    (profiles.data ?? []).map((p) => [
      p.id,
      { name: p.display_name, chatUserId: p.google_chat_user_id ?? null },
    ]),
  );
  const nameOf = (id: string | null | undefined) => (id ? (people.get(id)?.name ?? 'someone') : null);

  const out = new Map<string, OncallEventFacts>();
  for (const e of events) {
    const f: OncallEventFacts = { id: e.id, kind: e.kind, at: e.at, by: nameOf(e.actor_id), people };
    const s = e.swap_id ? (swaps.data ?? []).find((x) => x.id === e.swap_id) : undefined;
    if (s) {
      const rw = week(shiftOf.get(s.requester_shift_id));
      const aw = week(shiftOf.get(s.counterpart_shift_id));
      if (rw && aw) {
        f.swap = {
          id: s.id,
          requester: nameOf(s.requester_id)!,
          asked: nameOf(s.counterpart_id)!,
          requesterWeek: rw,
          askedWeek: aw,
          reason: s.reason,
          // The answer of the person asked (decline), or the Admin's note (declined by an Admin).
          note: e.kind === 'swap_declined' ? s.response_note : s.decision_note,
        };
        if (e.kind === 'swap_approved' || e.kind === 'swap_admin_declined')
          f.by = nameOf(s.decided_by) ?? f.by;
      }
    }
    if (e.kind === 'handed_over') {
      const sh = e.shift_id ? shiftOf.get(e.shift_id) : undefined;
      const p = e.payload ?? {};
      f.handover = {
        from: nameOf(typeof p.from === 'string' ? p.from : null) ?? 'someone',
        to: nameOf(e.user_id) ?? 'someone',
        at: new Date(typeof p.at === 'string' ? p.at : (sh?.starts_at ?? e.at)),
        until: new Date(sh?.ends_at ?? e.at),
        reason: typeof p.reason === 'string' ? p.reason : null,
      };
    }
    if (e.kind === 'rotation_changed') {
      const next = (uid: string) =>
        week(((upcoming.data ?? []) as ShiftRow[]).find((x) => x.user_id === uid));
      f.rotation = {
        order: ids(e.payload?.order).map((uid) => ({ name: nameOf(uid) ?? 'someone', next: next(uid) })),
        removed: ids(e.payload?.removed).map((uid) => nameOf(uid) ?? 'someone'),
      };
    }
    if (e.kind === 'shift_reminder') f.shiftHolder = nameOf(e.user_id) ?? undefined;
    if (e.kind === 'shift_reminder')
      f.shift = week(e.shift_id ? shiftOf.get(e.shift_id) : undefined) ?? undefined;
    if (e.kind === 'test_alert' && e.user_id)
      f.test = { name: nameOf(e.user_id)!, token: tokenOf.get(e.user_id) ?? null };
    out.set(e.id, f);
  }
  return out;
}

/** Whether this email starts its person's mail thread: nothing sent to them in that thread yet. */
export async function oncallThreadStarts(db: DbClient, n: Notification): Promise<boolean> {
  if (!n.thread_key || !n.user_id) return true;
  const { data, error } = await db
    .from('notifications')
    .select('id')
    .eq('channel', 'email')
    .eq('status', 'sent')
    .eq('thread_key', n.thread_key)
    .eq('user_id', n.user_id)
    .neq('id', n.id)
    .limit(1);
  if (error) return true;
  return !(data ?? []).length;
}
