import 'server-only';
import {
  buildOncallChat,
  buildOncallEmail,
  type ChatMessage,
  type EmailMessage,
  type OncallFacts,
  type OncallRole,
} from '@dxt/notifier';
import { contextOf, type Notification, type Recipient } from './facts';
import type { OncallEventFacts } from './oncall-facts';

/** The On-call page, opened on the swap for a swap's messages (§27.2) or the test link (§27.8). */
const oncallUrl = (appUrl: string, query = '') => `${appUrl.replace(/\/$/, '')}/oncall${query}`;

/** The builder's facts for an event, with the app's links. */
export function oncallFactsOf(e: OncallEventFacts, appUrl: string): OncallFacts {
  const { id: _id, ...swap } = e.swap ?? { id: '' };
  return {
    kind: e.kind,
    by: e.by,
    at: new Date(e.at),
    pageUrl: oncallUrl(appUrl, e.swap ? `?swap=${e.swap.id}` : ''),
    ...(e.swap ? { swap: swap as NonNullable<OncallFacts['swap']> } : {}),
    ...(e.handover ? { handover: e.handover } : {}),
    ...(e.rotation ? { rotation: e.rotation } : {}),
    ...(e.shift ? { shift: e.shift } : {}),
    ...(e.shiftHolder ? { shiftHolder: e.shiftHolder } : {}),
    ...(e.test
      ? { test: { name: e.test.name, url: oncallUrl(appUrl, e.test.token ? `?test=${e.test.token}` : '') } }
      : {}),
  };
}

/** Whoever the Chat line @mentions: `context.people` (SQL `oncall_recipients`). */
function mentionedIn(n: Notification, e: OncallEventFacts) {
  const people = contextOf(n.context).people;
  return (Array.isArray(people) ? people : []).flatMap((p) => {
    const id = p && typeof p === 'object' && !Array.isArray(p) ? p.id : null;
    const who = typeof id === 'string' ? e.people.get(id) : undefined;
    return who ? [{ name: who.name, chatUserId: who.chatUserId }] : [];
  });
}

export function renderOncallChat(n: Notification, e: OncallEventFacts, appUrl: string): ChatMessage | null {
  if (n.template !== 'oncall') return null;
  const f = oncallFactsOf(e, appUrl);
  if (f.kind.startsWith('swap_') && !f.swap) return null;
  if (
    (f.kind === 'handed_over' && !f.handover) ||
    (f.kind === 'shift_reminder' && !f.shift) ||
    (f.kind === 'test_alert' && !e.test?.token)
  )
    return null;
  return buildOncallChat(f, mentionedIn(n, e));
}

const ROLES: readonly OncallRole[] = [
  'asked',
  'requester',
  'admin',
  'new',
  'previous',
  'rotation',
  'removed',
  'self',
];

export function renderOncallEmail(
  n: Notification,
  e: OncallEventFacts,
  to: Recipient,
  appUrl: string,
  thread: { from: string; startsThread: boolean },
): EmailMessage | null {
  if (n.template !== 'oncall') return null;
  const role = contextOf(n.context).role;
  if (typeof role !== 'string' || !ROLES.includes(role as OncallRole)) return null;
  const f = oncallFactsOf(e, appUrl);
  if (f.kind.startsWith('swap_') && !f.swap) return null;
  return buildOncallEmail({
    facts: f,
    role: role as OncallRole,
    to: to.display_name,
    threadKey: n.thread_key ?? `oncall-${e.id}`,
    from: thread.from,
    startsThread: thread.startsThread,
  });
}
