import 'server-only';
import { bangkokMonth } from '@dxt/engine';
import { createClient } from '@/lib/supabase/server';
import type { ReportsSummary } from './components/reports-link';
import { monthLabel, reportMonths } from './month';
import { loadReportClients } from './queries';

/** The Sites list's "Uptime reports" row (MSites, §42 item 1): the last complete month and its report count. */
export async function getReportsSummary(now = new Date()): Promise<ReportsSummary> {
  const { closed } = reportMonths(now);
  const clients = await loadReportClients(await createClient(), bangkokMonth(closed, now).to);
  return { month: monthLabel(closed), count: clients.length };
}
