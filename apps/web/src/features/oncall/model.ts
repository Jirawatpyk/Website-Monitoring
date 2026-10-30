import { closingOf, isInsideHours, nextOpening } from '@dxt/engine';
import {
  formatDay,
  formatDuration,
  formatNameList,
  formatTime,
  formatWeek,
  type ResponseHours,
  type Week,
} from '@dxt/shared';

/**
 * The On-call page (boards OnCall 1440 and MOnCall 390, spec §27, §28, D-048): pure rules from the rows
 * the page reads. Dates are computed, never the boards' samples; words are the boards' unless D-048
 * item 12 says otherwise.
 */

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;
const HOUR_MS = 3_600_000;

export type ViewerRole = 'admin' | 'responder' | 'readonly';
export interface Viewer {
  id: string;
  name: string;
  role: ViewerRole;
}

export interface ShiftRow {
  id: string;
  userId: string;
  startsAt: string;
  endsAt: string;
  /** The person who had it before a hand-over (the live shift is split at the hand-over time). */
  handedOverFrom: string | null;
}

export type SwapStatus =
  'waiting' | 'accepted' | 'declined' | 'approved' | 'admin_declined' | 'withdrawn' | 'expired';
export const OPEN_SWAP: readonly SwapStatus[] = ['waiting', 'accepted'];

export interface SwapRow {
  id: string;
  status: SwapStatus;
  requesterId: string;
  counterpartId: string;
  requesterShiftId: string;
  counterpartShiftId: string;
  createdAt: string;
  respondedAt: string | null;
  decidedAt: string | null;
  decidedBy: string | null;
  updatedAt: string;
  /** The weeks as asked: an approval moves people, never dates. */
  requesterWeek: { start: string; end: string };
  counterpartWeek: { start: string; end: string };
}

/** From `oncall_notes`: only the two people and Admins get a row (D-048 item 10). */
export interface SwapNotes {
  reason: string | null;
  responseNote: string | null;
  decisionNote: string | null;
}

export interface Checklist {
  mentionsOnly: boolean;
  dndAllowed: boolean;
  testSentAt: string | null;
  testReceivedAt: string | null;
}

/** A Tier 1 incident L0 paged on call (`incidents.l0_user_id`), for the rotation's "alerts" column. */
export interface PagedIncident {
  number: number;
  site: string;
  detectedAt: string;
  userId: string;
}

export interface OncallData {
  nowIso: string;
  viewer: Viewer;
  /** Names of everyone the page mentions: shift holders, swap people, Admins. */
  names: Record<string, string>;
  /** Active Admins (ids), for "waiting for Tao" and the side card's Admin row. */
  admins: string[];
  /** Active Admins and Responders, in name order: who can be put on call. */
  eligible: string[];
  /** The rotation, in order (user ids). */
  rotation: string[];
  /** From a week before now, in order. */
  shifts: ShiftRow[];
  /** Swaps touching those shifts, newest first. */
  swaps: SwapRow[];
  /** The swap the page opens on (`?swap=`, else the viewer's own open one, else the oldest open one for an Admin). */
  focus: { swap: SwapRow; notes: SwapNotes | null } | null;
  /** Hand-over reasons the viewer may read, by shift id. */
  handoverReasons: Record<string, string>;
  checklists: Record<string, Checklist>;
  /** Tier 1 site owners and their sites: who is paged when no one is on call (§28.4). */
  owners: { id: string; sites: string[] }[];
  tier1Sites: number;
  paged: PagedIncident[];
  hours: { startMin: number; endMin: number; days: number[]; holidays: string[] };
}

export const hoursOf = (d: OncallData): ResponseHours => ({
  ...d.hours,
  holidays: new Set(d.hours.holidays),
});

const day = (d: Date) => formatDay(d, { weekday: true });
const dayTime = (d: Date) => `${day(d)} ${formatTime(d)}`;
/** "Fri 10:07" within the week, "Mon 14 Sep 21:18" further back (boards' swap and hand-over times). */
export function shortWhen(d: Date, now: Date): string {
  return Math.abs(now.getTime() - d.getTime()) < 6 * DAY_MS
    ? `${day(d).split(' ')[0]} ${formatTime(d)}`
    : dayTime(d);
}
const week = (w: { start: string; end: string }): Week => ({
  start: new Date(w.start),
  end: new Date(w.end),
});
const quote = (s: string | null | undefined) => (s && s.trim() ? `“${s.trim()}”` : null);

export function nameOf(d: OncallData, id: string | null | undefined): string {
  return (id && d.names[id]) || 'Someone';
}

/** Whoever covers `at`: the shift holder, or null. */
export function personAt(d: OncallData, at: Date): ShiftRow | null {
  const t = at.getTime();
  return d.shifts.find((s) => Date.parse(s.startsAt) <= t && t < Date.parse(s.endsAt)) ?? null;
}

/** A live shift split by a hand-over is one rotation row: the first part, and who took the rest. */
export interface ShiftGroup {
  first: ShiftRow;
  /** The part after a hand-over, if any (`handedOverFrom` = the first part's holder). */
  rest: ShiftRow | null;
  start: Date;
  end: Date;
}

export function groupsOf(d: OncallData): ShiftGroup[] {
  const out: ShiftGroup[] = [];
  for (const s of d.shifts) {
    const prev = out.at(-1);
    if (
      prev &&
      !prev.rest &&
      prev.first.endsAt === s.startsAt &&
      s.handedOverFrom === prev.first.userId &&
      Date.parse(s.endsAt) - Date.parse(prev.first.startsAt) <= WEEK_MS
    ) {
      prev.rest = s;
      prev.end = new Date(s.endsAt);
      continue;
    }
    out.push({ first: s, rest: null, start: new Date(s.startsAt), end: new Date(s.endsAt) });
  }
  return out;
}

