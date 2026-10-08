import { Container } from '@jirawatpyk/aura-react';
import { SiteFormSkeleton } from '@/features/sites';

export default function Loading() {
  return (
    <Container>
      <SiteFormSkeleton label="Loading Add site" />
    </Container>
  );
}
