import { cronHandler } from '@/lib/auth/cron';
import { probeJob } from '@/server/probe/probe-job';

// Singapore probe. The region is pinned in vercel.json (`functions` → regions: sin1), not here:
// Next's `preferredRegion` is deprecated and doesn't pin Node functions on Vercel. runProbe refuses
// to record results if a failover ever runs it elsewhere.
export const dynamic = 'force-dynamic';
export const maxDuration = 90;

export const GET = cronHandler(() => probeJob('SIN'));
