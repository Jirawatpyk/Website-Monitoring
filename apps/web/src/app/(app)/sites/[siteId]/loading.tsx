import { Container, Skeleton } from '@jirawatpyk/aura-react';
import { CardSkeleton, PageHeaderSkeleton, PageSkeleton } from '@/components/states';

/**
 * While Site detail loads, in the page's own shape: desktop — info strip, four stats, chart + latest
 * round, tables; phone (MSite) — the range control, three small stats, a short chart, two cards.
 */
export default function Loading() {
  return (
    <Container>
      <PageSkeleton label="Loading site">
        <PageHeaderSkeleton breadcrumb actions={1} />
        <div className="flex flex-col gap-6 max-md:hidden">
          <CardSkeleton fields={5} columns={3} />
          <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
            <CardSkeleton lines={2} />
            <CardSkeleton lines={2} />
            <CardSkeleton lines={2} />
            <CardSkeleton lines={2} />
          </div>
          <div className="grid gap-4 xl:grid-cols-3">
            <div className="xl:col-span-2">
              <CardSkeleton lines={6} />
            </div>
            <CardSkeleton lines={5} />
          </div>
          <CardSkeleton lines={4} />
        </div>
        <div className="flex flex-col gap-6 md:hidden">
          <Skeleton className="h-11 w-full" />
          <div className="grid grid-cols-3 gap-2">
            <Skeleton className="h-16" />
            <Skeleton className="h-16" />
            <Skeleton className="h-16" />
          </div>
          <CardSkeleton lines={3} />
          <CardSkeleton lines={2} />
          <CardSkeleton lines={4} />
        </div>
      </PageSkeleton>
    </Container>
  );
}
