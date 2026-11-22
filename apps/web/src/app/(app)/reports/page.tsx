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
  if (access.status !== 'active' || access.profile.role === 'client') {
    return (
      <Container>
        <div className="flex flex-col gap-6">
          <PageHeader titleHideBelow="lg" eyebrow="REPORTS" title="Uptime reports" />
          <NoAccess
            title="Uptime reports are for the DxT team"
            description="Ask an Admin if you need them."
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
