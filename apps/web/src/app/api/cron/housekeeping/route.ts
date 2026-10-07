import { cronHandler } from '@/lib/auth/cron';
import { runCronJob } from '@/server/cron-job';
import { serviceDb } from '@/server/db';
import { removeOldScreenshots } from '@/server/verifier/housekeeping';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Daily clean-up: verifier screenshots and their jobs older than 30 days (PRD §5, D-019).
export const GET = cronHandler(() =>
  runCronJob('housekeeping', undefined, () => removeOldScreenshots(serviceDb(), new Date())),
);
