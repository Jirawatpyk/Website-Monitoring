import { formatDay, formatTime, ROLE_LABELS, roleDiff, type Role } from '@dxt/shared';
import {
  EMAIL_COLORS as C,
  emailLayout,
  senderDomain,
  type EmailMessage,
  type EmailSection,
} from './email-alerts';

/**
 * The account emails (EmailAlert › Account · role change, spec §34, D-062 item 13): one email to the
 * person whose role changed or who was deactivated, never threaded, nothing to anyone else. Grey bar,
 * ROLE CHANGED / ACCESS REMOVED, who and when, the lists from the role matrix (`roleDiff`), WHAT MOVED
 * TO SOMEONE ELSE, Open DxT Monitor. A promotion to Admin starts with WHAT COMES WITH ADMIN. Deactivated:
 * no lists and no button.
 */

/** One place the person held and who has it now, as the account event froze it. */
export type AccountMove =
  | { kind: 'owner' | 'backup' | 'am'; place: string; with: string }
  | { kind: 'shift'; starts: string; ends: string; with: string };

export interface AccountFacts {
  actor: string;
  was_am: boolean;
  manages_clients: boolean;
  left_rotation: boolean;
  /** The other active Admins, for a promotion to Admin. */
  admins: string[];
  moves: AccountMove[];
  /** D-078: the other people who are Management, for a Management email. */
  others?: string[];
}

export type AccountEventKind = 'role_changed' | 'deactivated' | 'management_set' | 'management_removed';

export interface AccountEmailInput {
  eventId: string;
  kind: AccountEventKind;
  fromRole: Role;
  toRole: Role | null;
  at: Date;
  facts: AccountFacts;
  /** The sender (`ALERT_EMAIL_FROM`), for the email's own Message-ID domain. */
  from: string;
  appUrl: string;
}

const when = (d: Date) => `${formatDay(d, { weekday: true })} ${formatTime(d)}`;
const article = (role: Role) => (role === 'admin' ? 'an' : 'a');

export const accountFooter = (actor: string) =>
  `Times in Thailand time (UTC+7). This is an automated message — replies aren’t read. Questions about your access: ask an Admin (${actor}).`;

const DEACTIVATED_NOTE = 'You no longer get alerts, digests or client-update pings.';

/**
 * Set as / removed from Management (D-078, spec §43.4): one email to the person. No role lists (the role
 * doesn't change) and nothing moved — what the tag does on the escalation ladder, and who else has it.
 */
function managementEmail(
  input: AccountEmailInput,
  at: string,
  headers: Record<string, string>,
  footer: string,
): EmailMessage {
  const { facts } = input;
  const on = input.kind === 'management_set';
  const others = facts.others ?? [];
  const and = (n: readonly string[]) =>
    n.length > 1 ? `${n.slice(0, -1).join(', ')} and ${n.at(-1)}` : (n[0] ?? '');
  const team = on
    ? `Management now: ${and([...others, 'you'])}.`
    : others.length
      ? `Management now: ${and(others)}.`
      : 'Nobody is Management now.';
  const pre = on
    ? `${facts.actor} set you as Management · ${at}`
    : `${facts.actor} removed you from Management · ${at}`;
  return emailLayout(
    {
      subject: on ? 'You’re now Management in DxT Monitor' : 'You’re no longer Management in DxT Monitor',
      why: 'You got this because your Management tag in DxT Monitor changed.',
      footer,
      headers,
    },
    {
      color: C.secondary,
      bar: C.tertiary,
      label: on ? 'SET AS MANAGEMENT' : 'MANAGEMENT REMOVED',
      pre,
      headline: on ? 'You’re now Management' : 'You’re no longer Management',
      lede: `${pre}. Your role stays ${ROLE_LABELS[input.fromRole]}.`,
      facts: [
        ['Role', on ? `${ROLE_LABELS[input.fromRole]} · Management` : ROLE_LABELS[input.fromRole]],
        [on ? 'Set by' : 'Removed by', `${facts.actor} · ${at}`],
      ],
      buttons: [{ label: 'Open DxT Monitor', href: input.appUrl.replace(/\/$/, '') + '/', primary: true }],
      sections: [
        {
          kind: 'list',
          title: on ? 'WHAT COMES WITH MANAGEMENT' : 'WHAT CHANGES',
          mark: on ? '!' : '·',
          color: on ? C.warning : C.secondary,
          items: on
            ? // the dialog's words (§43.4); D-078 3a: the Admin steps of every policy, not only Tier 1 L1
              [
                'You get the L2 step on Tier 1 DOWN (+30 min, @mentioned in Chat + email) — step in: call the owner or backup, reassign, or acknowledge yourself.',
                'You’re no longer told as an Admin on escalation steps (any tier). Monitor-fault emails and system alerts still come to you.',
                team,
              ]
            : [
                'You no longer get the L2 step on Tier 1 DOWN.',
                'You’re told as an Admin on escalation steps again (Chat + email).',
                team,
              ],
        },
      ],
    },
  );
}

/**
 * The table's rows: sites grouped per new holder and role ("WeCare Studio, Cando Asia — owner · Arm"),
 * the clients as one Site AM row per new AM, each shift its own row.
 */
