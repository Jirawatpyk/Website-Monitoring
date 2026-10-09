import type { Metadata } from 'next';
import { Container, PageHeader } from '@jirawatpyk/aura-react';
import { OverviewView } from '@/features/overview';
import { getOverview } from '@/features/overview/server';
import { acknowledgeIncident, undoAcknowledge } from '@/features/incidents/server';
import { SitesEmpty } from '@/features/sites';
import { chatConnected } from '@/features/sites/server';

export const metadata: Metadata = { title: 'Overview' };

/** `/` — the Overview (spec §21, boards Main3 / MainDark3 / MOverview4). */
export default async function OverviewPage() {
  const data = await getOverview();
  if (data.sites.length === 0) {
    return (
      <Container>
        <div className="flex flex-col gap-6">
          <PageHeader eyebrow="OVERVIEW" title="Overview" />
          <SitesEmpty isAdmin={data.viewer.kind === 'admin'} chatConnected={chatConnected()} />
        </div>
      </Container>
    );
  }
  return (
    <Container>
      <OverviewView data={data} ackAction={acknowledgeIncident} undoAction={undoAcknowledge} />
    </Container>
  );
}
