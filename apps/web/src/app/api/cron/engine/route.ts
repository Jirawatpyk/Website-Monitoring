import { cronHandler } from '@/lib/auth/cron';
import { serverEnv } from '@/lib/env';
import { runCronJob } from '@/server/cron-job';
import { serviceDb } from '@/server/db';
import { engineAndDeliver } from '@/server/engine/engine-and-deliver';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Status engine sweep (PRD §10): judge the rounds, open / recover incidents, queue messages and send
// them inside this run. A failing recheck already ran the engine from the probe (alert within 30 s
// of the confirm, PRD §9); this sweep catches deadline-judged rounds and recoveries.
export const GET = cronHandler(() => {
  const env = serverEnv();
  const started = Date.now();
  return runCronJob('engine', env.HEALTHCHECKS_PING_URL_ENGINE, () =>
    engineAndDeliver(serviceDb(), env, started + 50_000),
  );
});