export function movedRows(moves: readonly AccountMove[]): [string, string][] {
  // One entry per row, in the moves' order: a site group sits where its first place was.
  const rows: { label: (places: string) => string; places: string[]; with: string; key: string | null }[] =
    [];
  for (const m of moves) {
    if (m.kind === 'shift') {
      const week = `${formatDay(new Date(m.starts), { weekday: true })} → ${formatDay(new Date(m.ends), { weekday: true })}`;
      rows.push({ label: () => `Your on-call shift ${week}`, places: [], with: m.with, key: null });
      continue;
    }
    const key = `${m.kind}:${m.with}`;
    const row = rows.find((r) => r.key === key);
    if (row) row.places.push(m.place);
    else
      rows.push({
        label: m.kind === 'am' ? (p) => `Site AM — ${p}` : (p) => `${p} — ${m.kind}`,
        places: [m.place],
        with: m.with,
        key,
      });
  }
  return rows.map((r) => [r.label(r.places.join(', ')), r.with]);
}

export function buildAccountEmail(input: AccountEmailInput): EmailMessage {
  const { facts, fromRole } = input;
  const at = when(input.at);
  const headers = { References: `<account-${input.eventId}@${senderDomain(input.from)}>` };
  const footer = accountFooter(facts.actor);
  // First: a Management event's facts are only { actor, others } — no moves (message-checker H1).
  if (input.kind === 'management_set' || input.kind === 'management_removed') {
    return managementEmail(input, at, headers, footer);
  }
  const rows = movedRows(facts.moves);
  // The table only when something moved; a note with no rows joins the lede instead (code review).
  const moved = (notes: string[]): EmailSection[] =>
    rows.length
      ? [{ kind: 'table', title: 'WHAT MOVED TO SOMEONE ELSE', head: ['Place', 'Now with'], rows, notes }]
      : [];

  if (input.kind === 'deactivated' || input.toRole === null) {
    // Nothing moved: the note joins the lede instead of standing under an empty table.
    const lede =
      'You can no longer sign in. Your past acknowledgements and notes stay in the audit log. Ask an Admin if this is a mistake.';
    return emailLayout(
      {
        subject: 'Your DxT Monitor access was removed',
        why: 'You got this because your DxT Monitor account was deactivated.',
        footer,
        headers,
      },
      {
        color: C.secondary,
        bar: C.tertiary,
        label: 'ACCESS REMOVED',
        pre: `${facts.actor} removed your access · ${at}`,
        headline: 'Your access was removed',
        lede: rows.length ? lede : `${lede} ${DEACTIVATED_NOTE}`,
        facts: [
          ['Was', `${ROLE_LABELS[fromRole]}${facts.was_am ? ' · Site AM' : ''}`],
          ['Removed by', `${facts.actor} · ${at}`],
        ],
        buttons: [],
        sections: moved([DEACTIVATED_NOTE]),
      },
    );
  }

  const to = input.toRole;
  const toLabel = ROLE_LABELS[to];
  const promoted = to === 'admin';
  const diff = roleDiff(fromRole, to, { managesClients: facts.manages_clients });
  const sections: EmailSection[] = [];
  if (promoted) {
    const others = facts.admins.length ? `${facts.admins.join(', ')} and you` : 'you';
    sections.push({
      kind: 'list',
      title: 'WHAT COMES WITH ADMIN',
      mark: '!',
      color: C.warning,
      items: [
        `You now get monitor-fault emails — when the browser verifier stops, fewer than 2 probe locations report, or one location is silent over 3 min. They reach ${others} from now on.`,
        'Responders’ maintenance requests (over 24 h or repeating) come to you to approve.',
      ],
    });
  }
  if (diff.now.length)
    sections.push({ kind: 'list', title: 'YOU CAN NOW', mark: '+', color: C.positive, items: diff.now });
  if (diff.noLonger.length)
    sections.push({
      kind: 'list',
      title: 'YOU CAN NO LONGER',
      mark: '–',
      color: C.secondary,
      items: diff.noLonger,
    });
  // The board's promotion lists what comes, not what stays.
  if (diff.keep && !promoted)
    sections.push({ kind: 'list', title: 'YOU KEEP', mark: '·', color: C.secondary, items: [diff.keep] });
  const rotationNote = facts.left_rotation ? ['You left the on-call rotation.'] : [];
  sections.push(...moved(rotationNote));
  // An Admin keeps what a Responder held (nothing moves); someone with no sites isn't told they stay.
  // The board's promotion lede, for a Responder: their sites and shifts stay.
  const first =
    promoted && fromRole === 'responder'
      ? 'Your sites and on-call shifts stay as they are.'
      : 'It took effect straight away.';
  const tail = !rows.length && rotationNote.length ? `${first} ${rotationNote[0]}` : first;

  const pre = promoted
    ? `${facts.actor} made you an Admin · ${at}`
    : `${facts.actor} changed your role from ${ROLE_LABELS[fromRole]} to ${toLabel} · ${at}`;
  return emailLayout(
    {
      subject: `Your DxT Monitor role is now ${toLabel}`,
      why: 'You got this because your role in DxT Monitor changed.',
      footer,
      headers,
    },
    {
      color: C.secondary,
      bar: C.tertiary,
      label: 'ROLE CHANGED',
      pre,
      headline: `You’re now ${article(to)} ${toLabel}`,
      lede: `${pre}. ${tail}`,
      facts: [
        ['Role', `${toLabel} (was ${ROLE_LABELS[fromRole]})`],
        ['Changed by', `${facts.actor} · ${at}`],
      ],
      buttons: [{ label: 'Open DxT Monitor', href: input.appUrl.replace(/\/$/, '') + '/', primary: true }],
      sections,
    },
  );
}
