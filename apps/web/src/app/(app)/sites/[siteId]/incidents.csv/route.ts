import { incidentsCsv } from '@/features/sites/server';

/** Site detail → Incident history "Export": the last 90 days (session + RLS). */
export async function GET(_req: Request, { params }: { params: Promise<{ siteId: string }> }) {
  return incidentsCsv((await params).siteId);
}
