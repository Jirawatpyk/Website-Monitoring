import { Container } from '@jirawatpyk/aura-react';
import { OverviewSkeleton } from '@/features/overview';

/** While `/` loads: the Overview's shape, never a green dashboard (EmptyStates board). Every other
 * signed-in page has its own loading.tsx (`loading-coverage.test.ts`), so this is the Overview's.
 * AppShell already pads the page, so no extra padding here. */
export default function Loading() {
  return (
    <Container>
      <OverviewSkeleton />
    </Container>
  );
}
