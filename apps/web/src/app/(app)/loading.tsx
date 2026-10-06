import { Container } from '@jirawatpyk/aura-react';
import { LoadingList } from '@/components/states';

/** Shown while a signed-in page loads: grey shape first, never a green dashboard (EmptyStates board). */
export default function Loading() {
  return (
    <Container>
      <div className="py-8">
        <LoadingList label="Loading" />
      </div>
    </Container>
  );
}
