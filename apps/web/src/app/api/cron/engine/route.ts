import { cronHandler } from '@/lib/auth/cron';
import { serverEnv } from '@/lib/env';
import { runCronJob } from '@/server/cron-job';
import { serviceDb } from '@/server/db';
import { runEngine } from '@/server/engine/run-engine';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Status engine sweep (PRD §10): judge the latest rounds, open / recover incidents, queue messages.
export const GET = cronHandler(() =>
  runCronJob('engine', serverEnv().HEALTHCHECKS_PING_URL_ENGINE, () => runEngine(serviceDb())),
);
