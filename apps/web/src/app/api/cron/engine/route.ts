import { cronHandler } from '@/lib/auth/cron';
import { notImplemented } from '@/lib/auth/bearer';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export const GET = cronHandler(async () => {
  // TODO(FR-03): sweep every monitor — evaluateRound / confirmsDown from @dxt/engine,
  // update site_status, open/advance incidents, enqueue notifications (pgmq), ping Healthchecks.
  return notImplemented('engine');
});
