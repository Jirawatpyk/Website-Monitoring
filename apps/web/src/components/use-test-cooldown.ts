'use client';

import { useEffect, useState } from 'react';

/** The SQL allows one test alert a minute (`send_oncall_test`, `send_channel_test`). */
export const TEST_COOLDOWN_MS = 60_000;

/**
 * A test button's minute (§14.16: it waits instead of failing). It starts from the last test the page
 * loaded with, so a reload inside the minute keeps it (S17 /verify), and from each new send.
 */
export function useTestCooldown(loadedAt: string | null) {
  const [sentAt, setSentAt] = useState(loadedAt);
  const [cooling, setCooling] = useState(
    () => !!loadedAt && Date.now() - Date.parse(loadedAt) < TEST_COOLDOWN_MS,
  );
  useEffect(() => {
    if (!cooling) return;
    const left = sentAt ? TEST_COOLDOWN_MS - (Date.now() - Date.parse(sentAt)) : 0;
    const t = setTimeout(() => setCooling(false), Math.max(left, 0));
    return () => clearTimeout(t);
  }, [cooling, sentAt]);
  const markSent = (at: string) => {
    setSentAt(at);
    setCooling(true);
  };
  return { sentAt, cooling, markSent };
}
