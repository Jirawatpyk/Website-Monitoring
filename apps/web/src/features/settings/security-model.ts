/**
 * Sign-in & security (S16 PR 3, boards Security / MSecurity, spec §35, D-062 items 5, 8, 12): the pure
 * rules behind the page — the people rows, each person's devices, the sign-out dialog's words, the
 * on-call warning, and the recent sign-in events worded as sentences.
 */
import {
  deviceLabel,
  formatDay,
  formatTime,
  formatWhen,
  isSameBangkokDay,
  ROLE_LABELS,
  type Role,
} from '@dxt/shared';
import type { Invite, Person, ShiftRef } from './model';

export interface SessionRef {
  id: string;
  userId: string;
  userAgent: string | null;
  createdAt: string;
  lastUsed: string;
  /** The session this request runs on (the viewer's "This device"). */
  current: boolean;
}

/** An Access row of the audit log, as the page reads it. */
export interface AccessEntry {
  at: string;
  action: string;
  actorId: string | null;
  entityId: string | null;
  before: unknown;
  after: unknown;
}

export interface SecurityData {
  viewerId: string;
  /** The Workspace domains people sign in with (`ALLOWED_EMAIL_DOMAIN`, set at deploy time). */
  domains: string[];
  people: Person[];
  invites: Invite[];
  shifts: ShiftRef[];
  sessions: SessionRef[];
  /** Every person's name, the inactive too, for the events. */
  names: Record<string, string>;
  /** The newest Access rows that are sign-in events (newest first). */
  entries: AccessEntry[];
}

/** The audit actions the "Recent sign-in events" card shows (D-062 item 12). */
export const SIGNIN_ACTIONS = [
  'session.sign_out_all',
  'session.sign_out_others',
  'session.sign_out_device',
  'signin.refused',
  'user.invite',
  'user.invite_revoke',
  'user.reactivate',
  'user.deactivate',
] as const;

export interface Device {
  id: string;
  name: string;
  /** The board's outline tag: This device, Phone, Tablet, Laptop — none for an unknown device. */
  tag: string | null;
  when: string;
  current: boolean;
}

/** A person's devices, last used first: "Chrome · macOS", "Last used today 10:05", "This device". */
export function devicesOf(d: Pick<SecurityData, 'sessions'>, userId: string, now: Date): Device[] {
  return d.sessions
    .filter((s) => s.userId === userId)
    .sort((a, b) => b.lastUsed.localeCompare(a.lastUsed))
    .map((s) => {
      const label = deviceLabel(s.userAgent);
      const used = `Last used ${formatWhen(new Date(s.lastUsed), now, { midSentence: true })}`;
      return {
        id: s.id,
        name: label.name,
        tag: s.current ? 'This device' : label.tag,
        // Two unknown devices only differ by when they signed in (a session from before D-062 item 12).
        when: label.tag ? used : `${used} · signed in ${formatDay(new Date(s.createdAt), { weekday: true })}`,
        current: s.current,
      };
    });
}

export interface SecurityRow {
  key: string;
  personId: string | null;
  name: string;
  role: Role;
  /** "On call now" (bold), "On call from 28 Sep", or nothing. */
  oncall: { text: string; live: boolean } | null;
  devices: number;
  /** "Today 07:52", "Signed out · 10:08", "Not signed in yet", "No devices". */
  last: string;
  /** Desktop's row button: your own "Sign out other devices", anyone else's "Sign out all". */
  action: 'others' | 'all' | null;
}

const ORDER: Record<Role, number> = { admin: 0, responder: 1, stakeholder: 2, viewer: 3, client: 4 };

/** The newest `session.sign_out_all` per person: "Signed out · 10:08" survives a reload. */
function signedOutAt(d: SecurityData): Map<string, string> {
  const at = new Map<string, string>();
  for (const e of d.entries)
    if (e.action === 'session.sign_out_all' && e.entityId && !at.has(e.entityId)) at.set(e.entityId, e.at);
  return at;
}

/** "Signed out · 10:08" today (the boards), "Signed out · Mon 2 Nov 10:08" before — never a bare old time. */
export function signedOutLabel(at: Date, now: Date): string {
  return `Signed out · ${isSameBangkokDay(at, now) ? formatTime(at) : formatWhen(at, now)}`;
}

function oncallMark(d: SecurityData, personId: string, now: Date): SecurityRow['oncall'] {
  const t = now.getTime();
  const mine = d.shifts.filter((s) => s.userId === personId && Date.parse(s.endsAt) > t);
  if (mine.some((s) => Date.parse(s.startsAt) <= t)) return { text: 'On call now', live: true };
  const next = mine.sort((a, b) => a.startsAt.localeCompare(b.startsAt))[0];
  return next ? { text: `On call from ${formatDay(new Date(next.startsAt))}`, live: false } : null;
}

