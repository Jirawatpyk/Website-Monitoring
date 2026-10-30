import { Container } from '@jirawatpyk/aura-react';
import { CardSkeleton, PageHeaderSkeleton, PageSkeleton } from '@/components/states';

export default function Loading() {
  return (
    <Container>
      <PageSkeleton label="Loading on-call">
        <PageHeaderSkeleton actions={1} phoneBar="title" />
        <CardSkeleton lines={3} />
        <CardSkeleton lines={4} />
        <CardSkeleton lines={5} />
      </PageSkeleton>
    </Container>
  );
}
