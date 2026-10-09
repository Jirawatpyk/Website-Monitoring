import { Button, Card, Container, EmptyState } from '@jirawatpyk/aura-react';
import { IconMonitor } from '@jirawatpyk/aura-react/icons';

/** `/sites/<id>` for a site that doesn't exist, was deleted, or the signed-in person can't read. */
export default function SiteNotFound() {
  return (
    <Container>
      <Card>
        <EmptyState
          icon={<IconMonitor />}
          title="Site not found"
          description="It may have been deleted, or the link is wrong."
          action={
            <Button variant="secondary" href="/sites">
              Back to Sites
            </Button>
          }
        />
      </Card>
    </Container>
  );
}
