'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Button } from '@jirawatpyk/aura-react';
import { formatTime } from '@dxt/shared';

export const OFFLINE_RETRY_MS = 10_000;

/**
 * "Your connection dropped" (EmptyStates board, panel 6): the viewer's network, not the monitor.
 * Says what time the page's data is from, retries every 10 s, and refreshes when back online.
 */
export function OfflineStrip() {
  const router = useRouter();
  const [offlineSince, setOfflineSince] = useState<Date | null>(null);
  const [retrying, setRetrying] = useState(false);
  const retryingTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const retry = useCallback(() => {
    setRetrying(true);
    if (navigator.onLine) {
      setOfflineSince(null);
      router.refresh();
    }
    clearTimeout(retryingTimer.current);
    retryingTimer.current = setTimeout(() => setRetrying(false), 1_000);
  }, [router]);

  useEffect(() => {
    const goOffline = () => setOfflineSince((since) => since ?? new Date());
    const goOnline = () => {
      setOfflineSince(null);
      router.refresh();
    };
    if (!navigator.onLine) goOffline();
    window.addEventListener('offline', goOffline);
    window.addEventListener('online', goOnline);
    return () => {
      window.removeEventListener('offline', goOffline);
      window.removeEventListener('online', goOnline);
    };
  }, [router]);

  useEffect(() => () => clearTimeout(retryingTimer.current), []);

  useEffect(() => {
    if (!offlineSince) return;
    const timer = setInterval(retry, OFFLINE_RETRY_MS);
    return () => clearInterval(timer);
  }, [offlineSince, retry]);

  if (!offlineSince) return null;
  return (
    <Alert
      tone="warning"
      role="status"
      action={
        <Button size="sm" variant="secondary" touchHeight onClick={retry} loading={retrying}>
          {retrying ? 'Retrying…' : 'Retry'}
        </Button>
      }
    >
      <b>Offline</b> — showing what you had at {formatTime(offlineSince)}.{' '}
      {retrying ? 'Retrying now…' : 'Retrying every 10 s.'}
    </Alert>
  );
}