/** The swap that matters for a shift: an open one, else the newest. */
function swapOn(d: OncallData, shiftId: string): SwapRow | null {
  const on = d.swaps.filter((w) => w.requesterShiftId === shiftId || w.counterpartShiftId === shiftId);
  return on.find((w) => OPEN_SWAP.includes(w.status)) ?? on[0] ?? null;
}

const inRotation = (d: OncallData, id: string) => d.rotation.includes(id) && d.eligible.includes(id);
/** Fewer than two people to swap with (§28.4 One person). */
export const onePerson = (d: OncallData) => d.rotation.filter((id) => d.eligible.includes(id)).length < 2;

/** "Waiting for Tao" with one Admin, "Waiting for an Admin" with more (§27.5, D-048 item 12). */
function adminWord(d: OncallData): string {
  return d.admins.length === 1 ? nameOf(d, d.admins[0]) : 'an Admin';
}

// ── Badges ────────────────────────────────────────────────────────────────

export type BadgeIcon =
  | 'check'
  | 'user'
  | 'arrow-right'
  | 'clock'
  | 'arrow-up-down'
  | 'triangle-alert'
  | 'ban'
  | 'circle-check'
  | 'minus';
export interface BadgeView {
  label: string;
  tone: 'neutral' | 'warning' | 'success';
  variant: 'soft' | 'solid' | 'outline';
  icon: BadgeIcon;
}
const badge = (
  label: string,
  icon: BadgeIcon,
  variant: BadgeView['variant'] = 'outline',
  tone: BadgeView['tone'] = 'neutral',
): BadgeView => ({ label, tone, variant, icon });

// ── Rotation rows (§15.8, §27.7, §28.4) ───────────────────────────────────

export type RowAction =
  | { kind: 'swap' }
  | { kind: 'swap-off'; why: string }
  | { kind: 'handover' }
  | { kind: 'note'; text: string; why: string }
  | null;

export interface RotationRow {
  key: string;
  /** The shift a Swap or Hand over acts on (the part still to come after a hand-over). */
  shiftId: string | null;
  who: string;
  nobody: boolean;
  past: boolean;
  live: boolean;
  /** "Mon 21 Sep → Mon 28 Sep" (desktop) and the phone's second line. */
  range: string;
  phoneLine: string;
  status: BadgeView;
  alerts: string;
  action: RowAction;
}

export const SWAP_OFF = 'Nobody else in the rotation to swap with';

function pagedText(d: OncallData, g: ShiftGroup, now: Date, live: boolean): string {
  const hits = d.paged.filter((p) => {
    const t = Date.parse(p.detectedAt);
    return t >= g.start.getTime() && t < g.end.getTime();
  });
  const first = hits[0];
  if (!first) return live ? 'None so far' : g.end.getTime() <= now.getTime() ? 'None' : '—';
  const more = hits.length > 1 ? ` +${hits.length - 1}` : '';
  return `INC-${String(first.number).padStart(4, '0')} · ${first.site}${more}`;
}

export function rotationRows(d: OncallData, now: Date): RotationRow[] {
  const t = now.getTime();
  const one = onePerson(d);
  const groups = groupsOf(d).filter((g) => g.end.getTime() > t - WEEK_MS);
  const rows: RotationRow[] = [];
  const firstFuture = groups.find((g) => g.start.getTime() > t);
  // Nobody covers now but weeks are coming (§28.4 Nobody on call).
  if (!groups.some((g) => g.start.getTime() <= t && t < g.end.getTime()) && firstFuture) {
    rows.push({
      key: 'nobody',
      shiftId: null,
      who: 'No one',
      nobody: true,
      past: false,
      live: true,
      range: `Now → ${day(firstFuture.start)}`,
      phoneLine: `Now → ${day(firstFuture.start)} · site owners at night`,
      status: badge('No one on call', 'triangle-alert', 'outline', 'warning'),
      alerts: 'Site owners at night',
      action: null,
    });
  }
  for (const g of groups) {
    const past = g.end.getTime() <= t;
    const live = !past && g.start.getTime() <= t;
    if (past && rows.some((r) => r.past))
      rows.splice(
        rows.findIndex((r) => r.past),
        1,
      ); // only the last done week
    const holder = g.first.userId;
    const who = nameOf(d, holder);
    const range = `${day(g.start)} → ${day(g.end)}`;
    const you = holder === d.viewer.id ? ' · you' : '';
    const swap = swapOn(d, (g.rest ?? g.first).id);
    const open = swap && OPEN_SWAP.includes(swap.status) ? swap : null;
    let status: BadgeView = past
      ? badge('Done', 'check', 'soft')
      : live
        ? badge('On call now', 'user', 'solid')
        : g === firstFuture
          ? badge('Next', 'arrow-right', 'soft')
          : badge('Scheduled', 'clock');
    let alerts = past || live ? pagedText(d, g, now, live) : '—';
    let extra = '';
    if (g.rest) {
      const to = nameOf(d, g.rest.userId);
      const at = new Date(g.rest.startsAt);
      status = badge(`Handed to ${to}`, 'arrow-up-down');
      alerts = `${to} from ${shortWhen(at, now)}`;
      extra = ` · ${to} covers from ${shortWhen(at, now)}`;
    } else if (g.first.handedOverFrom && !past) {
      alerts = `Covering ${nameOf(d, g.first.handedOverFrom)}`;
    }
    if (open) {
      status = badge('Swap requested', 'arrow-up-down');
      const other = nameOf(d, open.requesterId === holder ? open.counterpartId : open.requesterId);
      extra =
        open.status === 'accepted'
          ? ` · with ${other}, waiting for an Admin`
          : ` · with ${other}, waiting for ${nameOf(d, open.counterpartId)}`;
    } else if (swap?.status === 'approved' && swap.decidedAt && !past) {
      alerts = `Swapped · ${shortWhen(new Date(swap.decidedAt), now)}`;
      extra = ` · swapped ${shortWhen(new Date(swap.decidedAt), now)}`;
    } else if (swap?.status === 'expired' && swap.decidedAt && !past) {
      alerts = `Swap expired ${day(new Date(swap.decidedAt))}`;
      extra = ` · swap expired ${day(new Date(swap.decidedAt))}`;
    }
    let action: RowAction = null;
    if (live && !g.rest && d.viewer.role === 'admin') action = { kind: 'handover' };
    else if (!past && !live) {
      if (open) action = { kind: 'note', text: 'Request open', why: 'A swap is already waiting' };
      else if (one) action = { kind: 'swap-off', why: SWAP_OFF };
      else if (holder === d.viewer.id && inRotation(d, d.viewer.id)) action = { kind: 'swap' };
    }
    rows.push({
      key: g.first.id,
      shiftId: (g.rest ?? g.first).id,
      who,
      nobody: false,
      past,
      live,
      range,
      phoneLine: `${range}${you}${extra}`,
      status,
      alerts,
      action,
    });
  }
  return rows;
}

