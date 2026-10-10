import 'server-only';
import { outageMinutes, episodesFromTimeline } from '@dxt/engine';
import { bangkokDayStart, CLOSED_INCIDENT_STATES, formatIncidentId, type Trigger } from '@dxt/shared';
import { createClient } from '@/lib/supabase/server';
import { csvResponse, fetchAllPages, fileSlug, toCsv } from '@/lib/csv';
import { clientWord, triggerWord } from './detail';
import { siteIdSchema } from './schemas';

const DAY_MS = 86_400_000;
const MAX_ROWS = 20_000; // a Tier 1 site writes about 4,400 checks a day (3 locations × 1/min + rechecks)

async function siteName(siteId: string) {
  if (!siteIdSchema.safeParse(siteId).success) return null;
  const supabase = await createClient();
  const { data, error } = await supabase.from('sites').select('id, name').eq('id', siteId).maybeSingle();
  if (error) throw new Error(`site: ${error.message}`);
  return data ? { supabase, site: data } : null;
}

/** Today's (Bangkok day) raw checks of the site's primary monitor, oldest first. RLS: staff. */
export async function checksCsv(siteId: string, now = new Date()): Promise<Response> {
  const found = await siteName(siteId);
  if (!found) return new Response('Not found', { status: 404 });
  const { supabase, site } = found;
  const from = bangkokDayStart(now);
  const data = await fetchAllPages(
    (a, b) =>
      supabase
        .from('check_results')
        .select(
          'id, checked_at, location, attempt, outcome, status_code, response_ms, ttfb_ms, error, monitors!inner(site_id, is_primary)',
        )
        .eq('monitors.site_id', site.id)
        .eq('monitors.is_primary', true)
        .gte('checked_at', from.toISOString())
        .order('checked_at')
        .order('id')
        .range(a, b),
    { max: MAX_ROWS },
  );
  const body = toCsv(
    ['checked_at_utc', 'location', 'attempt', 'outcome', 'http_status', 'response_ms', 'ttfb_ms', 'error'],
    data.map((c) => [
      c.checked_at,
      c.location,
      c.attempt,
      c.outcome,
      c.status_code,
      c.response_ms,
      c.ttfb_ms,
      c.error,
    ]),
  );
  // the Bangkok date of "today" (from is 17:00 UTC the day before)
  const day = new Date(from.getTime() + 7 * 3_600_000).toISOString().slice(0, 10);
  return csvResponse(body, `${fileSlug(site.name)}-checks-${day}.csv`);
}

/** The site's incidents of the last 90 days (as Incident history), newest first. RLS: staff. */
export async function incidentsCsv(siteId: string, now = new Date()): Promise<Response> {
  const found = await siteName(siteId);
  if (!found) return new Response('Not found', { status: 404 });
  const { supabase, site } = found;
  const from = new Date(now.getTime() - 90 * DAY_MS);
  const data = await fetchAllPages(
    (x, y) =>
      supabase
        .from('incidents')
        .select(
          'number, state, severity, trigger, started_at, recovered_at, resolved_at, incident_events(type, at, payload)',
        )
        .eq('site_id', site.id)
        .or(`started_at.gte.${from.toISOString()},resolved_at.is.null,resolved_at.gte.${from.toISOString()}`)
        .order('started_at', { ascending: false })
        .order('id')
        .range(x, y),
    { max: MAX_ROWS },
  );
  const body = toCsv(
    [
      'incident',
      'started_at_utc',
      'minutes',
      'trigger',
      'severity',
      'client_word',
      'state',
      'recovered_at_utc',
      'resolved_at_utc',
    ],
    data.map((i) => {
      const drops = episodesFromTimeline(i, i.incident_events);
      const open =
        !(CLOSED_INCIDENT_STATES as readonly string[]).includes(i.state) &&
        (drops.length === 0 || drops.some((d) => !d.end));
      return [
        formatIncidentId(i.number),
        i.started_at,
        open ? null : outageMinutes(drops, now),
        triggerWord(i.trigger as Trigger),
        i.severity,
        clientWord(i.severity, i.trigger as Trigger),
        i.state,
        i.recovered_at,
        i.resolved_at,
      ];
    }),
  );
  return csvResponse(body, `${fileSlug(site.name)}-incidents-90d.csv`);
}
