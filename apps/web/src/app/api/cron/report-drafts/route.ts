import { renderReportPdf, runReportDrafts } from '@/features/reports/server';
import { cronHandler } from '@/lib/auth/cron';
import { serverEnv } from '@/lib/env';
import { runCronJob } from '@/server/cron-job';
import { serviceDb } from '@/server/db';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// Hourly at :05 (vercel.json): the last complete month's client report drafts (S20, D-073 item 13).
// The first run from 06:00 Bangkok on the 1st (06:05) makes them; later runs refresh a draft whose figures
// changed (a root cause added, a false alarm marked).
export const GET = cronHandler(() =>
  runCronJob('report-drafts', serverEnv().HEALTHCHECKS_PING_URL_REPORT_DRAFTS, () =>
    runReportDrafts(serviceDb(), new Date(), renderReportPdf),
  ),
);
