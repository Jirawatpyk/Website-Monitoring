import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@jirawatpyk/aura-react';
import { IconInfo, IconRotateCcw } from '@jirawatpyk/aura-react/icons';
import { formatDay, formatTime } from '@dxt/shared';

/**
 * "Check now" (D-066 item 4): posts to the sin1 route, says "Checking…" in the meta line while it
 * runs, then refreshes the page. A refusal or a failure is said under the button (a polite live
 * region, which also says when the check finished).
 */
export function CheckNowButton({ onChecking }: { onChecking: (startedAt: string | null) => void }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // said to a screen reader once the table refreshed
  const [done, setDone] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  async function check() {
    const now = new Date();
    setBusy(true);
    setError(null);
    setDone(null);
    onChecking(`${formatDay(now, { weekday: true })} ${formatTime(now)}`);
    try {
      const res = await fetch('/api/expiry/check', { method: 'POST' });
      // an expired session is redirected to the sign-in page, which answers 200
      if (res.redirected) setError('Your session ended — sign in again, then check');
      else if (res.ok) setDone('Check finished — the table is up to date');
      else {
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
  // One child of the header's actions, so the button keeps the whole row below md and the error sits under it.
  return (
    <div className="flex w-full flex-col items-stretch gap-1 md:w-auto md:items-end">
      {button}
      {/* the board's line under the button: info icon, secondary text (§39.5) */}
      <span
        role="status"
        className={error ? 'flex items-center gap-1.5 text-xs text-fg-secondary' : 'sr-only'}
      >
        {error && <IconInfo size="sm" aria-hidden />}
        {error ?? done ?? ''}
      </span>
    </div>
  );
}
