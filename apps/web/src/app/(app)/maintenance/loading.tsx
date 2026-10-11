import { Container } from '@jirawatpyk/aura-react';
import { CardSkeleton, PageHeaderSkeleton, PageSkeleton } from '@/components/states';

export default function Loading() {
  return (
    <Container>
      <PageSkeleton label="Loading maintenance and mutes">
        <PageHeaderSkeleton />
        <CardSkeleton lines={3} />
        <CardSkeleton lines={4} />
      </PageSkeleton>
    </Container>
  );
}
