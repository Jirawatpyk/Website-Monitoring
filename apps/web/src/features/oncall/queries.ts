import 'server-only';
import type { DbClient } from '@dxt/db';
import { loadResponseHours } from '@/server/escalation/response-hours';
import {
  OPEN_SWAP,
  oncallCardOf,
  type Checklist,
  type OncallCard,
  type OncallData,
  type PagedIncident,
  type ShiftRow,
  type SwapNotes,
  type SwapRow,
  type SwapStatus,
  type Viewer,
} from './model';

const DAY_MS = 86_400_000;
/** The last done week, the live one and the weeks ahead (the cron keeps about four made). */
const SHIFTS_BACK_DAYS = 8;

// Columns listed one by one: reasons, notes, payloads and the test token aren't granted (B0 column
// grants), so `select('*')` is refused. Reasons come only through `oncall_notes` (D-048 item 10).
const SWAP_COLUMNS = `id, status, requester_id, counterpart_id, requester_shift_id, counterpart_shift_id,
  created_at, responded_at, decided_at, decided_by, updated_at,
  rq:oncall_shifts!oncall_swaps_requester_shift_id_fkey(starts_at, ends_at),
  cp:oncall_shifts!oncall_swaps_counterpart_shift_id_fkey(starts_at, ends_at)`;

interface SwapDbRow {
  id: string;
  status: string;
  requester_id: string;
  counterpart_id: string;
  requester_shift_id: string;
  counterpart_shift_id: string;
  created_at: string;
  responded_at: string | null;
  decided_at: string | null;
  decided_by: string | null;
  updated_at: string;
  rq: { starts_at: string; ends_at: string } | null;
  cp: { starts_at: string; ends_at: string } | null;
}

function swapOf(w: SwapDbRow): SwapRow | null {
  if (!w.rq || !w.cp) return null;
  return {
    id: w.id,
    status: w.status as SwapStatus,
    requesterId: w.requester_id,
    counterpartId: w.counterpart_id,
    requesterShiftId: w.requester_shift_id,
    counterpartShiftId: w.counterpart_shift_id,
    createdAt: w.created_at,
    respondedAt: w.responded_at,
    decidedAt: w.decided_at,
    decidedBy: w.decided_by,
    updatedAt: w.updated_at,
    requesterWeek: { start: w.rq.starts_at, end: w.rq.ends_at },
    counterpartWeek: { start: w.cp.starts_at, end: w.cp.ends_at },
  };
}

async function notesOf(db: DbClient, args: { p_swap_id?: string; p_shift_id?: string }) {
  const { data, error } = await db.rpc('oncall_notes', args);
  // A read that fails shows no reason — never someone else's.
  return error ? null : (data?.[0] ?? null);
}

/**
 * Everything `/oncall` shows, read as the signed-in person (staff read, RLS): shifts from a week back,
 * the rotation, swaps on those shifts, everyone's phone checklist, the Tier 1 owners (who is paged with
 * no one on call), the Tier 1 incidents L0 paged on call, and the response hours.
 */
