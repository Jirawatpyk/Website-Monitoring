import type { Metadata } from 'next';
import { Container, PageHeader } from '@jirawatpyk/aura-react';
import { formatDay, formatTime } from '@dxt/shared';
import { pickMonth, ReportsView } from '@/features/reports';
import { loadReportsPage } from '@/features/reports/server';
import { NoAccess } from '@/components/states';
import { getAccess } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';

export const metadata: Metadata = { title: 'Uptime reports' };

/** `/reports` — Uptime reports (board Reports, spec §14.12; S20, D-072, D-073). Every staff role reads. */
export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const access = await getAccess();
  // staff only, as an allow-list: a role added later sees nothing by default (security review S20)
  const STAFF = ['admin', 'responder', 'stakeholder', 'viewer'];
  if (access.status !== 'active' || !STAFF.includes(access.profile.role)) {
    return (
      <Container>
        <div className="flex flex-col gap-6">
          <PageHeader titleHideBelow="lg" eyebrow="REPORTS" title="Uptime reports" />
          <NoAccess
            title="Reports are for the DxT team"
            description="Your monthly report comes by email from your account manager."
          />
        </div>
      </Container>
    );
  }
  const now = new Date();
  const month = pickMonth((await searchParams).month, now);
  const data = await loadReportsPage(await createClient(), month, now);
  return (
    <Container>
      <ReportsView
        data={data}
        asOf={`${formatDay(now, { weekday: true })} ${formatTime(now)}`}
        canOpen={access.profile.role !== 'viewer'}
      />
    </Container>
  );
}
