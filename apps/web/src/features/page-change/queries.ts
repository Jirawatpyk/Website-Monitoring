import 'server-only';
import type { DbClient } from '@dxt/db';
import { FINGERPRINT_VIEW, pageFingerprintSchema } from '@dxt/shared';
import { ownDomains } from '@dxt/engine';
import { buildPageChange, type BaselineRow, type PageChangeView, type PlainFetch } from './model';

/** How many plain fetches the cards read: enough for the 3-fetch hold and its run back. */
const FETCHES = 6;

export interface PageChangeMonitor {
  monitorId: string;
  siteId: string;
  url: string;
  allowedRedirectDomains: readonly string[];
}

const fingerprint = (v: unknown) => (v && typeof v === 'object' ? pageFingerprintSchema.parse(v) : null);

/**
 * The home page's baseline, its newest plain fetches and the site's open Page change incident, read as
 * the signed-in person (staff read all three, RLS), turned into the cards' view. Null for a monitor that
 * isn't the home page (a key page has no fingerprint, §26.1).
 */
export async function loadPageChange(
  db: DbClient,
  m: PageChangeMonitor,
  viewer: { id: string },
  now: Date,
): Promise<PageChangeView> {
  const [baseline, fetches, incident] = await Promise.all([
    db
      .from('page_baselines')
      .select(
        'monitor_id, url, fingerprint, first_set_at, accepted_at, accepted_by, reason, undo_before, undo_until, undo_by',
      )
      .eq('monitor_id', m.monitorId)
      .maybeSingle(),
    db
      .from('crawler_checks')
      .select('id, checked_at, usable, fingerprint, outcome, status_code, error')
      .eq('monitor_id', m.monitorId)
      .eq('view', FINGERPRINT_VIEW)
      .order('checked_at', { ascending: false })
      .limit(FETCHES),
    db
      .from('incidents')
      .select('id, number, started_at')
      .eq('site_id', m.siteId)
      .eq('trigger', 'content_change')
      // unrecovered only: after a recovery a new change is "waiting" again (/verify, 15 Oct)
      .in('state', ['unacked', 'escalated', 'acknowledged'])
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  if (baseline.error) throw new Error(`page_baselines: ${baseline.error.message}`);
  if (fetches.error) throw new Error(`crawler_checks: ${fetches.error.message}`);
  if (incident.error) throw new Error(`incidents: ${incident.error.message}`);

  const b = baseline.data && baseline.data.url === m.url ? baseline.data : null;
  const undo = (b?.undo_before ?? null) as {
    fingerprint?: unknown;
    accepted_at?: string;
    accepted_by?: string | null;
    reason?: string | null;
  } | null;
  const ids = [b?.accepted_by, undo?.accepted_by].filter((x): x is string => !!x);
  const people = ids.length
    ? await db.from('profiles').select('id, display_name').in('id', ids)
    : { data: [], error: null };
  if (people.error) throw new Error(`profiles: ${people.error.message}`);
  const names = new Map((people.data ?? []).map((p) => [p.id, p.display_name]));

  const row: BaselineRow | null = b
    ? {
        monitor_id: b.monitor_id,
        fingerprint: fingerprint(b.fingerprint)!,
        first_set_at: b.first_set_at,
        accepted_at: b.accepted_at,
        accepted_by: b.accepted_by,
        reason: b.reason,
        undo_before: undo ? { ...undo, fingerprint: fingerprint(undo.fingerprint) ?? undefined } : null,
        undo_until: b.undo_until,
        undo_by: b.undo_by,
      }
    : null;
  const plain: PlainFetch[] = (fetches.data ?? []).map((f) => ({
    id: f.id,
    checked_at: f.checked_at,
    usable: f.usable,
    fingerprint: fingerprint(f.fingerprint),
    outcome: f.outcome,
    status_code: f.status_code,
    error: f.error,
  }));
  return buildPageChange({
    monitorId: m.monitorId,
    baseline: row,
    fetches: plain,
    own: ownDomains(m.url, m.allowedRedirectDomains),
    incident: incident.data
      ? { id: incident.data.id, number: incident.data.number, since: incident.data.started_at }
      : null,
    viewerId: viewer.id,
    nameOf: (id) => (id ? (names.get(id) ?? 'someone') : 'someone'),
    now,
  });
}
