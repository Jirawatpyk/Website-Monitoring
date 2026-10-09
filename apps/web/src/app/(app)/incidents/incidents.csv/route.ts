import { incidentsListCsv } from '@/features/incidents/server';

/** Incidents → "Export CSV": the filtered list (session + RLS). */
export async function GET(req: Request) {
  return incidentsListCsv(new URL(req.url).searchParams);
}
