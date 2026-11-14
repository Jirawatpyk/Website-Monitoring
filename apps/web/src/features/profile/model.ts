/**
 * My profile (S16 PR 3, boards Profile / MProfile, spec §22.6, §10, D-062 items 6, 12): the pure rules
 * behind the page — how alerts reach me, the sites I'm responsible for, where I sit in escalation (read
 * from the policies, never the board's sample lines), my next on-call shift and the values that are the
 * same for everyone.
 */
import { formatDay, formatTime, ROLE_LABELS, type Role, type SiteStatus } from '@dxt/shared';
import type { SessionRef } from '@/features/settings';

export interface MySite {
  id: string;
  name: string;
  tier: number;
  status: SiteStatus | null;
  /** Owner / Backup of the site, or AM of its client. */
  role: 'Owner' | 'Backup' | 'AM';
  /** The open incident's id, if any: the row links there instead of the site (MProfile). */
  incident: string | null;
  /** Muted until (§11: an overlay under the status, never a status). */
  mutedUntil: string | null;
  /** The site's client is internal: no client-update track (D-052). */
  internal: boolean;
}

export interface PolicyStep {
  level: number;
  delayMin: number;
  targets: string[];
  fyi: boolean;
}

export interface Policy {
  severity: 'down' | 'problem';
  /** Null for PROBLEM (every tier). */
  tier: number | null;
  steps: PolicyStep[];
}

export interface Shift {
  id: string;
  startsAt: string;
  endsAt: string;
}

export interface OpenSwap {
  /** You asked, or someone asked you. */
  mine: boolean;
  other: string;
  status: 'waiting' | 'accepted';
  /** Your shift the swap is about (yours if you asked, the one asked of you otherwise). */
  shiftId: string;
}

export interface ProfileData {
  me: { id: string; name: string; email: string; role: Role; chatLinked: boolean };
  sessions: SessionRef[];
  sites: MySite[];
  /** A Stakeholder who manages no client is the CEO for Tier 1 L2 (D-009). */
  isCeo: boolean;
  isAm: boolean;
  policies: Policy[];
  inRotation: boolean;
  shifts: Shift[];
  swap: OpenSwap | null;
  hours: { start: string; end: string; days: number[] };
  /** Email goes out only with the provider set up (RESEND_API_KEY + ALERT_EMAIL_FROM); D-013: never promise it. */
  emailOn: boolean;
  /** Active Admins' names, for the one-Admin warning (D-009: a second Admin before G1). */
  admins: string[];
  /** Your last test alert (`oncall_checklist.test_sent_at`): the button waits a minute after it, reload or not. */
  testSentAt: string | null;
}

/** Only Admins and Responders take on-call weeks, and so get the phone test (D-062 item 12). */
export const canTest = (role: Role) => role === 'admin' || role === 'responder';

export interface ChannelRow {
  key: 'chat' | 'email' | 'phone';
  name: string;
  detail: string;
  status: 'Working' | 'No Chat id' | 'Not available' | 'Not set up';
}

/** "How alerts reach me" (Profile board): Chat, email, phone — the Chat row says when the id is missing. */
export function channelRows(d: ProfileData): ChannelRow[] {
  return [
    {
      key: 'chat',
      name: 'Google Chat @mention',
      detail: d.me.chatLinked
        ? 'Alerts @mention your Chat user id in DxT Website Alerts · primary'
        : 'Add your Chat id so alerts can @mention you',
      status: d.me.chatLinked ? 'Working' : 'No Chat id',
    },
    {
      key: 'email',
      name: 'Email',
      detail: 'Your Workspace address · record + fallback',
      status: d.emailOn ? 'Working' : 'Not set up',
    },
    {
      key: 'phone',
      name: 'Phone call (Twilio)',
      detail: 'Only if the CEO approves voice calls for Tier 1 at L2',
      status: 'Not available',
    },
  ];
}

