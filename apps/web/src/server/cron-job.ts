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
): Promise<Response> {
  const region = process.env.VERCEL_REGION ?? 'local';
  try {
    const result = await work();
    console.info(JSON.stringify({ job, region, ...result }));
    await pingHealthcheck(pingUrl, result.ok ? 'ok' : 'fail');
    return Response.json({ job, region, ...result });
  } catch (err) {
    console.error(
      JSON.stringify({ job, region, ok: false, error: err instanceof Error ? err.message : String(err) }),
    );
    await pingHealthcheck(pingUrl, 'fail');
    return Response.json({ job, region, ok: false }, { status: 500 });
  }
}
