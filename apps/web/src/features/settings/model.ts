import { formatDay, formatWhen, ROLE_LABELS, type Role } from '@dxt/shared';

/**
 * Users & roles (S16, D-062, spec §14.9, §35): the pure rules behind the page — the role matrix and its
 * diff, where a person is used and who may take each place over, the picks the SQL takes, and the
 * words for its refusals. The SQL (`change_user_role` / `deactivate_user`) checks everything again.
 */

/** The roles a person can be given here (client is Phase 3). */
export const STAFF_ROLES = ['admin', 'responder', 'stakeholder', 'viewer'] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

export const isStaffRole = (r: string): r is StaffRole => (STAFF_ROLES as readonly string[]).includes(r);

// ── The role matrix (Users / MUsers boards): rows and diff in @dxt/shared (D-062 item 13) ─────────

export { gainsLoses, MATRIX_ROLES, ROLE_MATRIX, roleRows, type Cell } from '@dxt/shared';

// ── The page's data ────────────────────────────────────────────────────────────────────────────────

export interface Person {
  id: string;
  name: string;
  email: string;
  role: Role;
  /** Has a Google Chat user id (D-015): can own a site, gets @mentions. */
  chatLinked: boolean;
  /** Newest use of any of their signed-in devices; null = none. */
  lastActive: string | null;
  /** D-078: tagged Management (an Admin only). */
  management?: boolean;
}

export interface Invite {
  email: string;
  role: Role;
  addedAt: string;
}

export interface SiteRef {
  id: string;
  name: string;
  live: boolean;
  ownerId: string | null;
  backupId: string | null;
}

export interface ClientRef {
  id: string;
  name: string;
  amId: string | null;
}

export interface ShiftRef {
  id: string;
  userId: string;
  startsAt: string;
  endsAt: string;
}

export interface SwapRef {
  id: string;
  requesterId: string;
  counterpartId: string;
}

export interface AckRef {
  label: string;
  ackedBy: string;
}

export interface UsersData {
  viewerId: string;
  /** Active people only: a deactivated person leaves the list (they come back by being invited again). */
  people: Person[];
  invites: Invite[];
  sites: SiteRef[];
  clients: ClientRef[];
  /** The rotation's people in order. */
  rotation: string[];
  /** Shifts not over yet. */
  shifts: ShiftRef[];
  /** Open swaps (waiting / accepted). */
  swaps: SwapRef[];
  /** Open incidents someone acknowledged (info in "Used in"). */
  acks: AckRef[];
  /** The email provider is set up (D-013): only then does the dialog promise the role-change email. */
  emailOn?: boolean;
  /** D-078: an escalation step goes to Management — until one does, the tag changes nobody's alerts. */
  managementUsed?: boolean;
}

/** The role-change / deactivate dialog's description (spec §14.9, §34). */
export function changeDialogText(
  name: string,
  deactivate: boolean,
  emailOn: boolean,
  management = false,
): string {
  const mail = emailOn ? ` ${name} gets an email saying what changed.` : '';
  // D-078 (§43.5): the tag is an Admin's only — a role change or a deactivation takes it
  const leaves = management ? ` ${name} will also leave Management.` : '';
  return deactivate
    ? `${name} loses access at once — every device is signed out — and stops getting alerts and digests. Past acknowledgements and notes stay in the audit log; an Admin can give access back by adding them again.${leaves}${mail}`
    : `Takes effect as soon as you confirm.${leaves}${mail}`;
}

const canOwn = (role: Role) => role === 'admin' || role === 'responder';
const canBeAm = (role: Role) => role === 'admin' || role === 'responder' || role === 'stakeholder';

export const nameOf = (d: UsersData, id: string | null) =>
  (id && d.people.find((p) => p.id === id)?.name) ?? '—';

/** Active Admins. */
export const admins = (d: UsersData) => d.people.filter((p) => p.role === 'admin');

