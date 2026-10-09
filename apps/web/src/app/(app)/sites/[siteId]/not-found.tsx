import { Breadcrumb, Button, Card, Container, EmptyState, PageHeader } from '@jirawatpyk/aura-react';
import { IconMonitor } from '@jirawatpyk/aura-react/icons';

/** `/sites/<id>` for a site that doesn't exist, was deleted, or the signed-in person can't read. */
export default function SiteNotFound() {
  return (
    <Container>
      <div className="flex flex-col gap-6">
        <PageHeader
          breadcrumb={<Breadcrumb items={[{ label: 'Sites', href: '/sites' }, { label: 'Not found' }]} />}
          title="Site not found"
        />
        <Card>
          <EmptyState
            icon={<IconMonitor />}
            title="No site at this address"
            description="It may have been deleted, or the link is wrong."
            action={
              <Button variant="secondary" href="/sites">
                Back to Sites
              </Button>
            }
          />
        </Card>
      </div>
    </Container>
  );
}
