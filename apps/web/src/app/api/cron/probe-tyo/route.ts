import { cronHandler } from '@/lib/auth/cron';
import { notImplemented } from '@/lib/auth/bearer';

// Tokyo probe. The region is pinned in vercel.json (`functions` → regions: hnd1), not here.
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export const GET = cronHandler(async () => {
  // TODO(FR-02): same as probe-sin; require process.env.VERCEL_REGION === 'hnd1', location TYO.
  return notImplemented('probe-tyo');
});