/** The CEO for escalation (D-032): an active Stakeholder who manages no client. */
export const ceos = (d: UsersData) =>
  d.people.filter((p) => p.role === 'stakeholder' && !d.clients.some((c) => c.amId === p.id));

/** The On-call column: "On call now", "Next on call 5 Oct", "Admin backstop", or "—". */
export function oncallOf(d: UsersData, p: Person, now: Date): { text: string; live: boolean } {
  const mine = d.shifts.filter((s) => s.userId === p.id).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const live = mine.find(
    (s) => Date.parse(s.startsAt) <= now.getTime() && now.getTime() < Date.parse(s.endsAt),
  );
  if (live) return { text: 'On call now', live: true };
  const next = mine.find((s) => Date.parse(s.startsAt) > now.getTime());
  if (next) return { text: `Next on call ${formatDay(new Date(next.startsAt))}`, live: false };
  if (p.role === 'admin') return { text: 'Admin backstop', live: false };
  return { text: '—', live: false };
}

/** The live shift a person holds now, for Hand over shift… */
export function liveShiftOf(d: UsersData, personId: string, now: Date): ShiftRef | null {
  return (
    d.shifts.find(
      (s) =>
        s.userId === personId &&
        Date.parse(s.startsAt) <= now.getTime() &&
        now.getTime() < Date.parse(s.endsAt),
    ) ?? null
  );
}

/** "6 · 1": owner of, backup on. */
export function ownsOf(d: UsersData, id: string): { owner: number; backup: number } {
  return {
    owner: d.sites.filter((s) => s.ownerId === id).length,
    backup: d.sites.filter((s) => s.backupId === id).length,
  };
}

export const isAm = (d: UsersData, id: string) => d.clients.some((c) => c.amId === id);

export function lastActiveLabel(p: Person, now: Date): string {
  return p.lastActive ? formatWhen(new Date(p.lastActive), now) : '—';
}

// ── Who may act on whom (the ⋯ menu) ──────────────────────────────────────────────────────────────

/** Why Change role… / Deactivate… is off for this row, or null. */
export function changeBlockedWhy(d: UsersData, p: Person): string | null {
  if (p.id === d.viewerId) return 'You can’t change your own access — ask another Admin.';
  if (p.role === 'admin' && admins(d).length <= 1)
    return 'They’re the only active Admin — invite another Admin first.';
  return null;
}

// ── "Used in" (§14.9) ──────────────────────────────────────────────────────────────────────────────

/** The role they're changed to, or deactivated. */
export type Target = StaffRole | 'deactivated';

export interface Option {
  value: string;
  label: string;
}

export interface SitePick {
  /** `owner:<site>` or `backup:<site>` — the pick's key. */
  key: string;
  site: string;
  /** "Backup here: Arm" — the other side, who can't be picked. */
  hint: string;
  options: Option[];
}

export interface UsageItem {
  key: string;
  label: string;
  detail: string;
  /** A new person is needed (pickers below), or it blocks (`blocked`). */
  need: boolean;
  /** Pick per site (owner / backup). */
  sites?: SitePick[];
  /** One pick for all of it (AM, shifts). */
  pick?: { key: string; label: string; options: Option[]; empty: string };
  /** Info lines that need no pick (rotation, swaps, acknowledgements, the CEO). */
  info?: boolean;
  /** Can't save at all until fixed elsewhere (the rotation's last person). */
  blocked?: boolean;
  /** Warn but allow (the last CEO, D-062 item 4). */
  warn?: boolean;
}

const article = (role: string) => (/^[AEIOU]/.test(role) ? 'An' : 'A');

/**
 * Every place `personId` is used, and what each needs if they become `target`. Mirrors
 * `private.user_usage_problems` and `private.user_reassign` (PR 1): owners / backups and shifts need an
 * Admin or Responder; an AM is fine as Admin, Responder or Stakeholder; the rotation and open swaps
 * close on their own; the rotation's last person can't leave.
 */
