import type { Metadata } from 'next';
import { Button, Container, EmptyState, PageHeader } from '@jirawatpyk/aura-react';
import { IconMonitor } from '@jirawatpyk/aura-react/icons';
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
          {data.drafts > 0 ? (
            // sites were added but none is monitored yet: no "Add first site" (code review S06b)
            <EmptyState
              icon={<IconMonitor />}
              title="No site is monitored yet"
              description={`${data.drafts} ${data.drafts === 1 ? 'draft waits' : 'drafts wait'} for setup to finish.`}
              action={
                <Button variant="secondary" href="/sites">
                  Open Sites
                </Button>
              }
            />
          ) : (
            <SitesEmpty isAdmin={data.viewer.kind === 'admin'} chatConnected={chatConnected()} />
          )}
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
