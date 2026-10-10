import { Container, Skeleton } from '@jirawatpyk/aura-react';
import { CardSkeleton, PageHeaderSkeleton, PageSkeleton } from '@/components/states';

export default function Loading() {
  return (
    <Container>
      <PageSkeleton label="Loading escalation policies">
        <PageHeaderSkeleton />
        {/* The policy switch and its clock line. */}
        <div className="flex flex-wrap items-center gap-4" aria-hidden>
          <Skeleton variant="rect" height={36} width={520} className="max-w-full" />
          <Skeleton variant="text" width={280} />
        </div>
        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-3">
          <div className="flex flex-col gap-3 lg:col-span-2">
            <CardSkeleton lines={4} />
            <CardSkeleton lines={4} />
          </div>
          <div className="flex flex-col gap-4">
            <CardSkeleton fields={1} lines={4} />
            <CardSkeleton fields={2} columns={2} lines={3} />
          </div>
        </div>
      </PageSkeleton>
    </Container>
  );
}
