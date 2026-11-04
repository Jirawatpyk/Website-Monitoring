import 'server-only';
import { pingHealthcheck } from './healthchecks';

export interface CronJobResult {
  /** false = the job couldn't do its work (e.g. ran in the wrong region): Healthchecks gets `/fail`. */
  ok: boolean;
  [key: string]: unknown;
}

/**
 * Runs one cron job: logs a one-line JSON summary with the Vercel region (S02a Done-when 4),
 * pings Healthchecks with the outcome and answers with the summary. An exception becomes a 500
 * and a `/fail` ping; its message is logged, never returned.
 */
export async function runCronJob(
  job: string,
  pingUrl: string | undefined,
  work: () => Promise<CronJobResult>,
  /** S12a (D-053): the in-app beat, stamped whenever the job ran to the end (a thrown job stamps nothing). */
  beat?: () => Promise<void>,
): Promise<Response> {
  const region = process.env.VERCEL_REGION ?? 'local';
  try {
    const result = await work();
    console.info(JSON.stringify({ job, region, ...result }));
    // The beat says the job ran (D-053: a sweep that judged 16 sites and failed one write still
    // swept); `ok` is the Healthchecks ping's business only (engine review S12a, High).
    await Promise.all([pingHealthcheck(pingUrl, result.ok ? 'ok' : 'fail'), beat?.()]);
    return Response.json({ job, region, ...result });
  } catch (err) {
    console.error(
      JSON.stringify({ job, region, ok: false, error: err instanceof Error ? err.message : String(err) }),
    );
    await pingHealthcheck(pingUrl, 'fail');
    return Response.json({ job, region, ok: false }, { status: 500 });
  }
}
