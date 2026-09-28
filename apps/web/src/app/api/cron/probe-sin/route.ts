import { cronHandler } from '@/lib/auth/cron';
import { notImplemented } from '@/lib/auth/bearer';

// Singapore probe. The region is pinned in vercel.json (`functions` → regions: sin1), not here:
// Next's `preferredRegion` is deprecated and doesn't pin Node functions on Vercel.
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export const GET = cronHandler(async () => {
  // TODO(FR-02): refuse to record results unless process.env.VERCEL_REGION === 'sin1' (a failover run
  // elsewhere would report the wrong location); pick monitors due this minute by tier; runHttpCheck from
  // @dxt/probe; recheck failures within 30 s in this invocation; write check_results; trigger the engine.
  return notImplemented('probe-sin');
});
