'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

/** Events inside this window become one refresh (D-032): a round updates every site at once. */
export const COALESCE_MS = 1500;
/** Tables the Overview follows (the migration publishes exactly these). */
export const LIVE_TABLES = ['site_status', 'incidents'] as const;

/**
 * Realtime for `/` (PRD §9: a status change on screen < 5 s): changes to `site_status` and `incidents`
 * re-render the page from the server. A burst (a round touches every site) becomes one refresh at most
 * every `COALESCE_MS`; a reconnect or coming back to the tab refreshes once, since events missed meanwhile
 * aren't replayed. INSERT and UPDATE only — a DELETE skips RLS and the page needs none (security review).
 * Returns whether the channel is live, for the header's "· live".
 */
export function useLiveRefresh(): boolean {
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
    let channel = supabase.channel(`overview-${crypto.randomUUID()}`);
    for (const table of LIVE_TABLES) {
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
  }, [router]);

  return live;
}
