import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@jirawatpyk/aura-react';
import { IconInfo, IconRotateCcw } from '@jirawatpyk/aura-react/icons';
import { formatDay, formatTime } from '@dxt/shared';

type Result = { ok: true } | { ok: false; error: string };

/**
 * "Check now" (D-066 item 4): posts to the sin1 route and says "Checking…" in the meta line until the
 * refreshed page has landed (the fetch, then the refresh's transition), then says how it ended. A
 * refusal or a failure is one line under the button (§39.5). All of it is one polite live region.
 */
export function CheckNowButton({ onChecking }: { onChecking: (startedAt: string | null) => void }) {
  const router = useRouter();
  const [fetching, setFetching] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [refreshing, startTransition] = useTransition();
  const busy = fetching || refreshing;

  // the meta line's "Checking…" ends with the refresh, not with the fetch
  useEffect(() => {
    if (!busy) onChecking(null);
  }, [busy, onChecking]);

  async function check() {
    if (busy) return;
    const now = new Date();
    setFetching(true);
    setResult(null);
    onChecking(`${formatDay(now, { weekday: true })} ${formatTime(now)}`);
    let next: Result;
    try {
      const res = await fetch('/api/expiry/check', { method: 'POST' });
      if (res.redirected) {
        // an expired session is redirected to the sign-in page, which answers 200
        next = { ok: false, error: 'Your session ended — sign in again, then check' };
      } else if (res.ok) {
        next = { ok: true };
      } else {
        const body = (await res.json().catch(() => null)) as { error?: string; failed?: string[] } | null;
        next = {
          ok: false,
          error:
            body?.error ??
            (body?.failed?.length
              ? `Couldn't read ${body.failed.join(', ')}`
              : "The check didn't finish — try again"),
        };
      }
    } catch {
      next = { ok: false, error: "The check didn't reach the server — try again" };
    }
    setResult(next);
    setFetching(false);
    startTransition(() => router.refresh());
  }

  const error = result && !result.ok ? result.error : null;
  const said = busy
    ? 'Checking certificates and domains now'
    : (error ?? (result ? 'Check finished — the table is up to date' : ''));
  // One child of the header's actions: full width below lg (MExpiry, Expiry820), the line under it.
  // No `disabled` while busy, so the focused button keeps focus; a second press is ignored.
  return (
    <div className="flex w-full flex-col items-stretch gap-1 lg:w-auto lg:items-end">
      <Button variant="secondary" icon={<IconRotateCcw />} loading={busy} touchHeight onClick={check}>
        {busy ? 'Checking…' : 'Check now'}
      </Button>
      <span
        role="status"
        className={
          error && !busy
            ? 'flex items-center gap-1.5 text-xs text-fg-secondary max-lg:justify-center'
            : 'sr-only'
        }
      >
        {error && !busy && <IconInfo size="sm" aria-hidden />}
        {said}
      </span>
    </div>
  );
}
