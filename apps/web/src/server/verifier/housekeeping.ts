import 'server-only';
import type { DbClient } from '@dxt/db';
import type { CronJobResult } from '../cron-job';
import { SCREENSHOT_BUCKET } from './jobs';

/** Screenshots and their jobs are kept 30 days (PRD §5). */
export const KEEP_DAYS = 30;
const LIST_PAGE = 1000;
const REMOVE_CHUNK = 100;

/**
 * The daily clean-up (D-019): screenshots older than 30 days go through the Storage API — deleting
 * rows of `storage.objects` in SQL would leave the files behind — and so do their job rows. Only
 * month folders that can hold an old file are listed (`<yyyy-mm>/<job>.jpg`).
 */
export async function removeOldScreenshots(db: DbClient, now: Date): Promise<CronJobResult> {
  const cutoff = new Date(now.getTime() - KEEP_DAYS * 86_400_000);
  const bucket = db.storage.from(SCREENSHOT_BUCKET);

  const top = await bucket.list('', { limit: LIST_PAGE });
  if (top.error) throw new Error(`storage list: ${top.error.message}`);
  // A month folder holds old files when the month started before the cutoff.
  const months = (top.data ?? [])
    .map((entry) => entry.name)
    .filter((name) => /^\d{4}-\d{2}$/.test(name) && `${name}-01` <= cutoff.toISOString().slice(0, 10));

  const old: string[] = [];
  for (const month of months) {
    for (let offset = 0; ; offset += LIST_PAGE) {
      const page = await bucket.list(month, { limit: LIST_PAGE, offset });
      if (page.error) throw new Error(`storage list ${month}: ${page.error.message}`);
      for (const file of page.data ?? []) {
        if (file.created_at && Date.parse(file.created_at) < cutoff.getTime())
          old.push(`${month}/${file.name}`);
      }
      if ((page.data ?? []).length < LIST_PAGE) break;
    }
  }

  for (let i = 0; i < old.length; i += REMOVE_CHUNK) {
    const removed = await bucket.remove(old.slice(i, i + REMOVE_CHUNK));
    if (removed.error) throw new Error(`storage remove: ${removed.error.message}`);
  }

  const jobs = await db
    .from('verification_jobs')
    .delete({ count: 'exact' })
    .lt('created_at', cutoff.toISOString());
  if (jobs.error) throw new Error(`verification_jobs: ${jobs.error.message}`);

  return { ok: true, screenshotsRemoved: old.length, jobsRemoved: jobs.count ?? 0 };
}
