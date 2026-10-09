import { checksCsv } from '@/features/sites/server';

/** Site detail → "Download today's log": today's raw checks of the primary monitor (session + RLS). */
export async function GET(_req: Request, { params }: { params: Promise<{ siteId: string }> }) {
  return checksCsv((await params).siteId);
}
