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
  startsAt: string;
  endsAt: string;
}

export interface OpenSwap {
  /** You asked, or someone asked you. */
  mine: boolean;
  other: string;
  status: 'waiting' | 'accepted';
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
}

/** Only Admins and Responders take on-call weeks, and so get the phone test (D-062 item 12). */
export const canTest = (role: Role) => role === 'admin' || role === 'responder';

export interface ChannelRow {
  key: 'chat' | 'email' | 'phone';
  name: string;
  detail: string;
  status: 'Working' | 'No Chat id' | 'Not available';
}

/** "How alerts reach me" (Profile board): Chat, email, phone — the Chat row says when the id is missing. */
export function channelRows(d: ProfileData): ChannelRow[] {
  return [
    {
      key: 'chat',
      name: 'Google Chat @mention',
      detail: d.me.chatLinked
        ? 'Matched to your Chat user in DxT Website Alerts · primary'
        : 'Add your Chat id so alerts can @mention you',
      status: d.me.chatLinked ? 'Working' : 'No Chat id',
    },
    { key: 'email', name: 'Email', detail: 'Your Workspace address · record + fallback', status: 'Working' },
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
  return rows;
}

const at = (iso: string) => `${formatDay(new Date(iso), { weekday: true })} ${formatTime(new Date(iso))}`;

/** The on-call line (Profile "Tier 1 night rotation", MProfile's on-call card); null when it doesn't apply. */
export function oncallLine(d: ProfileData, now: Date): { label: string; value: string } | null {
  const t = now.getTime();
  const live = d.shifts.find((s) => Date.parse(s.startsAt) <= t && t < Date.parse(s.endsAt));
  if (live) return { label: 'Tier 1 nights and weekends', value: `On call now until ${at(live.endsAt)}` };
  const next = d.shifts.find((s) => Date.parse(s.startsAt) > t);
  if (next)
    return {
      label: 'Tier 1 nights and weekends',
      value: `Next shift ${at(next.startsAt)} → ${at(next.endsAt)}`,
    };
  if (d.inRotation)
    return { label: 'Tier 1 nights and weekends', value: 'In the rotation · no shift scheduled yet' };
  if (d.me.role === 'admin') return { label: 'Tier 1 night rotation', value: 'Not in it — Admin backstop' };
  return null;
}

/** MProfile's swap line under the next shift. */
export function swapLine(s: OpenSwap | null): string | null {
  if (!s) return null;
  if (s.mine)
    return s.status === 'waiting'
      ? `Swap requested with ${s.other} · not accepted yet. You stay on call until ${s.other} accepts.`
      : `${s.other} accepted your swap · waiting for an Admin`;
  return s.status === 'waiting' ? `${s.other} asked to swap with you — answer on On-call` : null;
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

/** "jirawat.p@… · Admin · Google Workspace account" (the board's meta, without 2-step, D-062 item 8). */
export const metaLine = (d: ProfileData) =>
  `${d.me.email} · ${ROLE_LABELS[d.me.role]} · Google Workspace account`;
