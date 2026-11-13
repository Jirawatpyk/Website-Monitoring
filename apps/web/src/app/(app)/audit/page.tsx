import type { Metadata } from 'next';
import { Button, Container, PageHeader } from '@jirawatpyk/aura-react';
import { IconArrowLeft } from '@jirawatpyk/aura-react/icons';
import { ROLE_LABELS } from '@dxt/shared';
import { AuditLogView, parseFilters } from '@/features/audit';
import { getAuditPage } from '@/features/audit/server';
import { NoAccess } from '@/components/states';
import { getAccess } from '@/lib/auth/session';

export const metadata: Metadata = { title: 'Audit log' };

/**
 * `/audit` — Audit log (boards AuditLog, MAuditLog; spec §16.11, §33, FR-13; S15, D-061). Admins
 * only: everyone else gets No access (§33.2), and RLS lets only an Admin read `audit_log` anyway.
 */
export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const access = await getAccess();
  if (access.status !== 'active' || access.profile.role !== 'admin') {
    const who =
      access.status === 'active'
        ? `You’re signed in as ${access.profile.displayName} (${ROLE_LABELS[access.profile.role]}). `
        : '';
    return (
      <Container>
        <div className="flex flex-col gap-6">
          <PageHeader titleHideBelow="lg" eyebrow="REPORTS" title="Audit log" />
          <NoAccess
            title="Only Admins can see the audit log"
            description={`${who}Ask an Admin if you need an entry.`}
          />
          <div>
            <Button variant="secondary" icon={<IconArrowLeft />} href="/" fullWidth="below-md">
              Back to Overview
            </Button>
          </div>
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
