import 'server-only';
import { formatResponseHours } from '@dxt/shared';
import type { DbClient } from '@dxt/db';
import { loadResponseHours } from '@/server/escalation/response-hours';
import { expiryView, type ExpiryData } from './model';

const check = <T extends { error: { message: string } | null }>(name: string, r: T): T => {
  if (r.error) throw new Error(`${name}: ${r.error.message}`);
  return r;
};

/** The live sites and their `site_expiry` rows, as the page's model reads them (staff RLS). */
async function loadView(db: DbClient, now: Date): Promise<ExpiryData> {
  const [sites, records] = await Promise.all([
    db.from('sites').select('id, name, created_at').eq('is_active', true).order('name'),
    db
      .from('site_expiry')
      .select(
        'site_id, ssl_expires_at, ssl_valid_from, ssl_read_at, ssl_checked_at, ssl_error, domain_expires_at, domain_read_at, domain_checked_at, domain_error',
      ),
  ]);
  check('sites', sites);
  check('site_expiry', records);
  return expiryView(records.data ?? [], sites.data ?? [], now);
}

/** Everything `/expiry` shows, read as the signed-in person (staff; `site_expiry` is staff-read). */
export async function loadExpiry(
  db: DbClient,
  now: Date = new Date(),
): Promise<ExpiryData & { hours: string }> {
  const [view, hours] = await Promise.all([
    loadView(db, now),
    // "How it alerts" names the organisation's response hours, never a hard-coded copy (§14.14)
    loadResponseHours(db, now),
  ]);
  return { ...view, hours: formatResponseHours(hours) };
}

/** The Sites list's phone row (MSites): only the two counts, no response hours. */
export async function loadExpirySummary(
  db: DbClient,
  now: Date = new Date(),
): Promise<ExpiryData['summary']> {
  return (await loadView(db, now)).summary;
}
