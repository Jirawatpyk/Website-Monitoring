'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

/** Events inside this window become one refresh (D-032): a round updates every site at once. */
export const COALESCE_MS = 1500;
/** Tables in the Realtime publication (S06b's two, and maintenance_windows since S09b). */
export const LIVE_TABLES = ['site_status', 'incidents', 'maintenance_windows'] as const;
export type LiveTable = (typeof LIVE_TABLES)[number];

/**
 * Realtime for a page (PRD §9: a status change on screen < 5 s): changes to the given tables — the
 * Overview follows `site_status` and `incidents`, the Incidents pages `incidents` (S07) — re-render it
 * from the server. A burst (a round touches every site) becomes one refresh at most
 * every `COALESCE_MS`; a reconnect or coming back to the tab refreshes once, since events missed meanwhile
 * aren't replayed. INSERT and UPDATE only — a DELETE skips RLS and the page needs none (security review).
 * Returns whether the channel is live, for the header's "· live".
 */
export function useLiveRefresh(tables: readonly LiveTable[] = LIVE_TABLES): boolean {
  const router = useRouter();
  const [live, setLive] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const supabase = createClient();
    const refresh = () => {
      if (timer.current) return;
      timer.current = setTimeout(() => {
        timer.current = null;
        router.refresh();
      }, COALESCE_MS);
    };
    // a topic per mount: React's dev double mount would otherwise get the channel still being removed
    let channel = supabase.channel(`live-${crypto.randomUUID()}`);
    for (const table of tables) {
      for (const event of ['INSERT', 'UPDATE'] as const) {
        channel = channel.on('postgres_changes', { event, schema: 'public', table }, refresh);
      }
    }
    let joined = false;
    channel.subscribe((status) => {
      const ok = status === 'SUBSCRIBED';
      setLive(ok);
      // a rejoin after a drop: catch up on what was missed
      if (ok && joined) refresh();
      if (ok) joined = true;
    });
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      void supabase.removeChannel(channel);
    };
    // the table list is a constant per page; joined so a new array each render doesn't resubscribe
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the joined names below
  }, [router, tables.join(',')]);

  return live;
}
