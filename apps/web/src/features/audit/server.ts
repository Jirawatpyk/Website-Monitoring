import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { loadAuditExport, loadAuditPage } from './queries';
import type { AuditFilters } from './model';

export type { AuditEntry, AuditPage } from './queries';
export { auditCsv, AUDIT_CSV_NAME } from './csv';

/** `/audit`: the page's entries, read as the signed-in person (Admins only, by RLS — D-061). */
export async function getAuditPage(filters: AuditFilters, now = new Date()) {
  return loadAuditPage(await createClient(), filters, now);
}

/** The CSV export: every entry matching the filters, read as the signed-in person. */
export async function getAuditExport(filters: AuditFilters, now = new Date()) {
  return loadAuditExport(await createClient(), filters, now);
}
