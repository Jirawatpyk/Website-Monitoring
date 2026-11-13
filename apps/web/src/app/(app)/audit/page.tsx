import type { Metadata } from 'next';
import { Container, PageHeader } from '@jirawatpyk/aura-react';
import { AuditLogView, parseFilters } from '@/features/audit';
import { getAuditPage } from '@/features/audit/server';
import { NoAccess } from '@/components/states';
import { getAccess } from '@/lib/auth/session';

export const metadata: Metadata = { title: 'Audit log' };

/**
 * `/audit` — Audit log (board AuditLog, spec §16.11, FR-13; S15, D-061). Admins only: everyone
 * else gets No access, and RLS lets only an Admin read `audit_log` anyway.
 */
export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const access = await getAccess();
  if (access.status !== 'active' || access.profile.role !== 'admin') {
    return (
      <Container>
        <div className="flex flex-col gap-6">
          <PageHeader titleHideBelow="lg" eyebrow="REPORTS" title="Audit log" />
          <NoAccess
            title="The audit log is for Admins"
            description="Ask an Admin if you need an entry from it."
          />
        </div>
      </Container>
    );
  }
  const data = await getAuditPage(parseFilters(await searchParams));
  return (
    <Container>
      <AuditLogView data={data} />
    </Container>
  );
}