// ── This week · who gets Tier 1 alerts ────────────────────────────────────

export interface WeekSegment {
  /** Hours long, for its height. */
  hours: number;
  who: string;
  onCall: boolean;
}
export interface WeekDay {
  label: string;
  today: boolean;
  segments: WeekSegment[];
}

/** Midnight in Bangkok of the Monday of `now`'s calendar week. */
function mondayOf(now: Date): Date {
  const local = new Date(now.getTime() + 7 * HOUR_MS);
  const dow = local.getUTCDay() === 0 ? 7 : local.getUTCDay();
  const midnight = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - 7 * HOUR_MS;
  return new Date(midnight - (dow - 1) * DAY_MS);
}

export function weekGrid(d: OncallData, now: Date): WeekDay[] {
  const hours = hoursOf(d);
  const mon = mondayOf(now);
  const holder = (at: Date) => {
    const s = personAt(d, at);
    return s ? nameOf(d, s.userId) : null;
  };
  const today = formatDay(now);
  return Array.from({ length: 7 }, (_, i) => {
    const start = new Date(mon.getTime() + i * DAY_MS);
    const label = day(start).split(' ').slice(0, 2).join(' ');
    const isToday = formatDay(start) === today;
    const open = isInsideHours(new Date(start.getTime() + hours.startMin * 60_000), hours);
    const seg = (fromH: number, toH: number, owners: boolean, allDay = false): WeekSegment => {
      const who = owners ? null : holder(new Date(start.getTime() + (allDay ? 12 : fromH) * HOUR_MS));
      return {
        hours: toH - fromH,
        who: who ? (allDay ? `${who} · all day` : who) : allDay ? 'Owners · all day' : 'Owners',
        onCall: !!who,
      };
    };
    const sH = hours.startMin / 60;
    const eH = hours.endMin / 60;
    return {
      label: isToday ? `${label} · today` : label,
      today: isToday,
      segments: open ? [seg(0, sH, false), seg(sH, eH, true), seg(eH, 24, false)] : [seg(0, 24, false, true)],
    };
  });
}

// ── Hero ──────────────────────────────────────────────────────────────────

/** Tonight's on-call stretch: from the next closing (or now, outside hours) to the next opening. */
export function tonightOf(d: OncallData, now: Date): { from: Date; until: Date; inside: boolean } {
  const hours = hoursOf(d);
  const closing = closingOf(now, hours);
  const from = closing ?? now;
  return { from, until: nextOpening(new Date(from.getTime() + 1), hours), inside: !!closing };
}

export interface Hero {
  /** Desktop (OnCall). */
  avatar: string | null;
  eyebrow: string;
  title: string;
  l1: string;
  l2: string;
  /** RIGHT NOW · 10:07 / Owners respond / until 18:00 today. */
  nowTitle: string;
  nowLine: string;
  /** Phone (MOnCall). */
  phoneEyebrow: string;
  phoneTitle: string;
  phoneText: string;
}

const tonightRange = (from: Date, until: Date, now: Date) =>
  `${formatDay(from) === formatDay(now) ? 'Tonight' : day(from)} ${formatTime(from)} → ${day(until).split(' ')[0]} ${formatTime(until)}`;

