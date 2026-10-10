'use client';

import { useEffect, useState } from 'react';

/**
 * "Now" for the Preview and MEscalation's example (code review): starts at the server's render time
 * (same markup on hydration) and moves on every minute, so a page left open stays right across 18:00.
 */
export function useNow(initialIso: string): Date {
  const [now, setNow] = useState(() => new Date(initialIso));
  useEffect(() => {
    const tick = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(tick);
  }, []);
  return now;
}
