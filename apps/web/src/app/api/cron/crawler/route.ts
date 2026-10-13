import { cronHandler } from '@/lib/auth/cron';
import { crawlerJob } from '@/server/crawler/crawler-job';

// The 30-min crawler (D-041), pinned to sin1 in vercel.json `functions`; runCrawler refuses to run
// anywhere else.
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export const GET = cronHandler(() => crawlerJob());
