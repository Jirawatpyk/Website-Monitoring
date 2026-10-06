import { cronHandler } from '@/lib/auth/cron';
import { probeJob } from '@/server/probe/probe-job';

// Tokyo probe. The region is pinned in vercel.json (`functions` → regions: hnd1), not here.
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export const GET = cronHandler(() => probeJob('TYO'));
