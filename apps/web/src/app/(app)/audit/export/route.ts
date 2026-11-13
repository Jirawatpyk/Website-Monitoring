import { type NextRequest } from 'next/server';
import { AUDIT_CSV_NAME, auditCsv, getAuditExport } from '@/features/audit/server';
import { parseFilters } from '@/features/audit';
import { getAccess } from '@/lib/auth/session';
import { csvResponse } from '@/lib/csv';

/**
 * `GET /audit/export?cat=…&actor=…&when=…` — the Audit log CSV (plan S15 Done-when 2, D-061): every
 * entry the same filters show. Signed-in Admins only: the proxy sends a signed-out request to
 * /login, this refuses anyone else, and RLS (Admin-read) has the last word — the read uses the
 * person's own session, never the service role. Nothing is written.
 */
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const access = await getAccess();
  if (access.status !== 'active') return new Response('Sign in first.', { status: 401 });
  if (access.profile.role !== 'admin') {
    return new Response('The audit log is for Admins.', { status: 403 });
  }
  const entries = await getAuditExport(parseFilters(request.nextUrl.searchParams));
  return csvResponse(auditCsv(entries), AUDIT_CSV_NAME);
}
