'use client';

import { Button, Container, EmptyState } from '@jirawatpyk/aura-react';
import { IconCircleAlert, IconRotateCcw } from '@jirawatpyk/aura-react/icons';

/**
 * A signed-in page failed to load. Say so plainly — never a blank page or stale "all OK" — and
 * offer the one next step (EmptyStates rule).
 */
export default function AppError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <Container>
      <div className="py-12">
        <EmptyState
          tone="danger"
          bordered
          icon={<IconCircleAlert />}
          title="This page didn’t load"
          description="Nothing on it is shown, so nothing here can be trusted yet. Try again; if it keeps failing, tell an Admin."
          action={
            <Button variant="secondary" icon={<IconRotateCcw />} onClick={reset}>
              Try again
            </Button>
          }
          role="alert"
        />
      </div>
    </Container>
  );
}
