import { Button, Container, EmptyState } from '@jirawatpyk/aura-react';
import { IconHouse, IconSearch } from '@jirawatpyk/aura-react/icons';

/** Any link to a page that doesn't exist (or isn't built yet), e.g. an old alert link. */
export default function AppNotFound() {
  return (
    <Container>
      <div className="py-12">
        <EmptyState
          bordered
          icon={<IconSearch />}
          title="Page not found"
          description="The link may be old, or the page may have moved."
          action={
            <Button href="/" variant="secondary" icon={<IconHouse />}>
              Go to Overview
            </Button>
          }
        />
      </div>
    </Container>
  );
}
