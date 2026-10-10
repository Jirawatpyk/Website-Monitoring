import 'server-only';
import {
  formatDay,
  formatDuration,
  formatIncidentId,
  formatTimeWithSeconds,
  TRIGGER_LABELS,
} from '@dxt/shared';
import { csvResponse, toCsv } from '@/lib/csv';
import { listIncidents } from './detail-queries';
import { DEFAULT_FILTERS, durationMinutes, filterIncidents, rootCauseLabel, type ListFilters } from './model';

const VIEWS: readonly ListFilters['view'][] = ['needs_action', 'done', 'all', 'open', 'unacked', 'past'];

/** The list's filters from the Export link's query (anything unknown falls back to the default). */
export function filtersOf(q: URLSearchParams): ListFilters {
  const view = VIEWS.find((v) => v === q.get('view')) ?? DEFAULT_FILTERS.view;
  const severity = q.get('severity');
  return {
    view,
    severity: severity === 'down' || severity === 'problem' ? severity : 'all',
    siteId: q.get('site') && /^[0-9a-f-]{36}$/i.test(q.get('site')!) ? q.get('site') : null,
    period: q.get('period') === '7' ? 7 : 30,
  };
}

const at = (iso: string | null) =>
  iso ? `${formatDay(new Date(iso), { year: true })} ${formatTimeWithSeconds(new Date(iso))}` : '';

/** Incidents → "Export CSV": the incidents the list shows for these filters (session + RLS, D-033). */
export async function incidentsListCsv(query: URLSearchParams, now = new Date()): Promise<Response> {
  const list = await listIncidents(now);
  if (!list) return new Response('Not signed in', { status: 401 });
  const f = filtersOf(query);
  const { rows } = filterIncidents(list.incidents, f, now);
  const body = toCsv(
    [
      'Incident',
      'Site',
      'Severity',
      'Trigger',
      'State',
      'Started (UTC+7)',
      'Recovered (UTC+7)',
      'Resolved (UTC+7)',
      'Duration',
      'Owner',
      'Root cause',
      'What happened',
    ],
    rows.map((i) => [
      formatIncidentId(i.number),
      i.siteName,
      i.severity === 'down' ? 'Down' : 'Problem',
      TRIGGER_LABELS[i.trigger],
      i.state.replace(/_/g, ' '),
      at(i.startedAt),
      at(i.recoveredAt),
      at(i.resolvedAt),
      formatDuration(durationMinutes(i, now)),
      i.ownerName,
      rootCauseLabel(i.rootCauseCategory),
      i.rootCause,
    ]),
  );
  return csvResponse(body, `incidents-last-${f.period}-days.csv`);
}