export function securityRows(d: SecurityData, now: Date): SecurityRow[] {
  const out = signedOutAt(d);
  const people = [...d.people]
    .sort((a, b) => ORDER[a.role] - ORDER[b.role] || a.name.localeCompare(b.name))
    .map((p): SecurityRow => {
      const mine = d.sessions.filter((s) => s.userId === p.id);
      const signIn = mine.map((s) => s.createdAt).sort((a, b) => b.localeCompare(a))[0];
      const outAt = out.get(p.id);
      const self = p.id === d.viewerId;
      const last = signIn
        ? formatWhen(new Date(signIn), now)
        : outAt
          ? signedOutLabel(new Date(outAt), now)
          : 'No devices';
      return {
        key: p.id,
        personId: p.id,
        name: p.name,
        role: p.role,
        oncall: oncallMark(d, p.id, now),
        devices: mine.length,
        last,
        action: self ? (mine.length > 1 ? 'others' : null) : mine.length > 0 ? 'all' : null,
      };
    });
  const invites = d.invites.map((i): SecurityRow => ({
    key: i.email,
    personId: null,
    name: i.email,
    role: i.role,
    oncall: null,
    devices: 0,
    last: 'Not signed in yet',
    action: null,
  }));
  return [...people, ...invites];
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/** "1 device", "No devices", "3 devices" (MSecurity's card line). */
export const devicesWord = (n: number) => (n === 0 ? 'No devices' : `${n} ${plural(n, 'device', 'devices')}`);

export interface SignOutCopy {
  title: string;
  description: string;
  cta: string;
}

/** The sign-out dialog's words (Security board): your own other devices, or someone everywhere. */
export function signOutCopy(name: string, self: boolean, devices: Device[]): SignOutCopy {
  if (self) {
    const here = devices.find((x) => x.current);
    const n = devices.filter((x) => !x.current).length;
    return {
      title: 'Sign out your other devices?',
      description: `This browser${here ? ` (${here.name})` : ''} stays signed in. The ${plural(n, 'device', 'devices')} below ${plural(n, 'goes', 'go')} back to the Google sign-in.`,
      cta: `Sign out ${n} other ${plural(n, 'device', 'devices')}`,
    };
  }
  const n = devices.length;
  return {
    title: `Sign out ${name} everywhere?`,
    description: `${name} goes back to the Google sign-in on ${n === 1 ? 'this device' : `these ${n} devices`}. Their role and alerts don’t change.`,
    cta: `Sign out ${n} ${plural(n, 'device', 'devices')}`,
  };
}

/**
 * The warning when the person signed out is on call now or within a week (Security board): their Ack
 * link from Chat will need a fresh Google sign-in.
 */
export function oncallWarning(
  d: Pick<SecurityData, 'shifts'>,
  personId: string,
  name: string,
  now: Date,
): { title: string; body: string } | null {
  const t = now.getTime();
  const mine = d.shifts
    .filter((s) => s.userId === personId && Date.parse(s.endsAt) > t)
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const live = mine.find((s) => Date.parse(s.startsAt) <= t);
  const at = (iso: string) => `${formatDay(new Date(iso), { weekday: true })} ${formatTime(new Date(iso))}`;
  if (live)
    return {
      title: `${name} is on call until ${at(live.endsAt)}`,
      body: `Their Ack link will need a fresh sign-in. If an alert comes before then, ${name} has to sign in with Google before acknowledging — tell ${name} first, or wait until the shift ends.`,
    };
  const next = mine[0];
  if (next && Date.parse(next.startsAt) - t <= 7 * 86_400_000)
    return {
      title: `${name} is on call from ${at(next.startsAt)}`,
      body: `Their Ack link will need a fresh sign-in. Make sure ${name} signs in again before the shift starts.`,
    };
  return null;
}

export interface SigninEvent {
  key: string;
  at: string;
  /** Desktop's mono time / MSecurity's right-hand time: "10:08", "Thu 16:40". */
  time: string;
  icon: 'log-out' | 'ban' | 'user';
  text: string;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const field = (v: unknown, k: string) => (isRecord(v) && typeof v[k] === 'string' ? (v[k] as string) : null);
const roleWord = (r: string | null) => (r && r in ROLE_LABELS ? ROLE_LABELS[r as Role] : 'someone');
const article = (w: string) => (/^[AEIOU]/.test(w) ? `an ${w}` : `a ${w}`);

/**
 * The card's lines (MSecurity: "Tao signed Nok out everywhere", "Refused sign-in · an address @gmail.com",
 * "Tao added new@dxt as an Admin"). A refused address on another domain was stored as its domain only
 * (D-062 item 7); an actor or person gone from the list reads "an Admin" / "someone".
 */
export function signinEvents(d: SecurityData, now: Date, limit = 5): SigninEvent[] {
  const who = (id: string | null, fallback: string) => (id ? (d.names[id] ?? fallback) : fallback);
  const sameDay = (iso: string) => formatWhen(new Date(iso), now);
  return d.entries.slice(0, limit).map((e, i) => {
    const actor = who(e.actorId, 'An Admin');
    const target = who(e.entityId, 'someone');
    const email = field(e.after, 'email') ?? field(e.before, 'email');
    let icon: SigninEvent['icon'] = 'user';
    let text: string;
    switch (e.action) {
      case 'session.sign_out_all':
        icon = 'log-out';
        text = `${actor} signed ${target} out everywhere`;
        break;
      case 'session.sign_out_others':
        icon = 'log-out';
        text = `${actor} signed out their other devices`;
        break;
      case 'session.sign_out_device':
        icon = 'log-out';
        text = `${actor} signed out one of their devices`;
        break;
      case 'signin.refused': {
        icon = 'ban';
        const domain = field(e.after, 'domain');
        text = `Refused sign-in · ${email ?? (domain ? `an address @${domain}` : 'an address with no domain')}`;
        break;
      }
      case 'user.invite':
        text = `${actor} added ${email ?? 'an address'} as ${article(roleWord(field(e.after, 'role')))}`;
        break;
      case 'user.invite_revoke':
        text = `${actor} removed ${email ?? 'an address'} from the access list`;
        break;
      case 'user.reactivate':
        text = `${actor} gave ${target} access again as ${article(roleWord(field(e.after, 'role')))}`;
        break;
      case 'user.deactivate':
        text = `${actor} deactivated ${target}`;
        break;
      default:
        text = e.action;
    }
    // "10:08" today, "Thu 16:40" before (MSecurity).
    const t = sameDay(e.at);
    return { key: `${e.at}-${i}`, at: e.at, time: t.replace(/^Today /, ''), icon, text };
  });
}
