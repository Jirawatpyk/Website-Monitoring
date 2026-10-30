import { formatDay, formatTime } from '@dxt/shared';
import { plainName, type ChatMessage, type ChatPerson } from './chat-alerts';
import { buildChatTextLine, type ChatState } from './chat-text';
import { EMAIL_COLORS, emailLayout, senderDomain, type EmailMessage, type Envelope } from './email-alerts';

/**
 * On-call messages (S10, D-048 items 6 and 11; spec §10, §27, §28). Every on-call event posts one Chat
 * line in its subject's Alerts Space thread, @mentioning whoever it tells, and emails each of them —
 * not for a rotation change or a test alert (Chat only). No board draws these except the test alert
 * (ChatAlert "Test alert · own thread"); the texts are Claude's, reviewed by message-checker.
 * The Space is the whole team's, so a swap's or hand-over's reason goes only in the people's emails.
 */

export type OncallKind =
  | 'rotation_changed'
  | 'swap_requested'
  | 'swap_accepted'
  | 'swap_declined'
  | 'swap_approved'
  | 'swap_admin_declined'
  | 'swap_withdrawn'
  | 'swap_expired'
  | 'handed_over'
  | 'test_alert'
  | 'shift_reminder';

/** How the recipient is tied to the event (`notifications.context.role`, SQL `oncall_recipients`). */
export type OncallRole =
  'asked' | 'requester' | 'admin' | 'new' | 'previous' | 'rotation' | 'removed' | 'self';

export interface Week {
  start: Date;
  end: Date;
}

export interface OncallFacts {
  kind: OncallKind;
  /** Who did it: the Admin who decided, the person who handed over, … (null for the engine). */
  by: string | null;
  at: Date;
  /** The On-call page, with `?swap=<id>` for a swap's messages. */
  pageUrl: string;
  /** A swap: Arm (requester) asks Nok (asked) to trade weeks. */
  swap?: {
    requester: string;
    asked: string;
    /** The requester's week, which the person asked would take. */
    requesterWeek: Week;
    askedWeek: Week;
    /** The requester's reason, the person asked's answer, the Admin's note: emails only. */
    reason: string | null;
    note: string | null;
  };
  /** A hand-over: `to` covers `from` from `at` until `until`. */
  handover?: { from: string; to: string; at: Date; until: Date; reason: string | null };
  /** A rotation change: the order, each person's next week; who was taken out. */
  rotation?: { order: { name: string; next: Week | null }[]; removed: string[] };
  /** The day-before reminder: the shift. */
  shift?: Week;
  /** The test alert: the tester and the link that ticks "Test alert received on this phone". */
  test?: { name: string; url: string };
}

/** "Mon 5 → 12 Oct", or "Mon 28 Sep → 5 Oct" across a month. */
export function formatWeek(w: Week): string {
  const a = formatDay(w.start, { weekday: true }).split(' ');
  const b = formatDay(w.end).split(' ');
  return a[2] === b[1] ? `${a[0]} ${a[1]} → ${b[0]} ${b[1]}` : `${a.join(' ')} → ${b.join(' ')}`;
}

const when = (d: Date) => `${formatDay(d, { weekday: true })} ${formatTime(d)}`;

const STATE: Record<OncallKind, ChatState> = {
  rotation_changed: 'ROTATION CHANGED',
  swap_requested: 'SWAP REQUEST',
  swap_accepted: 'SWAP ACCEPTED',
  swap_declined: 'SWAP DECLINED',
  swap_approved: 'SWAP APPROVED',
  swap_admin_declined: 'SWAP NOT APPROVED',
  swap_withdrawn: 'SWAP WITHDRAWN',
  swap_expired: 'SWAP EXPIRED',
  handed_over: 'SHIFT HANDED OVER',
  test_alert: 'TEST — no action',
  shift_reminder: 'ON CALL TOMORROW',
};

