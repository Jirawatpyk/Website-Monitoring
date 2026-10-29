'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

/** After the window: refresh at these delays, then every POLL_MS, to show "Posted …". */
const REFRESH_AFTER_MS = [2_000, 8_000];
const POLL_MS = 15_000;
/** Retries run up to ~10 min (30 s, 2 min, 8 min); stop polling after that. */
const POLL_FOR_MS = 11 * 60_000;
/** Past this the copy says it's still being tried rather than "now". */
const LATE_AFTER_MS = 30_000;

/** An ack or resolve with nothing queued (no alert ever went out, D-047): its line says so. */
export const NOTHING_TO_POST = 'Nothing to post — no alert went out for this incident.';

/** How long held messages have gone unposted: `late` after 30 s, `stale` once the retries are over. */
export type PostOverdue = 'no' | 'late' | 'stale';

/**
 * What the sending line says while it waits (§14.16 — never "now" for ever). It names only the
 * channels used (§16.8): a resolve after a drop that emailed nobody posts to Chat only (D-047).
 */
export function postWaitWords(overdue: PostOverdue, email = true): string {
  switch (overdue) {
    case 'no':
      return email ? 'Posting to the Chat thread and email now' : 'Posting to the Chat thread now';
    case 'late':
      return 'Still sending — retried automatically until it goes through';
    case 'stale':
      return `Not confirmed as posted — ${email ? 'Chat and email didn’t' : 'Chat didn’t'} answer. Tell the team in the Chat thread.`;
  }
}

/**
 * Once an ack's or a resolve's hold is over (`waiting`: due at `postsAt`, nothing posted yet), the
 * messages leave from the action's `after()` or the notifier's retries: refresh the page until it
 * shows "Posted …", and say when it's late. Shared by the ack panel and the resolve card / dialog.
 */
export function usePostWait(waiting: boolean, postsAt: string | null): PostOverdue {
  const router = useRouter();
  // The latest router, without restarting the timers when its object changes.
  const refresh = useRef(() => router.refresh());
  useEffect(() => {
    refresh.current = () => router.refresh();
  });
  const [overdue, setOverdue] = useState<PostOverdue>('no');
  useEffect(() => {
    if (!waiting || !postsAt) return;
    const since = Date.now() - new Date(postsAt).getTime();
    // A page opened after the retries are over says so at once, rather than "now" for ever.
    if (since > POLL_FOR_MS) {
      const staleTimer = setTimeout(() => setOverdue('stale'), 0);
      return () => clearTimeout(staleTimer);
    }
    const timers = REFRESH_AFTER_MS.map((ms) => setTimeout(() => refresh.current(), ms));
    const poll = setInterval(() => refresh.current(), POLL_MS);
    const lateTimer = setTimeout(() => setOverdue('late'), Math.max(0, LATE_AFTER_MS - since));
    const stop = setTimeout(() => {
      clearInterval(poll);
      setOverdue('stale');
    }, POLL_FOR_MS - since);
    return () => {
      timers.forEach(clearTimeout);
      clearInterval(poll);
      clearTimeout(lateTimer);
      clearTimeout(stop);
    };
  }, [waiting, postsAt]);
  return waiting ? overdue : 'no';
}