export function usageOf(d: UsersData, personId: string, target: Target, now: Date): UsageItem[] {
  const person = d.people.find((p) => p.id === personId);
  if (!person) return [];
  const deact = target === 'deactivated';
  const needOwner = deact || !canOwn(target);
  const needAm = deact || !canBeAm(target);
  const toName = deact ? null : ROLE_LABELS[target];
  const stays = `Stays with ${person.name} — ${article(toName ?? 'A').toLowerCase()} ${toName} can still do this`;
  const verdict = (need: boolean) =>
    need
      ? deact
        ? 'Reassign before deactivating'
        : `${article(toName!)} ${toName} can’t do this — reassign first`
      : stays;
  const items: UsageItem[] = [];
  const others = d.people.filter((p) => p.id !== personId);
  const ownerPool = others.filter((p) => canOwn(p.role) && p.chatLinked);

  const siteItem = (slot: 'owner' | 'backup') => {
    const sites = d.sites.filter((s) => (slot === 'owner' ? s.ownerId : s.backupId) === personId);
    if (!sites.length) return;
    items.push({
      key: slot,
      label: `${slot === 'owner' ? 'Owner of' : 'Backup on'} ${sites.length} site${sites.length === 1 ? '' : 's'}`,
      detail: `${sites.map((s) => s.name).join(' · ')} · ${verdict(needOwner)}`,
      need: needOwner,
      ...(needOwner
        ? {
            sites: sites.map((s) => {
              const otherId = slot === 'owner' ? s.backupId : s.ownerId;
              return {
                key: `${slot}:${s.id}`,
                site: s.name,
                hint: `${slot === 'owner' ? 'Backup' : 'Owner'} here: ${nameOf(d, otherId)}`,
                options: ownerPool
                  .filter((p) => p.id !== otherId)
                  .map((p) => ({ value: p.id, label: `${p.name} (${ROLE_LABELS[p.role]})` })),
              };
            }),
          }
        : {}),
    });
  };
  siteItem('owner');
  siteItem('backup');

  const clients = d.clients.filter((c) => c.amId === personId);
  if (clients.length) {
    items.push({
      key: 'am',
      label: `Site AM of ${clients.length} client${clients.length === 1 ? '' : 's'}`,
      detail: `${clients.map((c) => c.name).join(', ')} · ${verdict(needAm)}`,
      need: needAm,
      ...(needAm
        ? {
            pick: {
              key: 'am',
              label: 'New AM for these clients',
              empty: 'Nobody else can be Site AM — add an Admin, Responder or Stakeholder first.',
              options: others
                .filter((p) => canBeAm(p.role))
                .map((p) => ({ value: p.id, label: `${p.name} (${ROLE_LABELS[p.role]})` })),
            },
          }
        : {}),
    });
  }

  const shifts = d.shifts
    .filter((s) => s.userId === personId)
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  if (shifts.length) {
    const live = shifts.some((s) => Date.parse(s.startsAt) <= now.getTime());
    items.push({
      key: 'shifts',
      label: `On-call shift${shifts.length === 1 ? '' : 's'}`,
      detail: `${shifts.map((s) => `${formatDay(new Date(s.startsAt), { weekday: true })} → ${formatDay(new Date(s.endsAt), { weekday: true })}`).join(' · ')} · ${verdict(needOwner)}`,
      need: needOwner,
      ...(needOwner
        ? {
            pick: {
              key: 'shifts',
              label: live ? 'Hand the live shift and the weeks ahead to' : 'Take over these shifts',
              empty: 'Nobody else can be on call — add an Admin or Responder first.',
              options: others.filter((p) => canOwn(p.role)).map((p) => ({ value: p.id, label: p.name })),
            },
          }
        : {}),
    });
  }

  if (needOwner && d.rotation.includes(personId)) {
    const last = d.rotation.length <= 1;
    items.push({
      key: 'rotation',
      label: 'On-call rotation',
      detail: last
        ? `${person.name} is the only person in the rotation — add someone on On-call first, or nobody is on call once the weeks already made run out.`
        : `${person.name} leaves the rotation; the next weeks go to whoever came after them.`,
      need: last,
      info: !last,
      blocked: last,
    });
  }

  if (needOwner) {
    const swaps = d.swaps.filter((w) => w.requesterId === personId || w.counterpartId === personId);
    if (swaps.length)
      items.push({
        key: 'swaps',
        label: `Open swap request${swaps.length === 1 ? '' : 's'}`,
        detail: `${swaps.map((w) => `with ${nameOf(d, w.requesterId === personId ? w.counterpartId : w.requesterId)}`).join(' · ')} · closes, and both are told`,
        need: false,
        info: true,
      });
    const acks = d.acks.filter((a) => a.ackedBy === personId);
    if (acks.length)
      items.push({
        key: 'acks',
        label: `Acknowledged ${acks.length} open incident${acks.length === 1 ? '' : 's'}`,
        detail: `${acks.map((a) => a.label).join(' · ')} · stays acknowledged by ${person.name}; anyone who may act can still resolve it`,
        need: false,
        info: true,
      });
  }

  // The CEO token (D-032): who gets Tier 1 L2. Warn only (D-062 item 4).
  const isCeoNow = person.role === 'stakeholder' && !clients.length;
  const isCeoAfter = target === 'stakeholder' && !clients.length;
  if (isCeoNow && !isCeoAfter && ceos(d).length <= 1)
    items.push({
      key: 'ceo',
      label: 'Escalation · CEO step',
      detail: `${person.name} is the only one who gets the CEO step on Tier 1 DOWN — L2 will reach the Site AM only until another Stakeholder who manages no client is added.`,
      need: false,
      info: true,
      warn: true,
    });
  if (!isCeoNow && isCeoAfter)
    items.push({
      key: 'ceo',
      label: 'Escalation · CEO step',
      detail: `As a Stakeholder who manages no client, ${person.name} gets the CEO step on Tier 1 DOWN (L2 and L3).`,
      need: false,
      info: true,
    });
  return items;
}