export function heroOf(d: OncallData, now: Date): Hero {
  const admin = d.viewer.role === 'admin';
  const { from, until, inside } = tonightOf(d, now);
  const groups = groupsOf(d);
  const at = personAt(d, from);
  const nowTitle = inside ? 'Owners respond' : at ? `${nameOf(d, at.userId)} responds` : 'Owners respond';
  const nowLine = inside ? `until ${formatTime(from)} today` : `until ${dayTime(until)}`;
  const ownersLine = 'Until then Tier 1 alerts at night page each site’s owner';
  const firstFuture = groups.find((g) => g.start.getTime() > now.getTime());
  if (!at) {
    const empty = d.rotation.length === 0 || !firstFuture;
    const l1 = empty
      ? 'No rotation yet'
      : `No week covers tonight — the rotation starts ${dayTime(firstFuture.start)} with ${nameOf(d, firstFuture.first.userId)}`;
    const l2 = empty
      ? `${admin ? 'Set one up in Edit rotation. ' : 'An Admin sets it up. '}${ownersLine}`
      : `${ownersLine}${admin ? ' · add a week in Edit rotation' : ''}`;
    return {
      avatar: null,
      eyebrow: 'ON CALL TONIGHT',
      title: 'Nobody on call',
      l1,
      l2,
      nowTitle: 'Owners respond',
      nowLine: inside ? `until ${formatTime(from)} — and tonight` : 'tonight too',
      phoneEyebrow: 'ON CALL TONIGHT',
      phoneTitle: 'Nobody on call',
      phoneText: `${empty ? `No rotation yet. ${admin ? 'Set one up in Edit rotation.' : 'An Admin sets it up.'}` : `${l1}.`} ${ownersLine}.`,
    };
  }
  const g = groups.find((x) => x.first.id === at.id || x.rest?.id === at.id)!;
  const who = nameOf(d, at.userId);
  const nextG = groups[groups.indexOf(g) + 1];
  const next = nextG ? nameOf(d, nextG.first.userId) : null;
  const covering = at.handedOverFrom ? nameOf(d, at.handedOverFrom) : null;
  const reason = d.handoverReasons[at.id];
  const one = onePerson(d);
  const range = tonightRange(from, until, now);
  const desk = {
    avatar: who,
    eyebrow: covering ? `ON CALL TONIGHT · COVERING ${covering.toUpperCase()}` : 'ON CALL TONIGHT',
    title: who,
    l1: `${dayTime(from)} → ${dayTime(until)}`,
    l2: covering
      ? `Covering ${covering} from ${formatTime(new Date(at.startsAt))}${reason ? ` · ${reason}` : ''}${next ? ` · then ${next} from ${day(g.end)}` : ''}`
      : `Shift ${day(g.start)} → ${day(g.end)} · ${one ? `then ${who} again — the only person in the rotation` : next ? `then ${next}` : 'nothing after it yet'}`,
    nowTitle,
    nowLine,
  };
  // Phone: what this viewer needs to know (MOnCall hero per viewer).
  const mine = at.userId === d.viewer.id;
  const myNext = groups.find((x) => x.start.getTime() > now.getTime() && x.first.userId === d.viewer.id);
  let phone: Pick<Hero, 'phoneEyebrow' | 'phoneTitle' | 'phoneText'>;
  if (covering) {
    phone = {
      phoneEyebrow: `ON CALL TONIGHT · ${who.toUpperCase()}, COVERING ${covering.toUpperCase()}`,
      phoneTitle: range,
      phoneText: `Covering ${covering} from ${formatTime(new Date(at.startsAt))}${reason ? ` · ${reason}` : ''}. ${who} gets Tier 1 alerts at night and on the weekend until ${dayTime(g.end)}.`,
    };
  } else if (mine) {
    const left = Math.max(0, Math.round((from.getTime() - now.getTime()) / 60_000));
    phone = {
      phoneEyebrow: inside
        ? `YOUR ON-CALL HOURS START IN ${formatDuration(left).toUpperCase()}`
        : 'YOU’RE ON CALL NOW',
      phoneTitle: range,
      phoneText: one
        ? `You’re the only person in the rotation, so you’re on call every week. Owners handle alerts until ${formatTime(from)}.`
        : `Owners handle alerts until ${formatTime(from)}. Then all Tier 1 alerts (${d.tier1Sites} ${d.tier1Sites === 1 ? 'site' : 'sites'}) come to you instead of the owners.`,
    };
  } else if (myNext) {
    phone = {
      phoneEyebrow: `YOUR NEXT SHIFT STARTS ${dayTime(myNext.start).toUpperCase()}`,
      phoneTitle: `${day(myNext.start)} → ${day(myNext.end)}`,
      phoneText:
        'Tier 1 alerts at night and on the weekend come to you. Owners handle them Mon–Fri 09:00–18:00.',
    };
  } else {
    phone = {
      phoneEyebrow: `ON CALL TONIGHT · ${who.toUpperCase()}`,
      phoneTitle: range,
      phoneText: admin
        ? 'You’re not in the rotation. As Admin backstop you’re at L1 for every DOWN.'
        : `${who} gets Tier 1 alerts at night and on the weekend.`,
    };
  }
  return { ...desk, ...phone };
}

// ── Phone readiness (OnCall phone card, MOnCall "Before your shift") ─────

export interface ReadyItem {
  label: string;
  done: boolean;
  /** The test row while a test waits to be opened. */
  waiting?: boolean;
}
export interface Readiness {
  personId: string;
  who: string;
  count: number;
  items: ReadyItem[];
  /** "Test alert sent 10:08 …", "Received on this phone at 10:08". */
  testLine: string;
  received: Date | null;
  sent: Date | null;
}

export function readinessOf(d: OncallData, personId: string, now: Date): Readiness {
  const c = d.checklists[personId];
  const who = nameOf(d, personId);
  const received = c?.testReceivedAt ? new Date(c.testReceivedAt) : null;
  const sent = c?.testSentAt ? new Date(c.testSentAt) : null;
  const testLine = received
    ? `Test alert received on this phone · ${shortWhen(received, now)}`
    : sent
      ? `Test alert sent ${formatTime(sent)} to ${who}’s current phone — waiting for ${who} to confirm it arrived`
      : 'Test alert not received on current phone';
  const items: ReadyItem[] = [
    { label: 'Alerts Space: notify for @mentions only', done: !!c?.mentionsOnly },
    { label: 'Space allowed through Do Not Disturb', done: !!c?.dndAllowed },
    { label: testLine, done: !!received, waiting: !received && !!sent },
  ];
  return { personId, who, count: items.filter((i) => i.done).length, items, testLine, received, sent };
}

