// @vitest-environment node
/**
 * S03 Done-when 5 on the LOCAL stack: the daily housekeeping removes verifier screenshots older
 * than 30 days through the Storage API and keeps newer ones. A file's age can only be set in the
 * database (`storage.objects.created_at`), which the API doesn't expose, so the test back-dates it
 * with psql inside the local Postgres container (`supabase_db_<project_id>`, as the CLI names it).
 */
import { execFileSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import { afterAll, describe, expect, it } from 'vitest';
import type { Database, DbClient } from '@dxt/db';
import { removeOldScreenshots } from './housekeeping';
import { SCREENSHOT_BUCKET } from './jobs';

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
// The Supabase CLI's well-known local demo key — not a secret, and never sent to a non-local URL.
const SECRET_KEY = process.env.E2E_SUPABASE_SECRET_KEY ?? 'sb_secret_N7UND0UgjKTVK-Uodkm0Hg_xSvEMPvz';
if (!/^http:\/\/(127\.0\.0\.1|localhost):/.test(URL_))
  throw new Error('integration tests run on the local stack only');
const CONTAINER = 'supabase_db_dxt-monitor';

const db: DbClient = createClient<Database>(URL_, SECRET_KEY, { auth: { persistSession: false } });
const run = crypto.randomUUID().slice(0, 8);
const month = new Date().toISOString().slice(0, 7);
const fresh = `${month}/${run}-fresh.jpg`;
const old = `2026-01/${run}-old.jpg`;
const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);

function sql(statement: string) {
  execFileSync('docker', [
    'exec',
    CONTAINER,
    'psql',
    '-U',
    'postgres',
    '-v',
    'ON_ERROR_STOP=1',
    '-c',
    statement,
  ]);
}

afterAll(async () => {
  await db.storage.from(SCREENSHOT_BUCKET).remove([fresh, old]);
});

describe('housekeeping on real Storage (S03 Done-when 5)', () => {
  it('removes a screenshot older than 30 days and keeps a new one', async () => {
    for (const path of [fresh, old]) {
      const { error } = await db.storage
        .from(SCREENSHOT_BUCKET)
        .upload(path, jpeg, { contentType: 'image/jpeg' });
      if (error) throw new Error(error.message);
    }
    sql(
      `update storage.objects set created_at = now() - interval '31 days' where bucket_id = '${SCREENSHOT_BUCKET}' and name = '${old}'`,
    );

    const result = await removeOldScreenshots(db, new Date());
    expect(result.screenshotsRemoved).toBeGreaterThanOrEqual(1);
    const exists = async (path: string) => (await db.storage.from(SCREENSHOT_BUCKET).exists(path)).data;
    expect(await exists(old)).toBe(false);
    expect(await exists(fresh)).toBe(true);
  });
});