export type Picks = Record<string, string>;

/** The keys still without a person ("Pick a person" / "Pick who takes this over"). */
export function missingPicks(items: UsageItem[], picks: Picks): string[] {
  const keys = items.flatMap((i) => [...(i.sites ?? []).map((s) => s.key), ...(i.pick ? [i.pick.key] : [])]);
  return keys.filter((k) => !picks[k]);
}

/** Saving is blocked by a place nobody can take over from here (the rotation's last person). */
export const blockedBy = (items: UsageItem[]) => items.filter((i) => i.blocked);

/** The picks as `change_user_role` / `deactivate_user` take them. */
export function reassignPayload(picks: Picks) {
  const owners: Record<string, string> = {};
  const backups: Record<string, string> = {};
  const out: {
    owners?: Record<string, string>;
    backups?: Record<string, string>;
    am?: string;
    shifts?: string;
  } = {};
  for (const [k, v] of Object.entries(picks)) {
    if (!v) continue;
    const [kind, id] = k.split(':');
    if (kind === 'owner' && id) owners[id] = v;
    else if (kind === 'backup' && id) backups[id] = v;
    else if (k === 'am') out.am = v;
    else if (k === 'shifts') out.shifts = v;
  }
  if (Object.keys(owners).length) out.owners = owners;
  if (Object.keys(backups).length) out.backups = backups;
  return out;
}

/** "N of M need a new person" / "Nothing needs reassigning". */
export function usageSummary(items: UsageItem[]): string {
  const counted = items.filter((i) => !i.info);
  const need = counted.filter((i) => i.need).length;
  if (!items.length) return '';
  return need ? `${need} of ${counted.length} need a new person` : 'Nothing needs reassigning';
}

// ── Invite ─────────────────────────────────────────────────────────────────────────────────────────