// ── Owners (§28.4 Nobody / Empty) ─────────────────────────────────────────

/** Each Tier 1 owner and their sites — three names, then "+N more" (the card stays a glance). */
export function ownersOf(d: OncallData): { who: string; sites: string }[] {
  return d.owners.map((o) => ({
    who: nameOf(d, o.id),
    sites:
      o.sites.length > 3
        ? `${o.sites.slice(0, 3).join(', ')} +${o.sites.length - 3} more`
        : o.sites.join(', '),
  }));
}

// ── The swap card (desktop request card / side card, phone card) ──────────

export type SwapPart = 'asked' | 'requester' | 'admin';
export interface PersonState {
  who: string;
  role: string;
  status: BadgeView;
}
export interface SwapView {
  id: string;
  part: SwapPart;
  open: boolean;
  status: SwapStatus;
  requester: string;
  asked: string;
  eyebrow: string;
  title: string;
  sub: string;
  badge: BadgeView;
  left: { label: string; week: string; sub: string };
  right: { label: string; week: string; sub: string };
  /** Desktop side card: "Nok takes Arm’s week, …". */
  what: string;
  people: PersonState[];
  warn: { title: string; text: string } | null;
  canAnswer: boolean;
  canDecide: boolean;
  canApprove: boolean;
  canWithdraw: boolean;
  hint: string | null;
  line: {
    text: string;
    sub: string;
    icon: 'check' | 'circle-check' | 'ban' | 'clock';
    positive: boolean;
  } | null;
  /** The dialogs' words. */
  declineTitle: string;
  declineText: string;
}

/** Whether taking `w` gives `personId` two weeks in a row (their other weeks, minus the one they give up). */
function backToBack(d: OncallData, personId: string, w: Week, givingUp: string): string | null {
  const theirs = d.shifts.filter((s) => s.userId === personId && s.id !== givingUp);
  const before = theirs.find((s) => Date.parse(s.endsAt) === w.start.getTime());
  const after = theirs.find((s) => Date.parse(s.startsAt) === w.end.getTime());
  if (!before && !after) return null;
  const from = before ? new Date(before.startsAt) : w.start;
  const to = after ? new Date(after.endsAt) : w.end;
  return `${day(from)} → ${day(to)}`;
}

const PEOPLE: Record<SwapStatus, [BadgeView, BadgeView, BadgeView]> = {
  waiting: [
    badge('Requested', 'check', 'outline', 'success'),
    badge('Pending', 'clock', 'outline', 'warning'),
    badge('Not yet', 'minus'),
  ],
  accepted: [
    badge('Requested', 'check', 'outline', 'success'),
    badge('Accepted', 'check', 'outline', 'success'),
    badge('Pending', 'clock', 'outline', 'warning'),
  ],
  declined: [
    badge('Requested', 'check', 'outline', 'success'),
    badge('Declined', 'ban'),
    badge('Not needed', 'minus'),
  ],
  approved: [
    badge('Requested', 'check', 'outline', 'success'),
    badge('Accepted', 'check', 'outline', 'success'),
    badge('Approved', 'check', 'outline', 'success'),
  ],
  admin_declined: [
    badge('Requested', 'check', 'outline', 'success'),
    badge('Accepted', 'check', 'outline', 'success'),
    badge('Declined', 'ban'),
  ],
  withdrawn: [badge('Withdrew', 'ban'), badge('Not needed', 'minus'), badge('Not needed', 'minus')],
  expired: [
    badge('Requested', 'check', 'outline', 'success'),
    badge('Accepted', 'check', 'outline', 'success'),
    badge('Too late', 'clock'),
  ],
};

export function partOf(d: OncallData, w: SwapRow): SwapPart | null {
  if (w.counterpartId === d.viewer.id) return 'asked';
  if (w.requesterId === d.viewer.id) return 'requester';
  return d.viewer.role === 'admin' ? 'admin' : null;
}