/** The words after "STATE · On-call ·" on the Chat line: who and which weeks, never a reason. */
function chatDetail(f: OncallFacts): string[] {
  const s = f.swap;
  const by = f.by ? plainName(f.by) : null;
  switch (f.kind) {
    case 'swap_requested':
      return [
        `${plainName(s!.requester)} asks ${plainName(s!.asked)} to swap weeks`,
        `${plainName(s!.asked)} would take ${formatWeek(s!.requesterWeek)}`,
        `${plainName(s!.requester)} would take ${formatWeek(s!.askedWeek)}`,
        'accept or decline on On-call',
      ];
    case 'swap_accepted':
      return [
        `${plainName(s!.asked)} accepted ${plainName(s!.requester)}’s swap`,
        'waiting for an Admin to approve',
      ];
    case 'swap_declined':
      return [
        `${plainName(s!.asked)} declined ${plainName(s!.requester)}’s swap`,
        `${plainName(s!.requester)} keeps ${formatWeek(s!.requesterWeek)}`,
      ];
    case 'swap_withdrawn':
      return [
        `${plainName(s!.requester)} withdrew the swap request`,
        `${plainName(s!.asked)} keeps ${formatWeek(s!.askedWeek)}`,
      ];
    case 'swap_approved':
      return [
        ...(by ? [`approved by ${by}`] : []),
        `${plainName(s!.asked)} takes ${formatWeek(s!.requesterWeek)}`,
        `${plainName(s!.requester)} takes ${formatWeek(s!.askedWeek)}`,
      ];
    case 'swap_admin_declined':
      return [...(by ? [`declined by ${by}`] : []), 'nothing changes in the rotation'];
    case 'swap_expired':
      // The week that started first is the one that made it expire (spec §28.5).
      return [
        `${plainName(s!.requesterWeek.start <= s!.askedWeek.start ? s!.requester : s!.asked)}’s week started before it was approved`,
        'nothing changes',
      ];
    case 'handed_over': {
      const h = f.handover!;
      return [`${plainName(h.to)} covers ${plainName(h.from)} from ${when(h.at)} until ${when(h.until)}`];
    }
    case 'rotation_changed': {
      const r = f.rotation!;
      const next = r.order
        .filter((p) => p.next)
        .map((p) => `${plainName(p.name)} from ${formatDay(p.next!.start, { weekday: true })}`);
      return [
        ...(by ? [`by ${by}`] : []),
        ...(next.length ? [`next weeks: ${next.join(', ')}`] : []),
        ...(r.removed.length ? [`${r.removed.map(plainName).join(' and ')} no longer in the rotation`] : []),
      ];
    }
    case 'shift_reminder':
      return [
        `your shift ${when(f.shift!.start)} → ${when(f.shift!.end)}`,
        'Tier 1 alerts at night and on the weekend come to you',
      ];
    case 'test_alert':
      return [];
  }
}

/** The Chat line, and for a test alert its card with the link (ChatAlert "Test alert · own thread"). */
export function buildOncallChat(f: OncallFacts, mention: readonly ChatPerson[]): ChatMessage {
  const ids = [...new Set(mention.flatMap((p) => (p.chatUserId ? [p.chatUserId] : [])))];
  if (f.kind === 'test_alert') {
    const name = plainName(f.test!.name);
    return {
      // ChatAlert, word for word: "<users/PLOY> TEST — no action · alert test for Ploy’s phone".
      text: buildChatTextLine({
        state: 'TEST — no action',
        site: `alert test for ${name}’s phone`,
        mention: ids,
      }),
      cardsV2: [
        {
          cardId: 'oncall-test',
          card: {
            header: { title: 'TEST — no action', subtitle: `Alert test for ${name}’s phone` },
            sections: [
              {
                widgets: [
                  {
                    textParagraph: {
                      text: 'Open the link on the phone you want to check. It ticks “Test alert received on this phone”.',
                    },
                  },
                  {
                    buttonList: {
                      buttons: [
                        { text: 'Open test link on this phone', onClick: { openLink: { url: f.test!.url } } },
                      ],
                    },
                  },
                ],
              },
            ],
          },
        },
      ],
    };
  }
  return {
    text: buildChatTextLine({ state: STATE[f.kind], site: 'On-call', mention: ids, detail: chatDetail(f) }),
    cardsV2: [
      {
        cardId: `oncall-${f.kind}`,
        card: {
          header: { title: `${STATE[f.kind]} · On-call` },
          sections: [
            {
              widgets: [
                {
                  buttonList: {
                    buttons: [{ text: 'Open On-call', onClick: { openLink: { url: f.pageUrl } } }],
                  },
                },
              ],
            },
          ],
        },
      },
    ],
  };
}

