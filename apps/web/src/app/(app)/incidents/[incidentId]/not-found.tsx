import { Breadcrumb, Button, Card, Container, EmptyState, PageHeader } from '@jirawatpyk/aura-react';
import type { Metadata } from 'next';
import { IconBell } from '@jirawatpyk/aura-react/icons';

export const metadata: Metadata = { title: 'Incident not found' };

/** `/incidents/<id>` for an incident that doesn't exist or the signed-in person can't read (as Sites). */
export default function IncidentNotFound() {
  return (
    <Container>
      <div className="flex flex-col gap-6">
        <PageHeader
          breadcrumb={
            <Breadcrumb items={[{ label: 'Incidents', href: '/incidents' }, { label: 'Not found' }]} />
          }
          title="Incident not found"
        />
        <Card>
          <EmptyState
            icon={<IconBell />}
            title="No incident at this address"
            description="The link may be wrong, or the incident was removed."
            action={
              <Button variant="secondary" href="/incidents">
                Back to Incidents
              </Button>
            }
          />
        </Card>
      </div>
    </Container>
  );
}