export function swapViewOf(d: OncallData, now: Date): SwapView | null {
  if (!d.focus) return null;
  const { swap: w, notes } = d.focus;
  const part = partOf(d, w);
  if (!part) return null;
  const R = nameOf(d, w.requesterId);
  const A = nameOf(d, w.counterpartId);
  const D = w.decidedBy ? (w.decidedBy === d.viewer.id ? 'you' : nameOf(d, w.decidedBy)) : adminWord(d);
  const rq = week(w.requesterWeek);
  const cp = week(w.counterpartWeek);
  const rqW = formatWeek(rq);
  const cpW = formatWeek(cp);
  const open = OPEN_SWAP.includes(w.status);
  const approved = w.status === 'approved';
  const when = (iso: string | null) => (iso ? shortWhen(new Date(iso), now) : '');
  const reason = quote(notes?.reason);
  const sub = `${dayTime(new Date(w.createdAt))}${reason ? ` · ${reason}` : ''}`;
  const answer = quote(notes?.responseNote) ?? 'No reason given';
  const decision = quote(notes?.decisionNote) ?? 'No reason given';
  const starts = rq.start <= cp.start ? rq.start : cp.start;
  const firstWeekOf = rq.start <= cp.start ? 'requester' : 'asked';
  const tier = 'Tier 1 nights and weekend';
  const SIDE: Record<SwapStatus, string> = {
    waiting: `Waiting for ${A}`,
    accepted: `Waiting for ${adminWord(d)}`,
    declined: `Declined by ${A}`,
    approved: 'Approved',
    admin_declined: `Declined by ${D === 'you' ? 'you' : D}`,
    withdrawn: 'Withdrawn',
    expired: 'Expired',
  };
  const tone: BadgeView['tone'] = open ? 'warning' : approved ? 'success' : 'neutral';
  const icon: BadgeIcon = open
    ? 'clock'
    : approved
      ? 'circle-check'
      : w.status === 'expired'
        ? 'clock'
        : 'ban';
  const people: PersonState[] = [
    { who: R, role: '· requester', status: PEOPLE[w.status][0] },
    {
      who: A,
      role: '· asked',
      status:
        w.status === 'admin_declined' && !w.respondedAt ? badge('Not needed', 'minus') : PEOPLE[w.status][1],
    },
    {
      who: w.decidedBy ? nameOf(d, w.decidedBy) : d.admins.length === 1 ? nameOf(d, d.admins[0]) : 'Admins',
      role: '· Admin',
      status: PEOPLE[w.status][2],
    },
  ];
  let base: Pick<SwapView, 'eyebrow' | 'title' | 'sub' | 'badge' | 'left' | 'right' | 'warn' | 'hint'>;
  let line: SwapView['line'] = null;
  const closed = (text: string, s: string): SwapView['line'] => ({
    text,
    sub: s,
    icon: approved
      ? 'circle-check'
      : w.status === 'expired'
        ? 'clock'
        : w.status === 'accepted'
          ? 'check'
          : 'ban',
    positive: approved || w.status === 'accepted',
  });
  if (part === 'asked') {
    const nb: Record<SwapStatus, string> = {
      waiting: 'Waiting for you',
      accepted: `Waiting for ${adminWord(d)}`,
      declined: 'Declined',
      approved: 'Approved',
      admin_declined: 'Closed',
      withdrawn: 'Closed',
      expired: 'Expired',
    };
    const b2b = open ? backToBack(d, w.counterpartId, rq, w.counterpartShiftId) : null;
    base = {
      eyebrow: 'SWAP REQUEST',
      title: `${R} asks you to swap weeks`,
      sub,
      badge: badge(nb[w.status], icon, 'outline', tone),
      left: {
        label: approved ? 'You take' : open ? 'You would take' : `${R}’s week`,
        week: rqW,
        sub: approved ? `Was ${R}’s week · ${tier}` : `${R}’s week now · ${tier}`,
      },
      right: {
        label: approved ? `${R} takes` : open ? `${R} would take` : 'Your week',
        week: cpW,
        sub: approved ? `Was your week · ${tier}` : `Your week now · ${tier}`,
      },
      warn: b2b
        ? { title: 'Back-to-back for you', text: `You would be on call ${b2b} — two weeks in a row.` }
        : null,
      hint:
        w.status === 'waiting'
          ? `Accepting sends it to ${adminWord(d)} to approve. Nothing changes in the rotation until then. Logged in the audit log.`
          : null,
    };
    line = {
      waiting: null,
      accepted: closed(
        'Accepted · waiting for an Admin to approve. Nothing changes in the rotation until then.',
        `Accepted ${when(w.respondedAt)} · ${formatNameList([R, ...d.admins.map((id) => nameOf(d, id))])} got a Chat message`,
      ),
      declined: closed(
        `You declined · ${R} keeps ${rqW}.`,
        `${when(w.respondedAt)} · ${answer} · ${R} got a Chat message and an email`,
      ),
      approved: closed(
        `The weeks have swapped — you’re on call ${rqW}, ${R} ${cpW}.`,
        `Approved by ${D} · ${when(w.decidedAt)}`,
      ),
      admin_declined: closed(
        `This request is closed — Declined by ${D} · ${decision}`,
        `${when(w.decidedAt)} · ${R} keeps ${rqW}, you keep ${cpW}`,
      ),
      withdrawn: closed(
        `This request is closed — Withdrawn by ${R} · ${when(w.decidedAt ?? w.updatedAt)}`,
        `Nothing changes: ${R} keeps ${rqW}, you keep ${cpW}`,
      ),
      expired: closed(
        `Expired — ${firstWeekOf === 'requester' ? `${R}’s` : 'your'} week started before it was approved`,
        `${dayTime(starts)} · both weeks unchanged: ${R} keeps ${rqW}, you keep ${cpW} · ${R} and you got a Chat message`,
      ),
    }[w.status];
  } else {
    const me = part === 'requester';
    const b2b = open ? backToBack(d, w.counterpartId, rq, w.counterpartShiftId) : null;
    base = {
      eyebrow: me ? 'YOUR SWAP REQUEST' : 'SWAP REQUEST',
      title: me ? `You asked ${A} to swap weeks` : `${R} and ${A} swap weeks`,
      sub: `Requested by ${me ? 'you' : R} · ${sub}`,
      badge: badge(SIDE[w.status], icon, 'outline', tone),
      left: me
        ? {
            label: approved ? `${A} takes` : open ? `${A} would take` : 'Your week',
            week: rqW,
            sub: approved ? `Was your week · ${tier}` : `Your week now · ${tier}`,
          }
        : {
            label: approved ? `${A} took ${R}’s week` : `${A} takes ${R}’s week`,
            week: rqW,
            sub: approved ? `Swapped ${when(w.decidedAt)}` : `${R}’s week now · ${tier}`,
          },
      right: me
        ? {
            label: approved ? 'You take' : open ? 'You would take' : `${A}’s week`,
            week: cpW,
            sub: approved ? `Was ${A}’s week · ${tier}` : `${A}’s week now · ${tier}`,
          }
        : {
            label: approved ? `${R} took ${A}’s week` : `${R} takes ${A}’s week`,
            week: cpW,
            sub: approved ? `Swapped ${when(w.decidedAt)}` : `${A}’s week now · ${tier}`,
          },
      warn:
        b2b && !me
          ? { title: `Back-to-back for ${A}`, text: `${A} would be on call ${b2b} — two weeks in a row.` }
          : null,
      hint: !open
        ? null
        : me
          ? w.status === 'accepted'
            ? `${A} accepted ${when(w.respondedAt)} · waiting for an Admin to approve. You can still withdraw until then.`
            : `Waiting for ${A} to accept, then an Admin approves. You can withdraw until an Admin acts.`
          : w.status === 'accepted'
            ? `${A} accepted ${when(w.respondedAt)}. Approve swaps the two weeks; ${R} and ${A} get a Chat message and an email. Logged in the audit log.`
            : `Approve unlocks once ${A} accepts — ${A} first, then an Admin. Logged in the audit log.`,
    };
    const r = me ? 'you' : R;
    const Rcap = me ? 'You' : R;
    line = {
      waiting: null,
      accepted: null,
      declined: closed(
        `Declined by ${A} · ${r} keep${me ? '' : 's'} ${rqW}.`,
        `${when(w.respondedAt)} · ${answer} · ${r} got a Chat message and an email`,
      ),
      approved: closed(
        'Approved — the weeks have swapped.',
        `Approved by ${D} · ${when(w.decidedAt)} · ${A} is on call ${rqW}, ${r} ${cpW}`,
      ),
      admin_declined: closed(
        `This request is closed — ${D === 'you' ? 'You declined' : `Declined by ${D}`} · ${decision}`,
        `${when(w.decidedAt)} · ${Rcap} keep${me ? '' : 's'} ${rqW}, ${A} keeps ${cpW}`,
      ),
      withdrawn: closed(
        me
          ? `You withdrew · ${when(w.decidedAt ?? w.updatedAt)}`
          : `Withdrawn by ${R} · ${when(w.decidedAt ?? w.updatedAt)}`,
        `Nothing changes: ${r} keep${me ? '' : 's'} ${rqW}, ${A} keeps ${cpW}`,
      ),
      expired: closed(
        `Expired — ${firstWeekOf === 'requester' ? (me ? 'your' : `${R}’s`) : `${A}’s`} week started before it was approved`,
        `${dayTime(starts)} · both weeks unchanged · ${me ? 'you' : R} and ${A} got a Chat message`,
      ),
    }[w.status];
  }
  return {
    id: w.id,
    part,
    open,
    status: w.status,
    requester: R,
    asked: A,
    ...base,
    what: approved
      ? `${A} took ${R}’s week, ${rqW}. ${R} took ${A}’s week, ${cpW}.`
      : `${A} takes ${R}’s week, ${rqW}. ${R} takes ${A}’s week, ${cpW}.`,
    people,
    canAnswer: part === 'asked' && w.status === 'waiting',
    canDecide: d.viewer.role === 'admin' && open && w.counterpartId !== d.viewer.id,
    canApprove: w.status === 'accepted',
    canWithdraw: part === 'requester' && open,
    line,
    declineTitle: part === 'asked' ? `Decline ${R}’s swap?` : `Decline ${R}’s swap with ${A}?`,
    declineText:
      part === 'asked'
        ? `${R} keeps ${rqW} and you keep ${cpW}. ${R} gets a Chat message and an email.`
        : `${R} keeps ${rqW} and ${A} keeps ${cpW}. ${R} and ${A} get a Chat message with your reason.`,
  };
}