/** The Role select's hint in the Invite dialog (D-062: no 2-step words). */
export const INVITE_HINTS: Record<StaffRole, string> = {
  admin: 'Manages sites, people and escalation, and gets monitor-fault emails.',
  responder: 'Can own sites and join the on-call rotation once they sign in.',
  stakeholder:
    'Can be a client’s Site AM. While they manage no client they get the CEO step on Tier 1 DOWN (L2 and L3).',
  viewer: 'Sees the dashboard and history. Gets no alerts.',
};

export const EMAIL_SHAPE = /^[^@\s]+@[^@\s]+$/;

// ── The page's rows (Users table, MUsers cards) ───────────────────────────────────────────────────

export interface UserRow {
  key: string;
  /** A person (profile), or null for an address nobody has signed in with yet. */
  personId: string | null;
  email: string;
  name: string;
  role: Role;
  /** "arm@… · AM", "Not signed in yet · added Thu 24 Sep". */
  sub: string;
  /** "Chat · Email", "Email · No Chat id", "Not needed · Viewer", "After joining". */
  channels: string;
  /** "6 · 1" owner · backup, or "—". */
  owns: string;
  oncall: { text: string; live: boolean };
  /** "Today 10:05", "Not signed in yet", "—". */
  last: string;
  /** MUsers' third line: on-call and last active, or "No Chat id · …". */
  meta: string;
  /** D-078: the Management badge beside the role. */
  management: boolean;
}

function channelsOf(p: Person): string {
  if (p.role === 'viewer') return 'Not needed · Viewer';
  return p.chatLinked ? 'Chat · Email' : 'Email · No Chat id';
}

export function userRows(d: UsersData, now: Date): UserRow[] {
  const people: UserRow[] = d.people.map((p) => {
    const o = ownsOf(d, p.id);
    const oncall = oncallOf(d, p, now);
    const last = lastActiveLabel(p, now);
    const lastLower = p.lastActive ? formatWhen(new Date(p.lastActive), now, { midSentence: true }) : null;
    const lead =
      oncall.text !== '—' ? oncall.text : !p.chatLinked && p.role !== 'viewer' ? 'No Chat id' : null;
    return {
      key: p.id,
      personId: p.id,
      email: p.email,
      name: p.name,
      role: p.role,
      sub: isAm(d, p.id) ? `${p.email} · AM` : p.email,
      channels: channelsOf(p),
      owns: o.owner || o.backup ? `${o.owner} · ${o.backup}` : '—',
      oncall,
      last,
      meta: [lead, lastLower].filter(Boolean).join(' · ') || '—',
      management: !!p.management,
    };
  });
  const invites: UserRow[] = d.invites.map((i) => ({
    key: `invite:${i.email}`,
    personId: null,
    email: i.email,
    name: i.email,
    role: i.role,
    sub: `Not signed in yet · added ${formatDay(new Date(i.addedAt), { weekday: true })}`,
    channels: 'After joining',
    owns: '—',
    oncall: { text: '—', live: false },
    last: 'Not signed in yet',
    meta: 'Can’t get alerts until their first sign-in',
    management: false,
  }));
  return [...people, ...invites];
}

/** The warning while one Admin is active (§35.2): the real name, and why. */
export function oneAdminBanner(d: UsersData): { title: string; body: string } | null {
  const a = admins(d);
  if (a.length !== 1) return null;
  const pending = d.invites.find((i) => i.role === 'admin');
  return {
    title: `1 active Admin — monitor-fault alerts reach only ${a[0]!.name}`,
    body: pending
      ? `${pending.email} was added as an Admin but hasn’t signed in yet.`
      : 'Add another Admin so monitor-fault alerts don’t depend on one person.',
  };
}

export const countLine = (d: UsersData) =>
  `${d.people.length + d.invites.length} people · Google Workspace accounts only · role changes are logged`;

