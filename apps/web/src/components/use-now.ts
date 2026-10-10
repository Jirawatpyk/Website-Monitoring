'use client';

import { useEffect, useState } from 'react';

/**
 * "Now" for words that age — "18 min unacked", a running duration — starting from the server's time
 * and moving every `everyMs` on the client while `ticking`, so a page left open stays right without
 * asking the server again (S07 spec-check: the Incidents list froze at load).
 */
export function useNow(startIso: string, everyMs: number, ticking = true): Date {
  const [state, setState] = useState(() => ({ from: startIso, now: new Date(startIso) }));
  // A refresh brings a newer server time: start from it (set while rendering, React's pattern for
  // state that follows a prop).
  if (state.from !== startIso) setState({ from: startIso, now: new Date(startIso) });
  useEffect(() => {
    if (!ticking) return;
    const timer = setInterval(() => setState((s) => ({ ...s, now: new Date() })), everyMs);
    return () => clearInterval(timer);
  }, [everyMs, ticking]);
  return state.from === startIso ? state.now : new Date(startIso);
}