// ── Request a swap ────────────────────────────────────────────────────────

export interface SwapChoice {
  /** The person asked and the week they would give up (their next future week, D-048 item 12). */
  userId: string;
  who: string;
  shiftId: string;
  week: string;
  warn: string | null;
}

/** Who the viewer can ask to swap `shiftId` with: everyone else in the rotation with a free future week. */
export function swapChoices(d: OncallData, shiftId: string, now: Date): SwapChoice[] {
  const mine = d.shifts.find((s) => s.id === shiftId);
  if (!mine) return [];
  const mw: Week = { start: new Date(mine.startsAt), end: new Date(mine.endsAt) };
  const busy = new Set(
    d.swaps
      .filter((w) => OPEN_SWAP.includes(w.status))
      .flatMap((w) => [w.requesterShiftId, w.counterpartShiftId]),
  );
  return d.rotation
    .filter((id) => id !== mine.userId && d.eligible.includes(id))
    .flatMap((id) => {
      // A whole week of theirs, as scheduled — never the rest of a shift someone handed them.
      const theirs = d.shifts.find(
        (s) =>
          s.userId === id &&
          Date.parse(s.startsAt) > now.getTime() &&
          !busy.has(s.id) &&
          !s.handedOverFrom &&
          Date.parse(s.endsAt) - Date.parse(s.startsAt) === WEEK_MS,
      );
      if (!theirs) return [];
      const who = nameOf(d, id);
      const b2b = backToBack(d, id, mw, theirs.id);
      return [
        {
          userId: id,
          who,
          shiftId: theirs.id,
          week: formatWeek({ start: new Date(theirs.startsAt), end: new Date(theirs.endsAt) }),
          warn: b2b
            ? `${who} would be on call two weeks in a row. You can still send the request — ${who} and the Admin see this warning too.`
            : null,
        },
      ];
    });
}

/** The viewer's next week they may ask to swap (the phone's "Request swap"). */
export function mySwappableShift(d: OncallData, now: Date): RotationRow | null {
  return rotationRows(d, now).find((r) => r.action?.kind === 'swap') ?? null;
}

