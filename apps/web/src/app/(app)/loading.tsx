import { Container } from '@jirawatpyk/aura-react';
import { LoadingList } from '@/components/states';

/** Shown while a signed-in page loads: grey shape first, never a green dashboard (EmptyStates board).
 * AppShell already pads the page, so no extra padding here. */
export default function Loading() {
  return (
    <Container>
      <LoadingList label="Loading" />
    </Container>
  );
}