export async function loadOncallData(
  db: DbClient,
  viewer: Viewer,
  now: Date,
  swapId: string | null,
): Promise<OncallData> {
  const since = new Date(now.getTime() - SHIFTS_BACK_DAYS * DAY_MS).toISOString();
  const [shifts, rotation, people, checks, sites, hours] = await Promise.all([
    db
      .from('oncall_shifts')
      .select('id, user_id, starts_at, ends_at, handed_over_from, slot')
      .gt('ends_at', since)
      .order('starts_at')
      .limit(20),
    db.from('oncall_rotation').select('user_id, position').order('position'),
    db.from('profiles').select('id, display_name, role, is_active'),
    db.from('oncall_checklist').select('user_id, mentions_only, dnd_allowed, test_sent_at, test_received_at'),
    db.from('sites').select('name, primary_owner_id').eq('is_active', true).eq('tier', 1).order('name'),
    loadResponseHours(db, now),
  ]);
  for (const r of [shifts, rotation, people, checks, sites]) {
    if (r.error) throw new Error(`oncall: ${r.error.message}`);
  }
  const shiftRows: ShiftRow[] = (shifts.data ?? []).map((s) => ({
    id: s.id,
    userId: s.user_id,
    startsAt: s.starts_at,
    endsAt: s.ends_at,
    handedOverFrom: s.handed_over_from,
    slot: s.slot,
  }));
  const ids = shiftRows.map((s) => s.id);
  const oldest = shiftRows[0]?.startsAt ?? since;
  const [swaps, focus, paged] = await Promise.all([
    ids.length
      ? db
          .from('oncall_swaps')
          .select(SWAP_COLUMNS)
          .or(`requester_shift_id.in.(${ids.join(',')}),counterpart_shift_id.in.(${ids.join(',')})`)
          .order('created_at', { ascending: false })
      : Promise.resolve({ data: [] as SwapDbRow[], error: null }),
    swapId ? db.from('oncall_swaps').select(SWAP_COLUMNS).eq('id', swapId).maybeSingle() : null,
    db
      .from('incidents')
      .select('number, detected_at, l0_user_id, sites!inner(name, tier)')
      .not('l0_user_id', 'is', null)
      .eq('sites.tier', 1)
      .gte('detected_at', oldest)
      .order('detected_at'),
  ]);
  if (swaps.error) throw new Error(`oncall_swaps: ${swaps.error.message}`);
  if (paged.error) throw new Error(`incidents: ${paged.error.message}`);
  const swapRows = ((swaps.data ?? []) as SwapDbRow[]).map(swapOf).filter((w): w is SwapRow => !!w);

  const profiles = people.data ?? [];
  const active = profiles.filter((p) => p.is_active);
  const admins = active.filter((p) => p.role === 'admin').map((p) => p.id);
  const eligible = active
    .filter((p) => p.role === 'admin' || p.role === 'responder')
    .sort((a, b) => a.display_name.localeCompare(b.display_name))
    .map((p) => p.id);

  // The card: the swap the link names, else the viewer's own open one, else (Admin) the oldest open one.
  const named = focus && !focus.error && focus.data ? swapOf(focus.data as SwapDbRow) : null;
  const mineOpen = swapRows.find(
    (w) => OPEN_SWAP.includes(w.status) && (w.requesterId === viewer.id || w.counterpartId === viewer.id),
  );
  const adminOpen =
    viewer.role === 'admin'
      ? ([...swapRows].reverse().find((w) => w.status === 'accepted') ??
        [...swapRows].reverse().find((w) => OPEN_SWAP.includes(w.status)))
      : undefined;
  const focusSwap = named ?? mineOpen ?? adminOpen ?? null;
  // Hand-over reasons: only for the shifts handed over, and only the rows the viewer may read.
  const handed = shiftRows.filter((s) => s.handedOverFrom && Date.parse(s.endsAt) > now.getTime());
  const [focusNotes, ...reasons] = await Promise.all([
    focusSwap ? notesOf(db, { p_swap_id: focusSwap.id }) : null,
    ...handed.map((s) => notesOf(db, { p_shift_id: s.id })),
  ]);
  const handoverReasons: Record<string, string> = {};
  handed.forEach((s, i) => {
    const r = reasons[i]?.handover_reason;
    if (r) handoverReasons[s.id] = r;
  });
  const notes: SwapNotes | null = focusNotes
    ? {
        reason: focusNotes.reason,
        responseNote: focusNotes.response_note,
        decisionNote: focusNotes.decision_note,
      }
    : null;

  const ownerSites = new Map<string, string[]>();
  for (const s of sites.data ?? []) {
    if (!s.primary_owner_id) continue;
    ownerSites.set(s.primary_owner_id, [...(ownerSites.get(s.primary_owner_id) ?? []), s.name]);
  }
  const checklists: Record<string, Checklist> = {};
  for (const c of checks.data ?? []) {
    checklists[c.user_id] = {
      mentionsOnly: c.mentions_only,
      dndAllowed: c.dnd_allowed,
      testSentAt: c.test_sent_at,
      testReceivedAt: c.test_received_at,
    };
  }
  const pagedRows: PagedIncident[] = (paged.data ?? []).flatMap((i) => {
    const site = Array.isArray(i.sites) ? i.sites[0] : i.sites;
    return i.l0_user_id && site
      ? [{ number: i.number, site: site.name, detectedAt: i.detected_at, userId: i.l0_user_id }]
      : [];
  });

  return {
    nowIso: now.toISOString(),
    viewer,
    names: Object.fromEntries(profiles.map((p) => [p.id, p.display_name])),
    admins,
    eligible,
    rotation: (rotation.data ?? []).map((r) => r.user_id),
    shifts: shiftRows,
    swaps: swapRows,
    focus: focusSwap ? { swap: focusSwap, notes } : null,
    handoverReasons,
    checklists,
    owners: [...ownerSites].map(([id, list]) => ({ id, sites: list })),
    tier1Sites: (sites.data ?? []).length,
    paged: pagedRows,
    hours: { ...hours, days: [...hours.days], holidays: [...hours.holidays] },
  };
}

/**
 * The Overview's "On call" card (§23.8): who responds now, tonight and next week. A failed read leaves
 * the card out rather than failing the Overview.
 */
export async function loadOncallCard(db: DbClient, now: Date): Promise<OncallCard | null> {
  const [shifts, hours] = await Promise.all([
    db
      .from('oncall_shifts')
      .select(
        'id, user_id, starts_at, ends_at, handed_over_from, person:profiles!oncall_shifts_user_id_fkey(display_name)',
      )
      .gt('ends_at', now.toISOString())
      .order('starts_at')
      .limit(6),
    loadResponseHours(db, now),
  ]);
  if (shifts.error) {
    console.error(JSON.stringify({ event: 'oncall_card_unreadable', error: shifts.error.message }));
    return null;
  }
  const rows = shifts.data ?? [];
  return oncallCardOf(
    {
      shifts: rows.map((s) => ({
        id: s.id,
        userId: s.user_id,
        startsAt: s.starts_at,
        endsAt: s.ends_at,
        handedOverFrom: s.handed_over_from,
      })),
      names: Object.fromEntries(rows.map((s) => [s.user_id, s.person?.display_name ?? 'Someone'])),
      hours: { ...hours, days: [...hours.days], holidays: [...hours.holidays] },
    },
    now,
  );
}