/** D-078 (§43.6): the sheet fact of a Management Admin. */
export const MANAGEMENT_FACT = 'Gets the L2 step on Tier 1 DOWN';

/**
 * Why "Set as Management…" is off (§43.3), or null: only an Admin, and one with a Chat id (Management is
 * @mentioned). "Remove from Management…" is never off here; the last-Management rule comes with the token.
 */
export function managementBlockedWhy(p: Person): string | null {
  if (p.management) return null;
  if (p.role !== 'admin') return 'Only Admins can be Management';
  if (!p.chatLinked) return 'Add a Google Chat id first — Management is @mentioned.';
  return null;
}

/**
 * The confirm's words (§43.4). Until an escalation step goes to Management the tag changes nobody's
 * alerts, so it says that instead of promising the L2 step (D-078 item 3e).
 */
export function managementDialog(d: UsersData, p: Person): { title: string; lines: string[]; done: string } {
  const on = !p.management;
  const others = d.people.filter((x) => x.management && x.id !== p.id).map((x) => x.name);
  const lines: string[] = [];
  if (!d.managementUsed) {
    lines.push(
      on
        ? 'No escalation step goes to Management yet — nothing changes until Tier 1 DOWN L2 is set to Management on Escalation.'
        : "No escalation step goes to Management yet — removing it changes nobody's alerts.",
    );
  } else if (on) {
    lines.push(
      'Gets the L2 step on Tier 1 DOWN (+30 min, @mentioned in Chat + email).',
      'No longer told at L1 as an Admin.',
    );
    const outside = d.people.filter((x) => x.role === 'admin' && !x.management && x.id !== p.id);
    if (!outside.length)
      lines.push('Every active Admin would then be Management, so L1 tells only the backup — no Admin.');
  } else {
    lines.push('No longer gets the L2 step on Tier 1 DOWN.', 'Told at L1 again as an Admin (Chat + email).');
    if (others.length) lines.push(`L2 still goes to ${others.join(', ')}.`);
  }
  if (d.emailOn) lines.push(`${p.name} gets an email saying what changed.`);
  return {
    title: on ? `Set ${p.name} as Management?` : `Remove ${p.name} from Management?`,
    lines,
    done: on ? `${p.name} is Management · logged` : `${p.name} removed from Management · logged`,
  };
}

/** The MUsers sheet (§35.3): Role, Alert channels, Owner · backup (or Clients and escalation), On-call, Last active. */
export function sheetFacts(d: UsersData, r: UserRow): { k: string; v: string }[] {
  if (!r.personId)
    return [
      { k: 'Role', v: ROLE_LABELS[r.role] },
      { k: 'Alert channels', v: 'Not set up yet — they sign in first' },
      { k: 'Last active', v: 'Not signed in yet' },
    ];
  const id = r.personId;
  const owner = d.sites.filter((s) => s.ownerId === id).map((s) => s.name);
  const backup = d.sites.filter((s) => s.backupId === id).map((s) => s.name);
  const clients = d.clients.filter((c) => c.amId === id).map((c) => c.name);
  const own =
    r.role === 'stakeholder'
      ? clients.length
        ? `Site AM for ${clients.join(', ')}`
        : 'Gets the CEO step on Tier 1 DOWN (L2 and L3)'
      : [
          owner.length ? `Owner of ${owner.length} — ${owner.join(', ')}` : null,
          backup.length ? `backup on ${backup.length} — ${backup.join(', ')}` : null,
        ]
          .filter(Boolean)
          .join(' · ') || '—';
  return [
    { k: 'Role', v: ROLE_LABELS[r.role] },
    ...(r.management ? [{ k: 'Management', v: MANAGEMENT_FACT }] : []),
    { k: 'Alert channels', v: r.channels },
    { k: r.role === 'stakeholder' ? 'Clients and escalation' : 'Owner · backup', v: own },
    { k: 'On-call', v: r.oncall.text },
    { k: 'Last active', v: r.last },
  ];
}
