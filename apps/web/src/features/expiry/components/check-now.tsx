import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Tooltip } from '@jirawatpyk/aura-react';
import { IconRotateCcw } from '@jirawatpyk/aura-react/icons';
import { formatDay, formatTime } from '@dxt/shared';

/**
 * "Check now" (D-066 item 4): posts to the sin1 route, says "Checking…" in the meta line while it
 * runs, then refreshes the page. A refusal or a failure is said under the button's tooltip and in
 * a polite live region.
 */
export function CheckNowButton({ onChecking }: { onChecking: (startedAt: string | null) => void }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  async function check() {
    const now = new Date();
    setBusy(true);
    setError(null);
    onChecking(`${formatDay(now, { weekday: true })} ${formatTime(now)}`);
    try {
      const res = await fetch('/api/expiry/check', { method: 'POST' });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string; failed?: string[] } | null;
        setError(
          body?.error ??
            (body?.failed?.length
              ? `Couldn't read ${body.failed.join(', ')}`
              : "The check didn't finish — try again"),
        );
      }
    } catch {
      setError("The check didn't reach the server — try again");
    } finally {
      setBusy(false);
      onChecking(null);
      startTransition(() => router.refresh());
    }
  }

  const button = (
    <Button variant="secondary" icon={<IconRotateCcw />} loading={busy} disabled={busy} onClick={check}>
      {busy ? 'Checking…' : 'Check now'}
    </Button>
  );
  return (
    <>
      {error ? (
        <Tooltip content={error} side="bottom">
          {button}
        </Tooltip>
      ) : (
        button
      )}
      <span role="status" className={error ? 'text-sm text-alert-warning-fg' : 'sr-only'}>
        {error ?? ''}
      </span>
    </>
  );
}
