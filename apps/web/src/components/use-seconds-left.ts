'use client';

import { useEffect, useState } from 'react';
import { UNDO_WINDOW_SEC } from '@dxt/shared';

/**
 * Whole seconds left until `iso` — the 10 s Undo window (spec §16.8) on the incident page and the
 * Overview. The clock starts on the client (null on the server and in the first render, so hydration
 * matches: the full window shows until the first tick, right after).
 */
export function useSecondsLeft(iso: string | null): number {
  const [now, setNow] = useState<number | null>(null);
  const target = iso ? new Date(iso).getTime() : 0;
  useEffect(() => {
    if (!iso) return;
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const timer = setInterval(tick, 1000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [iso]);
  if (!iso) return 0;
  if (now === null) return UNDO_WINDOW_SEC;
  return Math.max(0, Math.ceil((target - now) / 1000));
}