export const ONCALL_EMAIL_FOOTER =
  'Times in Thailand time (UTC+7). This is an automated record — replies aren’t read. The rotation and every swap are on the On-call page.';

/** One mail thread per subject (a swap, a hand-over, a shift's reminder), as its Chat thread. */
export function oncallThreadId(threadKey: string, from: string): string {
  return `<${threadKey}@${senderDomain(from)}>`;
}

export interface OncallEmailInput {
  facts: OncallFacts;
  role: OncallRole;
  /** The recipient's name, for "you" vs the other person. */
  to: string;
  threadKey: string;
  from: string;
  startsThread: boolean;
}

const C = EMAIL_COLORS;

/** The email to one person the event tells; null for Chat-only events. */
export function buildOncallEmail(input: OncallEmailInput): EmailMessage | null {
  const { facts: f, role } = input;
  if (f.kind === 'rotation_changed' || f.kind === 'test_alert') return null;
  const s = f.swap;
  const threadId = oncallThreadId(input.threadKey, input.from);
  const open = {
    label: f.kind === 'swap_requested' && role === 'asked' ? 'Accept or decline' : 'Open On-call',
    href: f.pageUrl,
    primary: true,
  };
  const reasonRow = (label: string, v: string | null | undefined): [string, string][] =>
    v ? [[label, `“${v}”`]] : [];
  const weeks = (): [string, string][] =>
    s
      ? [
          [`${plainName(s.asked)} takes`, formatWeek(s.requesterWeek)],
          [`${plainName(s.requester)} takes`, formatWeek(s.askedWeek)],
        ]
      : [];

  let label = STATE[f.kind];
  let headline = '';
  let lede = '';
  let facts: [string, string][] = [];
  let why = '';
  switch (f.kind) {
    case 'swap_requested':
      headline = `${plainName(s!.requester)} asks you to swap weeks`;
      lede = `You would take ${formatWeek(s!.requesterWeek)} and ${plainName(s!.requester)} would take ${formatWeek(s!.askedWeek)}. Accepting sends it to an Admin to approve. Nothing changes in the rotation until then.`;
      facts = [
        ['You would take', formatWeek(s!.requesterWeek)],
        [`${plainName(s!.requester)} would take`, formatWeek(s!.askedWeek)],
        ...reasonRow('Reason', s!.reason),
      ];
      why = `You got this because ${plainName(s!.requester)} asked you to swap on-call weeks.`;
      break;
    case 'swap_accepted':
      headline =
        role === 'admin'
          ? `${plainName(s!.asked)} accepted ${plainName(s!.requester)}’s swap — approve it?`
          : `${plainName(s!.asked)} accepted your swap`;
      lede =
        role === 'admin'
          ? 'It needs an Admin to approve. Approve swaps the two weeks; both get a Chat message and an email.'
          : 'It now waits for an Admin to approve. Nothing changes in the rotation until then.';
      facts = [...weeks(), ...(role === 'admin' ? reasonRow('Reason', s!.reason) : [])];
      why =
        role === 'admin'
          ? 'You got this because you’re an Admin — a swap needs an Admin to approve.'
          : 'You got this because you asked to swap on-call weeks.';
      break;
    case 'swap_declined':
      headline = `${plainName(s!.asked)} declined your swap`;
      lede = `You keep ${formatWeek(s!.requesterWeek)}.`;
      facts = [
        ['You keep', formatWeek(s!.requesterWeek)],
        ...reasonRow(`${plainName(s!.asked)} said`, s!.note),
      ];
      why = 'You got this because you asked to swap on-call weeks.';
      break;
    case 'swap_withdrawn':
      headline = `${plainName(s!.requester)} withdrew the swap request`;
      lede = `Nothing changes — you keep ${formatWeek(s!.askedWeek)}.`;
      facts = [['You keep', formatWeek(s!.askedWeek)]];
      why = `You got this because ${plainName(s!.requester)} had asked you to swap on-call weeks.`;
      break;
    case 'swap_approved': {
      const mine = role === 'asked' ? s!.requesterWeek : s!.askedWeek;
      headline = 'The weeks have swapped';
      lede = `You’re on call ${formatWeek(mine)}.${f.by ? ` Approved by ${plainName(f.by)} · ${when(f.at)}.` : ''}`;
      facts = weeks();
      why = 'You got this because your on-call week changed.';
      break;
    }
    case 'swap_admin_declined':
      headline = 'The swap wasn’t approved';
      lede = `Nothing changes: ${plainName(s!.requester)} keeps ${formatWeek(s!.requesterWeek)} and ${plainName(s!.asked)} keeps ${formatWeek(s!.askedWeek)}.`;
      facts = [
        ...(f.by ? [['Declined by', plainName(f.by)] as [string, string]] : []),
        ...reasonRow('Reason', s!.note),
      ];
      why = 'You got this because you were part of this swap request.';
      break;
    case 'swap_expired':
      headline = 'The swap request expired';
      lede = `One of the weeks started before an Admin approved it, so nothing changes: ${plainName(s!.requester)} keeps ${formatWeek(s!.requesterWeek)} and ${plainName(s!.asked)} keeps ${formatWeek(s!.askedWeek)}.`;
      facts = weeks();
      why = 'You got this because you were part of this swap request.';
      break;
    case 'handed_over': {
      const h = f.handover!;
      headline =
        role === 'new'
          ? `You’re covering ${plainName(h.from)}’s on-call shift`
          : `Your on-call shift was handed to ${plainName(h.to)}`;
      lede =
        role === 'new'
          ? `From ${when(h.at)} until ${when(h.until)}, Tier 1 alerts at night and on the weekend @mention you instead of ${plainName(h.from)}.`
          : `From ${when(h.at)} until ${when(h.until)}, ${plainName(h.to)} gets Tier 1 alerts at night and on the weekend. Your later weeks don’t change.`;
      facts = [
        ['From', when(h.at)],
        ['Until', when(h.until)],
        ...(f.by ? [['By', plainName(f.by)] as [string, string]] : []),
        ...reasonRow('Reason', h.reason),
      ];
      why = 'You got this because an on-call shift you hold changed hands.';
      break;
    }
    case 'shift_reminder':
      label = 'ON CALL TOMORROW';
      headline = 'Your on-call shift starts tomorrow';
      lede = `From ${when(f.shift!.start)} to ${when(f.shift!.end)}, Tier 1 alerts at night and on the weekend come to you. Check your phone is ready: Alerts Space notifies for @mentions, it’s allowed through Do Not Disturb, and a test alert reaches it.`;
      facts = [['Shift', `${when(f.shift!.start)} → ${when(f.shift!.end)}`]];
      why = 'You got this because you’re on call next.';
      break;
  }
  const envelope: Envelope = {
    subject: `DxT Monitor · On-call · ${headline}`,
    why,
    footer: ONCALL_EMAIL_FOOTER,
    headers: input.startsThread
      ? { References: threadId }
      : { 'In-Reply-To': threadId, References: threadId },
  };
  return emailLayout(envelope, {
    color: C.primary,
    bar: C.primary,
    label,
    pre: headline,
    headline,
    lede,
    facts,
    buttons: [open],
  });
}
