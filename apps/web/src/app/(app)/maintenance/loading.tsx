import { Container } from '@jirawatpyk/aura-react';
import { CardSkeleton, PageHeaderSkeleton, PageSkeleton } from '@/components/states';

export default function Loading() {
  return (
    <Container>
      <PageSkeleton label="Loading maintenance and mutes">
        <PageHeaderSkeleton actions={1} actionFullOnPhone phoneBar="title" />
        <CardSkeleton lines={3} />
        <CardSkeleton lines={4} />
      </PageSkeleton>
    </Container>
  );
}
