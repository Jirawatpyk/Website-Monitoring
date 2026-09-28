import { cronHandler } from '@/lib/auth/cron';
import { notImplemented } from '@/lib/auth/bearer';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export const GET = cronHandler(async () => {
  // TODO(FR-07): read due notifications (hold_until passed — 10 s undo), send Google Chat (threadKey =
  // incident id) and Resend email, retry 30 s / 2 min / 8 min, then fall back to email.
  return notImplemented('notifier');
});