// ── Edit rotation ─────────────────────────────────────────────────────────

/** When a new order applies: the first week not yet made (weeks already scheduled keep their person). */
export function rotationFrom(d: OncallData, now: Date): Date {
  const last = d.shifts.at(-1);
  if (last && Date.parse(last.endsAt) > now.getTime()) return new Date(last.endsAt);
  // No week ahead: the first one is this week, from Monday 09:00 (oncall_week_start).
  const mon = mondayOf(now);
  const start = new Date(mon.getTime() + 9 * HOUR_MS);
  return start.getTime() > now.getTime() ? new Date(start.getTime() - WEEK_MS) : start;
}

export function rotationPreview(order: string[], d: OncallData, now: Date): string {
  if (order.length === 0) return 'Nobody yet — add someone';
  const from = rotationFrom(d, now);
  // The slot after the last week's person, as oncall_extend_shifts continues.
  const last = d.shifts.at(-1);
  const at = last ? order.indexOf(last.userId) : -1;
  return Array.from({ length: 4 }, (_, i) => {
    const w = new Date(from.getTime() + i * WEEK_MS);
    const who = order[(at + 1 + i) % order.length]!;
    return `${formatDay(w)} ${nameOf(d, who)}`;
  }).join(' · ');
}

export function rotationText(d: OncallData, now: Date): string {
  const from = rotationFrom(d, now);
  if (d.rotation.length === 0) {
    return `Pick the people who take Tier 1 nights and weekends and their order. The first week starts ${dayTime(from)}.`;
  }
  return `Changes apply from ${day(from)}. Weeks already scheduled keep their person — use Swap for those.`;
}

// ── Hand over ─────────────────────────────────────────────────────────────

export interface HandoverOption {
  value: string;
  label: string;
  at: Date;
}

/**
 * Takes effect (Users board): now, tonight's closing while owners still respond, and tomorrow at the
 * opening hour — each only while the shift still runs.
 */
export function handoverTimes(d: OncallData, shift: ShiftRow, now: Date): HandoverOption[] {
  const end = Date.parse(shift.endsAt);
  const { from, inside } = tonightOf(d, now);
  const out: HandoverOption[] = [{ value: 'now', label: `Now · ${shortWhen(now, now)}`, at: now }];
  if (inside && from.getTime() < end) {
    out.push({ value: 'tonight', label: `Tonight ${formatTime(from)}`, at: from });
  }
  const local = new Date(now.getTime() + 7 * HOUR_MS);
  const tomorrow = new Date(
    Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + 1) -
      7 * HOUR_MS +
      d.hours.startMin * 60_000,
  );
  if (tomorrow.getTime() < end) out.push({ value: 'tomorrow', label: dayTime(tomorrow), at: tomorrow });
  return out;
}

export function handoverSummary(
  d: OncallData,
  shift: ShiftRow,
  to: string,
  at: HandoverOption,
  now: Date,
): string {
  const from = nameOf(d, shift.userId);
  const until = dayTime(new Date(shift.endsAt));
  const { inside } = tonightOf(d, now);
  const when =
    at.value === 'now'
      ? `now (${shortWhen(now, now)})`
      : at.value === 'tonight'
        ? `tonight ${formatTime(at.at)}`
        : at.label;
  return `From ${when} until ${until}, Tier 1 DOWN at night and on the weekend @mentions ${to} instead of ${from}.${
    at.value === 'now' && inside
      ? ` Right now owners respond until ${formatTime(tonightOf(d, now).from)}, so nothing changes before tonight.`
      : ''
  } ${from} and ${to} get a Chat message; the On-call page updates.`;
}

// ── Footer ────────────────────────────────────────────────────────────────

export function footOf(d: OncallData, now: Date): string | null {
  if (d.rotation.length === 0 && !d.shifts.some((s) => Date.parse(s.endsAt) > now.getTime())) return null;
  const admin = d.viewer.role === 'admin';
  const backstops = d.admins.filter((id) => !d.rotation.includes(id)).map((id) => nameOf(d, id));
  const backstop = backstops.length
    ? ` ${formatNameList(backstops)} ${backstops.length === 1 ? 'isn’t' : 'aren’t'} in the rotation: as Admin backstop, ${backstops.length === 1 ? backstops[0] : 'they'} ${backstops.length === 1 ? 'is' : 'are'} at L1 for every DOWN.`
    : '';
  const live = personAt(d, now);
  if (!live) {
    const next = groupsOf(d).find((g) => g.start.getTime() > now.getTime());
    return next
      ? `The rotation starts ${dayTime(next.start)}. Until then no one is on call: Tier 1 alerts at night page each site’s owner. Shifts change Monday 09:00.`
      : null;
  }
  if (live.handedOverFrom) {
    const who = nameOf(d, live.userId);
    const from = nameOf(d, live.handedOverFrom);
    return `${from}’s live shift was handed to ${who} from ${shortWhen(new Date(live.startsAt), now)}. ${who} gets Tier 1 alerts at night and on the weekend until ${dayTime(new Date(live.endsAt))}; ${from}’s later weeks don’t change. Shifts change Monday 09:00.`;
  }
  if (onePerson(d)) {
    const who = nameOf(d, live.userId);
    return `Swap is off — nobody else in the rotation to swap with. ${who} is on call every week until an Admin adds someone in Edit rotation. Shifts change Monday 09:00.`;
  }
  return `Shifts change Monday 09:00. The live shift can’t be swapped — ${admin ? 'use “Hand over…” on its row' : 'an Admin hands it over'}.${backstop}`;
}