/** "Owner of 3 · backup for 2" (MProfile); an AM's "AM for 4". */
export function sitesSummary(d: ProfileData): string {
  const n = (r: MySite['role']) => d.sites.filter((s) => s.role === r).length;
  const parts = [
    n('Owner') ? `Owner of ${n('Owner')}` : null,
    n('Backup') ? `backup for ${n('Backup')}` : null,
    n('AM') ? `AM for ${n('AM')}` : null,
  ].filter(Boolean) as string[];
  const text = parts.join(' · ');
  return text ? text[0]!.toUpperCase() + text.slice(1) : 'No sites yet';
}

const count = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`;

/**
 * "Where I sit in escalation": one line per policy I appear in, with each of my steps and why I'm on
 * it ("L0 at once as owner of 3 sites · L1 at +15 min as Admin"). Read from the policies (D-062 item 12):
 * a policy where none of my roles appears has no line.
 */
export function escalationRows(d: ProfileData): { label: string; value: string }[] {
  const rows: { label: string; value: string }[] = [];
  const order = [...d.policies].sort((a, b) =>
    a.severity === b.severity ? (a.tier ?? 0) - (b.tier ?? 0) : a.severity === 'down' ? -1 : 1,
  );
  for (const p of order) {
    const inTier = (r: MySite['role']) =>
      d.sites.filter((s) => s.role === r && (p.tier === null || s.tier === p.tier)).length;
    const why = (token: string): string | null => {
      switch (token) {
        case 'owner':
          return inTier('Owner') ? `as owner of ${count(inTier('Owner'), 'site')}` : null;
        case 'backup':
          return inTier('Backup') ? `as backup for ${count(inTier('Backup'), 'site')}` : null;
        case 'admins':
          return d.me.role === 'admin' ? 'as Admin' : null;
        case 'site_am':
          return inTier('AM') ? `as Site AM for ${count(inTier('AM'), 'site')}` : null;
        case 'ceo':
          return d.isCeo ? 'as CEO' : null;
        default:
          return null;
      }
    };
    const mine = [...p.steps]
      .sort((a, b) => a.level - b.level)
      .flatMap((s) => {
        const reason = s.targets.map(why).find((w) => w);
        if (!reason) return [];
        const when = s.level === 0 ? 'at once' : `at +${s.delayMin} min`;
        return [`L${s.level} ${when} ${reason}${s.fyi ? ' (FYI)' : ''}`];
      });
    if (mine.length)
      rows.push({
        label: p.severity === 'down' ? `Tier ${p.tier} DOWN` : 'PROBLEM, every tier',
        value: mine.join(' · '),
      });
  }
  // Internal clients get no client-update track (D-052, server/engine/client-update.ts).
  const amOf = (tier: number) =>
    d.sites.filter((x) => x.role === 'AM' && x.tier === tier && !x.internal).length;
  if (amOf(1) || amOf(2))
    rows.push({
      label: 'Client update',
      value: [
        amOf(1)
          ? `@mentioned with a draft once a Tier 1 site is down 15 min (${count(amOf(1), 'site')})`
          : null,
        amOf(2) ? `Tier 2: down 60 min in response hours (${count(amOf(2), 'site')})` : null,
      ]
        .filter(Boolean)
        .join(' · '),
    });
  if (d.me.role === 'admin')
    rows.push({
      label: 'Monitor faults',
      value: 'A probe location silent over 3 min → email to every Admin, no page',
    });
  return rows;
}

/**
 * Monitor faults reach the active Admins only: with one, they reach one person (D-009). The name, for
 * the page's "{name} is the only active Admin" (Escalation's words).
 */
export function onlyAdmin(d: ProfileData): string | null {
  if (d.me.role !== 'admin' || d.admins.length !== 1) return null;
  return d.admins[0] ?? null;
}

const at = (iso: string) => `${formatDay(new Date(iso), { weekday: true })} ${formatTime(new Date(iso))}`;

/** The escalation card's on-call row (MProfile "On call (nights, weekends) → L0 for every Tier 1 site"). */
export function oncallLine(d: ProfileData, now: Date): { label: string; value: string } | null {
  const t = now.getTime();
  const live = d.shifts.some((s) => Date.parse(s.startsAt) <= t && t < Date.parse(s.endsAt));
  const next = d.shifts.find((s) => Date.parse(s.startsAt) > t);
  const label = 'On call (nights, weekends)';
  if (live) return { label, value: 'L0 for every Tier 1 site — on call now' };
  if (next)
    return {
      label,
      value: `L0 for every Tier 1 site · next shift ${formatDay(new Date(next.startsAt), { weekday: true })}`,
    };
  if (d.inRotation) return { label, value: 'In the rotation · no shift scheduled yet' };
  if (d.me.role === 'admin') return { label: 'Tier 1 night rotation', value: 'Not in it — Admin backstop' };
  return null;
}

/** MProfile's on-call card: "Mon 5 Oct → Mon 12 Oct", the live shift's end, or nothing. */
export function shiftCard(
  d: ProfileData,
  now: Date,
): { eyebrow: string; value: string; shiftId: string } | null {
  const t = now.getTime();
  const live = d.shifts.find((s) => Date.parse(s.startsAt) <= t && t < Date.parse(s.endsAt));
  if (live) return { eyebrow: 'ON CALL NOW', value: `Until ${at(live.endsAt)}`, shiftId: live.id };
  const next = d.shifts.find((s) => Date.parse(s.startsAt) > t);
  if (!next) return null;
  return {
    shiftId: next.id,
    eyebrow: 'MY NEXT ON-CALL SHIFT',
    value: `${formatDay(new Date(next.startsAt), { weekday: true })} → ${formatDay(new Date(next.endsAt), { weekday: true })}`,
  };
}

/** MProfile's swap under the next shift: the badge, its line, and what it means for you. */
export function swapLine(
  s: OpenSwap | null,
  d?: Pick<ProfileData, 'shifts'>,
  shownShiftId?: string,
): { badge: string; line: string; note: string | null } | null {
  if (!s) return null;
  // A swap about a later shift says which one, and nothing about "this shift" (spec-checker pass 2).
  if (shownShiftId && s.shiftId !== shownShiftId) {
    const shift = d?.shifts.find((x) => x.id === s.shiftId);
    const day = shift ? ` for ${formatDay(new Date(shift.startsAt), { weekday: true })}` : '';
    if (!s.mine && s.status !== 'waiting') return null;
    return {
      badge: s.mine ? (s.status === 'waiting' ? 'Swap requested' : 'Swap accepted') : 'Swap asked',
      line: s.mine ? `${day.trim()} · with ${s.other}` : `${s.other} asked to swap${day}`,
      note: s.mine ? null : 'Answer on On-call.',
    };
  }
  if (s.mine)
    return s.status === 'waiting'
      ? {
          badge: 'Swap requested',
          line: `with ${s.other} · not accepted yet`,
          note: `You stay on call for this shift until ${s.other} accepts.`,
        }
      : { badge: 'Swap accepted', line: `by ${s.other} · waiting for an Admin`, note: null };
  return s.status === 'waiting'
    ? { badge: 'Swap asked', line: `${s.other} asked to swap with you`, note: 'Answer on On-call.' }
    : null;
}

const DAYS = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** "Mon–Fri 09:00–18:00" from ISO days and the stored times. */
export function hoursText(h: ProfileData['hours']): string {
  const days = [...h.days].sort((a, b) => a - b);
  const run = days.every((x, i) => i === 0 || x === days[i - 1]! + 1);
  const dayText = !days.length
    ? 'No days'
    : run && days.length > 2
      ? `${DAYS[days[0]!]}–${DAYS[days[days.length - 1]!]}`
      : days.map((x) => DAYS[x]).join(', ');
  return `${dayText} ${h.start.slice(0, 5)}–${h.end.slice(0, 5)}`;
}

/** "Same for everyone" (Profile board). */
export function sameForEveryone(d: ProfileData): { label: string; value: string }[] {
  return [
    { label: 'Response hours · Tier 1', value: '24/7' },
    { label: 'Response hours · Tier 2–3', value: hoursText(d.hours) },
    { label: 'Time zone', value: 'Thailand (UTC+7)' },
    { label: 'Language', value: 'English in v1' },
  ];
}

/** "arm@… · Responder · Google Workspace account" (the board's meta, without 2-step, D-062 item 8). */
export const metaLine = (d: ProfileData) =>
  `${d.me.email} · ${ROLE_LABELS[d.me.role]} · Google Workspace account`;
