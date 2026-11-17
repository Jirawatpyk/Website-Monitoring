import { cronHandler } from '@/lib/auth/cron';
import { expiryJob } from '@/server/expiry/expiry-job';

// S13 (D-066): the hourly SSL / domain expiry read, pinned to sin1 in vercel.json `functions`;
// runExpiry refuses to run anywhere else. The 06:00 Bangkok run reads every live site.
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export const GET = cronHandler(() => expiryJob());
