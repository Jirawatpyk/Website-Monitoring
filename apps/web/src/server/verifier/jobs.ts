import 'server-only';
import type { DbClient } from '@dxt/db';
import { leaseQuerySchema, verdictSchema, type LeasedJob } from '@dxt/shared';
import type { z } from 'zod';

export type { LeasedJob };

/** Private bucket for verifier screenshots (migration verifier_and_admin_alerts, D-019). */
export const SCREENSHOT_BUCKET = 'verifier-screenshots';

/** The Job API's shapes live in @dxt/shared: the agent validates the same ones (CLAUDE.md rule). */
export const completeJobSchema = verdictSchema;
export type CompleteJobInput = z.infer<typeof verdictSchema>;
export { leaseQuerySchema };

/** `<yyyy-mm>/<job id>.jpg`, by the month the job was created: housekeeping lists only months old enough. */
export function screenshotPath(job: { id: string; created_at: string }): string {
  return `${job.created_at.slice(0, 7)}/${job.id}.jpg`;
}

/**
 * One poll of the verifier (GET /api/jobs): stamp its heartbeat — the engine counts it unavailable
 * after 2 min without one (D-019) — expire jobs that can no longer help, and lease up to `max` jobs
 * for 60 s, each with a signed upload URL for its screenshot.
 */
export async function leaseJobs(
  db: DbClient,
  { max, sessions }: z.infer<typeof leaseQuerySchema>,
  now: Date,
): Promise<LeasedJob[]> {
  const beat = await db
    .from('agent_heartbeats')
    // `free` = sessions it could fill now; 0 = busy, so queued jobs aren't "not picked up" (D-019).
    .upsert({ name: 'verifier', last_seen_at: now.toISOString(), info: { sessions, free: max } });
  if (beat.error) throw new Error(`agent_heartbeats: ${beat.error.message}`);
  const expired = await db.rpc('expire_verification_jobs');
  if (expired.error) throw new Error(`expire_verification_jobs: ${expired.error.message}`);
  if (max === 0) return [];

  const claimed = await db.rpc('claim_verification_jobs', { p_limit: max });
  if (claimed.error) throw new Error(`claim_verification_jobs: ${claimed.error.message}`);
  return Promise.all(
    (claimed.data ?? []).map(async (job): Promise<LeasedJob> => {
      const path = screenshotPath(job);
      const signed = await db.storage.from(SCREENSHOT_BUCKET).createSignedUploadUrl(path);
      if (signed.error) console.error(JSON.stringify({ event: 'screenshot_url_failed', job: job.id }));
      return {
        id: job.id,
        kind: job.kind === 'evidence' ? 'evidence' : 'verify',
        url: job.url,
        mustContain: job.must_contain,
        // Without an upload URL the job still runs: the verdict matters more than the picture.
        upload: signed.data ? { url: signed.data.signedUrl, path } : null,
      };
    }),
  );
}

/** The agent says it uploaded the screenshot: check the file is there before the timeline links it. */
async function uploaded(db: DbClient, path: string): Promise<boolean> {
  const { data, error } = await db.storage.from(SCREENSHOT_BUCKET).exists(path);
  return !error && data === true;
}

export type CompleteResult =
  | { ok: true; kind: 'verify' | 'evidence' }
  /** Unknown job, its lease ran out, or it was completed already (409). */
  | { ok: false };

/**
 * A job's result (POST /api/jobs), accepted only while its lease holds.
 */
export async function completeJob(db: DbClient, input: CompleteJobInput): Promise<CompleteResult> {
  const found = await db
    .from('verification_jobs')
    .select('id, created_at')
    .eq('id', input.jobId)
    .maybeSingle();
  if (found.error) throw new Error(`verification_jobs: ${found.error.message}`);
  if (!found.data) return { ok: false };

  const done = await db.rpc('complete_verification_job', {
    p_job_id: input.jobId,
    p_result: input.result,
    ...(input.detail ? { p_detail: input.detail } : {}),
    ...(input.httpStatus ? { p_http_status: input.httpStatus } : {}),
    ...(input.screenshot && (await uploaded(db, screenshotPath(found.data)))
      ? { p_screenshot_path: screenshotPath(found.data) }
      : {}),
  });
  if (done.error) throw new Error(`complete_verification_job: ${done.error.message}`);
  const job = done.data?.[0];
  if (!job) return { ok: false };

  // The engine clears "verifier unavailable" once it works again (no sooner than 10 min after it
  // opened, D-019); clearing on every verdict would let a verifier that keeps failing jobs email
  // the Admins again and again.
  return { ok: true, kind: job.kind === 'evidence' ? 'evidence' : 'verify' };
}
